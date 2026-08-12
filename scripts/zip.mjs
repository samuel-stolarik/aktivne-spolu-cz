/**
 * Zabalí obsah složky dist/ do dist.zip.
 *
 * Pozor na strukturu: do archivu jde OBSAH složky dist/, ne složka samotná.
 * Po rozbalení na FTP tedy vznikne rovnou index.html v rootu webu,
 * ne podadresář dist/.
 *
 * Spouští se automaticky přes `npm run zip` (viz package.json).
 */
import { createWriteStream, existsSync } from "node:fs";
import { resolve } from "node:path";
import archiver from "archiver";

const korenProjektu = resolve(import.meta.dirname, "..");
const slozkaDist = resolve(korenProjektu, "dist");
const cilovyArchiv = resolve(korenProjektu, "dist.zip");

if (!existsSync(slozkaDist)) {
  console.error("Složka dist/ neexistuje. Nejdřív spusť `npm run build`.");
  process.exit(1);
}

const vystup = createWriteStream(cilovyArchiv);
const archiv = archiver("zip", { zlib: { level: 9 } });

vystup.on("close", () => {
  const velikostMb = (archiv.pointer() / 1024 / 1024).toFixed(2);
  console.log(`Hotovo: dist.zip (${velikostMb} MB)`);
  console.log("Obsah archivu nahraj na FTP do kořene webu.");
});

archiv.on("warning", (chyba) => {
  if (chyba.code === "ENOENT") console.warn("Upozornění:", chyba.message);
  else throw chyba;
});

archiv.on("error", (chyba) => {
  throw chyba;
});

archiv.pipe(vystup);
// Druhý parametr false = do archivu jde obsah složky, ne složka samotná.
archiv.directory(slozkaDist, false);
archiv.finalize();
