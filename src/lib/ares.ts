/**
 * Načtení fakturačních údajů z ARESu podle IČO.
 *
 * ------------------------------------------------------------------
 * K ČEMU TO JE
 * ------------------------------------------------------------------
 * V registračním formuláři se u školy a organizace vyplňuje název dle
 * obchodního rejstříku, adresa, IČO a DIČ. Většinu z toho jde dohledat
 * podle IČO, takže uživatel vyplní jen osm číslic a zbytek se doplní sám.
 * Míň překlepů a míň práce.
 *
 * ------------------------------------------------------------------
 * JAK SE TO VOLÁ
 * ------------------------------------------------------------------
 * Ne přímo na ARES. Prohlížeč by požadavek na cizí doménu bez CORS hlaviček
 * zahodil, takže se volá vlastní Edge Funkce `ares-lookup`, která se ARESu
 * zeptá za nás:
 *
 *   GET {PUBLIC_SUPABASE_URL}/functions/v1/ares-lookup?ico=29154901
 *
 * Funkce vrací `{ ok: true, nazev, adresa, ico, dic? }`, nebo `{ ok: false,
 * duvod, chyba }` s českou větou pro uživatele. Zdrojem dat je veřejné REST
 * rozhraní ARESu (bez klíče a bez registrace):
 *
 *   GET https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/{ico}
 *
 * Když subjekt není plátce DPH, pole `dic` v odpovědi vůbec není — to není
 * chyba, jen to znamená neplátce.
 *
 * Ověřeno 12. 8. 2026 na IČO 29154901 (Právě teď! o.p.s.).
 *
 * ------------------------------------------------------------------
 * PRAVIDLA, KTERÁ MUSÍ DODRŽET VOLAJÍCÍ
 * ------------------------------------------------------------------
 * 1. Volat AŽ NA AKCI UŽIVATELE — po stisku tlačítka „Načíst z rejstříku".
 *    Nikdy ne tiše při otevření formuláře. Uživatel má vědět, že se někam
 *    sahá ven.
 * 2. Načtené údaje musí jít ručně přepsat. ARES občas obsahuje adresu
 *    v jiném tvaru, než jaký chce účetní na faktuře.
 * 3. Když ARES neodpoví nebo IČO nezná, formulář musí jít normálně vyplnit
 *    ručně. Výpadek rejstříku nesmí zablokovat registraci.
 * 4. Selhání se musí ukázat slovně. Ne věčné kolečko, ne prázdná pole
 *    bez vysvětlení.
 * 5. Předvyplněným údajům se nevěří o nic víc než ručně napsaným — Edge
 *    Funkce `prijmout-prihlasku` si všechno validuje znovu a sama.
 */

/** Fakturační údaje tak, jak je potřebuje formulář. */
export interface FakturacniUdaje {
  /** Název dle obchodního rejstříku */
  nazev: string;
  /** Sídlo v jednom řádku, např. "Fügnerovo náměstí 1808/3, Nové Město, 120 00 Praha 2" */
  adresa: string;
  /** Osm číslic */
  ico: string;
  /** Chybí, pokud subjekt není plátce DPH */
  dic?: string;
}

const ADRESA_FUNKCE = `${import.meta.env.PUBLIC_SUPABASE_URL}/functions/v1/ares-lookup`;
const VEREJNY_KLIC = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

/**
 * Kolik nejdéle čekáme na odpověď.
 *
 * Je to o dvě vteřiny víc, než má na ARES vyhrazeno Edge Funkce. Díky tomu
 * stihne funkce doběhnout a poslat vlastní srozumitelnou hlášku — teprve
 * kdyby se zaseklo i spojení k ní, ukončí čekání prohlížeč sám. Nikdy se
 * nečeká donekonečna.
 */
const TIMEOUT_MS = 10000;

/** Náhradní hláška, když se nedá použít ta ze serveru. */
const HLASKA_NEDOSTUPNO =
  'Rejstřík ARES se teď nepodařilo zeptat. Zkuste to prosím znovu, nebo fakturační údaje vyplňte ručně.';

/**
 * Dohledá fakturační údaje podle IČO.
 *
 * @param ico Osm číslic, mezery nevadí.
 * @returns Nalezené údaje, nebo `null` když ARES subjekt nezná.
 * @throws Když se nepodaří spojit s ARESem — volající to musí ukázat
 *         uživateli slovně a nechat ho vyplnit údaje ručně.
 */
export async function nactiUdajeZAresu(
  ico: string,
): Promise<FakturacniUdaje | null> {
  const cislice = ico.replace(/\s+/g, '');

  // Tvar se kontroluje i tady, ať se kvůli překlepu zbytečně nevolá ven.
  // Edge Funkce si ho stejně ověří znovu — tohle je jen zdvořilost k síti.
  if (!/^[0-9]{8}$/.test(cislice)) {
    throw new Error('IČO musí mít přesně osm číslic.');
  }

  let odpoved: Response;
  try {
    odpoved = await fetch(`${ADRESA_FUNKCE}?ico=${cislice}`, {
      headers: {
        apikey: VEREJNY_KLIC,
        Authorization: `Bearer ${VEREJNY_KLIC}`,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new Error(HLASKA_NEDOSTUPNO);
  }

  const vysledek = (await odpoved.json().catch(() => null)) as
    | { ok?: boolean; duvod?: string; chyba?: string }
    | (FakturacniUdaje & { ok: true })
    | null;

  if (odpoved.ok && vysledek && 'ok' in vysledek && vysledek.ok) {
    const data = vysledek as FakturacniUdaje & { ok: true };
    return {
      nazev: data.nazev,
      adresa: data.adresa,
      ico: data.ico,
      ...(data.dic ? { dic: data.dic } : {}),
    };
  }

  // „Rejstřík tohle IČO nezná" není chyba spojení. Vrací se `null`, aby
  // formulář mohl ukázat jinou hlášku než při výpadku — uživatel s tím
  // naloží jinak (u překlepu opraví číslice, u výpadku vyplní ručně).
  const nenalezeno =
    vysledek && 'duvod' in vysledek && vysledek.duvod === 'nenalezeno';
  if (nenalezeno) return null;

  const hlaska =
    vysledek && 'chyba' in vysledek && typeof vysledek.chyba === 'string'
      ? vysledek.chyba
      : HLASKA_NEDOSTUPNO;
  throw new Error(hlaska);
}
