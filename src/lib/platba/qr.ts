/**
 * Vytvoření QR kódu z SPAYD řetězce.
 *
 * ------------------------------------------------------------------
 * DŮLEŽITÉ: kde co funguje
 * ------------------------------------------------------------------
 * Knihovna `qrcode` umí obrázek vyrobit dvěma způsoby a každý potřebuje
 * něco jiného z okolí:
 *
 *   1) SVG  (`vytvorQrSvg`, `vytvorQrDataUrl`)
 *      Je to jenom text s obdélníčky. Nepotřebuje nic navíc.
 *      Funguje v prohlížeči, v Node.js i v Deno (Supabase Edge Function).
 *      => TOHLE POUŽÍVEJ, pokud si nejsi jistý.
 *
 *   2) PNG  (`vytvorQrPngDataUrl`)
 *      Potřebuje buď <canvas> z prohlížeče, nebo Node.js knihovnu na PNG.
 *      V Deno prostředí Edge Function se na to nedá spolehnout.
 *      => Používej jen v prohlížeči, a když selže, spadni zpátky na SVG.
 *
 * Import knihovny řešíme dynamicky (`await import`), aby se do stránky
 * nenačítala, dokud QR kód někdo opravdu nechce. V Deno je potřeba psát
 * `npm:qrcode` — proto se import dá přebít parametrem `nactiKnihovnu`,
 * viz `MoznostiQr`.
 *
 * Příklad použití (prohlížeč i Edge Function):
 *   import { sestavSpayd } from "./spayd";
 *   import { vytvorQrDataUrl } from "./qr";
 *
 *   const spayd = sestavSpayd({ iban, castka: 500, vs: "26030001" });
 *   const obrazek = await vytvorQrDataUrl(spayd);
 *   // <img src={obrazek} alt="QR platba" />
 *
 * Příklad v Deno (Supabase Edge Function):
 *   import QRCode from "npm:qrcode@1.5.4";
 *   const obrazek = await vytvorQrDataUrl(spayd, { nactiKnihovnu: async () => QRCode });
 */

/** To málo z knihovny `qrcode`, co skutečně používáme. */
interface KnihovnaQr {
  toString: (text: string, options: Record<string, unknown>) => Promise<string>;
  toDataURL?: (text: string, options: Record<string, unknown>) => Promise<string>;
}

export interface MoznostiQr {
  /**
   * Velikost okraje kolem kódu, v "čtverečcích". Standard doporučuje 4,
   * my dáváme 2 — na faktuře je místa málo a čtečkám to stačí.
   */
  okraj?: number;
  /** Šířka výsledného obrázku v pixelech (jen pro PNG). */
  sirka?: number;
  /**
   * Vlastní načtení knihovny. V Deno sem předej `async () => (await import("npm:qrcode")).default`.
   * Když nic nepředáš, zkusí se běžný `import("qrcode")`.
   */
  nactiKnihovnu?: () => Promise<unknown>;
}

/** Načte knihovnu `qrcode` a poradí si s tím, jestli přijde jako `default` nebo přímo. */
async function nacti(moznosti?: MoznostiQr): Promise<KnihovnaQr> {
  const modul = moznosti?.nactiKnihovnu
    ? await moznosti.nactiKnihovnu()
    : await import("qrcode");
  const knihovna = (modul as { default?: unknown }).default ?? modul;
  if (!knihovna || typeof (knihovna as KnihovnaQr).toString !== "function") {
    throw new Error("Knihovnu qrcode se nepodařilo načíst.");
  }
  return knihovna as KnihovnaQr;
}

/**
 * Vytvoří QR kód jako SVG (obyčejný text začínající `<svg`).
 * Funguje všude — v prohlížeči, v Node.js i v Deno.
 */
export async function vytvorQrSvg(spayd: string, moznosti?: MoznostiQr): Promise<string> {
  if (!spayd || !spayd.startsWith("SPD*")) {
    throw new Error("QR kód se dá vytvořit jen z platného SPAYD řetězce.");
  }
  const knihovna = await nacti(moznosti);
  return knihovna.toString(spayd, {
    type: "svg",
    // Úroveň "M" opraví poškození zhruba 15 % kódu. Vyšší úroveň by kód
    // zbytečně zahustila, nižší by nepřežila tisk a naskenování z papíru.
    errorCorrectionLevel: "M",
    margin: moznosti?.okraj ?? 2,
    color: { dark: "#000000", light: "#FFFFFF" },
  });
}

/**
 * Vytvoří QR kód jako `data:` URL, kterou jde rovnou dát do `<img src="…">`.
 * Uvnitř je SVG, takže to funguje i v Deno.
 */
export async function vytvorQrDataUrl(spayd: string, moznosti?: MoznostiQr): Promise<string> {
  const svg = await vytvorQrSvg(spayd, moznosti);
  return `data:image/svg+xml;base64,${doBase64(svg)}`;
}

/**
 * Vytvoří QR kód jako PNG `data:` URL.
 *
 * POZOR: v prohlížeči tohle jede přes <canvas>, v Node.js přes knihovnu na
 * PNG. V Deno (Edge Function) na to nespoléhej — použij `vytvorQrDataUrl`.
 * Když PNG nejde vyrobit, vyhodí se chyba s vysvětlením.
 */
export async function vytvorQrPngDataUrl(spayd: string, moznosti?: MoznostiQr): Promise<string> {
  if (!spayd || !spayd.startsWith("SPD*")) {
    throw new Error("QR kód se dá vytvořit jen z platného SPAYD řetězce.");
  }
  const knihovna = await nacti(moznosti);
  if (typeof knihovna.toDataURL !== "function") {
    throw new Error("V tomhle prostředí neumí qrcode vyrobit PNG. Použij vytvorQrDataUrl (SVG).");
  }
  return knihovna.toDataURL(spayd, {
    errorCorrectionLevel: "M",
    margin: moznosti?.okraj ?? 2,
    width: moznosti?.sirka ?? 240,
    color: { dark: "#000000", light: "#FFFFFF" },
  });
}

/**
 * Převod textu do base64.
 * `btoa` umí jen znaky do 255, a SVG s českým textem by ho rozbilo —
 * proto text nejdřív převedeme na bajty (UTF-8) a teprve ty zakódujeme.
 */
function doBase64(text: string): string {
  const bajty = new TextEncoder().encode(text);
  let binarne = "";
  for (const b of bajty) binarne += String.fromCharCode(b);
  const btoaFn = (globalThis as { btoa?: (s: string) => string }).btoa;
  if (typeof btoaFn === "function") return btoaFn(binarne);
  // Záložní cesta pro starší Node.js bez globálního btoa.
  const buffer = (globalThis as { Buffer?: { from: (s: string, enc: string) => { toString: (enc: string) => string } } }).Buffer;
  if (buffer) return buffer.from(binarne, "binary").toString("base64");
  throw new Error("Prostředí neumí base64 (chybí btoa i Buffer).");
}
