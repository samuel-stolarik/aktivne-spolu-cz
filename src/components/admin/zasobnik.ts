/**
 * Záložka „Zásobník nápadů" v administraci.
 *
 * Dvě části:
 *   1. Zápisy ke kontrole: meruňkový pruh „Čeká na vás", každý zápis jako
 *      rozbalovací řádek se vším (fotky, údaje, celý popis, souhlasy,
 *      neveřejný vzkaz) a tlačítky Schválit a zveřejnit / Vrátit k úpravě
 *      (s důvodem) / Zamítnout.
 *   2. Výzvy pořadatelům: stav u každé přihlášky (Neodesláno / Odesláno
 *      dne / Zápis vyplněný), výzva jednotlivě i hromadně a zkušební
 *      e-mail na vlastní adresu.
 *
 * Žádné confirm(): odeslání výzev a zamítnutí se potvrzuje tlačítkem
 * přímo na místě. Výsledek se vždy ukáže větou začínající „Hotovo!".
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
// SKLOŇOVÁNÍ
// ===========================================================================

/** 1 zápis, 2–4 zápisy, 0 a 5+ zápisů. */
function sklonuj(n: number, jeden: string, dva: string, pet: string): string {
  if (n === 1) return `${n} ${jeden}`;
  if (n >= 2 && n <= 4) return `${n} ${dva}`;
  return `${n} ${pet}`;
}

const zapisu = (n: number) => sklonuj(n, "zápis", "zápisy", "zápisů");
const fotek = (n: number) => sklonuj(n, "fotka", "fotky", "fotek");

// ===========================================================================
// FRONTA ZÁPISŮ
// ===========================================================================

/** Nejkratší důvod vrácení k úpravě. Musí sedět se serverem. */
const DUVOD_MIN = 5;

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

function vykresliPruh(): void {
  const pruh = el("pruh-cekajicich");
  const cekaji = zapisy.filter((z) => z.stav === "ceka").length;
  pruh.hidden = false;
  if (cekaji) {
    pruh.removeAttribute("data-nic");
    pruh.textContent = `Čeká na vás: ${zapisu(cekaji)}.`;
  } else {
    pruh.setAttribute("data-nic", "");
    pruh.textContent = "Nic nečeká na kontrolu.";
  }
}

function vykresliZapisy(): void {
  const filtr = el<HTMLSelectElement>("filtr-zapisu").value;
  const seznam = el("seznam-zapisu");
  const vybrane = zapisy.filter((z) => filtr === "vse" || z.stav === filtr);

  vykresliPruh();
  el("pocet-zapisu").textContent = filtr === "ceka"
    ? ""
    : `Zobrazeno ${vybrane.length} z ${zapisy.length}.`;

  seznam.innerHTML = "";
  if (!vybrane.length) {
    seznam.append(vytvor("p", "admin-karta text-popisek", "Tady teď žádný zápis není."));
    return;
  }
  for (const z of vybrane) seznam.append(radekZapisu(z));
}

function radekUdaju(dl: HTMLDListElement, nazev: string, hodnota: string): void {
  if (!hodnota) return;
  dl.append(vytvor("dt", "font-semibold", nazev), vytvor("dd", "", hodnota));
}

function radekZapisu(z: Zapis): HTMLElement {
  const radek = vytvor("details", "admin-zapis");
  radek.dataset.id = z.id;

  // --- Souhrn: název, kdo a odkud, počet fotek; vpravo „Otevřít". ---
  const souhrn = vytvor("summary");
  const hlavicka = vytvor("span", "admin-zapis-hlavicka");
  hlavicka.append(vytvor("span", "admin-zapis-nazev", z.nazev_akce));
  const kdo = vytvor("span", "admin-zapis-kdo", `${z.nazev_poradatele} · ${z.mesto} · ${fotek(z.fotky.length)}`);
  if (z.stav !== "ceka") {
    kdo.append(" ", vytvor("span", `admin-stitek admin-stitek-${z.stav}`, STAV_ZAPISU[z.stav] ?? z.stav));
  }
  hlavicka.append(kdo);
  souhrn.append(hlavicka, vytvor("span", "admin-zapis-otevrit", "Otevřít celý zápis"));
  radek.append(souhrn);

  const telo = vytvor("div", "admin-zapis-telo");

  if (z.stav !== "ceka" && z.rozhodl) {
    telo.append(
      vytvor(
        "p",
        "mt-4 mb-0 text-popisek",
        `${STAV_ZAPISU[z.stav]}: ${z.rozhodl}${z.rozhodnuto_kdy ? `, ${datumCas(z.rozhodnuto_kdy)}` : ""}.` +
          (z.duvod ? ` Důvod: ${z.duvod}` : ""),
      ),
    );
  }

  // --- Fotky ---
  if (z.fotky.length) {
    const galerie = vytvor("div", "admin-galerie");
    z.fotky.forEach((f, i) => {
      const odkaz = vytvor("a");
      odkaz.href = f.adresa;
      odkaz.target = "_blank";
      odkaz.rel = "noopener";
      const img = vytvor("img");
      img.src = f.adresa;
      img.alt = `Fotka ${i + 1} z ${z.fotky.length}${i === 0 ? ", titulní" : ""}. Otevře se ve velkém.`;
      img.loading = "lazy";
      odkaz.append(img);
      galerie.append(odkaz);
    });
    telo.append(galerie);
  } else {
    telo.append(vytvor("p", "admin-varovani", "Pozor: zápis nemá žádné fotky."));
  }

  // --- Údaje ---
  const typ = TYPY.find((t) => t.klic === z.typ)?.nazev ?? z.typ;
  const podtyp = z.podtyp === "jine" ? `jiné: ${z.podtyp_jine ?? ""}` : nazevPodtypu(z.typ, z.podtyp).toLowerCase();
  const dl = vytvor("dl", "admin-udaje");
  radekUdaju(dl, "Typ", `${typ} – ${podtyp}`);
  radekUdaju(dl, "Náročnost", nazevVolby(NAROCNOST, z.narocnost));
  radekUdaju(
    dl,
    "Pomůcky",
    z.pomucky_potreba ? `Jsou potřeba${z.pomucky_jake ? `: ${z.pomucky_jake}` : ""}` : "Nejsou potřeba",
  );
  radekUdaju(dl, "Pro koho – věk", z.vek.map((v) => nazevVolby(VEK, v)).join(", "));
  radekUdaju(dl, "Zdatnost", z.zdatnost.map((v) => nazevVolby(ZDATNOST, v)).join(", "));
  radekUdaju(dl, "Délka", nazevVolby(DELKA, z.delka));
  radekUdaju(dl, "Kde", `${z.mesto}, ${z.kraj}`);
  radekUdaju(dl, "Kdy proběhlo", datum(z.datum_akce) || "Neuvedeno");
  radekUdaju(dl, "Pořadatel", z.nazev_poradatele);
  radekUdaju(dl, "Kontaktní osoba", `${z.kontaktni_osoba}, ${z.email}${z.telefon ? `, ${z.telefon}` : ""}`);
  radekUdaju(dl, "Zápis přišel", datumCas(z.upraveno));
  telo.append(dl);

  // --- Celý popis ---
  telo.append(vytvor("h3", "mt-6 mb-2 text-xl", "Jak akce proběhla"));
  telo.append(vytvor("p", "admin-popis-zapisu", z.popis));

  // --- Souhlasy ---
  const souhlasy = vytvor("div", "mt-6");
  const foto = vytvor("p", "my-1");
  foto.append(vytvor("strong", "", "Souhlas se zveřejněním fotek: "), "Ano, potvrzeno");
  const kontakt = vytvor("p", "my-1");
  const zverejni = z.verejny_kontakt
    .map((k) => `${nazevVolby(VEREJNY_KONTAKT, k).toLowerCase()} ${k === "email" ? z.email : z.telefon ?? ""}`)
    .join(" a ");
  kontakt.append(
    vytvor("strong", "", "Souhlas se zveřejněním kontaktu: "),
    zverejni ? `Ano, u nápadu bude ${zverejni}` : "Ne, kontakt se nezveřejní",
  );
  souhlasy.append(foto, kontakt);
  if (z.souhlas_zneni) souhlasy.append(vytvor("p", "mt-2 mb-0 text-popisek", `Znění souhlasu: ${z.souhlas_zneni}`));
  telo.append(souhlasy);

  // --- Neveřejný vzkaz ---
  if (z.vzkaz) {
    const vzkaz = vytvor("div", "admin-vzkaz");
    vzkaz.append(vytvor("strong", "", "Vzkaz organizátorům kampaně (neveřejné): "), z.vzkaz);
    telo.append(vzkaz);
  }

  telo.append(ovladaniRozhodnuti(z));
  radek.append(telo);
  return radek;
}

const HOTOVO_ROZHODNUTI = {
  schvalit: "Hotovo! Zápis je zveřejněný v Zásobníku nápadů.",
  vratit: "Hotovo! Zápis je vrácený k úpravě. Pořadatel dostane e-mail s vaším důvodem a odkazem na úpravu.",
  zamitnout: "Hotovo! Zápis je zamítnutý a na webu se neukáže.",
} as const;

function ovladaniRozhodnuti(z: Zapis): HTMLElement {
  const obal = vytvor("div", "admin-rozhodnuti");
  const hlaska = vytvor("p", "admin-hlaska mb-3");
  const rada = vytvor("div", "flex flex-wrap gap-3");

  async function rozhodni(
    rozhodnuti: keyof typeof HOTOVO_ROZHODNUTI,
    tlacitko: HTMLButtonElement,
    duvod = "",
  ): Promise<boolean> {
    const v = await sHlasenim(
      hlaska,
      { probiha: "Ukládám rozhodnutí…", hotovo: HOTOVO_ROZHODNUTI[rozhodnuti] },
      () =>
        zavolej<{ stav: Zapis["stav"]; email: { odeslano: boolean; pres: string } | null }>("rozhodni-napad", {
          id: z.id,
          rozhodnuti,
          duvod,
        }),
      { tlacitko },
    );
    if (!v) return false;

    z.stav = v.stav;
    z.duvod = rozhodnuti === "schvalit" ? null : duvod || null;
    z.rozhodnuto_kdy = new Date().toISOString();

    // Hláška patří k sekci: řádek se po rozhodnutí z fronty přesune.
    const sekce = el("hlaska-zapisy");
    const fronta = v.email && !v.email.odeslano ? " E-mail pořadateli čeká ve frontě odchozí pošty." : "";
    vykresliZapisy();
    ukazStav(sekce, "hotovo", HOTOVO_ROZHODNUTI[rozhodnuti] + fronta);
    sekce.scrollIntoView({ block: "center", behavior: "smooth" });
    sekce.focus({ preventScroll: true });
    return true;
  }

  // --- Schválit ---
  const schvalit = vytvor("button", "admin-tlacitko", "Schválit a zveřejnit");
  schvalit.type = "button";
  schvalit.addEventListener("click", () => void rozhodni("schvalit", schvalit));

  // --- Vrátit k úpravě: pole s důvodem přímo na místě ---
  const vratit = vytvor("button", "admin-tlacitko-vedlejsi", "Vrátit k úpravě");
  vratit.type = "button";
  vratit.setAttribute("aria-expanded", "false");

  const mistoVraceni = vytvor("div", "admin-potvrzeni-misto");
  mistoVraceni.hidden = true;
  const pole = vytvor("textarea", "admin-pole mt-2");
  pole.id = `duvod-${z.id}`;
  pole.rows = 3;
  pole.maxLength = 1000;
  pole.placeholder = "Přidejte prosím ještě 2 fotky.";
  const popisek = vytvor("label", "admin-popisek", "Co má pořadatel upravit? (krátce, uvidí to)");
  popisek.htmlFor = pole.id;
  const chybaDuvodu = vytvor("p", "admin-hlaska mt-2");
  chybaDuvodu.id = `chyba-duvodu-${z.id}`;
  pole.setAttribute("aria-describedby", chybaDuvodu.id);
  const radaVraceni = vytvor("div", "mt-3 flex flex-wrap gap-3");
  const vratitSDuvodem = vytvor("button", "admin-tlacitko-vedlejsi", "Vrátit s tímto důvodem");
  vratitSDuvodem.type = "button";
  const zrusitVraceni = vytvor("button", "admin-tlacitko-vedlejsi", "Zrušit");
  zrusitVraceni.type = "button";
  radaVraceni.append(vratitSDuvodem, zrusitVraceni);
  mistoVraceni.append(popisek, pole, chybaDuvodu, radaVraceni);

  vratit.addEventListener("click", () => {
    zavriZamitnuti();
    mistoVraceni.hidden = false;
    vratit.setAttribute("aria-expanded", "true");
    pole.focus();
  });
  zrusitVraceni.addEventListener("click", () => {
    mistoVraceni.hidden = true;
    vratit.setAttribute("aria-expanded", "false");
    ukazStav(chybaDuvodu, "nic");
    pole.removeAttribute("aria-invalid");
    vratit.focus();
  });
  pole.addEventListener("input", () => {
    ukazStav(chybaDuvodu, "nic");
    pole.removeAttribute("aria-invalid");
  });
  vratitSDuvodem.addEventListener("click", async () => {
    const duvod = pole.value.trim();
    if (duvod.length < DUVOD_MIN) {
      ukazStav(
        chybaDuvodu,
        "chyba",
        `Napište prosím krátce, co má pořadatel upravit. Stačí aspoň ${DUVOD_MIN} znaků.`,
      );
      pole.setAttribute("aria-invalid", "true");
      pole.focus();
      return;
    }
    await rozhodni("vratit", vratitSDuvodem, duvod);
  });

  // --- Zamítnout: potvrzení přímo na místě, bez confirm() ---
  const zamitnout = vytvor("button", "admin-tlacitko-vedlejsi admin-nebezpeci", "Zamítnout");
  zamitnout.type = "button";
  const mistoZamitnuti = vytvor("div", "admin-potvrzeni-misto");
  mistoZamitnuti.hidden = true;
  mistoZamitnuti.append(
    vytvor(
      "p",
      "mt-0 font-semibold",
      `Opravdu zamítnout zápis „${z.nazev_akce}“? Na webu se neukáže a pořadatel ho už nebude moct upravit.`,
    ),
  );
  const radaZamitnuti = vytvor("div", "flex flex-wrap gap-3");
  const potvrdit = vytvor("button", "admin-tlacitko-vedlejsi admin-nebezpeci", "Ano, zamítnout");
  potvrdit.type = "button";
  const nezamitat = vytvor("button", "admin-tlacitko-vedlejsi", "Nezamítat");
  nezamitat.type = "button";
  radaZamitnuti.append(potvrdit, nezamitat);
  mistoZamitnuti.append(radaZamitnuti);

  function zavriZamitnuti() {
    mistoZamitnuti.hidden = true;
  }
  zamitnout.addEventListener("click", () => {
    mistoVraceni.hidden = true;
    vratit.setAttribute("aria-expanded", "false");
    mistoZamitnuti.hidden = false;
    potvrdit.focus();
  });
  nezamitat.addEventListener("click", () => {
    zavriZamitnuti();
    zamitnout.focus();
  });
  potvrdit.addEventListener("click", async () => {
    if (!(await rozhodni("zamitnout", potvrdit))) return;
  });

  if (z.stav !== "schvaleno") rada.append(schvalit);
  if (z.stav !== "vraceno") rada.append(vratit);
  if (z.stav !== "zamitnuto") rada.append(zamitnout);
  obal.append(hlaska, rada, mistoVraceni, mistoZamitnuti);
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

/** Sloupec Stav: Neodesláno / Odesláno dne / Zápis vyplněný. */
function bunkaStavu(p: PrihlaskaSVyzvou): HTMLTableCellElement {
  const td = vytvor("td", "px-3 py-3");
  if (p.zapis) {
    td.append(vytvor("span", "admin-stav-vyzvy", "Zápis vyplněný"));
    td.append(vytvor("span", `admin-stitek admin-stitek-${p.zapis}`, STAV_ZAPISU[p.zapis] ?? p.zapis));
    return td;
  }
  if (!p.vyzva) {
    td.append(vytvor("span", "admin-stav-vyzvy", "Neodesláno"));
    return td;
  }
  td.append(vytvor("span", "admin-stav-vyzvy", `Odesláno ${datum(p.vyzva.odeslano_kdy)}`));
  const poznamky: string[] = [];
  if (p.vyzva.stav_posty === "chyba") poznamky.push("e-mail neodešel, pošlete ho znovu");
  else if (p.vyzva.stav_posty !== "odeslano") poznamky.push("e-mail čeká ve frontě");
  if (p.vyzva.pocet > 1) poznamky.push(`posláno ${p.vyzva.pocet}×`);
  if (p.otevreno) poznamky.push("odkaz otevřen");
  if (poznamky.length) {
    const t = poznamky.join(", ");
    td.append(vytvor("span", "admin-stav-vyzvy-pozn", t.charAt(0).toUpperCase() + t.slice(1) + "."));
  }
  return td;
}

/** Tlačítko „Poslat výzvu k zápisu" u jedné přihlášky s potvrzením na místě. */
function bunkaOdeslani(p: PrihlaskaSVyzvou): HTMLTableCellElement {
  const td = vytvor("td", "px-3 py-3");
  const hlaska = vytvor("p", "admin-hlaska mt-2");
  if (p.zapis === "schvaleno") {
    td.append(vytvor("span", "text-popisek", "Zápis je na webu."));
    return td;
  }

  const poslat = vytvor(
    "button",
    "admin-tlacitko-vedlejsi admin-maly",
    p.vyzva ? "Poslat výzvu znovu" : "Poslat výzvu k zápisu",
  );
  poslat.type = "button";

  const potvrzeni = vytvor("div", "admin-potvrzeni-misto");
  potvrzeni.hidden = true;
  potvrzeni.append(vytvor("p", "mt-0 font-semibold", `Poslat výzvu na ${p.email}?`));
  const rada = vytvor("div", "flex flex-wrap gap-3");
  const ano = vytvor("button", "admin-tlacitko-vedlejsi admin-maly", "Ano, poslat");
  ano.type = "button";
  const ne = vytvor("button", "admin-tlacitko-vedlejsi admin-maly", "Zpět");
  ne.type = "button";
  rada.append(ano, ne);
  potvrzeni.append(rada);

  poslat.addEventListener("click", () => {
    poslat.hidden = true;
    potvrzeni.hidden = false;
    ano.focus();
  });
  ne.addEventListener("click", () => {
    potvrzeni.hidden = true;
    poslat.hidden = false;
    poslat.focus();
  });
  ano.addEventListener("click", async () => {
    ne.disabled = true;
    const v = await sHlasenim(
      hlaska,
      { probiha: "Posílám…", hotovo: "Hotovo!" },
      () => posliDavku([p.id], false),
      { tlacitko: ano },
    );
    ne.disabled = false;
    potvrzeni.hidden = true;
    poslat.hidden = false;
    if (!v) return;
    if (v[0]?.vysledek === "chyba") {
      ukazStav(hlaska, "chyba", v[0]?.veta ?? "Výzvu se nepodařilo poslat. Zkuste to prosím znovu.");
      poslat.focus();
      return;
    }
    // Tabulka se po odeslání překreslí, proto hláška patří k sekci.
    ukazStav(hlaska, "nic");
    ukazStav(el("hlaska-vyzvy"), "hotovo", `Hotovo! Výzva pro ${p.nazev_poradatele}: ${v[0]?.veta ?? ""}`);
    await obnovPoOdeslani();
    el("hlaska-vyzvy").scrollIntoView({ block: "center", behavior: "smooth" });
  });

  td.append(poslat, potvrzeni, hlaska);
  return td;
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
    if (p.zapis !== "schvaleno") {
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
    }

    tr.append(
      tdVyber,
      vytvor("td", "px-3 py-3 font-semibold", p.nazev_poradatele),
      vytvor("td", "px-3 py-3", `${p.kontaktni_osoba}, ${p.email}`),
      vytvor("td", "px-3 py-3", p.mesto),
      vytvor("td", "px-3 py-3", STAV_PLATBY[p.stav] ?? p.stav),
      bunkaStavu(p),
      bunkaOdeslani(p),
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
      `Hotovo! Odesláno ${odeslano}` +
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
    { probiha: "Posílám zkušební e-mail…", hotovo: "Hotovo!" },
    () => posliDavku([prvni], true, adresa),
    { tlacitko: el<HTMLButtonElement>("tlacitko-zkusebni-vyzva") },
  );
  if (v) {
    ukazStav(
      hlaska,
      v[0]?.vysledek === "chyba" ? "chyba" : "hotovo",
      `Hotovo! Zkušební výzva k přihlášce „${p?.nazev_poradatele ?? ""}“: ${v[0]?.veta ?? ""}`,
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
