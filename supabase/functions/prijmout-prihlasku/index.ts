// Příjem přihlášky z webového formuláře.
//
// Tohle je jediná cesta, kterou se přihláška dostane do databáze. Web běží
// jinde (statické stránky na FTP hostingu) a nemá — a nesmí mít — přístup
// k databázi. Posílá sem obyčejný JSON a dostane zpátky variabilní symbol
// a odkaz na QR kód platby.
//
// PRAVIDLO, PODLE KTERÉHO JE CELÁ FUNKCE POSTAVENÁ
// Přihláška je to nejcennější, co sem přijde. Když se nepovede poslat e-mail,
// vyrobit QR kód nebo zavolat fakturaci, přihláška se PŘESTO uloží a člověk
// dostane svůj variabilní symbol. Zaznamená se to do logu a dořeší se ručně.
// Ztratit přihlášku kvůli tomu, že zrovna nejede pošta, by bylo mnohem horší
// než poslat potvrzení se zpožděním.
//
// Naopak validace je přísná a dělá se TADY. Kontrola ve formuláři je jen
// zdvořilost k návštěvníkovi — kdokoli může poslat požadavek přímo a obejít
// ji, takže se na ni nespoléhá ani v jednom poli.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { sestavSpayd } from '../_shared/spayd.ts';
import { vytvorQrPng } from '../_shared/qr.ts';
import { nactiNastaveniGmailu, odesliEmail } from '../_shared/gmail.ts';

// ---------------------------------------------------------------------------
// NASTAVENÍ
// ---------------------------------------------------------------------------

/** Účastnický poplatek v korunách. */
const CASTKA_KC = Number(Deno.env.get('CASTKA_KC') ?? '500');

/** Za kolik dní od přihlášení má být zaplaceno. */
const SPLATNOST_DNI = Number(Deno.env.get('SPLATNOST_DNI') ?? '7');

/** Bucket v úložišti, kam se ukládají obrázky QR kódů. */
const BUCKET_QR = 'qr';

/**
 * Spočítá datum splatnosti.
 *
 * Počítá se v českém čase schválně. Server běží v UTC, takže přihláška
 * odeslaná v deset večer by se jinak počítala už od dalšího dne a splatnost
 * by seděla o den vedle proti tomu, co má člověk na hodinkách.
 *
 * @returns Datum ve dvou tvarech: `iso` pro platební řetězec (2026-08-19)
 *          a `cesky` do textu e-mailu (19. 8. 2026).
 */
function datumSplatnosti(): { iso: string; cesky: string } {
  const den = new Date(Date.now() + SPLATNOST_DNI * 24 * 60 * 60 * 1000);
  return {
    // Švédský formát dává rovnou YYYY-MM-DD, což je přesně, co potřebujeme.
    iso: den.toLocaleDateString('sv-SE', { timeZone: 'Europe/Prague' }),
    cesky: den.toLocaleDateString('cs-CZ', { timeZone: 'Europe/Prague' }),
  };
}

/**
 * Odkud smí formulář volat. Prázdné = odkudkoli.
 * Víc adres se odděluje čárkou, například:
 *   https://aktivne-spolu.cz,https://www.aktivne-spolu.cz
 */
function povoleneOriginy(): string[] {
  return (Deno.env.get('POVOLENE_ORIGINY') ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

/**
 * Hlavičky CORS. Bez nich prohlížeč požadavek z aktivne-spolu.cz na doménu
 * Supabase vůbec neodešle.
 */
function hlavickyCors(req: Request): Record<string, string> {
  const povolene = povoleneOriginy();
  const origin = req.headers.get('Origin') ?? '';

  let povolenyOrigin = '*';
  if (povolene.length > 0) {
    povolenyOrigin = povolene.includes(origin) ? origin : povolene[0];
  }

  return {
    'Access-Control-Allow-Origin': povolenyOrigin,
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function odpoved(req: Request, telo: unknown, stav = 200): Response {
  return new Response(JSON.stringify(telo), {
    status: stav,
    headers: { ...hlavickyCors(req), 'Content-Type': 'application/json; charset=utf-8' },
  });
}

// ---------------------------------------------------------------------------
// ČÍSELNÍKY
// ---------------------------------------------------------------------------
// Musí sedět s podmínkami v migraci. Kdyby se rozešly, databáze zápis odmítne
// a člověk uvidí nesrozumitelnou chybu místo srozumitelné hlášky z formuláře.

const TYPY_PORADATELE = ['skola', 'organizace', 'jednotlivec'] as const;
const FORMY_PLATBY = ['qr', 'prevod'] as const;

/**
 * Je datum konání povinné?
 *
 * TOHLE JE MÍSTO, KDE SE POVINNOST PŘEPÍNÁ NA SERVERU. Druhé (a poslední)
 * místo je `DATUM_JE_POVINNE` v src/lib/datumAkce.ts, odkud ho berou oba
 * formuláře. V databázi se měnit nemusí nic — sloupec `datum_akce` je
 * schválně nullable, aby přepnutí nepotřebovalo migraci.
 *
 * Proč je povinné: podle sekce „Jak to funguje" si pořadatel domlouvá termín
 * se seniorským místem dřív, než se registruje, takže datum v tu chvíli zná.
 */
const DATUM_JE_POVINNE = true;

/**
 * Rozmezí, ve kterém se akce konají. Ročník 2026.
 *
 * Široké schválně — celé září a říjen. Akce mají probíhat v týdnu kolem
 * 1. října, ale kdo se se seniorským místem domluví až na 5. října, do
 * projektu patří stejně. Kontrola je pojistka proti překlepu v roce, ne
 * nástroj na vymáhání termínu; doporučený termín je jen nápověda ve formuláři.
 *
 * Musí sedět s podmínkou `prihlasky_datum_akce_obdobi` v migraci
 * 20260814120000_datum_akce.sql a s `src/lib/datumAkce.ts`. Kdyby se rozešly,
 * databáze by zápis odmítla a člověk by uviděl nesrozumitelnou chybu místo
 * srozumitelné hlášky u pole.
 */
const OBDOBI_OD = '2026-09-01';
const OBDOBI_DO = '2026-10-31';
const KRAJE = [
  'Praha',
  'Středočeský',
  'Jihočeský',
  'Plzeňský',
  'Karlovarský',
  'Ústecký',
  'Liberecký',
  'Královéhradecký',
  'Pardubický',
  'Vysočina',
  'Jihomoravský',
  'Olomoucký',
  'Zlínský',
  'Moravskoslezský',
] as const;

// ---------------------------------------------------------------------------
// VALIDACE
// ---------------------------------------------------------------------------

/** Chyby po jednotlivých polích, ať formulář ví, co červeně zvýraznit. */
type Chyby = Record<string, string>;

function text(hodnota: unknown): string {
  return typeof hodnota === 'string' ? hodnota.trim() : '';
}

/**
 * Kontrola e-mailu. Schválně volná — jediná stoprocentní kontrola je poslat
 * na adresu zprávu. Chytá překlepy typu chybějící zavináč nebo tečka na konci,
 * ale neodmítne platnou adresu jen proto, že vypadá neobvykle.
 */
function jeEmail(hodnota: string): boolean {
  if (hodnota.length > 254) return false;
  return /^[^\s@,;]+@[^\s@,;.]+(\.[^\s@,;.]+)+$/.test(hodnota);
}

/**
 * Kontrola telefonu. Mezery, lomítka a závorky se ignorují, protože lidé
 * si čísla píší každý jinak. Zbýt musí 9 až 15 číslic (české číslo i s
 * předvolbou, případně zahraniční).
 */
function jeTelefon(hodnota: string): boolean {
  const cislice = hodnota.replace(/[\s\-/().]/g, '').replace(/^\+/, '');
  return /^[0-9]{9,15}$/.test(cislice);
}

/**
 * Datum v českém tvaru: `2026-10-01` → `1. 10. 2026`.
 *
 * Skládá se z částí zapsaného řetězce, ne přes `new Date()`. Server běží
 * v UTC a `new Date('2026-10-01')` je půlnoc UTC — po převodu do jiného pásma
 * by v e-mailu svítil 30. 9., tedy den, který nikdo nevyplnil.
 */
function datumCesky(iso: string): string {
  const casti = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!casti) return iso;
  return `${Number(casti[3])}. ${Number(casti[2])}. ${casti[1]}`;
}

/** Rozmezí česky do chybové hlášky: „od 1. 9. 2026 do 31. 10. 2026". */
function obdobiCesky(): string {
  return `od ${datumCesky(OBDOBI_OD)} do ${datumCesky(OBDOBI_DO)}`;
}

/**
 * Kontrola data konání akce. Dělá se TADY a nezávisle na formuláři —
 * požadavek může přijít i mimo prohlížeč a klientské kontrole se nevěří.
 *
 * Hlášky jsou schválně TŘI RŮZNÉ a každá říká něco jiného. „Zkontrolujte
 * datum" by člověku neporadilo nic: musí být poznat, jestli pole zapomněl,
 * jestli je v něm nesmysl, nebo jestli je jen mimo období akce.
 *
 * @returns `null` když je datum v pořádku, jinak celou českou větu k poli.
 */
function zkontrolujDatum(hodnota: string): string | null {
  if (!hodnota) {
    return DATUM_JE_POVINNE ? 'Vyplňte datum, kdy se akce bude konat.' : null;
  }

  const casti = /^(\d{4})-(\d{2})-(\d{2})$/.exec(hodnota);
  if (!casti) {
    return 'Datum nemá správný tvar. Vyberte ho prosím z kalendáře, například 1. 10. 2026.';
  }

  // 31. února má správný tvar, ale je to neexistující den. Z kalendáře ho
  // vybrat nejde, ručně zapsat ano.
  const rok = Number(casti[1]);
  const mesic = Number(casti[2]);
  const den = Number(casti[3]);
  const zkouska = new Date(Date.UTC(rok, mesic - 1, den));
  if (
    zkouska.getUTCFullYear() !== rok ||
    zkouska.getUTCMonth() !== mesic - 1 ||
    zkouska.getUTCDate() !== den
  ) {
    return 'Takový den neexistuje. Vyberte prosím datum z kalendáře.';
  }

  // Porovnání řetězců stačí — tvar RRRR-MM-DD se řadí stejně jako datum.
  if (hodnota < OBDOBI_OD || hodnota > OBDOBI_DO) {
    return `Datum je mimo období akce. Setkání se konají v týdnu kolem 1. 10., vyberte prosím datum ${obdobiCesky()}.`;
  }

  return null;
}

interface Prihlaska {
  typ_poradatele: string;
  nazev_poradatele: string;
  kontaktni_osoba: string;
  email: string;
  telefon: string;
  mesto: string;
  kraj: string;
  /** Den konání ve tvaru RRRR-MM-DD. `null` jen kdyby pole bylo nepovinné. */
  datum_akce: string | null;
  napad_na_aktivitu: string | null;
  forma_platby: string;
  fakt_nazev: string | null;
  fakt_adresa: string | null;
  fakt_ic: string | null;
  fakt_dic: string | null;
  souhlas_gdpr: boolean;
}

/**
 * Zkontroluje a připraví data k uložení.
 * @returns Buď hotová přihláška, nebo seznam chyb po polích.
 */
function zkontroluj(vstup: Record<string, unknown>): { data: Prihlaska } | { chyby: Chyby } {
  const chyby: Chyby = {};

  const typ_poradatele = text(vstup.typ_poradatele);
  if (!TYPY_PORADATELE.includes(typ_poradatele as typeof TYPY_PORADATELE[number])) {
    chyby.typ_poradatele = 'Vyberte, kdo akci pořádá.';
  }

  const nazev_poradatele = text(vstup.nazev_poradatele);
  if (!nazev_poradatele) chyby.nazev_poradatele = 'Vyplňte název školy, organizace nebo své jméno.';
  else if (nazev_poradatele.length > 200) chyby.nazev_poradatele = 'Název je moc dlouhý (nejvýš 200 znaků).';

  const kontaktni_osoba = text(vstup.kontaktni_osoba);
  if (!kontaktni_osoba) chyby.kontaktni_osoba = 'Vyplňte, s kým se máme spojit.';
  else if (kontaktni_osoba.length > 200) chyby.kontaktni_osoba = 'Jméno je moc dlouhé (nejvýš 200 znaků).';

  const email = text(vstup.email);
  if (!email) chyby.email = 'Vyplňte e-mail. Pošleme na něj potvrzení.';
  else if (!jeEmail(email)) chyby.email = 'Tenhle e-mail nevypadá správně. Zkontrolujte překlep.';

  const telefon = text(vstup.telefon);
  if (!telefon) chyby.telefon = 'Vyplňte telefon.';
  else if (!jeTelefon(telefon)) chyby.telefon = 'Telefon nevypadá správně. Napište devět číslic, případně i s předvolbou.';

  const mesto = text(vstup.mesto);
  if (!mesto) chyby.mesto = 'Vyplňte město nebo obec.';
  else if (mesto.length > 120) chyby.mesto = 'Název města je moc dlouhý (nejvýš 120 znaků).';

  const kraj = text(vstup.kraj);
  if (!kraj) chyby.kraj = 'Vyberte kraj.';
  else if (!KRAJE.includes(kraj as typeof KRAJE[number])) chyby.kraj = 'Tenhle kraj neznáme. Vyberte ze seznamu.';

  // Datum konání. Chyba se hlásí u pole `datum_akce`, ať ji formulář umí
  // ukázat přímo pod ním a nemusí ji lepit do souhrnu.
  const datumZapsany = text(vstup.datum_akce);
  const chybaData = zkontrolujDatum(datumZapsany);
  if (chybaData) chyby.datum_akce = chybaData;
  const datum_akce = datumZapsany || null;

  const napadRaw = text(vstup.napad_na_aktivitu);
  if (napadRaw.length > 2000) chyby.napad_na_aktivitu = 'Nápad je moc dlouhý (nejvýš 2000 znaků).';
  const napad_na_aktivitu = napadRaw || null; // nepovinné

  const forma_platby = text(vstup.forma_platby);
  if (!FORMY_PLATBY.includes(forma_platby as typeof FORMY_PLATBY[number])) {
    chyby.forma_platby = 'Vyberte, jak chcete zaplatit.';
  }

  // Fakturační údaje jen u převodu. U QR platby se zahodí, i kdyby přišly —
  // není důvod držet v databázi údaje, o které si nikdo neřekl.
  let fakt_nazev: string | null = null;
  let fakt_adresa: string | null = null;
  let fakt_ic: string | null = null;
  let fakt_dic: string | null = null;

  if (forma_platby === 'prevod') {
    fakt_nazev = text(vstup.fakt_nazev) || null;
    fakt_adresa = text(vstup.fakt_adresa) || null;
    fakt_ic = text(vstup.fakt_ic).replace(/\s+/g, '') || null;
    fakt_dic = text(vstup.fakt_dic).replace(/\s+/g, '').toUpperCase() || null;

    if (!fakt_nazev) chyby.fakt_nazev = 'Vyplňte název na faktuře.';
    if (!fakt_adresa) chyby.fakt_adresa = 'Vyplňte fakturační adresu.';
    if (!fakt_ic) chyby.fakt_ic = 'Vyplňte IČO.';
    else if (!/^[0-9]{8}$/.test(fakt_ic)) chyby.fakt_ic = 'IČO má osm číslic.';
    // DIČ je nepovinné — spousta škol a spolků plátcem DPH není.
    if (fakt_dic && !/^[A-Z]{2}[0-9A-Z]{8,12}$/.test(fakt_dic)) {
      chyby.fakt_dic = 'DIČ nevypadá správně, například CZ12345678.';
    }
  }

  // Bez souhlasu se nesmí uložit nic. Hlídá to i databáze, ale sem patří
  // srozumitelná hláška.
  // Zaškrtávací pole dorazí v různých tvarech podle toho, jak ho formulář
  // odešle — jako pravdivostní hodnota, nebo jako text. U nezaškrtnutého
  // pole prohlížeč neposílá nic, takže cokoliv mimo tenhle seznam
  // znamená "nesouhlasí".
  const souhlas_gdpr =
    vstup.souhlas_gdpr === true ||
    ['true', 'ano', 'on', '1'].includes(String(vstup.souhlas_gdpr).toLowerCase());
  if (!souhlas_gdpr) chyby.souhlas_gdpr = 'Bez souhlasu se zpracováním údajů přihlášku bohužel přijmout nemůžeme.';

  if (Object.keys(chyby).length > 0) return { chyby };

  return {
    data: {
      typ_poradatele,
      nazev_poradatele,
      kontaktni_osoba,
      email,
      telefon,
      mesto,
      kraj,
      datum_akce,
      napad_na_aktivitu,
      forma_platby,
      fakt_nazev,
      fakt_adresa,
      fakt_ic,
      fakt_dic,
      souhlas_gdpr,
    },
  };
}

// ---------------------------------------------------------------------------
// QR KÓD PLATBY
// ---------------------------------------------------------------------------

/**
 * Vyrobí QR kód platby a uloží ho do úložiště.
 *
 * @returns Veřejná adresa obrázku, nebo `null` když QR udělat nejde
 *          (chybí číslo účtu, nesedí IBAN, nepovedlo se nahrání).
 *          `null` NENÍ důvod přihlášku zamítnout — člověk dostane údaje
 *          k platbě textem a peníze pošle ručně.
 */
async function pripravQr(
  // deno-lint-ignore no-explicit-any
  klient: any,
  variabilniSymbol: number,
  splatnostIso: string,
): Promise<{ url: string | null; spayd: string | null }> {
  const iban = Deno.env.get('IBAN_UCTU');
  if (!iban) {
    console.warn('QR přeskočeno: chybí nastavení IBAN_UCTU.');
    return { url: null, spayd: null };
  }

  // Zpráva pro příjemce. Variabilní symbol se přidává schválně i sem —
  // kdyby se cestou ztratil (některé banky ho u QR plateb nepřenesou),
  // dá se platba spárovat aspoň podle poznámky.
  //
  // Bez háčků a bez hvězdiček. Hvězdička odděluje pole platebního řetězce
  // a diakritiku bankovní aplikace často nezobrazí — hlídá to `ocistiZpravu`
  // ve spayd.ts, ale nemá smysl jí to schválně posílat rozbité.
  const zaklad = Deno.env.get('ZPRAVA_PLATBY') ?? 'AKTIVNE SPOLU';

  const spayd = sestavSpayd({
    iban,
    swift: Deno.env.get('SWIFT_UCTU') ?? null,
    castka: CASTKA_KC,
    mena: 'CZK',
    variabilniSymbol,
    splatnost: splatnostIso,
    prijemce: Deno.env.get('NAZEV_PRIJEMCE') ?? null,
    zprava: `${zaklad} ${variabilniSymbol}`,
  });

  if (!spayd) {
    console.warn('QR přeskočeno: číslo účtu v IBAN_UCTU neprošlo kontrolou.');
    return { url: null, spayd: null };
  }

  try {
    const png = vytvorQrPng(spayd);
    const cesta = `platba-${variabilniSymbol}.png`;

    const { error } = await klient.storage.from(BUCKET_QR).upload(cesta, png, {
      contentType: 'image/png',
      upsert: true,
      cacheControl: '31536000', // obrázek se nikdy nemění, ať se nestahuje pořád dokola
    });
    if (error) throw error;

    const { data } = klient.storage.from(BUCKET_QR).getPublicUrl(cesta);
    return { url: data?.publicUrl ?? null, spayd };
  } catch (e) {
    console.error('QR se nepovedlo uložit:', e);
    return { url: null, spayd };
  }
}

// ---------------------------------------------------------------------------
// POTVRZOVACÍ E-MAIL
// ---------------------------------------------------------------------------

/** Čísla se v textu píšou s mezerou po tisících, ať se dobře čtou. */
function castkaSlovy(castka: number): string {
  return castka.toLocaleString('cs-CZ');
}

interface UdajePlatby {
  /** Číslo účtu v tuzemském tvaru — lidé ho opisují častěji než IBAN. */
  cisloUctu: string;
  /** IBAN jako doplněk, hlavně kvůli platbám ze zahraničí. */
  iban: string | null;
  /** Datum splatnosti česky, například 19. 8. 2026. */
  splatnost: string;
}

function textEmailu(
  p: Prihlaska,
  vs: number,
  u: UdajePlatby,
  qrUrl: string | null,
): string {
  const radky = [
    `Dobrý den, ${p.kontaktni_osoba},`,
    '',
    'děkujeme za přihlášku. Máme ji u sebe a počítáme s vámi.',
  ];

  // Datum česky, nikdy ve tvaru 2026-10-01. Píšeme ho i proto, aby si člověk
  // hned všiml, kdyby v kalendáři omylem klikl na jiný den, než chtěl.
  if (p.datum_akce) {
    radky.push(
      '',
      `Vaše setkání máme zapsané na ${datumCesky(p.datum_akce)}.`,
      'Kdyby se termín změnil, stačí nám odpovědět na tenhle e-mail.',
    );
  }

  radky.push(
    '',
    `Zbývá zaplatit účastnický poplatek, a to do ${u.splatnost}:`,
    '',
    `  Částka:             ${castkaSlovy(CASTKA_KC)} Kč`,
    `  Číslo účtu:         ${u.cisloUctu}`,
    `  Variabilní symbol:  ${vs}`,
    `  Splatnost:          ${u.splatnost}`,
  );

  if (u.iban) radky.push(`  IBAN (ze zahraničí): ${u.iban}`);

  radky.push(
    '',
    'Variabilní symbol prosím nevynechávejte — podle něj platbu poznáme.',
  );

  if (qrUrl) {
    radky.push(
      '',
      'Nejrychleji zaplatíte přes QR kód. Otevřete si tenhle obrázek',
      'a načtěte ho v mobilní bance:',
      qrUrl,
      '',
      'Částka i variabilní symbol se vyplní samy.',
    );
  }

  if (p.forma_platby === 'prevod') {
    // Číslo faktury končí variabilním symbolem (26/03/100001). Píšeme to sem
    // schválně: až faktura přijde, člověk v ní pozná svoje číslo a nemusí
    // dohledávat, jestli patří k jeho platbě.
    radky.push(
      '',
      'Fakturu vám pošleme e-mailem, jakmile ji vystavíme.',
      `Její číslo bude končit vaším variabilním symbolem ${vs}, ať se to nedá splést.`,
    );
  }

  radky.push(
    '',
    'Kdyby cokoli nebylo jasné, stačí na tenhle e-mail odpovědět.',
    '',
    'Ať se akce vydaří!',
  );

  return radky.join('\n');
}

function htmlEmailu(
  p: Prihlaska,
  vs: number,
  u: UdajePlatby,
  qrUrl: string | null,
): string {
  // Šablona je schválně jednoduchá: tabulky a řádkové styly. Poštovní
  // programy si s modernějším HTML neporadí a rozsypalo by se to.
  const e = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const qrBlok = qrUrl
    ? `
      <p style="margin:24px 0 8px;">Nejrychleji zaplatíte přes QR kód — načtěte ho v mobilní bance,
      částka i variabilní symbol se vyplní samy.</p>
      <p style="margin:0;"><img src="${e(qrUrl)}" width="220" height="220"
        alt="QR kód platby, variabilní symbol ${vs}"
        style="display:block;border:1px solid #e5e5e5;"></p>`
    : '';

  // Datum česky, nikdy ve tvaru 2026-10-01. Píšeme ho i proto, aby si člověk
  // hned všiml, kdyby v kalendáři omylem klikl na jiný den, než chtěl.
  const terminBlok = p.datum_akce
    ? `<p style="margin:0 0 16px;">Vaše setkání máme zapsané na <strong>${e(datumCesky(p.datum_akce))}</strong>.
       Kdyby se termín změnil, stačí nám odpovědět na tenhle e-mail.</p>`
    : '';

  const fakturaBlok = p.forma_platby === 'prevod'
    ? `<p style="margin:24px 0 0;">Fakturu vám pošleme e-mailem, jakmile ji vystavíme.
       Její číslo bude končit vaším variabilním symbolem <strong>${vs}</strong>, ať se to nedá splést.</p>`
    : '';

  return `<!doctype html>
<html lang="cs"><body style="margin:0;padding:24px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#1a1a1a;">
  <p style="margin:0 0 16px;">Dobrý den, ${e(p.kontaktni_osoba)},</p>
  <p style="margin:0 0 16px;">děkujeme za přihlášku. Máme ji u sebe a počítáme s vámi.</p>
  ${terminBlok}
  <p style="margin:0 0 8px;">Zbývá zaplatit účastnický poplatek, a to do <strong>${e(u.splatnost)}</strong>:</p>
  <table cellpadding="6" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 0 8px;">
    <tr><td style="color:#555;">Částka</td><td><strong>${castkaSlovy(CASTKA_KC)} Kč</strong></td></tr>
    <tr><td style="color:#555;">Číslo účtu</td><td><strong>${e(u.cisloUctu)}</strong></td></tr>
    <tr><td style="color:#555;">Variabilní symbol</td><td><strong>${vs}</strong></td></tr>
    <tr><td style="color:#555;">Splatnost</td><td><strong>${e(u.splatnost)}</strong></td></tr>
    ${u.iban ? `<tr><td style="color:#555;">IBAN (ze zahraničí)</td><td>${e(u.iban)}</td></tr>` : ''}
  </table>
  <p style="margin:0;">Variabilní symbol prosím nevynechávejte — podle něj platbu poznáme.</p>
  ${qrBlok}
  ${fakturaBlok}
  <p style="margin:24px 0 0;">Kdyby cokoli nebylo jasné, stačí na tenhle e-mail odpovědět.</p>
  <p style="margin:16px 0 0;">Ať se akce vydaří!</p>
</body></html>`;
}

/**
 * Pošle potvrzení. Nikdy nevyhodí výjimku — nefungující pošta nesmí shodit
 * přihlášku. Když se to nepovede, zůstane to v logu a e-mail se pošle ručně.
 */
async function posliPotvrzeni(
  p: Prihlaska,
  vs: number,
  qrUrl: string | null,
  splatnostCesky: string,
): Promise<boolean> {
  const nastaveni = nactiNastaveniGmailu();
  if (!nastaveni) {
    console.warn(`E-mail přeskočen: chybí nastavení odesílání. Přihláška VS ${vs} je uložená.`);
    return false;
  }

  const iban = Deno.env.get('IBAN_UCTU') ?? null;

  // Na prvním místě je číslo účtu v tuzemském tvaru — to lidé opisují do
  // internetového bankovnictví. IBAN je vedle jen jako doplněk. Když tuzemské
  // číslo nikdo nevyplnil, použije se IBAN, ať v e-mailu není prázdno.
  const u: UdajePlatby = {
    cisloUctu: Deno.env.get('CISLO_UCTU') ?? iban ?? '',
    iban,
    splatnost: splatnostCesky,
  };

  try {
    const id = await odesliEmail(nastaveni, {
      prijemce: p.email,
      prijemceJmeno: p.kontaktni_osoba,
      predmet: `Přihláška přijata — variabilní symbol ${vs}`,
      text: textEmailu(p, vs, u, qrUrl),
      html: htmlEmailu(p, vs, u, qrUrl),
    });
    console.log(`Potvrzení odesláno, VS ${vs}, zpráva ${id}.`);
    return true;
  } catch (e) {
    console.error(`Potvrzení se nepovedlo odeslat, VS ${vs}. Přihláška je uložená.`, e);
    return false;
  }
}

// ---------------------------------------------------------------------------
// PŘEDÁNÍ DO FAKTURACE
// ---------------------------------------------------------------------------

/**
 * Ozve se do fakturace, že přibyla přihláška.
 *
 * Krok je nepovinný ve dvou směrech: když adresa není nastavená, přeskočí se
 * úplně, a když volání selže, jen se to zapíše do logu. Přihláška je hotová
 * tak jako tak.
 */
async function ozviSeDoFakturace(telo: unknown): Promise<void> {
  const adresa = (Deno.env.get('MAKE_WEBHOOK_URL') ?? '').trim();
  if (!adresa) return; // není nastavené — v pořádku, fakturace se řeší jinak

  try {
    const odpovedFakturace = await fetch(adresa, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(telo),
      signal: AbortSignal.timeout(8000), // ať návštěvník nečeká na cizí server
    });
    if (!odpovedFakturace.ok) {
      console.error(`Fakturace odpověděla ${odpovedFakturace.status}. Přihláška je uložená.`);
    }
  } catch (e) {
    console.error('Fakturaci se nepovedlo zavolat. Přihláška je uložená.', e);
  }
}

// ---------------------------------------------------------------------------
// HLAVNÍ OBSLUHA
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  // Prohlížeč se nejdřív zeptá, jestli smí poslat data z jiné domény.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: hlavickyCors(req) });
  }

  if (req.method !== 'POST') {
    return odpoved(req, { ok: false, chyba: 'Tenhle odkaz přijímá jen odeslaný formulář.' }, 405);
  }

  let vstup: Record<string, unknown>;
  try {
    vstup = (await req.json()) as Record<string, unknown>;
    if (!vstup || typeof vstup !== 'object') throw new Error('není objekt');
  } catch {
    return odpoved(req, { ok: false, chyba: 'Data formuláře se nepodařilo přečíst.' }, 400);
  }

  // PAST NA ROBOTY
  // Ve formuláři je skryté pole „web", které živý člověk nikdy nevyplní —
  // nevidí ho. Automat, který vyplňuje všechno, se do něj chytí.
  //
  // Odpověď je schválně úplně obyčejné „v pořádku". Kdyby robot dostal chybu,
  // jeho autor by past objevil a příště ji obešel. Takhle si myslí, že
  // uspěl — a přitom se neuložilo nic a nespotřeboval se ani variabilní symbol.
  if (text(vstup.web).length > 0) {
    console.log('Zachyceno pastí na roboty, neukládá se nic.');
    return odpoved(req, { ok: true, variabilni_symbol: null, qr_url: null });
  }

  const vysledek = zkontroluj(vstup);
  if ('chyby' in vysledek) {
    return odpoved(req, {
      ok: false,
      chyba: 'Ve formuláři je potřeba něco doplnit nebo opravit.',
      chyby: vysledek.chyby,
    }, 400);
  }
  const data = vysledek.data;

  const klient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  // VARIABILNÍ SYMBOL
  // Bere se výhradně z databázové sekvence. Kdyby se počítal tady (třeba
  // „poslední + 1" nebo z času), dvě přihlášky odeslané ve stejnou vteřinu
  // by dostaly stejné číslo a platby by se nedaly rozeznat.
  const { data: vsData, error: vsChyba } = await klient.rpc('dalsi_variabilni_symbol');
  if (vsChyba || vsData === null || vsData === undefined) {
    console.error('Nepovedlo se přidělit variabilní symbol:', vsChyba);
    return odpoved(req, {
      ok: false,
      chyba: 'Přihlášku se teď nepodařilo uložit. Zkuste to prosím za chvíli znovu.',
    }, 503);
  }
  const variabilniSymbol = Number(vsData);

  // ULOŽENÍ
  const { data: ulozeno, error: chybaUlozeni } = await klient
    .from('prihlasky')
    .insert({ ...data, variabilni_symbol: variabilniSymbol })
    .select('id, variabilni_symbol')
    .single();

  if (chybaUlozeni || !ulozeno) {
    console.error('Uložení přihlášky selhalo:', chybaUlozeni);
    return odpoved(req, {
      ok: false,
      chyba: 'Přihlášku se nepodařilo uložit. Zkuste to prosím znovu, nebo nám napište.',
    }, 500);
  }

  // Od téhle chvíle je přihláška v databázi a nic už nesmí skončit chybou
  // pro návštěvníka. Všechno další je „hezké mít".
  const splatnost = datumSplatnosti();

  const { url: qrUrl, spayd } = await pripravQr(klient, variabilniSymbol, splatnost.iso);
  const emailOdeslan = await posliPotvrzeni(data, variabilniSymbol, qrUrl, splatnost.cesky);

  await ozviSeDoFakturace({
    id: ulozeno.id,
    variabilni_symbol: variabilniSymbol,
    castka_kc: CASTKA_KC,
    splatnost: splatnost.iso,
    ...data,
    qr_url: qrUrl,
    spayd,
    email_odeslan: emailOdeslan,
  });

  return odpoved(req, {
    ok: true,
    variabilni_symbol: variabilniSymbol,
    qr_url: qrUrl,
  });
});
