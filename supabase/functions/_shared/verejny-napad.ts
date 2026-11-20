// Veřejná podoba nápadu — co smí ven do Zásobníku.
//
// Používá ji `verejne-napady` (web) i `admin-obsah` (náhled pro správce, jak
// bude nápad vypadat po zveřejnění). Díky tomu náhled ukazuje přesně to,
// co pak uvidí návštěvníci, a nic navíc.
//
// Neveřejný vzkaz, jméno kontaktní osoby, souhlasy, důvody vrácení, záznam
// úprav správcem ani nic z přihlášky (faktury, platba) ven nejde.

import { POZNAMKA_JE_VEREJNA } from './ciselnik-napadu.ts';

/** Sloupce, které se kvůli veřejné podobě čtou z tabulky `napady`. */
export const SLOUPCE_VEREJNE =
  'id, schvaleno_kdy, typ_poradatele, nazev_poradatele, email, telefon, mesto, kraj, ' +
  'nazev_akce, typ, podtyp, podtyp_jine, pomucky_potreba, pomucky_jake, ' +
  'vek, zdatnost, delka, misto_konani, rozpocet, poznamka, popis, datum_akce, fotky, verejny_kontakt';

/** U jednotlivce se název pořadatele nevydává, protože je to jméno člověka. */
const NAZEV_JE_VEREJNY = new Set(['skola', 'organizace']);

/**
 * Staví se NOVÝ objekt pole po poli, nekopíruje se řádek z databáze.
 * Co tu není vypsané, ven nejde.
 */
export function verejnaPodoba(r: Record<string, unknown>, fotky: string[]) {
  const kontakt = Array.isArray(r.verejny_kontakt) ? (r.verejny_kontakt as string[]) : [];
  const typPoradatele = String(r.typ_poradatele ?? '');
  const poznamka = typeof r.poznamka === 'string' && r.poznamka.trim() ? r.poznamka : null;

  return {
    id: String(r.id),
    zverejneno: (r.schvaleno_kdy as string | null) ?? null,
    typ_poradatele: typPoradatele,
    nazev_poradatele: NAZEV_JE_VEREJNY.has(typPoradatele)
      ? String(r.nazev_poradatele ?? '')
      : null,
    mesto: String(r.mesto ?? ''),
    kraj: String(r.kraj ?? ''),
    nazev_akce: String(r.nazev_akce ?? ''),
    typ: String(r.typ ?? ''),
    podtyp: String(r.podtyp ?? ''),
    podtyp_jine: r.podtyp === 'jine' ? String(r.podtyp_jine ?? '') : null,
    pomucky_potreba: r.pomucky_potreba === true,
    pomucky_jake: r.pomucky_potreba === true ? ((r.pomucky_jake as string | null) ?? null) : null,
    vek: Array.isArray(r.vek) ? (r.vek as string[]) : [],
    zdatnost: Array.isArray(r.zdatnost) ? (r.zdatnost as string[]) : [],
    delka: String(r.delka ?? ''),
    // Starší zápisy tyhle dvě pole nemají (null → na webu „neuvedeno").
    misto_konani: (r.misto_konani as string | null) ?? null,
    rozpocet: (r.rozpocet as string | null) ?? null,
    poznamka: POZNAMKA_JE_VEREJNA ? poznamka : null,
    popis: String(r.popis ?? ''),
    datum_akce: (r.datum_akce as string | null) ?? null,
    kontakt: {
      email: kontakt.includes('email') ? String(r.email ?? '') || null : null,
      telefon: kontakt.includes('telefon') ? String(r.telefon ?? '') || null : null,
    },
    fotky,
  };
}

export type VerejnyNapadZFunkce = ReturnType<typeof verejnaPodoba>;
