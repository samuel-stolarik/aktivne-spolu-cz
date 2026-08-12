/**
 * Kontrola katalogu upravitelných textů.
 *
 * PROČ TO EXISTUJE
 * Administrace mění texty na hotovém webu tak, že je na stránce najde podle
 * jejich PŮVODNÍHO ZNĚNÍ. To znění je zapsané v katalogu v src/lib/obsah.ts.
 * Kdyby se text na webu změnil a v katalogu ne, přepis by se přestal používat
 * — potichu. Správce by v administraci uložil nový text a na webu by se nic
 * nestalo.
 *
 * Tenhle skript projde sestavený web a ověří, že se každé původní znění
 * z katalogu na stránkách opravdu vyskytuje. Když ne, vypíše, co je špatně,
 * a skončí s chybou.
 *
 * Spouští se přes `npm run kontrola-obsahu` (potřebuje hotový `npm run build`).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const korenProjektu = resolve(import.meta.dirname, "..");
const slozkaDist = resolve(korenProjektu, "dist");
const souborKatalogu = resolve(korenProjektu, "src/lib/obsah.ts");

// ---------------------------------------------------------------------------
// Načtení katalogu
// ---------------------------------------------------------------------------
// Katalog je v TypeScriptu, který Node přímo nepřečte. Vytáhneme z něj jen
// samotný seznam v hranatých závorkách — jsou v něm výhradně objekty
// s textovými hodnotami, takže se dá vyhodnotit jako obyčejný JavaScript.

function nactiKatalog() {
  const zdroj = readFileSync(souborKatalogu, "utf8");
  const zacatek = zdroj.indexOf("export const KATALOG");
  const prvniZavorka = zdroj.indexOf("[", zacatek);
  const konec = zdroj.indexOf("\n];", prvniZavorka);

  if (zacatek === -1 || prvniZavorka === -1 || konec === -1) {
    console.error(
      "V src/lib/obsah.ts se nepodařilo najít seznam KATALOG. " +
        "Nezměnil se tvar zápisu?",
    );
    process.exit(1);
  }

  const seznam = zdroj.slice(prvniZavorka, konec + 2);
  return Function(`"use strict"; return (${seznam});`)();
}

// ---------------------------------------------------------------------------
// Text sestaveného webu
// ---------------------------------------------------------------------------

/** Stejné sjednocení mezer jako v src/lib/obsah.ts. */
function sjednotText(text) {
  return text.replace(/\s+/g, " ").trim();
}

function nahradEntity(text) {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, cislo) => String.fromCodePoint(Number(cislo)))
    .replace(/&amp;/g, "&");
}

/** Viditelný text stránky — bez značek, skriptů a stylů. */
function textStranky(html) {
  const bezSkriptu = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  return sjednotText(nahradEntity(bezSkriptu.replace(/<[^>]+>/g, " ")));
}

/** Všechny adresy obrázků použité v HTML. */
function adresyObrazku(html) {
  return [...html.matchAll(/<img[^>]*\ssrc="([^"]+)"/gi)].map((n) => n[1]);
}

function najdiHtmlSoubory(slozka) {
  const nalezene = [];
  for (const polozka of readdirSync(slozka)) {
    const cesta = join(slozka, polozka);
    if (statSync(cesta).isDirectory()) nalezene.push(...najdiHtmlSoubory(cesta));
    else if (polozka.endsWith(".html")) nalezene.push(cesta);
  }
  return nalezene;
}

// ---------------------------------------------------------------------------
// Kontrola
// ---------------------------------------------------------------------------

let soubory;
try {
  soubory = najdiHtmlSoubory(slozkaDist);
} catch {
  console.error("Složka dist/ neexistuje. Nejdřív spusť `npm run build`.");
  process.exit(1);
}

const katalog = nactiKatalog();

const texty = [];
const obrazky = new Set();
for (const soubor of soubory) {
  const html = readFileSync(soubor, "utf8");
  texty.push(textStranky(html));
  for (const adresa of adresyObrazku(html)) obrazky.add(adresa);
}

const chybejici = [];
const duplicitniKlice = [];
const videneKlice = new Set();

for (const polozka of katalog) {
  if (videneKlice.has(polozka.klic)) duplicitniKlice.push(polozka.klic);
  videneKlice.add(polozka.klic);

  if (polozka.typ === "obrazek") {
    if (!obrazky.has(polozka.vychozi)) {
      chybejici.push({ klic: polozka.klic, hledano: polozka.vychozi });
    }
    continue;
  }

  const hledano = sjednotText(polozka.vychozi);
  if (!texty.some((text) => text.includes(hledano))) {
    chybejici.push({ klic: polozka.klic, hledano });
  }
}

if (duplicitniKlice.length > 0) {
  console.error("V katalogu je stejný klíč dvakrát:");
  for (const klic of duplicitniKlice) console.error(`  ${klic}`);
}

if (chybejici.length > 0) {
  console.error(
    `\nNa webu se nenašlo ${chybejici.length} z ${katalog.length} původních znění.`,
  );
  console.error(
    "Buď se text na webu změnil a v katalogu ne, nebo je v katalogu překlep.",
  );
  console.error("Dokud se to nesrovná, tyhle texty nepůjde z administrace měnit:\n");
  for (const { klic, hledano } of chybejici) {
    console.error(`  ${klic}`);
    console.error(`    hledáno: „${hledano}"\n`);
  }
  process.exit(1);
}

if (duplicitniKlice.length > 0) process.exit(1);

console.log(
  `V pořádku: všech ${katalog.length} položek katalogu se na webu našlo ` +
    `(${soubory.length} stránek).`,
);
