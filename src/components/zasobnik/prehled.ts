/**
 * Zásobník nápadů (/zasobnik/) — seznam, zaklikávací filtry a detail.
 *
 * FILTRY: ve skupině jde vybrat víc voleb (stačí shoda s jednou z nich),
 * mezi skupinami musí sedět všechny. Výběr je v adrese (?typ=pohyb&…),
 * takže se dá poslat odkazem a funguje tlačítko Zpět.
 *
 * Věk: nápad označený „Všechny věkové skupiny" nebo „Bez omezení" se
 * ukáže u jakékoli zvolené věkové skupiny.
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

interface Napad {
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
  { id: "narocnost", nazev: "Náročnost přípravy", volby: NAROCNOST, sedi: (n, k) => n.narocnost === k },
  {
    id: "vek",
    nazev: "Pro koho – věk",
    volby: VEK.filter((v) => !VSEM_VEKUM.has(v.klic)),
    sedi: (n, k) => n.vek.includes(k) || n.vek.some((v) => VSEM_VEKUM.has(v)),
  },
  { id: "zdatnost", nazev: "Pro koho – zdatnost", volby: ZDATNOST, sedi: (n, k) => n.zdatnost.includes(k) },
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

function pocetNapadu(n: number): string {
  if (n === 1) return "1 nápad";
  if (n >= 2 && n <= 4) return `${n} nápady`;
  return `${n} nápadů`;
}

function zkrat(t: string, max: number): string {
  const s = t.replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  return s.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

function datumCesky(iso: string | null): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return "";
  const [r, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d}. ${m}. ${r}`;
}

function nazevTypu(n: Napad): string {
  const typ = TYPY.find((t) => t.klic === n.typ)?.nazev ?? n.typ;
  const podtyp = n.podtyp === "jine" ? (n.podtyp_jine ?? "") : nazevPodtypu(n.typ, n.podtyp);
  return podtyp ? `${typ} – ${podtyp}` : typ;
}

function kdoPoradal(n: Napad): string {
  return n.nazev_poradatele || TYP_PORADATELE[n.typ_poradatele] || "";
}

// ---------------------------------------------------------------------------

export function spustPrehled() {
  const prehled = el("z-prehled");
  const detail = el("z-detail");
  const filtry = el("z-filtry");
  const pocet = el("z-pocet");
  const seznam = el("z-seznam");

  let napady: Napad[] = [];
  const vyber: Record<string, Set<string>> = Object.fromEntries(SKUPINY.map((s) => [s.id, new Set<string>()]));

  // --- Výběr v adrese ------------------------------------------------------
  function nactiZAdresy() {
    const q = new URLSearchParams(location.search);
    for (const s of SKUPINY) {
      vyber[s.id] = new Set(q.getAll(s.id).filter((k) => s.volby.some((v) => v.klic === k)));
    }
    return q.get("napad");
  }

  function zapisDoAdresy(napad: string | null, novyZaznam: boolean) {
    const q = new URLSearchParams();
    for (const s of SKUPINY) for (const k of vyber[s.id]) q.append(s.id, k);
    if (napad) q.set("napad", napad);
    const adresa = `${location.pathname}${q.toString() ? `?${q}` : ""}`;
    if (novyZaznam) history.pushState(null, "", adresa);
    else history.replaceState(null, "", adresa);
  }

  // --- Filtry --------------------------------------------------------------
  function vykresliFiltry() {
    filtry.innerHTML = "";
    for (const s of SKUPINY) {
      const zvolene = vyber[s.id];
      const skupina = vytvor("details", "z-skupina");
      skupina.open = s.id === "typ" || zvolene.size > 0;
      const souhrn = vytvor("summary");
      souhrn.append(vytvor("span", "", s.nazev));
      if (zvolene.size) {
        souhrn.append(
          vytvor("span", "z-stitek", s.volby.filter((v) => zvolene.has(v.klic)).map((v) => v.nazev).join(", ")),
        );
      }
      skupina.append(souhrn);

      const volby = vytvor("div", "z-volby");
      volby.setAttribute("role", "group");
      volby.setAttribute("aria-label", s.nazev);
      for (const v of s.volby) {
        const t = vytvor("button", "z-volba", v.nazev);
        t.type = "button";
        t.setAttribute("aria-pressed", String(zvolene.has(v.klic)));
        t.addEventListener("click", () => {
          if (zvolene.has(v.klic)) zvolene.delete(v.klic);
          else zvolene.add(v.klic);
          zapisDoAdresy(null, false);
          vykresliFiltry();
          vykresliSeznam(true);
          filtry.querySelector<HTMLElement>(
            `details:nth-child(${SKUPINY.indexOf(s) + 1}) button:nth-child(${s.volby.indexOf(v) + 1})`,
          )?.focus();
        });
        volby.append(t);
      }
      skupina.append(volby);
      filtry.append(skupina);
    }

    if (SKUPINY.some((s) => vyber[s.id].size)) {
      const zrusit = vytvor("button", "z-tlacitko", "Zrušit výběr");
      zrusit.type = "button";
      zrusit.addEventListener("click", () => {
        for (const s of SKUPINY) vyber[s.id].clear();
        zapisDoAdresy(null, false);
        vykresliFiltry();
        vykresliSeznam(true);
        filtry.querySelector<HTMLElement>("summary")?.focus();
      });
      const rada = vytvor("div", "z-rada");
      rada.style.marginTop = "0.25rem";
      rada.append(zrusit);
      filtry.append(rada);
    }
  }

  function vyfiltruj(): Napad[] {
    return napady.filter((n) =>
      SKUPINY.every((s) => {
        const z = vyber[s.id];
        return z.size === 0 || [...z].some((k) => s.sedi(n, k));
      }),
    );
  }

  // --- Seznam --------------------------------------------------------------
  function karta(n: Napad): HTMLLIElement {
    const li = vytvor("li", "z-karta");
    if (n.fotky[0]) {
      const img = vytvor("img", "z-karta-foto");
      img.src = n.fotky[0];
      img.alt = "";
      img.loading = "lazy";
      li.append(img);
    } else {
      li.append(vytvor("div", "z-karta-zastupce", TYPY.find((t) => t.klic === n.typ)?.nazev ?? ""));
    }
    const telo = vytvor("div", "z-karta-telo");
    telo.append(vytvor("h3", "", n.nazev_akce));
    const stitky = vytvor("p", "z-stitky");
    stitky.append(vytvor("span", "z-stitek", nazevTypu(n)));
    stitky.append(vytvor("span", "z-stitek z-stitek-merunka", nazevVolby(DELKA, n.delka)));
    telo.append(stitky);
    telo.append(vytvor("p", "", [n.mesto, n.kraj].filter(Boolean).join(", ")));
    const kdo = kdoPoradal(n);
    if (kdo) telo.append(vytvor("p", "z-tlumene", `Pořádá: ${kdo}`));
    telo.append(vytvor("p", "", zkrat(n.popis, 150)));
    const odkaz = vytvor("a", "z-tlacitko", "Ukázat celý nápad");
    odkaz.href = `?napad=${encodeURIComponent(n.id)}`;
    odkaz.setAttribute("aria-label", `Ukázat celý nápad: ${n.nazev_akce}`);
    odkaz.addEventListener("click", (u) => {
      u.preventDefault();
      zapisDoAdresy(n.id, true);
      ukazDetail(n.id);
    });
    telo.append(odkaz);
    li.append(telo);
    return li;
  }

  function vykresliSeznam(poZmene = false) {
    const nalez = vyfiltruj();
    const necoVybrano = SKUPINY.some((s) => vyber[s.id].size);
    seznam.innerHTML = "";

    if (!napady.length) {
      const p = vytvor("div", "z-info");
      p.append(vytvor("p", "", "Pořadatelé nám teď posílají své zápisy. První nápady tu budou brzy."));
      seznam.append(p);
      pocet.textContent = "";
      return;
    }

    if (!nalez.length) {
      const p = vytvor("div", "z-info");
      p.append(vytvor("p", "", "Takový nápad zatím nemáme. Zrušte prosím některou volbu nebo celý výběr."));
      seznam.append(p);
      pocet.textContent = necoVybrano ? "Nenašli jsme žádný nápad." : "";
      return;
    }

    pocet.textContent = necoVybrano
      ? `${poZmene ? "Hotovo. " : ""}Našli jsme ${pocetNapadu(nalez.length)}.`
      : `V Zásobníku je ${pocetNapadu(nalez.length)}.`;
    const ul = vytvor("ul", "z-mrizka");
    nalez.forEach((n) => ul.append(karta(n)));
    seznam.append(ul);
  }

  // --- Detail --------------------------------------------------------------
  async function ukazDetail(id: string) {
    prehled.hidden = true;
    detail.hidden = false;
    detail.innerHTML = '<p class="z-nacitani">Načítáme nápad…</p>';
    window.scrollTo({ top: 0 });

    let n: Napad | null = null;
    let chyba = "";
    try {
      const o = await fetch(`${FUNKCE}?id=${encodeURIComponent(id)}`, {
        headers: { apikey: KLIC, Authorization: `Bearer ${KLIC}` },
      });
      const data = await o.json();
      if (o.ok) n = data.napad as Napad;
      else chyba = data.chyba ?? "";
    } catch {
      chyba = "Nápad se nepodařilo načíst. Zkontrolujte připojení k internetu a zkuste to znovu.";
    }

    detail.innerHTML = "";
    const zpet = vytvor("a", "z-tlacitko", "Zpět na všechny nápady");
    zpet.href = location.pathname;
    zpet.addEventListener("click", (u) => {
      u.preventDefault();
      zapisDoAdresy(null, true);
      ukazPrehled();
    });

    if (!n) {
      detail.append(vytvor("p", "z-chyba", chyba || "Tenhle nápad jsme nenašli. Vraťte se prosím na přehled."));
      detail.append(zpet);
      detail.focus();
      return;
    }

    document.title = `${n.nazev_akce} — Zásobník nápadů | aktivně spolu`;
    detail.append(vytvor("p", "f-obor", "Zásobník nápadů"));
    detail.append(vytvor("h1", "z-nadpis", n.nazev_akce));

    const stitky = vytvor("p", "z-stitky");
    stitky.append(vytvor("span", "z-stitek", nazevTypu(n)));
    stitky.append(vytvor("span", "z-stitek z-stitek-merunka", "Z kampaně Aktivně spolu 2026"));
    detail.append(stitky);

    if (n.fotky.length) {
      const galerie = vytvor("div", "z-galerie");
      n.fotky.forEach((f, i) => {
        const img = vytvor("img");
        img.src = f;
        img.alt = `Fotka ${i + 1} z akce ${n!.nazev_akce}`;
        img.loading = i === 0 ? "eager" : "lazy";
        galerie.append(img);
      });
      detail.append(galerie);
    }

    detail.append(vytvor("h2", "", "Jak akce proběhla"));
    const popis = vytvor("div", "z-popis");
    popis.append(vytvor("p", "", n.popis));
    detail.append(popis);

    detail.append(vytvor("h2", "", "Co je dobré vědět"));
    const dl = vytvor("dl", "z-udaje");
    const radky: [string, string][] = [
      ["Typ", nazevTypu(n)],
      ["Náročnost přípravy", nazevVolby(NAROCNOST, n.narocnost)],
      ["Délka", nazevVolby(DELKA, n.delka)],
      [
        "Pomůcky",
        n.pomucky_potreba ? `Jsou potřeba${n.pomucky_jake ? `: ${n.pomucky_jake}` : ""}` : "Nejsou potřeba",
      ],
      ["Pro koho – věk", n.vek.map((v) => nazevVolby(VEK, v)).join(", ")],
      ["Pro koho – zdatnost", n.zdatnost.map((v) => nazevVolby(ZDATNOST, v)).join(", ")],
      ["Kde", [n.mesto, n.kraj].filter(Boolean).join(", ")],
      ["Kdy", datumCesky(n.datum_akce)],
      ["Pořadatel", kdoPoradal(n)],
    ];
    for (const [k, h] of radky) {
      if (!h) continue;
      dl.append(vytvor("dt", "", k), vytvor("dd", "", h));
    }
    detail.append(dl);

    if (n.kontakt.email || n.kontakt.telefon) {
      const k = vytvor("div", "z-kontakt");
      k.append(vytvor("h2", "", "Chcete se zeptat pořadatele?"));
      if (n.kontakt.email) {
        const p = vytvor("p", "", "E-mail: ");
        const a = vytvor("a", "", n.kontakt.email);
        a.href = `mailto:${n.kontakt.email}`;
        p.append(a);
        k.append(p);
      }
      if (n.kontakt.telefon) {
        const p = vytvor("p", "", "Telefon: ");
        const a = vytvor("a", "", n.kontakt.telefon);
        a.href = `tel:${n.kontakt.telefon.replace(/\s+/g, "")}`;
        p.append(a);
        k.append(p);
      }
      detail.append(k);
    }

    const rada = vytvor("div", "z-rada");
    rada.append(zpet);
    detail.append(rada);
    detail.focus();
  }

  function ukazPrehled() {
    document.title = "Zásobník nápadů — mezigenerační akce | aktivně spolu";
    detail.hidden = true;
    detail.innerHTML = "";
    prehled.hidden = false;
    vykresliFiltry();
    vykresliSeznam();
  }

  window.addEventListener("popstate", () => {
    const id = nactiZAdresy();
    if (id) void ukazDetail(id);
    else ukazPrehled();
  });

  // --- Start ---------------------------------------------------------------
  async function nacti() {
    if (!ADRESA || !KLIC) {
      seznam.innerHTML = '<p class="z-chyba">Zásobník teď nefunguje. Zkuste to prosím později.</p>';
      return;
    }
    try {
      const o = await fetch(FUNKCE, { headers: { apikey: KLIC, Authorization: `Bearer ${KLIC}` } });
      const data = await o.json();
      if (!o.ok) throw new Error(data.chyba ?? "");
      napady = data.napady as Napad[];
    } catch (e) {
      const veta = e instanceof Error && e.message
        ? e.message
        : "Nápady se nepodařilo načíst. Zkontrolujte připojení k internetu a obnovte stránku.";
      seznam.innerHTML = "";
      seznam.append(vytvor("p", "z-chyba", veta));
      return;
    }
    filtry.hidden = false;
    vykresliFiltry();
    vykresliSeznam();
  }

  const id = nactiZAdresy();
  void nacti();
  if (id) void ukazDetail(id);
}
