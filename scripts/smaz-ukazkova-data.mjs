/**
 * Smaže ukázkové akce z mapky.
 *
 * Ukázková data vznikla jen kvůli tomu, aby šlo Haně ukázat, jak bude mapka
 * vypadat, až se lidé začnou hlásit. Do ostrého provozu nepatří — smaž je
 * dřív, než web půjde živě.
 *
 * Poznají se podle e-mailu na doméně `ukazka.test`, kterou nikdo skutečný mít
 * nemůže. Skript nesahá na nic jiného: skutečné přihlášky mají e-maily lidí
 * a variabilní symboly od 100001, ukázkové mají 999901–999905.
 *
 * Spouští se přes `npm run smaz-ukazku`.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const korenProjektu = resolve(import.meta.dirname, "..");

const env = Object.fromEntries(
  readFileSync(resolve(korenProjektu, ".env"), "utf8")
    .split("\n")
    .filter((r) => r.includes("=") && !r.trimStart().startsWith("#"))
    .map((r) => {
      const i = r.indexOf("=");
      return [r.slice(0, i).trim(), r.slice(i + 1).trim()];
    }),
);

const adresa = env.PUBLIC_SUPABASE_URL;
const klic = env.SUPABASE_SERVICE_ROLE_KEY;

if (!adresa || !klic) {
  console.error("V .env chybí PUBLIC_SUPABASE_URL nebo SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const hlavicky = {
  apikey: klic,
  Authorization: `Bearer ${klic}`,
  "Content-Type": "application/json",
};

// Nejdřív ukázat, co se smaže. Mazat naslepo se nemá.
const pred = await fetch(
  `${adresa}/rest/v1/prihlasky?select=variabilni_symbol,mesto,nazev_poradatele&email=like.*@ukazka.test`,
  { headers: hlavicky },
);
const kSmazani = await pred.json();

if (!Array.isArray(kSmazani) || kSmazani.length === 0) {
  console.log("Žádná ukázková data v databázi nejsou. Není co mazat.");
  process.exit(0);
}

console.log(`Ke smazání ${kSmazani.length} ukázkových akcí:`);
for (const a of kSmazani) {
  console.log(`  ${a.variabilni_symbol}  ${a.mesto}  ${a.nazev_poradatele}`);
}

const odpoved = await fetch(
  `${adresa}/rest/v1/prihlasky?email=like.*@ukazka.test`,
  { method: "DELETE", headers: hlavicky },
);

if (!odpoved.ok) {
  console.error(`Mazání se nepovedlo: HTTP ${odpoved.status}`);
  process.exit(1);
}

// Kontrola, že po nás nic nezůstalo.
const po = await fetch(
  `${adresa}/rest/v1/prihlasky?select=variabilni_symbol&email=like.*@ukazka.test`,
  { headers: hlavicky },
);
const zbytek = await po.json();

console.log("");
console.log(`Smazáno. Zbývá ukázkových akcí: ${zbytek.length}`);
console.log("Skutečných přihlášek se to nedotklo.");
