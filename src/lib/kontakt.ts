/**
 * Kontakt do bloku „Nevíte si rady?".
 *
 * Jeden univerzální kontakt na celý projekt. Je schválně na jednom místě —
 * bloky „Nevíte si rady?" jsou ve všech verzích webu a už jednou se stalo,
 * že se něco doplnilo jen do jedné z nich.
 *
 * Kontakty na jednotlivé organizace jsou jinde (Poradatele.astro) a zadavatel
 * je zatím dodat nechce. Tenhle kontakt je tedy jediný, který je na webu
 * doopravdy vyplněný.
 */

/** Zobrazovaná podoba telefonu — tak, jak ho člověk čte. */
export const TELEFON_ZOBRAZIT = "603 852 740";

/**
 * Podoba pro odkaz `tel:`. Bez mezer a s předvolbou, jinak si s ním
 * některé telefony neporadí.
 */
export const TELEFON_ODKAZ = "+420603852740";

export const EMAIL = "cepova@prave-ted-ops.cz";

/** Kdo se ozve, když člověk zavolá nebo napíše. */
export const OSOBA = "Hana Čepová";
