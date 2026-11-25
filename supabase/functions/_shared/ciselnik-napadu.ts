// Číselník Zásobníku nápadů — jediný zdroj pravdy pro všechna zaklikávací pole.
//
// Soubor schválně nepoužívá nic z Denu ani z prohlížeče, aby ho šlo importovat
// z obou stran:
//   - Edge Funkce `zapis-napadu`, `verejne-napady` a `admin-obsah` (Deno),
//   - stránky `/zapis/`, `/zasobnik/` a `/admin/` (Astro přes `src/lib/ciselnikNapadu.ts`).
//
// Do databáze se ukládají KLÍČE (bez diakritiky), ne názvy. Názvy se dají
// kdykoli přepsat bez zásahu do dat. Stejné klíče jsou vypsané v CHECK
// podmínkách migrací 20261112120000_zasobnik_napadu.sql,
// 20261120120000_zasobnik_zpetna_vazba.sql
// a 20261125120000_zasobnik_typy_bez_upresneni.sql. Kdo tady přidá nebo odebere
// klíč, musí přidat i novou migraci.
//
// Názvy polí a hodnot jsou doslova podle zadavatelky (Hana Čepová,
// e-mail z 18. 11. 2026, upřesnění 24. 11. 2026). Bez jejího souhlasu
// je neměňte.

export interface Volba {
  klic: string;
  nazev: string;
}

export interface TypAkce {
  klic: 'kulturni' | 'pohyb' | 'spolecenska' | 'jina';
  nazev: string;
  /**
   * Jen u „Jiná": pořadatel napíše vlastními slovy, jaká akce to byla.
   * Do databáze jde podtyp `jine` + text v `podtyp_jine`. Ostatní typy
   * žádné upřesnění nemají (`podtyp` je prázdný).
   */
  vlastniText: boolean;
}

/** Klíč podtypu u typu „Jiná", u kterého se vyplňuje vlastní text. */
export const PODTYP_JINE = 'jine';

// ---------------------------------------------------------------------------
// ROZHODNUTÍ, KTERÁ JDE PŘEPNOUT NA JEDNOM MÍSTĚ
// ---------------------------------------------------------------------------
// Formulář, filtry, funkce i admin se podle toho zařídí samy.

/**
 * Otázka 2: Poznámka/komentář je VEŘEJNÁ (zobrazí se u nápadu).
 * Když bude jen pro správce, stačí přepnout na `false`: funkce
 * `verejne-napady` ji pak nevydá a formulář u ní napíše, že je neveřejná.
 */
export const POZNAMKA_JE_VEREJNA = true;

/** Zdatnost seniorů: jedna odpověď. Na `true` jde vybrat víc možností. */
export const ZDATNOST_VICE_VOLEB = false;

/** Filtry v Zásobníku: ve skupině jde vybrat víc hodnot (stačí, když sedí jedna). */
export const FILTR_VICE_VOLEB = true;

// ---------------------------------------------------------------------------
// NÁZVY POLÍ
// ---------------------------------------------------------------------------
// Stejný název ve formuláři, filtrech, na kartě, v detailu, v adminu
// i v exportu do CSV.
export const POPISKY = {
  typ: 'Typ akce',
  vek: 'Pro koho je akce vhodná',
  zdatnost: 'Zdatnost seniorů (omezení)',
  delka: 'Časová náročnost akce',
  pomucky: 'Pomůcky',
  misto_konani: 'Místo konání',
  rozpocet: 'Rozpočet na celou akci',
  poznamka: 'Poznámka/komentář',
} as const;

/** Text u starších zápisů, ve kterých nové pole chybí. */
export const NEUVEDENO = 'neuvedeno';

// ---------------------------------------------------------------------------
// VOLBY
// ---------------------------------------------------------------------------

/**
 * Typ akce. Jen čtyři volby, upřesnění (dřív Zpěv, Tanec, Kvíz…) zadavatelka
 * zrušila (e-mail 18. 11. 2026, potvrzeno 24. 11. 2026). U „Jiná" se píše
 * vlastní text. Klíče musí sedět s CHECK podmínkou v migraci
 * 20261125120000_zasobnik_typy_bez_upresneni.sql.
 */
export const TYPY: TypAkce[] = [
  { klic: 'kulturni', nazev: 'Kulturní', vlastniText: false },
  { klic: 'pohyb', nazev: 'Pohyb a sport', vlastniText: false },
  // Do 20. 11. 2026 „Ostatní" s klíčem `ostatni`.
  { klic: 'spolecenska', nazev: 'Společenská akce', vlastniText: false },
  { klic: 'jina', nazev: 'Jiná', vlastniText: true },
];

/**
 * Pro koho je akce vhodná. Vícenásobný výběr.
 * Ukládá se do sloupce `vek` (název zůstal z první verze).
 */
export const VEK: Volba[] = [
  { klic: 'predskolaci', nazev: 'Předškoláci' },
  { klic: 'skolaci', nazev: 'Školáci' },
  { klic: 'stredoskolaci', nazev: 'Středoškoláci' },
  { klic: 'rodiny', nazev: 'Rodiny' },
  { klic: 'mladsi-dospeli', nazev: 'Mladší dospělí' },
  { klic: 'firmy', nazev: 'Firmy a organizace' },
  { klic: 'seniori', nazev: 'Senioři' },
  { klic: 'vsechny', nazev: 'Všechny skupiny' },
];

/**
 * Volba „Všechny skupiny". Ve formuláři ostatní volby zruší, ve filtru
 * se nápad s ní ukáže u kterékoli skupiny.
 */
export const VEK_VSECHNY = 'vsechny';

/** Zdatnost seniorů (omezení). Kolik voleb jde vybrat, říká ZDATNOST_VICE_VOLEB. */
export const ZDATNOST: Volba[] = [
  { klic: 'zdatni', nazev: 'Zdatní' },
  { klic: 'mirne-omezeni', nazev: 'S mírným omezením' },
  { klic: 'omezeni', nazev: 'Se zdravotním nebo pohybovým omezením' },
];

/** Časová náročnost akce. Ukládá se do sloupce `delka`. */
export const DELKA: Volba[] = [
  { klic: 'hodina', nazev: 'Hodina' },
  { klic: '1-2h', nazev: '1–2 h' },
  { klic: '2-4h', nazev: '2–4 h' },
  { klic: 'vic-4h', nazev: 'Více než 4 h' },
];

export const MISTO_KONANI: Volba[] = [
  { klic: 'venku', nazev: 'Venkovní' },
  { klic: 'uvnitr', nazev: 'Vnitřní' },
  { klic: 'oboji', nazev: 'Venku i uvnitř' },
];

/**
 * Rozpočet na celou akci: celkové náklady (potvrzeno zadavatelkou
 * 24. 11. 2026).
 */
export const ROZPOCET: Volba[] = [
  { klic: 'zadny', nazev: 'Žádný' },
  { klic: 'do-500', nazev: 'Do 500 Kč' },
  { klic: '500-1000', nazev: '500 až 1000 Kč' },
  { klic: 'vic-1000', nazev: 'Více než 1000 Kč' },
];

/** Nápověda pod polem Rozpočet na celou akci ve formuláři. */
export const ROZPOCET_NAPOVEDA = 'Celkové náklady na celou akci.';

/** Pomůcky (formulář i filtr). */
export const POMUCKY: Volba[] = [
  { klic: 'ne', nazev: 'Nejsou potřeba' },
  { klic: 'ano', nazev: 'Jsou potřeba' },
];

/** Který kontakt smí být u nápadu zveřejněný. */
export const VEREJNY_KONTAKT: Volba[] = [
  { klic: 'email', nazev: 'E-mail' },
  { klic: 'telefon', nazev: 'Telefon' },
];

export const KRAJE = [
  'Praha',
  'Středočeský',
  'Jihočeský',
  'Plzeňský',
  'Karlovarský',
  'Ústecký',
  'Liberecký',
  'Královéhradecký',
  'Pardubický',
  'Vysočina',
  'Jihomoravský',
  'Olomoucký',
  'Zlínský',
  'Moravskoslezský',
] as const;

/** Délky textů. Musí sedět s CHECK podmínkami v migracích. */
export const LIMITY = {
  nazevMin: 5,
  nazevMax: 100,
  popisMin: 100,
  popisMax: 1000,
  vzkazMax: 300,
  poznamkaMax: 300,
  jineMax: 80,
  pomuckyMax: 300,
  fotekMin: 1,
  fotekMax: 5,
  /** Největší povolená velikost jedné fotky po zmenšení v prohlížeči. */
  fotkaBajtuMax: 5 * 1024 * 1024,
} as const;

/**
 * Textová pole, která smí správce v administraci opravit (překlepy,
 * drobné chyby). Úprava se zapíše do `napady_upravy`, u nápadu se
 * nezobrazuje.
 */
export const UPRAVITELNA_POLE = ['nazev_akce', 'popis', 'pomucky_jake', 'poznamka', 'podtyp_jine'] as const;
export type UpravitelnePole = (typeof UPRAVITELNA_POLE)[number];

/**
 * Znění souhlasů ve formuláři. Server ho ukládá ke každému zápisu
 * (`napady.souhlas_zneni`), aby bylo doložené, s čím kdo souhlasil.
 *
 * NÁVRH. Čeká na schválení provozovatelem, než se nasadí.
 */
export const SOUHLAS = {
  zpracovani:
    'Souhlasím se zpracováním osobních údajů z tohoto formuláře pro účely Zásobníku nápadů ' +
    'a se zveřejněním vybraného kontaktu u mého nápadu, aby se mi mohli ozvat zájemci.',
  foto: 'Mám souhlas všech vyfocených se zveřejněním, u dětí souhlas rodičů.',
} as const;

export function nazevVolby(seznam: Volba[], klic: string | null | undefined): string {
  if (!klic) return NEUVEDENO;
  return seznam.find((v) => v.klic === klic)?.nazev ?? klic;
}

/** Názvy více voleb oddělené čárkou, nebo „neuvedeno". */
export function nazvyVoleb(seznam: Volba[], klice: string[] | null | undefined): string {
  if (!klice || !klice.length) return NEUVEDENO;
  return klice.map((k) => nazevVolby(seznam, k)).join(', ');
}

export function typAkce(klic: string): TypAkce | undefined {
  return TYPY.find((t) => t.klic === klic);
}

/** Píše se u typu vlastní text („Jaká akce to byla?")? Jen u „Jiná". */
export function maVlastniText(typ: string): boolean {
  return typAkce(typ)?.vlastniText === true;
}

/** Co se ukládá do `podtyp`: u „Jiná" `jine`, jinak nic. */
export function podtypProTyp(typ: string): typeof PODTYP_JINE | null {
  return maVlastniText(typ) ? PODTYP_JINE : null;
}

/** „Kulturní", „Jiná – vlastní text". */
export function typSPodtypem(typ: string, podtyp: string | null, podtypJine: string | null): string {
  const nazevTypu = typAkce(typ)?.nazev ?? typ;
  const upresneni = podtyp === PODTYP_JINE ? (podtypJine ?? '').trim() : '';
  return upresneni ? `${nazevTypu} – ${upresneni.toLocaleLowerCase('cs')}` : nazevTypu;
}
