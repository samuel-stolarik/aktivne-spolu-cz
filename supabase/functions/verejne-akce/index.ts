// Veřejná mapka přihlášených akcí — jediný zdroj dat.
//
// TOHLE JE JEDINÉ MÍSTO V CELÉM PROJEKTU, KTERÉ VYDÁVÁ DATA Z PŘIHLÁŠEK VEN
// BEZ PŘIHLÁŠENÍ. Čti prosím celý tenhle komentář dřív, než tu cokoli změníš.
//
// V tabulce `prihlasky` jsou jména, e-maily, telefony, variabilní symboly
// a fakturační adresy lidí. Odpověď téhle funkce si může stáhnout kdokoli
// na světě — stačí znát adresu. Cokoli, co odsud vyjde, je zveřejněné
// nadobro a nedá se to vzít zpátky.
//
// TŘI PRAVIDLA, KTERÁ SE NESMÍ PORUŠIT
//
//   1. Odpověď smí obsahovat JEN pole vyjmenovaná v `SLOUPCE_PRO_MAPU` níž.
//      Nikdy ne `email`, `telefon`, `kontaktni_osoba`, `variabilni_symbol`,
//      fakturační údaje ani `id`. Řádek se z databáze nevrací celý a pak
//      neořezává — vybírá se rovnou jmenný seznam sloupců, aby se nový sloupec
//      v tabulce nemohl na web dostat sám od sebe.
//
//   2. Ven jdou jen SCHVÁLENÉ akce (`schvaleno = 'schvaleno'`). Čekající
//      a zamítnuté ne. O schválení rozhoduje člověk v administraci.
//
//   3. `nazev_poradatele` se posílá JEN u školy a organizace. U jednotlivce
//      je v tom sloupci jméno a příjmení soukromé osoby a na veřejnou mapu
//      nepatří — v odpovědi tam pak to pole vůbec není.
//
// PROČ TO NEČTE PROHLÍŽEČ PŘÍMO Z DATABÁZE
// Tabulka `prihlasky` je zamčená: zapnuté a vynucené RLS bez jediné policy
// a role `anon` i `authenticated` na ni nemají žádné oprávnění. Nabízelo se
// to rozvolnit (policy „pusť schválené řádky"), ale policy hlídá jen ŘÁDKY,
// ne SLOUPCE — kdokoli s veřejným klíčem by si mohl vyžádat e-maily
// a telefony ze schválených přihlášek. Celé zdůvodnění je v migraci
// 20260814100000_schvaleni_na_mapu.sql v sekci ZABEZPEČENÍ.
//
// Data proto čte tahle funkce servisním klíčem a výběr polí dělá v kódu,
// kde je vidět a dá se přečíst i bez znalosti PostgreSQL.

import { createClient } from 'npm:@supabase/supabase-js@2';

// ---------------------------------------------------------------------------
// CO SE SMÍ ZVEŘEJNIT
// ---------------------------------------------------------------------------

/**
 * Jediné sloupce, které se z databáze vůbec načtou.
 *
 * NEPŘIDÁVEJ SEM NIC, co by nemohlo být vytištěné v novinách. Každá položka
 * v tomhle seznamu je veřejná informace.
 *
 *   mesto, kraj       — kam se má na mapě umístit špendlík
 *   typ_poradatele    — škola / organizace / jednotlivec, podle toho ikona
 *   nazev_poradatele  — u jednotlivce se do odpovědi NEDOSTANE, viz níž
 *   napad_na_aktivitu — co chtějí dělat; text psaný pro veřejnost
 *   datum_akce        — kdy se setkání koná; údaj o veřejné akci, ne o člověku
 *   lat, lng          — souřadnice dohledané při schválení
 *
 * K `datum_akce`: je to den konání ohlášené veřejné akce, tedy stejná
 * kategorie údaje jako město. Nevypovídá nic o soukromí pořadatele a pro
 * návštěvníka mapky je to ta druhá půlka informace — vedle „kde" ještě „kdy".
 */
const SLOUPCE_PRO_MAPU = [
  'mesto',
  'kraj',
  'typ_poradatele',
  'nazev_poradatele',
  'napad_na_aktivitu',
  'datum_akce',
  'lat',
  'lng',
].join(', ');

/**
 * Typy pořadatelů, u kterých se smí zveřejnit název.
 *
 * Škola i organizace jsou instituce — jejich název je běžně veřejný.
 * `jednotlivec` tu schválně NENÍ: v tom sloupci je jméno a příjmení
 * konkrétního člověka.
 */
const NAZEV_JE_VEREJNY = new Set(['skola', 'organizace']);

/** Kolik akcí se nejvýš vydá. Pojistka proti nechtěně obří odpovědi. */
const NEJVYS_AKCI = 2000;

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------
// Tahle data jsou veřejná, takže se povoluje jakýkoli původ. Omezovat ho tady
// by nic nechránilo — kdo chce, stáhne si odpověď i mimo prohlížeč.

const HLAVICKY_CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

function odpoved(telo: unknown, stav = 200, mezipametSekund = 0): Response {
  return new Response(JSON.stringify(telo), {
    status: stav,
    headers: {
      ...HLAVICKY_CORS,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control':
        mezipametSekund > 0
          ? `public, max-age=${mezipametSekund}`
          : 'no-store',
    },
  });
}

/** Chybová odpověď. `veta` je celá česká věta pro člověka. */
function chyba(veta: string, stav: number): Response {
  return odpoved({ chyba: veta }, stav);
}

// ---------------------------------------------------------------------------
// PŘEVOD ŘÁDKU NA VEŘEJNOU AKCI
// ---------------------------------------------------------------------------

interface VerejnaAkce {
  mesto: string;
  kraj: string;
  typ_poradatele: string;
  nazev_poradatele?: string;
  napad_na_aktivitu?: string;
  /** Den konání ve tvaru RRRR-MM-DD. Do češtiny ho převádí mapka. */
  datum_akce?: string;
  lat: number;
  lng: number;
}

/**
 * Sestaví veřejnou podobu jedné akce.
 *
 * Staví se NOVÝ objekt, do kterého se pole vypisují jedno po druhém. Schválně
 * se nekopíruje řádek z databáze a nemažou se z něj citlivá pole — na to se
 * zapomíná. Takhle se do odpovědi dostane jen to, co je tu vypsané.
 *
 * Vrací `null`, když je řádek pro mapu nepoužitelný (chybí souřadnice).
 */
function verejnaPodoba(radek: Record<string, unknown>): VerejnaAkce | null {
  const lat = Number(radek.lat);
  const lng = Number(radek.lng);

  // Bez souřadnic není kam špendlík píchnout. Akce je schválená, jen se
  // na mapce neukáže — v administraci je u ní vidět proč.
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const typ = String(radek.typ_poradatele ?? '');

  const akce: VerejnaAkce = {
    mesto: String(radek.mesto ?? ''),
    kraj: String(radek.kraj ?? ''),
    typ_poradatele: typ,
    lat,
    lng,
  };

  // Název jen u instituce. U jednotlivce v odpovědi pole vůbec není —
  // nejde o prázdný řetězec, ale o chybějící klíč.
  if (NAZEV_JE_VEREJNY.has(typ)) {
    const nazev = String(radek.nazev_poradatele ?? '').trim();
    if (nazev) akce.nazev_poradatele = nazev;
  }

  // Nepovinné pole. Prázdné se do odpovědi neposílá, ať mapka nemusí
  // rozlišovat prázdný text od chybějícího.
  const napad = String(radek.napad_na_aktivitu ?? '').trim();
  if (napad) akce.napad_na_aktivitu = napad;

  // Datum posíláme strojově (RRRR-MM-DD) a do češtiny ho převede až mapka.
  // Starší přihlášky z doby, kdy se datum nesbíralo, ho nemají — pak v
  // odpovědi klíč vůbec není a mapka místo něj nic nevypíše.
  const datum = String(radek.datum_akce ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(datum)) akce.datum_akce = datum;

  return akce;
}

// ---------------------------------------------------------------------------
// VSTUPNÍ BOD
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: HLAVICKY_CORS });
  }

  // GET i POST. Mapka volá GET, aby se odpověď dala uložit do mezipaměti.
  if (req.method !== 'GET' && req.method !== 'POST') {
    return chyba('Nepodporovaný způsob volání.', 405);
  }

  const url = Deno.env.get('SUPABASE_URL');
  const servisniKlic = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!url || !servisniKlic) {
    console.error('Chybí SUPABASE_URL nebo SUPABASE_SERVICE_ROLE_KEY.');
    return chyba(
      'Mapku se nepodařilo načíst. Ozvěte se prosím správci webu.',
      500,
    );
  }

  const klient = createClient(url, servisniKlic, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await klient
    .from('prihlasky')
    .select(SLOUPCE_PRO_MAPU)
    // Jen schválené. Čekající ani zamítnuté se ven nedostanou.
    .eq('schvaleno', 'schvaleno')
    // Bez souřadnic není co vykreslit. Filtruje se rovnou v dotazu,
    // ať se zbytečně nepřenáší.
    .not('lat', 'is', null)
    .not('lng', 'is', null)
    .order('vytvoreno', { ascending: false })
    .limit(NEJVYS_AKCI);

  if (error) {
    console.error('Čtení akcí pro mapku selhalo:', error.message);
    return chyba(
      'Akce se teď nepodařilo načíst. Zkuste to prosím za chvíli znovu.',
      503,
    );
  }

  const akce: VerejnaAkce[] = [];
  for (const radek of (data ?? []) as unknown as Record<string, unknown>[]) {
    const jedna = verejnaPodoba(radek);
    if (jedna) akce.push(jedna);
  }

  // Pět minut v mezipaměti. Schválení se dějí po jednom a ručně, takže
  // pětiminutové zpoždění nikomu nevadí, a mapka se za to načte okamžitě
  // i při náporu návštěvníků.
  // Bez ukládání do mezipaměti. Pětiminutová mezipaměť tu byla, ale dělala
  // víc škody než užitku: kdo si stránku otevřel dřív, než byla schválená
  // první akce, viděl pak dalších pět minut prázdnou mapu — i po obnovení
  // stránky. A schválení v administraci se na mapě projevilo se zpožděním,
  // takže to vypadalo, že schvalování nefunguje.
  // Odpověď je malá a dotazů je málo, takže se tím nic nezdrží.
  return odpoved({ akce, pocet: akce.length }, 200, 0);
});
