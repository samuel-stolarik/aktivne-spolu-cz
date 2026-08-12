/**
 * Úprava textů a obrázků webu.
 *
 * Seznam toho, co jde upravit, je v src/lib/obsah.ts. Tady se z něj vyrobí
 * formulář: u každé položky je napsané, kde na webu je, a pole, do kterého
 * se napíše nové znění.
 *
 * Ukládá se po jedné položce. Schválně — správce vidí u každé zvlášť,
 * jestli se uložení povedlo, a když vypadne spojení, nepřijde o všechno.
 *
 * Když se text vrátí na původní znění (tlačítkem „Vrátit původní"), řádek
 * se z databáze smaže a web se vrátí k tomu, co je v HTML.
 */
import { KATALOG, skupinyKatalogu, type PolozkaObsahu } from "../../lib/obsah";
import { zavolej } from "./klient";
import { nahrajObrazek } from "./obrazky";
import { sHlasenim, ukazStav, type DruhStavu } from "./stav";

/** Uložené přepisy z databáze: klíč → nové znění. */
let prepisy: Record<string, string> = {};

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

/** Aktuální znění položky — buď přepis, nebo původní text z HTML. */
function souhrnneZneni(polozka: PolozkaObsahu): string {
  const prepis = prepisy[polozka.klic];
  return typeof prepis === "string" && prepis !== "" ? prepis : polozka.vychozi;
}

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
  const nova = hodnota.trim();

  if (nova === "") {
    ukazStav(
      hlaska,
      "chyba",
      'Pole nesmí zůstat prázdné. Když chcete původní znění, použijte tlačítko „Vrátit původní".',
    );
    return;
  }

  // Shoda s původním zněním = přepis není potřeba. Místo ukládání prázdné
  // změny se řádek radši smaže, ať v databázi nezůstává nic zbytečného.
  const jePuvodni = nova === polozka.vychozi.trim();

  const hotovo = jePuvodni
    ? "Uloženo — text je stejný jako původní, web ho bere z původního znění."
    : "Uloženo. Na webu se text objeví po obnovení stránky.";

  const vysledek = await sHlasenim(
    hlaska,
    { probiha: "Ukládám…", hotovo },
    async () => {
      if (jePuvodni) {
        await zavolej("zrus-obsah", { klic: polozka.klic });
        delete prepisy[polozka.klic];
      } else {
        await zavolej("uloz-obsah", { klic: polozka.klic, hodnota: nova });
        prepisy[polozka.klic] = nova;
      }
      return true;
    },
    {
      tlacitko,
      zopakovat: () => void ulozPolozku(polozka, hodnota, hlaska, tlacitko, poUlozeni),
    },
  );

  if (vysledek) poUlozeni({ druh: "hotovo", text: hotovo });
}

async function vratPuvodni(
  polozka: PolozkaObsahu,
  hlaska: HTMLElement,
  tlacitko: HTMLButtonElement,
  poVraceni: (hlaskaProNovouKartu: HlaskaKarty) => void,
): Promise<void> {
  const hotovo = "Hotovo. Na webu je zase původní znění.";

  const vysledek = await sHlasenim(
    hlaska,
    { probiha: "Vracím původní znění…", hotovo },
    async () => {
      await zavolej("zrus-obsah", { klic: polozka.klic });
      delete prepisy[polozka.klic];
      return true;
    },
    {
      tlacitko,
      zopakovat: () => void vratPuvodni(polozka, hlaska, tlacitko, poVraceni),
    },
  );

  if (vysledek) poVraceni({ druh: "hotovo", text: hotovo });
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

  const jeUpraveno = typeof prepisy[polozka.klic] === "string";

  // --- popisek, ať je jasné, kde na webu ta věc je ---
  const popisek = document.createElement("label");
  popisek.className = "admin-popisek";
  popisek.htmlFor = `pole-${polozka.klic}`;
  popisek.textContent = polozka.popis;

  const znacka = document.createElement("span");
  znacka.className = "admin-stitek";
  znacka.textContent = "upraveno";
  if (jeUpraveno) popisek.append(" ", znacka);

  karta.append(popisek);

  const hlaska = document.createElement("p");
  hlaska.className = "admin-hlaska mt-2";

  // Po uložení se karta překreslí — přibude na ní štítek „upraveno"
  // a tlačítko „Vrátit původní". Potvrzení o uložení se přenese na novou
  // kartu, aby správci nezmizelo před očima.
  const prekresli = (hlaskaProNovouKartu?: HlaskaKarty) => {
    karta.replaceWith(vykresliPolozku(polozka, hlaskaProNovouKartu));
  };

  // --- obrázek ------------------------------------------------------------
  if (polozka.typ === "obrazek") {
    const nahled = document.createElement("img");
    nahled.src = souhrnneZneni(polozka);
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

        const hotovo = "Uloženo. Na webu se obrázek objeví po obnovení stránky.";

        const vysledek = await sHlasenim(
          hlaska,
          { probiha: "Ukládám nový obrázek…", hotovo },
          async () => {
            await zavolej("uloz-obsah", { klic: polozka.klic, hodnota: adresa });
            prepisy[polozka.klic] = adresa;
            return true;
          },
        );

        if (vysledek) prekresli({ druh: "hotovo", text: hotovo });
      })();
    });

    karta.append(nahled, vyber);

    if (jeUpraveno) {
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
  pole.value = souhrnneZneni(polozka);

  if (pole instanceof HTMLTextAreaElement) {
    pole.rows = Math.min(8, Math.max(3, Math.ceil(pole.value.length / 70)));
  } else {
    (pole as HTMLInputElement).type =
      polozka.typ === "email" ? "email" : polozka.typ === "telefon" ? "tel" : "text";
  }

  karta.append(pole);

  // Původní znění je vidět jen tehdy, když se od zobrazeného liší. Jinak by
  // to byla zbytečná dvojitá informace.
  if (jeUpraveno && prepisy[polozka.klic] !== polozka.vychozi) {
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

  if (jeUpraveno) {
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

export async function nactiTexty(): Promise<void> {
  const hlaska = document.getElementById("hlaska-texty");
  const tlacitko = document.getElementById(
    "tlacitko-nacist-texty",
  ) as HTMLButtonElement | null;

  const vysledek = await sHlasenim(
    hlaska,
    { probiha: "Načítám texty…", hotovo: "Texty jsou načtené." },
    () =>
      zavolej<{ obsah: { klic: string; hodnota: string }[] }>("obsah"),
    { tlacitko, zopakovat: () => void nactiTexty() },
  );

  if (!vysledek) return;

  prepisy = {};
  for (const radek of vysledek.obsah) prepisy[radek.klic] = radek.hodnota;

  vykresliTexty();
  window.setTimeout(() => ukazStav(hlaska, "nic"), 3000);
}

export function pripravTexty(): void {
  document.getElementById("tlacitko-nacist-texty")?.addEventListener("click", () => {
    void nactiTexty();
  });
}
