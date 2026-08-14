/**
 * Uložené úpravy textů — společná paměť obou způsobů editace.
 *
 * Texty jdou v administraci upravovat dvěma způsoby:
 *   * klepnutím přímo do náhledu webu (nahled.ts),
 *   * v seznamu políček pod sebou (texty.ts).
 *
 * Oba pohledy pracují se stejnými daty, takže je mají tady na jednom místě.
 * Kdyby si každý držel svoje, ukázal by jeden po uložení nové znění a druhý
 * by pořád zobrazoval staré.
 *
 * Ukládá se po jedné položce. Schválně — správce vidí u každé zvlášť,
 * jestli se uložení povedlo, a když vypadne spojení, nepřijde o všechno.
 */
import type { PolozkaObsahu } from "../../lib/obsah";
import { zavolej } from "./klient";

/** Uložené přepisy z databáze: klíč → nové znění. */
let prepisy: Record<string, string> = {};

/** Kdo chce vědět, že se některá položka změnila. */
const posluchaci = new Set<(klic: string) => void>();

// ---------------------------------------------------------------------------
// ČTENÍ
// ---------------------------------------------------------------------------

/** Aktuální znění položky — buď uložený přepis, nebo původní text z HTML. */
export function zneni(polozka: PolozkaObsahu): string {
  const prepis = prepisy[polozka.klic];
  return typeof prepis === "string" && prepis !== "" ? prepis : polozka.vychozi;
}

/** Je položka upravená proti tomu, co je napsané v HTML? */
export function jeUpraveno(klic: string): boolean {
  return typeof prepisy[klic] === "string";
}

/** Všechny přepisy najednou — pro hromadné použití na náhled webu. */
export function vsechnyPrepisy(): Record<string, string> {
  return { ...prepisy };
}

// ---------------------------------------------------------------------------
// OZNAMOVÁNÍ ZMĚN
// ---------------------------------------------------------------------------

/**
 * Přihlásí se k odběru změn.
 *
 * Zavolá se pokaždé, když se některá položka uloží nebo vrátí do původního
 * znění — ať už to správce udělal v náhledu, nebo v seznamu.
 */
export function priZmeneObsahu(posluchac: (klic: string) => void): void {
  posluchaci.add(posluchac);
}

function ohlasZmenu(klic: string): void {
  for (const posluchac of posluchaci) {
    try {
      posluchac(klic);
    } catch (chyba) {
      // Jeden rozbitý posluchač nesmí shodit ukládání ani ten druhý pohled.
      console.error("Posluchač změny obsahu selhal:", chyba);
    }
  }
}

// ---------------------------------------------------------------------------
// NAČTENÍ ZE SERVERU
// ---------------------------------------------------------------------------

/**
 * Stáhne všechny uložené přepisy.
 *
 * @throws ChybaAdministrace s českou větou, kterou lze rovnou zobrazit.
 */
export async function nactiPrepisy(): Promise<void> {
  const vysledek = await zavolej<{ obsah: { klic: string; hodnota: string }[] }>(
    "obsah",
  );

  prepisy = {};
  for (const radek of vysledek.obsah) prepisy[radek.klic] = radek.hodnota;
}

// ---------------------------------------------------------------------------
// UKLÁDÁNÍ
// ---------------------------------------------------------------------------

/**
 * Uloží nové znění položky.
 *
 * Když se nové znění shoduje s původním, řádek se z databáze radši smaže —
 * v tabulce pak nezůstává nic zbytečného a web bere text z HTML.
 *
 * @returns Větu o tom, co se stalo. Zobrazí se správci.
 * @throws  Error s českou větou, když se uložení nepovedlo.
 */
export async function ulozZneni(
  polozka: PolozkaObsahu,
  hodnota: string,
): Promise<string> {
  const nova = hodnota.trim();

  if (nova === "") {
    throw new Error(
      'Pole nesmí zůstat prázdné. Když chcete původní znění, použijte tlačítko „Vrátit původní".',
    );
  }

  if (nova === polozka.vychozi.trim()) {
    await zavolej("zrus-obsah", { klic: polozka.klic });
    delete prepisy[polozka.klic];
    ohlasZmenu(polozka.klic);
    return "Uloženo — text je stejný jako původní, web ho bere z původního znění.";
  }

  await zavolej("uloz-obsah", { klic: polozka.klic, hodnota: nova });
  prepisy[polozka.klic] = nova;
  ohlasZmenu(polozka.klic);

  return "Uloženo. Na webu se text objeví po obnovení stránky.";
}

/**
 * Zruší přepis — web se vrátí k tomu, co je napsané v HTML.
 *
 * @returns Větu o tom, co se stalo.
 * @throws  Error s českou větou, když se to nepovedlo.
 */
export async function vratPuvodniZneni(polozka: PolozkaObsahu): Promise<string> {
  await zavolej("zrus-obsah", { klic: polozka.klic });
  delete prepisy[polozka.klic];
  ohlasZmenu(polozka.klic);

  return "Hotovo. Na webu je zase původní znění.";
}
