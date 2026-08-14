/**
 * Klikací náhled webu — úprava textů přímo tam, kde na stránce jsou.
 *
 * ===========================================================================
 * PROČ TO TAK JE
 * ===========================================================================
 * V seznamu políček pod sebou musel správce v hlavě párovat „tenhle řádek
 * v administraci = tenhle text na stránce". Tady se ukáže skutečný web,
 * upravitelné texty jsou v něm vyznačené a klepnutím se rovnou upravují.
 *
 * ===========================================================================
 * JAK TO FUNGUJE — A CO SE PROTO NEMUSELO NIKAM DOPISOVAT
 * ===========================================================================
 * Web se ukazuje ve vloženém rámu (iframe). Rám i administrace jsou na stejné
 * adrese, takže administrace vidí dovnitř a může s náhledem pracovat rovnou —
 * bez posílání zpráv mezi okny a hlavně BEZ JEDINÉHO ŘÁDKU NAVÍC VE VEŘEJNÝCH
 * STRÁNKÁCH. Vyznačení, obsluha klepnutí i styly vzniknou až v prohlížeči
 * správce; v souborech, které jdou na hosting, po nich není ani stopa.
 *
 * Párování textu s místem na stránce zůstává stejné jako na webu: hledá se
 * podle ZNĚNÍ, ne podle značek v HTML. Dělá to tentýž kód (src/lib/obsah.ts),
 * jen nad dokumentem rámu. Kdyby si náhled párování dělal po svém, upravovalo
 * by se v něm něco jiného, než co se pak objeví návštěvníkovi.
 *
 * Hledá se aktuální znění (tedy uložený přepis, když existuje), protože přesně
 * to je v náhledu vidět.
 *
 * ===========================================================================
 * NÁHLED JE JEN NA UKÁZKU
 * ===========================================================================
 * Klepnutí uvnitř rámu se zastavuje. V náhledu tedy nejde odeslat přihlášku
 * ani odejít na jinou stránku — správce by jinak omylem založil přihlášku
 * nebo si náhled „proklikal" pryč. Rám má k tomu ještě `sandbox`, takže
 * odeslání formuláře zakazuje i sám prohlížeč.
 */
import {
  KATALOG,
  najdiObrazkySAdresou,
  najdiPrvkySTextem,
  pouzijPrepisy,
  srovnejOdkaz,
  vlozObrazekDoPrvku,
  vlozTextDoPrvku,
  type PolozkaObsahu,
} from "../../lib/obsah";
import { nahrajObrazek } from "./obrazky";
import {
  jeUpraveno,
  priZmeneObsahu,
  ulozZneni,
  vratPuvodniZneni,
  vsechnyPrepisy,
  zneni,
} from "./obsahStav";
import { oznacRozepsane, sHlasenim, ukazStav } from "./stav";

/** Po kolika milisekundách se čekání na načtení náhledu vzdá. */
const CASOVY_LIMIT_MS = 20000;

/** Adresa webu. Náhled na GitHub Pages běží v podadresáři, proto ne natvrdo „/". */
const ADRESA_WEBU = import.meta.env.BASE_URL || "/";

/** Nalezená položka a všechna místa v náhledu, kde je vidět. */
interface MistoVNahledu {
  polozka: PolozkaObsahu;
  prvky: Element[];
}

/** Co je právě otevřené k úpravě. Vždycky nejvýš jedna položka. */
interface OtevrenaUprava {
  misto: MistoVNahledu;
  karta: HTMLElement;
  hlaska: HTMLElement;
  /** Znění, které bylo v náhledu ve chvíli otevření — pro zahození úprav. */
  zneniPriOtevreni: string;
  /** Je v poli něco jiného, než co je uložené? */
  jeRozepsano: boolean;
}

const nalezene = new Map<string, MistoVNahledu>();
let otevrena: OtevrenaUprava | null = null;
let dokumentNahledu: Document | null = null;

/** Přepnutí na seznam textů. Dodá texty.ts, aby na sebe soubory nekroužily. */
let prepniNaSeznam: (() => void) | null = null;

export function nastavPrepnutiNaSeznam(prepnuti: () => void): void {
  prepniNaSeznam = prepnuti;
}

function ram(): HTMLIFrameElement | null {
  return document.getElementById("ram-nahledu") as HTMLIFrameElement | null;
}

function hlaskaNahledu(): HTMLElement | null {
  return document.getElementById("hlaska-nahledu");
}

// ---------------------------------------------------------------------------
// VZHLED VYZNAČENÍ UVNITŘ NÁHLEDU
// ---------------------------------------------------------------------------
// Styly se vkládají do dokumentu rámu až tady v prohlížeči. Barvy jsou opsané
// z designového systému (global.css) — do rámu se proměnné administrace
// nedostanou, protože je to jiný dokument.
//
// Červená se schválně nepoužívá: ta patří výhradně tlačítkům. Upravitelný text
// je tyrkysový, už upravený meruňkový.

// Vyznačuje se VÝHRADNĚ rámečkem, nikdy podbarvením. Podbarvení by přebilo
// barvu samotné stránky — třeba nápis na červeném tlačítku by se stal
// nečitelným. Stavy se od sebe liší tloušťkou, stylem a barvou rámečku.
const STYLY_NAHLEDU = `
  [data-as-klic] {
    outline: 2px dashed #12707f;
    outline-offset: 3px;
    border-radius: 3px;
    cursor: pointer;
  }
  [data-as-klic]:hover {
    outline-style: solid;
  }
  [data-as-klic].as-upraveno {
    outline-color: #f0b95e;
    outline-style: solid;
  }
  [data-as-klic].as-upravuje {
    outline: 3px solid #12707f;
    outline-offset: 5px;
  }
  /* Vypnuté vyznačení: web vypadá přesně tak, jak ho uvidí návštěvník.
     Klepnout jde pořád, jen to není vidět dopředu. Právě upravovaný text
     zůstává vyznačený — jinak by nebylo poznat, čeho se kartička týká. */
  .as-bez-znaceni [data-as-klic] {
    outline: none;
  }
  .as-bez-znaceni [data-as-klic].as-upravuje {
    outline: 3px solid #12707f;
  }
`;

function vlozStylyDoNahledu(dok: Document): void {
  if (dok.getElementById("as-styly-editace")) return;

  const styl = dok.createElement("style");
  styl.id = "as-styly-editace";
  styl.textContent = STYLY_NAHLEDU;
  dok.head.append(styl);
}

// ---------------------------------------------------------------------------
// NAČTENÍ NÁHLEDU
// ---------------------------------------------------------------------------

/**
 * Počká, až se web v rámu načte.
 *
 * Časový limit je tu schválně: bez něj by se při výpadku sítě čekalo
 * donekonečna a na obrazovce by pořád svítilo „načítám".
 */
function pockejNaNahled(rameček: HTMLIFrameElement): Promise<Document> {
  return new Promise((hotovo, selhalo) => {
    const uklid = () => {
      window.clearTimeout(hlidac);
      rameček.removeEventListener("load", nacteno);
    };

    const hlidac = window.setTimeout(() => {
      uklid();
      selhalo(
        new Error(
          "Náhled webu se nenačetl. Zkontrolujte připojení k internetu a zkuste to znovu.",
        ),
      );
    }, CASOVY_LIMIT_MS);

    const nacteno = () => {
      uklid();
      const dok = rameček.contentDocument;
      if (!dok || !dok.body) {
        selhalo(
          new Error("Náhled webu se nepodařilo otevřít. Zkuste to prosím znovu."),
        );
        return;
      }
      hotovo(dok);
    };

    rameček.addEventListener("load", nacteno);
    // Pokaždé nová adresa s časovým razítkem, ať se náhled nebere z paměti
    // prohlížeče. Jinak by po uložení textu ukazoval starý stav.
    rameček.src = `${ADRESA_WEBU}?nahled=${Date.now()}`;
  });
}

/**
 * Vyznačí v náhledu všechno, co jde upravit.
 *
 * @returns Položky, které se v náhledu NENAŠLY. Ty zůstávají na seznam.
 */
function oznacUpravitelne(dok: Document): PolozkaObsahu[] {
  nalezene.clear();

  const zabrane: Element[] = [];
  const chybejici: PolozkaObsahu[] = [];

  for (const polozka of KATALOG) {
    const hodnota = zneni(polozka);

    const nalez =
      polozka.typ === "obrazek"
        ? najdiObrazkySAdresou(hodnota, dok)
        : najdiPrvkySTextem(hodnota, dok);

    // Dvě položky se nesmí poprat o jedno místo na stránce. Kdyby se jedna
    // vešla do druhé, úprava té vnější by tu vnitřní smazala.
    const prvky = nalez.filter(
      (prvek) =>
        !zabrane.some(
          (zabrany) =>
            zabrany === prvek || zabrany.contains(prvek) || prvek.contains(zabrany),
        ),
    );

    if (prvky.length === 0) {
      chybejici.push(polozka);
      continue;
    }

    for (const prvek of prvky) {
      zabrane.push(prvek);
      prvek.setAttribute("data-as-klic", polozka.klic);
      // Klávesnicí se musí dát dělat totéž co myší.
      prvek.setAttribute("tabindex", "0");
      prvek.setAttribute("title", `Upravit: ${polozka.popis}`);
      prvek.classList.toggle("as-upraveno", jeUpraveno(polozka.klic));
    }

    nalezene.set(polozka.klic, { polozka, prvky });
  }

  return chybejici;
}

/** Klepnutí, klávesnice a zákaz odesílání čehokoli z náhledu. */
function pripojOvladaniNahledu(dok: Document): void {
  dok.addEventListener(
    "click",
    (udalost) => {
      // Zastavíme úplně všechno. Náhled je na ukázku, ne k proklikávání —
      // z formuláře by šla omylem odeslat opravdová přihláška.
      udalost.preventDefault();
      udalost.stopPropagation();

      const cil = (udalost.target as Element | null)?.closest?.("[data-as-klic]");
      if (cil) otevriUpravu(cil.getAttribute("data-as-klic") ?? "");
      else zavriUpravu();
    },
    true,
  );

  dok.addEventListener(
    "keydown",
    (udalost) => {
      if (udalost.key !== "Enter" && udalost.key !== " ") return;

      const cil = (udalost.target as Element | null)?.closest?.("[data-as-klic]");
      if (!cil) return;

      udalost.preventDefault();
      otevriUpravu(cil.getAttribute("data-as-klic") ?? "");
    },
    true,
  );

  // Pojistka navíc k `sandbox` v HTML: z náhledu se nic neodesílá.
  dok.addEventListener(
    "submit",
    (udalost) => {
      udalost.preventDefault();
      udalost.stopPropagation();
    },
    true,
  );

  // Když se náhledem posouvá, musí kartička s úpravou zůstat u svého textu.
  dok.defaultView?.addEventListener("scroll", umistiKartu, { passive: true });
}

/**
 * Načte náhled webu a připraví ho k úpravám.
 *
 * Volá se při otevření záložky a po klepnutí na „Načíst náhled znovu".
 */
export async function nactiNahled(): Promise<void> {
  const rameček = ram();
  const hlaska = hlaskaNahledu();
  const tlacitko = document.getElementById(
    "tlacitko-nacist-nahled",
  ) as HTMLButtonElement | null;

  if (!rameček) return;

  if (!zavriUpravu()) return;

  const chybejici = await sHlasenim(
    hlaska,
    {
      probiha: "Načítám náhled webu…",
      hotovo: "Náhled je připravený. Klepněte v něm na text, který chcete upravit.",
    },
    async () => {
      const dok = await pockejNaNahled(rameček);
      dokumentNahledu = dok;

      // Přepisy si sice stránka v rámu stahuje i sama, ale až po chvíli.
      // Doplníme je rovnou z toho, co administrace už má — jinak by se
      // hledalo podle znění, které v náhledu ještě není.
      pouzijPrepisy(vsechnyPrepisy(), dok);

      vlozStylyDoNahledu(dok);
      pripojOvladaniNahledu(dok);
      nastavZnaceni(jeZnaceniZapnute());

      return oznacUpravitelne(dok);
    },
    { tlacitko, zopakovat: () => void nactiNahled() },
  );

  if (!chybejici) {
    dokumentNahledu = null;
    return;
  }

  ohlasNenalezene(chybejici);
}

/**
 * Řekne, co se v náhledu nepovedlo najít — a kde se to upravit dá.
 *
 * Mlčet se nesmí: správce by marně hledal text, na který nejde klepnout,
 * a myslel by si, že upravit nejde vůbec.
 */
function ohlasNenalezene(chybejici: PolozkaObsahu[]): void {
  const misto = document.getElementById("nenalezene-texty");
  if (!misto) return;

  misto.textContent = "";
  misto.hidden = chybejici.length === 0;
  if (chybejici.length === 0) return;

  const veta = document.createElement("p");
  veta.className = "m-0";
  veta.textContent =
    chybejici.length === 1
      ? "Jeden text se v náhledu nepodařilo najít, klepnutím ho upravit nejde. Upravit ho můžete v seznamu:"
      : `Celkem ${chybejici.length} textů se v náhledu nepodařilo najít, klepnutím je upravit nejde. Upravit je můžete v seznamu:`;

  // Vlastní třída místo pomocných tříd Tailwindu schválně: ty se sázejí do
  // společného souboru se styly, který si stahuje i veřejný web. Kvůli výpisu
  // v administraci by návštěvníci stahovali pravidla, která k ničemu nepotřebují.
  const seznam = document.createElement("ul");
  seznam.className = "admin-vypis mt-2 mb-0";
  for (const polozka of chybejici) {
    const radek = document.createElement("li");
    radek.textContent = `${polozka.skupina} — ${polozka.popis}`;
    seznam.append(radek);
  }

  const odkaz = document.createElement("button");
  odkaz.type = "button";
  odkaz.className = "admin-tlacitko-vedlejsi mt-3";
  odkaz.textContent = "Otevřít seznam textů";
  odkaz.addEventListener("click", () => prepniNaSeznam?.());

  misto.append(veta, seznam, odkaz);
}

// ---------------------------------------------------------------------------
// ZOBRAZENÍ ZMĚNY V NÁHLEDU
// ---------------------------------------------------------------------------

/** Vloží znění na všechna místa v náhledu, kde ta položka je. */
function zobrazVNahledu(misto: MistoVNahledu, hodnota: string): void {
  for (const prvek of misto.prvky) {
    if (misto.polozka.typ === "obrazek") {
      vlozObrazekDoPrvku(prvek, hodnota);
    } else {
      vlozTextDoPrvku(prvek, hodnota);
      srovnejOdkaz(prvek, misto.polozka.typ, hodnota);
    }
  }
}

/** Přebarví vyznačení podle toho, jestli je položka upravená. */
function srovnejZnaceni(misto: MistoVNahledu): void {
  for (const prvek of misto.prvky) {
    prvek.classList.toggle("as-upraveno", jeUpraveno(misto.polozka.klic));
  }
}

// Když se text uloží v seznamu, musí se to hned projevit i v náhledu.
// Bez toho by seznam a náhled ukazovaly každý něco jiného.
priZmeneObsahu((klic) => {
  const misto = nalezene.get(klic);
  if (!misto) return;

  // Do právě rozepsané položky se nesahá, přišel by o ni.
  if (otevrena?.misto.polozka.klic === klic && otevrena.jeRozepsano) return;

  zobrazVNahledu(misto, zneni(misto.polozka));
  srovnejZnaceni(misto);
});

// ---------------------------------------------------------------------------
// ROZEPSANÝ TEXT
// ---------------------------------------------------------------------------
// Rozepsané je vždycky nejvýš jedno — to, co je právě otevřené. Hlídání
// zavření okna je společné se seznamem, proto je ve stav.ts.

const OZNACENI_ROZEPSANEHO = "nahled";

function poznamenejRozepsane(jeRozepsano: boolean): void {
  if (otevrena) otevrena.jeRozepsano = jeRozepsano;
  oznacRozepsane(OZNACENI_ROZEPSANEHO, jeRozepsano);
}

// ---------------------------------------------------------------------------
// KARTIČKA S ÚPRAVOU
// ---------------------------------------------------------------------------

/**
 * Postaví kartičku k jedné položce.
 *
 * Kartička je v dokumentu administrace, ne v náhledu — do stránky v rámu se
 * nic nevkládá. Umisťuje se k textu, kterého se týká.
 */
function postavKartu(misto: MistoVNahledu, uvodniHlaska?: { druh: "hotovo"; text: string }): void {
  const { polozka } = misto;

  const karta = document.createElement("div");
  karta.className = "admin-editor";
  karta.setAttribute("role", "dialog");
  karta.setAttribute("aria-label", `Úprava textu: ${polozka.popis}`);

  const kde = document.createElement("p");
  kde.className = "admin-editor-kde";
  kde.textContent = polozka.skupina;

  const popisek = document.createElement("label");
  popisek.className = "admin-popisek";
  popisek.htmlFor = "pole-nahledu";
  popisek.textContent = polozka.popis;

  const hlaska = document.createElement("p");
  hlaska.className = "admin-hlaska mt-3";

  karta.append(kde, popisek);

  const radek = document.createElement("div");
  radek.className = "mt-3 flex flex-wrap gap-3";

  // --- obrázek ------------------------------------------------------------
  if (polozka.typ === "obrazek") {
    const vyber = document.createElement("input");
    vyber.type = "file";
    vyber.id = "pole-nahledu";
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

        if (vysledek === undefined) return;

        zobrazVNahledu(misto, adresa);
        srovnejZnaceni(misto);
        postavKartu(misto, { druh: "hotovo", text: vysledek });
      })();
    });

    karta.append(vyber);
  } else {
    // --- text -------------------------------------------------------------
    const jeDlouhy = polozka.typ === "dlouhy";
    const pole = document.createElement(jeDlouhy ? "textarea" : "input") as
      | HTMLInputElement
      | HTMLTextAreaElement;

    pole.id = "pole-nahledu";
    pole.className = "admin-pole";
    pole.value = zneni(polozka);

    if (pole instanceof HTMLTextAreaElement) {
      pole.rows = Math.min(8, Math.max(3, Math.ceil(pole.value.length / 60)));
    } else {
      (pole as HTMLInputElement).type =
        polozka.typ === "email" ? "email" : polozka.typ === "telefon" ? "tel" : "text";
    }

    // Psaní je hned vidět v náhledu. Zároveň je jasně napsané, že to ještě
    // není uložené — rozepsaný text nesmí vypadat jako hotová věc.
    pole.addEventListener("input", () => {
      zobrazVNahledu(misto, pole.value);

      const jinak = pole.value !== zneni(polozka);
      poznamenejRozepsane(jinak);

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

    const ulozit = document.createElement("button");
    ulozit.type = "button";
    ulozit.className = "admin-tlacitko";
    ulozit.textContent = "Uložit";
    ulozit.addEventListener("click", () => void uloz(misto, pole.value, hlaska, ulozit));

    karta.append(pole);
    radek.append(ulozit);
  }

  // --- původní znění ------------------------------------------------------
  if (jeUpraveno(polozka.klic) && polozka.typ !== "obrazek") {
    const puvodni = document.createElement("p");
    puvodni.className = "admin-puvodni";
    puvodni.textContent = `Původní znění: ${polozka.vychozi}`;
    karta.append(puvodni);
  }

  // --- vrácení původního znění -------------------------------------------
  if (jeUpraveno(polozka.klic)) {
    const vratit = document.createElement("button");
    vratit.type = "button";
    vratit.className = "admin-tlacitko-vedlejsi";
    vratit.textContent =
      polozka.typ === "obrazek" ? "Vrátit původní obrázek" : "Vrátit původní";
    vratit.addEventListener("click", () => void vrat(misto, hlaska, vratit));
    radek.append(vratit);
  }

  const zavrit = document.createElement("button");
  zavrit.type = "button";
  zavrit.className = "admin-tlacitko-vedlejsi";
  zavrit.textContent = "Zavřít";
  zavrit.addEventListener("click", () => zavriUpravu());
  radek.append(zavrit);

  karta.append(radek, hlaska);

  // Stará kartička se nahradí novou na stejném místě.
  otevrena?.karta.remove();

  document.body.append(karta);

  otevrena = {
    misto,
    karta,
    hlaska,
    zneniPriOtevreni: zneni(polozka),
    jeRozepsano: false,
  };

  if (uvodniHlaska) ukazStav(hlaska, uvodniHlaska.druh, uvodniHlaska.text);

  umistiKartu();

  const pole = karta.querySelector<HTMLElement>("#pole-nahledu");
  pole?.focus();
}

/** Umístí kartičku k textu, kterého se týká, a nenechá ji utéct z obrazovky. */
function umistiKartu(): void {
  if (!otevrena) return;

  const rameček = ram();
  const prvek = otevrena.misto.prvky[0];
  if (!rameček || !prvek) return;

  const okraj = 12;
  const mistoRamu = rameček.getBoundingClientRect();
  const mistoPrvku = prvek.getBoundingClientRect();
  const sirka = otevrena.karta.offsetWidth;
  const vyska = otevrena.karta.offsetHeight;

  // Vodorovně: začít u textu, ale nevylézt z rámu ani z obrazovky.
  let vlevo = mistoRamu.left + mistoPrvku.left;
  vlevo = Math.min(vlevo, mistoRamu.right - sirka - okraj);
  vlevo = Math.min(vlevo, window.innerWidth - sirka - okraj);
  vlevo = Math.max(vlevo, okraj);

  // Svisle: pod text; když by se nevešla, tak nad něj.
  let nahore = mistoRamu.top + mistoPrvku.bottom + 10;
  if (nahore + vyska > window.innerHeight - okraj) {
    const nad = mistoRamu.top + mistoPrvku.top - vyska - 10;
    nahore = nad >= okraj ? nad : Math.max(okraj, window.innerHeight - vyska - okraj);
  }

  otevrena.karta.style.left = `${Math.round(vlevo)}px`;
  otevrena.karta.style.top = `${Math.round(nahore)}px`;
}

// ---------------------------------------------------------------------------
// OTEVŘENÍ A ZAVŘENÍ ÚPRAVY
// ---------------------------------------------------------------------------

function otevriUpravu(klic: string): void {
  const misto = nalezene.get(klic);
  if (!misto) return;

  // Už je otevřená ta samá položka → nechat být, ať se nemaže rozepsaný text.
  if (otevrena?.misto.polozka.klic === klic) return;

  if (!zavriUpravu()) return;

  // Text se musí posunout do viditelné části náhledu, jinak by se upravovalo
  // něco, na co není vidět.
  const prvek = misto.prvky[0];
  const vyskaNahledu = dokumentNahledu?.defaultView?.innerHeight ?? 0;
  const kde = prvek.getBoundingClientRect();
  if (kde.top < 0 || kde.bottom > vyskaNahledu) {
    prvek.scrollIntoView({ block: "center", behavior: "auto" });
  }

  for (const kus of misto.prvky) kus.classList.add("as-upravuje");

  postavKartu(misto);
}

/**
 * Zavře otevřenou úpravu.
 *
 * Když je v ní něco rozepsaného, nejdřív se zeptá. Rozepsaný text nesmí
 * zmizet jen tak.
 *
 * @returns false, když se zavřít nemá (správce si to rozmyslel).
 */
export function zavriUpravu(): boolean {
  if (!otevrena) return true;

  if (otevrena.jeRozepsano) {
    const potvrzeno = window.confirm(
      "Máte rozepsanou úpravu, která se ještě neuložila. Chcete ji zahodit?",
    );
    if (!potvrzeno) return false;

    // Náhled se vrátí k tomu, co je opravdu uložené.
    zobrazVNahledu(otevrena.misto, otevrena.zneniPriOtevreni);
  }

  for (const prvek of otevrena.misto.prvky) prvek.classList.remove("as-upravuje");

  otevrena.karta.remove();
  otevrena = null;
  oznacRozepsane(OZNACENI_ROZEPSANEHO, false);

  return true;
}

// ---------------------------------------------------------------------------
// ULOŽENÍ A VRÁCENÍ
// ---------------------------------------------------------------------------

async function uloz(
  misto: MistoVNahledu,
  hodnota: string,
  hlaska: HTMLElement,
  tlacitko: HTMLButtonElement,
): Promise<void> {
  const vysledek = await sHlasenim(
    hlaska,
    { probiha: "Ukládám…", hotovo: "Uloženo." },
    () => ulozZneni(misto.polozka, hodnota),
    { tlacitko, zopakovat: () => void uloz(misto, hodnota, hlaska, tlacitko) },
  );

  if (vysledek === undefined) return;

  poznamenejRozepsane(false);

  zobrazVNahledu(misto, zneni(misto.polozka));
  srovnejZnaceni(misto);

  // Kartička se postaví znovu — přibude na ní „Vrátit původní" a původní
  // znění. Potvrzení o uložení se přenese, ať správci nezmizí před očima.
  postavKartu(misto, { druh: "hotovo", text: vysledek });
  for (const prvek of misto.prvky) prvek.classList.add("as-upravuje");
}

async function vrat(
  misto: MistoVNahledu,
  hlaska: HTMLElement,
  tlacitko: HTMLButtonElement,
): Promise<void> {
  const vysledek = await sHlasenim(
    hlaska,
    { probiha: "Vracím původní znění…", hotovo: "Hotovo." },
    () => vratPuvodniZneni(misto.polozka),
    { tlacitko, zopakovat: () => void vrat(misto, hlaska, tlacitko) },
  );

  if (vysledek === undefined) return;

  poznamenejRozepsane(false);

  zobrazVNahledu(misto, misto.polozka.vychozi);
  srovnejZnaceni(misto);

  postavKartu(misto, { druh: "hotovo", text: vysledek });
  for (const prvek of misto.prvky) prvek.classList.add("as-upravuje");
}

// ---------------------------------------------------------------------------
// VYZNAČENÍ ZAP/VYP
// ---------------------------------------------------------------------------

function jeZnaceniZapnute(): boolean {
  const prepinac = document.getElementById(
    "prepinac-znaceni",
  ) as HTMLInputElement | null;
  return prepinac ? prepinac.checked : true;
}

function nastavZnaceni(zapnuto: boolean): void {
  dokumentNahledu?.documentElement.classList.toggle("as-bez-znaceni", !zapnuto);
}

// ---------------------------------------------------------------------------
// SPUŠTĚNÍ
// ---------------------------------------------------------------------------

/** Zapojí ovladače nad náhledem. Volá se jednou při spuštění administrace. */
export function pripravNahled(): void {
  document
    .getElementById("tlacitko-nacist-nahled")
    ?.addEventListener("click", () => void nactiNahled());

  document
    .getElementById("prepinac-znaceni")
    ?.addEventListener("change", () => nastavZnaceni(jeZnaceniZapnute()));

  // Kartička musí zůstat u svého textu i při posunu a změně velikosti okna.
  window.addEventListener("scroll", umistiKartu, { passive: true });
  window.addEventListener("resize", umistiKartu);

  // Únik klávesou. Bez toho by se z kartičky nešlo dostat bez myši.
  document.addEventListener("keydown", (udalost) => {
    if (udalost.key === "Escape") zavriUpravu();
  });
}

/** Je náhled webu už načtený? */
export function jeNahledNacteny(): boolean {
  return dokumentNahledu !== null;
}
