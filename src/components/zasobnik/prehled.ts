/**
 * Zásobník nápadů (/zasobnik/) — seznam, zaklikávací výběr a detail.
 *
 * Chová se jako ukázka, kterou viděla zadavatelka:
 *   - 6 rozbalovacích skupin, na začátku otevřená jen „Typ akce",
 *   - ve skupině jde vybrat JEDNA volba, druhé kliknutí ji zruší,
 *   - mezi skupinami musí sedět všechny vybrané volby,
 *   - věk: nápad pro „všechny věkové skupiny" nebo „bez omezení" se ukáže
 *     u jakékoli zvolené věkové skupiny.
 * Výběr je v adrese (?typ=pohyb&…), takže funguje tlačítko Zpět i odkaz.
 *
 * Detail je na stejné stránce: /zasobnik/?id=<id>. Web je statický, pro
 * každý nápad tedy nemůže existovat vlastní soubor. Starší odkazy
 * s ?napad=<id> fungují dál.
 *
 * UKÁZKA: v sestavení s PUBLIC_ZASOBNIK_UKAZKA=1 (náhled) se místo ostré
 * databáze načtou vymyšlené nápady ze src/lib/ukazkaNapadu.ts.
 */
import {
  DELKA,
  NAROCNOST,
  TYPY,
  VEK,
  ZDATNOST,
  nazevPodtypu,
  nazevVolby,
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
  narocnost: string;
  pomucky_potreba: boolean;
  pomucky_jake: string | null;
  vek: string[];
  zdatnost: string[];
  delka: string;
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

const VSEM_VEKUM = new Set(["vsechny", "bez-omezeni"]);

const SKUPINY: Skupina[] = [
  {
    id: "typ",
    nazev: "Typ akce",
    volby: TYPY.map((t) => ({ klic: t.klic, nazev: t.nazev })),
    sedi: (n, k) => n.typ === k,
  },
  { id: "narocnost", nazev: "Náročnost", volby: NAROCNOST, sedi: (n, k) => n.narocnost === k },
  {
    id: "vek",
    nazev: "Pro koho – věk",
    volby: VEK,
    // Kdo hledá konkrétní skupinu, uvidí i nápady „pro všechny".
    sedi: (n, k) => n.vek.includes(k) || n.vek.some((v) => VSEM_VEKUM.has(v)),
  },
  { id: "zdatnost", nazev: "Zdatnost", volby: ZDATNOST, sedi: (n, k) => n.zdatnost.includes(k) },
  { id: "delka", nazev: "Délka", volby: DELKA, sedi: (n, k) => n.delka === k },
  {
    id: "pomucky",
    nazev: "Pomůcky",
    volby: [
      { klic: "ne", nazev: "Nejsou potřeba" },
      { klic: "ano", nazev: "Jsou potřeba" },
    ],
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
const CO_DELAT_PREHLED =
  "Vyberte, jakou aktivitu hledáte. Ukážeme ověřené nápady od pořadatelů z celé republiky.";
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
  const podtyp = n.podtyp === "jine" ? (n.podtyp_jine ?? "") : nazevPodtypu(n.typ, n.podtyp);
  return podtyp ? `${nazevTypu(n.typ)} – ${podtyp.toLocaleLowerCase("cs")}` : nazevTypu(n.typ);
}

function kdoPoradal(n: Napad): string {
  return n.nazev_poradatele || TYP_PORADATELE[n.typ_poradatele] || "";
}

function seznamVoleb(volby: Volba[], klice: string[]): string {
  const s = klice.map((k) => nazevVolby(volby, k)).join(", ");
  return s.charAt(0).toLocaleUpperCase("cs") + s.slice(1).toLocaleLowerCase("cs");
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
  const vyber: Record<string, string | null> = Object.fromEntries(SKUPINY.map((s) => [s.id, null]));
  // Které skupiny má člověk otevřené. Na začátku jen „Typ akce".
  const otevrene: Record<string, boolean> = { typ: true };

  // --- Adresa --------------------------------------------------------------
  function nactiZAdresy(): string | null {
    const q = new URLSearchParams(location.search);
    for (const s of SKUPINY) {
      const k = q.get(s.id);
      vyber[s.id] = k && s.volby.some((v) => v.klic === k) ? k : null;
    }
    return q.get("id") || q.get("napad");
  }

  function zapisDoAdresy(id: string | null, novyZaznam: boolean) {
    const q = new URLSearchParams();
    for (const s of SKUPINY) if (vyber[s.id]) q.set(s.id, vyber[s.id]!);
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
      const zvolena = vyber[s.id];
      const skupina = vytvor("details", "z-skupina");
      skupina.open = Boolean(otevrene[s.id] || zvolena);
      skupina.addEventListener("toggle", () => {
        otevrene[s.id] = skupina.open;
      });

      const souhrn = vytvor("summary");
      souhrn.append(vytvor("strong", "", s.nazev));
      if (zvolena) souhrn.append(vytvor("span", "z-stitek", nazevVolby(s.volby, zvolena)));
      skupina.append(souhrn);

      const volby = vytvor("div", "z-volby");
      volby.setAttribute("role", "group");
      volby.setAttribute("aria-label", s.nazev);
      for (const v of s.volby) {
        const t = vytvor("button", "z-volba", v.nazev);
        t.type = "button";
        t.dataset.skupina = s.id;
        t.dataset.volba = v.klic;
        t.setAttribute("aria-pressed", String(zvolena === v.klic));
        t.addEventListener("click", () => {
          vyber[s.id] = vyber[s.id] === v.klic ? null : v.klic;
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

    if (SKUPINY.some((s) => vyber[s.id])) {
      const zrusit = vytvor("button", "z-tlacitko", "Zrušit výběr");
      zrusit.type = "button";
      zrusit.addEventListener("click", () => {
        for (const s of SKUPINY) vyber[s.id] = null;
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
        const k = vyber[s.id];
        return !k || s.sedi(n, k);
      }),
    );
  }

  // --- Seznam --------------------------------------------------------------
  function karta(n: Napad): HTMLLIElement {
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
    stitky.append(vytvor("span", "z-stitek", nazevVolby(NAROCNOST, n.narocnost)));
    stitky.append(vytvor("span", "z-stitek", nazevVolby(DELKA, n.delka)));
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
      zapisDoAdresy(n.id, true);
      void ukazDetail(n.id);
    });
    telo.append(odkaz);
    li.append(telo);
    return li;
  }

  function vykresliSeznam() {
    const nalez = vyfiltruj();
    const necoVybrano = SKUPINY.some((s) => vyber[s.id]);
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

    if (necoVybrano) {
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
    if (!n) {
      const box = vytvor("div", chyba ? "z-chyba" : "z-prazdne");
      if (chyba) box.append(vytvor("p", "", chyba));
      else {
        box.append(vytvor("p", "z-tucne", "Tento nápad jsme nenašli."));
        box.append(vytvor("p", "", "Možná už není v zásobníku. Vyberte si prosím jiný."));
      }
      detail.append(box);
      const r = vytvor("p", "z-rada");
      r.append(tlacitkoZpet());
      detail.append(r);
      detail.focus();
      return;
    }

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
      ["Typ", typSPodtypem(n)],
      ["Náročnost", nazevVolby(NAROCNOST, n.narocnost)],
      ["Pomůcky", n.pomucky_potreba ? `Jsou potřeba${n.pomucky_jake ? `: ${n.pomucky_jake}` : ""}` : "Nejsou potřeba"],
      ["Pro koho – věk", seznamVoleb(VEK, n.vek)],
      ["Zdatnost", seznamVoleb(ZDATNOST, n.zdatnost)],
      ["Délka", nazevVolby(DELKA, n.delka)],
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

    // 7. Zpět
    const r = vytvor("p", "z-rada");
    r.append(tlacitkoZpet());
    detail.append(r);

    document.title = `${n.nazev_akce} — Zásobník nápadů | aktivně spolu`;
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

  const id = nactiZAdresy();
  void nacti();
  if (id) void ukazDetail(id);
  else nastavHlavicku(false);
}
