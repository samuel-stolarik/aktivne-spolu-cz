/**
 * IBAN — mezinárodní tvar čísla bankovního účtu.
 *
 * Co tenhle soubor umí:
 *  - `normalizujIban`  — odstraní mezery, převede na velká písmena
 *  - `naformatujIban`  — rozdělí IBAN po čtveřicích, aby se dal přečíst
 *  - `jePlatnyIban`    — spočítá kontrolní součet (mod 97) a řekne ano/ne
 *  - `naformatujTuzemskyUcet` — složí české číslo účtu ve tvaru 19-2000145399/0800
 *
 * Proč kontrolní součet:
 * V IBANu jsou dvě číslice hned za kódem země (např. CZ**65**...) kontrolní.
 * Když se někdo v čísle účtu překlepne, kontrolní součet nevyjde a my chybu
 * poznáme dřív, než pošleme QR kód s penězi někam do prázdna.
 *
 * Příklad použití:
 *   import { jePlatnyIban, naformatujIban } from "./iban";
 *   jePlatnyIban("CZ6508000000192000145399");   // true
 *   naformatujIban("cz6508000000192000145399"); // "CZ65 0800 0000 1920 0014 5399"
 */

/** Vyhodí mezery a nedělitelné mezery, převede na velká písmena. */
export function normalizujIban(hodnota: string | null | undefined): string {
  return (hodnota ?? "").replace(/[\s ]+/g, "").toUpperCase();
}

/**
 * Rozdělí IBAN po čtyřech znacích — takhle ho banky tisknou a lidem
 * se v něm líp hledá překlep.
 */
export function naformatujIban(hodnota: string | null | undefined): string {
  return normalizujIban(hodnota).replace(/(.{4})/g, "$1 ").trim();
}

/**
 * Ověří IBAN kontrolním součtem mod 97 (norma ISO 13616).
 *
 * Postup, který norma předepisuje:
 *  1. první čtyři znaky (kód země + kontrolní číslice) přesuneme dozadu
 *  2. písmena nahradíme čísly: A = 10, B = 11, ... Z = 35
 *  3. vznikne obrovské číslo — platný IBAN dá po dělení 97 zbytek 1
 *
 * Dělíme po sedmi číslicích, protože celé číslo by se do běžného
 * JavaScriptového čísla nevešlo a počítalo by se špatně.
 */
export function jePlatnyIban(hodnota: string | null | undefined): boolean {
  const iban = normalizujIban(hodnota);
  // Dvě písmena země, dvě kontrolní číslice, pak 10 až 30 znaků vlastního účtu.
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;

  const prehozeno = iban.slice(4) + iban.slice(0, 4);
  const jenCislice = prehozeno
    .split("")
    .map((znak) => (/[A-Z]/.test(znak) ? (znak.charCodeAt(0) - 55).toString() : znak))
    .join("");

  let zbytek = 0;
  for (let i = 0; i < jenCislice.length; i += 7) {
    zbytek = Number.parseInt(zbytek.toString() + jenCislice.slice(i, i + 7), 10) % 97;
  }
  return zbytek === 1;
}

/**
 * Složí české číslo účtu do tvaru, na jaký jsou lidi zvyklí z výpisu:
 *   předčíslí-číslo/kód banky   (např. 19-2000145399/0800)
 * Předčíslí je nepovinné, většina účtů ho nemá.
 *
 * Vrací prázdný řetězec, když chybí číslo účtu nebo kód banky — z půlky
 * vyplněný účet je horší než žádný, na fakturu by neměl jít.
 */
export function naformatujTuzemskyUcet(
  predcisli: string | null | undefined,
  cisloUctu: string | null | undefined,
  kodBanky: string | null | undefined,
): string {
  const bezMezer = (h: string | null | undefined) => (h ?? "").replace(/[\s ]+/g, "");
  const p = bezMezer(predcisli);
  const c = bezMezer(cisloUctu);
  const k = bezMezer(kodBanky);
  if (!c || !k) return "";
  return `${p ? `${p}-` : ""}${c}/${k}`;
}
