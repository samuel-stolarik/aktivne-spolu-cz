/**
 * SPAYD — "Short Payment Descriptor", český standard pro QR platbu.
 *
 * Je to jeden textový řádek, který se zakóduje do QR kódu. Když ho člověk
 * naskenuje mobilním bankovnictvím, předvyplní se mu příkaz k úhradě.
 * Vypadá takhle:
 *
 *   SPD*1.0*ACC:CZ6508000000192000145399*AM:500.00*CC:CZK*X-VS:26030001*MSG:REGISTRACNI POPLATEK
 *
 * Jednotlivé části odděluje hvězdička, proto se hvězdička nesmí objevit
 * uvnitř žádné hodnoty (ve zprávě ji proto mažeme).
 *
 * Použití v tomhle projektu: registrační poplatek za přihlášku do akce.
 *
 * Příklad:
 *   import { sestavSpayd, REGISTRACNI_POPLATEK_KC } from "./spayd";
 *   const spayd = sestavSpayd({
 *     iban: "CZ6508000000192000145399",
 *     castka: REGISTRACNI_POPLATEK_KC,
 *     vs: "26030001",
 *     zprava: "Registrační poplatek 26/03/001",
 *     splatnost: "2026-09-15",
 *   });
 */

import { jePlatnyIban, normalizujIban } from "./iban";

/** Registrační poplatek za přihlášku do akce (v korunách). */
export const REGISTRACNI_POPLATEK_KC = 500;

export interface UdajePlatby {
  /** IBAN účtu příjemce. Povinný, ověřuje se kontrolním součtem. */
  iban: string;
  /** Částka v korunách, musí být větší než nula. */
  castka: number;
  /** Variabilní symbol — jen číslice, nejvýš 10. Nepovinný, ale doporučený. */
  vs?: string | null;
  /** Zpráva pro příjemce. Zkrátí se na 60 znaků a zbaví diakritiky. */
  zprava?: string | null;
  /** Datum splatnosti ve tvaru YYYY-MM-DD. Nepovinné. */
  splatnost?: string | null;
  /** Měna, výchozí CZK. Jiná měna se v tomhle projektu nepoužívá. */
  mena?: string;
}

/**
 * Sestaví SPAYD řetězec.
 *
 * Když jsou vstupy špatně, vyhodí chybu s českým popisem — schválně
 * nevrací potichu `null`. Tiché selhání by znamenalo QR kód, který se
 * prostě nezobrazí, a nikdo by nevěděl proč.
 */
export function sestavSpayd(udaje: UdajePlatby): string {
  const iban = normalizujIban(udaje.iban);
  if (!iban) {
    throw new Error("Chybí IBAN účtu příjemce, QR platbu nelze vytvořit.");
  }
  if (!jePlatnyIban(iban)) {
    throw new Error(`IBAN "${udaje.iban}" není platný (nesedí kontrolní součet).`);
  }

  if (!Number.isFinite(udaje.castka) || udaje.castka <= 0) {
    throw new Error("Částka musí být kladné číslo.");
  }

  const mena = (udaje.mena ?? "CZK").toUpperCase();
  if (!/^[A-Z]{3}$/.test(mena)) {
    throw new Error(`Měna "${udaje.mena}" není trojpísmenný kód (např. CZK).`);
  }

  // Pořadí částí: SPD a verze musí být první, zbytek podle standardu.
  const casti: string[] = [
    "SPD*1.0",
    `ACC:${iban}`,
    `AM:${naformatujCastku(udaje.castka)}`,
    `CC:${mena}`,
  ];

  const splatnost = naformatujDatum(udaje.splatnost);
  if (splatnost) casti.push(`DT:${splatnost}`);

  const vs = normalizujVs(udaje.vs);
  if (vs) casti.push(`X-VS:${vs}`);

  const zprava = ocistiZpravu(udaje.zprava);
  if (zprava) casti.push(`MSG:${zprava}`);

  return casti.join("*");
}

/** Částka vždy na dvě desetinná místa, s tečkou (ne s čárkou). */
export function naformatujCastku(castka: number): string {
  return castka.toFixed(2);
}

/**
 * Variabilní symbol smí být jen číslice a nejvýš deset.
 * Cokoli jiného (pomlčky, mezery, lomítka) vyhodíme.
 * Vrací `null`, když po očištění nic nezbyde nebo je číslo moc dlouhé.
 */
export function normalizujVs(vs: string | null | undefined): string | null {
  if (!vs) return null;
  const cislice = String(vs).replace(/\D+/g, "");
  if (!cislice || cislice.length > 10) return null;
  return cislice;
}

/** Datum z tvaru 2026-09-15 na tvar 20260915, který SPAYD vyžaduje. */
export function naformatujDatum(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const shoda = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return shoda ? `${shoda[1]}${shoda[2]}${shoda[3]}` : null;
}

/**
 * Připraví zprávu pro příjemce:
 *  - odstraní diakritiku (některé banky háčky a čárky nezobrazí správně)
 *  - vyhodí hvězdičku (ta odděluje části SPAYD řetězce) a konce řádků
 *  - sloučí opakované mezery
 *  - zkrátí na 60 znaků, delší zprávu standard nepovoluje
 */
export function ocistiZpravu(zprava: string | null | undefined): string {
  if (!zprava) return "";
  return odstranDiakritiku(String(zprava))
    .replace(/[*\r\n\t]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

/** "Registrační poplatek" -> "Registracni poplatek" */
export function odstranDiakritiku(text: string): string {
  // normalize("NFD") rozloží "č" na "c" + samostatný háček,
  // druhý krok pak všechna taková znaménka smaže.
  // Rozsah U+0300 az U+036F je misto, kde Unicode drzi hacky a carky.
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
