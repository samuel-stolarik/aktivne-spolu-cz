// Dohledání souřadnic města v OpenStreetMap (služba Nominatim).
//
// K ČEMU TO JE
// Přihláška obsahuje město a kraj, ne souřadnice. Aby šla akce vykreslit
// na mapku, potřebujeme zeměpisnou šířku a délku. Hledá se JEDNOU, ve chvíli
// schválení přihlášky, a výsledek se uloží do databáze. Mapka pak jen čte
// hotová čísla a k žádné cizí službě už nechodí.
//
// DVĚ PRAVIDLA, KTERÁ SE MUSÍ DODRŽET
// Nominatim je veřejná služba provozovaná zadarmo. Její podmínky užití
// (https://operations.osmfoundation.org/policies/nominatim/) říkají:
//   1. nejvýš JEDEN dotaz za vteřinu,
//   2. každý dotaz musí mít vlastní hlavičku `User-Agent`, ze které je poznat,
//      kdo se ptá, a kontakt.
// Kdo je poruší, dostane od služby zákaz — a tím by přestalo fungovat
// dohledávání souřadnic pro celý web. Obojí hlídá tenhle soubor a nikde jinde
// se na Nominatim nesahá.
//
// PROČ SE FRONTA DRŽÍ V DATABÁZI A NE V PAMĚTI
// Napoprvé tu byla jen fronta v paměti procesu. PŘI TESTU SE UKÁZALO, ŽE TO
// NESTAČÍ: Supabase spouští souběžné požadavky ve VÍC ODDĚLENÝCH PROCESECH,
// každý má vlastní paměť, a tedy i vlastní frontu. Pět požadavků naráz proto
// odešlo na Nominatim skoro současně a služba nás odmítla (HTTP 429).
//
// Pořadí proto přiděluje databáze (funkce `nominatim_rezervuj`), kterou vidí
// všechny procesy stejně. Fronta v paměti tu zůstala jako druhá pojistka
// pro dotazy z jednoho procesu.
//
// PRAVIDLO, PODLE KTERÉHO JE MODUL POSTAVENÝ
// Souřadnice jsou příjemný bonus, ne podmínka schválení. Když se město
// nenajde nebo služba nejede, vrátí se to jako výsledek, ne jako výjimka —
// volající schválení dokončí a jen si poznamená, že akce zatím není na mapě.

/** Adresa vyhledávání. Bez klíče a bez registrace. */
const NOMINATIM_ADRESA = 'https://nominatim.openstreetmap.org/search';

/**
 * Nejmenší povolený rozestup mezi dotazy.
 *
 * Limit služby je jeden dotaz za vteřinu. Držíme 1100 ms, aby drobná
 * nepřesnost hodin nebo souběh dvou požadavků limit nepřekročily.
 */
const ROZESTUP_MS = 1100;

/**
 * Jak dlouho se čeká na odpověď.
 *
 * Osm vteřin. Delší čekání by znamenalo, že správkyně kouká na zamčené
 * tlačítko a neví, co se děje — a to je horší než poctivě říct „nedaří se"
 * a nabídnout zkusit to znovu.
 */
const TIMEOUT_MS = 8000;

/**
 * Hlavička `User-Agent`. Musí být z čeho poznat, kdo se ptá, a kontakt.
 * Dá se přebít proměnnou prostředí, kdyby se změnil kontaktní e-mail.
 */
function hlavickaKdoSePta(): string {
  return (
    Deno.env.get('NOMINATIM_USER_AGENT') ??
    'aktivne-spolu.cz (kontakt: info@trixtech.eu)'
  );
}

/** Jak dopadlo hledání. */
export type StavSouradnic = 'nalezeno' | 'nenalezeno' | 'chyba';

export interface VysledekSouradnic {
  stav: StavSouradnic;
  lat: number | null;
  lng: number | null;
  /** Celá česká věta pro administraci. U úspěchu prázdná. */
  duvod: string;
}

// ---------------------------------------------------------------------------
// DODRŽENÍ LIMITU JEDEN DOTAZ ZA VTEŘINU
// ---------------------------------------------------------------------------

/**
 * Nejdéle, co je únosné čekat ve frontě.
 *
 * Když by na řadu došlo až za víc než 15 vteřin, je poctivější říct
 * „zkuste to za chvíli" než nechat člověka koukat na zamčené tlačítko.
 */
const NEJDELE_VE_FRONTE_MS = 15000;

function pockej(ms: number): Promise<void> {
  return new Promise((hotovo) => setTimeout(hotovo, ms));
}

// Fronta v paměti procesu. Sama o sobě nestačí (viz komentář nahoře),
// ale ušetří databázi zbytečná volání, když si jeden proces vyřizuje
// víc dotazů za sebou.
let fronta: Promise<unknown> = Promise.resolve();

function veFronte<T>(prace: () => Promise<T>): Promise<T> {
  const dalsi = fronta.then(prace);
  // Chyba jednoho dotazu nesmí zablokovat frontu pro ty další.
  fronta = dalsi.catch(() => undefined);
  return dalsi;
}

/**
 * Klient databáze pro rezervaci místa ve frontě.
 *
 * Předává ho volající (Edge Funkce), aby se tady nemusel znovu vyrábět
 * a hlavně aby bylo na první pohled vidět, že modul sahá na databázi.
 */
export interface KlientProFrontu {
  rpc(
    nazev: string,
    parametry: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

/**
 * Počká, až na nás přijde řada.
 *
 * Pořadí přiděluje databáze, takže platí napříč všemi procesy Edge Funkcí.
 * Vrací `false`, když by čekání bylo neúnosně dlouhé.
 */
async function pockejNaRadu(klient: KlientProFrontu | null): Promise<boolean> {
  if (!klient) {
    // Bez databáze se nedá pořadí ohlídat. Radši počkáme celý rozestup,
    // než abychom se zeptali hned — limit služby je přednější než rychlost.
    await pockej(ROZESTUP_MS);
    return true;
  }

  const { data, error } = await klient.rpc('nominatim_rezervuj', {
    rozestup_ms: ROZESTUP_MS,
  });

  if (error) {
    console.error('Rezervace místa ve frontě selhala:', error.message);
    // Když fronta nefunguje, je bezpečnější počkat celý rozestup než
    // riskovat, že na Nominatim odejde několik dotazů naráz.
    await pockej(ROZESTUP_MS);
    return true;
  }

  const cekat = Number(data ?? 0);
  if (!Number.isFinite(cekat) || cekat <= 0) return true;
  if (cekat > NEJDELE_VE_FRONTE_MS) return false;

  await pockej(cekat);
  return true;
}

// ---------------------------------------------------------------------------
// VLASTNÍ HLEDÁNÍ
// ---------------------------------------------------------------------------

/**
 * Najde souřadnice českého města.
 *
 * NIKDY nevyhazuje výjimku. Každý neúspěch se vrátí jako výsledek se stavem
 * `nenalezeno` nebo `chyba` a českou větou — schválení přihlášky na tom
 * nesmí padnout.
 *
 * @param mesto  Název města z přihlášky, tak jak ho člověk napsal.
 * @param klient Klient databáze pro sdílenou frontu dotazů.
 */
export async function najdiSouradnice(
  mesto: string,
  klient: KlientProFrontu | null = null,
): Promise<VysledekSouradnic> {
  const hledane = (mesto ?? '').trim();

  if (!hledane) {
    return {
      stav: 'nenalezeno',
      lat: null,
      lng: null,
      duvod: 'V přihlášce není vyplněné město, takže není co hledat.',
    };
  }

  return await veFronte(async () => {
    // Nejdřív si počkáme, až na nás přijde řada. Bez tohohle kroku by se
    // souběžná schválení sešla na Nominatimu naráz a služba by nás odmítla.
    const jsmeNaRade = await pockejNaRadu(klient);
    if (!jsmeNaRade) {
      return {
        stav: 'chyba' as const,
        lat: null,
        lng: null,
        duvod:
          'Zrovna se dohledává hodně měst najednou. Zkuste to prosím za chvíli znovu.',
      };
    }

    const adresa = new URL(NOMINATIM_ADRESA);
    adresa.searchParams.set('q', `${hledane}, Czechia`);
    adresa.searchParams.set('format', 'json');
    adresa.searchParams.set('limit', '1');

    const prerus = new AbortController();
    const hlidac = setTimeout(() => prerus.abort(), TIMEOUT_MS);

    let odpoved: Response;
    try {
      odpoved = await fetch(adresa, {
        headers: {
          'User-Agent': hlavickaKdoSePta(),
          'Accept-Language': 'cs',
          Accept: 'application/json',
        },
        signal: prerus.signal,
      });
    } catch (chyba) {
      console.error('Nominatim neodpověděl:', chyba);
      return {
        stav: 'chyba' as const,
        lat: null,
        lng: null,
        duvod:
          'Mapová služba OpenStreetMap teď neodpovídá. Souřadnice se nepodařilo dohledat — zkuste to prosím za chvíli znovu.',
      };
    } finally {
      clearTimeout(hlidac);
    }

    // 429 a 403 znamenají, že jsme překročili limit dotazů. Je to naše chyba,
    // ne uživatelova, a musí se to poznat v logu.
    if (odpoved.status === 429 || odpoved.status === 403) {
      console.error(
        'Nominatim nás odmítl (kód ' +
          odpoved.status +
          '). Zkontrolujte rozestup mezi dotazy a hlavičku User-Agent.',
      );
      return {
        stav: 'chyba' as const,
        lat: null,
        lng: null,
        duvod:
          'Mapová služba OpenStreetMap dočasně odmítá dotazy. Zkuste souřadnice dohledat za pár minut znovu.',
      };
    }

    if (!odpoved.ok) {
      console.error('Nominatim vrátil kód', odpoved.status);
      return {
        stav: 'chyba' as const,
        lat: null,
        lng: null,
        duvod:
          'Mapová služba OpenStreetMap odpověděla chybou. Souřadnice se nepodařilo dohledat — zkuste to prosím znovu.',
      };
    }

    let data: unknown;
    try {
      data = await odpoved.json();
    } catch (chyba) {
      console.error('Odpověď Nominatimu se nepodařilo přečíst:', chyba);
      return {
        stav: 'chyba' as const,
        lat: null,
        lng: null,
        duvod:
          'Odpověď mapové služby se nepodařilo přečíst. Zkuste to prosím znovu.',
      };
    }

    if (!Array.isArray(data) || data.length === 0) {
      return {
        stav: 'nenalezeno' as const,
        lat: null,
        lng: null,
        duvod: `Město „${hledane}" mapa OpenStreetMap nezná. Zkontrolujte prosím, jestli v názvu není překlep, opravte ho a zkuste dohledat znovu.`,
      };
    }

    const prvni = data[0] as { lat?: unknown; lon?: unknown };
    const lat = Number(prvni.lat);
    const lng = Number(prvni.lon);

    // Služba vrací čísla jako text. Když se přečíst nedají nebo vyjdou mimo
    // rozsah, je lepší nemít souřadnice než mít špatné — akce by se objevila
    // někde uprostřed oceánu.
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      console.error('Nominatim vrátil nepoužitelné souřadnice:', prvni);
      return {
        stav: 'chyba' as const,
        lat: null,
        lng: null,
        duvod:
          'Mapová služba vrátila souřadnice, kterým nerozumíme. Zkuste to prosím znovu.',
      };
    }

    return { stav: 'nalezeno' as const, lat, lng, duvod: '' };
  });
}
