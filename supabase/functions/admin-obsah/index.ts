// Administrace webu — jediná cesta k datům.
//
// POZOR NA NÁZEV: funkce se jmenuje `admin-obsah`, ale obsluhuje CELOU
// administraci — přihlášky, texty i obrázky. Název zůstal z doby, kdy měla
// řešit jen texty. Přejmenování by znamenalo smazat a znovu nasadit funkci
// a přepsat adresu na webu, což za to nestojí.
//
// PROČ TAHLE FUNKCE VŮBEC EXISTUJE
// V tabulce `prihlasky` jsou jména, e-maily, telefony a adresy lidí. Tabulka
// je zamčená: má zapnuté a vynucené RLS, žádnou policy a role `anon`
// i `authenticated` na ni nemají jediné oprávnění. Nikdo se k ní nedostane
// přímo z prohlížeče, ani přihlášený správce.
//
// Data proto čte tahle funkce servisním klíčem, který zabezpečení obchází.
// Klíč je uložený jako tajemství Edge Funkce v Supabase a do prohlížeče
// se nedostane nikdy. Než funkce cokoli vydá, ověří si, kdo volá:
//
//   1. Z hlavičky Authorization vezme přihlašovací token.
//   2. Nechá si ho ověřit Supabase Auth. Token je podepsaný tajným klíčem
//      projektu — vyrobit ani upravit se nedá.
//   3. Ověřené ID účtu vyhledá v tabulce `spravci`. Když tam není,
//      vrátí 403 a k datům vůbec nesáhne.
//
// Teprve po všech třech krocích se sahá na databázi. Zdůvodnění, proč tudy
// a ne přes policy, je v migraci 20260812160000_administrace.sql.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { najdiSouradnice, type KlientProFrontu } from '../_shared/nominatim.ts';

// ---------------------------------------------------------------------------
// NASTAVENÍ
// ---------------------------------------------------------------------------

/** Bucket, kam se ukládají obrázky použité na webu. */
const BUCKET_OBRAZKY = 'obsah-obrazky';

/** Jak dlouho platí jednorázová adresa pro nahrání obrázku (v sekundách). */
const PLATNOST_ADRESY_S = 120;

/** Povolené stavy PLATBY. Musí sedět s podmínkou v migraci přihlášek. */
const STAVY = ['nova', 'zaplaceno', 'zruseno'] as const;

/**
 * Povolená rozhodnutí o ZVEŘEJNĚNÍ na mapce.
 *
 * Je to jiná osa než `stav` výš — zaplaceno neznamená schváleno na mapu.
 * `ceka` je tu proto, aby šlo hotové rozhodnutí vzít zpět.
 */
const SCHVALENI = ['ceka', 'schvaleno', 'zamitnuto'] as const;

/** Sloupce, které administrace o přihlášce dostane. */
const SLOUPCE_PRIHLASKY = [
  'id',
  'vytvoreno',
  'typ_poradatele',
  'nazev_poradatele',
  'kontaktni_osoba',
  'email',
  'telefon',
  'mesto',
  'kraj',
  'datum_akce',
  'napad_na_aktivitu',
  'forma_platby',
  'variabilni_symbol',
  'stav',
  'faktura_cislo',
  'schvaleno',
  'schvalil',
  'schvaleno_kdy',
  'lat',
  'lng',
  'souradnice_stav',
  'souradnice_duvod',
].join(', ');

/** Sloupce o schválení a souřadnicích, které se vracejí po každé změně. */
const SLOUPCE_SCHVALENI =
  'id, schvaleno, schvalil, schvaleno_kdy, lat, lng, souradnice_stav, souradnice_duvod';

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------
// Administrace běží na aktivne-spolu.cz, funkce na doméně Supabase. Bez
// těchhle hlaviček by prohlížeč požadavek vůbec neodeslal.
//
// Volnější seznam původů tu nic neohrožuje: přístup se nehlídá adresou
// stránky, ale přihlašovacím tokenem v hlavičce. Cizí web se k tokenu
// správce nedostane, protože prohlížeč mu nedovolí číst data jiné domény.

function povoleneOriginy(): string[] {
  return (Deno.env.get('POVOLENE_ORIGINY') ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

function hlavickyCors(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const povolene = povoleneOriginy();

  // Vývoj běží na localhostu, ten povolujeme vždycky.
  const jeLokalni = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

  let povolenyOrigin = '*';
  if (povolene.length > 0 && !jeLokalni) {
    povolenyOrigin = povolene.includes(origin) ? origin : povolene[0];
  } else if (jeLokalni) {
    povolenyOrigin = origin;
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
    headers: {
      ...hlavickyCors(req),
      'Content-Type': 'application/json; charset=utf-8',
      // Odpovědi obsahují osobní údaje, nesmí se nikde ukládat do mezipaměti.
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * Chybová odpověď. `chyba` je věta, kterou administrace ukáže člověku —
 * musí být srozumitelná i pro netechnického správce.
 */
function chyba(req: Request, veta: string, stav: number): Response {
  return odpoved(req, { chyba: veta }, stav);
}

// ---------------------------------------------------------------------------
// OVĚŘENÍ SPRÁVCE
// ---------------------------------------------------------------------------

interface Spravce {
  id: string;
  email: string;
}

/**
 * Zjistí, kdo požadavek poslal, a jestli je to správce.
 *
 * Vrací buď údaje o správci, nebo hotovou chybovou odpověď. Volající ji jen
 * pošle dál — díky tomu se nedá zapomenout na ošetření, kód by se jinak
 * nezkompiloval.
 */
async function overSpravce(
  req: Request,
  klientSluzby: ReturnType<typeof createClient>,
): Promise<{ spravce: Spravce } | { odmitnuto: Response }> {
  const hlavicka = req.headers.get('Authorization') ?? '';
  const token = hlavicka.toLowerCase().startsWith('bearer ')
    ? hlavicka.slice(7).trim()
    : '';

  if (!token) {
    return {
      odmitnuto: chyba(req, 'Chybí přihlášení. Přihlaste se prosím znovu.', 401),
    };
  }

  // Ověření podpisu tokenu dělá Supabase Auth. Vlastní kontrolu tokenu
  // si tu nepíšeme — na kryptografii se nedá improvizovat.
  const { data, error } = await klientSluzby.auth.getUser(token);

  if (error || !data?.user) {
    return {
      odmitnuto: chyba(
        req,
        'Přihlášení vypršelo nebo je neplatné. Přihlaste se prosím znovu.',
        401,
      ),
    };
  }

  // Platný účet ještě neznamená správce. Musí být na jmenném seznamu.
  const { data: radek, error: chybaSeznamu } = await klientSluzby
    .from('spravci')
    .select('uzivatel')
    .eq('uzivatel', data.user.id)
    .maybeSingle();

  if (chybaSeznamu) {
    console.error('Nepovedlo se ověřit seznam správců:', chybaSeznamu.message);
    return {
      odmitnuto: chyba(
        req,
        'Nepodařilo se ověřit oprávnění. Zkuste to prosím za chvíli znovu.',
        503,
      ),
    };
  }

  if (!radek) {
    console.warn('Přihlášený účet není správce:', data.user.id);
    return {
      odmitnuto: chyba(
        req,
        'Tenhle účet nemá přístup do administrace. Ozvěte se správci webu.',
        403,
      ),
    };
  }

  return { spravce: { id: data.user.id, email: data.user.email ?? '' } };
}

// ---------------------------------------------------------------------------
// JEDNOTLIVÉ AKCE
// ---------------------------------------------------------------------------

/** Seznam přihlášek, od nejnovější. */
async function seznamPrihlasek(
  req: Request,
  klient: ReturnType<typeof createClient>,
): Promise<Response> {
  const { data, error } = await klient
    .from('prihlasky')
    .select(SLOUPCE_PRIHLASKY)
    .order('vytvoreno', { ascending: false })
    .limit(2000);

  if (error) {
    console.error('Čtení přihlášek selhalo:', error.message);
    return chyba(
      req,
      'Přihlášky se nepodařilo načíst. Zkuste to prosím znovu.',
      503,
    );
  }

  return odpoved(req, { prihlasky: data ?? [] });
}

/** Změna stavu jedné přihlášky. */
async function zmenStav(
  req: Request,
  klient: ReturnType<typeof createClient>,
  telo: Record<string, unknown>,
): Promise<Response> {
  const id = typeof telo.id === 'string' ? telo.id.trim() : '';
  const stav = typeof telo.stav === 'string' ? telo.stav.trim() : '';

  if (!id) {
    return chyba(req, 'Chybí údaj o tom, kterou přihlášku měnit.', 400);
  }
  if (!(STAVY as readonly string[]).includes(stav)) {
    return chyba(
      req,
      `Neznámý stav „${stav}". Povolené jsou: nová, zaplaceno, zrušeno.`,
      400,
    );
  }

  const { data, error } = await klient
    .from('prihlasky')
    .update({ stav })
    .eq('id', id)
    .select('id, stav');

  if (error) {
    console.error('Změna stavu selhala:', error.message);
    return chyba(
      req,
      'Stav se nepodařilo uložit. Zkuste to prosím znovu.',
      503,
    );
  }

  if (!data || data.length === 0) {
    return chyba(req, 'Přihláška se nenašla. Nejspíš byla mezitím smazána.', 404);
  }

  return odpoved(req, { ulozeno: true, stav: data[0].stav });
}

// ---------------------------------------------------------------------------
// SCHVÁLENÍ NA VEŘEJNOU MAPKU
// ---------------------------------------------------------------------------
// Pozor, tohle je něco jiného než změna stavu platby výš. Rozhoduje se tu,
// jestli se akce objeví na VEŘEJNÉ MAPCE na webu — tedy jestli ji uvidí
// kdokoli na světě. Zaplacení s tím nemá nic společného.

/** Slovní podoba rozhodnutí pro hlášky a záznamy v logu. */
const NAZVY_SCHVALENI: Record<string, string> = {
  ceka: 'čeká na rozhodnutí',
  schvaleno: 'schváleno na mapu',
  zamitnuto: 'zamítnuto',
};

/**
 * Dohledá souřadnice města a uloží je k přihlášce.
 *
 * Vrací zapsané hodnoty, aby je volající mohl poslat rovnou administraci.
 * NIKDY nevyhazuje výjimku — neúspěšné hledání je běžný výsledek, ne chyba.
 */
async function dohledejAUloz(
  klient: ReturnType<typeof createClient>,
  id: string,
  mesto: string,
): Promise<Record<string, unknown>> {
  // Klient se předává dál kvůli sdílené frontě dotazů na Nominatim.
  // Pořadí přiděluje databáze, aby se souběžná schválení nesešla naráz.
  const nalez = await najdiSouradnice(
    mesto,
    klient as unknown as KlientProFrontu,
  );

  if (nalez.stav !== 'nalezeno') {
    // Do logu jde konkrétní důvod, ať se dá dohledat, jestli šlo o překlep
    // v názvu města, nebo o výpadek služby.
    console.warn(
      `Souřadnice pro přihlášku ${id} (město „${mesto}") se nepodařilo dohledat: ${nalez.stav} — ${nalez.duvod}`,
    );
  }

  const zmena = {
    lat: nalez.lat,
    lng: nalez.lng,
    souradnice_stav: nalez.stav,
    souradnice_kdy: new Date().toISOString(),
    souradnice_duvod: nalez.duvod || null,
  };

  const { data, error } = await klient
    .from('prihlasky')
    .update(zmena)
    .eq('id', id)
    .select(SLOUPCE_SCHVALENI);

  if (error) {
    // Souřadnice se nepodařilo uložit. Schválení samotné tím padnout nesmí,
    // takže se vrátí aspoň to, co jsme zjistili, a zapíše se to do logu.
    console.error(`Uložení souřadnic pro ${id} selhalo:`, error.message);
    return {
      ...zmena,
      souradnice_stav: 'chyba',
      souradnice_duvod:
        'Souřadnice se našly, ale nepodařilo se je uložit do databáze. Zkuste je prosím dohledat znovu.',
    };
  }

  return (data?.[0] as Record<string, unknown>) ?? zmena;
}

/**
 * Rozhodnutí o zveřejnění jedné přihlášky na mapce.
 *
 * Při schválení se rovnou zkusí dohledat souřadnice města. Když se to
 * nepovede, SCHVÁLENÍ PŘESTO PLATÍ — akce se jen zatím neukáže na mapce
 * a v administraci je u ní vidět, proč. To je schválně: rozhodnutí správkyně
 * nesmí padnout kvůli tomu, že cizí mapová služba zrovna nejede.
 */
async function schval(
  req: Request,
  klient: ReturnType<typeof createClient>,
  telo: Record<string, unknown>,
  spravce: Spravce,
): Promise<Response> {
  const id = typeof telo.id === 'string' ? telo.id.trim() : '';
  const rozhodnuti =
    typeof telo.rozhodnuti === 'string' ? telo.rozhodnuti.trim() : '';

  if (!id) {
    return chyba(req, 'Chybí údaj o tom, kterou přihlášku měnit.', 400);
  }
  if (!(SCHVALENI as readonly string[]).includes(rozhodnuti)) {
    return chyba(
      req,
      `Neznámé rozhodnutí „${rozhodnuti}". Povolené jsou: schválit, zamítnout, vrátit k rozhodnutí.`,
      400,
    );
  }

  const { data, error } = await klient
    .from('prihlasky')
    .update({
      schvaleno: rozhodnuti,
      schvalil: spravce.email,
      schvaleno_kdy: new Date().toISOString(),
    })
    .eq('id', id)
    .select(`${SLOUPCE_SCHVALENI}, mesto`);

  if (error) {
    console.error('Uložení rozhodnutí o mapce selhalo:', error.message);
    return chyba(
      req,
      'Rozhodnutí se nepodařilo uložit. Zkuste to prosím znovu.',
      503,
    );
  }

  if (!data || data.length === 0) {
    return chyba(req, 'Přihláška se nenašla. Nejspíš byla mezitím smazána.', 404);
  }

  const radek = data[0] as Record<string, unknown>;
  console.log(
    `Přihláška ${id}: ${NAZVY_SCHVALENI[rozhodnuti]} (rozhodl ${spravce.email}).`,
  );

  let souradnice: Record<string, unknown> = radek;

  // Souřadnice se hledají JEN při schválení a JEN když je ještě nemáme.
  // Nominatim má limit jeden dotaz za vteřinu a je to cizí služba zadarmo —
  // nemá smysl se ptát na totéž znovu, když už odpověď máme.
  const uzMameSouradnice = radek.lat !== null && radek.lng !== null;
  if (rozhodnuti === 'schvaleno' && !uzMameSouradnice) {
    souradnice = await dohledejAUloz(klient, id, String(radek.mesto ?? ''));
  }

  return odpoved(req, {
    ulozeno: true,
    schvaleno: rozhodnuti,
    schvalil: spravce.email,
    schvaleno_kdy: souradnice.schvaleno_kdy ?? radek.schvaleno_kdy,
    lat: souradnice.lat ?? null,
    lng: souradnice.lng ?? null,
    souradnice_stav: souradnice.souradnice_stav ?? 'nezjistovano',
    souradnice_duvod: souradnice.souradnice_duvod ?? null,
  });
}

/**
 * Nový pokus o dohledání souřadnic jedné přihlášky.
 *
 * Používá se, když hledání napoprvé selhalo — třeba kvůli překlepu v názvu
 * města nebo proto, že mapová služba zrovna nejela.
 */
async function dohledejSouradnice(
  req: Request,
  klient: ReturnType<typeof createClient>,
  telo: Record<string, unknown>,
): Promise<Response> {
  const id = typeof telo.id === 'string' ? telo.id.trim() : '';
  if (!id) {
    return chyba(req, 'Chybí údaj o tom, které přihlášce hledat souřadnice.', 400);
  }

  const { data, error } = await klient
    .from('prihlasky')
    .select('id, mesto')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('Načtení přihlášky pro hledání souřadnic selhalo:', error.message);
    return chyba(
      req,
      'Přihlášku se nepodařilo načíst. Zkuste to prosím znovu.',
      503,
    );
  }

  if (!data) {
    return chyba(req, 'Přihláška se nenašla. Nejspíš byla mezitím smazána.', 404);
  }

  const vysledek = await dohledejAUloz(klient, id, String(data.mesto ?? ''));

  return odpoved(req, {
    ulozeno: true,
    lat: vysledek.lat ?? null,
    lng: vysledek.lng ?? null,
    souradnice_stav: vysledek.souradnice_stav ?? 'chyba',
    souradnice_duvod: vysledek.souradnice_duvod ?? null,
  });
}

/** Všechny uložené přepisy textů a obrázků. */
async function seznamObsahu(
  req: Request,
  klient: ReturnType<typeof createClient>,
): Promise<Response> {
  const { data, error } = await klient
    .from('obsah')
    .select('klic, hodnota, upraveno, upravil');

  if (error) {
    console.error('Čtení přepisů selhalo:', error.message);
    return chyba(
      req,
      'Uložené úpravy textů se nepodařilo načíst. Zkuste to prosím znovu.',
      503,
    );
  }

  return odpoved(req, { obsah: data ?? [] });
}

/** Uložení jednoho přepsaného textu nebo adresy obrázku. */
async function ulozObsah(
  req: Request,
  klient: ReturnType<typeof createClient>,
  telo: Record<string, unknown>,
  spravce: Spravce,
): Promise<Response> {
  const klic = typeof telo.klic === 'string' ? telo.klic.trim() : '';
  const hodnota = typeof telo.hodnota === 'string' ? telo.hodnota : '';

  if (!klic) {
    return chyba(req, 'Chybí údaj o tom, který text se ukládá.', 400);
  }
  // Krátká pojistka proti překlepu v kódu, ne bezpečnostní kontrola.
  if (klic.length > 120 || !/^[a-z0-9.\-_]+$/.test(klic)) {
    return chyba(req, `Neplatné označení textu „${klic}".`, 400);
  }
  if (hodnota.length > 20000) {
    return chyba(
      req,
      'Text je příliš dlouhý. Zkraťte ho prosím pod 20 000 znaků.',
      400,
    );
  }

  const { error } = await klient
    .from('obsah')
    .upsert(
      { klic, hodnota, upravil: spravce.email },
      { onConflict: 'klic' },
    );

  if (error) {
    console.error('Uložení přepisu selhalo:', error.message);
    return chyba(req, 'Text se nepodařilo uložit. Zkuste to prosím znovu.', 503);
  }

  return odpoved(req, { ulozeno: true });
}

/** Zrušení přepisu — web se vrátí k původnímu textu z HTML. */
async function zrusObsah(
  req: Request,
  klient: ReturnType<typeof createClient>,
  telo: Record<string, unknown>,
): Promise<Response> {
  const klic = typeof telo.klic === 'string' ? telo.klic.trim() : '';
  if (!klic) {
    return chyba(req, 'Chybí údaj o tom, který text se má vrátit.', 400);
  }

  const { error } = await klient.from('obsah').delete().eq('klic', klic);

  if (error) {
    console.error('Zrušení přepisu selhalo:', error.message);
    return chyba(
      req,
      'Původní text se nepodařilo vrátit. Zkuste to prosím znovu.',
      503,
    );
  }

  return odpoved(req, { ulozeno: true });
}

/**
 * Jednorázová adresa pro nahrání obrázku.
 *
 * Soubor putuje z prohlížeče rovnou do úložiště, funkce ho vůbec nevidí.
 * Adresa platí dvě minuty a jen pro jeden konkrétní název souboru, takže
 * se s ní nedá nahrát nic jiného ani nikam jinam.
 */
async function adresaProNahrani(
  req: Request,
  klient: ReturnType<typeof createClient>,
  telo: Record<string, unknown>,
): Promise<Response> {
  const puvodniNazev = typeof telo.nazev === 'string' ? telo.nazev : '';

  if (!puvodniNazev) {
    return chyba(req, 'Chybí název souboru.', 400);
  }

  // Přípona podle názvu. Kontrolu typu souboru dělá samo úložiště podle
  // seznamu povolených formátů u bucketu — tady jde jen o hezký název.
  const tecka = puvodniNazev.lastIndexOf('.');
  const pripona =
    tecka > 0 ? puvodniNazev.slice(tecka + 1).toLowerCase() : 'png';

  if (!['png', 'jpg', 'jpeg', 'webp', 'svg'].includes(pripona)) {
    return chyba(
      req,
      'Tenhle formát obrázku nejde nahrát. Použijte prosím PNG, JPG, WEBP nebo SVG.',
      400,
    );
  }

  // Název bez diakritiky a mezer, ať odkaz funguje všude stejně.
  const zaklad = puvodniNazev
    .slice(0, tecka > 0 ? tecka : undefined)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'obrazek';

  // Časové razítko v názvu: nahrání stejného souboru podruhé nepřepíše
  // ten první a v prohlížečích návštěvníků se neukáže stará verze
  // z mezipaměti.
  const razitko = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  const cesta = `${razitko}-${zaklad}.${pripona}`;

  const { data, error } = await klient.storage
    .from(BUCKET_OBRAZKY)
    .createSignedUploadUrl(cesta);

  if (error || !data) {
    console.error('Podepsaná adresa se nevytvořila:', error?.message);
    return chyba(
      req,
      'Nahrávání se nepodařilo připravit. Zkuste to prosím znovu.',
      503,
    );
  }

  const zaklad_url = Deno.env.get('SUPABASE_URL') ?? '';

  return odpoved(req, {
    bucket: BUCKET_OBRAZKY,
    cesta: data.path,
    token: data.token,
    platnostSekund: PLATNOST_ADRESY_S,
    // Adresa, na které bude obrázek po nahrání veřejně dostupný.
    // Přesně tahle hodnota se ukládá do tabulky `obsah`.
    verejnaAdresa: `${zaklad_url}/storage/v1/object/public/${BUCKET_OBRAZKY}/${data.path}`,
  });
}

/** Seznam už nahraných obrázků, od nejnovějšího. */
async function seznamObrazku(
  req: Request,
  klient: ReturnType<typeof createClient>,
): Promise<Response> {
  const { data, error } = await klient.storage.from(BUCKET_OBRAZKY).list('', {
    limit: 200,
    sortBy: { column: 'created_at', order: 'desc' },
  });

  if (error) {
    console.error('Výpis obrázků selhal:', error.message);
    return chyba(
      req,
      'Seznam nahraných obrázků se nepodařilo načíst.',
      503,
    );
  }

  const zaklad_url = Deno.env.get('SUPABASE_URL') ?? '';

  const obrazky = (data ?? [])
    // Úložiště občas vrací pomocný záznam prázdné složky, ten do výpisu nepatří.
    .filter((s) => s.name && s.name !== '.emptyFolderPlaceholder')
    .map((s) => ({
      nazev: s.name,
      adresa: `${zaklad_url}/storage/v1/object/public/${BUCKET_OBRAZKY}/${s.name}`,
    }));

  return odpoved(req, { obrazky });
}

// ---------------------------------------------------------------------------
// VSTUPNÍ BOD
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: hlavickyCors(req) });
  }

  if (req.method !== 'POST') {
    return chyba(req, 'Nepodporovaný způsob volání.', 405);
  }

  const url = Deno.env.get('SUPABASE_URL');
  const servisniKlic = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!url || !servisniKlic) {
    console.error('Chybí SUPABASE_URL nebo SUPABASE_SERVICE_ROLE_KEY.');
    return chyba(
      req,
      'Administrace není správně nastavená. Ozvěte se prosím správci webu.',
      500,
    );
  }

  const klient = createClient(url, servisniKlic, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Ověření správce se dělá dřív, než se vůbec čte tělo požadavku.
  const overeni = await overSpravce(req, klient);
  if ('odmitnuto' in overeni) return overeni.odmitnuto;

  let telo: Record<string, unknown>;
  try {
    telo = (await req.json()) as Record<string, unknown>;
  } catch {
    return chyba(req, 'Požadavek se nepodařilo přečíst.', 400);
  }

  const akce = typeof telo.akce === 'string' ? telo.akce : '';

  switch (akce) {
    case 'prihlasky':
      return await seznamPrihlasek(req, klient);
    case 'zmen-stav':
      return await zmenStav(req, klient, telo);
    case 'schval':
      return await schval(req, klient, telo, overeni.spravce);
    case 'dohledej-souradnice':
      return await dohledejSouradnice(req, klient, telo);
    case 'obsah':
      return await seznamObsahu(req, klient);
    case 'uloz-obsah':
      return await ulozObsah(req, klient, telo, overeni.spravce);
    case 'zrus-obsah':
      return await zrusObsah(req, klient, telo);
    case 'adresa-pro-nahrani':
      return await adresaProNahrani(req, klient, telo);
    case 'obrazky':
      return await seznamObrazku(req, klient);
    // Slouží k tomu, aby administrace hned po přihlášení poznala,
    // jestli má účet vůbec přístup.
    case 'kdo-jsem':
      return odpoved(req, { email: overeni.spravce.email });
    default:
      return chyba(req, `Neznámý požadavek „${akce}".`, 400);
  }
});
