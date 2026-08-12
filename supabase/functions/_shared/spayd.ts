// SPAYD — český standard pro QR platbu (SPD 1.0).
//
// Z tohohle textového řetězce se udělá QR kód, který bankovní aplikace přečte
// a předvyplní podle něj platbu. Formát je popsaný ve standardu ČBA
// „Krátký platební řetězec" (SPAYD).
//
// Pravidlo, které se vyplatí dodržet: když je vstup podezřelý (rozbité IBAN,
// nesmyslný variabilní symbol), vrátí se `null` a QR se prostě nepoužije.
// Vygenerovat QR kód, který pošle peníze jinam, je horší než žádný QR kód.

/**
 * Ověří a znormalizuje IBAN.
 *
 * Kontroluje se kontrolní číslice postupem mod-97 podle normy ISO 13616:
 * první čtyři znaky se přesunou na konec, písmena se nahradí čísly
 * (A=10, B=11, … Z=35) a celé číslo musí po dělení 97 dát zbytek 1.
 * Díky tomu se pozná překlep v čísle účtu dřív, než se z něj udělá QR.
 *
 * @returns IBAN bez mezer a velkými písmeny, nebo `null` když nesedí.
 */
export function normalizujIban(iban: string | null | undefined): string | null {
  if (!iban) return null;
  const ocisteny = iban.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{4,30}$/.test(ocisteny)) return null;

  const prehozeny = ocisteny.slice(4) + ocisteny.slice(0, 4);
  const jenCislice = prehozeny.replace(/[A-Z]/g, (z) => String(z.charCodeAt(0) - 55));

  // Počítá se po číslicích, protože celé číslo se do JS čísla nevejde.
  let zbytek = 0;
  for (const znak of jenCislice) zbytek = (zbytek * 10 + Number(znak)) % 97;

  return zbytek === 1 ? ocisteny : null;
}

/**
 * Znormalizuje variabilní symbol — jen číslice, nejvýš deset.
 * Delší VS banky odmítají.
 */
export function normalizujVs(vs: string | number | null | undefined): string | null {
  if (vs === null || vs === undefined) return null;
  const cislice = String(vs).replace(/\D+/g, '');
  if (!cislice || cislice.length > 10) return null;
  return cislice;
}

/** Částka vždy na dvě desetinná místa, s tečkou. */
export function formatujCastku(castka: number): string {
  return castka.toFixed(2);
}

/** Datum ve tvaru YYYYMMDD, jak ho SPAYD očekává. */
export function formatujDatum(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}${m[2]}${m[3]}` : null;
}

/**
 * Očistí zprávu pro příjemce.
 *
 * Hvězdička odděluje jednotlivá pole SPAYDu — kdyby zůstala ve zprávě,
 * rozpadl by se celý řetězec a banka by přečetla nesmysl. Zalomení řádků
 * a tabulátory ze stejného důvodu. Delší než 60 znaků se zprávy nepřenáší.
 *
 * Háčky a čárky se schválně odstraňují. SPAYD počítá jen se základní
 * anglickou abecedou a bankovní aplikace si s diakritikou často neporadí —
 * místo „Přihláška" by v bance stálo něco nečitelného.
 */
export function ocistiZpravu(zprava: string): string {
  return zprava
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[*\r\n\t]/g, ' ')
    // cokoli, co nezvládne základní abeceda, ven
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

/**
 * Ověří a znormalizuje SWIFT (BIC) kód banky.
 *
 * Platný BIC má 8 nebo 11 znaků: čtyři písmena banky, dvě země, dva znaky
 * pobočky a případně tři znaky konkrétního pracoviště.
 *
 * @returns BIC velkými písmeny, nebo `null` když nesedí. `null` znamená
 *          „SWIFT se do platebního řetězce nedá" — QR vznikne i bez něj,
 *          samotný IBAN k tuzemské platbě stačí.
 */
export function normalizujSwift(swift: string | null | undefined): string | null {
  if (!swift) return null;
  const ocisteny = swift.replace(/\s+/g, '').toUpperCase();
  return /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(ocisteny) ? ocisteny : null;
}

export interface SpaydVstup {
  /** Číslo účtu ve formátu IBAN. Bez něj QR nevznikne. */
  iban: string | null | undefined;
  /**
   * SWIFT (BIC) banky. Nepovinné — některé bankovní aplikace ho u účtu
   * radši vidí. Do řetězce se připojí za IBAN plusem, jak to standard
   * SPAYD předepisuje.
   */
  swift?: string | null;
  /** Částka v korunách. Musí být kladná. */
  castka: number;
  /** Měna, standardně CZK. */
  mena?: string;
  /** Variabilní symbol platby. */
  variabilniSymbol?: string | number | null;
  /** Datum splatnosti ve tvaru YYYY-MM-DD. */
  splatnost?: string | null;
  /** Zpráva pro příjemce, uvidí ji v bance. */
  zprava?: string | null;
  /** Jméno příjemce, zobrazí se plátci v aplikaci banky. */
  prijemce?: string | null;
}

/**
 * Složí SPAYD řetězec pro QR platbu.
 *
 * @returns Řetězec `SPD*1.0*ACC:…`, nebo `null` když nejsou údaje v pořádku.
 *          `null` není chyba — znamená „QR se přeskočí".
 */
export function sestavSpayd(vstup: SpaydVstup): string | null {
  const iban = normalizujIban(vstup.iban);
  if (!iban) return null;
  if (!(vstup.castka > 0)) return null;

  const mena = (vstup.mena ?? 'CZK').toUpperCase();
  if (!/^[A-Z]{3}$/.test(mena)) return null;

  // Účet se zapisuje jako `IBAN` nebo `IBAN+BIC`. Když SWIFT nedorazí nebo
  // je rozbitý, jede se jen s IBANem — na tuzemskou platbu to stačí a je to
  // lepší než QR kód, který banka odmítne přečíst celý.
  const swift = normalizujSwift(vstup.swift);
  const ucet = swift ? `${iban}+${swift}` : iban;

  const casti: string[] = [
    'SPD*1.0',
    `ACC:${ucet}`,
    `AM:${formatujCastku(vstup.castka)}`,
    `CC:${mena}`,
  ];

  const splatnost = formatujDatum(vstup.splatnost ?? null);
  if (splatnost) casti.push(`DT:${splatnost}`);

  const vs = normalizujVs(vstup.variabilniSymbol);
  if (vs) casti.push(`X-VS:${vs}`);

  if (vstup.prijemce) {
    const jmeno = ocistiZpravu(vstup.prijemce);
    if (jmeno) casti.push(`RN:${jmeno}`);
  }

  if (vstup.zprava) {
    const zprava = ocistiZpravu(vstup.zprava);
    if (zprava) casti.push(`MSG:${zprava}`);
  }

  return casti.join('*');
}
