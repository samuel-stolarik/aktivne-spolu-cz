/**
 * Hlášky o průběhu — „pracuji", „hotovo", „nepovedlo se".
 *
 * PRAVIDLO, KTERÉ TENHLE SOUBOR VYNUCUJE
 * Nikdy nesmí zůstat na obrazovce věčně točící se kolečko. Každá akce
 * skončí buď hlášením, že je hotovo, nebo VĚTOU, co se nepovedlo, a nabídkou
 * zkusit to znovu. Když člověk neví, jestli se něco stalo, přestane
 * administraci věřit.
 *
 * Proto se stav vždycky píše SLOVY. Barva a ikona jsou jen doplněk —
 * samotná barva by lidem s poruchou barvocitu nic neřekla.
 */

/**
 * Stavy, ve kterých se úprava může nacházet.
 *
 *   rozepsano — je něco napsaného, ale ještě to nikam neodešlo
 *   probiha   — právě se ukládá
 *   hotovo    — uloženo
 *   chyba     — nepovedlo se, a je napsané proč
 */
export type DruhStavu = "nic" | "rozepsano" | "probiha" | "hotovo" | "chyba";

/** Nabídka „zkusit znovu" u chybové hlášky. */
export interface Opakovani {
  popis: string;
  spust: () => void;
}

const ZNACKA: Record<Exclude<DruhStavu, "nic">, string> = {
  rozepsano: "✎",
  probiha: "…",
  hotovo: "✓",
  chyba: "!",
};

/**
 * Vypíše stav do zadaného místa na stránce.
 *
 * @param misto     Prvek, do kterého se hláška vypisuje.
 * @param druh      „nic" hlášku smaže.
 * @param text      Celá věta česky. U chyby konkrétně, co se nepovedlo.
 * @param opakovani Nepovinné tlačítko, kterým jde akci spustit znovu.
 */
export function ukazStav(
  misto: HTMLElement | null,
  druh: DruhStavu,
  text = "",
  opakovani?: Opakovani,
): void {
  if (!misto) return;

  misto.textContent = "";

  if (druh === "nic") {
    misto.removeAttribute("data-stav");
    return;
  }

  misto.setAttribute("data-stav", druh);

  // Čtečka obrazovky musí změnu oznámit. Chyba je naléhavá, zbytek zdvořilý.
  //
  // Poznámka: „rozepsáno" se hlásí taky. Člověk, který nevidí na obrazovku,
  // by jinak nevěděl, že se změna zatím nikam neuložila.
  misto.setAttribute("role", druh === "chyba" ? "alert" : "status");
  misto.setAttribute("aria-live", druh === "chyba" ? "assertive" : "polite");

  const znacka = document.createElement("span");
  znacka.setAttribute("aria-hidden", "true");
  znacka.className = "admin-znacka";
  znacka.textContent = ZNACKA[druh];

  const veta = document.createElement("span");
  veta.textContent = text;

  misto.append(znacka, veta);

  if (opakovani) {
    const tlacitko = document.createElement("button");
    tlacitko.type = "button";
    tlacitko.className = "admin-znovu";
    tlacitko.textContent = opakovani.popis;
    tlacitko.addEventListener("click", opakovani.spust);
    misto.append(tlacitko);
  }
}

// ---------------------------------------------------------------------------
// HLÍDÁNÍ ROZEPSANÝCH ZMĚN
// ---------------------------------------------------------------------------
// Rozepsaný text nesmí zmizet jen tak. Když správce zavře okno nebo obnoví
// stránku a má něco neuloženého, prohlížeč se ho zeptá.
//
// Vede se to na jednom místě, protože rozepsané může být jak políčko
// v seznamu, tak kartička nad náhledem webu.

const rozepsane = new Set<string>();

function varovaniPredZavrenim(udalost: BeforeUnloadEvent): void {
  udalost.preventDefault();
  // Starší prohlížeče se bez tohohle nezeptají.
  udalost.returnValue = "";
}

/**
 * Zapíše nebo smaže poznámku „tady je něco rozepsaného".
 *
 * @param oznaceni Cokoli, co tu jednu rozepsanou věc jednoznačně určí.
 */
export function oznacRozepsane(oznaceni: string, jeRozepsano: boolean): void {
  if (jeRozepsano) rozepsane.add(oznaceni);
  else rozepsane.delete(oznaceni);

  window.removeEventListener("beforeunload", varovaniPredZavrenim);
  if (rozepsane.size > 0) {
    window.addEventListener("beforeunload", varovaniPredZavrenim);
  }
}

/** Je rozepsané zrovna tohle? */
export function jeRozepsane(oznaceni: string): boolean {
  return rozepsane.has(oznaceni);
}

/**
 * Obalí akci hlášením o průběhu.
 *
 * Postará se o celý cyklus: napíše „pracuji", po úspěchu „hotovo", po chybě
 * konkrétní větu a tlačítko zkusit to znovu. Zároveň po dobu práce zamkne
 * tlačítko, aby se akce nespustila dvakrát.
 *
 * @returns Výsledek akce, nebo `undefined` když se nepovedla.
 */
export async function sHlasenim<T>(
  misto: HTMLElement | null,
  popisky: { probiha: string; hotovo: string },
  akce: () => Promise<T>,
  moznostiNavic?: { tlacitko?: HTMLButtonElement | null; zopakovat?: () => void },
): Promise<T | undefined> {
  const tlacitko = moznostiNavic?.tlacitko ?? null;

  ukazStav(misto, "probiha", popisky.probiha);
  if (tlacitko) tlacitko.disabled = true;

  try {
    const vysledek = await akce();
    ukazStav(misto, "hotovo", popisky.hotovo);
    return vysledek;
  } catch (chyba) {
    const veta =
      chyba instanceof Error && chyba.message
        ? chyba.message
        : "Něco se nepovedlo. Zkuste to prosím znovu.";

    ukazStav(
      misto,
      "chyba",
      veta,
      moznostiNavic?.zopakovat
        ? { popis: "Zkusit znovu", spust: moznostiNavic.zopakovat }
        : undefined,
    );
    return undefined;
  } finally {
    if (tlacitko) tlacitko.disabled = false;
  }
}
