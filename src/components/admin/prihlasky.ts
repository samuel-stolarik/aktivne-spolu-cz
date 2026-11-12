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
import { sHlasenim, ukazStav, type DruhStavu } from "./stav";

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
  /** Den konání ve tvaru RRRR-MM-DD. Starší přihlášky ho nemají. */
  datum_akce: string | null;
  napad_na_aktivitu: string | null;
  forma_platby: string;
  variabilni_symbol: number;
  stav: string;
  faktura_cislo: string | null;
  /** Údaje pro rozklikávací detail. */
  castka_kc: number | null;
  fakt_nazev: string | null;
  fakt_adresa: string | null;
  fakt_ic: string | null;
  fakt_dic: string | null;
  faktura_url: string | null;

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

/**
 * Které přihlášky mají otevřený detail.
 *
 * Drží se mimo tabulku schválně: překreslení (filtr, hledání, řazení)
 * maže všechny řádky a znovu je staví. Bez tohohle by se detail zavřel
 * pokaždé, když se v hledání změní písmeno.
 */
const rozbalene = new Set<string>();

/**
 * Hláška, která musí přežít překreslení tabulky.
 *
 * Když má přihláška otevřený detail, je rozhodnutí o mapce vidět na dvou
 * místech — v řádku i v detailu. Změna na jednom místě proto překreslí
 * celou tabulku, aby se obě nerozešla. Překreslení ale postaví buňky znovu
 * a výsledek („Uloženo", „Souřadnice se nenašly") by zmizel dřív, než si
 * ho správce přečte. Tady počká, než si ho nové buňky vyzvednou.
 */
const cekajiciHlasky = new Map<
  string,
  { druh: DruhStavu; text: string; dohledatZnovu?: string }
>();

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
  // Jen u jednotlivců — ti registrační poplatek platit nemusí.
  neprispivam: "Bez příspěvku",
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

/**
 * Den konání akce česky: `2026-10-01` → `1. 10. 2026`.
 *
 * Skládá se z částí zapsaného řetězce, ne přes `new Date()`. Prohlížeč čte
 * `2026-10-01` jako půlnoc UTC, takže by se v západnějším časovém pásmu
 * ukázalo 30. 9. — den, který nikdo nevyplnil.
 *
 * Prázdná pomlčka u chybějícího data je schválně: v tabulce plné údajů by
 * prázdná buňka vypadala jako chyba načítání.
 */
function ceskyDenAkce(iso: string | null): string {
  if (!iso) return "—";
  const casti = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!casti) return iso;
  return `${Number(casti[3])}. ${Number(casti[2])}. ${casti[1]}`;
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
/**
 * Seřadí přihlášky podle toho, co je zrovna zvolené v ovladači „Seřadit podle".
 *
 * Řadí se až tady v prohlížeči, ne v databázi — přihlášek jsou stovky, ne
 * miliony, a překlopení pořadí tak proběhne okamžitě a bez dalšího dotazu.
 *
 * Přihlášky bez data konání (ty z doby, kdy se na datum ještě neptalo) jdou
 * při řazení podle data VŽDY na konec. Kdyby se schovaly nahoru, vypadalo by
 * to, že se konají první.
 */
function serad(radky: Prihlaska[]): Prihlaska[] {
  const razeni = prvek<HTMLSelectElement>("razeni")?.value ?? "prihlaseno";
  const serazene = [...radky];

  if (razeni === "datum-akce") {
    serazene.sort((a, b) => {
      if (!a.datum_akce && !b.datum_akce) return 0;
      if (!a.datum_akce) return 1;
      if (!b.datum_akce) return -1;
      // Tvar RRRR-MM-DD se řadí jako text stejně jako datum.
      return a.datum_akce.localeCompare(b.datum_akce);
    });
    return serazene;
  }

  // Výchozí pořadí: nejnovější přihláška nahoře. Tak už je vrací Edge Funkce,
  // ale řadíme znovu, ať se pořadí obnoví i po přepnutí zpátky.
  serazene.sort((a, b) => b.vytvoreno.localeCompare(a.vytvoreno));
  return serazene;
}

function vybranePrihlasky(): Prihlaska[] {
  const stav = prvek<HTMLSelectElement>("filtr-stav")?.value ?? "vse";
  const mapa = prvek<HTMLSelectElement>("filtr-mapa")?.value ?? "vse";
  const hledane = (prvek<HTMLInputElement>("filtr-hledani")?.value ?? "")
    .trim()
    .toLocaleLowerCase("cs");

  const vybrane = vsechnyPrihlasky.filter((p) => {
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

  return serad(vybrane);
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
/**
 * @param poZmene  Zadá se, když je přihláška vidět na dvou místech (řádek
 *                 a otevřený detail). Po rozhodnutí se pak překreslí celá
 *                 tabulka, aby obě místa ukazovala totéž.
 */
function bunkaSMapou(prihlaska: Prihlaska, poZmene?: () => void): HTMLTableCellElement {
  const td = document.createElement("td");
  td.className = "px-3 py-3 align-top";

  const popis = document.createElement("p");
  popis.className = "admin-schvaleni";

  const tlacitka = document.createElement("div");
  tlacitka.className = "mt-2 flex flex-wrap gap-2";

  const hlaska = document.createElement("p");
  hlaska.className = "admin-hlaska mt-2";

  const souradnice = document.createElement("div");

  /** Výsledek rovnou tady, nebo — když se tabulka překresluje — v nových buňkách. */
  const oznam = (druh: DruhStavu, text: string, dohledatZnovu?: string): void => {
    if (poZmene) {
      cekajiciHlasky.set(prihlaska.id, { druh, text, dohledatZnovu });
      poZmene();
      return;
    }
    ukazHlasku(druh, text, dohledatZnovu);
  };

  function ukazHlasku(druh: DruhStavu, text: string, dohledatZnovu?: string): void {
    ukazStav(
      hlaska,
      druh,
      text,
      dohledatZnovu ? { popis: dohledatZnovu, spust: () => void dohledej() } : undefined,
    );
    if (druh === "hotovo") window.setTimeout(() => ukazStav(hlaska, "nic"), 4000);
  }

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
      oznam("hotovo", `Souřadnice města ${prihlaska.mesto} jsou dohledané.`);
    } else {
      oznam(
        "chyba",
        vysledek.souradnice_duvod ?? "Souřadnice se nepodařilo dohledat.",
        "Zkusit znovu",
      );
    }

    if (!poZmene) vykresliSouradnice(souradnice, prihlaska, () => void dohledej());
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
      oznam(
        "chyba",
        `Schváleno, ale na mapce akce zatím není. ${vysledek.souradnice_duvod ?? "Souřadnice města se nepodařilo dohledat."}`,
        "Dohledat znovu",
      );
    } else {
      oznam("hotovo", `Uloženo: ${NAZVY_SCHVALENI[nove] ?? nove}.`);
    }

    if (!poZmene) prekresli();
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

  const cekajici = cekajiciHlasky.get(prihlaska.id);
  if (cekajici) ukazHlasku(cekajici.druh, cekajici.text, cekajici.dohledatZnovu);

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
    td.colSpan = 13;
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

    // S otevřeným detailem je rozhodnutí o mapce na dvou místech. Změna
    // na jednom pak překreslí tabulku, aby se nerozešla s druhým.
    const otevreno = rozbalene.has(prihlaska.id);
    const poZmene = otevreno ? vykresliTabulku : undefined;

    tr.append(
      // Detail je PRVNÍ sloupec. Dřív byl třináctý, úplně vpravo za okrajem
      // obrazovky, a správce musel u každé přihlášky sjet pod tabulku,
      // posunout ji do strany, rozkliknout a pak ji posouvat zpátky.
      bunkaSDetailem(prihlaska),
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
      // Datum konání česky (1. 10. 2026), nikdy ve tvaru 2026-10-01.
      bunka(ceskyDenAkce(prihlaska.datum_akce), "whitespace-nowrap"),
      bunka(NAZVY_PLATEB[prihlaska.forma_platby] ?? prihlaska.forma_platby),
      bunka(String(prihlaska.variabilni_symbol), "whitespace-nowrap"),
      bunkaSeStavem(prihlaska),
      bunkaSMapou(prihlaska, poZmene),
    );

    telo.append(tr);

    // Detail jde hned pod svůj řádek, aby bylo vidět, ke komu patří.
    if (otevreno) telo.append(radekDetailu(prihlaska, poZmene));
  }

  // Hlášky si už vyzvedly nově postavené buňky.
  cekajiciHlasky.clear();
  srovnejDetaily();
}

/**
 * Detail se roztahuje přes všech 13 sloupců, tedy přes celou šířku tabulky —
 * mnohem víc, než je na obrazovce vidět. Obsah detailu je proto přilepený
 * k levému okraji viditelné části (sticky) a široký přesně jako okno tabulky:
 * ať je tabulka odscrollovaná kamkoli, detail je celý vidět.
 */
function srovnejDetaily(): void {
  const okno = document
    .getElementById("telo-prihlasek")
    ?.closest<HTMLElement>(".overflow-x-auto");
  if (!okno) return;
  // 24 px = vnitřní okraj buňky (px-3) zleva i zprava.
  const sirka = Math.max(okno.clientWidth - 24, 280);
  document.querySelectorAll<HTMLElement>("[data-detail-obal]").forEach((obal) => {
    obal.style.width = `${sirka}px`;
  });
}

/** Tlačítko, které detail otevře a zavře. */
function bunkaSDetailem(prihlaska: Prihlaska): HTMLTableCellElement {
  const td = document.createElement("td");
  // Přilepená k levému okraji — tlačítko zůstane vidět, i když je tabulka
  // odscrollovaná doprava. Bílé pozadí, jinak by pod ní prosvítaly buňky.
  td.className = "sticky left-0 z-10 bg-white px-3 py-3 align-top";

  const tlacitko = document.createElement("button");
  tlacitko.type = "button";
  const otevreno = rozbalene.has(prihlaska.id);
  tlacitko.textContent = otevreno ? "Skrýt detail" : "Zobrazit detail";
  tlacitko.className =
    "inline-flex min-h-11 items-center whitespace-nowrap text-tyrkys underline";
  tlacitko.setAttribute("aria-expanded", otevreno ? "true" : "false");
  tlacitko.addEventListener("click", () => {
    if (rozbalene.has(prihlaska.id)) rozbalene.delete(prihlaska.id);
    else rozbalene.add(prihlaska.id);
    vykresliTabulku();
  });

  td.append(tlacitko);
  return td;
}

/**
 * Rozbalený detail přihlášky.
 *
 * PROČ: v přehledu byly vidět jen kontakty a datum akce, takže se nedalo
 * poznat, jestli přihlášená akce vůbec něco dělá — a přitom se právě
 * podle toho rozhoduje, jestli ji pustit na mapku. Popis akce se
 * z databáze stahoval, ale nikde se neukazoval; byl jen v exportu do
 * Excelu, kvůli kterému by se musel stahovat celý soubor.
 */
function radekDetailu(prihlaska: Prihlaska, poZmene?: () => void): HTMLTableRowElement {
  const tr = document.createElement("tr");
  tr.className = "border-t border-merunka-tlumena bg-merunka-svetla/40";

  const td = document.createElement("td");
  td.colSpan = 13;
  td.className = "px-3 py-4";

  // Přilepený k viditelné části tabulky, šířku mu dopočítá srovnejDetaily().
  const obal = document.createElement("div");
  obal.className = "sticky left-3 grid gap-4 md:grid-cols-2";
  obal.dataset.detailObal = "";

  // ── Popis akce ────────────────────────────────────────────────────
  // Nejdůležitější věc na celém detailu, proto stojí první a přes celou
  // šířku. Když ho pořadatel nevyplnil, musí to být napsané — prázdné
  // místo vypadá jako chyba načítání.
  const popis = document.createElement("div");
  popis.className = "md:col-span-2";
  const popisNadpis = document.createElement("p");
  popisNadpis.className = "m-0 font-semibold";
  popisNadpis.textContent = "Nápad na aktivitu";
  const popisText = document.createElement("p");
  popisText.className = "m-0 mt-1 whitespace-pre-wrap";
  const napad = (prihlaska.napad_na_aktivitu ?? "").trim();
  if (napad) {
    popisText.textContent = napad;
  } else {
    popisText.textContent = "Pořadatel akci nepopsal.";
    popisText.className += " text-popisek";
  }
  popis.append(popisNadpis, popisText);

  // ── Na mapce ──────────────────────────────────────────────────────
  // Rozhoduje se podle popisu hned nad tím, takže ovládání patří sem.
  // V řádku by bylo až ve dvanáctém sloupci, zase mimo obrazovku.
  // Je to stejné ovládání jako v řádku: buňka se postaví a její obsah
  // (i s obsluhou tlačítek) se přesune do detailu.
  const mapa = document.createElement("div");
  const mapaNadpis = document.createElement("p");
  mapaNadpis.className = "m-0 font-semibold";
  mapaNadpis.textContent = "Na mapce";
  mapa.append(mapaNadpis, ...Array.from(bunkaSMapou(prihlaska, poZmene).childNodes));

  obal.append(popis, mapa, blokUdaju("Akce", [
    ["Datum konání", ceskyDenAkce(prihlaska.datum_akce)],
    ["Město", `${prihlaska.mesto}, ${prihlaska.kraj}`],
    ["Přihlášeno", ceskeDatum(prihlaska.vytvoreno)],
  ]));

  // ── Kontakt ───────────────────────────────────────────────────────
  // I kontakty jsou v řádku daleko vpravo; tady jsou po ruce k popisu.
  obal.append(blokUdaju("Kontakt", [
    [
      "Pořadatel",
      `${prihlaska.nazev_poradatele} (${NAZVY_PORADATELU[prihlaska.typ_poradatele] ?? prihlaska.typ_poradatele})`,
    ],
    ["Kontaktní osoba", prihlaska.kontaktni_osoba],
    ["E-mail", prihlaska.email],
    ["Telefon", prihlaska.telefon],
  ]));

  // ── Platba a doklad ───────────────────────────────────────────────
  const platba = blokUdaju("Platba", [
    ["Částka", prihlaska.castka_kc === null ? null : `${prihlaska.castka_kc} Kč`],
    ["Forma", NAZVY_PLATEB[prihlaska.forma_platby] ?? prihlaska.forma_platby],
    ["Variabilní symbol", String(prihlaska.variabilni_symbol)],
    ["Číslo faktury", prihlaska.faktura_cislo],
    ["Fakturovat na", prihlaska.fakt_nazev],
    ["Adresa", prihlaska.fakt_adresa],
    ["IČO", prihlaska.fakt_ic],
    ["DIČ", prihlaska.fakt_dic],
  ]);

  if (prihlaska.faktura_url) {
    const odkaz = document.createElement("a");
    odkaz.href = prihlaska.faktura_url;
    odkaz.target = "_blank";
    odkaz.rel = "noreferrer";
    odkaz.className = "mt-2 inline-flex min-h-11 items-center text-tyrkys underline";
    odkaz.textContent = "Otevřít fakturu (PDF)";
    platba.append(odkaz);
  }

  obal.append(platba);
  td.append(obal);
  tr.append(td);
  return tr;
}

/** Skupina „popisek: hodnota". Prázdné údaje se vynechají, ne vypíší prázdné. */
function blokUdaju(nadpis: string, udaje: [string, string | null][]): HTMLDivElement {
  const blok = document.createElement("div");
  const titulek = document.createElement("p");
  titulek.className = "m-0 font-semibold";
  titulek.textContent = nadpis;
  blok.append(titulek);

  const seznam = document.createElement("dl");
  seznam.className = "m-0 mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1";
  for (const [popisek, hodnota] of udaje) {
    const text = (hodnota ?? "").trim();
    if (!text) continue;
    const dt = document.createElement("dt");
    dt.className = "m-0 text-popisek";
    dt.textContent = popisek;
    const dd = document.createElement("dd");
    dd.className = "m-0";
    dd.textContent = text;
    seznam.append(dt, dd);
  }
  blok.append(seznam);
  return blok;
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
    "Datum akce",
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
        // Česky, ne ISO. Soubor otevírá člověk v Excelu, ne stroj.
        ceskyDenAkce(p.datum_akce),
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
  prvek<HTMLSelectElement>("razeni")?.addEventListener("change", vykresliTabulku);
  prvek<HTMLInputElement>("filtr-hledani")?.addEventListener("input", vykresliTabulku);
  prvek<HTMLButtonElement>("tlacitko-nacist-prihlasky")?.addEventListener("click", () => {
    void nactiPrihlasky();
  });
  prvek<HTMLButtonElement>("tlacitko-csv")?.addEventListener("click", stahniCsv);
  window.addEventListener("resize", srovnejDetaily);
}
