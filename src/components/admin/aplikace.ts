/**
 * Řízení celé administrace: přihlášení, odhlášení a přepínání záložek.
 *
 * Nepřihlášený člověk vidí JEN přihlašovací formulář. Data se nenačítají
 * a nikde nečekají — načíst je jde teprve po ověření, a to ověření dělá
 * server, ne prohlížeč. Skrytí obsahu v prohlížeči je jen slušnost
 * k uživateli, ne zabezpečení; to je až v Edge Funkci.
 */
import {
  ceskyDuvodPrihlaseni,
  ChybaAdministrace,
  JE_NASTAVENO,
  klient,
  zavolej,
} from "./klient";
import { nactiPrihlasky, pripravPrihlasky } from "./prihlasky";
import { nactiTexty, pripravTexty } from "./texty";
import { nactiObrazky, pripravObrazky } from "./obrazky";
import { sHlasenim, ukazStav } from "./stav";

function prvek<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

/** Které záložky se už načetly, ať se data netahají pokaždé znovu. */
const nactene = new Set<string>();

// ---------------------------------------------------------------------------
// PŘEPÍNÁNÍ ZÁLOŽEK
// ---------------------------------------------------------------------------

function prepniZalozku(nazev: string): void {
  for (const tlacitko of document.querySelectorAll<HTMLButtonElement>("[data-zalozka]")) {
    const jeAktivni = tlacitko.dataset.zalozka === nazev;
    tlacitko.setAttribute("aria-selected", jeAktivni ? "true" : "false");
    tlacitko.tabIndex = jeAktivni ? 0 : -1;
  }

  for (const panel of document.querySelectorAll<HTMLElement>("[data-panel]")) {
    panel.hidden = panel.dataset.panel !== nazev;
  }

  // Data záložky se stahují až ve chvíli, kdy se na ni člověk podívá.
  if (nactene.has(nazev)) return;
  nactene.add(nazev);

  if (nazev === "prihlasky") void nactiPrihlasky();
  if (nazev === "texty") void nactiTexty();
  if (nazev === "obrazky") void nactiObrazky();
}

// ---------------------------------------------------------------------------
// PŘEPÍNÁNÍ MEZI PŘIHLÁŠENÍM A ADMINISTRACÍ
// ---------------------------------------------------------------------------

function ukazPrihlaseni(): void {
  nactene.clear();
  prvek("prihlaseni")!.hidden = false;
  prvek("administrace")!.hidden = true;
  prvek("radek-uctu")!.hidden = true;
  prvek<HTMLInputElement>("pole-email")?.focus();
}

function ukazAdministraci(email: string): void {
  prvek("prihlaseni")!.hidden = true;
  prvek("administrace")!.hidden = false;

  const radek = prvek("radek-uctu")!;
  radek.hidden = false;
  prvek("jmeno-uctu")!.textContent = email;

  prepniZalozku("prihlasky");
}

/**
 * Ověří u serveru, jestli má přihlášený účet do administrace přístup.
 *
 * Nestačí, že je někdo přihlášený — musí být na jmenném seznamu správců.
 * Ověřuje to Edge Funkce, tady se jen zobrazí výsledek.
 */
async function overPristup(): Promise<void> {
  const hlaska = prvek("hlaska-prihlaseni");

  try {
    ukazStav(hlaska, "probiha", "Ověřuji přístup…");
    const kdo = await zavolej<{ email: string }>("kdo-jsem");
    ukazStav(hlaska, "nic");
    ukazAdministraci(kdo.email);
  } catch (chyba) {
    const veta =
      chyba instanceof ChybaAdministrace
        ? chyba.message
        : "Nepodařilo se ověřit přístup. Zkuste to prosím znovu.";

    // Účet je platný, ale nemá oprávnění → odhlásit, ať se administrace
    // netváří, že je člověk „napůl přihlášený".
    if (chyba instanceof ChybaAdministrace && chyba.stav === 403) {
      await klient().auth.signOut();
    }

    ukazPrihlaseni();
    ukazStav(hlaska, "chyba", veta, {
      popis: "Zkusit znovu",
      spust: () => void overPristup(),
    });
  }
}

// ---------------------------------------------------------------------------
// PŘIHLÁŠENÍ A ODHLÁŠENÍ
// ---------------------------------------------------------------------------

async function prihlas(email: string, heslo: string): Promise<void> {
  const hlaska = prvek("hlaska-prihlaseni");
  const tlacitko = prvek<HTMLButtonElement>("tlacitko-prihlasit");

  if (!email.trim() || !heslo) {
    ukazStav(hlaska, "chyba", "Vyplňte prosím e-mail i heslo.");
    return;
  }

  const vysledek = await sHlasenim(
    hlaska,
    { probiha: "Přihlašuji…", hotovo: "Přihlášeno." },
    async () => {
      const { error } = await klient().auth.signInWithPassword({
        email: email.trim(),
        password: heslo,
      });
      if (error) throw new Error(ceskyDuvodPrihlaseni(error.message));
      return true;
    },
    { tlacitko },
  );

  if (!vysledek) return;

  // Heslo v poli nenecháváme ani na chvíli déle, než je nutné.
  const poleHesla = prvek<HTMLInputElement>("pole-heslo");
  if (poleHesla) poleHesla.value = "";

  await overPristup();
}

async function odhlas(): Promise<void> {
  const tlacitko = prvek<HTMLButtonElement>("tlacitko-odhlasit");
  if (tlacitko) tlacitko.disabled = true;

  try {
    await klient().auth.signOut();
  } catch (chyba) {
    console.error("Odhlášení selhalo:", chyba);
  } finally {
    if (tlacitko) tlacitko.disabled = false;
    ukazPrihlaseni();
    ukazStav(prvek("hlaska-prihlaseni"), "hotovo", "Jste odhlášeni.");
  }
}

// ---------------------------------------------------------------------------
// SPUŠTĚNÍ
// ---------------------------------------------------------------------------

export async function spustAdministraci(): Promise<void> {
  // Bez adresy databáze a klíče nemá smysl nic zkoušet. Řekněme to rovnou
  // a slovy, místo aby formulář mlčky nefungoval.
  if (!JE_NASTAVENO) {
    prvek("prihlaseni")!.hidden = true;
    prvek("administrace")!.hidden = true;
    const chyba = prvek("chyba-nastaveni")!;
    chyba.hidden = false;
    return;
  }

  prvek<HTMLFormElement>("formular-prihlaseni")?.addEventListener("submit", (udalost) => {
    udalost.preventDefault();
    void prihlas(
      prvek<HTMLInputElement>("pole-email")?.value ?? "",
      prvek<HTMLInputElement>("pole-heslo")?.value ?? "",
    );
  });

  prvek<HTMLButtonElement>("tlacitko-odhlasit")?.addEventListener("click", () => {
    void odhlas();
  });

  for (const tlacitko of document.querySelectorAll<HTMLButtonElement>("[data-zalozka]")) {
    tlacitko.addEventListener("click", () => prepniZalozku(tlacitko.dataset.zalozka!));
  }

  pripravPrihlasky();
  pripravTexty();
  pripravObrazky();

  // Když přihlášení vyprší uprostřed práce, vrátíme se na přihlašovací
  // formulář. Jinak by tlačítka přestala fungovat a nebylo by jasné proč.
  klient().auth.onAuthStateChange((udalost) => {
    if (udalost === "SIGNED_OUT") ukazPrihlaseni();
  });

  // Přihlášení z minule přežívá zavření okna. Když platí, jde se rovnou dál.
  const { data } = await klient().auth.getSession();
  if (data.session) {
    await overPristup();
  } else {
    ukazPrihlaseni();
  }
}
