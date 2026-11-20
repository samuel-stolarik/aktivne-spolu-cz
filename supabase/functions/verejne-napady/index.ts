// Veřejný výdej Zásobníku nápadů.
//
// Vrací JEN schválené zápisy a JEN pole, která jsou vypsaná ve funkci
// `verejnaPodoba` (supabase/functions/_shared/verejny-napad.ts). Neveřejný
// vzkaz, jméno kontaktní osoby, souhlasy, důvody vrácení, záznam úprav
// správcem ani nic z přihlášky (faktury, platba) ven nejde. Veřejná
// Poznámka/komentář jde ven, jen když to dovolí POZNAMKA_JE_VEREJNA.
//
// Kontakt (e-mail, telefon) se vydá jen ten, se zveřejněním kterého
// pořadatel souhlasil (`verejny_kontakt`).
//
// U jednotlivce se nevydává ani název pořadatele, protože je to jméno
// člověka. Stejné pravidlo platí na mapě (`verejne-akce`).
//
// Fotky jsou v soukromém bucketu. Funkce k nim vydá podepsané adresy
// s omezenou platností. Odpověď se proto ukládá do mezipaměti kratší dobu,
// než adresy platí.
//
//   GET                → { napady: [...] }   seznam, u každého titulní fotka
//   GET ?id=<uuid>     → { napad: {...} }    detail se všemi fotkami

import { createClient } from 'npm:@supabase/supabase-js@2';
import { SLOUPCE_VEREJNE, verejnaPodoba } from '../_shared/verejny-napad.ts';

const BUCKET = 'napady-fotky';

/** Platnost podepsané adresy fotky (s). */
const PLATNOST_FOTKY_S = 6 * 3600;

/** Jak dlouho smí prohlížeč a CDN odpověď držet (s). Musí být kratší než platnost fotek. */
const MEZIPAMET_S = 300;

const HLAVICKY_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

function odpoved(telo: unknown, stav = 200, mezipamet = 0): Response {
  return new Response(JSON.stringify(telo), {
    status: stav,
    headers: {
      ...HLAVICKY_CORS,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': mezipamet > 0 ? `public, max-age=${mezipamet}` : 'no-store',
    },
  });
}

function chyba(veta: string, stav: number): Response {
  return odpoved({ chyba: veta }, stav);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: HLAVICKY_CORS });
  if (req.method !== 'GET') return chyba('Nepodporovaný způsob volání.', 405);

  const url = Deno.env.get('SUPABASE_URL');
  const servisniKlic = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !servisniKlic) {
    console.error('Chybí SUPABASE_URL nebo SUPABASE_SERVICE_ROLE_KEY.');
    return chyba('Zásobník se teď nepodařilo načíst. Zkuste to prosím později.', 500);
  }

  const klient = createClient(url, servisniKlic, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const id = new URL(req.url).searchParams.get('id');
  if (id !== null && !/^[0-9a-f-]{36}$/i.test(id)) {
    return chyba('Tenhle nápad neznáme. Vraťte se prosím do Zásobníku.', 404);
  }

  let dotaz = klient.from('napady').select(SLOUPCE_VEREJNE).eq('stav', 'schvaleno');
  if (id) dotaz = dotaz.eq('id', id);
  const { data, error } = await dotaz.order('schvaleno_kdy', { ascending: false }).limit(500);

  if (error) {
    console.error('Načtení nápadů selhalo:', error.message);
    return chyba('Zásobník se teď nepodařilo načíst. Zkuste to prosím za chvíli.', 503);
  }

  const radky = (data ?? []) as unknown as Record<string, unknown>[];
  if (id && !radky.length) {
    return chyba('Tenhle nápad v Zásobníku není. Vraťte se prosím na přehled.', 404);
  }

  // V seznamu stačí titulní fotka, v detailu jsou všechny.
  const cesty = radky.flatMap((r) => {
    const f = Array.isArray(r.fotky) ? (r.fotky as string[]) : [];
    return id ? f : f.slice(0, 1);
  });

  const podepsane = new Map<string, string>();
  if (cesty.length) {
    const { data: adresy, error: chybaFotek } = await klient.storage
      .from(BUCKET)
      .createSignedUrls(cesty, PLATNOST_FOTKY_S);
    if (chybaFotek) console.error('Adresy fotek se nepodařilo podepsat:', chybaFotek.message);
    for (const a of adresy ?? []) {
      if (a.path && a.signedUrl) podepsane.set(a.path, a.signedUrl);
    }
  }

  const napady = radky.map((r) => {
    const f = Array.isArray(r.fotky) ? (r.fotky as string[]) : [];
    const vybrane = (id ? f : f.slice(0, 1)).map((c) => podepsane.get(c)).filter(
      (x): x is string => Boolean(x),
    );
    return verejnaPodoba(r, vybrane);
  });

  return id ? odpoved({ napad: napady[0] }, 200, MEZIPAMET_S) : odpoved({ napady }, 200, MEZIPAMET_S);
});
