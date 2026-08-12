/**
 * Nahrávání obrázků do úložiště Supabase.
 *
 * JAK SE SOUBOR DOSTANE DO ÚLOŽIŠTĚ, ANIŽ BY SE PROZRADIL SERVISNÍ KLÍČ
 * Do bucketu `obsah-obrazky` smí zapisovat jen servisní klíč, a ten do
 * prohlížeče nesmí. Proto se to dělá na dva kroky:
 *
 *   1. Prohlížeč si od Edge Funkce vyžádá JEDNORÁZOVOU adresu pro nahrání.
 *      Funkce ověří, že volá správce, a adresu vystaví. Platí dvě minuty
 *      a jen pro jeden konkrétní název souboru.
 *   2. Prohlížeč pošle soubor rovnou na tuhle adresu.
 *
 * Kdyby adresa unikla, dá se s ní nahrát jediný soubor na jediné místo
 * a za dvě minuty přestane platit.
 *
 * Bucket je veřejný pro čtení, protože obrázky se musí zobrazit návštěvníkům
 * webu. To je v pořádku — nic osobního v nich není. S bucketem `faktury`
 * se schválně nemíchá, tam jsou doklady s adresami plátců.
 */
import { klient, zavolej } from "./klient";
import { sHlasenim, ukazStav } from "./stav";

/** Největší povolená velikost souboru. Musí sedět s nastavením bucketu. */
const NEJVETSI_VELIKOST_B = 5 * 1024 * 1024;

const POVOLENE_TYPY = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

interface PripravaNahrani {
  bucket: string;
  cesta: string;
  token: string;
  verejnaAdresa: string;
}

/**
 * Nahraje jeden obrázek a vrátí adresu, na které bude veřejně dostupný.
 *
 * @returns Adresu obrázku, nebo `undefined`, když se nahrání nepovedlo.
 *          Chybová věta se v takovém případě už objevila v `hlaska`.
 */
export async function nahrajObrazek(
  soubor: File,
  hlaska: HTMLElement | null,
): Promise<string | undefined> {
  // Kontroly děláme dřív, než se cokoli posílá — ať člověk nečeká na to,
  // aby se dozvěděl, že soubor stejně neprojde.
  if (!POVOLENE_TYPY.includes(soubor.type)) {
    ukazStav(
      hlaska,
      "chyba",
      `Soubor „${soubor.name}" není obrázek ve formátu PNG, JPG, WEBP ani SVG. Vyberte prosím jiný.`,
    );
    return undefined;
  }

  if (soubor.size > NEJVETSI_VELIKOST_B) {
    const mb = (soubor.size / 1024 / 1024).toFixed(1);
    ukazStav(
      hlaska,
      "chyba",
      `Obrázek má ${mb} MB, což je moc. Vejít se musí do 5 MB — zmenšete ho prosím.`,
    );
    return undefined;
  }

  return await sHlasenim(
    hlaska,
    {
      probiha: `Nahrávám obrázek „${soubor.name}"…`,
      hotovo: "Obrázek je nahraný.",
    },
    async () => {
      const priprava = await zavolej<PripravaNahrani>("adresa-pro-nahrani", {
        nazev: soubor.name,
      });

      const { error } = await klient()
        .storage.from(priprava.bucket)
        .uploadToSignedUrl(priprava.cesta, priprava.token, soubor);

      if (error) {
        console.error("Nahrání obrázku selhalo:", error);
        throw new Error(
          "Obrázek se nepodařilo nahrát do úložiště. Zkuste to prosím znovu.",
        );
      }

      return priprava.verejnaAdresa;
    },
    { zopakovat: () => void nahrajObrazek(soubor, hlaska) },
  );
}

// ---------------------------------------------------------------------------
// PŘEHLED NAHRANÝCH OBRÁZKŮ
// ---------------------------------------------------------------------------

function vykresliObrazky(obrazky: { nazev: string; adresa: string }[]): void {
  const misto = document.getElementById("seznam-obrazku");
  if (!misto) return;

  misto.textContent = "";

  if (obrazky.length === 0) {
    const prazdno = document.createElement("p");
    prazdno.textContent =
      "Zatím tu žádný obrázek není. Nahrajte první pomocí pole nahoře.";
    misto.append(prazdno);
    return;
  }

  for (const obrazek of obrazky) {
    const karta = document.createElement("figure");
    karta.className = "admin-karta m-0";

    const nahled = document.createElement("img");
    nahled.src = obrazek.adresa;
    nahled.alt = "";
    nahled.loading = "lazy";
    nahled.className = "admin-nahled";

    const popis = document.createElement("figcaption");
    popis.className = "mt-2 text-popisek break-all";
    popis.textContent = obrazek.nazev;

    const zkopirovat = document.createElement("button");
    zkopirovat.type = "button";
    zkopirovat.className = "admin-tlacitko-vedlejsi mt-3";
    zkopirovat.textContent = "Zkopírovat adresu";

    const hlaskaKarty = document.createElement("p");
    hlaskaKarty.className = "admin-hlaska mt-2";

    zkopirovat.addEventListener("click", () => {
      void (async () => {
        try {
          await navigator.clipboard.writeText(obrazek.adresa);
          ukazStav(hlaskaKarty, "hotovo", "Adresa je zkopírovaná do schránky.");
        } catch {
          // Někde je schránka zakázaná. Adresu tedy aspoň ukážeme, ať se dá
          // označit myší — nikdy neskončit mlčením.
          ukazStav(
            hlaskaKarty,
            "chyba",
            `Zkopírovat se to nepovedlo. Adresa je: ${obrazek.adresa}`,
          );
        }
        window.setTimeout(() => ukazStav(hlaskaKarty, "nic"), 6000);
      })();
    });

    karta.append(nahled, popis, zkopirovat, hlaskaKarty);
    misto.append(karta);
  }
}

export async function nactiObrazky(): Promise<void> {
  const hlaska = document.getElementById("hlaska-obrazky");
  const tlacitko = document.getElementById(
    "tlacitko-nacist-obrazky",
  ) as HTMLButtonElement | null;

  const vysledek = await sHlasenim(
    hlaska,
    { probiha: "Načítám nahrané obrázky…", hotovo: "Obrázky jsou načtené." },
    () => zavolej<{ obrazky: { nazev: string; adresa: string }[] }>("obrazky"),
    { tlacitko, zopakovat: () => void nactiObrazky() },
  );

  if (!vysledek) return;

  vykresliObrazky(vysledek.obrazky);
  window.setTimeout(() => ukazStav(hlaska, "nic"), 3000);
}

export function pripravObrazky(): void {
  document.getElementById("tlacitko-nacist-obrazky")?.addEventListener("click", () => {
    void nactiObrazky();
  });

  const vyber = document.getElementById("pole-nahrat-obrazek") as HTMLInputElement | null;
  const hlaska = document.getElementById("hlaska-nahravani");

  vyber?.addEventListener("change", () => {
    const soubor = vyber.files?.[0];
    if (!soubor) return;

    void (async () => {
      const adresa = await nahrajObrazek(soubor, hlaska);
      // Pole vyprázdníme, ať jde tentýž soubor vybrat znovu.
      vyber.value = "";
      if (adresa) await nactiObrazky();
    })();
  });
}
