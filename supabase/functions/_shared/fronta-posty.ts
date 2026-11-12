// Odložení zprávy do `odchozi_posta` a pokus o odeslání.
//
// Stejný postup jako potvrzení přihlášky v `prijmout-prihlasku`:
//   1. Zpráva se VŽDYCKY nejdřív odloží do tabulky. Je z toho záznam,
//      co komu odešlo, a nic se neztratí, když odeslání selže.
//   2. Když má funkce čím poslat (Resend, Outlook, Gmail), pošle hned.
//      Když ne, řádek zůstane ve stavu `ceka` a vyzvedne si ho Make.
//
// Chybu nevyhazuje. Odeslání pošty nesmí shodit uložení zápisu.

import { kdoOdesila, posli, type Zprava } from './posta.ts';

export interface VysledekOdeslani {
  /** Zpráva odešla hned z funkce. */
  odeslano: boolean;
  /** Řádek v `odchozi_posta`, nebo `null`, když se ho nepovedlo založit. */
  postaId: string | null;
  /** Přes koho pošta odchází. `nikdo` znamená, že čeká na Make. */
  pres: ReturnType<typeof kdoOdesila>;
}

export async function zaradAPosli(
  // deno-lint-ignore no-explicit-any
  klient: any,
  zprava: Zprava,
  prihlaskaId: string | null,
): Promise<VysledekOdeslani> {
  const pres = kdoOdesila();

  const { data: odlozeno, error } = await klient
    .from('odchozi_posta')
    .insert({
      prihlaska_id: prihlaskaId,
      prijemce: zprava.prijemce,
      prijemce_jmeno: zprava.prijemceJmeno ?? null,
      odpovedet_na: zprava.odpovedetNa ?? Deno.env.get('ODPOVEDET_NA') ?? null,
      predmet: zprava.predmet,
      telo_text: zprava.text,
      telo_html: zprava.html ?? null,
    })
    .select('id')
    .single();

  if (error) {
    console.error(`Zprávu pro ${zprava.prijemce} se nepovedlo odložit.`, error);
  }
  const postaId: string | null = odlozeno?.id ?? null;

  if (pres === 'nikdo') {
    console.log('Zpráva čeká v odchozí poště, funkce nemá nastavené odesílání.');
    return { odeslano: false, postaId, pres };
  }

  const odeslano = await posli({
    ...zprava,
    odpovedetNa: zprava.odpovedetNa ?? Deno.env.get('ODPOVEDET_NA') ?? null,
  });

  if (postaId) {
    await klient
      .from('odchozi_posta')
      .update(
        odeslano
          ? { stav: 'odeslano', odeslano_kdy: new Date().toISOString(), pokusu: 1 }
          : { stav: 'ceka', pokusu: 1, chyba_text: 'Odeslání z funkce selhalo.' },
      )
      .eq('id', postaId);
  }

  return { odeslano, postaId, pres };
}

/** Escapování pro HTML e-mailu. */
export function e(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
