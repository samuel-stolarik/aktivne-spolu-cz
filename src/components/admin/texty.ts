/**
 * Úprava textů a obrázků webu.
 *
 * Upravovat jde dvěma způsoby a oba pracují se stejnými daty (obsahStav.ts):
 *
 *   NÁHLED  — v administraci se ukáže skutečný web a klepnutím na text se
 *             rovnou upravuje. Tenhle způsob je hlavní; obsluhuje ho nahled.ts.
 *   SEZNAM  — políčka pod sebou, u každého popis, kde na webu je. Tenhle
 *             způsob zůstává, protože ne na všechno se dá klepnout: obrázky
 *             v patičce, texty, které se ukážou jen v některém stavu
 *             formuláře, a cokoli, co se v náhledu nepodaří najít.
 *
 * Seznam vykresluje tenhle soubor. Ukládá se po jedné položce — správce vidí
 * u každé zvlášť, jestli se to povedlo, a když vypadne spojení, nepřijde
 * o všechno.
 *
 * Když se text vrátí na původní znění (tlačítkem „Vrátit původní"), řádek
 * se z databáze smaže a web se vrátí k tomu, co je v HTML.
 */
import { KATALOG, skupinyKatalogu, type PolozkaObsahu } from "../../lib/obsah";
import { nahrajObrazek } from "./obrazky";
import {
  jeUpraveno,
  nactiPrepisy,
  priZmeneObsahu,
  ulozZneni,
  vratPuvodniZneni,
  zneni,
} from "./obsahStav";
import {
  jeNahledNacteny,
  nactiNahled,
  nastavPrepnutiNaSeznam,
  pripravNahled,
  zavriUpravu,
} from "./nahled";
import {
  jeRozepsane,
  oznacRozepsane,
  sHlasenim,
  ukazStav,
  type DruhStavu,
} from "./stav";

/**
 * Hláška, která se má objevit na nově vykreslené kartě.
 *
 * Po uložení se karta překreslí (přibude štítek „upraveno" a tlačítko
 * „Vrátit původní"). Kdyby se hláška nepředala, potvrzení „Uloženo" by
 * s původní kartou zmizelo a správce by nevěděl, jestli se změna uložila.
 */
interface HlaskaKarty {
  druh: DruhStavu;
  text: string;
}

/** Vykreslené karty seznamu, aby šly po změně překreslit jednotlivě. */
const karty = new Map<string, HTMLElement>();

// ---------------------------------------------------------------------------
// UKLÁDÁNÍ
// ---------------------------------------------------------------------------

async function ulozPolozku(
  polozka: PolozkaObsahu,
  hodnota: string,
  hlaska: HTMLElement,
  tlacitko: HTMLButtonElement,
  poUlozeni: (hlaskaProNovouKartu: HlaskaKarty) => void,
): Promise<void> {
  const vysledek = await sHlasenim(
    hlaska,
    { probiha: "Ukládám…", hotovo: "Uloženo." },
    () => ulozZneni(polozka, hodnota),
    {
      tlacitko,
      zopakovat: () =>
        void ulozPolozku(polozka, hodnota, hlaska, tlacitko, poUlozeni),
    },
  );

  if (vysledek === undefined) return;

  oznacRozepsane(`seznam:${polozka.klic}`, false);
  poUlozeni({ druh: "hotovo", text: vysledek });
}

async function vratPuvodni(
  polozka: PolozkaObsahu,
  hlaska: HTMLElement,
  tlacitko: HTMLButtonElement,
  poVraceni: (hlaskaProNovouKartu: HlaskaKarty) => void,
): Promise<void> {
  const vysledek = await sHlasenim(
    hlaska,
    { probiha: "Vracím původní znění…", hotovo: "Hotovo." },
    () => vratPuvodniZneni(polozka),
    {
      tlacitko,
      zopakovat: () => void vratPuvodni(polozka, hlaska, tlacitko, poVraceni),
    },
  );

  if (vysledek === undefined) return;

  oznacRozepsane(`seznam:${polozka.klic}`, false);
  poVraceni({ druh: "hotovo", text: vysledek });
}

// ---------------------------------------------------------------------------
// VYKRESLENÍ JEDNÉ POLOŽKY
// ---------------------------------------------------------------------------

function vykresliPolozku(
  polozka: PolozkaObsahu,
  uvodniHlaska?: HlaskaKarty,
): HTMLElement {
  const karta = document.createElement("div");
  karta.className = "admin-karta";
  karty.set(polozka.klic, karta);

  const jeZmeneno = jeUpraveno(polozka.klic);

  // --- popisek, ať je jasné, kde na webu ta věc je ---
  const popisek = document.createElement("label");
  popisek.className = "admin-popisek";
  popisek.htmlFor = `pole-${polozka.klic}`;
  popisek.textContent = polozka.popis;

  const znacka = document.createElement("span");
  znacka.className = "admin-stitek";
  znacka.textContent = "upraveno";
  if (jeZmeneno) popisek.append(" ", znacka);

  karta.append(popisek);

  const hlaska = document.createElement("p");
  hlaska.className = "admin-hlaska mt-2";

  // Po uložení se karta překreslí — přibude na ní štítek „upraveno"
  // a tlačítko „Vrátit původní". Potvrzení o uložení se přenese na novou
  // kartu, aby správci nezmizelo před očima.
  //
  // Překresluje se ta karta, která je na stránce PRÁVĚ TEĎ. Mezitím ji totiž
  // mohlo vyměnit hlášení o změně (viz priZmeneObsahu níž) a překreslení
  // té staré, už odpojené, by nikde nebylo vidět.
  const prekresli = (hlaskaProNovouKartu?: HlaskaKarty) => {
    const soucasna = karty.get(polozka.klic) ?? karta;
    soucasna.replaceWith(vykresliPolozku(polozka, hlaskaProNovouKartu));
  };

  // --- obrázek ------------------------------------------------------------
  if (polozka.typ === "obrazek") {
    const nahled = document.createElement("img");
    nahled.src = zneni(polozka);
    nahled.alt = "";
    nahled.className = "admin-nahled";
    // Obrázek se nemusí načíst (třeba smazaný soubor) — ať to je vidět.
    nahled.addEventListener("error", () => {
      ukazStav(
        hlaska,
        "chyba",
        "Obrázek se nepodařilo zobrazit. Zkontrolujte, že soubor v úložišti pořád je.",
      );
    });

    const vyber = document.createElement("input");
    vyber.type = "file";
    vyber.id = `pole-${polozka.klic}`;
    vyber.accept = "image/png,image/jpeg,image/webp,image/svg+xml";
    vyber.className = "admin-pole-souboru";

    vyber.addEventListener("change", () => {
      const soubor = vyber.files?.[0];
      if (!soubor) return;

      void (async () => {
        const adresa = await nahrajObrazek(soubor, hlaska);
        if (!adresa) return;

        const vysledek = await sHlasenim(
          hlaska,
          { probiha: "Ukládám nový obrázek…", hotovo: "Uloženo." },
          () => ulozZneni(polozka, adresa),
        );

        if (vysledek !== undefined) prekresli({ druh: "hotovo", text: vysledek });
      })();
    });

    karta.append(nahled, vyber);

    if (jeZmeneno) {
      const vratit = document.createElement("button");
      vratit.type = "button";
      vratit.className = "admin-tlacitko-vedlejsi mt-3";
      vratit.textContent = "Vrátit původní obrázek";
      vratit.addEventListener("click", () =>
        void vratPuvodni(polozka, hlaska, vratit, prekresli),
      );
      karta.append(vratit);
    }

    karta.append(hlaska);

    if (uvodniHlaska) ukazStav(hlaska, uvodniHlaska.druh, uvodniHlaska.text);

    return karta;
  }

  // --- text ---------------------------------------------------------------
  const jeDlouhy = polozka.typ === "dlouhy";
  const pole = document.createElement(jeDlouhy ? "textarea" : "input") as
    | HTMLInputElement
    | HTMLTextAreaElement;

  pole.id = `pole-${polozka.klic}`;
  pole.className = "admin-pole";
  pole.value = zneni(polozka);

  if (pole instanceof HTMLTextAreaElement) {
    pole.rows = Math.min(8, Math.max(3, Math.ceil(pole.value.length / 70)));
  } else {
    (pole as HTMLInputElement).type =
      polozka.typ === "email" ? "email" : polozka.typ === "telefon" ? "tel" : "text";
  }

  // Rozepsaný text se musí poznat na první pohled — jinak by vypadal jako
  // uložený. Zároveň se poznamená, že se okno nemá zavřít bez zeptání.
  pole.addEventListener("input", () => {
    const jinak = pole.value !== zneni(polozka);
    oznacRozepsane(`seznam:${polozka.klic}`, jinak);

    if (jinak) {
      ukazStav(
        hlaska,
        "rozepsano",
        "Rozepsáno — zatím neuloženo. Uložíte tlačítkem Uložit.",
      );
    } else {
      ukazStav(hlaska, "nic");
    }
  });

  karta.append(pole);

  // Původní znění je vidět jen tehdy, když se od zobrazeného liší. Jinak by
  // to byla zbytečná dvojitá informace.
  if (jeZmeneno && zneni(polozka) !== polozka.vychozi) {
    const puvodni = document.createElement("p");
    puvodni.className = "admin-puvodni";
    puvodni.textContent = `Původní znění: ${polozka.vychozi}`;
    karta.append(puvodni);
  }

  const radekTlacitek = document.createElement("div");
  radekTlacitek.className = "mt-3 flex flex-wrap gap-3";

  const ulozit = document.createElement("button");
  ulozit.type = "button";
  ulozit.className = "admin-tlacitko";
  ulozit.textContent = "Uložit";
  ulozit.addEventListener("click", () =>
    void ulozPolozku(polozka, pole.value, hlaska, ulozit, prekresli),
  );
  radekTlacitek.append(ulozit);

  if (jeZmeneno) {
    const vratit = document.createElement("button");
    vratit.type = "button";
    vratit.className = "admin-tlacitko-vedlejsi";
    vratit.textContent = "Vrátit původní";
    vratit.addEventListener("click", () =>
      void vratPuvodni(polozka, hlaska, vratit, prekresli),
    );
    radekTlacitek.append(vratit);
  }

  karta.append(radekTlacitek, hlaska);

  if (uvodniHlaska) ukazStav(hlaska, uvodniHlaska.druh, uvodniHlaska.text);

  return karta;
}

// ---------------------------------------------------------------------------
// VYKRESLENÍ CELÉHO SEZNAMU
// ---------------------------------------------------------------------------

function vykresliTexty(): void {
  const misto = document.getElementById("seznam-textu");
  if (!misto) return;

  misto.textContent = "";
  karty.clear();

  for (const skupina of skupinyKatalogu()) {
    const blok = document.createElement("section");
    blok.className = "mt-10 first:mt-0";

    const nadpis = document.createElement("h3");
    nadpis.className = "text-xl";
    nadpis.textContent = skupina;
    blok.append(nadpis);

    const mrizka = document.createElement("div");
    mrizka.className = "mt-4 grid gap-4";

    for (const polozka of KATALOG.filter((p) => p.skupina === skupina)) {
      mrizka.append(vykresliPolozku(polozka));
    }

    blok.append(mrizka);
    misto.append(blok);
  }
}

// Když se text uloží v náhledu, seznam to musí ukázat taky. Jinak by každý
// pohled ukazoval něco jiného.
priZmeneObsahu((klic) => {
  const karta = karty.get(klic);
  const polozka = KATALOG.find((p) => p.klic === klic);
  if (!karta || !polozka) return;

  // Do rozepsané karty se nesahá — správce by přišel o to, co má napsané.
  // Místo toho se u ní napíše, že novější znění je jinde.
  if (jeRozepsane(`seznam:${klic}`)) {
    ukazStav(
      karta.querySelector<HTMLElement>(".admin-hlaska"),
      "rozepsano",
      "Rozepsáno — a text se mezitím změnil v náhledu. Uložením přepíšete novější znění.",
    );
    return;
  }

  karta.replaceWith(vykresliPolozku(polozka));
});

// ---------------------------------------------------------------------------
// PŘEPÍNÁNÍ MEZI NÁHLEDEM A SEZNAMEM
// ---------------------------------------------------------------------------

/** Který způsob úprav je právě vidět. */
let pohled: "nahled" | "seznam" = "nahled";

function prepniPohled(nazev: "nahled" | "seznam", nacitat = true): void {
  // Rozepsaná úprava v náhledu se nesmí ztratit tím, že se přepne pohled.
  if (nazev !== "nahled" && !zavriUpravu()) return;

  pohled = nazev;

  for (const tlacitko of document.querySelectorAll<HTMLButtonElement>("[data-pohled]")) {
    tlacitko.setAttribute(
      "aria-pressed",
      tlacitko.dataset.pohled === nazev ? "true" : "false",
    );
  }

  for (const cast of document.querySelectorAll<HTMLElement>("[data-cast-textu]")) {
    cast.hidden = cast.dataset.castTextu !== nazev;
  }

  // Náhled se načítá až ve chvíli, kdy se na něj člověk podívá. Načítat web
  // do rámu pokaždé, i když ho nikdo nechce vidět, by bylo zbytečné —
  // a před přihlášením by to bylo úplně zbytečné.
  if (nacitat && nazev === "nahled" && !jeNahledNacteny()) void nactiNahled();
}

// ---------------------------------------------------------------------------
// NAČTENÍ
// ---------------------------------------------------------------------------

export async function nactiTexty(): Promise<void> {
  const hlaska = document.getElementById("hlaska-texty");
  const tlacitko = document.getElementById(
    "tlacitko-nacist-texty",
  ) as HTMLButtonElement | null;

  const vysledek = await sHlasenim(
    hlaska,
    { probiha: "Načítám texty…", hotovo: "Texty jsou načtené." },
    async () => {
      await nactiPrepisy();
      return true;
    },
    { tlacitko, zopakovat: () => void nactiTexty() },
  );

  if (!vysledek) return;

  vykresliTexty();
  if (pohled === "nahled") void nactiNahled();

  window.setTimeout(() => ukazStav(hlaska, "nic"), 3000);
}

export function pripravTexty(): void {
  document.getElementById("tlacitko-nacist-texty")?.addEventListener("click", () => {
    void nactiTexty();
  });

  for (const tlacitko of document.querySelectorAll<HTMLButtonElement>("[data-pohled]")) {
    tlacitko.addEventListener("click", () =>
      prepniPohled(tlacitko.dataset.pohled === "seznam" ? "seznam" : "nahled"),
    );
  }

  pripravNahled();
  // Z náhledu se dá odskočit na seznam u textů, na které se nedá klepnout.
  nastavPrepnutiNaSeznam(() => prepniPohled("seznam"));

  // Jen nastavit výchozí pohled. Web do rámu se natáhne až po přihlášení,
  // spolu s texty (viz nactiTexty).
  prepniPohled("nahled", false);
}
