/**
 * Upravitelné texty a obrázky webu.
 *
 * ===========================================================================
 * PROČ TO NENÍ UDĚLANÉ JAKO NORMÁLNÍ REDAKČNÍ SYSTÉM
 * ===========================================================================
 * Web aktivne-spolu.cz je statický. Hotové soubory se ručně nahrají FTP
 * klientem na hosting a od té chvíle je nemá kdo přestavět — žádný server,
 * který by web po změně textu znovu sestavil, neexistuje.
 *
 * Řešení:
 *   1. V HTML zůstávají PŮVODNÍ TEXTY. Přesně tak, jak je napsal autor.
 *   2. Správce v administraci uloží přepis do tabulky `obsah` v databázi.
 *   3. Stránka si po načtení přepisy vyzvedne a doplní je do už vykresleného
 *      HTML. Mění jen to, co se opravdu liší.
 *
 * Z toho plyne nejdůležitější vlastnost celého řešení:
 *
 *   KDYŽ DATABÁZE NEJEDE, WEB VYPADÁ NORMÁLNĚ.
 *
 * Nezobrazí se prázdná místa ani chybová hláška — zobrazí se původní texty
 * a nikdo nepozná, že se něco nenačetlo. Proto se přepisy nikdy nepoužívají
 * k tomu, aby něco na stránce vůbec vzniklo. Jen nahrazují to, co tam už je.
 *
 * ===========================================================================
 * JAK SE PÁRUJE PŘEPIS S MÍSTEM NA STRÁNCE
 * ===========================================================================
 * Podle TEXTU, ne podle značek v HTML. Každá položka katalogu níž si pamatuje
 * svůj původní text (`vychozi`) a skript ho na stránce najde a přepíše.
 *
 * Proč zrovna takhle:
 *   * Nemusí se nic dopisovat do souborů se vzhledem stránky. Kdokoli může
 *     měnit rozvržení, třídy a strukturu a párování to nerozbije.
 *   * Když se původní text v HTML někdy změní, přepis se prostě nepoužije
 *     a zobrazí se nový text z HTML. Nikdy nevznikne prázdné místo.
 *
 * Jediná povinnost: když se v HTML změní text, musí se stejně změnit
 * i `vychozi` tady v katalogu. Hlídá to kontrola `npm run kontrola-obsahu`
 * (skript scripts/kontrola-obsahu.mjs), která projde sestavený web a ohlásí
 * každou položku, jejíž původní text už na stránce není.
 */

// ---------------------------------------------------------------------------
// KATALOG
// ---------------------------------------------------------------------------

/**
 * Druh položky. Určuje, jak vypadá pole v administraci a co se na webu mění.
 *
 *   text     — krátký text na jeden řádek (nadpis, popisek tlačítka)
 *   dlouhy   — odstavec, v administraci víceřádkové pole
 *   obrazek  — obrázek; `vychozi` je adresa souboru, ne text
 *   telefon  — telefonní číslo; mění se text i to, kam odkaz volá
 *   email    — e-mailová adresa; mění se text i to, kam odkaz píše
 */
export type TypObsahu = 'text' | 'dlouhy' | 'obrazek' | 'telefon' | 'email';

export interface PolozkaObsahu {
  /** Ustálené označení, pod kterým je přepis uložený v databázi. */
  klic: string;
  /** Sekce webu. V administraci podle ní vzniknou skupiny. */
  skupina: string;
  /** Co to na stránce je — vysvětlení pro člověka, ne pro programátora. */
  popis: string;
  /** Původní znění z HTML. Musí sedět DOSLOVA, jinak se přepis nepoužije. */
  vychozi: string;
  typ: TypObsahu;
}

/**
 * Seznam všeho, co jde z administrace přepsat.
 *
 * Není tu obsah přihlašovacího formuláře ani patičky. Do formuláře se
 * schválně nesahá — jeho popisky souvisí s kontrolami vyplnění a s texty
 * v potvrzovacím e-mailu, takže je nelze měnit nezávisle.
 */
export const KATALOG: PolozkaObsahu[] = [
  // --- Úvodní obrazovka ---------------------------------------------------
  {
    klic: 'hero.nadpis',
    skupina: 'Úvodní obrazovka',
    popis: 'Hlavní nadpis úplně nahoře na stránce',
    typ: 'text',
    vychozi: 'Propojme generace. Vytvořte setkání, na které se nezapomíná.',
  },
  {
    klic: 'hero.perex',
    skupina: 'Úvodní obrazovka',
    popis: 'Úvodní odstavec pod hlavním nadpisem',
    typ: 'dlouhy',
    vychozi:
      'Ať už vedete školu, tvoříte mladý pracovní kolektiv, působíte v neziskovce nebo chcete s přáteli udělat něco smysluplného — oslavte s námi Mezinárodní den seniorů (v týdnu kolem 1. 10.). Zorganizujte přátelské mezigenerační setkání ve svém okolí. A poté zanechte svou stopu a staňte se součástí celostátního Zásobníku nápadů.',
  },
  {
    klic: 'hero.tlacitko-hlavni',
    skupina: 'Úvodní obrazovka',
    popis:
      'Nápis na červeném tlačítku. Je nahoře v liště i pod úvodním odstavcem — změní se na obou místech.',
    typ: 'text',
    vychozi: 'Chci se zapojit',
  },
  {
    klic: 'hero.tlacitko-letak',
    skupina: 'Úvodní obrazovka',
    popis: 'Nápis na druhém tlačítku pod úvodním odstavcem',
    typ: 'text',
    vychozi: 'Stáhnout informační leták (PDF)',
  },
  {
    klic: 'hero.cilovka-1',
    skupina: 'Úvodní obrazovka',
    popis: 'První položka v řádku „pro koho to je" pod úvodní obrazovkou',
    typ: 'text',
    vychozi: 'Školy a školky',
  },
  {
    klic: 'hero.cilovka-2',
    skupina: 'Úvodní obrazovka',
    popis: 'Druhá položka v řádku „pro koho to je"',
    typ: 'text',
    vychozi: 'Mladé kolektivy a firmy',
  },
  {
    klic: 'hero.cilovka-3',
    skupina: 'Úvodní obrazovka',
    popis: 'Třetí položka v řádku „pro koho to je"',
    typ: 'text',
    vychozi: 'Neziskovky a komunity',
  },
  {
    klic: 'hero.cilovka-4',
    skupina: 'Úvodní obrazovka',
    popis: 'Čtvrtá položka v řádku „pro koho to je"',
    typ: 'text',
    vychozi: 'Gen Z a nadšenci',
  },
  {
    klic: 'web.logo',
    skupina: 'Úvodní obrazovka',
    popis: 'Logo akce. Je v horní liště i na úvodní obrazovce.',
    typ: 'obrazek',
    vychozi: '/obrazky/logo.png',
  },

  // --- Proč se zapojit ----------------------------------------------------
  {
    klic: 'proc.nadpis',
    skupina: 'Proč se zapojit',
    popis: 'Nadpis sekce',
    typ: 'text',
    vychozi: 'Proč se do projektu zapojit, proč do toho jít?',
  },
  {
    klic: 'proc.duvod-1.nadpis',
    skupina: 'Proč se zapojit',
    popis: '1. kartička — nadpis',
    typ: 'text',
    vychozi: 'Smysluplný zážitek a lidské spojení',
  },
  {
    klic: 'proc.duvod-1.text',
    skupina: 'Proč se zapojit',
    popis: '1. kartička — text',
    typ: 'dlouhy',
    vychozi:
      'Oslavíte Mezinárodní den seniorů tvořivou, lidskou a citlivou formou. Vyzkoušíte si, jak snadné a obohacující je bořit bariéry a hledat to, co různé generace spojuje.',
  },
  {
    klic: 'proc.duvod-2.nadpis',
    skupina: 'Proč se zapojit',
    popis: '2. kartička — nadpis',
    typ: 'text',
    vychozi: 'Hodnoty, které dávají smysl',
  },
  {
    klic: 'proc.duvod-2.text',
    skupina: 'Proč se zapojit',
    popis: '2. kartička — text',
    typ: 'dlouhy',
    vychozi:
      'Ať už zapojíte školní třídu, firemní tým nebo partu přátel, připomenete si význam mezigenerační solidarity a pomůžete rozvíjet přirozený respekt, empatii a úctu ke starším generacím.',
  },
  {
    klic: 'proc.duvod-3.nadpis',
    skupina: 'Proč se zapojit',
    popis: '3. kartička — nadpis',
    typ: 'text',
    vychozi: 'Zkušenost, která utuží tým',
  },
  {
    klic: 'proc.duvod-3.text',
    skupina: 'Proč se zapojit',
    popis: '3. kartička — text',
    typ: 'dlouhy',
    vychozi:
      'Společná příprava a realizace akce je skvělý teambuilding. Spojíte lidi pro dobrou věc — ať už jde o žáky ve třídě, kolegy v práci, členy spolku nebo přátele.',
  },
  {
    klic: 'proc.duvod-4.nadpis',
    skupina: 'Proč se zapojit',
    popis: '4. kartička — nadpis',
    typ: 'text',
    vychozi: 'Inspirace pro celou ČR',
  },
  {
    klic: 'proc.duvod-4.text',
    skupina: 'Proč se zapojit',
    popis: '4. kartička — text',
    typ: 'dlouhy',
    vychozi:
      'Vaše společné setkání nezůstane zapomenuto. Stane se inspirativní součástí celostátního Zásobníku mezigeneračních aktivit, kde usnadníte ostatním vymýšlet podobné mezigenerační akce.',
  },
  {
    klic: 'proc.duvod-5.nadpis',
    skupina: 'Proč se zapojit',
    popis: '5. kartička — nadpis',
    typ: 'text',
    vychozi: 'Certifikát a odměna',
  },
  {
    klic: 'proc.duvod-5.text',
    skupina: 'Proč se zapojit',
    popis: '5. kartička — text',
    typ: 'dlouhy',
    vychozi:
      'Každý zapojený jednotlivec, tým či skupina získá účastnický certifikát a bude zařazen/a do losování o poukazy na společnou večeři, sportovní nebo výtvarné pomůcky!',
  },
  {
    klic: 'proc.cil.nadpis',
    skupina: 'Proč se zapojit',
    popis: 'Zvýrazněný rámeček dole — nadpis',
    typ: 'text',
    vychozi: 'Cíl akce',
  },
  {
    klic: 'proc.cil.text',
    skupina: 'Proč se zapojit',
    popis: 'Zvýrazněný rámeček dole — text',
    typ: 'dlouhy',
    vychozi:
      'Podpora mezigenerační solidarity, vytváření přirozených vazeb mezi nejmladší a nejstarší generací a oslava Mezinárodního dne seniorů v duchu vzájemného respektu, lidskosti a radosti ze společně stráveného času.',
  },

  // --- Jak to funguje -----------------------------------------------------
  {
    klic: 'kroky.nadpis',
    skupina: 'Jak to funguje',
    popis: 'Nadpis sekce s číslovanými kroky',
    typ: 'text',
    vychozi: '4 jednoduché kroky k realizaci',
  },
  {
    klic: 'kroky.krok-1.nadpis',
    skupina: 'Jak to funguje',
    popis: '1. krok — nadpis',
    typ: 'text',
    vychozi: 'Najděte seniorské partnerské místo v okolí',
  },
  {
    klic: 'kroky.krok-1.text',
    skupina: 'Jak to funguje',
    popis: '1. krok — text',
    typ: 'dlouhy',
    vychozi:
      'Propojte se s místním klubem seniorů, domovem pro seniory nebo aktivními seniory ve vaší obci.',
  },
  {
    klic: 'kroky.krok-2.nadpis',
    skupina: 'Jak to funguje',
    popis: '2. krok — nadpis',
    typ: 'text',
    vychozi: 'Domluvte vhodnou a bezpečnou aktivitu',
  },
  {
    klic: 'kroky.krok-2.text',
    skupina: 'Jak to funguje',
    popis:
      '2. krok — text. Věta v závorce je v původním znění zvýrazněná barvou; po úpravě už zvýrazněná nebude.',
    typ: 'dlouhy',
    vychozi:
      'Zvolte program, který bude příjemný a zvládnutelný pro obě strany. (Tipy na aktivity najdete níže.)',
  },
  {
    klic: 'kroky.krok-3.nadpis',
    skupina: 'Jak to funguje',
    popis: '3. krok — nadpis',
    typ: 'text',
    vychozi: 'Zaregistrujte se na webu',
  },
  {
    klic: 'kroky.krok-3.text',
    skupina: 'Jak to funguje',
    popis: '3. krok — text',
    typ: 'dlouhy',
    vychozi:
      'Vyplňte krátký přihlašovací formulář a uhradíte symbolický registrační poplatek.',
  },
  {
    klic: 'kroky.krok-4.nadpis',
    skupina: 'Jak to funguje',
    popis: '4. krok — nadpis',
    typ: 'text',
    vychozi: 'Prožijte setkání a sdílejte radost',
  },
  {
    klic: 'kroky.krok-4.text',
    skupina: 'Jak to funguje',
    popis: '4. krok — text',
    typ: 'dlouhy',
    vychozi:
      'V týdnu kolem 1. 10. proběhnou vaše akce. Následně, budete-li mít chuť se podělit, vyplníte do aplikace Zásobník nápadů krátký popis a fotky z vaší akce.',
  },

  // --- Tipy na aktivity ---------------------------------------------------
  {
    klic: 'tipy.nadpis',
    skupina: 'Tipy na aktivity',
    popis: 'Nadpis sekce',
    typ: 'text',
    vychozi: 'Čím se můžete inspirovat a co připravit?',
  },
  {
    klic: 'tipy.tip-1.nadpis',
    skupina: 'Tipy na aktivity',
    popis: '1. kartička — nadpis',
    typ: 'text',
    vychozi: 'Kultura a tvořivost',
  },
  {
    klic: 'tipy.tip-1.text',
    skupina: 'Tipy na aktivity',
    popis: '1. kartička — text',
    typ: 'dlouhy',
    vychozi:
      'Společný zpěv, výtvarná dílna, tvoření dekorací, společné čtení.',
  },
  {
    klic: 'tipy.tip-2.nadpis',
    skupina: 'Tipy na aktivity',
    popis: '2. kartička — nadpis',
    typ: 'text',
    vychozi: 'Pohyb a pobyt venku',
  },
  {
    klic: 'tipy.tip-2.text',
    skupina: 'Tipy na aktivity',
    popis: '2. kartička — text',
    typ: 'dlouhy',
    vychozi:
      'Nenáročná procházka, zahradní hry, mezigenerační venkovní hry, například mölkky nebo pétanque.',
  },
  {
    klic: 'tipy.tip-3.nadpis',
    skupina: 'Tipy na aktivity',
    popis: '3. kartička — nadpis',
    typ: 'text',
    vychozi: 'Sdílení a setkávání',
  },
  {
    klic: 'tipy.tip-3.text',
    skupina: 'Tipy na aktivity',
    popis: '3. kartička — text',
    typ: 'dlouhy',
    vychozi:
      'Hraní stolních her, vyprávění příběhů, vzájemné učení (např. žáci ukáží práci s tabletem, senioři tradiční řemeslo).',
  },
  {
    klic: 'tipy.priprava.nadpis',
    skupina: 'Tipy na aktivity',
    popis: 'Zvýrazněný rámeček dole — nadpis',
    typ: 'text',
    vychozi: 'Na co myslet při přípravě',
  },
  {
    klic: 'tipy.priprava.text',
    skupina: 'Tipy na aktivity',
    popis: 'Zvýrazněný rámeček dole — text',
    typ: 'dlouhy',
    vychozi:
      'Prioritou je pohoda a bezpečnost všech účastníků. Předem si ověřte očekávání seniorů, bezbariérovost prostoru, časovou náročnost i případná zdravotní či pohybová omezení. Cílem je klidné a příjemné mezigenerační setkání.',
  },

  // --- Jakou podporu získáte ----------------------------------------------
  {
    klic: 'podpora.nadpis',
    skupina: 'Jakou podporu získáte',
    popis: 'Nadpis sekce',
    typ: 'text',
    vychozi: 'Jakou podporu od nás získáte?',
  },
  {
    klic: 'podpora.polozka-1.nadpis',
    skupina: 'Jakou podporu získáte',
    popis: '1. kartička — nadpis',
    typ: 'text',
    vychozi: 'Konzultace programu',
  },
  {
    klic: 'podpora.polozka-1.text',
    skupina: 'Jakou podporu získáte',
    popis: '1. kartička — text',
    typ: 'dlouhy',
    vychozi:
      'Nejste si jistí vhodností aktivity? Rádi s vámi nápad zkonzultujeme.',
  },
  {
    klic: 'podpora.polozka-2.nadpis',
    skupina: 'Jakou podporu získáte',
    popis: '2. kartička — nadpis',
    typ: 'text',
    vychozi: 'Pomoc s nasměrováním',
  },
  {
    klic: 'podpora.polozka-2.text',
    skupina: 'Jakou podporu získáte',
    popis: '2. kartička — text',
    typ: 'dlouhy',
    vychozi:
      'Pokud váháte, koho v okolí oslovit, pokusíme se vás propojit se seniorskými organizacemi.',
  },
  {
    klic: 'podpora.polozka-3.nadpis',
    skupina: 'Jakou podporu získáte',
    popis: '3. kartička — nadpis',
    typ: 'text',
    vychozi: 'Certifikát a zařazení do losování',
  },
  {
    klic: 'podpora.polozka-3.text',
    skupina: 'Jakou podporu získáte',
    popis: '3. kartička — text',
    typ: 'dlouhy',
    vychozi:
      'Ocenění pro žáky a možnost získat věcné odměny pro vaši třídu či skupinu.',
  },

  // --- Zásobník nápadů ----------------------------------------------------
  {
    klic: 'zasobnik.nadpis',
    skupina: 'Zásobník nápadů',
    popis: 'Nadpis sekce',
    typ: 'text',
    vychozi: 'Co je to Zásobník nápadů?',
  },
  {
    klic: 'zasobnik.odstavec-1',
    skupina: 'Zásobník nápadů',
    popis: 'První odstavec',
    typ: 'dlouhy',
    vychozi:
      'Jde o webovou aplikaci, kterou v rámci IT/AI kroužku vytvářejí žáci ZŠ Magic Hill z Říčan u Prahy.',
  },
  {
    klic: 'zasobnik.odstavec-2',
    skupina: 'Zásobník nápadů',
    popis: 'Druhý odstavec',
    typ: 'dlouhy',
    vychozi:
      'Po realizaci vaší akce vyplníte jednoduchý formulář s popisem akce (pro koho byla akce vhodná, jaká byla náročnost, jaké pomůcky byly potřeba) a nahrajete fotografie. Od 1. listopadu tak vznikne veřejně přístupná databáze plná ověřené inspirace pro organizátory podobných akcí z celé ČR.',
  },
  {
    klic: 'zasobnik.box',
    skupina: 'Zásobník nápadů',
    popis: 'Text v tyrkysovém boxu vedle odstavců',
    typ: 'text',
    vychozi: 'Veřejná databáze inspirace vzniká od 1. listopadu.',
  },

  // --- Registrace a poplatek ----------------------------------------------
  {
    klic: 'registrace.nadpis',
    skupina: 'Registrace a poplatek',
    popis: 'Nadpis sekce',
    typ: 'text',
    vychozi: 'Registrace a poplatek',
  },
  {
    klic: 'registrace.popisek-cena',
    skupina: 'Registrace a poplatek',
    popis: 'Popisek nad částkou',
    typ: 'text',
    vychozi: 'Přihlášení do projektu',
  },
  {
    klic: 'registrace.cena',
    skupina: 'Registrace a poplatek',
    popis:
      'Částka velkým písmem. POZOR: mění jen to, co je vidět. Skutečná částka k zaplacení se nastavuje jinde — po změně napište správci webu.',
    typ: 'text',
    vychozi: '500 Kč',
  },
  {
    klic: 'registrace.cena-poznamka',
    skupina: 'Registrace a poplatek',
    popis: 'Věta pod částkou',
    typ: 'text',
    vychozi: 'Registrační poplatek činí symbolických 500 Kč.',
  },
  {
    klic: 'registrace.ucel.nadpis',
    skupina: 'Registrace a poplatek',
    popis: 'Druhý bílý rámeček — nadpis',
    typ: 'text',
    vychozi: 'Na co je poplatek určen?',
  },
  {
    klic: 'registrace.ucel.text',
    skupina: 'Registrace a poplatek',
    popis: 'Druhý bílý rámeček — text',
    typ: 'dlouhy',
    vychozi:
      'Tato částka slouží k pokrytí nákladů spojených s celkovou organizací a koordinací projektu, vývojem a technickým zajištěním aplikace „Zásobník nápadů" a dalšími nezbytnými provozními náklady na realizaci akce.',
  },
  {
    klic: 'registrace.platba.nadpis',
    skupina: 'Registrace a poplatek',
    popis: 'Třetí bílý rámeček — nadpis',
    typ: 'text',
    vychozi: 'Platba a fakturace',
  },
  {
    klic: 'registrace.platba.text',
    skupina: 'Registrace a poplatek',
    popis: 'Třetí bílý rámeček — text',
    typ: 'dlouhy',
    vychozi:
      'Platbu lze pohodlně provést pomocí QR kódu nebo standardním bankovním převodem. Systém vám po dokončení registrace v případě potřeby automaticky vystaví fakturu pro účetnictví školy/organizace.',
  },

  // --- Ke stažení a kontakt -----------------------------------------------
  {
    klic: 'kontakt.nadpis',
    skupina: 'Ke stažení a kontakt',
    popis: 'Nadpis poslední sekce',
    typ: 'text',
    vychozi: 'Ke stažení a kontakt',
  },
  {
    klic: 'kontakt.tlacitko-letak',
    skupina: 'Ke stažení a kontakt',
    popis: 'Nápis na tlačítku ke stažení letáku',
    typ: 'text',
    vychozi: 'Stáhnout kompletní leták k akci v PDF (pro pořadatele)',
  },
  {
    klic: 'kontakt.nadpis-pomoc',
    skupina: 'Ke stažení a kontakt',
    popis: 'Nadpis v rámečku s kontakty',
    typ: 'text',
    vychozi: 'Nevíte si rady?',
  },
  {
    klic: 'kontakt.text-pomoc',
    skupina: 'Ke stažení a kontakt',
    popis: 'Věta pod nadpisem v rámečku s kontakty',
    typ: 'text',
    vychozi: 'Ozvěte se nám, rádi poradíme.',
  },
  {
    klic: 'kontakt.telefon',
    skupina: 'Ke stažení a kontakt',
    popis:
      'Telefonní číslo. Změní se i to, kam se po klepnutí volá. Napište ho tak, jak se má zobrazit, například 777 123 456.',
    typ: 'telefon',
    vychozi: '[DOPLNIT: telefon]',
  },
  {
    klic: 'kontakt.email',
    skupina: 'Ke stažení a kontakt',
    popis:
      'E-mailová adresa. Změní se i to, kam se po klepnutí píše. Například info@aktivne-spolu.cz.',
    typ: 'email',
    vychozi: '[DOPLNIT: e-mail]',
  },
];

/** Rychlé vyhledání položky podle klíče. */
export const KATALOG_PODLE_KLICE = new Map(KATALOG.map((p) => [p.klic, p]));

/** Skupiny v pořadí, v jakém jsou na webu. */
export function skupinyKatalogu(): string[] {
  const videne: string[] = [];
  for (const polozka of KATALOG) {
    if (!videne.includes(polozka.skupina)) videne.push(polozka.skupina);
  }
  return videne;
}

// ---------------------------------------------------------------------------
// POROVNÁVÁNÍ TEXTŮ
// ---------------------------------------------------------------------------

/**
 * Sjednotí text na tvar, ve kterém se dá porovnávat.
 *
 * V HTML je stejná věta rozlámaná na řádky a odsazená mezerami, takže se
 * znak po znaku nikdy neshoduje s tím, co je napsané tady v katalogu.
 * Proto se všechny mezery, tabulátory, konce řádků i pevné mezery (`&nbsp;`)
 * stlačí do jedné obyčejné mezery a ořežou se okraje.
 */
export function sjednotText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// POUŽITÍ PŘEPISŮ NA UŽ VYKRESLENÉ STRÁNCE
// ---------------------------------------------------------------------------

/** Značky, ve kterých se text hledá. Schválně ne `div` — ten obaluje celé bloky. */
const ZNACKY_S_TEXTEM =
  'h1, h2, h3, h4, p, li, span, strong, em, a, button, figcaption, dt, dd, td, th, label, summary';

/**
 * Najde na stránce prvky, jejichž text odpovídá zadanému původnímu znění.
 *
 * Vrací jen ty nejvnitřnější. Kdyby se vracel i obalující prvek, přepis by
 * smazal všechno ostatní uvnitř něj.
 */
function najdiPrvkySTextem(puvodni: string): Element[] {
  const hledane = sjednotText(puvodni);
  if (!hledane) return [];

  const nalezene: Element[] = [];
  for (const prvek of document.querySelectorAll(ZNACKY_S_TEXTEM)) {
    if (sjednotText(prvek.textContent ?? '') === hledane) nalezene.push(prvek);
  }

  // Vyhodit obalující prvky — zůstanou jen ty, uvnitř kterých už žádný
  // další nález není.
  return nalezene.filter(
    (prvek) => !nalezene.some((jiny) => jiny !== prvek && prvek.contains(jiny)),
  );
}

/**
 * Vloží do prvku nový text tak, aby se nerozbilo, co v něm ještě je.
 *
 * V prvku můžou být kromě textu i ikony (SVG). Nastavit prvku rovnou celý
 * obsah by je smazalo. Proto se text vloží do prvního textového úseku
 * a ostatní se vyprázdní. Odsazení kolem textu zůstává zachované, ať se
 * nezmění mezera mezi ikonou a nápisem.
 */
function vlozTextDoPrvku(prvek: Element, novy: string): void {
  const prochazec = document.createTreeWalker(prvek, NodeFilter.SHOW_TEXT);
  const useky: Text[] = [];

  let uzel = prochazec.nextNode();
  while (uzel) {
    if ((uzel.nodeValue ?? '').trim() !== '') useky.push(uzel as Text);
    uzel = prochazec.nextNode();
  }

  if (useky.length === 0) {
    prvek.textContent = novy;
    return;
  }

  const prvni = useky[0];
  const puvodni = prvni.nodeValue ?? '';
  const mezeraPred = puvodni.match(/^\s*/)?.[0] ?? '';
  const mezeraZa = puvodni.match(/\s*$/)?.[0] ?? '';
  prvni.nodeValue = mezeraPred + novy + mezeraZa;

  for (let i = 1; i < useky.length; i++) useky[i].nodeValue = '';
}

/** Přepis jednoho obrázku. Mění se adresa u všech výskytů. */
function prepisObrazek(puvodniAdresa: string, novaAdresa: string): number {
  let zmeneno = 0;
  for (const obrazek of document.querySelectorAll('img')) {
    // `getAttribute` schválně: `obrazek.src` vrací doplněnou celou adresu
    // včetně domény, kdežto v HTML je napsaná zkrácená („/obrazky/logo.png").
    const soucasna = obrazek.getAttribute('src') ?? '';
    if (soucasna !== puvodniAdresa || soucasna === novaAdresa) continue;

    obrazek.setAttribute('src', novaAdresa);
    // Rozměry v HTML platí pro původní obrázek. U nového by natahovaly
    // nebo mačkaly poměr stran, tak je pustíme.
    obrazek.removeAttribute('width');
    obrazek.removeAttribute('height');
    zmeneno++;
  }
  return zmeneno;
}

/**
 * Doplní do už vykreslené stránky přepisy z administrace.
 *
 * Mění jen to, co se opravdu liší. Když je přepis stejný jako původní text
 * nebo se původní text na stránce nenajde, nesahá se na nic — díky tomu
 * obsah stránky nikam neposkočí a nic neblikne.
 *
 * @param prepisy Dvojice klíč → nový text, tak jak přišly z databáze.
 * @returns Kolik míst na stránce se změnilo. Slouží jen k ladění.
 */
export function pouzijPrepisy(prepisy: Record<string, string>): number {
  let zmeneno = 0;

  for (const polozka of KATALOG) {
    const novy = prepisy[polozka.klic];

    // Chybí přepis, nebo je prázdný → zůstává původní text z HTML.
    if (typeof novy !== 'string' || novy.trim() === '') continue;

    if (polozka.typ === 'obrazek') {
      zmeneno += prepisObrazek(polozka.vychozi, novy.trim());
      continue;
    }

    // Přepis se shoduje s původním zněním → není co dělat.
    if (sjednotText(novy) === sjednotText(polozka.vychozi)) continue;

    for (const prvek of najdiPrvkySTextem(polozka.vychozi)) {
      vlozTextDoPrvku(prvek, novy.trim());
      zmeneno++;

      // U telefonu a e-mailu se musí přenastavit i to, kam odkaz vede.
      // Jinak by se zobrazovalo nové číslo, ale volalo se na staré.
      if (polozka.typ === 'telefon' || polozka.typ === 'email') {
        const odkaz = prvek.closest('a');
        if (!odkaz) continue;

        if (polozka.typ === 'telefon') {
          odkaz.setAttribute('href', `tel:${novy.replace(/[\s()]/g, '')}`);
        } else {
          odkaz.setAttribute('href', `mailto:${novy.trim()}`);
        }
      }
    }
  }

  return zmeneno;
}

/**
 * Přečte odpověď databáze a udělá z ní dvojice klíč → text.
 *
 * Odolné schválně: cokoli, co nevypadá jako očekávaná data, se tiše zahodí
 * a vrátí se prázdný seznam. Prázdný seznam znamená „nech na stránce
 * původní texty", což je vždycky bezpečný výsledek.
 */
export function prepisyZOdpovedi(data: unknown): Record<string, string> {
  if (!Array.isArray(data)) return {};

  const prepisy: Record<string, string> = {};
  for (const radek of data) {
    if (!radek || typeof radek !== 'object') continue;
    const { klic, hodnota } = radek as { klic?: unknown; hodnota?: unknown };
    if (typeof klic === 'string' && typeof hodnota === 'string') {
      prepisy[klic] = hodnota;
    }
  }
  return prepisy;
}

// ---------------------------------------------------------------------------
// SPOLEČNÁ PROMĚNNÁ S PROHLÍŽEČEM
// ---------------------------------------------------------------------------
// Dotaz do databáze se odesílá krátkým kouskem kódu v hlavičce stránky
// (komponenta PrepisyObsahu.astro), zpracuje se ale až tady. Slíbená odpověď
// se mezi nimi předává touhle proměnnou.
declare global {
  interface Window {
    __prepisyObsahu?: Promise<unknown>;
  }
}
