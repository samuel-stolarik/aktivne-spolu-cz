/**
 * Záložka „Zásobník nápadů" v administraci.
 *
 * Dvě části:
 *   1. Zápisy ke kontrole: celý zápis s fotkami, vzkazem a souhlasy;
 *      tlačítka Schválit / Vrátit k úpravě / Zamítnout.
 *   2. Výzvy pořadatelům: přehled přihlášek, zkušební e-mail na vlastní
 *      adresu a hromadné odeslání výzev po dávkách.
 *
 * Žádné confirm(): u hromadného odeslání a zamítnutí se potvrzuje
 * tlačítkem přímo na místě. Výsledek se vždy ukáže větou u tlačítka.
 */
import { zavolej } from "./klient";
import { sHlasenim, ukazStav } from "./stav";
import {
  DELKA,
  NAROCNOST,
  TYPY,
  VEK,
  VEREJNY_KONTAKT,
  ZDATNOST,
  nazevPodtypu,
  nazevVolby,
} from "../../lib/ciselnikNapadu";

/** Kolik výzev jde na server v jednom požadavku. Musí sedět se serverem. */
const DAVKA = 20;

interface Fotka {
  cesta: string;
  adresa: string;
}

interface Zapis {
  id: string;
  vytvoreno: string;
  upraveno: string;
  prihlaska_id: string;
  typ_poradatele: string;
  nazev_poradatele: string;
  kontaktni_osoba: string;
  email: string;
  telefon: string | null;
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
  fotky: Fotka[];
  vzkaz: string | null;
  verejny_kontakt: string[];
  souhlas_zneni: string;
  stav: "ceka" | "schvaleno" | "vraceno" | "zamitnuto";
  duvod: string | null;
  rozhodl: string | null;
  rozhodnuto_kdy: string | null;
}

interface PrihlaskaSVyzvou {
  id: string;
  nazev_poradatele: string;
  kontaktni_osoba: string;
  email: string;
  mesto: string;
  kraj: string;
  stav: string;
  vyzva: {
    odeslano_kdy: string;
    platnost_do: string;
    prijemce: string;
    stav_posty: string | null;
    pocet: number;
  } | null;
  otevreno: boolean;
  zapis: string | null;
}

const STAV_ZAPISU: Record<string, string> = {
  ceka: "Čeká na kontrolu",
  vraceno: "Vrácený k úpravě",
  schvaleno: "Schválený, na webu",
  zamitnuto: "Zamítnutý",
};

const STAV_PLATBY: Record<string, string> = {
  nova: "Nová",
  zaplaceno: "Zaplaceno",
  zruseno: "Zrušeno",
};

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
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

function datum(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return d.toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric", year: "numeric" });
}

function datumCas(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("cs-CZ", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ===========================================================================
// FRONTA ZÁPISŮ
// ===========================================================================

let zapisy: Zapis[] = [];

export async function nactiZapisy(): Promise<void> {
  const vysledek = await sHlasenim(
    el("hlaska-zapisy"),
    { probiha: "Načítám zápisy…", hotovo: "Zápisy jsou načtené." },
    () => zavolej<{ napady: Zapis[] }>("napady"),
    { tlacitko: el<HTMLButtonElement>("tlacitko-nacist-zapisy"), zopakovat: () => void nactiZapisy() },
  );
  if (!vysledek) return;
  zapisy = vysledek.napady;
  ukazStav(el("hlaska-zapisy"), "nic");
  vykresliZapisy();
}

function vykresliZapisy(): void {
  const filtr = el<HTMLSelectElement>("filtr-zapisu").value;
  const seznam = el("seznam-zapisu");
  const vybrane = zapisy.filter((z) => filtr === "vse" || z.stav === filtr);
  const cekaji = zapisy.filter((z) => z.stav === "ceka").length;

  el("pocet-zapisu").textContent =
    `Zobrazeno ${vybrane.length} z ${zapisy.length}. Na kontrolu čeká ${cekaji}.`;

  seznam.innerHTML = "";
  if (!vybrane.length) {
    seznam.append(vytvor("p", "admin-karta text-popisek", "Tady teď nic není."));
    return;
  }
  for (const z of vybrane) seznam.append(kartaZapisu(z));
}

function radekUdaju(dl: HTMLDListElement, nazev: string, hodnota: string): void {
  if (!hodnota) return;
  dl.append(vytvor("dt", "font-semibold", nazev), vytvor("dd", "m-0 mb-2", hodnota));
}

function kartaZapisu(z: Zapis): HTMLElement {
  const karta = vytvor("details", "admin-karta");
  karta.dataset.id = z.id;
  karta.open = z.stav === "ceka";

  const souhrn = vytvor("summary", "cursor-pointer");
  souhrn.append(vytvor("strong", "text-lg text-tyrkys", z.nazev_akce));
  souhrn.append(document.createTextNode(` · ${z.nazev_poradatele} · ${z.mesto} · `));
  souhrn.append(vytvor("span", `admin-stitek admin-stitek-${z.stav}`, STAV_ZAPISU[z.stav] ?? z.stav));
  souhrn.append(vytvor("span", "text-popisek", ` · přišlo ${datumCas(z.upraveno)}`));
  karta.append(souhrn);

  const telo = vytvor("div", "mt-4");

  if (z.stav !== "ceka" && z.rozhodl) {
    telo.append(
      vytvor(
        "p",
        "text-popisek",
        `${STAV_ZAPISU[z.stav]}: ${z.rozhodl}, ${datumCas(z.rozhodnuto_kdy)}.` +
          (z.duvod ? ` Důvod: ${z.duvod}` : ""),
      ),
    );
  }

  if (z.vzkaz) {
    const vzkaz = vytvor("div", "admin-vzkaz");
    vzkaz.append(vytvor("strong", "", "Vzkaz pro vás (neveřejný): "), document.createTextNode(z.vzkaz));
    telo.append(vzkaz);
  }

  // Fotky
  const galerie = vytvor("div", "admin-galerie");
  z.fotky.forEach((f, i) => {
    const odkaz = vytvor("a");
    odkaz.href = f.adresa;
    odkaz.target = "_blank";
    odkaz.rel = "noopener";
    const img = vytvor("img");
    img.src = f.adresa;
    img.alt = `Fotka ${i + 1}${i === 0 ? ", titulní" : ""}. Otevře se ve velkém.`;
    img.loading = "lazy";
    odkaz.append(img);
    galerie.append(odkaz);
  });
  telo.append(galerie);

  // Popis
  telo.append(vytvor("h3", "mt-4 mb-1 text-base", "Popis akce"));
  telo.append(vytvor("p", "admin-popis-zapisu", z.popis));

  // Údaje
  const typ = TYPY.find((t) => t.klic === z.typ)?.nazev ?? z.typ;
  const podtyp = z.podtyp === "jine" ? `Jiné: ${z.podtyp_jine ?? ""}` : nazevPodtypu(z.typ, z.podtyp);
  const dl = vytvor("dl", "admin-udaje text-popisek");
  radekUdaju(dl, "Typ", `${typ} – ${podtyp}`);
  radekUdaju(dl, "Náročnost", nazevVolby(NAROCNOST, z.narocnost));
  radekUdaju(dl, "Délka", nazevVolby(DELKA, z.delka));
  radekUdaju(
    dl,
    "Pomůcky",
    z.pomucky_potreba ? `Jsou potřeba${z.pomucky_jake ? `: ${z.pomucky_jake}` : ""}` : "Nejsou potřeba",
  );
  radekUdaju(dl, "Věk", z.vek.map((v) => nazevVolby(VEK, v)).join(", "));
  radekUdaju(dl, "Zdatnost", z.zdatnost.map((v) => nazevVolby(ZDATNOST, v)).join(", "));
  radekUdaju(dl, "Datum akce", datum(z.datum_akce) || "neuvedeno");
  radekUdaju(dl, "Pořadatel", `${z.nazev_poradatele}, ${z.mesto}, ${z.kraj}`);
  radekUdaju(dl, "Kontaktní osoba", `${z.kontaktni_osoba}, ${z.email}${z.telefon ? `, ${z.telefon}` : ""}`);
  radekUdaju(
    dl,
    "Zveřejnit kontakt",
    z.verejny_kontakt
      .map((k) => `${nazevVolby(VEREJNY_KONTAKT, k)} (${k === "email" ? z.email : z.telefon})`)
      .join(", "),
  );
  radekUdaju(dl, "Souhlasy", z.souhlas_zneni);
  telo.append(dl);

  telo.append(ovladaniRozhodnuti(z));
  karta.append(telo);
  return karta;
}

function ovladaniRozhodnuti(z: Zapis): HTMLElement {
  const obal = vytvor("div", "mt-5 border-t border-merunka-tlumena pt-4");
  const hlaska = vytvor("p", "admin-hlaska mb-3");
  const rada = vytvor("div", "flex flex-wrap gap-3");

  const pole = vytvor("textarea", "admin-pole mt-2");
  pole.rows = 3;
  pole.maxLength = 1000;
  pole.id = `duvod-${z.id}`;
  const popisek = vytvor("label", "admin-popisek mt-3", "Důvod pro pořadatele (u vrácení povinný)");
  popisek.htmlFor = pole.id;
  if (z.duvod) pole.value = z.duvod;

  async function rozhodni(rozhodnuti: "schvalit" | "vratit" | "zamitnout", tlacitko: HTMLButtonElement) {
    const duvod = pole.value.trim();
    if (rozhodnuti === "vratit" && !duvod) {
      ukazStav(hlaska, "chyba", "Napište prosím do pole níž, co má pořadatel upravit.");
      pole.focus();
      return;
    }
    const hotovo = {
      schvalit: "Hotovo. Zápis je schválený a je vidět v Zásobníku na webu.",
      vratit: "Hotovo. Zápis je vrácený a pořadatel dostane e-mail s důvodem a novým odkazem.",
      zamitnout: "Hotovo. Zápis je zamítnutý a na webu se neukáže.",
    }[rozhodnuti];

    const v = await sHlasenim(
      hlaska,
      { probiha: "Ukládám rozhodnutí…", hotovo },
      () =>
        zavolej<{ stav: Zapis["stav"]; email: { odeslano: boolean; pres: string } | null }>("rozhodni-napad", {
          id: z.id,
          rozhodnuti,
          duvod,
        }),
      { tlacitko },
    );
    if (!v) return;

    z.stav = v.stav;
    z.duvod = rozhodnuti === "schvalit" ? null : duvod || null;
    z.rozhodnuto_kdy = new Date().toISOString();
    if (v.email && !v.email.odeslano) {
      ukazStav(
        hlaska,
        "hotovo",
        `${hotovo} E-mail pořadateli zatím čeká ve frontě odchozí pošty.`,
      );
    }
    // Souhrn karty se přepíše, karta zůstane otevřená s hláškou.
    const stitek = obal.closest("details")?.querySelector(".admin-stitek");
    if (stitek) {
      stitek.className = `admin-stitek admin-stitek-${z.stav}`;
      stitek.textContent = STAV_ZAPISU[z.stav];
    }
  }

  const schvalit = vytvor("button", "admin-tlacitko", "Schválit a zveřejnit");
  schvalit.type = "button";
  schvalit.addEventListener("click", () => void rozhodni("schvalit", schvalit));

  const vratit = vytvor("button", "admin-tlacitko-vedlejsi", "Vrátit k úpravě");
  vratit.type = "button";
  vratit.addEventListener("click", () => void rozhodni("vratit", vratit));

  // Zamítnutí je nevratné vůči pořadateli (formulář se mu zavře), proto
  // se potvrzuje druhým tlačítkem přímo na místě.
  const zamitnout = vytvor("button", "admin-tlacitko-vedlejsi", "Zamítnout");
  zamitnout.type = "button";
  const potvrdit = vytvor("button", "admin-tlacitko-vedlejsi admin-nebezpeci", "Ano, zamítnout");
  potvrdit.type = "button";
  potvrdit.hidden = true;
  const zpet = vytvor("button", "admin-tlacitko-vedlejsi", "Nezamítat");
  zpet.type = "button";
  zpet.hidden = true;
  zamitnout.addEventListener("click", () => {
    zamitnout.hidden = true;
    potvrdit.hidden = false;
    zpet.hidden = false;
    ukazStav(hlaska, "rozepsano", "Opravdu zamítnout? Pořadatel pak zápis nebude moct upravit.");
    potvrdit.focus();
  });
  zpet.addEventListener("click", () => {
    zamitnout.hidden = false;
    potvrdit.hidden = true;
    zpet.hidden = true;
    ukazStav(hlaska, "nic");
    zamitnout.focus();
  });
  potvrdit.addEventListener("click", async () => {
    await rozhodni("zamitnout", potvrdit);
    zamitnout.hidden = false;
    potvrdit.hidden = true;
    zpet.hidden = true;
  });

  if (z.stav !== "schvaleno") rada.append(schvalit);
  rada.append(vratit, zamitnout, potvrdit, zpet);
  obal.append(hlaska, rada, popisek, pole);
  return obal;
}

// ===========================================================================
// VÝZVY
// ===========================================================================

let prihlasky: PrihlaskaSVyzvou[] = [];
const vybrane = new Set<string>();

export async function nactiVyzvy(): Promise<void> {
  const vysledek = await sHlasenim(
    el("hlaska-vyzvy"),
    { probiha: "Načítám přihlášky…", hotovo: "Přihlášky jsou načtené." },
    () => zavolej<{ prihlasky: PrihlaskaSVyzvou[] }>("vyzvy"),
    { tlacitko: el<HTMLButtonElement>("tlacitko-nacist-vyzvy"), zopakovat: () => void nactiVyzvy() },
  );
  if (!vysledek) return;
  prihlasky = vysledek.prihlasky;
  ukazStav(el("hlaska-vyzvy"), "nic");
  vykresliVyzvy();
}

function zobrazene(): PrihlaskaSVyzvou[] {
  const f = el<HTMLSelectElement>("filtr-vyzev").value;
  const s = el<HTMLSelectElement>("filtr-vyzev-stav").value;
  return prihlasky.filter((p) => {
    if (s === "nezrusene" && p.stav === "zruseno") return false;
    if (s === "zaplaceno" && p.stav !== "zaplaceno") return false;
    if (f === "bez-vyzvy") return !p.vyzva && !p.zapis;
    if (f === "bez-zapisu") return Boolean(p.vyzva) && !p.zapis;
    return true;
  });
}

function popisVyzvy(p: PrihlaskaSVyzvou): string {
  if (!p.vyzva) return "Neposlána";
  const posta = p.vyzva.stav_posty === "odeslano"
    ? "odešla"
    : p.vyzva.stav_posty === "chyba"
    ? "NEODEŠLA"
    : "čeká ve frontě";
  const kolik = p.vyzva.pocet > 1 ? ` (${p.vyzva.pocet}×)` : "";
  return `${datum(p.vyzva.odeslano_kdy)}${kolik}, ${posta}${p.otevreno ? ", odkaz otevřen" : ""}`;
}

function vykresliVyzvy(): void {
  const telo = el("telo-vyzev");
  const seznam = zobrazene();
  telo.innerHTML = "";

  // Vybrané, které teď nejsou vidět, se z výběru vyřadí. Jinak by se
  // poslalo i to, co člověk na obrazovce nevidí.
  const viditelne = new Set(seznam.map((p) => p.id));
  for (const id of [...vybrane]) if (!viditelne.has(id)) vybrane.delete(id);

  el("pocet-vyzev").textContent = `Zobrazeno ${seznam.length} z ${prihlasky.length} přihlášek.`;

  for (const p of seznam) {
    const tr = vytvor("tr", "border-t border-merunka-tlumena align-top");

    const tdVyber = vytvor("td", "px-3 py-3");
    const zaskrt = vytvor("input");
    zaskrt.type = "checkbox";
    zaskrt.checked = vybrane.has(p.id);
    zaskrt.setAttribute("aria-label", `Vybrat ${p.nazev_poradatele}`);
    zaskrt.addEventListener("change", () => {
      if (zaskrt.checked) vybrane.add(p.id);
      else vybrane.delete(p.id);
      aktualizujVyber();
    });
    tdVyber.append(zaskrt);

    const tdAkce = vytvor("td", "px-3 py-3");
    const hlaska = vytvor("p", "admin-hlaska mt-2");
    if (p.zapis !== "schvaleno") {
      const poslat = vytvor("button", "admin-tlacitko-vedlejsi", p.vyzva ? "Poslat znovu" : "Poslat výzvu");
      poslat.type = "button";
      poslat.addEventListener("click", async () => {
        const v = await sHlasenim(
          hlaska,
          { probiha: "Posílám…", hotovo: "Hotovo." },
          () => posliDavku([p.id], false),
          { tlacitko: poslat },
        );
        if (v) {
          ukazStav(hlaska, v[0]?.vysledek === "chyba" ? "chyba" : "hotovo", `Hotovo. ${v[0]?.veta ?? ""}`);
          void obnovPoOdeslani();
        }
      });
      tdAkce.append(poslat);
    }
    tdAkce.append(hlaska);

    tr.append(
      tdVyber,
      vytvor("td", "px-3 py-3 font-semibold", p.nazev_poradatele),
      vytvor("td", "px-3 py-3", `${p.kontaktni_osoba}, ${p.email}`),
      vytvor("td", "px-3 py-3", p.mesto),
      vytvor("td", "px-3 py-3", STAV_PLATBY[p.stav] ?? p.stav),
      vytvor("td", "px-3 py-3", popisVyzvy(p)),
      vytvor("td", "px-3 py-3", p.zapis ? STAV_ZAPISU[p.zapis] : "Zatím ne"),
      tdAkce,
    );
    telo.append(tr);
  }
  aktualizujVyber();
}

function aktualizujVyber(): void {
  const pocet = vybrane.size;
  el<HTMLButtonElement>("tlacitko-poslat-vyzvy").disabled = pocet === 0;
  el("pocet-vybranych").textContent = pocet ? `Vybráno ${pocet}.` : "Nic není vybrané.";
  const vse = el<HTMLInputElement>("vybrat-vse");
  const n = zobrazene().filter((p) => p.zapis !== "schvaleno").length;
  vse.checked = pocet > 0 && pocet === n;
  vse.indeterminate = pocet > 0 && pocet < n;
  el("potvrzeni-vyzev").hidden = true;
}

interface VysledekVyzvy {
  id: string;
  vysledek: "odeslano" | "ceka" | "preskoceno" | "chyba";
  veta: string;
}

async function posliDavku(ids: string[], zkusebne: boolean, prijemce = ""): Promise<VysledekVyzvy[]> {
  const v = await zavolej<{ vysledky: VysledekVyzvy[] }>("posli-vyzvy", {
    prihlasky: ids,
    zkusebne,
    prijemce,
  });
  return v.vysledky;
}

async function obnovPoOdeslani(): Promise<void> {
  try {
    prihlasky = (await zavolej<{ prihlasky: PrihlaskaSVyzvou[] }>("vyzvy")).prihlasky;
    vykresliVyzvy();
  } catch {
    /* přehled se obnoví při dalším načtení */
  }
}

function ukazPotvrzeniHromadne(): void {
  const misto = el("potvrzeni-vyzev");
  const ids = [...vybrane];
  misto.innerHTML = "";
  misto.hidden = false;
  misto.append(
    vytvor(
      "p",
      "mt-0 font-semibold",
      `Poslat výzvu ${ids.length} ${ids.length === 1 ? "pořadateli" : "pořadatelům"}? Každý dostane e-mail s vlastním odkazem.`,
    ),
  );
  const rada = vytvor("div", "flex flex-wrap gap-3");
  const n = ids.length;
  const emaily = n === 1 ? "1 e-mail" : n >= 2 && n <= 4 ? `${n} e-maily` : `${n} e-mailů`;
  const ano = vytvor("button", "admin-tlacitko", `Ano, poslat ${emaily}`);
  ano.type = "button";
  const ne = vytvor("button", "admin-tlacitko-vedlejsi", "Zpět");
  ne.type = "button";
  rada.append(ano, ne);
  misto.append(rada);
  ano.focus();

  ne.addEventListener("click", () => {
    misto.hidden = true;
    el("tlacitko-poslat-vyzvy").focus();
  });

  ano.addEventListener("click", async () => {
    ano.disabled = true;
    ne.disabled = true;
    const hlaska = el("hlaska-vyzvy");
    const vysledky: VysledekVyzvy[] = [];
    try {
      for (let i = 0; i < ids.length; i += DAVKA) {
        ukazStav(hlaska, "probiha", `Posílám ${Math.min(i + DAVKA, ids.length)} z ${ids.length}…`);
        vysledky.push(...(await posliDavku(ids.slice(i, i + DAVKA), false)));
      }
    } catch (chyba) {
      const veta = chyba instanceof Error ? chyba.message : "Odesílání se přerušilo.";
      ukazStav(
        hlaska,
        "chyba",
        `${veta} Odesláno ${vysledky.length} z ${ids.length}. Přehled níž ukazuje, komu výzva odešla; zbylým ji pošlete znovu.`,
      );
      misto.hidden = true;
      vybrane.clear();
      await obnovPoOdeslani();
      return;
    }
    const odeslano = vysledky.filter((v) => v.vysledek === "odeslano").length;
    const ceka = vysledky.filter((v) => v.vysledek === "ceka").length;
    const preskoceno = vysledky.filter((v) => v.vysledek === "preskoceno").length;
    const chyby = vysledky.filter((v) => v.vysledek === "chyba").length;
    ukazStav(
      hlaska,
      chyby ? "chyba" : "hotovo",
      `Hotovo. Odesláno ${odeslano}` +
        (ceka ? `, ve frontě čeká ${ceka}` : "") +
        (preskoceno ? `, přeskočeno ${preskoceno} (už mají schválený zápis)` : "") +
        (chyby ? `, nepovedlo se ${chyby}. Těm pošlete výzvu znovu.` : "."),
    );
    misto.hidden = true;
    vybrane.clear();
    await obnovPoOdeslani();
  });
}

async function posliZkusebni(): Promise<void> {
  const hlaska = el("hlaska-zkusebni");
  const adresa = el<HTMLInputElement>("pole-zkusebni-email").value.trim();
  const prvni = [...vybrane][0] ?? zobrazene()[0]?.id;
  if (!prvni) {
    ukazStav(hlaska, "chyba", "Nejdřív načtěte přihlášky. Zkušební e-mail se skládá z jedné z nich.");
    return;
  }
  if (!adresa) {
    ukazStav(hlaska, "chyba", "Vyplňte prosím adresu, kam zkušební e-mail poslat.");
    el("pole-zkusebni-email").focus();
    return;
  }
  const p = prihlasky.find((x) => x.id === prvni);
  const v = await sHlasenim(
    hlaska,
    { probiha: "Posílám zkušební e-mail…", hotovo: "Hotovo." },
    () => posliDavku([prvni], true, adresa),
    { tlacitko: el<HTMLButtonElement>("tlacitko-zkusebni-vyzva") },
  );
  if (v) {
    ukazStav(
      hlaska,
      v[0]?.vysledek === "chyba" ? "chyba" : "hotovo",
      `Hotovo. Zkušební výzva k přihlášce „${p?.nazev_poradatele ?? ""}“: ${v[0]?.veta ?? ""}`,
    );
  }
}

// ===========================================================================
// PŘÍPRAVA
// ===========================================================================

let vyzvyNactene = false;

export function nactiZasobnik(): void {
  void nactiZapisy();
}

export function pripravZasobnik(emailSpravce: () => string): void {
  el("filtr-zapisu").addEventListener("change", vykresliZapisy);
  el("tlacitko-nacist-zapisy").addEventListener("click", () => void nactiZapisy());

  for (const t of document.querySelectorAll<HTMLButtonElement>("[data-cast-zasobniku]")) {
    t.addEventListener("click", () => {
      const cast = t.dataset.castZasobniku!;
      for (const b of document.querySelectorAll<HTMLButtonElement>("[data-cast-zasobniku]")) {
        b.setAttribute("aria-pressed", String(b === t));
      }
      for (const d of document.querySelectorAll<HTMLElement>("[data-zasobnik]")) {
        d.hidden = d.dataset.zasobnik !== cast;
      }
      if (cast === "vyzvy" && !vyzvyNactene) {
        vyzvyNactene = true;
        const pole = el<HTMLInputElement>("pole-zkusebni-email");
        if (!pole.value) pole.value = emailSpravce();
        void nactiVyzvy();
      }
    });
  }

  el("filtr-vyzev").addEventListener("change", vykresliVyzvy);
  el("filtr-vyzev-stav").addEventListener("change", vykresliVyzvy);
  el("tlacitko-nacist-vyzvy").addEventListener("click", () => void nactiVyzvy());
  el("tlacitko-poslat-vyzvy").addEventListener("click", ukazPotvrzeniHromadne);
  el("tlacitko-zkusebni-vyzva").addEventListener("click", () => void posliZkusebni());
  el<HTMLInputElement>("vybrat-vse").addEventListener("change", (u) => {
    const zapnout = (u.target as HTMLInputElement).checked;
    vybrane.clear();
    if (zapnout) for (const p of zobrazene()) if (p.zapis !== "schvaleno") vybrane.add(p.id);
    vykresliVyzvy();
  });
}
