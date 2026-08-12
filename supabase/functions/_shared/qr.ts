// Vygenerování obrázku QR kódu (PNG) z textu.
//
// Proč se PNG skládá ručně a ne knihovnou: hotové generátory QR obrázků
// potřebují buď prohlížeč (canvas), nebo balíčky ze světa Node.js. Na serveru
// Supabase běží Deno, kde tohle bývá zdroj potíží při každé aktualizaci.
// Mřížku QR spočítá malá knihovna bez jakýchkoli závislostí a obrázek z ní
// se pak poskládá tady — je to pár desítek řádků a nic se nemůže rozbít.
//
// PNG je schválně úplně černobílé — jeden bit na bod. Komprese se nepoužívá,
// protože i tak vyjde obrázek na pár desítek kilobajtů.

import qrcode from 'npm:qrcode-generator@1.4.4';

// --- PNG: pomocné výpočty ---------------------------------------------------

/** Tabulka pro kontrolní součet CRC-32, který PNG vyžaduje u každého bloku. */
const CRC_TABULKA = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABULKA[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Kontrolní součet, kterým se uzavírá zlib proud uvnitř PNG. */
function adler32(data: Uint8Array): number {
  let a = 1, b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function u32(hodnota: number): Uint8Array {
  return new Uint8Array([
    (hodnota >>> 24) & 0xff,
    (hodnota >>> 16) & 0xff,
    (hodnota >>> 8) & 0xff,
    hodnota & 0xff,
  ]);
}

function spoj(casti: Uint8Array[]): Uint8Array {
  const delka = casti.reduce((s, c) => s + c.length, 0);
  const vysledek = new Uint8Array(delka);
  let pozice = 0;
  for (const c of casti) {
    vysledek.set(c, pozice);
    pozice += c.length;
  }
  return vysledek;
}

/** Jeden blok PNG: délka, název, data, kontrolní součet. */
function blok(nazev: string, data: Uint8Array): Uint8Array {
  const jmeno = new TextEncoder().encode(nazev);
  const telo = spoj([jmeno, data]);
  return spoj([u32(data.length), telo, u32(crc32(telo))]);
}

/**
 * Zabalí data do zlib proudu bez komprese („uložené" bloky).
 * Formát to povoluje a ušetří to celou kompresní knihovnu.
 */
function zlibBezKomprese(data: Uint8Array): Uint8Array {
  const casti: Uint8Array[] = [new Uint8Array([0x78, 0x01])];
  const MAX = 65535;
  for (let i = 0; i < data.length || i === 0; i += MAX) {
    const kus = data.subarray(i, Math.min(i + MAX, data.length));
    const posledni = i + MAX >= data.length ? 1 : 0;
    casti.push(new Uint8Array([
      posledni,
      kus.length & 0xff,
      (kus.length >>> 8) & 0xff,
      ~kus.length & 0xff,
      (~kus.length >>> 8) & 0xff,
    ]));
    casti.push(kus);
  }
  casti.push(u32(adler32(data)));
  return spoj(casti);
}

/**
 * Poskládá PNG z černobílé mřížky bodů.
 * @param body Jeden bajt na bod: 0 = černá, 1 = bílá. Do souboru se zabalí
 *             po osmi bodech do jednoho bajtu.
 */
function sestavPng(sirka: number, vyska: number, body: Uint8Array): Uint8Array {
  const bajtuNaRadek = Math.ceil(sirka / 8);

  // Každý řádek začíná bajtem „typ filtru" — 0 znamená žádný filtr.
  const surova = new Uint8Array(vyska * (bajtuNaRadek + 1));
  for (let r = 0; r < vyska; r++) {
    const zacatek = r * (bajtuNaRadek + 1);
    surova[zacatek] = 0;
    for (let s = 0; s < sirka; s++) {
      if (body[r * sirka + s]) {
        surova[zacatek + 1 + (s >> 3)] |= 0x80 >> (s & 7);
      }
    }
  }

  const hlavicka = spoj([
    u32(sirka),
    u32(vyska),
    new Uint8Array([1, 0, 0, 0, 0]), // 1 bit na bod, černobílé, bez prokládání
  ]);

  return spoj([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // podpis PNG
    blok('IHDR', hlavicka),
    blok('IDAT', zlibBezKomprese(surova)),
    blok('IEND', new Uint8Array(0)),
  ]);
}

// --- QR ---------------------------------------------------------------------

export interface NastaveniQr {
  /** Kolik bodů obrázku připadá na jeden čtvereček QR kódu. */
  velikostCtverecku?: number;
  /** Bílý okraj kolem kódu v počtu čtverečků. Norma doporučuje aspoň 4. */
  okraj?: number;
}

/**
 * Vygeneruje PNG s QR kódem.
 *
 * @param text Co má QR kód obsahovat (u nás platební řetězec SPAYD).
 * @returns Data PNG souboru.
 */
export function vytvorQrPng(text: string, nastaveni: NastaveniQr = {}): Uint8Array {
  const velikost = nastaveni.velikostCtverecku ?? 8;
  const okraj = nastaveni.okraj ?? 4;

  // 0 = velikost kódu se zvolí sama podle délky textu.
  // 'M' = střední úroveň zabezpečení proti poškození; u platebních QR běžná.
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();

  const pocet = qr.getModuleCount();
  const stranaVCtverecich = pocet + okraj * 2;
  const strana = stranaVCtverecich * velikost;

  // Začneme celý obrázek bílý (1), černé čtverečky (0) domalujeme.
  const body = new Uint8Array(strana * strana).fill(1);

  for (let radek = 0; radek < pocet; radek++) {
    for (let sloupec = 0; sloupec < pocet; sloupec++) {
      if (!qr.isDark(radek, sloupec)) continue;
      const y0 = (radek + okraj) * velikost;
      const x0 = (sloupec + okraj) * velikost;
      for (let y = y0; y < y0 + velikost; y++) {
        body.fill(0, y * strana + x0, y * strana + x0 + velikost);
      }
    }
  }

  return sestavPng(strana, strana, body);
}
