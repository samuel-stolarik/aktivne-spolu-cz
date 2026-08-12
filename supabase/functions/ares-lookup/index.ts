// Dohledání fakturačních údajů v ARESu podle IČO.
//
// K ČEMU TO JE
// V registračním formuláři vyplní škola nebo organizace osm číslic IČO
// a zbytek fakturačních údajů se doplní sám. Míň překlepů, míň práce
// a účetní pak nemusí nic dohledávat.
//
// PROČ TO NEVOLÁ ROVNOU PROHLÍŽEČ
// ARES nemá pro cizí domény spolehlivě nastavené CORS hlavičky, takže by
// prohlížeč požadavek z aktivne-spolu.cz zahodil. Tahle funkce je proto
// obyčejný průchoďák: přijme IČO, zeptá se ARESu a vrátí jen ta čtyři pole,
// která formulář potřebuje.
//
// PRAVIDLO, PODLE KTERÉHO JE FUNKCE POSTAVENÁ
// ARES je pomůcka pro vyplnění, ne podmínka registrace. Když rejstřík
// neodpoví nebo IČO nezná, musí to formulář poznat a říct to slovně —
// člověk pak vyplní údaje ručně a přihlásí se úplně normálně. Proto se
// z každé chyby vrací srozumitelná česká věta a rozlišuje se „tohle IČO
// neexistuje" od „rejstřík zrovna nejede". Jsou to dvě různé situace
// a uživatel s každou naloží jinak.
//
// POZOR: co odsud přijde, je jen NÁVRH pro vyplnění formuláře. Funkce
// `prijmout-prihlasku` si všechno validuje znovu a sama — na údaje,
// které prošly prohlížečem, se nespoléhá ani tady.

// ---------------------------------------------------------------------------
// NASTAVENÍ
// ---------------------------------------------------------------------------

/** Veřejné REST rozhraní ARESu. Bez klíče a bez registrace. */
const ARES_ADRESA =
  'https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty';

/**
 * Kolik nejdéle čekáme na odpověď ARESu.
 *
 * Osm vteřin je kompromis: rejstřík odpovídá běžně do jedné, ale občas se
 * zamyslí. Delší čekání by znamenalo, že uživatel kouká na zamčené tlačítko
 * a neví, co se děje — a to je horší než poctivě říct „nedaří se" a nechat
 * ho vyplnit údaje ručně.
 */
const TIMEOUT_MS = 8000;

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
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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
    },
  });
}

/**
 * Chybová odpověď.
 *
 * `duvod` je pro program (formulář se podle něj rozhoduje), `chyba` je věta
 * pro člověka. Nikdy se neposílá jen kód — kdyby se formulář někdy zapomněl
 * na důvod podívat, pořád má co ukázat.
 */
function chybnaOdpoved(
  req: Request,
  duvod: 'neplatne_ico' | 'nenalezeno' | 'nedostupne' | 'spatny_pozadavek',
  chyba: string,
  stav: number,
): Response {
  return odpoved(req, { ok: false, duvod, chyba }, stav);
}

// ---------------------------------------------------------------------------
// ZPRACOVÁNÍ ODPOVĚDI ARESU
// ---------------------------------------------------------------------------

/** Jen ta část odpovědi ARESu, která nás zajímá. Zbytek se zahazuje. */
interface OdpovedAresu {
  ico?: string;
  obchodniJmeno?: string;
  /** Chybí, když subjekt není plátce DPH. Není to chyba. */
  dic?: string;
  sidlo?: { textovaAdresa?: string };
}

/**
 * Upraví poštovní směrovací číslo do českého tvaru.
 *
 * ARES vrací PSČ slepené dohromady („12000 Praha 2"), na faktuře se ale píše
 * s mezerou po třetí číslici („120 00 Praha 2"). Je to kosmetika, ale právě
 * takové drobnosti pak účetní přepisuje ručně.
 *
 * Pole je ve formuláři normálně přepisovatelné, takže když by úprava někdy
 * sedla špatně, člověk si adresu opraví.
 */
function upravPsc(adresa: string): string {
  return adresa.replace(/(^|[\s,])(\d{3})(\d{2})(?=\s)/g, '$1$2 $3');
}

// ---------------------------------------------------------------------------
// HLAVNÍ OBSLUHA
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  // Prohlížeč se nejdřív zeptá, jestli smí poslat požadavek z jiné domény.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: hlavickyCors(req) });
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return chybnaOdpoved(
      req,
      'spatny_pozadavek',
      'Tenhle odkaz umí jen vyhledat IČO v rejstříku.',
      405,
    );
  }

  // IČO bereme z adresy (?ico=…) i z těla požadavku, ať se funkce dá zavolat
  // obojím způsobem — z formuláře i ručně z příkazové řádky při ladění.
  let ico = new URL(req.url).searchParams.get('ico') ?? '';

  if (!ico && req.method === 'POST') {
    try {
      const telo = (await req.json()) as Record<string, unknown>;
      ico = typeof telo?.ico === 'string' ? telo.ico : '';
    } catch {
      return chybnaOdpoved(
        req,
        'spatny_pozadavek',
        'Požadavek se nepodařilo přečíst.',
        400,
      );
    }
  }

  // Mezery lidé do IČO píšou běžně („291 549 01"), na kontrolu tvaru
  // ale nemají vliv, tak je zahodíme dřív, než se na cokoli podíváme.
  ico = ico.replace(/\s+/g, '');

  // VALIDACE PŘED VŠÍM OSTATNÍM
  // Ven se sahá až ve chvíli, kdy je jisté, že má smysl se ptát. Nesmyslný
  // vstup se odmítne tady, ne až po osmi vteřinách čekání na ARES.
  if (!/^[0-9]{8}$/.test(ico)) {
    return chybnaOdpoved(
      req,
      'neplatne_ico',
      'IČO musí mít přesně osm číslic.',
      400,
    );
  }

  let odpovedAres: Response;
  try {
    odpovedAres = await fetch(`${ARES_ADRESA}/${ico}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    // Spadlé spojení nebo vypršelý čas. Pro uživatele je to totéž —
    // rejstřík teď nejde, ať vyplní údaje ručně.
    console.error(`ARES neodpověděl na IČO ${ico}:`, e);
    return chybnaOdpoved(
      req,
      'nedostupne',
      'Rejstřík ARES teď neodpovídá. Zkuste to prosím za chvíli znovu, nebo fakturační údaje vyplňte ručně.',
      504,
    );
  }

  // 404 znamená, že rejstřík takové IČO nezná. To NENÍ výpadek — je to
  // odpověď, a nejspíš překlep v číslech. Uživatel s tím naloží jinak než
  // s nedostupným rejstříkem, takže se to od sebe musí poznat.
  if (odpovedAres.status === 404) {
    return chybnaOdpoved(
      req,
      'nenalezeno',
      `Rejstřík ARES IČO ${ico} nezná. Zkontrolujte prosím číslice, nebo fakturační údaje vyplňte ručně.`,
      404,
    );
  }

  if (!odpovedAres.ok) {
    console.error(`ARES vrátil ${odpovedAres.status} na IČO ${ico}.`);
    return chybnaOdpoved(
      req,
      'nedostupne',
      'Rejstřík ARES se teď nedaří zeptat. Zkuste to prosím za chvíli znovu, nebo fakturační údaje vyplňte ručně.',
      502,
    );
  }

  let data: OdpovedAresu;
  try {
    data = (await odpovedAres.json()) as OdpovedAresu;
  } catch (e) {
    console.error(`Odpověď ARESu na IČO ${ico} nejde přečíst:`, e);
    return chybnaOdpoved(
      req,
      'nedostupne',
      'Odpovědi z rejstříku ARES nerozumíme. Fakturační údaje prosím vyplňte ručně.',
      502,
    );
  }

  const nazev = (data.obchodniJmeno ?? '').trim();
  const adresa = (data.sidlo?.textovaAdresa ?? '').trim();

  // Odpověď bez názvu je pro formulář k ničemu — nebylo by co předvyplnit.
  // Radši se přiznáme, než abychom vrátili poloprázdný výsledek a uživatel
  // hledal, co se vlastně doplnilo.
  if (!nazev) {
    console.error(`ARES vrátil pro IČO ${ico} záznam bez obchodního jména.`);
    return chybnaOdpoved(
      req,
      'nenalezeno',
      `K IČO ${ico} rejstřík ARES nevrátil použitelné údaje. Vyplňte je prosím ručně.`,
      404,
    );
  }

  // DIČ přidáváme, jen když ho ARES opravdu poslal. Když chybí, subjekt
  // není plátce DPH — spousta škol a spolků plátcem není a je to v pořádku.
  const dic = (data.dic ?? '').trim().toUpperCase();

  return odpoved(req, {
    ok: true,
    ico: (data.ico ?? ico).trim(),
    nazev,
    adresa: upravPsc(adresa),
    ...(dic ? { dic } : {}),
  });
});
