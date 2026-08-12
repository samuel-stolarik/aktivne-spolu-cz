/**
 * Číslo faktury ve tvaru RR/SS/NNN — například 26/03/001.
 *
 *   RR  = poslední dvě číslice roku vystavení (2026 -> 26)
 *   SS  = interní číslo řady, dvě číslice. Bere se z env proměnné,
 *         protože si ho určuje účetní organizace, ne aplikace.
 *   NNN = pořadí faktury v řadě, zleva doplněné nulami na tři místa.
 *
 * ------------------------------------------------------------------
 * ODKUD SE BERE POŘADOVÉ ČÍSLO
 * ------------------------------------------------------------------
 * Z Postgres sekvence v Supabase, NE z aplikačního kódu. Je to schválně:
 * kdyby si pořadí počítala aplikace ("najdi největší číslo a přičti jedna"),
 * mohly by se při dvou přihláškách ve stejnou vteřinu vystavit dvě faktury
 * se stejným číslem. To je v účetnictví problém, který se špatně opravuje.
 * Databázová sekvence stejné číslo nikdy nevydá dvakrát.
 *
 * Tenhle soubor tedy jenom SKLÁDÁ a KONTROLUJE řetězec. Číslo si musí
 * volající vyžádat z databáze, například:
 *
 *   -- v Supabase je sekvence i skládací funkce už nasazená:
 *   SELECT public.dalsi_cislo_faktury(2026, '03');  -- -> "26/03/001"
 *
 *   -- pod tím běží sekvence seq_faktura_poradi, viz migraci
 *   -- supabase/migrations/20260812120000_prihlasky.sql
 *
 * Příklad použití:
 *   import { sestavCisloFaktury, nactiCisloRadyZEnv } from "./cisloFaktury";
 *
 *   const poradi = await ziskejDalsiPoradiZeSekvence();   // třeba 1
 *   const cislo = sestavCisloFaktury({
 *     rok: 2026,
 *     cisloRady: nactiCisloRadyZEnv(import.meta.env),
 *     poradi,
 *   });
 *   // -> "26/03/001"
 */

/** Tvar, který uznáváme: dvě číslice / dvě číslice / nejméně tři číslice. */
export const TVAR_CISLA_FAKTURY = /^(\d{2})\/(\d{2})\/(\d{3,})$/;

/** Název env proměnné s interním číslem řady. */
export const ENV_KLIC_CISLO_RADY = "FAKTURY_CISLO_RADY";

export interface DilyCislaFaktury {
  /** Rok vystavení. Přijme 2026 i 26, obojí dá "26". */
  rok: number | string;
  /** Interní číslo řady, dvě číslice (např. "03" nebo 3). */
  cisloRady: number | string;
  /** Pořadí faktury v řadě. Musí přijít z databázové sekvence. */
  poradi: number;
}

/**
 * Složí číslo faktury. Když je něco špatně, vyhodí chybu s českým
 * vysvětlením — číslo faktury je účetní údaj, tady se nic „nějak" neošetří.
 */
export function sestavCisloFaktury(dily: DilyCislaFaktury): string {
  const rr = dvouciferny(dily.rok, "rok");
  const ss = dvouciferny(dily.cisloRady, "číslo řady");

  if (!Number.isInteger(dily.poradi) || dily.poradi < 1) {
    throw new Error(`Pořadí faktury musí být celé číslo od 1 výš, dostali jsme "${dily.poradi}".`);
  }
  // Přes 999 řada nepřeteče do chyby, jen se číslo prodlouží na 1000.
  // Radši delší číslo než dvě faktury se stejným.
  const nnn = String(dily.poradi).padStart(3, "0");

  return `${rr}/${ss}/${nnn}`;
}

/** Ověří, že řetězec vypadá jako číslo faktury v naší řadě. */
export function jePlatneCisloFaktury(cislo: string | null | undefined): boolean {
  return TVAR_CISLA_FAKTURY.test((cislo ?? "").trim());
}

/**
 * Rozebere číslo faktury zpátky na části.
 * Vrací `null`, když tvar nesedí — tuhle funkci používáme na čtení
 * uložených hodnot, kde je nesedící tvar očekávaná možnost.
 */
export function rozlozCisloFaktury(
  cislo: string | null | undefined,
): { rok: string; cisloRady: string; poradi: number } | null {
  const shoda = (cislo ?? "").trim().match(TVAR_CISLA_FAKTURY);
  if (!shoda) return null;
  return { rok: shoda[1]!, cisloRady: shoda[2]!, poradi: Number(shoda[3]) };
}

/**
 * Vyrobí z čísla faktury variabilní symbol — jen číslice, bez lomítek.
 * Z "26/03/001" vznikne "2603001". Je to jednoznačné a jde to spárovat
 * s platbou na bankovním výpisu.
 */
export function variabilniSymbolZCisla(cislo: string): string {
  if (!jePlatneCisloFaktury(cislo)) {
    throw new Error(`"${cislo}" není číslo faktury ve tvaru RR/SS/NNN.`);
  }
  const vs = cislo.replace(/\D+/g, "");
  // Variabilní symbol smí mít nejvýš 10 číslic; při přetečení bereme
  // pravou (nejnovější) část, ta odlišuje jednotlivé faktury.
  return vs.length > 10 ? vs.slice(-10) : vs;
}

/**
 * Přečte interní číslo řady z env proměnných.
 * Volá se s `import.meta.env` (Astro) nebo s objektem z `Deno.env.toObject()`.
 */
export function nactiCisloRadyZEnv(
  env: Record<string, unknown> | undefined,
  klic: string = ENV_KLIC_CISLO_RADY,
): string {
  const hodnota = env?.[klic];
  if (hodnota === undefined || hodnota === null || String(hodnota).trim() === "") {
    throw new Error(
      `Chybí proměnná prostředí ${klic} (interní číslo řady faktur, dvě číslice, např. 03).`,
    );
  }
  return dvouciferny(String(hodnota).trim(), "číslo řady");
}

/** Převede rok i číslo řady na dvě číslice. Společné pro obě části. */
function dvouciferny(hodnota: number | string, nazev: string): string {
  const text = String(hodnota).trim();
  if (!/^\d+$/.test(text)) {
    throw new Error(`Hodnota "${hodnota}" pro ${nazev} musí být jen číslice.`);
  }
  if (text.length === 4) return text.slice(2); // 2026 -> 26
  if (text.length === 1) return text.padStart(2, "0"); // 3 -> 03
  if (text.length === 2) return text;
  throw new Error(`Hodnota "${hodnota}" pro ${nazev} musí mít jednu, dvě nebo čtyři číslice.`);
}
