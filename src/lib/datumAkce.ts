/**
 * Datum konání akce — pravidla sdílená oběma formuláři.
 *
 * PROČ TO JE ZVLÁŠŤ
 * Formuláře jsou dva (`Formular.astro` a `FormularKrokovy.astro`) a oba se
 * ptají na totéž datum. Kdyby si každý nesl vlastní rozmezí a vlastní hlášky,
 * dřív nebo později by se rozešly a jeden formulář by přijal, co druhý odmítne.
 *
 * POZOR — TOHLE NENÍ BEZPEČNOSTNÍ HRANICE
 * Všechno tady běží v prohlížeči a jde obejít. Je to jen zdvořilost
 * k návštěvníkovi, aby nemusel čekat na odpověď serveru. Skutečná kontrola
 * je znovu a nezávisle v Edge Funkci `prijmout-prihlasku` a jako poslední
 * pojistka i v databázi (podmínka `prihlasky_datum_akce_obdobi`).
 */

/**
 * Je datum povinné?
 *
 * TOHLE JE TO JEDINÉ MÍSTO, KDE SE POVINNOST PŘEPÍNÁ PRO OBA FORMULÁŘE.
 * Změna na `false` zařídí naráz: popisek „(nepovinné)" místo „povinné",
 * vynechání kontroly prázdného pole a to, že se dá krok s datem přejít dál.
 * Druhé (a poslední) místo je `DATUM_JE_POVINNE` v Edge Funkci
 * `prijmout-prihlasku` — bez něj by server dál trval na vyplnění.
 * V databázi se měnit nemusí nic, sloupec `datum_akce` je nullable.
 *
 * Proč je datum povinné: podle sekce „Jak to funguje" si pořadatel domlouvá
 * termín se seniorským místem dřív, než se registruje. V tu chvíli datum zná.
 */
export const DATUM_JE_POVINNE = true;

/**
 * Rozmezí, ve kterém se akce konají. Ročník 2026.
 *
 * Široké schválně — celé září a říjen. Akce mají probíhat v týdnu kolem
 * 1. října, ale kdo se se seniorským místem domluví až na 5. října, do
 * projektu patří úplně stejně. Podmínka je pojistka proti překlepu v roce,
 * ne nástroj na vymáhání termínu.
 *
 * Musí sedět s Edge Funkcí `prijmout-prihlasku` a s podmínkou
 * `prihlasky_datum_akce_obdobi` v migraci 20260814120000_datum_akce.sql.
 * Při změně ročníku se mění všechna tři místa.
 */
export const OBDOBI_OD = '2026-09-01';
export const OBDOBI_DO = '2026-10-31';

/** Nápověda pod polem. Doporučení termínu, ne podmínka. */
export const NAPOVEDA_DATUM =
  'Akce mají probíhat v týdnu kolem 1. 10. Když vám vyjde jiný termín na přelomu září a října, nevadí — vyberte ho podle skutečnosti.';

/**
 * Datum v českém tvaru: `2026-10-01` → `1. 10. 2026`.
 *
 * Skládá se z částí zapsaného řetězce, ne přes `new Date()`. Prohlížeč
 * čte `2026-10-01` jako půlnoc UTC, takže by se v západnějším časovém pásmu
 * ukázalo 30. 9. — den, který nikdo nevyplnil.
 */
export function ceskyDatum(iso: string): string {
  const casti = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!casti) return iso;
  return `${Number(casti[3])}. ${Number(casti[2])}. ${casti[1]}`;
}

/** Rozmezí česky do chybové hlášky: „od 1. 9. 2026 do 31. 10. 2026". */
export function obdobiCesky(): string {
  return `od ${ceskyDatum(OBDOBI_OD)} do ${ceskyDatum(OBDOBI_DO)}`;
}

/**
 * Zkontroluje vyplněné datum.
 *
 * Hlášky jsou schválně TŘI RŮZNÉ a každá říká něco jiného. „Zkontrolujte
 * datum" by člověku neporadilo nic — musí být poznat, jestli pole zapomněl,
 * jestli do něj napsal nesmysl, nebo jestli je jen mimo období akce.
 *
 * @returns `null` když je všechno v pořádku, jinak celou českou větu.
 */
export function zkontrolujDatum(zapsano: string): string | null {
  const hodnota = zapsano.trim();

  if (!hodnota) {
    return DATUM_JE_POVINNE
      ? 'Vyplňte datum, kdy se akce bude konat.'
      : null;
  }

  // Pole `type="date"` posílá vždycky `RRRR-MM-DD`. Když dorazí něco jiného,
  // člověk buď píše ručně do pole bez podpory kalendáře, nebo se do formuláře
  // dostalo něco cizího.
  const casti = /^(\d{4})-(\d{2})-(\d{2})$/.exec(hodnota);
  if (!casti) {
    return 'Datum nemá správný tvar. Vyberte ho prosím z kalendáře, například 1. 10. 2026.';
  }

  // 31. února je správný tvar, ale neexistující den. Prohlížeč takové datum
  // z kalendáře nenabídne, ručně zapsat ale jde.
  const rok = Number(casti[1]);
  const mesic = Number(casti[2]);
  const den = Number(casti[3]);
  const zkouska = new Date(Date.UTC(rok, mesic - 1, den));
  if (
    zkouska.getUTCFullYear() !== rok ||
    zkouska.getUTCMonth() !== mesic - 1 ||
    zkouska.getUTCDate() !== den
  ) {
    return 'Takový den neexistuje. Vyberte prosím datum z kalendáře.';
  }

  // Porovnání řetězců stačí — tvar RRRR-MM-DD se řadí stejně jako datum.
  if (hodnota < OBDOBI_OD || hodnota > OBDOBI_DO) {
    return `Datum je mimo období akce. Setkání se konají v týdnu kolem 1. 10., vyberte prosím datum ${obdobiCesky()}.`;
  }

  return null;
}
