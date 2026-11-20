/**
 * Zásobník nápadů (/zasobnik/) — seznam, zaklikávací výběr a detail.
 *
 * Výběr (filtry):
 *   - 7 rozbalovacích skupin, na začátku otevřená jen „Typ akce",
 *   - ve skupině jde vybrat víc voleb (FILTR_VICE_VOLEB v číselníku),
 *     nápad se ukáže, když sedí aspoň jedna; druhé kliknutí volbu zruší,
 *   - mezi skupinami musí sedět všechny,
 *   - „Pro koho je akce vhodná": nápad pro „Všechny skupiny" se ukáže
 *     u jakékoli zvolené skupiny,
 *   - starší zápisy bez nového pole (místo konání, rozpočet) se při výběru
 *     v té skupině neukážou, v detailu mají „neuvedeno".
 * Výběr je v adrese (?typ=pohyb,kulturni&…), takže funguje tlačítko Zpět i odkaz.
 *
 * Detail je na stejné stránce: /zasobnik/?id=<id>. Web je statický, pro
 * každý nápad tedy nemůže existovat vlastní soubor. Starší odkazy
 * s ?napad=<id> fungují dál.
 *
 * NÁHLED PRO SPRÁVCE: /zasobnik/?nahled=<id> ukáže detail i kartu
 * nápadu v jakémkoli stavu, přesně jak budou vypadat po zveřejnění.
 * Data dá jen funkce `admin-obsah` přihlášenému správci (přihlášení
 * z /admin/ v tomtéž prohlížeči).
 *
 * UKÁZKA: v sestavení s PUBLIC_ZASOBNIK_UKAZKA=1 (náhled) se místo ostré
 * databáze načtou vymyšlené nápady ze src/lib/ukazkaNapadu.ts.
 */
import {
  DELKA,
  FILTR_VICE_VOLEB,
  MISTO_KONANI,
  POMUCKY,
  POPISKY,
  ROZPOCET,
  TYPY,
  VEK,
  VEK_VSECHNY,
  ZDATNOST,
  nazevVolby,
  nazvyVoleb,
  typSPodtypem as typSPodtypemZCiselniku,
  type Volba,
} from "../../lib/ciselnikNapadu";

const ADRESA = import.meta.env.PUBLIC_SUPABASE_URL ?? "";
const KLIC = import.meta.env.PUBLIC_SUPABASE_ANON_KEY ?? "";
const FUNKCE = `${ADRESA}/functions/v1/verejne-napady`;
const UKAZKA = import.meta.env.PUBLIC_ZASOBNIK_UKAZKA === "1";

/** Nápad tak, jak ho vrací funkce `verejne-napady` (jen veřejná pole). */
export interface VerejnyNapad {
  id: string;
  zverejneno: string | null;
  typ_poradatele: string;
  nazev_poradatele: string | null;
  mesto: string;
  kraj: string;
  nazev_akce: string;
  typ: string;
  podtyp: string;
  podtyp_jine: string | null;
  pomucky_potreba: boolean;
  pomucky_jake: string | null;
  vek: string[];
  zdatnost: string[];
  delka: string;
  /** Starší zápisy nemají (null). */
  misto_konani: string | null;
  rozpocet: string | null;
  /** Veřejná poznámka pořadatele, nebo null. */
  poznamka: string | null;
  popis: string;
  datum_akce: string | null;
  kontakt: { email: string | null; telefon: string | null };
  fotky: string[];
}
type Napad = VerejnyNapad;

interface Skupina {
  id: string;
  nazev: string;
  volby: Volba[];
  sedi: (n: Napad, klic: string) => boolean;
}

const SKUPINY: Skupina[] = [
  {
    id: "typ",
    nazev: POPISKY.typ,
    volby: TYPY.map((t) => ({ klic: t.klic, nazev: t.nazev })),
    sedi: (n, k) => n.typ === k,
  },
  {
    id: "vek",
    nazev: POPISKY.vek,
    volby: VEK,
    // Kdo hledá konkrétní skupinu, uvidí i nápady „pro všechny skupiny".
    sedi: (n, k) => n.vek.includes(k) || n.vek.includes(VEK_VSECHNY),
  },
  { id: "zdatnost", nazev: POPISKY.zdatnost, volby: ZDATNOST, sedi: (n, k) => n.zdatnost.includes(k) },
  { id: "delka", nazev: POPISKY.delka, volby: DELKA, sedi: (n, k) => n.delka === k },
  { id: "misto", nazev: POPISKY.misto_konani, volby: MISTO_KONANI, sedi: (n, k) => n.misto_konani === k },
  { id: "rozpocet", nazev: POPISKY.rozpocet, volby: ROZPOCET, sedi: (n, k) => n.rozpocet === k },
  {
    id: "pomucky",
    nazev: POPISKY.pomucky,
    volby: POMUCKY,
    sedi: (n, k) => (k === "ano") === n.pomucky_potreba,
  },
];

const TYP_PORADATELE: Record<string, string> = {
  skola: "Škola",
  organizace: "Organizace",
  jednotlivec: "Jednotlivec",
};

const NADPIS_PREHLEDU = "Zásobník nápadů";
const NADPIS_DETAILU = "Nápad na společnou akci";
// Doslova podle zadavatelky (e-mail 18. 11. 2026). Stejný text je
// i v src/pages/zasobnik/index.astro, kde se ukáže ještě před načtením skriptu.
const CO_DELAT_PREHLED =
  "Vyberte (vyfiltrujte si), jakou aktivitu hledáte. Najdeme vám ověřené nápady od pořadatelů z celé republiky.";
const CO_DELAT_DETAIL = "Přečtěte si, jak akce proběhla. Můžete uspořádat podobnou.";

// ---------------------------------------------------------------------------
// Pomocníci
// ---------------------------------------------------------------------------

function el(id: string): HTMLElement {
  const p = document.getElementById(id);
  if (!p) throw new Error(`Chybí #${id}`);
  return p;
}

function vytvor<K extends keyof HTMLElementTagNameMap>(
  znacka: K,
  trida = "",
  text = "",
): HTMLElementTagNameMap[K] {
  const p = document.createElement(znacka);
  if (trida) p.className = trida;
  if (text) p.textContent = text;
  return p;
}

export function pocetNapadu(n: number): string {
  if (n === 1) return "1 nápad";
  if (n >= 2 && n <= 4) return `${n} nápady`;
  return `${n} nápadů`;
}

/** Prvních `max` znaků, useknuto na celé slovo a zakončeno „…". */
function zkrat(t: string, max: number): string {
  const s = t.replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  return s.slice(0, max).replace(/\s+\S*$/, "").replace(/[,;:.\s]+$/, "") + "…";
}

/** Jen datum, bez času: 1. 10. 2026. */
function datumCesky(iso: string | null): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return "";
  const [r, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d}. ${m}. ${r}`;
}

function nazevTypu(typ: string): string {
  return TYPY.find((t) => t.klic === typ)?.nazev ?? typ;
}

function typSPodtypem(n: Napad): string {
  return typSPodtypemZCiselniku(n.typ, n.podtyp, n.podtyp_jine);
}

function kdoPoradal(n: Napad): string {
  return n.nazev_poradatele || TYP_PORADATELE[n.typ_poradatele] || "";
}

function seznamVoleb(volby: Volba[], klice: string[]): string {
  const s = nazvyVoleb(volby, klice);
  return s.charAt(0).toLocaleUpperCase("cs") + s.slice(1).toLocaleLowerCase("cs");
}

/** Hodnota s velkým počátečním písmenem („neuvedeno" → „Neuvedeno"). */
function velke(s: string): string {
  return s.charAt(0).toLocaleUpperCase("cs") + s.slice(1);
}

/** Ikona špendlíku před místem konání. Dekorace, čtečka ji přeskočí. */
function spendlik(): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "z-ikona");
  const p = document.createElementNS(ns, "path");
  p.setAttribute(
    "d",
    "M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z",
  );
  p.setAttribute("fill", "currentColor");
  svg.append(p);
  return svg;
}

/** Ukázková data mají jen jména souborů z /obrazky/. */
function adresaFotky(f: string): string {
  if (/^(https?:|data:|blob:|\/)/.test(f)) return f;
  return `${import.meta.env.BASE_URL.replace(/\/?$/, "/")}obrazky/${f}`;
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

async function nactiVsechny(): Promise<Napad[]> {
  if (UKAZKA) {
    const { UKAZKA_NAPADU } = await import("../../lib/ukazkaNapadu");
    return UKAZKA_NAPADU.map((n) => ({ ...n, fotky: n.fotky.slice(0, 1) }));
  }
  if (!ADRESA || !KLIC) throw new Error("Zásobník teď nefunguje. Zkuste to prosím později.");
  const o = await fetch(FUNKCE, { headers: { apikey: KLIC, Authorization: `Bearer ${KLIC}` } });
  const data = await o.json();
  if (!o.ok) throw new Error(data.chyba ?? "");
  return data.napady as Napad[];
}

/** `null` = nápad neexistuje (nebo není schválený). */
async function nactiJeden(id: string): Promise<Napad | null> {
  if (UKAZKA) {
    const { UKAZKA_NAPADU } = await import("../../lib/ukazkaNapadu");
    return UKAZKA_NAPADU.find((n) => n.id === id) ?? null;
  }
  const o = await fetch(`${FUNKCE}?id=${encodeURIComponent(id)}`, {
    headers: { apikey: KLIC, Authorization: `Bearer ${KLIC}` },
  });
  if (o.status === 404 || o.status === 400) return null;
  const data = await o.json();
  if (!o.ok) throw new Error(data.chyba ?? "");
  return data.napad as Napad;
}

/**
 * Náhled pro správce: nápad v jakémkoli stavu přes `admin-obsah`.
 * Přihlášení se vezme z /admin/ (stejný prohlížeč, stejná doména).
 * Klient Supabase se načte jen tady, běžný návštěvník ho nestahuje.
 */
async function nactiNahled(id: string): Promise<{ napad: Napad; stav: string }> {
  if (!ADRESA || !KLIC) throw new Error("Náhled teď nefunguje, web je sestavený bez přístupu k databázi.");
  const { createClient } = await import("@supabase/supabase-js");
  const klient = createClient(ADRESA, KLIC, {
    auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data } = await klient.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new Error("Náhled vidí jen přihlášený správce. Přihlaste se prosím v administraci a otevřete náhled znovu.");
  }
  const o = await fetch(`${ADRESA}/functions/v1/admin-obsah`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: KLIC, Authorization: `Bearer ${token}` },
    body: JSON.stringify({ akce: "nahled-napadu", id }),
  });
  const telo = await o.json().catch(() => ({}));
  if (!o.ok) throw new Error(telo.chyba ?? "Náhled se nepodařilo načíst. Zkuste to prosím znovu.");
  return telo as { napad: Napad; stav: string };
}

const STAV_PRO_NAHLED: Record<string, string> = {
  ceka: "čeká na kontrolu",
  vraceno: "je vrácený pořadateli k úpravě",
  zamitnuto: "je zamítnutý",
  schvaleno: "je schválený a na webu",
};

// ---------------------------------------------------------------------------

export function spustPrehled() {
  const nadpis = el("z-nadpis");
  const coDelat = el("z-co-delat");
  const prehled = el("z-prehled");
  const detail = el("z-detail");
  const vyberEl = el("z-vyber");
  const stav = el("z-stav");
  const seznam = el("z-seznam");

  let napady: Napad[] = [];
  let nacteno = false;
  // Vybrané volby v každé skupině. Prázdný seznam = skupina nic neomezuje.
  const vyber: Record<string, string[]> = Object.fromEntries(SKUPINY.map((s) => [s.id, [] as string[]]));
  const necoVybrano = () => SKUPINY.some((s) => vyber[s.id].length > 0);
  // Které skupiny má člověk otevřené. Na začátku jen „Typ akce".
  const otevrene: Record<string, boolean> = { typ: true };

  // --- Adresa --------------------------------------------------------------
  function nactiZAdresy(): string | null {
    const q = new URLSearchParams(location.search);
    for (const s of SKUPINY) {
      const klice = (q.get(s.id) ?? "").split(",").filter((k) => s.volby.some((v) => v.klic === k));
      vyber[s.id] = FILTR_VICE_VOLEB ? [...new Set(klice)] : klice.slice(0, 1);
    }
    return q.get("id") || q.get("napad");
  }

  function zapisDoAdresy(id: string | null, novyZaznam: boolean) {
    const q = new URLSearchParams();
    for (const s of SKUPINY) if (vyber[s.id].length) q.set(s.id, vyber[s.id].join(","));
    if (id) q.set("id", id);
    const adresa = `${location.pathname}${q.toString() ? `?${q}` : ""}`;
    if (novyZaznam) history.pushState(null, "", adresa);
    else history.replaceState(null, "", adresa);
  }

  function nastavHlavicku(naDetailu: boolean) {
    nadpis.textContent = naDetailu ? NADPIS_DETAILU : NADPIS_PREHLEDU;
    coDelat.textContent = naDetailu ? CO_DELAT_DETAIL : CO_DELAT_PREHLED;
  }

  // --- Výběr ---------------------------------------------------------------
  function vykresliVyber() {
    vyberEl.innerHTML = "";
    for (const s of SKUPINY) {
      const zvolene = vyber[s.id];
      const skupina = vytvor("details", "z-skupina");
      skupina.open = Boolean(otevrene[s.id] || zvolene.length);
      skupina.addEventListener("toggle", () => {
        otevrene[s.id] = skupina.open;
      });

      const souhrn = vytvor("summary");
      souhrn.append(vytvor("strong", "", s.nazev));
      for (const k of zvolene) souhrn.append(vytvor("span", "z-stitek", nazevVolby(s.volby, k)));
      skupina.append(souhrn);

      const volby = vytvor("div", "z-volby");
      volby.setAttribute("role", "group");
      volby.setAttribute("aria-label", s.nazev);
      for (const v of s.volby) {
        const t = vytvor("button", "z-volba", v.nazev);
        t.type = "button";
        t.dataset.skupina = s.id;
        t.dataset.volba = v.klic;
        t.setAttribute("aria-pressed", String(zvolene.includes(v.klic)));
        t.addEventListener("click", () => {
          const uz = vyber[s.id].includes(v.klic);
          if (FILTR_VICE_VOLEB) {
            vyber[s.id] = uz ? vyber[s.id].filter((k) => k !== v.klic) : [...vyber[s.id], v.klic];
          } else {
            vyber[s.id] = uz ? [] : [v.klic];
          }
          otevrene[s.id] = true;
          zapisDoAdresy(null, false);
          vykresliVyber();
          vykresliSeznam();
          // Fokus zůstane na tlačítku, na které člověk klikl.
          vyberEl
            .querySelector<HTMLElement>(`[data-skupina="${s.id}"][data-volba="${v.klic}"]`)
            ?.focus();
        });
        volby.append(t);
      }
      skupina.append(volby);
      vyberEl.append(skupina);
    }

    if (necoVybrano()) {
      const zrusit = vytvor("button", "z-tlacitko", "Zrušit výběr");
      zrusit.type = "button";
      zrusit.addEventListener("click", () => {
        for (const s of SKUPINY) vyber[s.id] = [];
        zapisDoAdresy(null, false);
        vykresliVyber();
        vykresliSeznam();
        vyberEl.querySelector<HTMLElement>("summary")?.focus();
      });
      const rada = vytvor("p", "z-rada");
      rada.append(zrusit);
      vyberEl.append(rada);
    }
  }

  function vyfiltruj(): Napad[] {
    return napady.filter((n) =>
      SKUPINY.every((s) => {
        const klice = vyber[s.id];
        return !klice.length || klice.some((k) => s.sedi(n, k));
      }),
    );
  }

  // --- Seznam --------------------------------------------------------------
  function karta(n: Napad, naKlik?: () => void): HTMLLIElement {
    const li = vytvor("li", "z-karta");
    if (n.fotky[0]) {
      const img = vytvor("img", "z-karta-foto");
      img.src = adresaFotky(n.fotky[0]);
      img.alt = `Fotografie z akce: ${n.nazev_akce}`;
      img.loading = "lazy";
      li.append(img);
    } else {
      // Bez fotky blok 16 : 9 v barvách značky s názvem typu akce.
      const z = vytvor("div", `z-karta-zastupce${n.typ === "pohyb" ? " z-karta-zastupce-tyrkys" : ""}`, nazevTypu(n.typ));
      z.setAttribute("aria-hidden", "true");
      li.append(z);
    }

    const telo = vytvor("div", "z-karta-telo");
    telo.append(vytvor("h3", "", n.nazev_akce));

    const stitky = vytvor("p", "z-stitky");
    stitky.append(vytvor("span", "z-stitek", typSPodtypem(n)));
    stitky.append(vytvor("span", "z-stitek", `${POPISKY.delka}: ${nazevVolby(DELKA, n.delka)}`));
    if (n.misto_konani) stitky.append(vytvor("span", "z-stitek", nazevVolby(MISTO_KONANI, n.misto_konani)));
    telo.append(stitky);

    const kde = [n.mesto, n.kraj].filter(Boolean).join(", ");
    if (kde) {
      const p = vytvor("p", "z-misto");
      p.append(spendlik(), document.createTextNode(kde));
      telo.append(p);
    }
    const kdo = kdoPoradal(n);
    if (kdo) telo.append(vytvor("p", "", `Pořádá: ${kdo}`));
    telo.append(vytvor("p", "", zkrat(n.popis, 160)));

    const odkaz = vytvor("a", "z-tlacitko z-male", "Ukázat celý nápad");
    odkaz.href = `?id=${encodeURIComponent(n.id)}`;
    odkaz.setAttribute("aria-label", `Ukázat celý nápad: ${n.nazev_akce}`);
    odkaz.addEventListener("click", (u) => {
      u.preventDefault();
      if (naKlik) {
        naKlik();
        return;
      }
      zapisDoAdresy(n.id, true);
      void ukazDetail(n.id);
    });
    telo.append(odkaz);
    li.append(telo);
    return li;
  }

  function vykresliSeznam() {
    const nalez = vyfiltruj();
    seznam.innerHTML = "";
    stav.innerHTML = "";

    if (!nalez.length) {
      const box = vytvor("div", "z-prazdne");
      box.append(vytvor("p", "z-tucne", "Takový nápad zatím nemáme."));
      box.append(
        vytvor(
          "p",
          "",
          napady.length
            ? "Zkuste zrušit některou volbu. Nebo klikněte na „Zrušit výběr“ a uvidíte všechny nápady."
            : "Pořadatelé nápady teprve posílají. Podívejte se sem prosím za pár dní.",
        ),
      );
      seznam.append(box);
      return;
    }

    if (necoVybrano()) {
      const ok = vytvor("p", "z-ok", `Hotovo! Našli jsme ${pocetNapadu(nalez.length)}.`);
      stav.append(ok);
    }

    const ul = vytvor("ul", "z-mrizka");
    nalez.forEach((n) => ul.append(karta(n)));
    seznam.append(ul);
  }

  // --- Detail --------------------------------------------------------------
  function tlacitkoZpet(): HTMLAnchorElement {
    const zpet = vytvor("a", "z-tlacitko", "Zpět do zásobníku");
    zpet.href = location.pathname;
    zpet.addEventListener("click", (u) => {
      u.preventDefault();
      zapisDoAdresy(null, true);
      ukazPrehled();
    });
    return zpet;
  }

  async function ukazDetail(id: string) {
    nastavHlavicku(true);
    prehled.hidden = true;
    detail.hidden = false;
    detail.innerHTML = '<p class="z-nacitani">Načítáme nápad…</p>';
    window.scrollTo({ top: 0 });

    let n: Napad | null = null;
    let chyba = "";
    try {
      n = await nactiJeden(id);
    } catch (e) {
      chyba =
        e instanceof Error && e.message
          ? e.message
          : "Nápad se nepodařilo načíst. Zkontrolujte připojení k internetu a zkuste to znovu.";
    }

    detail.innerHTML = "";
    if (n) {
      vykresliDetail(n);
      detail.append(radaSeZpet());
      document.title = `${n.nazev_akce} — Zásobník nápadů | aktivně spolu`;
      detail.focus();
      return;
    }
    {
      const box = vytvor("div", chyba ? "z-chyba" : "z-prazdne");
      if (chyba) box.append(vytvor("p", "", chyba));
      else {
        box.append(vytvor("p", "z-tucne", "Tento nápad jsme nenašli."));
        box.append(vytvor("p", "", "Možná už není v zásobníku. Vyberte si prosím jiný."));
      }
      detail.append(box);
      detail.append(radaSeZpet());
      detail.focus();
    }
  }

  function radaSeZpet(): HTMLElement {
    const r = vytvor("p", "z-rada");
    r.append(tlacitkoZpet());
    return r;
  }

  /** Obsah detailu nápadu (bez tlačítka Zpět). Stejný pro web i náhled správce. */
  function vykresliDetail(n: Napad) {
    // 1. Galerie všech fotek
    if (n.fotky.length) {
      const g = vytvor("div", "z-galerie");
      n.fotky.forEach((f, i) => {
        const img = vytvor("img");
        img.src = adresaFotky(f);
        img.alt = `Fotografie ${i + 1} z akce ${n!.nazev_akce}`;
        img.loading = "lazy";
        g.append(img);
      });
      detail.append(g);
    }

    // 2. Název a 3. štítek kampaně
    detail.append(vytvor("h3", "z-detail-nazev", n.nazev_akce));
    const kampan = vytvor("p");
    kampan.append(vytvor("span", "z-stitek", "Z kampaně Aktivně spolu 2026"));
    detail.append(kampan);

    // 4. Údaje
    const radky: [string, string][] = [
      [POPISKY.typ, typSPodtypem(n)],
      [POPISKY.vek, seznamVoleb(VEK, n.vek)],
      [POPISKY.zdatnost, seznamVoleb(ZDATNOST, n.zdatnost)],
      [POPISKY.delka, velke(nazevVolby(DELKA, n.delka))],
      [POPISKY.misto_konani, velke(nazevVolby(MISTO_KONANI, n.misto_konani))],
      [POPISKY.rozpocet, velke(nazevVolby(ROZPOCET, n.rozpocet))],
      [
        POPISKY.pomucky,
        n.pomucky_potreba
          ? `${nazevVolby(POMUCKY, "ano")}${n.pomucky_jake ? `: ${n.pomucky_jake}` : ""}`
          : nazevVolby(POMUCKY, "ne"),
      ],
      ["Kde", [n.mesto, n.kraj].filter(Boolean).join(", ")],
      ["Kdy proběhlo", datumCesky(n.datum_akce)],
      ["Pořadatel", kdoPoradal(n)],
    ];
    const dl = vytvor("dl", "z-udaje");
    for (const [k, v] of radky) {
      if (!v) continue;
      dl.append(vytvor("dt", "", k), vytvor("dd", "", v));
    }
    detail.append(dl);

    // 5. Kontakt — jen ten, ke kterému dal pořadatel souhlas (filtruje už
    //    funkce `verejne-napady`; tady se jen nezobrazí prázdný).
    if (n.kontakt.email || n.kontakt.telefon) {
      const k = vytvor("div", "z-kontakt");
      k.append(vytvor("h4", "", "Kontakt na pořadatele"));
      if (n.kontakt.telefon) {
        const p = vytvor("p", "", "Telefon: ");
        const a = vytvor("a", "", n.kontakt.telefon);
        a.href = `tel:${n.kontakt.telefon.replace(/\s+/g, "")}`;
        p.append(a);
        k.append(p);
      }
      if (n.kontakt.email) {
        const p = vytvor("p", "", "E-mail: ");
        const a = vytvor("a", "", n.kontakt.email);
        a.href = `mailto:${n.kontakt.email}`;
        p.append(a);
        k.append(p);
      }
      detail.append(k);
    }

    // 6. Jak akce proběhla. Vzkaz organizátorům se tu NIKDY neukazuje
    //    (veřejná funkce ho ani nevrací).
    detail.append(vytvor("h4", "", "Jak akce proběhla"));
    const popis = vytvor("div", "z-popis");
    for (const odstavec of n.popis.split(/\n\s*\n/)) {
      if (odstavec.trim()) popis.append(vytvor("p", "", odstavec.trim()));
    }
    detail.append(popis);

    // 7. Veřejná poznámka pořadatele (jen když ji funkce vydala).
    if (n.poznamka) {
      detail.append(vytvor("h4", "", POPISKY.poznamka));
      const p = vytvor("div", "z-popis");
      p.append(vytvor("p", "", n.poznamka));
      detail.append(p);
    }
  }

  // --- Náhled pro správce ---------------------------------------------------
  async function ukazNahled(id: string) {
    nadpis.textContent = NADPIS_DETAILU;
    coDelat.textContent = "Náhled pro správce: takhle bude nápad vypadat v Zásobníku.";
    prehled.hidden = true;
    detail.hidden = false;
    detail.innerHTML = '<p class="z-nacitani">Načítáme náhled…</p>';
    try {
      const { napad, stav: stavZapisu } = await nactiNahled(id);
      detail.innerHTML = "";
      const pruh = vytvor(
        "p",
        stavZapisu === "schvaleno" ? "z-ok" : "z-info",
        stavZapisu === "schvaleno"
          ? "Náhled: zápis je schválený, takhle ho vidí návštěvníci."
          : `Náhled: zápis ${STAV_PRO_NAHLED[stavZapisu] ?? stavZapisu}. Návštěvníci ho zatím nevidí.`,
      );
      detail.append(pruh);
      detail.append(vytvor("h2", "", "Kartička v přehledu"));
      const ul = vytvor("ul", "z-mrizka");
      ul.append(karta({ ...napad, fotky: napad.fotky.slice(0, 1) }, () => detail.querySelector("h3.z-detail-nazev")?.scrollIntoView({ behavior: "smooth" })));
      detail.append(ul);
      detail.append(vytvor("h2", "", "Celý nápad"));
      vykresliDetail(napad);
      document.title = `Náhled: ${napad.nazev_akce} — Zásobník nápadů`;
    } catch (e) {
      detail.innerHTML = "";
      detail.append(
        vytvor("p", "z-chyba", e instanceof Error && e.message ? e.message : "Náhled se nepodařilo načíst."),
      );
    }
    detail.focus();
  }

  function ukazPrehled() {
    nastavHlavicku(false);
    document.title = "Zásobník nápadů — mezigenerační akce | aktivně spolu";
    detail.hidden = true;
    detail.innerHTML = "";
    prehled.hidden = false;
    if (nacteno) {
      vykresliVyber();
      vykresliSeznam();
    }
  }

  window.addEventListener("popstate", () => {
    const id = nactiZAdresy();
    if (id) void ukazDetail(id);
    else ukazPrehled();
  });

  // --- Start ---------------------------------------------------------------
  async function nacti() {
    try {
      napady = await nactiVsechny();
    } catch (e) {
      const veta =
        e instanceof Error && e.message
          ? e.message
          : "Nápady se nepodařilo načíst. Zkontrolujte připojení k internetu a obnovte stránku.";
      seznam.innerHTML = "";
      seznam.append(vytvor("p", "z-chyba", veta));
      return;
    }
    nacteno = true;
    vyberEl.hidden = false;
    vykresliVyber();
    vykresliSeznam();
  }

  const nahled = new URLSearchParams(location.search).get("nahled");
  if (nahled) {
    void ukazNahled(nahled);
    return;
  }

  const id = nactiZAdresy();
  void nacti();
  if (id) void ukazDetail(id);
  else nastavHlavicku(false);
}
