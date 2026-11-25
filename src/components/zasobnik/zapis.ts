/**
 * Formulář zápisu po akci (/zapis/). Průvodce o 8 krocích.
 *
 * Mluví jen s Edge Funkcí `zapis-napadu`. Pořadatel se prokazuje tokenem
 * z osobního odkazu. Fotky jdou z prohlížeče rovnou do úložiště na
 * jednorázovou podepsanou adresu, kterou funkce vydá po ověření tokenu.
 *
 * FOTKY se před nahráním zmenší na delší stranu 1600 px a uloží jako JPEG
 * (kvalita 0,8). Překreslením přes canvas zmizí EXIF i poloha GPS.
 *
 * ROZEPSANÝ ZÁPIS se průběžně ukládá do localStorage tohoto prohlížeče
 * (klíč podle tokenu), aby se po obnovení stránky neztratil. Když
 * localStorage nejde, formulář funguje dál, jen si nic nepamatuje.
 *
 * UKÁZKA (PUBLIC_ZASOBNIK_UKAZKA=1, jen náhled pro zadavatelku): bez
 * osobního odkazu se formulář otevře s vymyšlenými údaji. Fotky se jen
 * zmenší a ukážou, nic se nenahrává, neukládá ani neodesílá.
 */
import { createClient } from "@supabase/supabase-js";
import {
  DELKA,
  LIMITY,
  MISTO_KONANI,
  PODTYP_JINE,
  POMUCKY,
  POPISKY,
  POZNAMKA_JE_VEREJNA,
  ROZPOCET,
  SOUHLAS,
  VEK,
  VEK_VSECHNY,
  VEREJNY_KONTAKT,
  ZDATNOST,
  maVlastniText,
  nazevVolby,
  nazvyVoleb,
  typSPodtypem,
} from "../../lib/ciselnikNapadu";

const ADRESA = import.meta.env.PUBLIC_SUPABASE_URL ?? "";
const KLIC = import.meta.env.PUBLIC_SUPABASE_ANON_KEY ?? "";
const FUNKCE = `${ADRESA}/functions/v1/zapis-napadu`;
const UKAZKA_POVOLENA = import.meta.env.PUBLIC_ZASOBNIK_UKAZKA === "1";

const KROKU = 8;
const DELSI_STRANA = 1600;
const KVALITA_JPEG = 0.8;

/** Ve kterém kroku které pole je. Podle toho se po chybě ze serveru skočí. */
const KROK_POLE: Record<string, number> = {
  nazev_poradatele: 1, kontaktni_osoba: 1, email: 1, telefon: 1,
  nazev_akce: 2, datum_akce: 2, mesto: 2, kraj: 2,
  typ: 3, podtyp_jine: 3,
  delka: 4, misto_konani: 4, rozpocet: 4, pomucky_potreba: 4, pomucky_jake: 4,
  vek: 5, zdatnost: 5,
  popis: 6, poznamka: 6, vzkaz: 6,
  fotky: 7, souhlas_foto: 7, verejny_kontakt: 7, souhlas_zpracovani: 7,
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

/** 1 fotka, 2–4 fotky, 5 fotek. */
function sklonuj(n: number, jedna: string, dve: string, pet: string): string {
  if (n === 1) return `${n} ${jedna}`;
  if (n >= 2 && n <= 4) return `${n} ${dve}`;
  return `${n} ${pet}`;
}

/** Číslo s mezerou po tisících, jak se píše česky (1 000). */
function cislo(n: number): string {
  return n >= 1000 ? `${Math.floor(n / 1000)} ${String(n % 1000).padStart(3, "0")}` : String(n);
}

/** RRRR-MM-DD → „13. 11. 2026". */
function datumCesky(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${Number(m[3])}. ${Number(m[2])}. ${m[1]}` : iso;
}

/** Dnešek v tomto prohlížeči jako RRRR-MM-DD. */
function dnes(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function predDny(dni: number): string {
  const d = new Date();
  d.setDate(d.getDate() - dni);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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

/** Vymyšlená data pro ukázku. Tvar jako odpověď funkce na `nacti`. */
function ukazkovaOdpoved(): Odpoved {
  return {
    stav: "novy",
    lzeUpravit: true,
    souhlas: { zpracovani: SOUHLAS.zpracovani },
    predvyplneni: {
      nazev_poradatele: "ZŠ Magic Hill",
      kontaktni_osoba: "Jana Nováková",
      email: "jana@example.cz",
      telefon: "777 123 456",
      mesto: "Říčany",
      kraj: "Středočeský",
      datum_akce: predDny(21),
      napad_na_aktivitu: "Chceme se seniory z klubu zpívat lidové písničky.",
    },
    zapis: null,
    nahrane: [],
  };
}

// ---------------------------------------------------------------------------
// Hlavní část
// ---------------------------------------------------------------------------

export function spustZapis() {
  const stav = el<HTMLDivElement>("z-stav");
  const formular = el<HTMLFormElement>("z-formular");
  const token = tokenZAdresy();
  const ukazka = UKAZKA_POVOLENA && !token;

  if (ukazka) {
    const pruh = document.createElement("p");
    pruh.className = "zp-ukazka";
    pruh.textContent = "Ukázka: nic se neukládá ani neodesílá.";
    stav.before(pruh);
  } else {
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
  }

  async function nacti() {
    if (ukazka) {
      pripravFormular(ukazkovaOdpoved());
      return;
    }
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

    // Znění souhlasů posílá server: přesně tohle se pak uloží k zápisu.
    el("z-souhlas-zpracovani-text").textContent = souhlas.zpracovani ?? SOUHLAS.zpracovani;
    if (souhlas.foto) el("z-souhlas-foto-text").textContent = souhlas.foto;

    // Uzavřený zápis se jen oznámí, formulář se neukáže.
    if (!data.lzeUpravit) {
      if (stavZapisu === "schvaleno") {
        stav.innerHTML =
          '<p class="z-ok">Hotovo! Váš zápis je schválený a najdete ho v Zásobníku nápadů.</p>' +
          '<p><a class="z-tlacitko" href="/zasobnik/">Otevřít Zásobník nápadů</a></p>';
      } else {
        zprava(stav, "info", "Tento zápis jsme se rozhodli nezveřejnit. Když k tomu máte otázku, napište nám.");
      }
      return;
    }

    stav.innerHTML = "";
    if (stavZapisu === "vraceno" && zapis?.duvod) {
      const box = document.createElement("div");
      box.className = "z-info zp-vraceno";
      const nadpis = document.createElement("p");
      nadpis.className = "zp-vraceno-nadpis";
      nadpis.textContent = "Prosíme o úpravu zápisu:";
      const duvod = document.createElement("p");
      duvod.textContent = String(zapis.duvod);
      box.append(nadpis, duvod);
      stav.append(box);
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

    el<HTMLInputElement>("z-datum_akce").max = dnes();
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
        v.checked = Array.isArray(h) ? h.includes(v.value) : v.value === h;
      } else {
        v.value = h == null ? "" : String(h);
      }
    });
  }

  function vyplnFormular(d: Record<string, unknown>) {
    for (const jmeno of [
      "nazev_poradatele", "kontaktni_osoba", "email", "telefon", "mesto", "kraj",
      "nazev_akce", "datum_akce", "typ", "podtyp_jine", "delka", "misto_konani", "rozpocet",
      "pomucky_potreba", "pomucky_jake", "popis", "poznamka", "vzkaz",
    ]) {
      if (d[jmeno] !== undefined) nastav(jmeno, d[jmeno]);
    }
    // Zdatnost se ukládá jako seznam, i když je ve formuláři jedna volba.
    if (Array.isArray(d.zdatnost)) nastav("zdatnost", d.zdatnost);
    for (const jmeno of ["vek", "verejny_kontakt"]) {
      if (Array.isArray(d[jmeno])) nastav(jmeno, d[jmeno]);
    }
    for (const jmeno of ["souhlas_zpracovani", "souhlas_foto"]) {
      if (d[jmeno] === true) nastav(jmeno, true);
    }
    prekresliZavislosti();
  }

  /** Podtyp: jen u „Jiná" (`jine`, s vlastním textem), jinak nic. */
  function podtypPodleTypu(typ: string): string | null {
    return maVlastniText(typ) ? PODTYP_JINE : null;
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
      podtyp: podtypPodleTypu(typ),
      podtyp_jine: hodnota("podtyp_jine"),
      vek: zaskrtnute("vek"),
      zdatnost: zaskrtnute("zdatnost"),
      delka: hodnota("delka"),
      misto_konani: hodnota("misto_konani"),
      rozpocet: hodnota("rozpocet"),
      pomucky_potreba: hodnota("pomucky_potreba") === "" ? null : hodnota("pomucky_potreba") === "ano",
      pomucky_jake: hodnota("pomucky_jake"),
      popis: hodnota("popis"),
      poznamka: hodnota("poznamka"),
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
    (formular.querySelector('[data-pole="podtyp_jine"]') as HTMLElement).hidden = !maVlastniText(typ);
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

    pocitadla();
  }

  function pocitadla() {
    const popis = el("z-popis-pocet");
    const n = znaku(hodnota("popis"));
    popis.textContent = `Napsáno ${cislo(n)} z ${LIMITY.popisMin}–${cislo(LIMITY.popisMax)} znaků`;
    popis.dataset.stav = n >= LIMITY.popisMin ? "ok" : n > 0 ? "malo" : "";

    const poznamka = el("z-poznamka-pocet");
    poznamka.textContent = `Napsáno ${znaku(hodnota("poznamka"))} z nejvýš ${LIMITY.poznamkaMax} znaků`;

    const vzkaz = el("z-vzkaz-pocet");
    vzkaz.textContent = `Napsáno ${znaku(hodnota("vzkaz"))} z nejvýš ${LIMITY.vzkazMax} znaků`;

    const pomucky = el("z-pomucky_jake-pocet");
    pomucky.textContent = `Napsáno ${znaku(hodnota("pomucky_jake"))} z nejvýš ${LIMITY.pomuckyMax} znaků`;
  }

  formular.addEventListener("input", () => {
    smazChyby();
    prekresliZavislosti();
    ulozRozepsany();
  });
  formular.addEventListener("change", (u) => {
    // „Všechny skupiny" ostatní volby zruší a naopak.
    const cil = u.target;
    if (cil instanceof HTMLInputElement && cil.name === "vek" && cil.checked) {
      formular.querySelectorAll<HTMLInputElement>('input[name="vek"]').forEach((v) => {
        if (v !== cil && (cil.value === VEK_VSECHNY || v.value === VEK_VSECHNY)) v.checked = false;
      });
    }
    smazChyby();
    prekresliZavislosti();
    ulozRozepsany();
  });

  // -------------------------------------------------------------------------
  // Rozepsaný zápis v tomto prohlížeči
  // -------------------------------------------------------------------------
  const klicRozepsaneho = ukazka ? "as-zapis-ukazka" : `as-zapis-${token.slice(0, 12)}`;

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
  const boxChyb = el<HTMLDivElement>("z-chyby");

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
    if (n === KROKU) vykresliShrnuti();
    if (presunoutFokus) {
      formular.scrollIntoView({ behavior: "smooth", block: "start" });
      const h2 = formular.querySelector<HTMLElement>(`[data-krok="${n}"] h2`);
      h2?.setAttribute("tabindex", "-1");
      h2?.focus({ preventScroll: true });
    }
  }

  function smazChyby() {
    if (boxChyb.hidden && !formular.querySelector("[data-chyba]")) return;
    boxChyb.hidden = true;
    boxChyb.innerHTML = "";
    formular.querySelectorAll<HTMLElement>("[data-chyba]").forEach((p) => {
      p.removeAttribute("data-chyba");
      p.querySelectorAll("[aria-invalid]").forEach((v) => v.removeAttribute("aria-invalid"));
    });
  }

  /** Červený box nad poli: co je špatně a co s tím udělat. */
  function ukazChyby(chyby: Record<string, string>) {
    boxChyb.innerHTML = "";
    const texty = Object.values(chyby);
    const nadpis = document.createElement("p");
    nadpis.className = "zp-chyby-nadpis";
    nadpis.textContent = texty.length === 1 ? "Ještě jedna věc:" : "Ještě pár věcí:";
    boxChyb.append(nadpis);
    if (texty.length === 1) {
      const p = document.createElement("p");
      p.textContent = texty[0];
      boxChyb.append(p);
    } else {
      const ul = document.createElement("ul");
      for (const t of texty) {
        const li = document.createElement("li");
        li.textContent = t;
        ul.append(li);
      }
      boxChyb.append(ul);
    }
    boxChyb.hidden = false;

    for (const jmeno of Object.keys(chyby)) {
      const misto =
        formular.querySelector<HTMLElement>(`[data-pole="${jmeno}"]:not([hidden])`) ??
        formular.querySelector<HTMLElement>(`[data-pole="${jmeno}"]`);
      if (!misto) continue;
      misto.dataset.chyba = "1";
      misto.querySelectorAll("input:not([type=hidden]), select, textarea").forEach((v) => {
        v.setAttribute("aria-invalid", "true");
      });
    }

    // Fokus na první chybné pole, ať se dá hned opravit. Box přečte
    // čtečka sama (role="alert").
    const prvni = formular.querySelector<HTMLElement>(
      "[data-chyba]:not([hidden]) input:not([type=hidden]):not([type=file]):not(:disabled), " +
        "[data-chyba]:not([hidden]) select, [data-chyba]:not([hidden]) textarea",
    );
    if (prvni) prvni.focus();
    else boxChyb.focus();
    boxChyb.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  /** Kontrola jednoho kroku v prohlížeči. Stejná pravidla jako na serveru. */
  function chybyKroku(n: number): Record<string, string> {
    const d = sesbirej();
    const ch: Record<string, string> = {};
    if (n === 1) {
      if (!d.nazev_poradatele) ch.nazev_poradatele = "Vyplňte prosím organizaci, která akci pořádala.";
      if (!d.kontaktni_osoba) ch.kontaktni_osoba = "Vyplňte prosím kontaktní osobu.";
      if (!/^[^\s@,;]+@[^\s@,;.]+(\.[^\s@,;.]+)+$/.test(String(d.email))) {
        ch.email = "Zkontrolujte prosím e-mail. Má tvar jmeno@domena.cz.";
      }
      const cislice = String(d.telefon).replace(/[\s\-/().]/g, "").replace(/^\+/, "");
      if (d.telefon && !/^[0-9]{9,15}$/.test(cislice)) ch.telefon = "Zkontrolujte prosím telefon. Stačí 9 číslic.";
    }
    if (n === 2) {
      const z = znaku(String(d.nazev_akce));
      if (!z) ch.nazev_akce = "Napište prosím, jak se akce jmenovala.";
      else if (z < LIMITY.nazevMin) {
        ch.nazev_akce = `Název je krátký. Napište prosím aspoň ${LIMITY.nazevMin} znaků.`;
      }
      if (d.datum_akce && String(d.datum_akce) > dnes()) {
        ch.datum_akce = "Datum je v budoucnosti. Zadejte prosím den, kdy akce proběhla, nebo pole nechte prázdné.";
      }
      if (!d.mesto) ch.mesto = "Vyplňte prosím město nebo obec.";
      if (!d.kraj) ch.kraj = "Vyberte prosím kraj.";
    }
    if (n === 3) {
      if (!d.typ) ch.typ = "Vyberte prosím, jaký typ akce to byl.";
      else if (d.podtyp === PODTYP_JINE && !d.podtyp_jine) ch.podtyp_jine = "Napište prosím, jaká akce to byla.";
    }
    if (n === 4) {
      if (!d.delka) ch.delka = "Vyberte prosím časovou náročnost akce.";
      if (!d.misto_konani) ch.misto_konani = "Vyberte prosím místo konání.";
      if (!d.rozpocet) ch.rozpocet = "Vyberte prosím rozpočet na celou akci.";
      if (d.pomucky_potreba === null) ch.pomucky_potreba = "Vyberte prosím, jestli byly potřeba pomůcky.";
      else if (d.pomucky_potreba && !d.pomucky_jake) ch.pomucky_jake = "Napište prosím, jaké pomůcky byly potřeba.";
    }
    if (n === 5) {
      if (!(d.vek as string[]).length) ch.vek = "Vyberte prosím aspoň jednu skupinu, pro kterou je akce vhodná.";
      if (!(d.zdatnost as string[]).length) ch.zdatnost = "Vyberte prosím zdatnost seniorů.";
    }
    if (n === 6) {
      const z = znaku(String(d.popis));
      if (z < LIMITY.popisMin) {
        const zbyva = LIMITY.popisMin - z;
        ch.popis = `Popis je krátký. Dopište ještě ${sklonuj(zbyva, "znak", "znaky", "znaků")}.`;
      }
    }
    if (n === 7) {
      if (nahravaSe > 0) ch.fotky = "Počkejte prosím, až se fotky nahrají.";
      else if (fotky.length < LIMITY.fotekMin) ch.fotky = "Přidejte prosím aspoň jednu fotku z akce.";
      if (!d.souhlas_foto) ch.souhlas_foto = "Bez souhlasu vyfocených fotky zveřejnit nemůžeme. Zaškrtněte ho prosím.";
      if (!(d.verejny_kontakt as string[]).length) {
        ch.verejny_kontakt = "Vyberte prosím, který kontakt můžeme u nápadu zveřejnit.";
      }
      if (!d.souhlas_zpracovani) ch.souhlas_zpracovani = "Bez souhlasu zápis uložit nemůžeme. Zaškrtněte ho prosím.";
    }
    return ch;
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
      ukazChyby(ch);
      return;
    }
    if (krok < KROKU) {
      ukazKrok(krok + 1);
      return;
    }
    await odesli();
  });

  // -------------------------------------------------------------------------
  // Shrnutí (krok 8)
  // -------------------------------------------------------------------------
  function vykresliShrnuti() {
    const d = sesbirej();
    const misto = el("z-shrnuti");
    misto.innerHTML = "";

    const kontakty = (d.verejny_kontakt as string[]).map((k) => {
      const h = k === "email" ? d.email : d.telefon;
      return `${nazevVolby(VEREJNY_KONTAKT, k)} (${h})`;
    });

    const radky: [string, string][] = [
      ["Organizace", String(d.nazev_poradatele)],
      ["Kontaktní osoba", String(d.kontaktni_osoba)],
      ["E-mail", String(d.email)],
      ["Telefon", String(d.telefon || "Neuvedený")],
      ["Název akce", String(d.nazev_akce)],
      ["Kdy proběhla", d.datum_akce ? datumCesky(String(d.datum_akce)) : "Neuvedeno"],
      ["Kde", `${d.mesto}, ${d.kraj}`],
      [POPISKY.typ, typSPodtypem(String(d.typ), d.podtyp as string | null, (d.podtyp_jine as string) || null)],
      [POPISKY.delka, nazevVolby(DELKA, String(d.delka))],
      [POPISKY.misto_konani, nazevVolby(MISTO_KONANI, String(d.misto_konani))],
      [POPISKY.rozpocet, nazevVolby(ROZPOCET, String(d.rozpocet))],
      [
        POPISKY.pomucky,
        d.pomucky_potreba ? `${nazevVolby(POMUCKY, "ano")}: ${d.pomucky_jake}` : nazevVolby(POMUCKY, "ne"),
      ],
      [POPISKY.vek, nazvyVoleb(VEK, d.vek as string[])],
      [POPISKY.zdatnost, nazvyVoleb(ZDATNOST, d.zdatnost as string[])],
      ["Fotky", sklonuj(fotky.length, "fotka", "fotky", "fotek")],
      ["Zveřejněný kontakt", kontakty.join(", ")],
      ["Souhlasy", "Ano, potvrzeno"],
    ];

    const dl = document.createElement("dl");
    dl.className = "z-udaje zp-shrnuti";
    for (const [nazev, h] of radky) {
      const dt = document.createElement("dt");
      dt.textContent = nazev;
      const dd = document.createElement("dd");
      dd.textContent = h;
      dl.append(dt, dd);
    }
    misto.append(dl);

    if (fotky.length) {
      const ul = document.createElement("ul");
      ul.className = "zp-fotky zp-fotky-shrnuti";
      fotky.forEach((f, i) => {
        const li = document.createElement("li");
        li.className = "zp-fotka";
        const img = document.createElement("img");
        img.src = f.nahled;
        img.alt = `Fotka ${i + 1}`;
        li.append(img);
        ul.append(li);
      });
      misto.append(ul);
    }

    const popisNadpis = document.createElement("h3");
    popisNadpis.textContent = "Popis akce";
    misto.append(popisNadpis);
    const popis = document.createElement("div");
    popis.className = "zp-text";
    for (const odstavec of String(d.popis).split(/\n\s*\n/)) {
      const p = document.createElement("p");
      p.textContent = odstavec.trim();
      popis.append(p);
    }
    misto.append(popis);

    const poznamkaNadpis = document.createElement("h3");
    poznamkaNadpis.textContent = `${POPISKY.poznamka} (${POZNAMKA_JE_VEREJNA ? "veřejné" : "neveřejné"})`;
    misto.append(poznamkaNadpis);
    const poznamka = document.createElement("p");
    poznamka.className = "zp-text";
    poznamka.textContent = String(d.poznamka) || "Bez poznámky.";
    misto.append(poznamka);

    const vzkazNadpis = document.createElement("h3");
    vzkazNadpis.textContent = "Vzkaz organizátorům kampaně (neveřejné)";
    misto.append(vzkazNadpis);
    const vzkaz = document.createElement("p");
    vzkaz.className = "zp-text";
    vzkaz.textContent = String(d.vzkaz) || "Bez vzkazu.";
    misto.append(vzkaz);
  }

  // -------------------------------------------------------------------------
  // Odeslání
  // -------------------------------------------------------------------------
  function hotovo() {
    zahodRozepsany();
    formular.hidden = true;
    stav.innerHTML =
      '<p class="z-ok" tabindex="-1" id="z-hotovo">Hotovo! Zápis jsme poslali správci ke kontrole. ' +
      "Po schválení se objeví v Zásobníku.</p>" +
      (ukazka
        ? '<p><a class="z-tlacitko" href="">Projít ukázku znovu</a></p>'
        : "<p>Zápis můžete do schválení upravit přes stejný odkaz z e-mailu.</p>");
    el("z-hotovo").focus();
    stav.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function odesli() {
    if (ukazka) {
      hotovo();
      return;
    }
    tlacitkoDal.disabled = true;
    tlacitkoDal.textContent = "Odesíláme…";
    const { stav: kod, data } = await zavolej("uloz", token, { zapis: sesbirej() });
    tlacitkoDal.disabled = false;
    tlacitkoDal.textContent = "Odeslat ke schválení";

    if (kod === 200) {
      hotovo();
      return;
    }

    if (data.chyby) {
      const kroky = Object.keys(data.chyby).map((j) => KROK_POLE[j] ?? KROKU);
      ukazKrok(Math.min(...kroky));
      ukazChyby(data.chyby);
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
  let uloziste: ReturnType<typeof createClient>["storage"] | null = null;
  function ziskejUloziste() {
    uloziste ??= createClient(ADRESA, KLIC, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    }).storage;
    return uloziste;
  }

  function vykresliFotky() {
    seznamFotek.innerHTML = "";
    fotky.forEach((f, i) => {
      const li = document.createElement("li");
      li.className = "zp-fotka";
      const img = document.createElement("img");
      img.src = f.nahled;
      img.alt = i === 0 ? `Fotka ${i + 1}, bude na kartičce` : `Fotka ${i + 1}`;
      const smazat = document.createElement("button");
      smazat.type = "button";
      smazat.className = "z-tlacitko";
      smazat.textContent = "Odebrat";
      smazat.setAttribute("aria-label", `Odebrat fotku ${i + 1}`);
      smazat.addEventListener("click", () => {
        fotky.splice(i, 1);
        vykresliFotky();
        ulozRozepsany();
        zprava(stavFotek, "ok", "Hotovo. Fotku jsme odebrali.");
        vyberSouboru.focus();
      });
      li.append(img, smazat);
      seznamFotek.append(li);
    });
    seznamFotek.hidden = fotky.length === 0;
    el("z-fotky-pocet").textContent =
      `Nahráno ${fotky.length} z ${LIMITY.fotekMin}–${LIMITY.fotekMax} fotek.`;
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
      chyby.push(`Nahrát můžete nejvýš ${LIMITY.fotekMax} fotek. Přebývající jsme vynechali.`);
    }

    nahravaSe += vybrane.length;
    zprava(stavFotek, "info", vybrane.length === 1 ? "Nahráváme fotku…" : "Nahráváme fotky…");

    let pridano = 0;
    for (const soubor of vybrane) {
      try {
        const jpeg = await zmensi(soubor);
        if (jpeg.size > LIMITY.fotkaBajtuMax) {
          chyby.push(`Fotka ${soubor.name} je i po zmenšení moc velká. Vyberte prosím jinou.`);
          continue;
        }
        if (ukazka) {
          fotky.push({ cesta: `ukazka/${Date.now()}-${pridano}.jpg`, nahled: URL.createObjectURL(jpeg) });
          pridano++;
          vykresliFotky();
          continue;
        }
        const { stav: kod, data } = await zavolej("adresa-pro-fotku", token);
        if (kod !== 200) {
          chyby.push(data.chyba ?? "Fotku se nepodařilo nahrát. Zkuste to prosím znovu.");
          continue;
        }
        const { error } = await ziskejUloziste()
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
    smazChyby();
    stavFotek.innerHTML = "";
    if (pridano) {
      const ok = document.createElement("p");
      ok.className = "z-ok";
      ok.textContent = `Hotovo. Přidali jsme ${sklonuj(pridano, "fotku", "fotky", "fotek")}.`;
      stavFotek.append(ok);
    }
    for (const c of chyby) {
      const p = document.createElement("p");
      p.className = "z-chyba";
      p.textContent = c;
      stavFotek.append(p);
    }
  });

  // Až na konci: všechny proměnné výše už musí existovat (ukázka se
  // vyplní hned, bez čekání na server).
  void nacti();
}
