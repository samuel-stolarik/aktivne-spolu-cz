// Sestavení faktury do PDF.
//
// PROČ TO DĚLÁ SUPABASE A NE MAKE
// Dřív se faktura skládala v Make přes šablonu v Google Docs: vyplnit
// dokument, vyexportovat PDF, uklidit dočasný soubor. Byla to jediná věc,
// kvůli které celý ten scénář potřeboval připojení ke Googlu, šablonu na
// cizím Disku a tři moduly navíc — a Make sám PDF neumí, takže jiná cesta
// v něm nebyla. Data přitom celou dobu leží tady. Tímhle souborem ta
// odbočka mizí.
//
// NEPLÁTCE DPH — TVRDÁ PRAVIDLA, KTERÁ SE NESMÍ PORUŠIT
// Právě teď! o.p.s. není plátcem DPH (potvrzeno v ARESu). Z toho plyne:
//   - žádný rozpis daně: ani sazba, ani základ, ani řádek DPH,
//   - doklad se jmenuje FAKTURA, nikdy „daňový doklad" — ten neplátce
//     vystavovat nesmí,
//   - na faktuře NENÍ pole „DIČ dodavatele". Ani prázdné, ani s pomlčkou.
//     To pole na ni nepatří.
//   - je tam věta o neplátcovství a částka je konečná.
// DIČ odběratele se opíše, když ho vyplnil, ale nic se z něj nepočítá.
//
// PROČ SE PDF SKLÁDÁ RUČNĚ
// Stejný důvod jako u QR kódu vedle: knihovny na PDF ze světa Node.js bývají
// v Denu zdrojem potíží při každé aktualizaci. Faktura je jedna stránka
// s textem a pár čarami — to je pár set řádků a nic se na tom nemůže
// rozbít samo od sebe.

import { PISMO_TUCNE, PISMO_ZAKLADNI } from './pismo-faktury.ts';
import { zmerText, ttfDoPdf, type NactenePismo } from './ttf.ts';

export interface UdajeFaktury {
  cisloFaktury: string;
  variabilniSymbol: number;
  datumVystaveni: string;
  datumSplatnosti: string;
  castkaKc: number;

  dodavatelNazev: string;
  dodavatelAdresa: string;
  dodavatelMesto: string;
  dodavatelIc: string;
  dodavatelEmail: string;
  dodavatelWeb: string;

  odberatelNazev: string;
  odberatelAdresa: string;
  odberatelIc: string | null;
  odberatelDic: string | null;

  cisloUctu: string;
  iban: string | null;
  swift: string | null;
  zpravaProPrijemce: string;

  polozkaNazev: string;
  vetaNeplatceDph: string;
}

// --- Rozvržení stránky (A4 v bodech, 1 bod = 1/72 palce) --------------------

const SIRKA = 595.28;
const VYSKA = 841.89;
const OKRAJ = 56;

const INKOUST = { r: 0.14, g: 0.15, b: 0.15 };
const TYRKYS = { r: 0.07, g: 0.44, b: 0.5 };
const SEDA = { r: 0.45, g: 0.45, b: 0.43 };
const LINKA = { r: 0.85, g: 0.83, b: 0.79 };

interface Barva {
  r: number;
  g: number;
  b: number;
}

/**
 * Skládá obsah stránky. Souřadnice se v PDF počítají zdola nahoru, což se
 * při psaní faktury shora dolů plete — proto si třída drží `y` odshora
 * a přepočítává ho až při zápisu.
 */
class Stranka {
  private prikazy: string[] = [];
  y = OKRAJ;

  constructor(
    private zakladni: NactenePismo,
    private tucne: NactenePismo,
  ) {}

  private prevedText(text: string, pismo: NactenePismo): string {
    // Identity-H: každý znak se zapisuje jako dvoubajtové číslo glyfu.
    //
    // Znak, který v oříznutém písmu není, se vynechá — vykreslit místo něj
    // jiný glyf by znamenalo, že na faktuře stojí něco jiného, než co jsme
    // napsali. Zároveň se to ale MUSÍ ohlásit: chybějící písmeno je tichá
    // chyba, kterou nikdo nenajde, dokud si někdo neporovná fakturu
    // s adresou. Přesně tak vzniklo „Fgnerovo náměstí" místo „Fügnerovo".
    let ven = '';
    for (const znak of text) {
      const glyf = pismo.glyfy.get(znak.codePointAt(0)!);
      if (glyf === undefined) {
        console.error(
          `Faktura: znak "${znak}" (U+${znak.codePointAt(0)!.toString(16).toUpperCase()}) ` +
            'není ve vloženém písmu a na faktuře bude chybět. ' +
            'Je potřeba rozšířit výběr znaků v pismo-faktury.ts.',
        );
        continue;
      }
      ven += glyf.toString(16).padStart(4, '0');
    }
    return ven;
  }

  text(
    text: string,
    x: number,
    velikost: number,
    volby: { tucne?: boolean; barva?: Barva; vpravo?: number } = {},
  ) {
    const pismo = volby.tucne ? this.tucne : this.zakladni;
    const barva = volby.barva ?? INKOUST;

    let poziceX = x;
    if (volby.vpravo !== undefined) {
      poziceX = volby.vpravo - zmerText(text, pismo, velikost);
    }

    this.prikazy.push(
      'BT',
      `${barva.r} ${barva.g} ${barva.b} rg`,
      `/${volby.tucne ? 'F2' : 'F1'} ${velikost} Tf`,
      `1 0 0 1 ${poziceX.toFixed(2)} ${(VYSKA - this.y).toFixed(2)} Tm`,
      `<${this.prevedText(text, pismo)}> Tj`,
      'ET',
    );
  }

  cara(odX: number, doX: number, barva: Barva = LINKA, tloustka = 0.7) {
    this.prikazy.push(
      `${barva.r} ${barva.g} ${barva.b} RG`,
      `${tloustka} w`,
      `${odX.toFixed(2)} ${(VYSKA - this.y).toFixed(2)} m`,
      `${doX.toFixed(2)} ${(VYSKA - this.y).toFixed(2)} l`,
      'S',
    );
  }

  obdelnik(x: number, sirka: number, vyska: number, barva: Barva) {
    this.prikazy.push(
      `${barva.r} ${barva.g} ${barva.b} rg`,
      `${x.toFixed(2)} ${(VYSKA - this.y - vyska).toFixed(2)} ${sirka.toFixed(2)} ${vyska.toFixed(2)} re`,
      'f',
    );
  }

  dolu(o: number) {
    this.y += o;
  }

  hotovo(): string {
    return this.prikazy.join('\n');
  }
}

/** Částka v korunách česky: 1 500 Kč, s pevnou mezerou v tisících. */
function castkaCesky(castka: number): string {
  return `${castka.toLocaleString('cs-CZ').replace(/ /g, ' ')} Kč`;
}

/**
 * Sestaví jednostránkovou fakturu a vrátí ji jako PDF.
 */
export function vytvorFakturuPdf(u: UdajeFaktury): Uint8Array {
  const zakladni = ttfDoPdf(PISMO_ZAKLADNI);
  const tucne = ttfDoPdf(PISMO_TUCNE);
  const s = new Stranka(zakladni, tucne);

  const praveOkraj = SIRKA - OKRAJ;

  // --- Hlavička -----------------------------------------------------------
  s.y = 70;
  s.text('FAKTURA', OKRAJ, 26, { tucne: true, barva: TYRKYS });
  s.text(u.cisloFaktury, praveOkraj, 16, { tucne: true, vpravo: praveOkraj });
  s.dolu(10);
  s.text(
    'Doklad není daňovým dokladem — vystavovatel není plátcem DPH.',
    OKRAJ,
    8.5,
    { barva: SEDA },
  );

  s.dolu(18);
  s.cara(OKRAJ, praveOkraj);

  // --- Dodavatel a odběratel ---------------------------------------------
  s.dolu(28);
  const sloupecB = OKRAJ + 260;
  const zacatekStran = s.y;

  s.text('DODAVATEL', OKRAJ, 8.5, { tucne: true, barva: TYRKYS });
  s.text('ODBĚRATEL', sloupecB, 8.5, { tucne: true, barva: TYRKYS });

  s.dolu(16);
  s.text(u.dodavatelNazev, OKRAJ, 11.5, { tucne: true });
  s.text(u.odberatelNazev, sloupecB, 11.5, { tucne: true });

  s.dolu(15);
  s.text(u.dodavatelAdresa, OKRAJ, 9.5);
  s.text(u.odberatelAdresa, sloupecB, 9.5);

  s.dolu(13);
  s.text(u.dodavatelMesto, OKRAJ, 9.5);

  s.dolu(15);
  // Pole „DIČ dodavatele" tu schválně NENÍ — organizace žádné nemá.
  s.text(`IČO: ${u.dodavatelIc}`, OKRAJ, 9.5);
  if (u.odberatelIc) s.text(`IČO: ${u.odberatelIc}`, sloupecB, 9.5);

  s.dolu(13);
  s.text(u.dodavatelEmail, OKRAJ, 9.5, { barva: SEDA });
  if (u.odberatelDic) s.text(`DIČ: ${u.odberatelDic}`, sloupecB, 9.5);

  s.dolu(13);
  s.text(u.dodavatelWeb, OKRAJ, 9.5, { barva: SEDA });

  // --- Datumy a platba ----------------------------------------------------
  s.y = zacatekStran + 110;
  s.cara(OKRAJ, praveOkraj);
  s.dolu(24);

  const radekUdaju: [string, string][] = [
    ['Datum vystavení', u.datumVystaveni],
    ['Datum splatnosti', u.datumSplatnosti],
    ['Variabilní symbol', String(u.variabilniSymbol)],
    ['Číslo účtu', u.cisloUctu],
  ];

  for (const [popisek, hodnota] of radekUdaju) {
    s.text(popisek, OKRAJ, 9.5, { barva: SEDA });
    s.text(hodnota, OKRAJ + 140, 10, { tucne: true });
    s.dolu(17);
  }

  s.text('Zpráva pro příjemce', OKRAJ, 9.5, { barva: SEDA });
  s.text(`${u.zpravaProPrijemce} ${u.variabilniSymbol}`, OKRAJ + 140, 10, {
    tucne: true,
  });

  if (u.iban) {
    s.dolu(17);
    s.text('IBAN', OKRAJ, 9.5, { barva: SEDA });
    s.text(u.iban + (u.swift ? `   SWIFT: ${u.swift}` : ''), OKRAJ + 140, 10);
  }

  // --- Položka ------------------------------------------------------------
  s.dolu(34);
  s.obdelnik(OKRAJ, praveOkraj - OKRAJ, 26, { r: 0.93, g: 0.97, b: 0.98 });
  s.dolu(17);
  s.text('POLOŽKA', OKRAJ + 12, 8.5, { tucne: true, barva: TYRKYS });
  s.text('ČÁSTKA', praveOkraj - 12, 8.5, {
    tucne: true,
    barva: TYRKYS,
    vpravo: praveOkraj - 12,
  });

  s.dolu(26);
  s.text(u.polozkaNazev, OKRAJ + 12, 10.5);
  s.text(castkaCesky(u.castkaKc), praveOkraj - 12, 10.5, {
    vpravo: praveOkraj - 12,
  });

  s.dolu(14);
  s.cara(OKRAJ, praveOkraj);

  // --- Celkem -------------------------------------------------------------
  s.dolu(26);
  s.text('CELKEM K ÚHRADĚ', OKRAJ + 12, 11, { tucne: true });
  s.text(castkaCesky(u.castkaKc), praveOkraj - 12, 17, {
    tucne: true,
    barva: TYRKYS,
    vpravo: praveOkraj - 12,
  });

  s.dolu(14);
  s.cara(OKRAJ, praveOkraj, INKOUST, 1.2);

  // --- Věta o neplátcovství ----------------------------------------------
  s.dolu(30);
  for (const radek of zalamText(u.vetaNeplatceDph, zakladni, 9.5, praveOkraj - OKRAJ)) {
    s.text(radek, OKRAJ, 9.5, { barva: SEDA });
    s.dolu(13);
  }

  // --- Patička ------------------------------------------------------------
  s.y = VYSKA - 60;
  s.cara(OKRAJ, praveOkraj);
  s.dolu(16);
  s.text(
    `${u.dodavatelNazev} — ${u.dodavatelWeb} — ${u.dodavatelEmail}`,
    SIRKA / 2,
    8.5,
    { barva: SEDA, vpravo: SIRKA / 2 + zmerText(
      `${u.dodavatelNazev} — ${u.dodavatelWeb} — ${u.dodavatelEmail}`,
      zakladni,
      8.5,
    ) / 2 },
  );

  return slozPdf(s.hotovo(), zakladni, tucne);
}

/** Rozláme dlouhý text na řádky, které se vejdou do dané šířky. */
function zalamText(
  text: string,
  pismo: NactenePismo,
  velikost: number,
  sirka: number,
): string[] {
  const slova = text.split(' ');
  const radky: string[] = [];
  let radek = '';

  for (const slovo of slova) {
    const zkouska = radek ? `${radek} ${slovo}` : slovo;
    if (zmerText(zkouska, pismo, velikost) > sirka && radek) {
      radky.push(radek);
      radek = slovo;
    } else {
      radek = zkouska;
    }
  }
  if (radek) radky.push(radek);
  return radky;
}

// --- Poskládání souboru PDF -------------------------------------------------

function bajty(text: string): Uint8Array {
  const ven = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) ven[i] = text.charCodeAt(i) & 0xff;
  return ven;
}

/**
 * Poskládá hotový soubor PDF.
 *
 * Struktura je nejjednodušší možná: jedna stránka, dvě vložená písma
 * v kódování Identity-H (dvoubajtová čísla glyfů — jediné, kterým se dají
 * do PDF dostat háčky) a tabulka odkazů na konci.
 */
function slozPdf(
  obsah: string,
  zakladni: NactenePismo,
  tucne: NactenePismo,
): Uint8Array {
  const objekty: Uint8Array[] = [];

  const pridej = (data: string | Uint8Array) => {
    objekty.push(typeof data === 'string' ? bajty(data) : data);
    return objekty.length; // čísla objektů začínají jedničkou
  };

  const idKatalog = pridej('<< /Type /Catalog /Pages 2 0 R >>');
  const idStrany = pridej('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  pridej(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${SIRKA} ${VYSKA}] ` +
      `/Resources << /Font << /F1 5 0 R /F2 8 0 R >> >> /Contents 4 0 R >>`,
  );
  pridej(`<< /Length ${obsah.length} >>\nstream\n${obsah}\nendstream`);

  // Základní řez: objekty 5–7
  pridej(
    '<< /Type /Font /Subtype /Type0 /BaseFont /SourceSans3 ' +
      '/Encoding /Identity-H /DescendantFonts [6 0 R] >>',
  );
  pridej(
    '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /SourceSans3 ' +
      '/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> ' +
      `/FontDescriptor 7 0 R /DW 1000 /W ${zakladni.sirkyProPdf} /CIDToGIDMap /Identity >>`,
  );
  pridej(
    '<< /Type /FontDescriptor /FontName /SourceSans3 /Flags 32 ' +
      `/FontBBox [${zakladni.bbox.join(' ')}] /ItalicAngle 0 /Ascent ${zakladni.ascent} ` +
      `/Descent ${zakladni.descent} /CapHeight ${zakladni.ascent} /StemV 80 /FontFile2 9 0 R >>`,
  );

  // Tučný řez: objekty 8, 10, 11
  pridej(
    '<< /Type /Font /Subtype /Type0 /BaseFont /SourceSans3-SemiBold ' +
      '/Encoding /Identity-H /DescendantFonts [10 0 R] >>',
  );
  pridej(
    bajty(`<< /Length ${zakladni.data.length} /Length1 ${zakladni.data.length} >>\nstream\n`),
  );
  // Data písma se lepí zvlášť, protože nejsou text.
  objekty[objekty.length - 1] = spoj([
    objekty[objekty.length - 1],
    zakladni.data,
    bajty('\nendstream'),
  ]);

  pridej(
    '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /SourceSans3-SemiBold ' +
      '/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> ' +
      `/FontDescriptor 11 0 R /DW 1000 /W ${tucne.sirkyProPdf} /CIDToGIDMap /Identity >>`,
  );
  pridej(
    '<< /Type /FontDescriptor /FontName /SourceSans3-SemiBold /Flags 32 ' +
      `/FontBBox [${tucne.bbox.join(' ')}] /ItalicAngle 0 /Ascent ${tucne.ascent} ` +
      `/Descent ${tucne.descent} /CapHeight ${tucne.ascent} /StemV 120 /FontFile2 12 0 R >>`,
  );
  pridej(bajty(`<< /Length ${tucne.data.length} /Length1 ${tucne.data.length} >>\nstream\n`));
  objekty[objekty.length - 1] = spoj([
    objekty[objekty.length - 1],
    tucne.data,
    bajty('\nendstream'),
  ]);

  // Sestavení souboru s tabulkou odkazů (xref).
  const casti: Uint8Array[] = [bajty('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')];
  let pozice = casti[0].length;
  const pozice_objektu: number[] = [];

  objekty.forEach((telo, i) => {
    pozice_objektu.push(pozice);
    const zacatek = bajty(`${i + 1} 0 obj\n`);
    const konec = bajty('\nendobj\n');
    casti.push(zacatek, telo, konec);
    pozice += zacatek.length + telo.length + konec.length;
  });

  let xref = `xref\n0 ${objekty.length + 1}\n0000000000 65535 f \n`;
  for (const p of pozice_objektu) {
    xref += `${String(p).padStart(10, '0')} 00000 n \n`;
  }
  xref +=
    `trailer\n<< /Size ${objekty.length + 1} /Root ${idKatalog} 0 R >>\n` +
    `startxref\n${pozice}\n%%EOF\n`;

  casti.push(bajty(xref));
  void idStrany;
  return spoj(casti);
}

function spoj(casti: Uint8Array[]): Uint8Array {
  const delka = casti.reduce((s, c) => s + c.length, 0);
  const ven = new Uint8Array(delka);
  let kam = 0;
  for (const c of casti) {
    ven.set(c, kam);
    kam += c.length;
  }
  return ven;
}
