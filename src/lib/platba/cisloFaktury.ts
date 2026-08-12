/**
 * Číslo faktury ve tvaru RR/SS/<variabilní symbol> — například 26/03/100001.
 *
 *   RR  = poslední dvě číslice roku vystavení (2026 -> 26)
 *   SS  = interní číslo řady, dvě číslice. Bere se z env proměnné,
 *         protože si ho určuje účetní organizace, ne aplikace.
 *   VS  = variabilní symbol přihlášky. Šest a víc číslic (řada začíná
 *         na 100001), nejvýš deset.
 *
 * ------------------------------------------------------------------
 * PROČ JE V ČÍSLE FAKTURY VARIABILNÍ SYMBOL
 * ------------------------------------------------------------------
 * Zadavatel chce, aby „variabilní symbol byl stejný jako číslo faktury" —
 * ať se platba na výpisu spáruje s fakturou bez hledání v tabulce.
 *
 * DOSLOVA STEJNÉ TO BÝT NEMŮŽE:
 *   - variabilní symbol smí být jen číslice, nejvýš deset (jde do platebního
 *     řetězce jako `X-VS` a banka jiný tvar nepřijme),
 *   - číslo faktury obsahuje lomítka.
 *
 * Sjednocené je proto POŘADOVÉ ČÍSLO, ne celý řetězec:
 *
 *     variabilní symbol   100001
 *     číslo faktury       26/03/100001
 *
 * Na faktuře i na platbě je tak vidět stejné číslo. Blíž se k „naprosto
 * stejné" dostat nedá.
 *
 * Vedlejší důsledek, o kterém má účetní vědět: řada faktur není souvislá.
 * Kdo se přihlásí a nezaplatí, spotřebuje variabilní symbol, ale fakturu
 * nedostane — v číslech faktur pak zůstane díra.
 *
 * ------------------------------------------------------------------
 * ODKUD SE POŘADOVÉ ČÍSLO BERE
 * ------------------------------------------------------------------
 * Z Postgres sekvence `seq_variabilni_symbol` v Supabase, NE z aplikačního
 * kódu. Je to schválně: kdyby si číslo počítala aplikace („najdi největší
 * a přičti jedna"), mohly by při dvou přihláškách ve stejnou vteřinu vzniknout
 * dvě faktury se stejným číslem. Databázová sekvence stejné číslo nevydá
 * dvakrát.
 *
 * Tenhle soubor tedy jenom SKLÁDÁ a KONTROLUJE řetězec:
 *
 *   -- v Supabase je skládací funkce nasazená, variabilní symbol jí předáváš:
 *   SELECT public.cislo_faktury_pro_vs(2026, '03', 100001);  -- -> "26/03/100001"
 *
 *   -- viz migraci supabase/migrations/20260812170000_cislo_faktury_z_vs.sql
 *
 * Příklad použití:
 *   import { sestavCisloFaktury, nactiCisloRadyZEnv } from "./cisloFaktury";
 *
 *   const cislo = sestavCisloFaktury({
 *     rok: 2026,
 *     cisloRady: nactiCisloRadyZEnv(import.meta.env),
 *     variabilniSymbol: 100001,   // z přihlášky, ne vymyšlené
 *   });
 *   // -> "26/03/100001"
 *
 * Sekvence `seq_faktura_poradi` a funkce `dalsi_cislo_faktury(rok, rada)`,
 * které dřív dávaly samostatné třímístné pořadí (26/03/001), se už nepoužívají.
 */

/**
 * Tvar, který uznáváme: dvě číslice / dvě číslice / šest až deset číslic.
 *
 * Spodní hranice je šest, protože řada variabilních symbolů začíná na 100001.
 * Horní je deset — delší variabilní symbol banky u QR platby odmítají, takže
 * takové číslo faktury by znamenalo, že se někde stala chyba.
 *
 * Starý tvar s třímístným pořadím (26/03/001) tímhle NEPROJDE. Je to záměr:
 * kdyby se někde takové číslo objevilo, pochází z původní zrušené řady a je
 * lepší se o tom dozvědět hned.
 */
export const TVAR_CISLA_FAKTURY = /^(\d{2})\/(\d{2})\/(\d{6,10})$/;

/** Název env proměnné s interním číslem řady. */
export const ENV_KLIC_CISLO_RADY = "FAKTURY_CISLO_RADY";

/** Od kolika začíná řada variabilních symbolů (viz `seq_variabilni_symbol`). */
export const PRVNI_VARIABILNI_SYMBOL = 100001;

/** Nejvyšší povolený počet číslic variabilního symbolu, daný bankami. */
export const MAX_CISLIC_VS = 10;

export interface DilyCislaFaktury {
  /** Rok vystavení. Přijme 2026 i 26, obojí dá "26". */
  rok: number | string;
  /** Interní číslo řady, dvě číslice (např. "03" nebo 3). */
  cisloRady: number | string;
  /**
   * Variabilní symbol přihlášky. Slouží zároveň jako pořadové číslo faktury.
   * Musí přijít z databáze, nikdy se nedopočítává tady.
   */
  variabilniSymbol: number;
}

/**
 * Složí číslo faktury. Když je něco špatně, vyhodí chybu s českým
 * vysvětlením — číslo faktury je účetní údaj, tady se nic „nějak" neošetří.
 */
export function sestavCisloFaktury(dily: DilyCislaFaktury): string {
  const rr = dvouciferny(dily.rok, "rok");
  const ss = dvouciferny(dily.cisloRady, "číslo řady");

  const vs = dily.variabilniSymbol;
  if (!Number.isInteger(vs) || vs < PRVNI_VARIABILNI_SYMBOL) {
    throw new Error(
      `Variabilní symbol musí být celé číslo od ${PRVNI_VARIABILNI_SYMBOL} výš, dostali jsme "${vs}". ` +
        `Nižší číslo znamená, že nepochází ze sekvence seq_variabilni_symbol.`,
    );
  }
  const text = String(vs);
  if (text.length > MAX_CISLIC_VS) {
    throw new Error(
      `Variabilní symbol ${text} má víc než ${MAX_CISLIC_VS} číslic, banky takový u QR platby nepřijmou.`,
    );
  }

  // Doplňovat zleva nulami není co — řada začíná na 100001, takže je pořadí
  // vždycky aspoň šestimístné.
  return `${rr}/${ss}/${text}`;
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
): { rok: string; cisloRady: string; variabilniSymbol: number } | null {
  const shoda = (cislo ?? "").trim().match(TVAR_CISLA_FAKTURY);
  if (!shoda) return null;
  return {
    rok: shoda[1]!,
    cisloRady: shoda[2]!,
    variabilniSymbol: Number(shoda[3]),
  };
}

/**
 * Vytáhne z čísla faktury variabilní symbol.
 *
 * Od sjednocení řad je to prostě poslední část za lomítkem — z "26/03/100001"
 * vypadne "100001". Dřív se z čísla škrtaly lomítka a vznikalo z toho úplně
 * jiné číslo ("2603001"); to už neplatí a platilo by to špatně, protože rok
 * a řada do variabilního symbolu nepatří.
 */
export function variabilniSymbolZCisla(cislo: string): string {
  const dily = rozlozCisloFaktury(cislo);
  if (!dily) {
    throw new Error(`"${cislo}" není číslo faktury ve tvaru RR/SS/<variabilní symbol>.`);
  }
  return String(dily.variabilniSymbol);
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
