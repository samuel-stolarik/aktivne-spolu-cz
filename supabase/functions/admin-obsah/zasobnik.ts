// Administrace Zásobníku nápadů: fronta zápisů, schvalování, opravy textů,
// náhled veřejné podoby a výzvy k zápisu.
//
// Volá se jen z `index.ts` této funkce, AŽ PO ověření správce. Funkce tady
// vracejí `{ stav, telo }` a odpověď z nich skládá `index.ts`, aby se CORS
// a hlavičky řešily na jednom místě.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { LIMITY, PODTYP_JINE, UPRAVITELNA_POLE, type UpravitelnePole } from '../_shared/ciselnik-napadu.ts';
import { emailVraceni, emailVyzvy, emailZverejneni } from '../_shared/emaily-zasobniku.ts';
import { zaradAPosli } from '../_shared/fronta-posty.ts';
import { novyToken, otiskTokenu } from '../_shared/token.ts';
import { SLOUPCE_VEREJNE, verejnaPodoba } from '../_shared/verejny-napad.ts';

// deno-lint-ignore no-explicit-any
type Klient = SupabaseClient<any, any, any>;

export interface Vysledek {
  stav: number;
  telo: unknown;
}

interface Spravce {
  id: string;
  email: string;
}

const BUCKET = 'napady-fotky';
const PLATNOST_NAHLEDU_S = 3600;

/** Jak dlouho platí osobní odkaz (dny). */
const PLATNOST_DNI = Number(Deno.env.get('VYZVA_PLATNOST_DNI') ?? '60');

/** Zkušební odkaz platí jen den. Slouží k prohlédnutí e-mailu a formuláře. */
const PLATNOST_ZKUSEBNI_DNI = 1;

/** Kolik výzev jde odeslat jedním požadavkem. Víc posílá administrace po dávkách. */
const DAVKA_MAX = 25;

/** Nejkratší důvod vrácení k úpravě. Musí sedět se správou. */
const DUVOD_MIN = 5;

function chyba(veta: string, stav: number): Vysledek {
  return { stav, telo: { chyba: veta } };
}

function ok(telo: unknown): Vysledek {
  return { stav: 200, telo };
}

function jeUuid(h: unknown): h is string {
  return typeof h === 'string' && /^[0-9a-f-]{36}$/i.test(h);
}

function jeEmail(h: string): boolean {
  return h.length <= 254 && /^[^\s@,;]+@[^\s@,;.]+(\.[^\s@,;.]+)+$/.test(h);
}

function zaDni(dni: number): Date {
  return new Date(Date.now() + dni * 24 * 3600 * 1000);
}

/**
 * Založí výzvu s novým tokenem. U ostré výzvy zkrátí platnost dřívějších
 * ostrých odkazů téže přihlášky, aby v oběhu byl vždycky jen jeden.
 */
async function zalozVyzvu(
  klient: Klient,
  prihlaskaId: string,
  prijemce: string,
  spravce: Spravce,
  zkusebni: boolean,
): Promise<{ id: string; token: string; platnostDo: Date } | null> {
  const token = novyToken();
  const platnostDo = zaDni(zkusebni ? PLATNOST_ZKUSEBNI_DNI : PLATNOST_DNI);

  const { data, error } = await klient
    .from('vyzvy_k_zapisu')
    .insert({
      prihlaska_id: prihlaskaId,
      token_hash: await otiskTokenu(token),
      platnost_do: platnostDo.toISOString(),
      odeslal: spravce.email,
      prijemce,
      zkusebni,
    })
    .select('id')
    .single();

  if (error || !data) {
    console.error('Výzvu se nepodařilo založit:', error?.message);
    return null;
  }

  if (!zkusebni) {
    await klient
      .from('vyzvy_k_zapisu')
      .update({ platnost_do: new Date().toISOString() })
      .eq('prihlaska_id', prihlaskaId)
      .eq('zkusebni', false)
      .neq('id', data.id)
      .gt('platnost_do', new Date().toISOString());
  }

  return { id: data.id as string, token, platnostDo };
}

// ---------------------------------------------------------------------------
// FRONTA ZÁPISŮ
// ---------------------------------------------------------------------------

/** Všechny zápisy, nejnovější nahoře, s náhledy fotek a záznamem oprav textů. */
export async function seznamNapadu(klient: Klient): Promise<Vysledek> {
  const [{ data, error }, upravy] = await Promise.all([
    klient.from('napady').select('*').order('vytvoreno', { ascending: false }),
    klient
      .from('napady_upravy')
      .select('napad_id, upraveno, upravil, pole')
      .order('upraveno', { ascending: false }),
  ]);

  if (error || upravy.error) {
    console.error('Zápisy se nepodařilo načíst:', (error ?? upravy.error)?.message);
    return chyba('Zápisy se nepodařilo načíst. Zkuste to prosím znovu.', 503);
  }

  const upravyNapadu = new Map<string, Record<string, unknown>[]>();
  for (const u of upravy.data ?? []) {
    const id = u.napad_id as string;
    if (!upravyNapadu.has(id)) upravyNapadu.set(id, []);
    upravyNapadu.get(id)!.push({ upraveno: u.upraveno, upravil: u.upravil, pole: u.pole });
  }

  const radky = (data ?? []) as Record<string, unknown>[];
  const cesty = radky.flatMap((r) => (Array.isArray(r.fotky) ? (r.fotky as string[]) : []));
  const adresy = new Map<string, string>();
  if (cesty.length) {
    const { data: podepsane } = await klient.storage.from(BUCKET).createSignedUrls(cesty, PLATNOST_NAHLEDU_S);
    for (const a of podepsane ?? []) if (a.path && a.signedUrl) adresy.set(a.path, a.signedUrl);
  }

  return ok({
    napady: radky.map((r) => ({
      ...r,
      fotky: ((r.fotky as string[]) ?? []).map((c) => ({ cesta: c, adresa: adresy.get(c) ?? '' })),
      upravy: upravyNapadu.get(r.id as string) ?? [],
    })),
  });
}

const ROZHODNUTI = {
  schvalit: 'schvaleno',
  vratit: 'vraceno',
  zamitnout: 'zamitnuto',
  // Vezme dřívější rozhodnutí zpět: zápis je zase „čeká na kontrolu"
  // a z webu zmizí. Pořadatel nedostane žádný e-mail.
  'k-rozhodnuti': 'ceka',
} as const;

/** Schválí, vrátí k úpravě, zamítne zápis, nebo rozhodnutí vezme zpět. */
export async function rozhodniNapad(
  klient: Klient,
  telo: Record<string, unknown>,
  spravce: Spravce,
): Promise<Vysledek> {
  const id = telo.id;
  const rozhodnuti = String(telo.rozhodnuti ?? '') as keyof typeof ROZHODNUTI;
  const duvod = typeof telo.duvod === 'string' ? telo.duvod.trim() : '';

  if (!jeUuid(id)) return chyba('Chybí, o který zápis jde. Obnovte prosím stránku.', 400);
  if (!(rozhodnuti in ROZHODNUTI)) return chyba('Neznámé rozhodnutí. Obnovte prosím stránku.', 400);
  if (rozhodnuti === 'vratit' && duvod.length < DUVOD_MIN) {
    return chyba(
      `Napište prosím pořadateli, co má v zápisu upravit. Stačí krátce, aspoň ${DUVOD_MIN} znaků.`,
      422,
    );
  }
  if (duvod.length > 1000) return chyba('Zkraťte prosím důvod na 1000 znaků.', 422);

  const { data: napad, error } = await klient
    .from('napady')
    .select('id, prihlaska_id, nazev_akce, email, kontaktni_osoba, stav, schvaleno_kdy')
    .eq('id', id)
    .maybeSingle();

  if (error) return chyba('Zápis se nepodařilo načíst. Zkuste to prosím znovu.', 503);
  if (!napad) return chyba('Tenhle zápis už neexistuje. Obnovte prosím seznam.', 404);

  const ted = new Date().toISOString();
  if (rozhodnuti === 'k-rozhodnuti' && napad.stav === 'ceka') {
    return chyba('Zápis už čeká na rozhodnutí. Obnovte prosím seznam.', 409);
  }

  const zmena: Record<string, unknown> = rozhodnuti === 'k-rozhodnuti'
    ? { stav: 'ceka', duvod: null, rozhodl: spravce.email, rozhodnuto_kdy: ted }
    : {
      stav: ROZHODNUTI[rozhodnuti],
      duvod: rozhodnuti === 'schvalit' ? null : duvod || null,
      rozhodl: spravce.email,
      rozhodnuto_kdy: ted,
    };
  const poprveSchvaleno = rozhodnuti === 'schvalit' && !napad.schvaleno_kdy;
  if (poprveSchvaleno) zmena.schvaleno_kdy = ted;

  const { error: chybaZmeny } = await klient.from('napady').update(zmena).eq('id', id);
  if (chybaZmeny) {
    console.error('Rozhodnutí se nepodařilo uložit:', chybaZmeny.message);
    return chyba('Rozhodnutí se nepodařilo uložit. Zkuste to prosím znovu.', 503);
  }

  // E-mail pořadateli. Neúspěch odeslání rozhodnutí nevrací zpátky,
  // jen se o něm administrace dozví.
  let email: { odeslano: boolean; pres: string } | null = null;
  const p = { email: String(napad.email), kontaktni_osoba: String(napad.kontaktni_osoba) };

  if (rozhodnuti === 'vratit') {
    const vyzva = await zalozVyzvu(klient, String(napad.prihlaska_id), p.email, spravce, false);
    if (vyzva) {
      const vysl = await zaradAPosli(
        klient,
        emailVraceni(p, String(napad.nazev_akce), duvod, vyzva.token, vyzva.platnostDo),
        String(napad.prihlaska_id),
      );
      await klient.from('vyzvy_k_zapisu').update({ posta_id: vysl.postaId }).eq('id', vyzva.id);
      email = { odeslano: vysl.odeslano, pres: vysl.pres };
    }
  } else if (poprveSchvaleno) {
    const vysl = await zaradAPosli(
      klient,
      emailZverejneni(p, String(napad.nazev_akce), String(napad.id)),
      String(napad.prihlaska_id),
    );
    email = { odeslano: vysl.odeslano, pres: vysl.pres };
  }

  return ok({ id, stav: ROZHODNUTI[rozhodnuti], email });
}

// ---------------------------------------------------------------------------
// OPRAVA TEXTŮ SPRÁVCEM
// ---------------------------------------------------------------------------

/** Nejvyšší délka každého upravitelného pole. Stejná jako ve formuláři. */
const MAX_DELKA: Record<UpravitelnePole, number> = {
  nazev_akce: LIMITY.nazevMax,
  popis: LIMITY.popisMax,
  pomucky_jake: LIMITY.pomuckyMax,
  poznamka: LIMITY.poznamkaMax,
  podtyp_jine: LIMITY.jineMax,
};

const NAZEV_POLE: Record<UpravitelnePole, string> = {
  nazev_akce: 'Název akce',
  popis: 'Popis akce',
  pomucky_jake: 'Jaké pomůcky',
  poznamka: 'Poznámka/komentář',
  podtyp_jine: 'Jaká akce to byla',
};

function znaku(t: string): number {
  return [...t].length;
}

/**
 * Opraví texty zápisu (překlepy, drobné chyby). Ukládá se jen to, co se
 * opravdu změnilo, a každá změna se zapíše do `napady_upravy`: kdo, kdy,
 * původní a nová hodnota. Na webu se úprava neukazuje.
 *
 * Stav zápisu se nemění. Schválený nápad je po uložení hned opravený i na webu.
 */
export async function upravNapad(
  klient: Klient,
  telo: Record<string, unknown>,
  spravce: Spravce,
): Promise<Vysledek> {
  const id = telo.id;
  if (!jeUuid(id)) return chyba('Chybí, o který zápis jde. Obnovte prosím stránku.', 400);
  const texty = telo.texty && typeof telo.texty === 'object' ? (telo.texty as Record<string, unknown>) : {};

  const { data: napad, error } = await klient
    .from('napady')
    .select('id, podtyp, pomucky_potreba, nazev_akce, popis, pomucky_jake, poznamka, podtyp_jine')
    .eq('id', id)
    .maybeSingle();
  if (error) return chyba('Zápis se nepodařilo načíst. Zkuste to prosím znovu.', 503);
  if (!napad) return chyba('Tenhle zápis už neexistuje. Obnovte prosím seznam.', 404);

  const chyby: Record<string, string> = {};
  const zmena: Record<string, string | null> = {};

  for (const pole of UPRAVITELNA_POLE) {
    if (!(pole in texty)) continue;
    const surove = texty[pole];
    if (surove !== null && typeof surove !== 'string') continue;
    const nove = (surove ?? '').trim();
    const puvodni = (napad[pole] as string | null) ?? '';

    // Pole, která u tohoto zápisu nemají smysl, se nedají vyplnit.
    if (pole === 'pomucky_jake' && !napad.pomucky_potreba) continue;
    if (pole === 'podtyp_jine' && napad.podtyp !== PODTYP_JINE) continue;

    if (znaku(nove) > MAX_DELKA[pole]) {
      chyby[pole] = `${NAZEV_POLE[pole]}: zkraťte prosím text na ${MAX_DELKA[pole]} znaků.`;
      continue;
    }
    const povinne = pole !== 'poznamka';
    if (povinne && !nove) {
      chyby[pole] = `${NAZEV_POLE[pole]} nesmí zůstat prázdné.`;
      continue;
    }
    if (pole === 'nazev_akce' && znaku(nove) < LIMITY.nazevMin) {
      chyby[pole] = `Název akce musí mít aspoň ${LIMITY.nazevMin} znaků.`;
      continue;
    }
    if (pole === 'popis' && znaku(nove) < LIMITY.popisMin) {
      chyby[pole] = `Popis akce musí mít aspoň ${LIMITY.popisMin} znaků. Teď má ${znaku(nove)}.`;
      continue;
    }
    // Porovnává se bez okrajových mezer, ať se jako změna nepočítá jen mezera navíc.
    if (nove !== puvodni.trim()) zmena[pole] = nove || null;
  }

  if (Object.keys(chyby).length) {
    return { stav: 422, telo: { chyba: Object.values(chyby).join(' '), chyby } };
  }
  const zmenena = Object.keys(zmena) as UpravitelnePole[];
  if (!zmenena.length) return ok({ id, zmeneno: [] });

  const ted = new Date().toISOString();
  const { error: chybaZmeny } = await klient
    .from('napady')
    .update({ ...zmena, texty_upravil: spravce.email, texty_upraveno_kdy: ted })
    .eq('id', id);
  if (chybaZmeny) {
    console.error('Opravu textů se nepodařilo uložit:', chybaZmeny.message);
    return chyba('Opravu se nepodařilo uložit. Zkuste to prosím znovu.', 503);
  }

  const { error: chybaZaznamu } = await klient.from('napady_upravy').insert(
    zmenena.map((pole) => ({
      napad_id: id,
      upraveno: ted,
      upravil: spravce.email,
      pole,
      puvodni: (napad[pole] as string | null) ?? null,
      nove: zmena[pole],
    })),
  );
  if (chybaZaznamu) console.error('Záznam opravy se nepodařilo uložit:', chybaZaznamu.message);

  return ok({ id, zmeneno: zmenena, texty_upravil: spravce.email, texty_upraveno_kdy: ted, ...zmena });
}

// ---------------------------------------------------------------------------
// NÁHLED VEŘEJNÉ PODOBY
// ---------------------------------------------------------------------------

/**
 * Nápad v podobě, jakou vydává veřejná funkce `verejne-napady`, ale
 * v jakémkoli stavu. Stránka /zasobnik/?nahled=<id> z něj vykreslí
 * přesně to, co uvidí návštěvníci po schválení.
 */
export async function nahledNapadu(klient: Klient, telo: Record<string, unknown>): Promise<Vysledek> {
  const id = telo.id;
  if (!jeUuid(id)) return chyba('Chybí, o který zápis jde. Otevřete náhled prosím znovu z administrace.', 400);

  const { data, error } = await klient.from('napady').select(`${SLOUPCE_VEREJNE}, stav`).eq('id', id).maybeSingle();
  if (error) return chyba('Náhled se nepodařilo načíst. Zkuste to prosím znovu.', 503);
  if (!data) return chyba('Tenhle zápis už neexistuje.', 404);

  const r = data as unknown as Record<string, unknown>;
  const cesty = Array.isArray(r.fotky) ? (r.fotky as string[]) : [];
  const adresy = new Map<string, string>();
  if (cesty.length) {
    const { data: podepsane } = await klient.storage.from(BUCKET).createSignedUrls(cesty, PLATNOST_NAHLEDU_S);
    for (const a of podepsane ?? []) if (a.path && a.signedUrl) adresy.set(a.path, a.signedUrl);
  }
  const fotky = cesty.map((c) => adresy.get(c)).filter((x): x is string => Boolean(x));

  return ok({ napad: verejnaPodoba(r, fotky), stav: r.stav });
}

// ---------------------------------------------------------------------------
// VÝZVY K ZÁPISU
// ---------------------------------------------------------------------------

/** Přihlášky s tím, jestli dostaly výzvu a jestli poslaly zápis. */
export async function prehledVyzev(klient: Klient): Promise<Vysledek> {
  const [prihlasky, vyzvy, napady] = await Promise.all([
    klient
      .from('prihlasky')
      .select('id, vytvoreno, typ_poradatele, nazev_poradatele, kontaktni_osoba, email, mesto, kraj, datum_akce, stav, schvaleno')
      .order('vytvoreno', { ascending: false }),
    klient
      .from('vyzvy_k_zapisu')
      .select('id, prihlaska_id, vytvoreno, platnost_do, otevreno_kdy, pouzito_kdy, posta_id, prijemce')
      .eq('zkusebni', false)
      .order('vytvoreno', { ascending: false }),
    klient.from('napady').select('prihlaska_id, stav'),
  ]);

  if (prihlasky.error || vyzvy.error || napady.error) {
    console.error('Přehled výzev selhal:', prihlasky.error ?? vyzvy.error ?? napady.error);
    return chyba('Přehled se nepodařilo načíst. Zkuste to prosím znovu.', 503);
  }

  // Stav odeslání e-mailů z odchozí pošty.
  const postaIds = (vyzvy.data ?? []).map((v) => v.posta_id).filter(Boolean) as string[];
  const stavPosty = new Map<string, string>();
  if (postaIds.length) {
    const { data } = await klient.from('odchozi_posta').select('id, stav').in('id', postaIds);
    for (const r of data ?? []) stavPosty.set(r.id as string, r.stav as string);
  }

  const posledni = new Map<string, Record<string, unknown>>();
  const pocet = new Map<string, number>();
  for (const v of vyzvy.data ?? []) {
    const pid = v.prihlaska_id as string;
    pocet.set(pid, (pocet.get(pid) ?? 0) + 1);
    if (!posledni.has(pid)) posledni.set(pid, v);
  }
  // Otevření a použití se počítá ze všech výzev přihlášky, ne jen z poslední.
  const otevreno = new Set((vyzvy.data ?? []).filter((v) => v.otevreno_kdy).map((v) => v.prihlaska_id));
  const stavZapisu = new Map((napady.data ?? []).map((n) => [n.prihlaska_id as string, n.stav as string]));

  return ok({
    prihlasky: (prihlasky.data ?? []).map((p) => {
      const v = posledni.get(p.id as string);
      return {
        ...p,
        vyzva: v
          ? {
            odeslano_kdy: v.vytvoreno,
            platnost_do: v.platnost_do,
            prijemce: v.prijemce,
            stav_posty: v.posta_id ? (stavPosty.get(v.posta_id as string) ?? null) : null,
            pocet: pocet.get(p.id as string) ?? 1,
          }
          : null,
        otevreno: otevreno.has(p.id),
        zapis: stavZapisu.get(p.id as string) ?? null,
      };
    }),
  });
}

/**
 * Pošle výzvu k zápisu vybraným přihláškám.
 *
 * `zkusebne: true` pošle e-mail k JEDNÉ přihlášce na adresu správce
 * (nebo na `prijemce`). Odkaz v něm je funkční, ale platí jen den a ostré
 * odkazy neruší.
 */
export async function posliVyzvy(
  klient: Klient,
  telo: Record<string, unknown>,
  spravce: Spravce,
): Promise<Vysledek> {
  const ids = Array.isArray(telo.prihlasky) ? [...new Set(telo.prihlasky.filter(jeUuid))] : [];
  const zkusebne = telo.zkusebne === true;

  if (!ids.length) return chyba('Vyberte prosím aspoň jednu přihlášku.', 400);
  if (ids.length > DAVKA_MAX) {
    return chyba(`Najednou jde poslat nejvýš ${DAVKA_MAX} výzev. Administrace je posílá po dávkách.`, 400);
  }

  let prijemceZkousky = '';
  if (zkusebne) {
    if (ids.length !== 1) return chyba('Zkušební e-mail jde poslat jen k jedné přihlášce.', 400);
    prijemceZkousky = typeof telo.prijemce === 'string' && telo.prijemce.trim()
      ? telo.prijemce.trim()
      : spravce.email;
    if (!jeEmail(prijemceZkousky)) return chyba('Zkontrolujte prosím adresu pro zkušební e-mail.', 422);
  }

  const { data: prihlasky, error } = await klient
    .from('prihlasky')
    .select('id, email, kontaktni_osoba, nazev_poradatele, stav')
    .in('id', ids);
  if (error) return chyba('Přihlášky se nepodařilo načíst. Zkuste to prosím znovu.', 503);

  const { data: schvalene } = await klient
    .from('napady')
    .select('prihlaska_id')
    .in('prihlaska_id', ids)
    .eq('stav', 'schvaleno');
  const maSchvaleny = new Set((schvalene ?? []).map((n) => n.prihlaska_id as string));

  const vysledky: { id: string; vysledek: 'odeslano' | 'ceka' | 'preskoceno' | 'chyba'; veta: string }[] = [];

  for (const id of ids) {
    const p = (prihlasky ?? []).find((x) => x.id === id);
    if (!p) {
      vysledky.push({ id, vysledek: 'chyba', veta: 'Přihláška neexistuje.' });
      continue;
    }
    if (!zkusebne && maSchvaleny.has(id)) {
      vysledky.push({ id, vysledek: 'preskoceno', veta: 'Zápis už je schválený, výzva není potřeba.' });
      continue;
    }

    const prijemce = zkusebne ? prijemceZkousky : String(p.email);
    const vyzva = await zalozVyzvu(klient, id, prijemce, spravce, zkusebne);
    if (!vyzva) {
      vysledky.push({ id, vysledek: 'chyba', veta: 'Výzvu se nepodařilo založit.' });
      continue;
    }

    const zprava = emailVyzvy(
      { email: String(p.email), kontaktni_osoba: String(p.kontaktni_osoba) },
      vyzva.token,
      vyzva.platnostDo,
      prijemce,
    );
    if (zkusebne) zprava.predmet = `[ZKOUŠKA] ${zprava.predmet}`;

    const vysl = await zaradAPosli(klient, zprava, id);
    await klient.from('vyzvy_k_zapisu').update({ posta_id: vysl.postaId }).eq('id', vyzva.id);

    vysledky.push({
      id,
      vysledek: vysl.odeslano ? 'odeslano' : vysl.postaId ? 'ceka' : 'chyba',
      veta: vysl.odeslano
        ? `Odesláno na ${prijemce}.`
        : vysl.postaId
        ? 'E-mail čeká ve frontě odchozí pošty.'
        : 'E-mail se nepodařilo připravit.',
    });
  }

  return ok({ vysledky });
}
