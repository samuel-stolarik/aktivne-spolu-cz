// Odesílání pošty — jedny dveře pro Outlook i Gmail.
//
// Zbytek kódu nemá vědět, přes koho pošta odchází. Ptá se jen „pošli tuhle
// zprávu" a tenhle soubor vybere podle toho, co je vyplněné v nastavení.
//
// PROČ JE MOŽNOST VOLBY, KDYŽ SE POUŽIJE JEN JEDNA
// Projekt začínal na Gmailu a skončil u Outlooku, protože ho má organizace,
// která web převezme. Kdyby se to někdy vrátilo zpátky nebo se měnil
// poskytovatel při stěhování, mění se jedno nastavení, ne kód.
//
// POŘADÍ VOLBY: Outlook má přednost. Když jsou vyplněné oba, jede Outlook —
// je to ten, na kterém se domluvilo. Gmail zůstává jako záloha.
//
// KDYŽ NENÍ VYPLNĚNÉ NIC, pošta se NEODESÍLÁ a NIC NESPADNE. Přihláška se
// uloží, variabilní symbol se přidělí, QR kód se zobrazí — do logu se zapíše,
// že e-mail nemá kudy odejít. Je to schválně: ztratit přihlášku kvůli tomu,
// že zrovna nejede pošta, by bylo mnohem horší než potvrzení se zpožděním.

import { nactiNastaveniGmailu, odesliEmail } from './gmail.ts';
import { nactiNastaveniOutlooku, odesliPresOutlook } from './outlook.ts';

export interface Priloha {
  /** Název, pod kterým se soubor příjemci uloží. */
  nazev: string;
  /** Typ obsahu, například `application/pdf`. */
  typ: string;
  data: Uint8Array;
}

export interface Zprava {
  prijemce: string;
  prijemceJmeno?: string | null;
  predmet: string;
  /** Prostý text. Gmail ho pošle jako druhou verzi, Outlook jen jako záložní. */
  text: string;
  /** HTML verze. */
  html?: string | null;
  /** Adresa pro odpověď, když je jiná než odesílatel. */
  odpovedetNa?: string | null;
  prilohy?: Priloha[];
}

/** Přes koho pošta odchází. Hodí se do logu, ať je při hledání chyby jasno. */
export type Odesilatel = 'outlook' | 'gmail' | 'nikdo';

export function kdoOdesila(): Odesilatel {
  if (nactiNastaveniOutlooku()) return 'outlook';
  if (nactiNastaveniGmailu()) return 'gmail';
  return 'nikdo';
}

/**
 * Odešle zprávu tím, co je nastavené.
 *
 * @returns `true` když zpráva odešla. Chybu nevyhazuje — zaloguje ji
 *          a vrátí `false`, protože odeslání pošty nikdy nesmí shodit
 *          příjem přihlášky.
 */
export async function posli(z: Zprava): Promise<boolean> {
  const outlook = nactiNastaveniOutlooku();
  if (outlook) {
    try {
      await odesliPresOutlook(outlook, z);
      console.log(`Odesláno přes Outlook na ${z.prijemce}.`);
      return true;
    } catch (e) {
      console.error('Odeslání přes Outlook selhalo.', e);
      return false;
    }
  }

  const gmail = nactiNastaveniGmailu();
  if (gmail) {
    try {
      const id = await odesliEmail(gmail, z);
      console.log(`Odesláno přes Gmail na ${z.prijemce}, zpráva ${id}.`);
      return true;
    } catch (e) {
      console.error('Odeslání přes Gmail selhalo.', e);
      return false;
    }
  }

  console.warn(
    'E-mail se neodeslal: není vyplněné žádné nastavení pošty. ' +
      'Chybí MS_CLIENT_ID/MS_CLIENT_SECRET/MS_REFRESH_TOKEN/ODESILATEL_EMAIL ' +
      '(Outlook), případně GOOGLE_* (Gmail).',
  );
  return false;
}
