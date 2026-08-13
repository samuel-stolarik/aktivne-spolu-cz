/**
 * Vystaví sestavený web jako veřejný náhled na GitHub Pages.
 *
 * K čemu to je: na připomínkování a hlasování o podobě webu je potřeba
 * odkaz, který jde poslat lidem, co nemají přístup k počítači vývojáře.
 *
 * NENÍ TO OSTRÝ WEB. Ostrý web jde na aktivne-spolu.cz přes FTP
 * (viz `npm run zip`). Tohle je dočasný náhled.
 *
 * Co skript řeší navíc oproti prostému nahrání:
 *
 *   1. Vyhodí administraci — na veřejný odkaz nepatří.
 *
 *   2. Přepíše absolutní odkazy. Náhled běží v podadresáři
 *      (…github.io/aktivne-spolu-cz/), kdežto ostrý web pojede v kořeni
 *      domény. Astro si přepíše jen odkazy, které samo vygenerovalo —
 *      ručně napsané `href="/obchodni-podminky/"` v komponentách by
 *      na Pages mířilo mimo. Proto se přepisují v hotovém buildu.
 *
 *   3. Přidá soubor `.nojekyll`. Bez něj GitHub Pages zahodí všechny
 *      složky začínající podtržítkem — tedy i `_astro/`, kde jsou styly
 *      a skripty. Web by se zobrazil bez formátování.
 *
 * Spouští se přes `npm run nahled`.
 */
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  rmSync,
  cpSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, join, extname } from "node:path";

const korenProjektu = resolve(import.meta.dirname, "..");
const slozkaDist = resolve(korenProjektu, "dist");
const slozkaNahled = resolve(korenProjektu, ".nahled");

const REPO = "samuel-stolarik/aktivne-spolu-cz";
const VETEV = "gh-pages";
const PODADRESAR = "/aktivne-spolu-cz";

if (!existsSync(slozkaDist)) {
  console.error("Složka dist/ neexistuje. Nejdřív spusť `npm run build`.");
  process.exit(1);
}

// --- Příprava kopie --------------------------------------------------------
rmSync(slozkaNahled, { recursive: true, force: true });
mkdirSync(slozkaNahled, { recursive: true });
cpSync(slozkaDist, slozkaNahled, { recursive: true });

// Administrace na veřejný odkaz nepatří. Přihlášení sice chrání data,
// ale zbytečně bychom ukazovali, kudy se do ní chodí.
rmSync(resolve(slozkaNahled, "admin"), { recursive: true, force: true });

// Bez tohohle souboru GitHub Pages zahodí složku _astro/.
writeFileSync(resolve(slozkaNahled, ".nojekyll"), "");

// --- Přepis absolutních odkazů --------------------------------------------
function vsechnySoubory(slozka) {
  return readdirSync(slozka, { withFileTypes: true }).flatMap((polozka) => {
    const cesta = join(slozka, polozka.name);
    return polozka.isDirectory() ? vsechnySoubory(cesta) : [cesta];
  });
}

let prepsano = 0;

for (const soubor of vsechnySoubory(slozkaNahled)) {
  if (![".html", ".css", ".js"].includes(extname(soubor))) continue;

  const puvodni = readFileSync(soubor, "utf8");

  // Zdvojení hlídá záporný výhled: co už podadresář má, se nepřepisuje.
  const upraveny = puvodni
    .replace(
      new RegExp(`((?:href|src)=")/(?!/|${PODADRESAR.slice(1)}/)`, "g"),
      `$1${PODADRESAR}/`,
    )
    .replace(
      new RegExp(`(url\\()/(?!/|${PODADRESAR.slice(1)}/)`, "g"),
      `$1${PODADRESAR}/`,
    );

  if (upraveny !== puvodni) {
    writeFileSync(soubor, upraveny);
    prepsano++;
  }
}

console.log(`Odkazy přepsány v ${prepsano} souborech.`);

// --- Odeslání na větev gh-pages -------------------------------------------
// Náhled je jednorázový snímek, ne historie. Větev se proto pokaždé
// přepíše celá — udržovat historii buildů nemá smysl.
function git(...argumenty) {
  return execFileSync("git", argumenty, {
    cwd: slozkaNahled,
    stdio: ["ignore", "pipe", "pipe"],
  })
    .toString()
    .trim();
}

git("init", "-q", "-b", VETEV);
git("add", "-A");
git(
  "-c",
  "user.name=Samuel Stolarik",
  "-c",
  "user.email=info@trixtech.eu",
  "commit",
  "-q",
  "-m",
  "Náhled webu k připomínkování",
);
git("remote", "add", "origin", `https://github.com/${REPO}.git`);
git("push", "-q", "--force", "origin", VETEV);

const zaklad = `https://samuel-stolarik.github.io/aktivne-spolu-cz`;
console.log("");
console.log("Náhled ke sdílení:");
console.log(`  úvodní verze     ${zaklad}/`);
console.log(`  kreativní verze  ${zaklad}/kreativni/`);
console.log("");
console.log("Po prvním nahrání trvá zveřejnění asi minutu.");
console.log("Není to ostrý web — jen náhled k připomínkování.");
