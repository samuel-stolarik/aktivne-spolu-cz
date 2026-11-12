/**
 * Formulář zápisu po akci (/zapis/).
 *
 * Mluví jen s Edge Funkcí `zapis-napadu`. Pořadatel se prokazuje tokenem
 * z osobního odkazu. Fotky jdou z prohlížeče rovnou do úložiště na
 * jednorázovou podepsanou adresu, kterou funkce vydá po ověření tokenu.
 *
 * FOTKY se před nahráním zmenší na delší stranu 1600 px a uloží jako JPEG.
 * Překreslením přes canvas zmizí EXIF i poloha GPS.
 *
 * ROZEPSANÝ ZÁPIS se průběžně ukládá do localStorage tohoto prohlížeče
 * (klíč podle tokenu), aby se po obnovení stránky neztratil. Když
 * localStorage nejde, formulář funguje dál, jen si nic nepamatuje.
 */
import { createClient } from "@supabase/supabase-js";
import { LIMITY } from "../../lib/ciselnikNapadu";

const ADRESA = import.meta.env.PUBLIC_SUPABASE_URL ?? "";
const KLIC = import.meta.env.PUBLIC_SUPABASE_ANON_KEY ?? "";
const FUNKCE = `${ADRESA}/functions/v1/zapis-napadu`;

const KROKU = 7;
const DELSI_STRANA = 1600;
const KVALITA_JPEG = 0.85;

/** Ve kterém kroku které pole je. Podle toho se po chybě ze serveru skočí. */
const KROK_POLE: Record<string, number> = {
  nazev_poradatele: 1, kontaktni_osoba: 1, email: 1, telefon: 1, mesto: 1, kraj: 1,
  nazev_akce: 2, datum_akce: 2, typ: 2, podtyp: 2, podtyp_jine: 2,
  vek: 3, zdatnost: 3,
  narocnost: 4, delka: 4, pomucky_potreba: 4, pomucky_jake: 4,
  popis: 5,
  fotky: 6,
  verejny_kontakt: 7, souhlas_zpracovani: 7, souhlas_foto: 7, vzkaz: 7,
};

interface Fotka {
  cesta: string;
  nahled: string;
}

interface Odpoved {
  chyba?: string;
  chyby?: Record<string, string>;
  [k: string]: unknown;
}

// ---------------------------------------------------------------------------
// Pomocné
// ---------------------------------------------------------------------------

function $(id: string) {
  return document.getElementById(id);
}

function el<T extends HTMLElement>(id: string): T {
  const prvek = document.getElementById(id);
  if (!prvek) throw new Error(`Chybí prvek #${id}`);
  return prvek as T;
}

function zprava(misto: HTMLElement, druh: "ok" | "chyba" | "info", text: string) {
  misto.innerHTML = "";
  const p = document.createElement("p");
  p.className = `z-${druh}`;
  p.textContent = text;
  misto.append(p);
}

function znaku(t: string): number {
  return [...t.trim()].length;
}

function tokenZAdresy(): string {
  const zHashe = new URLSearchParams(location.hash.slice(1)).get("t");
  const zDotazu = new URLSearchParams(location.search).get("t");
  return (zHashe || zDotazu || "").trim();
}

async function zavolej(akce: string, token: string, navic: Record<string, unknown> = {}) {
  let odpoved: Response;
  try {
    odpoved = await fetch(FUNKCE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: KLIC,
        Authorization: `Bearer ${KLIC}`,
      },
      body: JSON.stringify({ akce, token, ...navic }),
    });
  } catch {
    return {
      stav: 0,
      data: { chyba: "Nepodařilo se spojit se serverem. Zkontrolujte připojení k internetu a zkuste to znovu." } as Odpoved,
    };
  }
  let data: Odpoved;
  try {
    data = (await odpoved.json()) as Odpoved;
  } catch {
    data = { chyba: "Server odpověděl nesrozumitelně. Zkuste to prosím za chvíli znovu." };
  }
  return { stav: odpoved.status, data };
}

/** Zmenší fotku a vrátí JPEG. Při překreslení zmizí EXIF i GPS. */
async function zmensi(soubor: File): Promise<Blob> {
  let obraz: ImageBitmap | HTMLImageElement;
  try {
    // `from-image` otočí fotku podle EXIF, než ho zahodíme.
    obraz = await createImageBitmap(soubor, { imageOrientation: "from-image" });
  } catch {
    obraz = await new Promise<HTMLImageElement>((hotovo, chyba) => {
      const img = new Image();
      img.onload = () => hotovo(img);
      img.onerror = () => chyba(new Error("nejde-otevrit"));
      img.src = URL.createObjectURL(soubor);
    });
  }
  const sirka = "naturalWidth" in obraz ? obraz.naturalWidth : obraz.width;
  const vyska = "naturalHeight" in obraz ? obraz.naturalHeight : obraz.height;
  if (!sirka || !vyska) throw new Error("nejde-otevrit");

  const pomer = Math.min(1, DELSI_STRANA / Math.max(sirka, vyska));
  const platno = document.createElement("canvas");
  platno.width = Math.round(sirka * pomer);
  platno.height = Math.round(vyska * pomer);
  const kresba = platno.getContext("2d");
  if (!kresba) throw new Error("nejde-otevrit");
  // Bílé pozadí, ať průhledné PNG nezčerná.
  kresba.fillStyle = "#fff";
  kresba.fillRect(0, 0, platno.width, platno.height);
  kresba.drawImage(obraz, 0, 0, platno.width, platno.height);
  if ("close" in obraz) obraz.close();

  return await new Promise<Blob>((hotovo, chyba) =>
    platno.toBlob(
      (b) => (b ? hotovo(b) : chyba(new Error("nejde-otevrit"))),
      "image/jpeg",
      KVALITA_JPEG,
    ),
  );
}

// ---------------------------------------------------------------------------
// Hlavní část
// ---------------------------------------------------------------------------

export function spustZapis() {
  const stav = el<HTMLDivElement>("z-stav");
  const formular = el<HTMLFormElement>("z-formular");
  const token = tokenZAdresy();

  if (!ADRESA || !KLIC) {
    zprava(stav, "chyba", "Formulář teď nefunguje. Napište nám prosím a pošleme vám odkaz znovu.");
    return;
  }
  if (!token) {
    zprava(
      stav,
      "chyba",
      "V odkazu chybí váš osobní kód. Otevřete prosím formulář znovu přímo z e-mailu, který jsme vám poslali.",
    );
    return;
  }

  void nacti();

  async function nacti() {
    const { stav: kod, data } = await zavolej("nacti", token);
    if (kod !== 200) {
      zprava(stav, "chyba", data.chyba ?? "Formulář se nepodařilo načíst. Zkuste to prosím za chvíli znovu.");
      return;
    }
    pripravFormular(data);
  }

  // -------------------------------------------------------------------------
  function pripravFormular(data: Odpoved) {
    const stavZapisu = String(data.stav);
    const zapis = data.zapis as Record<string, unknown> | null;
    const predvyplneni = (data.predvyplneni ?? {}) as Record<string, unknown>;
    const souhlas = (data.souhlas ?? {}) as { zpracovani?: string; foto?: string };

    el("z-souhlas-zpracovani-text").textContent = souhlas.zpracovani ?? "";
    el("z-souhlas-foto-text").textContent = souhlas.foto ?? "";

    // Uzavřený zápis se jen oznámí, formulář se neukáže.
    if (!data.lzeUpravit) {
      if (stavZapisu === "schvaleno") {
        stav.innerHTML =
          '<p class="z-ok">Hotovo. Váš zápis je schválený a najdete ho v Zásobníku nápadů.</p>' +
          '<p><a class="z-tlacitko" href="/zasobnik/">Otevřít Zásobník nápadů</a></p>';
      } else {
        zprava(stav, "info", "Tento zápis jsme se rozhodli nezveřejnit. Když k tomu máte otázku, napište nám.");
      }
      return;
    }

    stav.innerHTML = "";
    if (stavZapisu === "vraceno" && zapis?.duvod) {
      zprava(stav, "info", `Prosíme o úpravu zápisu: ${String(zapis.duvod)}`);
    } else if (stavZapisu === "ceka") {
      zprava(
        stav,
        "info",
        "Zápis už máme a čeká na schválení. Dokud ho neschválíme, můžete ho tady upravit a odeslat znovu.",
      );
    }

    // Původní nápad z registrace jako nápověda k popisu.
    const napad = String(predvyplneni.napad_na_aktivitu ?? "").trim();
    if (napad) {
      const p = el("z-puvodni-napad");
      p.textContent = `Při registraci jste psali: „${napad}“`;
      p.hidden = false;
    }

    // Rozepsaný zápis z tohoto prohlížeče má přednost, pak uložený zápis,
    // pak údaje z registrace.
    const rozepsany = nactiRozepsany();
    const zaklad: Record<string, unknown> = zapis
      ? { ...zapis, pomucky_potreba: zapis.pomucky_potreba ? "ano" : "ne" }
      : {
          nazev_poradatele: predvyplneni.nazev_poradatele,
          kontaktni_osoba: predvyplneni.kontaktni_osoba,
          email: predvyplneni.email,
          telefon: predvyplneni.telefon,
          mesto: predvyplneni.mesto,
          kraj: predvyplneni.kraj,
          datum_akce: predvyplneni.datum_akce,
        };
    vyplnFormular({ ...zaklad, ...(rozepsany ?? {}) });

    // Rozepsaný zápis si pamatuje jen cesty fotek. Náhledy jsou dočasné
    // adresy, proto se vezmou čerstvé ze serveru (`nahrane`).
    const nahrane = new Map(
      ((data.nahrane as Fotka[] | undefined) ?? []).map((f) => [f.cesta, f.nahled]),
    );
    const cesty = Array.isArray(rozepsany?.fotky)
      ? (rozepsany!.fotky as string[])
      : ((zapis?.fotky as Fotka[] | undefined) ?? []).map((f) => f.cesta);
    fotky = cesty
      .filter((c) => nahrane.has(c))
      .map((cesta) => ({ cesta, nahled: nahrane.get(cesta)! }));
    vykresliFotky();

    formular.hidden = false;
    ukazKrok(1, false);
  }

  // -------------------------------------------------------------------------
  // Čtení a plnění polí
  // -------------------------------------------------------------------------
  const pole = formular.elements;

  function hodnota(jmeno: string): string {
    const p = pole.namedItem(jmeno);
    if (p instanceof RadioNodeList) return p.value;
    if (p instanceof HTMLInputElement || p instanceof HTMLTextAreaElement || p instanceof HTMLSelectElement) {
      return p.value.trim();
    }
    return "";
  }

  function zaskrtnute(jmeno: string): string[] {
    return Array.from(formular.querySelectorAll<HTMLInputElement>(`input[name="${jmeno}"]:checked`)).map(
      (i) => i.value,
    );
  }

  function zaskrtnuto(jmeno: string): boolean {
    return formular.querySelector<HTMLInputElement>(`input[name="${jmeno}"]`)?.checked ?? false;
  }

  function nastav(jmeno: string, h: unknown) {
    const vstupy = formular.querySelectorAll<HTMLInputElement>(`[name="${jmeno}"]`);
    vstupy.forEach((v) => {
      if (v.type === "checkbox") {
        v.checked = Array.isArray(h) ? h.includes(v.value) : h === true;
      } else if (v.type === "radio") {
        v.checked = v.value === h;
      } else {
        v.value = h == null ? "" : String(h);
      }
    });
  }

  function vyplnFormular(d: Record<string, unknown>) {
    for (const jmeno of [
      "nazev_poradatele", "kontaktni_osoba", "email", "telefon", "mesto", "kraj",
      "nazev_akce", "datum_akce", "typ", "podtyp_jine", "narocnost", "delka",
      "pomucky_potreba", "pomucky_jake", "popis", "vzkaz",
    ]) {
      if (d[jmeno] !== undefined) nastav(jmeno, d[jmeno]);
    }
    if (d.typ && d.podtyp) nastav(`podtyp-${d.typ}`, d.podtyp);
    for (const jmeno of ["vek", "zdatnost", "verejny_kontakt"]) {
      if (Array.isArray(d[jmeno])) nastav(jmeno, d[jmeno]);
    }
    for (const jmeno of ["souhlas_zpracovani", "souhlas_foto"]) {
      if (d[jmeno] === true) nastav(jmeno, true);
    }
    prekresliZavislosti();
  }

  function sesbirej(): Record<string, unknown> {
    const typ = hodnota("typ");
    return {
      nazev_poradatele: hodnota("nazev_poradatele"),
      kontaktni_osoba: hodnota("kontaktni_osoba"),
      email: hodnota("email"),
      telefon: hodnota("telefon"),
      mesto: hodnota("mesto"),
      kraj: hodnota("kraj"),
      nazev_akce: hodnota("nazev_akce"),
      datum_akce: hodnota("datum_akce"),
      typ,
      podtyp: typ ? hodnota(`podtyp-${typ}`) : "",
      podtyp_jine: hodnota("podtyp_jine"),
      vek: zaskrtnute("vek"),
      zdatnost: zaskrtnute("zdatnost"),
      narocnost: hodnota("narocnost"),
      delka: hodnota("delka"),
      pomucky_potreba: hodnota("pomucky_potreba") === "" ? null : hodnota("pomucky_potreba") === "ano",
      pomucky_jake: hodnota("pomucky_jake"),
      popis: hodnota("popis"),
      fotky: fotky.map((f) => f.cesta),
      verejny_kontakt: zaskrtnute("verejny_kontakt"),
      souhlas_zpracovani: zaskrtnuto("souhlas_zpracovani"),
      souhlas_foto: zaskrtnuto("souhlas_foto"),
      vzkaz: hodnota("vzkaz"),
    };
  }

  // -------------------------------------------------------------------------
  // Pole, která závisí na jiných
  // -------------------------------------------------------------------------
  function prekresliZavislosti() {
    const typ = hodnota("typ");
    formular.querySelectorAll<HTMLElement>('[data-pole="podtyp"]').forEach((b) => {
      b.hidden = b.dataset.proTyp !== typ;
    });
    const podtyp = typ ? hodnota(`podtyp-${typ}`) : "";
    (formular.querySelector('[data-pole="podtyp_jine"]') as HTMLElement).hidden = podtyp !== "jine";
    (formular.querySelector('[data-pole="pomucky_jake"]') as HTMLElement).hidden =
      hodnota("pomucky_potreba") !== "ano";

    // U voleb kontaktu ukázat, co přesně se zveřejní.
    const email = hodnota("email");
    const telefon = hodnota("telefon");
    formular.querySelectorAll<HTMLElement>("[data-kontakt]").forEach((s) => {
      const h = s.dataset.kontakt === "email" ? email : telefon;
      s.textContent = h ? ` (${h})` : "";
    });
    const volbaTelefonu = formular.querySelector<HTMLInputElement>('input[name="verejny_kontakt"][value="telefon"]');
    if (volbaTelefonu) {
      volbaTelefonu.disabled = !telefon;
      if (!telefon) volbaTelefonu.checked = false;
      volbaTelefonu.closest("label")?.toggleAttribute("hidden", !telefon);
    }

    pocitadlo();
  }

  function pocitadlo() {
    const p = el("z-popis-pocet");
    const n = znaku(hodnota("popis"));
    if (n < LIMITY.popisMin) {
      p.textContent = `${n} znaků. Ještě aspoň ${LIMITY.popisMin - n}.`;
      p.dataset.stav = "malo";
    } else {
      p.textContent = `${n} z ${LIMITY.popisMax} znaků.`;
      p.dataset.stav = "ok";
    }
  }

  formular.addEventListener("input", () => {
    prekresliZavislosti();
    ulozRozepsany();
  });
  formular.addEventListener("change", () => {
    prekresliZavislosti();
    ulozRozepsany();
  });

  // -------------------------------------------------------------------------
  // Rozepsaný zápis v tomto prohlížeči
  // -------------------------------------------------------------------------
  const klicRozepsaneho = `as-zapis-${token.slice(0, 12)}`;

  function nactiRozepsany(): Record<string, unknown> | null {
    try {
      const t = localStorage.getItem(klicRozepsaneho);
      return t ? (JSON.parse(t) as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  function ulozRozepsany() {
    try {
      const d = sesbirej();
      localStorage.setItem(
        klicRozepsaneho,
        JSON.stringify({ ...d, pomucky_potreba: hodnota("pomucky_potreba") }),
      );
    } catch {
      /* bez localStorage se jen nic nepamatuje */
    }
  }

  function zahodRozepsany() {
    try {
      localStorage.removeItem(klicRozepsaneho);
    } catch {
      /* nic */
    }
  }

  // -------------------------------------------------------------------------
  // Kroky
  // -------------------------------------------------------------------------
  let krok = 1;
  const tlacitkoZpet = el<HTMLButtonElement>("z-zpet");
  const tlacitkoDal = el<HTMLButtonElement>("z-dal");
  const zpravaFormulare = el("z-zprava-formulare");

  function ukazKrok(n: number, presunoutFokus = true) {
    krok = n;
    formular.querySelectorAll<HTMLElement>("[data-krok]").forEach((s) => {
      s.hidden = Number(s.dataset.krok) !== n;
    });
    el("z-krok-text").textContent = `Krok ${n} z ${KROKU}`;
    formular.querySelectorAll(".z-ukazatel span").forEach((s, i) => {
      s.classList.toggle("je-hotovo", i < n);
    });
    tlacitkoZpet.hidden = n === 1;
    tlacitkoDal.textContent = n === KROKU ? "Odeslat ke schválení" : `Pokračovat na krok ${n + 1}`;
    zpravaFormulare.innerHTML = "";
    if (presunoutFokus) {
      formular.scrollIntoView({ behavior: "smooth", block: "start" });
      formular.querySelector<HTMLElement>(`[data-krok="${n}"] h2`)?.setAttribute("tabindex", "-1");
      formular.querySelector<HTMLElement>(`[data-krok="${n}"] h2`)?.focus({ preventScroll: true });
    }
  }

  function smazChyby() {
    formular.querySelectorAll<HTMLElement>("[data-chyba]").forEach((p) => {
      p.removeAttribute("data-chyba");
      p.querySelector(":scope > .z-chyba")?.remove();
    });
  }

  function ukazChybu(jmeno: string, text: string) {
    const misto = formular.querySelector<HTMLElement>(`[data-pole="${jmeno}"]:not([hidden])`) ??
      formular.querySelector<HTMLElement>(`[data-pole="${jmeno}"]`);
    if (!misto) return;
    misto.dataset.chyba = "1";
    const p = document.createElement("p");
    p.className = "z-chyba";
    p.id = `z-chyba-${jmeno}`;
    p.textContent = text;
    misto.append(p);
    misto.querySelectorAll("input, select, textarea").forEach((v) => {
      v.setAttribute("aria-describedby", `${v.getAttribute("aria-describedby") ?? ""} z-chyba-${jmeno}`.trim());
    });
  }

  /** Kontrola jednoho kroku v prohlížeči. Stejná pravidla jako na serveru. */
  function chybyKroku(n: number): Record<string, string> {
    const d = sesbirej();
    const ch: Record<string, string> = {};
    if (n === 1) {
      if (!d.nazev_poradatele) ch.nazev_poradatele = "Vyplňte prosím, kdo akci pořádal.";
      if (!d.kontaktni_osoba) ch.kontaktni_osoba = "Vyplňte prosím kontaktní osobu.";
      if (!/^[^\s@,;]+@[^\s@,;.]+(\.[^\s@,;.]+)+$/.test(String(d.email))) {
        ch.email = "Zkontrolujte prosím e-mail. Má tvar jmeno@domena.cz.";
      }
      const cislice = String(d.telefon).replace(/[\s\-/().]/g, "").replace(/^\+/, "");
      if (d.telefon && !/^[0-9]{9,15}$/.test(cislice)) ch.telefon = "Zkontrolujte prosím telefon. Stačí 9 číslic.";
      if (!d.mesto) ch.mesto = "Vyplňte prosím město nebo obec.";
      if (!d.kraj) ch.kraj = "Vyberte prosím kraj.";
    }
    if (n === 2) {
      if (!d.nazev_akce) ch.nazev_akce = "Napište prosím, jak se akce jmenovala.";
      if (!d.typ) ch.typ = "Vyberte prosím typ akce.";
      else if (!d.podtyp) ch.podtyp = "Vyberte prosím, o co šlo.";
      if (d.podtyp === "jine" && !d.podtyp_jine) ch.podtyp_jine = "Napište prosím, o jakou akci šlo.";
    }
    if (n === 3) {
      if (!(d.vek as string[]).length) ch.vek = "Vyberte prosím aspoň jednu věkovou skupinu.";
      if (!(d.zdatnost as string[]).length) ch.zdatnost = "Vyberte prosím aspoň jednu možnost.";
    }
    if (n === 4) {
      if (!d.narocnost) ch.narocnost = "Vyberte prosím náročnost.";
      if (!d.delka) ch.delka = "Vyberte prosím, jak dlouho akce trvala.";
      if (d.pomucky_potreba === null) ch.pomucky_potreba = "Vyberte prosím, jestli byly potřeba pomůcky.";
    }
    if (n === 5) {
      const z = znaku(String(d.popis));
      if (z < LIMITY.popisMin) ch.popis = `Popis má ${z} znaků. Napište prosím aspoň ${LIMITY.popisMin}.`;
    }
    if (n === 6) {
      if (nahravaSe > 0) ch.fotky = "Počkejte prosím, až se fotky nahrají.";
      else if (!fotky.length) ch.fotky = "Přidejte prosím aspoň jednu fotku.";
    }
    if (n === 7) {
      if (!(d.verejny_kontakt as string[]).length) {
        ch.verejny_kontakt = "Vyberte prosím, který kontakt můžeme u nápadu zveřejnit.";
      }
      if (!d.souhlas_zpracovani) ch.souhlas_zpracovani = "Bez souhlasu zápis uložit nemůžeme. Zaškrtněte ho prosím.";
      if (!d.souhlas_foto) ch.souhlas_foto = "Bez tohoto prohlášení fotky zveřejnit nemůžeme. Zaškrtněte ho prosím.";
    }
    return ch;
  }

  function zamerNaPrvniChybu() {
    const prvni = formular.querySelector<HTMLElement>(
      "[data-chyba] input:not([type=hidden]), [data-chyba] select, [data-chyba] textarea, [data-chyba] .z-tlacitko",
    );
    prvni?.focus();
  }

  tlacitkoZpet.addEventListener("click", () => {
    smazChyby();
    ukazKrok(krok - 1);
  });

  formular.addEventListener("submit", async (u) => {
    u.preventDefault();
    smazChyby();
    const ch = chybyKroku(krok);
    if (Object.keys(ch).length) {
      for (const [jmeno, text] of Object.entries(ch)) ukazChybu(jmeno, text);
      zamerNaPrvniChybu();
      return;
    }
    if (krok < KROKU) {
      ukazKrok(krok + 1);
      return;
    }
    await odesli();
  });

  async function odesli() {
    tlacitkoDal.disabled = true;
    tlacitkoDal.textContent = "Odesíláme…";
    const { stav: kod, data } = await zavolej("uloz", token, { zapis: sesbirej() });
    tlacitkoDal.disabled = false;
    tlacitkoDal.textContent = "Odeslat ke schválení";

    if (kod === 200) {
      zahodRozepsany();
      formular.hidden = true;
      stav.innerHTML =
        '<p class="z-ok" tabindex="-1" id="z-hotovo">Hotovo. Zápis jsme přijali a co nejdřív ho zkontrolujeme. ' +
        "Až ho schválíme, objeví se v Zásobníku nápadů. Kdyby bylo potřeba něco upravit, napíšeme vám.</p>" +
        "<p>Zápis můžete do schválení upravit přes stejný odkaz z e-mailu.</p>";
      el("z-hotovo").focus();
      stav.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    if (data.chyby) {
      const kroky = Object.keys(data.chyby).map((j) => KROK_POLE[j] ?? KROKU);
      const prvniKrok = Math.min(...kroky);
      ukazKrok(prvniKrok);
      for (const [jmeno, text] of Object.entries(data.chyby)) ukazChybu(jmeno, text);
      zamerNaPrvniChybu();
      return;
    }
    zprava(zpravaFormulare, "chyba", data.chyba ?? "Zápis se nepodařilo odeslat. Zkuste to prosím za chvíli znovu.");
  }

  // -------------------------------------------------------------------------
  // Fotky
  // -------------------------------------------------------------------------
  let fotky: Fotka[] = [];
  let nahravaSe = 0;
  const seznamFotek = el<HTMLUListElement>("z-fotky");
  const vyberSouboru = el<HTMLInputElement>("z-soubor");
  const stavFotek = el("z-fotky-stav");
  const uloziste = createClient(ADRESA, KLIC, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }).storage;

  function vykresliFotky() {
    seznamFotek.innerHTML = "";
    fotky.forEach((f, i) => {
      const li = document.createElement("li");
      li.className = "z-fotka";
      const img = document.createElement("img");
      img.src = f.nahled;
      img.alt = i === 0 ? `Fotka ${i + 1}, titulní` : `Fotka ${i + 1}`;
      const smazat = document.createElement("button");
      smazat.type = "button";
      smazat.className = "z-tlacitko";
      smazat.textContent = "Odebrat";
      smazat.setAttribute("aria-label", `Odebrat fotku ${i + 1}`);
      smazat.addEventListener("click", () => {
        fotky.splice(i, 1);
        vykresliFotky();
        ulozRozepsany();
        zprava(stavFotek, "ok", `Hotovo. Fotku jsme z formuláře odebrali. Zbývá ${fotky.length}.`);
        vyberSouboru.focus();
      });
      li.append(img, smazat);
      if (i > 0) {
        const titulni = document.createElement("button");
        titulni.type = "button";
        titulni.className = "z-tlacitko";
        titulni.textContent = "Dát jako první";
        titulni.addEventListener("click", () => {
          const [f2] = fotky.splice(i, 1);
          fotky.unshift(f2);
          vykresliFotky();
          ulozRozepsany();
          zprava(stavFotek, "ok", "Hotovo. Fotka je teď titulní.");
        });
        li.append(titulni);
      }
      seznamFotek.append(li);
    });
    el("z-nahrat").hidden = fotky.length >= LIMITY.fotekMax;
  }

  vyberSouboru.addEventListener("change", async () => {
    const soubory = Array.from(vyberSouboru.files ?? []);
    vyberSouboru.value = "";
    if (!soubory.length) return;

    const volno = LIMITY.fotekMax - fotky.length;
    const vybrane = soubory.slice(0, volno);
    const chyby: string[] = [];
    if (soubory.length > volno) {
      chyby.push(`Přidat jde nejvýš ${LIMITY.fotekMax} fotek, ${soubory.length - volno} jsme vynechali.`);
    }

    nahravaSe += vybrane.length;
    zprava(stavFotek, "info", vybrane.length === 1 ? "Nahráváme fotku…" : `Nahráváme ${vybrane.length} fotky…`);

    let pridano = 0;
    for (const soubor of vybrane) {
      try {
        const jpeg = await zmensi(soubor);
        if (jpeg.size > LIMITY.fotkaBajtuMax) {
          chyby.push(`Fotka ${soubor.name} je i po zmenšení moc velká. Vyberte prosím jinou.`);
          continue;
        }
        const { stav: kod, data } = await zavolej("adresa-pro-fotku", token);
        if (kod !== 200) {
          chyby.push(data.chyba ?? "Fotku se nepodařilo nahrát. Zkuste to prosím znovu.");
          continue;
        }
        const { error } = await uloziste
          .from(String(data.bucket))
          .uploadToSignedUrl(String(data.cesta), String(data.token), jpeg, { contentType: "image/jpeg" });
        if (error) {
          chyby.push(`Fotku ${soubor.name} se nepodařilo nahrát. Zkuste to prosím znovu.`);
          continue;
        }
        fotky.push({ cesta: String(data.cesta), nahled: URL.createObjectURL(jpeg) });
        pridano++;
        vykresliFotky();
      } catch {
        chyby.push(`Fotku ${soubor.name} neumíme otevřít. Uložte ji prosím jako JPG a zkuste to znovu.`);
      } finally {
        nahravaSe--;
      }
    }

    ulozRozepsany();
    if (chyby.length) {
      stavFotek.innerHTML = "";
      if (pridano) {
        const ok = document.createElement("p");
        ok.className = "z-ok";
        ok.textContent = `Hotovo. Přidali jsme ${pridano} z ${vybrane.length}.`;
        stavFotek.append(ok);
      }
      for (const c of chyby) {
        const p = document.createElement("p");
        p.className = "z-chyba";
        p.textContent = c;
        stavFotek.append(p);
      }
    } else {
      zprava(
        stavFotek,
        "ok",
        pridano === 1 ? "Hotovo. Fotku jsme přidali." : `Hotovo. Přidali jsme ${pridano} fotky.`,
      );
    }
  });
}
