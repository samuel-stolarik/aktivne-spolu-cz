/**
 * Přehled přihlášek.
 *
 * Ukazuje, kdo se přihlásil, umožňuje změnit stav přihlášky a stáhnout
 * všechno do tabulky pro Excel.
 *
 * Data nikdy nechodí přímo z databáze — tabulka `prihlasky` je zamčená.
 * Všechno jde přes Edge Funkci `admin-obsah`, která si ověří, že volá správce.
 */
import { zavolej } from "./klient";
import { sHlasenim, ukazStav } from "./stav";

interface Prihlaska {
  id: string;
  vytvoreno: string;
  typ_poradatele: string;
  nazev_poradatele: string;
  kontaktni_osoba: string;
  email: string;
  telefon: string;
  mesto: string;
  kraj: string;
  napad_na_aktivitu: string | null;
  forma_platby: string;
  variabilni_symbol: number;
  stav: string;
  faktura_cislo: string | null;

  // Zveřejnění na mapce. Je to JINÁ VĚC než `stav` výš: `stav` říká, jak je
  // na tom platba, `schvaleno` říká, jestli akci uvidí lidé na webu.
  schvaleno: string;
  schvalil: string | null;
  schvaleno_kdy: string | null;

  // Souřadnice města. Hledají se jednou při schválení; když se nenajdou,
  // schválení stejně platí, akce se jen na mapce neukáže.
  lat: number | null;
  lng: number | null;
  souradnice_stav: string;
  souradnice_duvod: string | null;
}

/** Názvy stavů tak, jak je uvidí správce. V databázi jsou bez diakritiky. */
const NAZVY_STAVU: Record<string, string> = {
  nova: "Nová",
  zaplaceno: "Zaplaceno",
  zruseno: "Zrušeno",
};

/** Jak se schválení na mapku pojmenuje pro člověka. */
const NAZVY_SCHVALENI: Record<string, string> = {
  ceka: "Čeká na rozhodnutí",
  schvaleno: "Zveřejněno na mapce",
  zamitnuto: "Nezveřejňovat",
};

/** Popisky tlačítek. Sloveso na začátku, ať je jasné, co se stane. */
const TLACITKA_SCHVALENI: Record<string, string> = {
  schvaleno: "Schválit na mapu",
  zamitnuto: "Zamítnout",
  ceka: "Vrátit k rozhodnutí",
};

const NAZVY_PLATEB: Record<string, string> = {
  qr: "QR kód",
  prevod: "Převodem",
};

const NAZVY_PORADATELU: Record<string, string> = {
  skola: "Škola",
  organizace: "Organizace",
  jednotlivec: "Jednotlivec",
};

/** Poslední načtená data. Filtrování a export z nich vychází. */
let vsechnyPrihlasky: Prihlaska[] = [];

function prvek<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function ceskeDatum(iso: string): string {
  const datum = new Date(iso);
  if (Number.isNaN(datum.getTime())) return iso;
  return datum.toLocaleString("cs-CZ", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// VÝBĚR ZOBRAZENÝCH ŘÁDKŮ
// ---------------------------------------------------------------------------

/**
 * Použije filtr stavu a hledaný text.
 *
 * Oba ovladače jsou vidět nad tabulkou a filtr má vždy volbu „Všechny".
 * Skrytý filtr, o kterém člověk neví, vypadá jako ztracená data.
 */
function vybranePrihlasky(): Prihlaska[] {
  const stav = prvek<HTMLSelectElement>("filtr-stav")?.value ?? "vse";
  const mapa = prvek<HTMLSelectElement>("filtr-mapa")?.value ?? "vse";
  const hledane = (prvek<HTMLInputElement>("filtr-hledani")?.value ?? "")
    .trim()
    .toLocaleLowerCase("cs");

  return vsechnyPrihlasky.filter((p) => {
    if (stav !== "vse" && p.stav !== stav) return false;
    if (mapa !== "vse" && p.schvaleno !== mapa) return false;
    if (!hledane) return true;

    const vsechnaPole = [
      p.nazev_poradatele,
      p.kontaktni_osoba,
      p.email,
      p.telefon,
      p.mesto,
      p.kraj,
      String(p.variabilni_symbol),
    ]
      .join(" ")
      .toLocaleLowerCase("cs");

    return vsechnaPole.includes(hledane);
  });
}

// ---------------------------------------------------------------------------
// VYKRESLENÍ TABULKY
// ---------------------------------------------------------------------------

function bunka(text: string, trida = ""): HTMLTableCellElement {
  const td = document.createElement("td");
  td.className = `px-3 py-3 align-top ${trida}`;
  td.textContent = text;
  return td;
}

/** Rozbalovací seznam se stavem + místo pro hlášku o uložení. */
function bunkaSeStavem(prihlaska: Prihlaska): HTMLTableCellElement {
  const td = document.createElement("td");
  td.className = "px-3 py-3 align-top";

  const popisek = document.createElement("label");
  popisek.className = "sr-only";
  popisek.htmlFor = `stav-${prihlaska.id}`;
  popisek.textContent = `Stav přihlášky ${prihlaska.nazev_poradatele}`;

  const vyber = document.createElement("select");
  vyber.id = `stav-${prihlaska.id}`;
  vyber.className = "admin-pole min-h-11 w-full";

  for (const [hodnota, nazev] of Object.entries(NAZVY_STAVU)) {
    const volba = document.createElement("option");
    volba.value = hodnota;
    volba.textContent = nazev;
    if (hodnota === prihlaska.stav) volba.selected = true;
    vyber.append(volba);
  }

  const hlaska = document.createElement("p");
  hlaska.className = "admin-hlaska mt-1";

  vyber.addEventListener("change", () => {
    const novyStav = vyber.value;
    const puvodniStav = prihlaska.stav;

    const uloz = async () => {
      const vysledek = await sHlasenim(
        hlaska,
        {
          probiha: "Ukládám změnu stavu…",
          hotovo: `Uloženo: ${NAZVY_STAVU[novyStav] ?? novyStav}`,
        },
        () => zavolej("zmen-stav", { id: prihlaska.id, stav: novyStav }),
        { zopakovat: () => void uloz() },
      );

      if (vysledek) {
        prihlaska.stav = novyStav;
        // Hlášku po chvíli uklidíme, ať se v tabulce nehromadí.
        window.setTimeout(() => ukazStav(hlaska, "nic"), 4000);
      } else {
        // Uložení selhalo — seznam musí ukazovat skutečný stav v databázi,
        // ne to, co si člověk zvolil. Jinak by si myslel, že je změna hotová.
        vyber.value = puvodniStav;
      }
    };

    void uloz();
  });

  td.append(popisek, vyber, hlaska);
  return td;
}

// ---------------------------------------------------------------------------
// SCHVÁLENÍ NA VEŘEJNOU MAPKU
// ---------------------------------------------------------------------------
// Pozor: tohle je něco jiného než stav platby. Rozhoduje se tu, jestli akci
// uvidí na mapce na webu kdokoli na světě. Proto je u tlačítek napsáno
// „na mapu", ne jen „schválit".

/** Odpověď funkce na schválení i na nové hledání souřadnic. */
interface OdpovedSchvaleni {
  schvaleno?: string;
  lat: number | null;
  lng: number | null;
  souradnice_stav: string;
  souradnice_duvod: string | null;
}

/**
 * Řádek se souřadnicemi.
 *
 * Musí být na první pohled poznat, jestli akce na mapce opravdu je. Schválená
 * akce bez souřadnic totiž vypadá jako hotová věc, ale na mapce není —
 * a to by se Hana jinak nedozvěděla.
 */
function vykresliSouradnice(
  misto: HTMLElement,
  prihlaska: Prihlaska,
  znovu: () => void,
): void {
  misto.textContent = "";

  // U nezveřejněných akcí se souřadnice neřeší, jen by pletly.
  if (prihlaska.schvaleno !== "schvaleno") return;

  const radek = document.createElement("p");
  radek.className = "admin-souradnice mt-2";

  if (prihlaska.lat !== null && prihlaska.lng !== null) {
    radek.dataset.stav = "nalezeno";
    radek.textContent = `Na mapce: ano, u města ${prihlaska.mesto}.`;
    misto.append(radek);
    return;
  }

  // Souřadnice nejsou. Akce je schválená, ale na mapce ji nikdo neuvidí —
  // musí být napsané slovy, proč, a co s tím jde dělat.
  radek.dataset.stav = "chybi";

  const znacka = document.createElement("span");
  znacka.setAttribute("aria-hidden", "true");
  znacka.className = "admin-znacka";
  znacka.textContent = "!";

  const veta = document.createElement("span");
  veta.textContent =
    prihlaska.souradnice_duvod ??
    "Souřadnice města zatím nejsou dohledané, takže akce na mapce není.";

  const tlacitko = document.createElement("button");
  tlacitko.type = "button";
  tlacitko.className = "admin-znovu";
  tlacitko.textContent = "Dohledat souřadnice";
  tlacitko.addEventListener("click", znovu);

  radek.append(znacka, veta, tlacitko);
  misto.append(radek);
}

/** Buňka „Na mapce" — rozhodnutí, tlačítka a informace o souřadnicích. */
function bunkaSMapou(prihlaska: Prihlaska): HTMLTableCellElement {
  const td = document.createElement("td");
  td.className = "px-3 py-3 align-top";

  const popis = document.createElement("p");
  popis.className = "admin-schvaleni";

  const tlacitka = document.createElement("div");
  tlacitka.className = "mt-2 flex flex-wrap gap-2";

  const hlaska = document.createElement("p");
  hlaska.className = "admin-hlaska mt-2";

  const souradnice = document.createElement("div");

  /** Nové hledání souřadnic u už schválené akce. */
  const dohledej = async (): Promise<void> => {
    const vysledek = await sHlasenim(
      hlaska,
      {
        probiha: "Hledám souřadnice města v mapě OpenStreetMap…",
        hotovo: "Hledání dokončeno.",
      },
      () =>
        zavolej<OdpovedSchvaleni>("dohledej-souradnice", { id: prihlaska.id }),
      { zopakovat: () => void dohledej() },
    );

    if (!vysledek) return;

    prihlaska.lat = vysledek.lat;
    prihlaska.lng = vysledek.lng;
    prihlaska.souradnice_stav = vysledek.souradnice_stav;
    prihlaska.souradnice_duvod = vysledek.souradnice_duvod;

    // Hledání sice proběhlo, ale nemuselo najít. Hláška musí říct, jak to
    // dopadlo — „hotovo" u nenalezeného města by bylo zavádějící.
    if (vysledek.lat !== null) {
      ukazStav(hlaska, "hotovo", `Souřadnice města ${prihlaska.mesto} jsou dohledané.`);
      window.setTimeout(() => ukazStav(hlaska, "nic"), 4000);
    } else {
      ukazStav(
        hlaska,
        "chyba",
        vysledek.souradnice_duvod ?? "Souřadnice se nepodařilo dohledat.",
        { popis: "Zkusit znovu", spust: () => void dohledej() },
      );
    }

    vykresliSouradnice(souradnice, prihlaska, () => void dohledej());
  };

  /** Uloží rozhodnutí a překreslí buňku. */
  const rozhodni = async (nove: string): Promise<void> => {
    const vysledek = await sHlasenim(
      hlaska,
      {
        probiha:
          nove === "schvaleno"
            ? "Schvaluji a hledám souřadnice města…"
            : "Ukládám rozhodnutí…",
        hotovo: "Uloženo.",
      },
      () =>
        zavolej<OdpovedSchvaleni>("schval", {
          id: prihlaska.id,
          rozhodnuti: nove,
        }),
      { zopakovat: () => void rozhodni(nove) },
    );

    if (!vysledek) return;

    prihlaska.schvaleno = nove;
    prihlaska.lat = vysledek.lat;
    prihlaska.lng = vysledek.lng;
    prihlaska.souradnice_stav = vysledek.souradnice_stav;
    prihlaska.souradnice_duvod = vysledek.souradnice_duvod;

    // Schválení PLATÍ i tehdy, když se souřadnice nenašly. Je ale potřeba to
    // říct rovnou, jinak by se Hana marně divila, proč akce na mapce není.
    if (nove === "schvaleno" && vysledek.lat === null) {
      ukazStav(
        hlaska,
        "chyba",
        `Schváleno, ale na mapce akce zatím není. ${vysledek.souradnice_duvod ?? "Souřadnice města se nepodařilo dohledat."}`,
        { popis: "Dohledat znovu", spust: () => void dohledej() },
      );
    } else {
      ukazStav(hlaska, "hotovo", `Uloženo: ${NAZVY_SCHVALENI[nove] ?? nove}.`);
      window.setTimeout(() => ukazStav(hlaska, "nic"), 4000);
    }

    prekresli();
  };

  /** Popisek stavu a sada tlačítek podle toho, kde přihláška zrovna je. */
  function prekresli(): void {
    popis.dataset.stav = prihlaska.schvaleno;
    popis.textContent =
      NAZVY_SCHVALENI[prihlaska.schvaleno] ?? prihlaska.schvaleno;

    tlacitka.textContent = "";

    // Nabízejí se všechna rozhodnutí kromě toho, které zrovna platí.
    // Díky tomu jde zamítnutí i schválení kdykoli vzít zpět.
    for (const volba of ["schvaleno", "zamitnuto", "ceka"]) {
      if (volba === prihlaska.schvaleno) continue;

      const tlacitko = document.createElement("button");
      tlacitko.type = "button";
      tlacitko.className = "admin-znovu";
      tlacitko.textContent = TLACITKA_SCHVALENI[volba];
      tlacitko.setAttribute(
        "aria-label",
        `${TLACITKA_SCHVALENI[volba]} — ${prihlaska.nazev_poradatele}, ${prihlaska.mesto}`,
      );
      tlacitko.addEventListener("click", () => void rozhodni(volba));
      tlacitka.append(tlacitko);
    }

    vykresliSouradnice(souradnice, prihlaska, () => void dohledej());
  }

  prekresli();
  td.append(popis, tlacitka, hlaska, souradnice);
  return td;
}

function vykresliTabulku(): void {
  const telo = prvek<HTMLTableSectionElement>("telo-prihlasek");
  const pocet = prvek<HTMLElement>("pocet-prihlasek");
  if (!telo) return;

  const radky = vybranePrihlasky();

  telo.textContent = "";

  if (pocet) {
    if (vsechnyPrihlasky.length === 0) {
      pocet.textContent = "Zatím se nikdo nepřihlásil.";
    } else if (radky.length === vsechnyPrihlasky.length) {
      pocet.textContent = `Celkem ${vsechnyPrihlasky.length} ${sklonujPrihlasky(vsechnyPrihlasky.length)}.`;
    } else {
      pocet.textContent = `Zobrazeno ${radky.length} z ${vsechnyPrihlasky.length} ${sklonujPrihlasky(vsechnyPrihlasky.length)}.`;
    }
  }

  if (radky.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 11;
    td.className = "px-3 py-8 text-center";
    td.textContent =
      vsechnyPrihlasky.length === 0
        ? "Zatím tu nic není. Jakmile se někdo přihlásí, objeví se tady."
        : "Žádná přihláška neodpovídá zadanému hledání ani zvoleným filtrům.";
    tr.append(td);
    telo.append(tr);
    return;
  }

  for (const prihlaska of radky) {
    const tr = document.createElement("tr");
    tr.className = "border-t border-merunka-tlumena";

    tr.append(
      bunka(ceskeDatum(prihlaska.vytvoreno), "whitespace-nowrap"),
      bunka(
        `${prihlaska.nazev_poradatele} (${NAZVY_PORADATELU[prihlaska.typ_poradatele] ?? prihlaska.typ_poradatele})`,
      ),
      bunka(prihlaska.kontaktni_osoba),
    );

    // E-mail a telefon jako odkazy — správce z přehledu rovnou napíše nebo zavolá.
    const tdEmail = document.createElement("td");
    tdEmail.className = "px-3 py-3 align-top";
    const odkazEmail = document.createElement("a");
    odkazEmail.href = `mailto:${prihlaska.email}`;
    odkazEmail.textContent = prihlaska.email;
    odkazEmail.className = "inline-flex min-h-11 items-center text-tyrkys";
    tdEmail.append(odkazEmail);

    const tdTelefon = document.createElement("td");
    tdTelefon.className = "px-3 py-3 align-top";
    const odkazTelefon = document.createElement("a");
    odkazTelefon.href = `tel:${prihlaska.telefon.replace(/[\s()]/g, "")}`;
    odkazTelefon.textContent = prihlaska.telefon;
    odkazTelefon.className = "inline-flex min-h-11 items-center whitespace-nowrap text-tyrkys";
    tdTelefon.append(odkazTelefon);

    tr.append(
      tdEmail,
      tdTelefon,
      bunka(prihlaska.mesto),
      bunka(prihlaska.kraj),
      bunka(NAZVY_PLATEB[prihlaska.forma_platby] ?? prihlaska.forma_platby),
      bunka(String(prihlaska.variabilni_symbol), "whitespace-nowrap"),
      bunkaSeStavem(prihlaska),
      bunkaSMapou(prihlaska),
    );

    telo.append(tr);
  }
}

function sklonujPrihlasky(pocet: number): string {
  if (pocet === 1) return "přihláška";
  if (pocet >= 2 && pocet <= 4) return "přihlášky";
  return "přihlášek";
}

// ---------------------------------------------------------------------------
// STAŽENÍ DO TABULKY
// ---------------------------------------------------------------------------

/**
 * Připraví soubor CSV pro Excel.
 *
 * Dvě věci, které jsou v českém Excelu nutné:
 *   * oddělovač středník (Excel v českém prostředí čárku nepovažuje
 *     za oddělovač sloupců),
 *   * značka na začátku souboru (BOM), bez které Excel rozhází diakritiku.
 */
function sestavCsv(radky: Prihlaska[]): string {
  const hlavicka = [
    "Datum a čas",
    "Typ pořadatele",
    "Název pořadatele",
    "Kontaktní osoba",
    "E-mail",
    "Telefon",
    "Město",
    "Kraj",
    "Forma platby",
    "Variabilní symbol",
    "Stav",
    "Číslo faktury",
    "Nápad na aktivitu",
    "Na mapce",
    "Souřadnice dohledané",
  ];

  const uvozovky = (hodnota: string | number | null): string => {
    const text = hodnota === null || hodnota === undefined ? "" : String(hodnota);
    // Uvozovky uvnitř se zdvojují, celá hodnota se do uvozovek zabalí —
    // jinak by středník nebo konec řádku uvnitř textu rozhodil sloupce.
    return `"${text.replace(/"/g, '""')}"`;
  };

  const radkySouboru = [hlavicka.map(uvozovky).join(";")];

  for (const p of radky) {
    radkySouboru.push(
      [
        ceskeDatum(p.vytvoreno),
        NAZVY_PORADATELU[p.typ_poradatele] ?? p.typ_poradatele,
        p.nazev_poradatele,
        p.kontaktni_osoba,
        p.email,
        p.telefon,
        p.mesto,
        p.kraj,
        NAZVY_PLATEB[p.forma_platby] ?? p.forma_platby,
        p.variabilni_symbol,
        NAZVY_STAVU[p.stav] ?? p.stav,
        p.faktura_cislo,
        p.napad_na_aktivitu,
        NAZVY_SCHVALENI[p.schvaleno] ?? p.schvaleno,
        p.lat !== null && p.lng !== null ? "ano" : "ne",
      ]
        .map(uvozovky)
        .join(";"),
    );
  }

  return "﻿" + radkySouboru.join("\r\n");
}

function stahniCsv(): void {
  const radky = vybranePrihlasky();
  const hlaska = prvek<HTMLElement>("hlaska-prihlasky");

  if (radky.length === 0) {
    ukazStav(hlaska, "chyba", "Není co stahovat — v seznamu nejsou žádné přihlášky.");
    return;
  }

  const soubor = new Blob([sestavCsv(radky)], {
    type: "text/csv;charset=utf-8",
  });
  const adresa = URL.createObjectURL(soubor);
  const dnes = new Date().toLocaleDateString("sv-SE");

  const odkaz = document.createElement("a");
  odkaz.href = adresa;
  odkaz.download = `prihlasky-${dnes}.csv`;
  document.body.append(odkaz);
  odkaz.click();
  odkaz.remove();
  URL.revokeObjectURL(adresa);

  ukazStav(
    hlaska,
    "hotovo",
    `Staženo ${radky.length} ${sklonujPrihlasky(radky.length)} do souboru prihlasky-${dnes}.csv.`,
  );
}

// ---------------------------------------------------------------------------
// NAČTENÍ
// ---------------------------------------------------------------------------

export async function nactiPrihlasky(): Promise<void> {
  const hlaska = prvek<HTMLElement>("hlaska-prihlasky");
  const tlacitko = prvek<HTMLButtonElement>("tlacitko-nacist-prihlasky");

  const vysledek = await sHlasenim(
    hlaska,
    { probiha: "Načítám přihlášky…", hotovo: "Přihlášky jsou načtené." },
    () => zavolej<{ prihlasky: Prihlaska[] }>("prihlasky"),
    { tlacitko, zopakovat: () => void nactiPrihlasky() },
  );

  if (!vysledek) return;

  vsechnyPrihlasky = vysledek.prihlasky;
  vykresliTabulku();
  window.setTimeout(() => ukazStav(hlaska, "nic"), 3000);
}

/** Napojí ovladače nad tabulkou. Volá se jednou po přihlášení. */
export function pripravPrihlasky(): void {
  prvek<HTMLSelectElement>("filtr-stav")?.addEventListener("change", vykresliTabulku);
  prvek<HTMLSelectElement>("filtr-mapa")?.addEventListener("change", vykresliTabulku);
  prvek<HTMLInputElement>("filtr-hledani")?.addEventListener("input", vykresliTabulku);
  prvek<HTMLButtonElement>("tlacitko-nacist-prihlasky")?.addEventListener("click", () => {
    void nactiPrihlasky();
  });
  prvek<HTMLButtonElement>("tlacitko-csv")?.addEventListener("click", stahniCsv);
}
