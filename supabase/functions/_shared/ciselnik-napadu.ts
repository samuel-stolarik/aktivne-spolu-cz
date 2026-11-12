// Číselník Zásobníku nápadů — jediný zdroj pravdy pro všechna zaklikávací pole.
//
// Soubor schválně nepoužívá nic z Denu ani z prohlížeče, aby ho šlo importovat
// z obou stran:
//   - Edge Funkce `zapis-napadu` a `verejne-napady` (Deno),
//   - stránky `/zapis/` a `/zasobnik/` (Astro přes `src/lib/ciselnikNapadu.ts`).
//
// Do databáze se ukládají KLÍČE (bez diakritiky), ne názvy. Názvy se dají
// kdykoli přepsat bez zásahu do dat. Stejné klíče jsou vypsané v CHECK
// podmínkách migrace 20261112120000_zasobnik_napadu.sql. Kdo tady přidá
// nebo odebere klíč, musí upravit i migraci.

export interface Volba {
  klic: string;
  nazev: string;
}

export interface TypAkce {
  klic: 'kulturni' | 'pohyb' | 'ostatni';
  nazev: string;
  podtypy: Volba[];
}

/** Typ akce a jeho podtypy. U podtypu `jine` se vyplňuje vlastní text. */
export const TYPY: TypAkce[] = [
  {
    klic: 'kulturni',
    nazev: 'Kulturní',
    podtypy: [
      { klic: 'zpev', nazev: 'Zpěv' },
      { klic: 'tanec', nazev: 'Tanec' },
      { klic: 'vytvarne', nazev: 'Výtvarné' },
      { klic: 'divadlo', nazev: 'Divadlo' },
      { klic: 'cteni', nazev: 'Čtení' },
      { klic: 'vystava', nazev: 'Výstava' },
      { klic: 'jine', nazev: 'Jiné' },
    ],
  },
  {
    klic: 'pohyb',
    nazev: 'Pohyb a sport',
    podtypy: [
      { klic: 'turistika', nazev: 'Turistika' },
      { klic: 'olympiada', nazev: 'Olympiáda' },
      { klic: 'venkovni-hry', nazev: 'Venkovní hry' },
      { klic: 'prochazka', nazev: 'Procházka' },
      { klic: 'nordic-walking', nazev: 'Nordic walking' },
      { klic: 'sjizdeni-reky', nazev: 'Sjíždění řeky' },
      { klic: 'plavani', nazev: 'Plavání' },
      { klic: 'jine', nazev: 'Jiné' },
    ],
  },
  {
    klic: 'ostatni',
    nazev: 'Ostatní',
    podtypy: [
      { klic: 'kviz', nazev: 'Kvíz' },
      { klic: 'hospodsky-kviz', nazev: 'Hospodský kvíz' },
      { klic: 'prednaska', nazev: 'Přednáška' },
      { klic: 'host', nazev: 'Host' },
      { klic: 'strelba-prakem', nazev: 'Střelba prakem' },
      { klic: 'povidani', nazev: 'Povídání' },
      { klic: 'karty-hry', nazev: 'Karty a stolní hry' },
      { klic: 'jine', nazev: 'Jiné' },
    ],
  },
];

export const NAROCNOST: Volba[] = [
  { klic: 'jednoducha', nazev: 'Jednoduchá' },
  { klic: 'stredni', nazev: 'Středně náročná' },
  { klic: 'narocna', nazev: 'Náročná' },
];

/** Pro koho – věk. Vícenásobný výběr. */
export const VEK: Volba[] = [
  { klic: 'bez-omezeni', nazev: 'Bez omezení' },
  { klic: 'predskolaci', nazev: 'Předškoláci' },
  { klic: 'skolaci', nazev: 'Školáci' },
  { klic: 'stredoskolaci', nazev: 'Středoškoláci' },
  { klic: 'rodiny', nazev: 'Rodiny s dětmi' },
  { klic: 'mladsi-dospeli', nazev: 'Mladší dospělí' },
  { klic: 'seniori', nazev: 'Senioři' },
  { klic: 'vsechny', nazev: 'Všechny věkové skupiny' },
];

/** Pro koho – fyzická zdatnost. Vícenásobný výběr. */
export const ZDATNOST: Volba[] = [
  { klic: 'zdatni', nazev: 'Zdatní' },
  { klic: 'mirne-omezeni', nazev: 'S mírným omezením' },
  { klic: 'omezeni', nazev: 'Se zdravotním nebo pohybovým omezením' },
];

export const DELKA: Volba[] = [
  { klic: 'hodina', nazev: 'Hodina' },
  { klic: '1-2h', nazev: '1–2 hodiny' },
  { klic: '2-4h', nazev: '2–4 hodiny' },
  { klic: 'vic-4h', nazev: 'Více než 4 hodiny' },
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

/** Délky textů. Musí sedět s CHECK podmínkami v migraci. */
export const LIMITY = {
  nazevMax: 120,
  popisMin: 100,
  popisMax: 1000,
  vzkazMax: 300,
  jineMax: 80,
  pomuckyMax: 300,
  fotekMin: 1,
  fotekMax: 5,
  /** Největší povolená velikost jedné fotky po zmenšení v prohlížeči. */
  fotkaBajtuMax: 5 * 1024 * 1024,
} as const;

export function nazevVolby(seznam: Volba[], klic: string): string {
  return seznam.find((v) => v.klic === klic)?.nazev ?? klic;
}

export function typAkce(klic: string): TypAkce | undefined {
  return TYPY.find((t) => t.klic === klic);
}

export function nazevPodtypu(typ: string, podtyp: string): string {
  return typAkce(typ)?.podtypy.find((p) => p.klic === podtyp)?.nazev ?? podtyp;
}
