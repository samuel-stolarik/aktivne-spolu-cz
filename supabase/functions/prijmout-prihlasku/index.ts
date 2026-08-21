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
import { vytvorFakturuPdf } from '../_shared/faktura.ts';
import { kdoOdesila, posli } from '../_shared/posta.ts';

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
const FORMY_PLATBY = ['qr', 'prevod', 'neprispivam'] as const;

/**
 * Dobrovolný příspěvek u jednotlivců.
 *
 * Jednotlivec registrační poplatek platit NEMUSÍ — buď přispěje částkou,
 * kterou si sám vybere, nebo nepřispěje vůbec. Škol a organizací se to
 * netýká, těm zůstává poplatek 500 Kč.
 *
 * Spodní hranice je proto, aby se za pár korun negeneroval QR kód, který
 * bance stojí za víc než ten příspěvek. Horní je proti překlepu: kdo omylem
 * napíše o tři nuly víc, zjistí to jinak až v bankovní aplikaci.
 *
 * Obě čísla MUSÍ sedět s podmínkou `prihlasky_platba_podle_typu` v migraci.
 */
const PRISPEVEK_NEJMENE_KC = 100;
const PRISPEVEK_NEJVICE_KC = 100000;

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
  /** Kolik se má zaplatit. 500 u škol a firem, u jednotlivce jeho volba nebo 0. */
  castka_kc: number;
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

  // ------------------------------------------------------------------------
  // Platba a částka
  //
  // Rozhoduje TYP POŘADATELE, ne to, co přišlo z formuláře. Kdyby si někdo
  // upravil stránku a poslal za školu „nepřispívám" nebo za jednotlivce
  // padesát korun, skončí to tady — a kdyby náhodou ne, chytne to podmínka
  // v databázi (prihlasky_platba_podle_typu).
  //
  // Částka se u škol a organizací z formuláře NEBERE VŮBEC. Je to pevný
  // poplatek; přijímat na něj číslo z prohlížeče by znamenalo, že si každý
  // může poslat, kolik chce.
  // ------------------------------------------------------------------------
  const jednotlivec = typ_poradatele === 'jednotlivec';
  const forma_platby = text(vstup.forma_platby);
  let castka_kc = CASTKA_KC;

  if (!FORMY_PLATBY.includes(forma_platby as typeof FORMY_PLATBY[number])) {
    chyby.forma_platby = jednotlivec
      ? 'Vyberte, jestli chcete přispět.'
      : 'Vyberte, jak chcete zaplatit.';
  } else if (jednotlivec) {
    if (forma_platby === 'prevod') {
      // Dobrovolný příspěvek není úhrada služby, takže se na něj nevystavuje
      // faktura. Formulář tuhle možnost jednotlivci ani nenabízí.
      chyby.forma_platby = 'Na dobrovolný příspěvek fakturu nevystavujeme.';
    } else if (forma_platby === 'neprispivam') {
      castka_kc = 0;
    } else if (text(vstup.castka_kc) === '') {
      // Starší verze formuláře se na částku vůbec neptají a jednotlivci
      // v nich vybírají jen mezi QR a převodem. Chybějící pole proto NENÍ
      // chyba — platí výchozí poplatek. Kdyby se místo toho hlásila chyba,
      // přestaly by ty stránky přijímat přihlášky od jednotlivců a nikdo
      // by nevěděl proč.
      castka_kc = CASTKA_KC;
    } else {
      const zadano = Number(text(vstup.castka_kc));
      if (!Number.isInteger(zadano)) {
        chyby.castka_kc = 'Vyberte částku, kterou chcete přispět.';
      } else if (zadano < PRISPEVEK_NEJMENE_KC) {
        chyby.castka_kc = `Nejnižší příspěvek je ${PRISPEVEK_NEJMENE_KC} Kč.`;
      } else if (zadano > PRISPEVEK_NEJVICE_KC) {
        chyby.castka_kc = 'Tak vysokou částku raději domluvme osobně, napište nám.';
      } else {
        castka_kc = zadano;
      }
    }
  } else if (forma_platby === 'neprispivam') {
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
      castka_kc,
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
  castka: number,
  jeDobrovolny: boolean,
): Promise<{ url: string | null; spayd: string | null }> {
  // Kdo nepřispívá, nemá co platit — QR kód by byl na nulu.
  if (castka <= 0) return { url: null, spayd: null };

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
  //
  // U jednotlivce se zpráva liší schválně. V bance pak na výpisu stojí
  // „DOBROVOLNY PRISPEVEK", ne „registrační poplatek" — a to je rozdíl,
  // který zajímá účetní: příspěvek je dar, poplatek je úhrada služby.
  // Kdyby na výpisu stálo u obojího totéž, muselo by se to párovat ručně.
  const zaklad = jeDobrovolny
    ? 'DOBROVOLNY PRISPEVEK'
    : Deno.env.get('ZPRAVA_PLATBY') ?? 'AKTIVNE SPOLU';

  const spayd = sestavSpayd({
    iban,
    swift: Deno.env.get('SWIFT_UCTU') ?? null,
    castka,
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
/**
 * Ošetří text, který jde do HTML e-mailu.
 *
 * Jména a adresy píšou lidé a může v nich být cokoli — apostrof, ampersand,
 * špičatá závorka. Bez tohohle by se z „Škola & spol." rozsypal zbytek
 * zprávy. Dřív to bylo schované uvnitř skládání e-mailu; teď je to venku,
 * protože to potřebují dvě místa.
 */
function e(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Čitelné názvy typů pořadatele do shrnutí v e-mailu. */
const TYP_TEXT: Record<string, string> = {
  skola: 'Škola nebo školka',
  organizace: 'Organizace nebo firma',
  jednotlivec: 'Jednotlivec',
};

const DODAVATEL = Deno.env.get('DODAVATEL_NAZEV') ?? 'Právě teď! o.p.s.';
const WEB = Deno.env.get('DODAVATEL_WEB') ?? 'www.pravetedops.cz';
const KONTAKT_EMAIL = Deno.env.get('DODAVATEL_EMAIL') ?? '';
const KONTAKT_TELEFON = Deno.env.get('DODAVATEL_TELEFON') ?? '';
const VETA_DPH = Deno.env.get('FAKTURA_VETA_DPH') ??
  'Právě teď! o.p.s. není plátcem DPH a nemá přiděleno DIČ. ' +
  'Fakturovaná částka je konečná, daň se neuplatňuje.';

/**
 * Zpráva pro příjemce platby. U dobrovolného příspěvku jednotlivce je jiná —
 * účetní pak na bankovním výpisu pozná dar od registračního poplatku.
 * Musí sedět s tím, co jde do QR kódu (viz pripravQr).
 */
function zpravaProBanku(p: Prihlaska, vs: number): string {
  const zaklad = p.typ_poradatele === 'jednotlivec'
    ? 'DOBROVOLNY PRISPEVEK'
    : Deno.env.get('ZPRAVA_PLATBY') ?? 'AKTIVNE SPOLU';
  return `${zaklad} ${vs}`;
}

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

  // Kdo nepřispívá, nemá co platit — celý platební blok se vynechá.
  // Posílat mu údaje k platbě by znamenalo tvrdit mu, že něco dluží.
  if (p.castka_kc <= 0) {
    radky.push(
      '',
      'Nic platit nemusíte — přihláška je hotová.',
      'Kdybyste nás přece jen chtěli podpořit, ozvěte se a rádi pošleme údaje.',
    );
  } else {
    const jeDobrovolny = p.typ_poradatele === 'jednotlivec';
    radky.push(
      '',
      jeDobrovolny
        ? `Váš dobrovolný příspěvek můžete poslat do ${u.splatnost}:`
        : `Zbývá zaplatit účastnický poplatek, a to do ${u.splatnost}:`,
      '',
      `  Částka:             ${castkaSlovy(p.castka_kc)} Kč`,
      `  Číslo účtu:         ${u.cisloUctu}`,
      `  Variabilní symbol:  ${vs}`,
      `  Splatnost:          ${u.splatnost}`,
    );
  }

  if (p.castka_kc > 0) {
    if (u.iban) radky.push(`  IBAN (ze zahraničí): ${u.iban}`);

    radky.push(
      '',
      'Variabilní symbol prosím nevynechávejte — podle něj platbu poznáme.',
    );
  }

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
  cisloFaktury: string | null,
): string {
  // Odstavec o faktuře jen tam, kde faktura opravdu je. Slibovat přílohu,
  // která nedorazila, je horší než o ní nemluvit vůbec.
  const blokFaktury = cisloFaktury
    ? `<strong style="color:#12707f;">Fakturu ${e(cisloFaktury)} najdete v příloze</strong> tohoto e-mailu.`
    : '';

  // QR kód se vkládá odkazem, ne obrázkem v těle. Vložený obrázek si spousta
  // schránek nezobrazí, dokud ho člověk ručně nepovolí — a to je přesně ten
  // okamžik, kdy člověk platbu vzdá.
  const blokQr = qrUrl
    ? `<tr><td style="padding:20px 32px 0;font-size:14px;line-height:1.6;color:#45443f;">
         <a href="${e(qrUrl)}" style="color:#12707f;font-weight:600;">Otevřít QR kód k platbě</a>
         — načtěte ho v mobilní bance, částka i variabilní symbol se vyplní samy.
       </td></tr>`
    : '';

  return `<!-- Předmět v náhledu schránky. Skrytý text hned na začátku těla
     je jediný způsob, jak ovlivnit, co se ukáže vedle předmětu ve výpisu
     pošty — jinak si tam schránka vezme první větu i s pozdravem. -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">
  Registrace přijata. Faktura ${e(cisloFaktury ?? '')} je v příloze, splatnost ${e(u.splatnost)}.
</div>

<!-- CELÝ E-MAIL STOJÍ NA TABULKÁCH A STYLECH PSANÝCH PŘÍMO U PRVKŮ.
     Není to zastaralost: poštovní klienti (hlavně Outlook, který sází přes
     Word) neumí flex, grid ani odkazovaný styl. Tabulka a atribut jsou
     jediné, co vysází všude stejně. -->
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
       style="background-color:#f4f1ea;margin:0;padding:24px 12px;">
  <tr>
    <td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600"
             style="max-width:600px;width:100%;background-color:#ffffff;border-radius:14px;overflow:hidden;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">

        <!-- Hlavička -->
        <tr>
          <td style="background-color:#0a3e47;padding:28px 32px;">
            <p style="margin:0;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#f0b95e;font-weight:600;">
              Mezinárodní den seniorů
            </p>
            <p style="margin:8px 0 0;font-size:24px;line-height:1.25;color:#ffffff;font-weight:600;">
              Mezigeneračně aktivně spolu
            </p>
          </td>
        </tr>

        <!-- Potvrzení -->
        <tr>
          <td style="padding:32px 32px 8px;">
            <p style="margin:0;font-size:16px;line-height:1.6;color:#45443f;">
              Dobrý den, ${e(p.kontaktni_osoba)},
            </p>
            <p style="margin:16px 0 0;font-size:16px;line-height:1.6;color:#45443f;">
              máme vaši přihlášku a moc si jí vážíme. Níž je shrnutí toho, co jste
              vyplnili${p.castka_kc > 0 ? ' a údaje k zaplacení' : ''}.
              ${blokFaktury}
            </p>
          </td>
        </tr>

        <!-- Shrnutí registrace -->
        <tr>
          <td style="padding:28px 32px 0;">
            <p style="margin:0 0 4px;font-size:12px;letter-spacing:1.6px;text-transform:uppercase;color:#12707f;font-weight:600;">
              Shrnutí registrace
            </p>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr><td style="padding:10px 0;border-bottom:1px solid #f7dcae;font-size:14px;line-height:1.5;color:#6b6a64;width:42%;vertical-align:top;">Kdo se hlásí</td><td style="padding:10px 0;border-bottom:1px solid #f7dcae;font-size:15px;line-height:1.5;color:#45443f;font-weight:600;vertical-align:top;">${e(TYP_TEXT[p.typ_poradatele] ?? p.typ_poradatele)}</td></tr><tr><td style="padding:10px 0;border-bottom:1px solid #f7dcae;font-size:14px;line-height:1.5;color:#6b6a64;width:42%;vertical-align:top;">Název</td><td style="padding:10px 0;border-bottom:1px solid #f7dcae;font-size:15px;line-height:1.5;color:#45443f;font-weight:600;vertical-align:top;">${e(p.nazev_poradatele)}</td></tr><tr><td style="padding:10px 0;border-bottom:1px solid #f7dcae;font-size:14px;line-height:1.5;color:#6b6a64;width:42%;vertical-align:top;">Kontaktní osoba</td><td style="padding:10px 0;border-bottom:1px solid #f7dcae;font-size:15px;line-height:1.5;color:#45443f;font-weight:600;vertical-align:top;">${e(p.kontaktni_osoba)}</td></tr><tr><td style="padding:10px 0;border-bottom:1px solid #f7dcae;font-size:14px;line-height:1.5;color:#6b6a64;width:42%;vertical-align:top;">E-mail</td><td style="padding:10px 0;border-bottom:1px solid #f7dcae;font-size:15px;line-height:1.5;color:#45443f;font-weight:600;vertical-align:top;">${e(p.email)}</td></tr><tr><td style="padding:10px 0;border-bottom:1px solid #f7dcae;font-size:14px;line-height:1.5;color:#6b6a64;width:42%;vertical-align:top;">Telefon</td><td style="padding:10px 0;border-bottom:1px solid #f7dcae;font-size:15px;line-height:1.5;color:#45443f;font-weight:600;vertical-align:top;">${e(p.telefon)}</td></tr><tr><td style="padding:10px 0;border-bottom:1px solid #f7dcae;font-size:14px;line-height:1.5;color:#6b6a64;width:42%;vertical-align:top;">Kde se akce koná</td><td style="padding:10px 0;border-bottom:1px solid #f7dcae;font-size:15px;line-height:1.5;color:#45443f;font-weight:600;vertical-align:top;">${e(p.mesto + ', ' + p.kraj)}</td></tr><tr><td style="padding:10px 0;font-size:14px;line-height:1.5;color:#6b6a64;width:42%;vertical-align:top;">Kdy</td><td style="padding:10px 0;font-size:15px;line-height:1.5;color:#45443f;font-weight:600;vertical-align:top;">${e(p.datum_akce ? datumCesky(p.datum_akce) : 'zatím neurčeno')}</td></tr>
            </table>
          </td>
        </tr>

        <!-- Platba -->
        <tr>
          <td style="padding:28px 32px 0;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
                   style="background-color:#edf7f9;border-radius:12px;">
              <tr>
                <td style="padding:20px 22px;">
                  <p style="margin:0 0 4px;font-size:12px;letter-spacing:1.6px;text-transform:uppercase;color:#12707f;font-weight:600;">
                    Kam poslat platbu
                  </p>
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                    <tr><td style="padding:10px 0;border-bottom:1px solid #f7dcae;font-size:14px;line-height:1.5;color:#6b6a64;width:42%;vertical-align:top;">Částka</td><td style="padding:10px 0;border-bottom:1px solid #f7dcae;font-size:15px;line-height:1.5;color:#45443f;font-weight:600;vertical-align:top;">${castkaSlovy(p.castka_kc)} Kč</td></tr><tr><td style="padding:10px 0;border-bottom:1px solid #f7dcae;font-size:14px;line-height:1.5;color:#6b6a64;width:42%;vertical-align:top;">Číslo účtu</td><td style="padding:10px 0;border-bottom:1px solid #f7dcae;font-size:15px;line-height:1.5;color:#45443f;font-weight:600;vertical-align:top;">${e(u.cisloUctu)}</td></tr><tr><td style="padding:10px 0;border-bottom:1px solid #f7dcae;font-size:14px;line-height:1.5;color:#6b6a64;width:42%;vertical-align:top;">Variabilní symbol</td><td style="padding:10px 0;border-bottom:1px solid #f7dcae;font-size:15px;line-height:1.5;color:#45443f;font-weight:600;vertical-align:top;">${vs}</td></tr><tr><td style="padding:10px 0;border-bottom:1px solid #f7dcae;font-size:14px;line-height:1.5;color:#6b6a64;width:42%;vertical-align:top;">Zpráva pro příjemce</td><td style="padding:10px 0;border-bottom:1px solid #f7dcae;font-size:15px;line-height:1.5;color:#45443f;font-weight:600;vertical-align:top;">${e(zpravaProBanku(p, vs))}</td></tr><tr><td style="padding:10px 0;font-size:14px;line-height:1.5;color:#6b6a64;width:42%;vertical-align:top;">Splatnost</td><td style="padding:10px 0;font-size:15px;line-height:1.5;color:#45443f;font-weight:600;vertical-align:top;">${e(u.splatnost)}</td></tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Proč na VS záleží -->
        <tr>
          <td style="padding:20px 32px 0;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
                   style="background-color:#fbf1dc;border-radius:12px;">
              <tr>
                <td style="padding:16px 20px;font-size:14px;line-height:1.6;color:#45443f;">
                  <strong>Variabilní symbol prosím nevynechávejte.</strong> Podle něj
                  platbu poznáme a spárujeme s vaší přihláškou. Je to zároveň poslední
                  část čísla faktury ${e(cisloFaktury ?? '')}, takže se nedá splést.
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Platba ze zahraničí -->
        <tr>
          <td style="padding:20px 32px 0;font-size:14px;line-height:1.6;color:#6b6a64;">
            Platíte-li ze zahraničí, použijte IBAN <strong style="color:#45443f;">${e(u.iban ?? '')}</strong>
            a SWIFT <strong style="color:#45443f;">${e(Deno.env.get('SWIFT_UCTU') ?? '')}</strong>.<br>
            ${e(VETA_DPH)}
          </td>
        </tr>

        <!-- Co bude dál -->
        <tr>
          <td style="padding:28px 32px 0;">
            <p style="margin:0 0 4px;font-size:12px;letter-spacing:1.6px;text-transform:uppercase;color:#12707f;font-weight:600;">
              Co bude dál
            </p>
            <p style="margin:0;font-size:15px;line-height:1.7;color:#45443f;">
              Uspořádejte své mezigenerační setkání v týdnu kolem 1.&nbsp;10. Po akci
              vám přijde odkaz na krátký formulář — z něj vznikne záznam ve veřejném
              Zásobníku nápadů, ze kterého budou čerpat organizátoři z celé ČR.
            </p>
          </td>
        </tr>

        ${blokQr}

        <!-- Patička -->
        <tr>
          <td style="padding:28px 32px 32px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr><td style="border-top:1px solid #f7dcae;padding-top:20px;font-size:14px;line-height:1.7;color:#6b6a64;">
                Kdyby cokoliv, napište na
                <a href="mailto:${e(KONTAKT_EMAIL)}" style="color:#12707f;font-weight:600;text-decoration:none;">${e(KONTAKT_EMAIL)}</a>
                nebo zavolejte na ${e(KONTAKT_TELEFON)}.<br><br>
                Těšíme se na vaše setkání!<br>
                <strong style="color:#45443f;">${e(DODAVATEL)}</strong><br>
                ${e(WEB)}
              </td></tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
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
  faktura: HotovaFaktura | null,
): Promise<boolean> {
  if (kdoOdesila() === 'nikdo') {
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

  return await posli({
      prijemce: p.email,
      prijemceJmeno: p.kontaktni_osoba,
      predmet: `Přihláška přijata — variabilní symbol ${vs}`,
      text: textEmailu(p, vs, u, qrUrl),
      html: htmlEmailu(p, vs, u, qrUrl, faktura?.cislo ?? null),
      // Faktura jde rovnou v příloze. Dřív ji posílal Make zvlášť, takže
      // člověku chodily dva e-maily o jedné věci.
      prilohy: faktura
        ? [{ nazev: faktura.soubor, typ: 'application/pdf', data: faktura.pdf }]
        : [],
  });
}

// ---------------------------------------------------------------------------
// FAKTURA
// ---------------------------------------------------------------------------

/** Bucket, kam se ukládají hotové faktury. Na rozdíl od QR je NEveřejný. */
const BUCKET_FAKTURY = 'faktury';

/** Jak dlouho platí odkaz na fakturu. Deset let — doklad má přežít archivaci. */
const PLATNOST_ODKAZU_S = 315_360_000;

interface HotovaFaktura {
  cislo: string;
  soubor: string;
  pdf: Uint8Array;
  odkaz: string | null;
}

/**
 * Vystaví fakturu: vezme číslo z databáze, složí PDF, uloží ho a vrátí.
 *
 * FAKTURA SE VYSTAVUJE JEN NA PŘEVOD. Kdo platí QR kódem, dostává rovnou
 * platební údaje a fakturu nechce; dobrovolný příspěvek jednotlivce je dar,
 * na který se faktura nevystavuje vůbec.
 *
 * ČÍSLO SI NEVYMÝŠLÍME. Dává ho databázová funkce ve tvaru RR/SS/<VS>, takže
 * na faktuře i na platbě je vidět stejné číslo. Funkce nic neposouvá — pro
 * stejný variabilní symbol vrátí vždycky totéž, takže opakované volání
 * nespálí číslo navíc.
 *
 * `null` NENÍ důvod přihlášku zamítnout. Přihláška je v tu chvíli uložená
 * a člověk má platební údaje v e-mailu; chybějící faktura se dá dovystavit.
 */
async function vystavFakturu(
  // deno-lint-ignore no-explicit-any
  klient: any,
  p: Prihlaska,
  vs: number,
  datumVystaveni: string,
  datumSplatnosti: string,
): Promise<HotovaFaktura | null> {
  if (p.forma_platby !== 'prevod') return null;

  const rada = (Deno.env.get('FAKTURY_CISLO_RADY') ?? '').trim();
  if (!rada) {
    console.warn(
      `Faktura přeskočena: chybí FAKTURY_CISLO_RADY. Přihláška VS ${vs} je uložená.`,
    );
    return null;
  }

  try {
    const { data: cislo, error } = await klient.rpc('cislo_faktury_pro_vs', {
      rok: Number(new Date().getFullYear()),
      rada,
      variabilni_symbol: vs,
    });
    if (error || !cislo) throw error ?? new Error('Databáze nevrátila číslo faktury.');

    const iban = Deno.env.get('IBAN_UCTU') ?? null;

    const pdf = vytvorFakturuPdf({
      cisloFaktury: cislo,
      variabilniSymbol: vs,
      datumVystaveni,
      datumSplatnosti,
      castkaKc: p.castka_kc,

      dodavatelNazev: Deno.env.get('DODAVATEL_NAZEV') ?? 'Právě teď! o.p.s.',
      dodavatelAdresa: Deno.env.get('DODAVATEL_ADRESA') ?? '',
      dodavatelMesto: Deno.env.get('DODAVATEL_MESTO') ?? '',
      dodavatelIc: Deno.env.get('DODAVATEL_IC') ?? '29154901',
      dodavatelEmail: Deno.env.get('DODAVATEL_EMAIL') ?? '',
      dodavatelWeb: Deno.env.get('DODAVATEL_WEB') ?? 'www.pravetedops.cz',

      // Fakturační údaje se berou z toho, co člověk vyplnil ve formuláři.
      // Když název nevyplnil, použije se jméno kontaktní osoby — prázdný
      // odběratel by z dokladu udělal zmetek.
      odberatelNazev: p.fakt_nazev || p.kontaktni_osoba,
      odberatelAdresa: p.fakt_adresa ?? '',
      odberatelIc: p.fakt_ic,
      odberatelDic: p.fakt_dic,

      cisloUctu: Deno.env.get('CISLO_UCTU') ?? iban ?? '',
      iban,
      swift: Deno.env.get('SWIFT_UCTU') ?? null,
      zpravaProPrijemce: Deno.env.get('ZPRAVA_PLATBY') ?? 'AKTIVNE SPOLU',

      polozkaNazev:
        Deno.env.get('FAKTURA_POLOZKA') ??
        'Registrační poplatek – Mezinárodní den seniorů, projekt Aktivně spolu',
      vetaNeplatceDph:
        Deno.env.get('FAKTURA_VETA_DPH') ??
        'Právě teď! o.p.s. není plátcem DPH a nemá přiděleno DIČ. ' +
          'Fakturovaná částka je konečná, daň se neuplatňuje.',
    });

    const soubor = `faktura-${String(cislo).replace(/\//g, '-')}.pdf`;
    const cesta = `${new Date().getFullYear()}/${soubor}`;

    const { error: chybaUlozeni } = await klient.storage
      .from(BUCKET_FAKTURY)
      .upload(cesta, pdf, { contentType: 'application/pdf', upsert: true });
    if (chybaUlozeni) throw chybaUlozeni;

    // Bucket je neveřejný, takže odkaz musí být podepsaný.
    const { data: podepsany } = await klient.storage
      .from(BUCKET_FAKTURY)
      .createSignedUrl(cesta, PLATNOST_ODKAZU_S);

    const odkaz = podepsany?.signedUrl ?? null;

    // Teprve zápisem je faktura vystavená. Dokud je sloupec prázdný, dá se
    // dovystavit — databáze si navíc hlídá, že číslo končí variabilním
    // symbolem téhle přihlášky.
    const { error: chybaZapisu } = await klient
      .from('prihlasky')
      .update({ faktura_cislo: cislo, faktura_url: odkaz })
      .eq('variabilni_symbol', vs);
    if (chybaZapisu) console.error(`Číslo faktury se nepovedlo zapsat, VS ${vs}.`, chybaZapisu);

    console.log(`Faktura ${cislo} vystavena, VS ${vs}.`);
    return { cislo, soubor, pdf, odkaz };
  } catch (e) {
    console.error(`Fakturu se nepovedlo vystavit, VS ${vs}. Přihláška je uložená.`, e);
    return null;
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

  const { url: qrUrl, spayd } = await pripravQr(
    klient,
    variabilniSymbol,
    splatnost.iso,
    data.castka_kc,
    data.typ_poradatele === 'jednotlivec',
  );
  // Pořadí je důležité: faktura musí být hotová dřív, než odejde e-mail —
  // jinak by neměla co přiložit a člověku by dorazila zvlášť později.
  const faktura = await vystavFakturu(
    klient,
    data,
    variabilniSymbol,
    datumCesky(new Date().toISOString().slice(0, 10)),
    splatnost.cesky,
  );

  const emailOdeslan = await posliPotvrzeni(
    data,
    variabilniSymbol,
    qrUrl,
    splatnost.cesky,
    faktura,
  );

  await ozviSeDoFakturace({
    id: ulozeno.id,
    variabilni_symbol: variabilniSymbol,
    castka_kc: data.castka_kc,
    splatnost: splatnost.iso,
    ...data,
    qr_url: qrUrl,
    spayd,
    email_odeslan: emailOdeslan,
    faktura_cislo: faktura?.cislo ?? null,
    faktura_url: faktura?.odkaz ?? null,
  });

  return odpoved(req, {
    ok: true,
    variabilni_symbol: variabilniSymbol,
    qr_url: qrUrl,
  });
});
