// Zápis po akci do Zásobníku nápadů — veřejná funkce pro osobní odkaz.
//
// Pořadatel nemá účet ani heslo. Prokazuje se tokenem z osobního odkazu,
// který mu poslal správce (viz `admin-obsah`, akce `posli-vyzvy`). Token se
// porovnává přes SHA-256 s tabulkou `vyzvy_k_zapisu`.
//
// AKCE (POST JSON s polem `akce` a `token`)
//   nacti             předvyplnění z přihlášky + případný dřívější zápis
//   adresa-pro-fotku  jednorázová adresa pro nahrání jedné fotky
//   uloz              uloží zápis ve stavu `ceka` a upozorní správce
//
// CO SMÍ VEN
// Pořadatel dostane jen údaje SVÉ přihlášky, a to jen ta pole, která
// předvyplňují formulář. Fakturační údaje, platba ani variabilní symbol
// se nevracejí.
//
// UPRAVIT ZÁPIS jde, dokud není schválený nebo zamítnutý.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  DELKA,
  KRAJE,
  LIMITY,
  NAROCNOST,
  SOUHLAS,
  TYPY,
  VEK,
  VEREJNY_KONTAKT,
  ZDATNOST,
  nazevPodtypu,
  typAkce,
} from '../_shared/ciselnik-napadu.ts';
import { e, zaradAPosli } from '../_shared/fronta-posty.ts';
import { jeToken, otiskTokenu } from '../_shared/token.ts';

// ---------------------------------------------------------------------------
// NASTAVENÍ
// ---------------------------------------------------------------------------

const BUCKET = 'napady-fotky';

/** Jak dlouho platí adresa pro nahrání fotky (s). */
const PLATNOST_NAHRANI_S = 300;

/** Jak dlouho platí adresa náhledu už nahrané fotky (s). */
const PLATNOST_NAHLEDU_S = 3600;

/**
 * Kolik souborů smí ve složce jedné přihlášky ležet. Nad tím funkce další
 * adresu pro nahrání nevydá. Pět fotek ve formuláři plus rezerva na
 * výměny; zbytečné soubory se mažou při každém uložení.
 */
const SOUBORU_MAX = 25;

const WEB = (Deno.env.get('WEB_URL') ?? 'https://aktivne-spolu.cz').replace(/\/+$/, '');

/** Komu jde upozornění na nový zápis. Když chybí, upozornění se přeskočí. */
const UPOZORNENI_EMAIL = Deno.env.get('ZASOBNIK_UPOZORNENI_EMAIL') ?? '';

const KONTAKT_EMAIL = Deno.env.get('DODAVATEL_EMAIL') ?? '';

// ---------------------------------------------------------------------------
// CORS A ODPOVĚDI
// ---------------------------------------------------------------------------

function povoleneOriginy(): string[] {
  return (Deno.env.get('POVOLENE_ORIGINY') ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

function hlavickyCors(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const povolene = povoleneOriginy();
  const jeLokalni = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

  let povolenyOrigin = '*';
  if (jeLokalni) povolenyOrigin = origin;
  else if (povolene.length > 0) {
    povolenyOrigin = povolene.includes(origin) ? origin : povolene[0];
  }

  return {
    'Access-Control-Allow-Origin': povolenyOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function odpoved(req: Request, telo: unknown, stav = 200): Response {
  return new Response(JSON.stringify(telo), {
    status: stav,
    headers: {
      ...hlavickyCors(req),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

/** Chybová odpověď. `veta` je celá česká věta, která říká, co dělat. */
function chyba(req: Request, veta: string, stav: number, navic: Record<string, unknown> = {}) {
  return odpoved(req, { chyba: veta, ...navic }, stav);
}

function vetaOKontaktu(): string {
  return KONTAKT_EMAIL ? ` Napište nám na ${KONTAKT_EMAIL} a pošleme vám nový.` : '';
}

// ---------------------------------------------------------------------------
// OVĚŘENÍ ODKAZU
// ---------------------------------------------------------------------------

/** Pole přihlášky, která předvyplňují formulář. Nic dalšího ven nejde. */
const SLOUPCE_PREDVYPLNENI =
  'id, typ_poradatele, nazev_poradatele, kontaktni_osoba, email, telefon, mesto, kraj, datum_akce, napad_na_aktivitu';

interface Overeno {
  vyzvaId: string;
  platnostDo: string;
  otevreno: boolean;
  prihlaska: Record<string, unknown> & { id: string };
}

// deno-lint-ignore no-explicit-any
type Klient = SupabaseClient<any, any, any>;

async function overOdkaz(
  req: Request,
  klient: Klient,
  token: unknown,
): Promise<{ ok: Overeno } | { odmitnuto: Response }> {
  const spatne = chyba(
    req,
    'Tenhle odkaz neznáme. Zkontrolujte prosím, že jste ho z e-mailu zkopírovali celý.' +
      vetaOKontaktu(),
    404,
  );
  if (!jeToken(token)) return { odmitnuto: spatne };

  const { data: vyzva, error } = await klient
    .from('vyzvy_k_zapisu')
    .select('id, prihlaska_id, platnost_do, otevreno_kdy')
    .eq('token_hash', await otiskTokenu(token))
    .maybeSingle();

  if (error) {
    console.error('Výzvu se nepodařilo načíst:', error.message);
    return {
      odmitnuto: chyba(req, 'Formulář se teď nepodařilo načíst. Zkuste to prosím za chvíli.', 503),
    };
  }
  if (!vyzva) return { odmitnuto: spatne };

  if (new Date(vyzva.platnost_do as string).getTime() < Date.now()) {
    return {
      odmitnuto: chyba(req, 'Platnost odkazu skončila.' + vetaOKontaktu(), 410, {
        kod: 'neplatny',
      }),
    };
  }

  const { data: prihlaska, error: chybaPrihlasky } = await klient
    .from('prihlasky')
    .select(SLOUPCE_PREDVYPLNENI)
    .eq('id', vyzva.prihlaska_id)
    .maybeSingle();

  if (chybaPrihlasky || !prihlaska) {
    if (chybaPrihlasky) console.error('Přihlášku se nepodařilo načíst:', chybaPrihlasky.message);
    return { odmitnuto: spatne };
  }

  return {
    ok: {
      vyzvaId: vyzva.id as string,
      platnostDo: vyzva.platnost_do as string,
      otevreno: Boolean(vyzva.otevreno_kdy),
      prihlaska: prihlaska as Overeno['prihlaska'],
    },
  };
}

/** Sloupce zápisu, které pořadatel vidí zpátky ve formuláři. */
const SLOUPCE_ZAPISU =
  'id, stav, duvod, nazev_poradatele, kontaktni_osoba, email, telefon, mesto, kraj, ' +
  'nazev_akce, typ, podtyp, podtyp_jine, narocnost, pomucky_potreba, pomucky_jake, ' +
  'vek, zdatnost, delka, popis, datum_akce, fotky, vzkaz, verejny_kontakt, upraveno';

const LZE_UPRAVIT = new Set(['ceka', 'vraceno']);

// ---------------------------------------------------------------------------
// AKCE: NAČÍST
// ---------------------------------------------------------------------------

async function nacti(req: Request, klient: Klient, o: Overeno): Promise<Response> {
  const p = o.prihlaska;

  const { data: radek, error } = await klient
    .from('napady')
    .select(SLOUPCE_ZAPISU)
    .eq('prihlaska_id', p.id)
    .maybeSingle();
  const zapis = radek as unknown as Record<string, unknown> | null;

  if (error) {
    console.error('Zápis se nepodařilo načíst:', error.message);
    return chyba(req, 'Formulář se teď nepodařilo načíst. Zkuste to prosím za chvíli.', 503);
  }

  if (!o.otevreno) {
    await klient
      .from('vyzvy_k_zapisu')
      .update({ otevreno_kdy: new Date().toISOString() })
      .eq('id', o.vyzvaId);
  }

  // Náhledy už nahraných fotek. Bucket je soukromý, proto podepsané adresy.
  let fotky: { cesta: string; nahled: string }[] = [];
  const cesty = (zapis?.fotky as string[] | undefined) ?? [];
  if (cesty.length) {
    const { data: podepsane } = await klient.storage
      .from(BUCKET)
      .createSignedUrls(cesty, PLATNOST_NAHLEDU_S);
    fotky = cesty.map((cesta, i) => ({ cesta, nahled: podepsane?.[i]?.signedUrl ?? '' }));
  }

  const stav = (zapis?.stav as string | undefined) ?? 'novy';

  return odpoved(req, {
    stav,
    lzeUpravit: stav === 'novy' || LZE_UPRAVIT.has(stav),
    platnostDo: o.platnostDo,
    souhlas: SOUHLAS,
    // Údaje z registrace. Formulář je použije, jen když ještě není zápis.
    predvyplneni: {
      typ_poradatele: p.typ_poradatele,
      nazev_poradatele: p.nazev_poradatele,
      kontaktni_osoba: p.kontaktni_osoba,
      email: p.email,
      telefon: p.telefon,
      mesto: p.mesto,
      kraj: p.kraj,
      datum_akce: p.datum_akce,
      napad_na_aktivitu: p.napad_na_aktivitu,
    },
    zapis: zapis ? { ...zapis, fotky } : null,
  });
}

// ---------------------------------------------------------------------------
// AKCE: ADRESA PRO NAHRÁNÍ FOTKY
// ---------------------------------------------------------------------------

async function stavZapisu(klient: Klient, prihlaskaId: string): Promise<string> {
  const { data } = await klient
    .from('napady')
    .select('stav')
    .eq('prihlaska_id', prihlaskaId)
    .maybeSingle();
  return (data?.stav as string | undefined) ?? 'novy';
}

async function souboryVeSlozce(klient: Klient, prihlaskaId: string): Promise<string[] | null> {
  const { data, error } = await klient.storage.from(BUCKET).list(prihlaskaId, { limit: 100 });
  if (error) {
    console.error('Výpis fotek selhal:', error.message);
    return null;
  }
  return (data ?? [])
    .filter((s) => s.name && s.name !== '.emptyFolderPlaceholder')
    .map((s) => `${prihlaskaId}/${s.name}`);
}

async function adresaProFotku(req: Request, klient: Klient, o: Overeno): Promise<Response> {
  const stav = await stavZapisu(klient, o.prihlaska.id);
  if (!(stav === 'novy' || LZE_UPRAVIT.has(stav))) {
    return chyba(req, 'Zápis je už uzavřený a fotky v něm nejde měnit.', 409);
  }

  const soubory = await souboryVeSlozce(klient, o.prihlaska.id);
  if (soubory === null) {
    return chyba(req, 'Nahrávání se nepodařilo připravit. Zkuste to prosím znovu.', 503);
  }
  if (soubory.length >= SOUBORU_MAX) {
    return chyba(
      req,
      'Nahráli jste už hodně fotek. Odešlete prosím zápis s těmi, které ve formuláři máte.',
      429,
    );
  }

  const cesta = `${o.prihlaska.id}/${crypto.randomUUID()}.jpg`;
  const { data, error } = await klient.storage.from(BUCKET).createSignedUploadUrl(cesta);

  if (error || !data) {
    console.error('Podepsaná adresa se nevytvořila:', error?.message);
    return chyba(req, 'Nahrávání se nepodařilo připravit. Zkuste to prosím znovu.', 503);
  }

  return odpoved(req, {
    bucket: BUCKET,
    cesta: data.path,
    token: data.token,
    platnostSekund: PLATNOST_NAHRANI_S,
  });
}

// ---------------------------------------------------------------------------
// AKCE: ULOŽIT
// ---------------------------------------------------------------------------

type Chyby = Record<string, string>;

function text(h: unknown): string {
  return typeof h === 'string' ? h.trim() : '';
}

function textovePole(h: unknown): string[] {
  return Array.isArray(h) ? h.filter((x): x is string => typeof x === 'string') : [];
}

function jeEmail(h: string): boolean {
  return h.length <= 254 && /^[^\s@,;]+@[^\s@,;.]+(\.[^\s@,;.]+)+$/.test(h);
}

function jeTelefon(h: string): boolean {
  const cislice = h.replace(/[\s\-/().]/g, '').replace(/^\+/, '');
  return /^[0-9]{9,15}$/.test(cislice);
}

function klice(seznam: { klic: string }[]): Set<string> {
  return new Set(seznam.map((v) => v.klic));
}

/** Délka textu ve znacích tak, jak je počítá i formulář (bez okrajových mezer). */
function delka(t: string): number {
  return [...t].length;
}

function zkontroluj(
  v: Record<string, unknown>,
): { data: Record<string, unknown> } | { chyby: Chyby } {
  const ch: Chyby = {};

  const nazev_poradatele = text(v.nazev_poradatele);
  const kontaktni_osoba = text(v.kontaktni_osoba);
  const email = text(v.email);
  const telefon = text(v.telefon);
  const mesto = text(v.mesto);
  const kraj = text(v.kraj);

  if (!nazev_poradatele) ch.nazev_poradatele = 'Vyplňte prosím, kdo akci pořádal.';
  else if (delka(nazev_poradatele) > 200) ch.nazev_poradatele = 'Zkraťte prosím název na 200 znaků.';
  if (!kontaktni_osoba) ch.kontaktni_osoba = 'Vyplňte prosím kontaktní osobu.';
  else if (delka(kontaktni_osoba) > 120) ch.kontaktni_osoba = 'Zkraťte prosím jméno na 120 znaků.';
  if (!jeEmail(email)) ch.email = 'Zkontrolujte prosím e-mail. Má tvar jmeno@domena.cz.';
  if (telefon && !jeTelefon(telefon)) ch.telefon = 'Zkontrolujte prosím telefon. Stačí 9 číslic.';
  if (!mesto) ch.mesto = 'Vyplňte prosím město nebo obec.';
  else if (delka(mesto) > 120) ch.mesto = 'Zkraťte prosím název města.';
  if (!(KRAJE as readonly string[]).includes(kraj)) ch.kraj = 'Vyberte prosím kraj.';

  const nazev_akce = text(v.nazev_akce);
  if (!nazev_akce) ch.nazev_akce = 'Napište prosím, jak se akce jmenovala.';
  else if (delka(nazev_akce) > LIMITY.nazevMax) {
    ch.nazev_akce = `Zkraťte prosím název na ${LIMITY.nazevMax} znaků.`;
  }

  const typ = text(v.typ);
  const podtyp = text(v.podtyp);
  let podtyp_jine: string | null = text(v.podtyp_jine) || null;
  const t = typAkce(typ);
  if (!t) ch.typ = 'Vyberte prosím typ akce.';
  else if (!t.podtypy.some((p) => p.klic === podtyp)) ch.podtyp = 'Vyberte prosím, o co šlo.';
  if (podtyp === 'jine') {
    if (!podtyp_jine) ch.podtyp_jine = 'Napište prosím, o jakou akci šlo.';
    else if (delka(podtyp_jine) > LIMITY.jineMax) {
      ch.podtyp_jine = `Zkraťte prosím text na ${LIMITY.jineMax} znaků.`;
    }
  } else podtyp_jine = null;

  const narocnost = text(v.narocnost);
  if (!klice(NAROCNOST).has(narocnost)) ch.narocnost = 'Vyberte prosím náročnost.';

  const pomucky_potreba = v.pomucky_potreba === true;
  if (typeof v.pomucky_potreba !== 'boolean') ch.pomucky_potreba = 'Vyberte prosím, jestli byly potřeba pomůcky.';
  let pomucky_jake: string | null = text(v.pomucky_jake) || null;
  if (!pomucky_potreba) pomucky_jake = null;
  else if (pomucky_jake && delka(pomucky_jake) > LIMITY.pomuckyMax) {
    ch.pomucky_jake = `Zkraťte prosím seznam pomůcek na ${LIMITY.pomuckyMax} znaků.`;
  }

  const povolenyVek = klice(VEK);
  const vek = [...new Set(textovePole(v.vek))];
  if (!vek.length || vek.some((x) => !povolenyVek.has(x))) ch.vek = 'Vyberte prosím aspoň jednu věkovou skupinu.';

  const povolenaZdatnost = klice(ZDATNOST);
  const zdatnost = [...new Set(textovePole(v.zdatnost))];
  if (!zdatnost.length || zdatnost.some((x) => !povolenaZdatnost.has(x))) {
    ch.zdatnost = 'Vyberte prosím aspoň jednu možnost.';
  }

  const delkaAkce = text(v.delka);
  if (!klice(DELKA).has(delkaAkce)) ch.delka = 'Vyberte prosím, jak dlouho akce trvala.';

  const popis = text(v.popis);
  const znaku = delka(popis);
  if (znaku < LIMITY.popisMin) {
    ch.popis = `Popis má ${znaku} znaků. Napište prosím aspoň ${LIMITY.popisMin}.`;
  } else if (znaku > LIMITY.popisMax) {
    ch.popis = `Popis má ${znaku} znaků. Zkraťte ho prosím na ${LIMITY.popisMax}.`;
  }

  let datum_akce: string | null = text(v.datum_akce) || null;
  if (datum_akce) {
    const ok = /^\d{4}-\d{2}-\d{2}$/.test(datum_akce) &&
      !Number.isNaN(new Date(`${datum_akce}T12:00:00Z`).getTime());
    if (!ok) {
      ch.datum_akce = 'Zadejte prosím datum ve tvaru den. měsíc. rok, nebo pole nechte prázdné.';
      datum_akce = null;
    }
  }

  const fotky = [...new Set(textovePole(v.fotky))];
  if (fotky.length < LIMITY.fotekMin) ch.fotky = 'Přidejte prosím aspoň jednu fotku.';
  else if (fotky.length > LIMITY.fotekMax) ch.fotky = `Vyberte prosím nejvýš ${LIMITY.fotekMax} fotek.`;

  let vzkaz: string | null = text(v.vzkaz) || null;
  if (vzkaz && delka(vzkaz) > LIMITY.vzkazMax) {
    ch.vzkaz = `Zkraťte prosím vzkaz na ${LIMITY.vzkazMax} znaků.`;
  }

  const povolenyKontakt = klice(VEREJNY_KONTAKT);
  const verejny_kontakt = [...new Set(textovePole(v.verejny_kontakt))].filter((x) =>
    povolenyKontakt.has(x)
  );
  if (!verejny_kontakt.length) {
    ch.verejny_kontakt = 'Vyberte prosím, který kontakt můžeme u nápadu zveřejnit.';
  } else if (verejny_kontakt.includes('telefon') && !telefon) {
    ch.verejny_kontakt = 'Telefon jde zveřejnit, jen když ho vyplníte výš.';
  }

  if (v.souhlas_zpracovani !== true) {
    ch.souhlas_zpracovani = 'Bez souhlasu zápis uložit nemůžeme. Zaškrtněte ho prosím.';
  }
  if (v.souhlas_foto !== true) {
    ch.souhlas_foto = 'Bez tohoto prohlášení fotky zveřejnit nemůžeme. Zaškrtněte ho prosím.';
  }

  if (Object.keys(ch).length) return { chyby: ch };

  if (vzkaz === '') vzkaz = null;

  return {
    data: {
      nazev_poradatele,
      kontaktni_osoba,
      email,
      telefon: telefon || null,
      mesto,
      kraj,
      nazev_akce,
      typ,
      podtyp,
      podtyp_jine,
      narocnost,
      pomucky_potreba,
      pomucky_jake,
      vek,
      zdatnost,
      delka: delkaAkce,
      popis,
      datum_akce,
      fotky,
      vzkaz,
      verejny_kontakt,
      souhlas_zpracovani: true,
      souhlas_foto: true,
      souhlas_zneni: `${SOUHLAS.zpracovani}\n${SOUHLAS.foto}`,
    },
  };
}

async function uloz(
  req: Request,
  klient: Klient,
  o: Overeno,
  vstup: Record<string, unknown>,
): Promise<Response> {
  const prihlaskaId = o.prihlaska.id;
  const predtim = await stavZapisu(klient, prihlaskaId);

  if (!(predtim === 'novy' || LZE_UPRAVIT.has(predtim))) {
    return chyba(
      req,
      predtim === 'schvaleno'
        ? 'Zápis je už schválený a zveřejněný. Když v něm chcete něco změnit, napište nám.'
        : 'Zápis je uzavřený a nejde ho upravit.',
      409,
    );
  }

  const vysledek = zkontroluj(vstup);
  if ('chyby' in vysledek) {
    return chyba(req, 'Ve formuláři je potřeba něco opravit. Chybná pole jsou označená.', 422, {
      chyby: vysledek.chyby,
    });
  }
  const d = vysledek.data;

  // Každá fotka musí ležet ve složce TÉTO přihlášky a opravdu existovat.
  const soubory = await souboryVeSlozce(klient, prihlaskaId);
  if (soubory === null) {
    return chyba(req, 'Fotky se teď nepodařilo ověřit. Zkuste to prosím znovu.', 503);
  }
  const existuji = new Set(soubory);
  const fotky = d.fotky as string[];
  if (fotky.some((f) => !f.startsWith(`${prihlaskaId}/`) || !existuji.has(f))) {
    return chyba(
      req,
      'Některou fotku se nepodařilo najít. Přidejte ji prosím znovu a zápis odešlete.',
      422,
      { chyby: { fotky: 'Přidejte prosím fotku znovu.' } },
    );
  }

  const { error } = await klient.from('napady').upsert(
    {
      prihlaska_id: prihlaskaId,
      typ_poradatele: o.prihlaska.typ_poradatele,
      ...d,
      stav: 'ceka',
      duvod: null,
      rozhodl: null,
      rozhodnuto_kdy: null,
    },
    { onConflict: 'prihlaska_id' },
  );

  if (error) {
    console.error('Zápis se nepodařilo uložit:', error.message);
    return chyba(req, 'Zápis se nepodařilo uložit. Zkuste to prosím za chvíli znovu.', 503);
  }

  await klient
    .from('vyzvy_k_zapisu')
    .update({ pouzito_kdy: new Date().toISOString() })
    .eq('id', o.vyzvaId);

  // Úklid: fotky, které pořadatel nahrál a pak z formuláře odebral.
  const navic = soubory.filter((s) => !fotky.includes(s));
  if (navic.length) {
    const { error: chybaUklidu } = await klient.storage.from(BUCKET).remove(navic);
    if (chybaUklidu) console.warn('Nepoužité fotky se nepodařilo smazat:', chybaUklidu.message);
  }

  await upozorniSpravce(klient, prihlaskaId, d, predtim);

  return odpoved(req, { ok: true, stav: 'ceka' });
}

async function upozorniSpravce(
  klient: Klient,
  prihlaskaId: string,
  d: Record<string, unknown>,
  predtim: string,
): Promise<void> {
  if (!UPOZORNENI_EMAIL) {
    console.log('ZASOBNIK_UPOZORNENI_EMAIL není nastavený, upozornění se přeskočí.');
    return;
  }

  const upraveno = predtim !== 'novy';
  const nazev = String(d.nazev_akce);
  const kdo = String(d.nazev_poradatele);
  const kde = `${d.mesto}, ${d.kraj}`;
  const typ = TYPY.find((t) => t.klic === d.typ)?.nazev ?? String(d.typ);
  const podtyp = d.podtyp === 'jine' ? String(d.podtyp_jine) : nazevPodtypu(String(d.typ), String(d.podtyp));
  const odkaz = `${WEB}/admin/#zasobnik`;

  const predmet = upraveno
    ? `Upravený zápis do Zásobníku: ${nazev}`
    : `Nový zápis do Zásobníku: ${nazev}`;

  const text = [
    upraveno ? 'Pořadatel upravil zápis do Zásobníku nápadů.' : 'Do Zásobníku nápadů přišel nový zápis.',
    '',
    `Akce: ${nazev}`,
    `Pořadatel: ${kdo}`,
    `Kde: ${kde}`,
    `Typ: ${typ} – ${podtyp}`,
    `Fotek: ${(d.fotky as string[]).length}`,
    d.vzkaz ? `Vzkaz pro vás: ${d.vzkaz}` : '',
    '',
    `Zkontrolujte ho a schvalte v administraci: ${odkaz}`,
  ].filter((r, i, a) => r !== '' || a[i - 1] !== '').join('\n');

  const html = `<p>${upraveno ? 'Pořadatel upravil zápis do Zásobníku nápadů.' : 'Do Zásobníku nápadů přišel nový zápis.'}</p>
<p><strong>${e(nazev)}</strong><br>${e(kdo)}<br>${e(kde)}<br>${e(typ)} – ${e(podtyp)}<br>Fotek: ${(d.fotky as string[]).length}</p>
${d.vzkaz ? `<p>Vzkaz pro vás: ${e(String(d.vzkaz))}</p>` : ''}
<p><a href="${e(odkaz)}">Zkontrolovat v administraci</a></p>`;

  await zaradAPosli(klient, { prijemce: UPOZORNENI_EMAIL, predmet, text, html }, prihlaskaId);
}

// ---------------------------------------------------------------------------
// VSTUPNÍ BOD
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: hlavickyCors(req) });
  }
  if (req.method !== 'POST') return chyba(req, 'Nepodporovaný způsob volání.', 405);

  const url = Deno.env.get('SUPABASE_URL');
  const servisniKlic = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !servisniKlic) {
    console.error('Chybí SUPABASE_URL nebo SUPABASE_SERVICE_ROLE_KEY.');
    return chyba(req, 'Formulář teď nefunguje. Zkuste to prosím později.', 500);
  }

  let telo: Record<string, unknown>;
  try {
    telo = (await req.json()) as Record<string, unknown>;
  } catch {
    return chyba(req, 'Požadavek se nepodařilo přečíst. Obnovte prosím stránku.', 400);
  }

  const klient = createClient(url, servisniKlic, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const overeni = await overOdkaz(req, klient, telo.token);
  if ('odmitnuto' in overeni) return overeni.odmitnuto;

  switch (telo.akce) {
    case 'nacti':
      return await nacti(req, klient, overeni.ok);
    case 'adresa-pro-fotku':
      return await adresaProFotku(req, klient, overeni.ok);
    case 'uloz':
      return await uloz(
        req,
        klient,
        overeni.ok,
        (telo.zapis && typeof telo.zapis === 'object' ? telo.zapis : {}) as Record<string, unknown>,
      );
    default:
      return chyba(req, 'Neznámý požadavek. Obnovte prosím stránku.', 400);
  }
});
