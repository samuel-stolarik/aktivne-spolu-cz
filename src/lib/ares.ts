/**
 * Načtení fakturačních údajů z ARESu podle IČ.
 *
 * ------------------------------------------------------------------
 * TOHLE ZATÍM NIC NEDĚLÁ
 * ------------------------------------------------------------------
 * Je to připravené místo pro další fázi. Funkce má hlavičku a popis,
 * ale tělo schválně chybí — kdyby ji někdo omylem zavolal, ať je hned
 * jasné proč nefunguje, místo aby tiše vracela prázdno.
 *
 * ------------------------------------------------------------------
 * K ČEMU TO BUDE
 * ------------------------------------------------------------------
 * V registračním formuláři se při volbě "převod s fakturou" vyplňuje
 * název dle obchodního rejstříku, adresa, IČ a DIČ. Většinu z toho jde
 * dohledat podle IČ, takže uživatel vyplní jen osm číslic a zbytek
 * se doplní sám. Míň překlepů a míň práce.
 *
 * ------------------------------------------------------------------
 * JAK SE TO BUDE VOLAT
 * ------------------------------------------------------------------
 * Veřejné REST rozhraní ARESu, bez klíče a bez registrace:
 *
 *   GET https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/{ico}
 *
 * Odpověď obsahuje mimo jiné `obchodniJmeno`, `ico`, `dic`
 * a `sidlo.textovaAdresa`. Když firma není plátce DPH, pole `dic`
 * v odpovědi vůbec není — to není chyba, jen to znamená neplátce.
 *
 * Ověřeno 12. 8. 2026 na IČ 29154901 (Právě teď! o.p.s.).
 *
 * ------------------------------------------------------------------
 * NA CO SI DÁT POZOR PŘI DOPLNĚNÍ
 * ------------------------------------------------------------------
 * 1. Volat AŽ NA AKCI UŽIVATELE — po vyplnění IČ nebo po stisku tlačítka
 *    "Načíst z rejstříku". Nikdy ne tiše při otevření formuláře.
 *    Uživatel má vědět, že se někam sahá.
 * 2. Načtené údaje musí jít ručně přepsat. ARES občas obsahuje adresu
 *    v jiném tvaru, než jaký chce účetní na faktuře.
 * 3. Když ARES neodpoví nebo IČ nezná, formulář musí jít normálně
 *    vyplnit ručně. Výpadek rejstříku nesmí zablokovat registraci.
 * 4. Selhání se musí ukázat slovně. Ne věčné kolečko, ne prázdná pole
 *    bez vysvětlení.
 * 5. Volat ze serveru (Edge Funkce), ne z prohlížeče — ARES nemusí mít
 *    nastavené CORS hlavičky pro cizí domény.
 */

/** Fakturační údaje tak, jak je potřebuje formulář. */
export interface FakturacniUdaje {
  /** Název dle obchodního rejstříku */
  nazev: string;
  /** Sídlo v jednom řádku, např. "Fügnerovo náměstí 1808/3, 120 00 Praha 2" */
  adresa: string;
  /** Osm číslic */
  ico: string;
  /** Chybí, pokud subjekt není plátce DPH */
  dic?: string;
}

/**
 * Dohledá fakturační údaje podle IČ.
 *
 * @param ico Osm číslic bez mezer.
 * @returns Nalezené údaje, nebo `null` když ARES subjekt nezná.
 * @throws Když se nepodaří spojit s ARESem — volající to musí ukázat
 *         uživateli slovně a nechat ho vyplnit údaje ručně.
 */
export async function nactiUdajeZAresu(
  ico: string,
): Promise<FakturacniUdaje | null> {
  throw new Error(
    `Načítání z ARESu zatím není hotové (požadované IČ: ${ico}). ` +
      "Vyplňte prosím fakturační údaje ručně.",
  );
}
