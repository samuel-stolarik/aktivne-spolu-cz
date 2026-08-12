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

// ---------------------------------------------------------------------------
// NASTAVENÍ
// ---------------------------------------------------------------------------

/** Bucket, kam se ukládají obrázky použité na webu. */
const BUCKET_OBRAZKY = 'obsah-obrazky';

/** Jak dlouho platí jednorázová adresa pro nahrání obrázku (v sekundách). */
const PLATNOST_ADRESY_S = 120;

/** Povolené stavy přihlášky. Musí sedět s podmínkou v migraci přihlášek. */
const STAVY = ['nova', 'zaplaceno', 'zruseno'] as const;

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
  'napad_na_aktivitu',
  'forma_platby',
  'variabilni_symbol',
  'stav',
  'faktura_cislo',
].join(', ');

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
