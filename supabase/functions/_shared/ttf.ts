// Čtení TrueType písma pro vložení do PDF.
//
// Do PDF se nedá vložit písmo jen tak — dokument musí vědět, jaké číslo má
// v souboru každý glyf a jak je který široký. Tenhle soubor to z písma
// vytáhne. Čte se jen to nutné, ne celý formát:
//
//   head  rozměr čtverce písma (unitsPerEm) a obálka všech glyfů
//   hhea  kolik glyfů má vlastní šířku, účaří nahoře a dole
//   hmtx  šířky jednotlivých glyfů
//   cmap  převod znaku na číslo glyfu
//   maxp  kolik glyfů písmo má
//
// PROČ SE TO PÍŠE RUČNĚ
// Stejný důvod jako u QR kódu a u faktury vedle: hotové knihovny na písma
// jsou ze světa Node.js a v Denu bývají zdrojem potíží při každé aktualizaci.
// Tady jde o pět tabulek a pár set bajtů čtení.
//
// POZOR NA cmap
// Bere se podformát 4, tedy ten pro znaky do U+FFFF. Čeština se do něj vejde
// celá. Kdyby se do písma někdy dostaly znaky nad tuhle hranici (emoji),
// nenajdou se — a faktura je vykreslí jako prázdné místo, ne jako cizí tvar.

export interface NactenePismo {
  /** Původní data písma, jdou rovnou do PDF. */
  data: Uint8Array;
  /** Znak (jeho kód) → číslo glyfu v tomhle písmu. */
  glyfy: Map<number, number>;
  /** Číslo glyfu → šířka přepočtená na tisícinu čtverce písma. */
  sirky: Map<number, number>;
  /** Šířky zapsané tak, jak je čeká PDF. */
  sirkyProPdf: string;
  bbox: [number, number, number, number];
  ascent: number;
  descent: number;
}

class Ctecka {
  private pohled: DataView;

  constructor(private data: Uint8Array) {
    this.pohled = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  u8(kde: number): number {
    return this.pohled.getUint8(kde);
  }
  u16(kde: number): number {
    return this.pohled.getUint16(kde);
  }
  i16(kde: number): number {
    return this.pohled.getInt16(kde);
  }
  u32(kde: number): number {
    return this.pohled.getUint32(kde);
  }
  znacka(kde: number): string {
    return String.fromCharCode(
      this.u8(kde),
      this.u8(kde + 1),
      this.u8(kde + 2),
      this.u8(kde + 3),
    );
  }
}

/** Najde v písmu tabulky a vrátí, kde která začíná. */
function najdiTabulky(c: Ctecka): Map<string, number> {
  const pocet = c.u16(4);
  const tabulky = new Map<string, number>();
  for (let i = 0; i < pocet; i++) {
    const zaznam = 12 + i * 16;
    tabulky.set(c.znacka(zaznam), c.u32(zaznam + 8));
  }
  return tabulky;
}

/**
 * Převod znaků na čísla glyfů z podformátu 4.
 *
 * Formát je z devadesátek a je na to znát: znaky jsou v něm poskládané do
 * rozsahů a u každého se buď přičte posun, nebo se skočí do zvláštního pole.
 * Obě větve musí být, protože písma běžně používají obojí.
 */
function nactiCmap(c: Ctecka, zacatek: number): Map<number, number> {
  const glyfy = new Map<number, number>();
  const pocetPodtabulek = c.u16(zacatek + 2);

  // Hledá se tabulka pro Unicode. Windows/Unicode BMP (3,1) je nejběžnější,
  // Unicode (0,x) je záloha pro písma, která ji nemají.
  let kde = 0;
  for (let i = 0; i < pocetPodtabulek; i++) {
    const zaznam = zacatek + 4 + i * 8;
    const platforma = c.u16(zaznam);
    const kodovani = c.u16(zaznam + 2);
    const posun = c.u32(zaznam + 4);
    if (platforma === 3 && kodovani === 1) kde = zacatek + posun;
    else if (platforma === 0 && kde === 0) kde = zacatek + posun;
  }
  if (kde === 0 || c.u16(kde) !== 4) return glyfy;

  const dvojnasobekRozsahu = c.u16(kde + 6);
  const rozsahu = dvojnasobekRozsahu / 2;

  const konceOd = kde + 14;
  const zacatkyOd = konceOd + dvojnasobekRozsahu + 2;
  const posunyOd = zacatkyOd + dvojnasobekRozsahu;
  const odkazyOd = posunyOd + dvojnasobekRozsahu;

  for (let i = 0; i < rozsahu; i++) {
    const konec = c.u16(konceOd + i * 2);
    const zacatekZnaku = c.u16(zacatkyOd + i * 2);
    const posun = c.i16(posunyOd + i * 2);
    const odkaz = c.u16(odkazyOd + i * 2);

    if (zacatekZnaku > konec) continue;

    for (let znak = zacatekZnaku; znak <= konec && znak !== 0xffff; znak++) {
      let glyf: number;
      if (odkaz === 0) {
        glyf = (znak + posun) & 0xffff;
      } else {
        // Odkaz se počítá od místa, kde to číslo v souboru leží — proto
        // se k němu přičítá i pozice samotné položky.
        const kdeGlyf = odkazyOd + i * 2 + odkaz + (znak - zacatekZnaku) * 2;
        glyf = c.u16(kdeGlyf);
        if (glyf !== 0) glyf = (glyf + posun) & 0xffff;
      }
      if (glyf !== 0) glyfy.set(znak, glyf);
    }
  }

  return glyfy;
}

/** Přečte z písma všechno, co PDF potřebuje. */
export function ttfDoPdf(data: Uint8Array): NactenePismo {
  const c = new Ctecka(data);
  const tabulky = najdiTabulky(c);

  const head = tabulky.get('head')!;
  const hhea = tabulky.get('hhea')!;
  const hmtx = tabulky.get('hmtx')!;
  const maxp = tabulky.get('maxp')!;
  const cmap = tabulky.get('cmap')!;

  const naCtverec = c.u16(head + 18); // unitsPerEm
  const naTisicinu = (hodnota: number) => Math.round((hodnota * 1000) / naCtverec);

  const pocetGlyfu = c.u16(maxp + 4);
  const pocetSVlastniSirkou = c.u16(hhea + 34);

  // Glyfy za koncem tabulky šířek mají všechny šířku toho posledního.
  const sirky = new Map<number, number>();
  let posledni = 0;
  for (let g = 0; g < pocetGlyfu; g++) {
    if (g < pocetSVlastniSirkou) posledni = c.u16(hmtx + g * 4);
    sirky.set(g, naTisicinu(posledni));
  }

  const glyfy = nactiCmap(c, cmap);

  const sirkyProPdf =
    `[0 [${Array.from({ length: pocetGlyfu }, (_, g) => sirky.get(g) ?? 0).join(' ')}]]`;

  return {
    data,
    glyfy,
    sirky,
    sirkyProPdf,
    bbox: [
      naTisicinu(c.i16(head + 36)),
      naTisicinu(c.i16(head + 38)),
      naTisicinu(c.i16(head + 40)),
      naTisicinu(c.i16(head + 42)),
    ],
    ascent: naTisicinu(c.i16(hhea + 4)),
    descent: naTisicinu(c.i16(hhea + 6)),
  };
}

/** Jak široký bude text v bodech při dané velikosti písma. */
export function zmerText(text: string, pismo: NactenePismo, velikost: number): number {
  let sirka = 0;
  for (const znak of text) {
    const glyf = pismo.glyfy.get(znak.codePointAt(0)!);
    if (glyf === undefined) continue;
    sirka += pismo.sirky.get(glyf) ?? 0;
  }
  return (sirka * velikost) / 1000;
}
