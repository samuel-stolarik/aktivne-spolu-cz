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
// POŘADÍ VOLBY: Resend, pak Outlook, pak Gmail. Resend je první schválně —
// jako jediný nestojí na OAuth, takže mu nemá co vypršet. U Microsoftu
// vyprší klientské tajemství po dvou letech a e-maily tiše přestanou chodit;
// oprava je pak na vývojáři, ne na organizaci, která web provozuje.
//
// KDYŽ NENÍ VYPLNĚNÉ NIC, pošta se NEODESÍLÁ a NIC NESPADNE. Přihláška se
// uloží, variabilní symbol se přidělí, QR kód se zobrazí — do logu se zapíše,
// že e-mail nemá kudy odejít. Je to schválně: ztratit přihlášku kvůli tomu,
// že zrovna nejede pošta, by bylo mnohem horší než potvrzení se zpožděním.

import { nactiNastaveniGmailu, odesliEmail } from './gmail.ts';
import { nactiNastaveniOutlooku, odesliPresOutlook } from './outlook.ts';
import { nactiNastaveniResendu, odesliPresResend } from './resend.ts';

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
export type Odesilatel = 'resend' | 'outlook' | 'gmail' | 'nikdo';

export function kdoOdesila(): Odesilatel {
  if (nactiNastaveniResendu()) return 'resend';
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
  const resend = nactiNastaveniResendu();
  if (resend) {
    try {
      const id = await odesliPresResend(resend, z);
      console.log(`Odesláno přes Resend na ${z.prijemce}, zpráva ${id}.`);
      return true;
    } catch (e) {
      console.error('Odeslání přes Resend selhalo.', e);
      return false;
    }
  }

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
      'Chybí RESEND_API_KEY + ODESILATEL_EMAIL (Resend), ' +
      'případně MS_* (Outlook) nebo GOOGLE_* (Gmail).',
  );
  return false;
}
