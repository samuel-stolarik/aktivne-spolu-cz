// Odesílání pošty přes Outlook / Microsoft 365.
//
// Protějšek gmail.ts. Obě verze umí totéž a funkce si mezi nimi vybírá podle
// toho, co je vyplněné v nastavení — viz posta.ts.
//
// PROČ JE TO O TOLIK KRATŠÍ NEŽ GMAIL
// Gmail chce celou zprávu poskládanou ve formátu MIME: hranice mezi díly,
// hlavičky, base64 po sedmdesáti šesti znacích. Microsoft Graph bere obyčejný
// JSON a MIME si poskládá sám. Odpadá tím celá vrstva, kde se dá udělat chyba
// (špatná hranice = ztracená příloha, kterou nikdo nepozná).
//
// JEDEN ROZDÍL, KTERÝ STOJÍ ZA ZMÍNKU
// Graph pošle e-mail buď jako text, NEBO jako HTML — ne obojí naráz jako
// dvě verze téhož. Posíláme tedy HTML, protože v něm je faktura přehledná.
// Kdo má v poštovním programu HTML vypnuté, uvidí holý text bez formátování;
// všechny podstatné údaje (částka, číslo účtu, variabilní symbol, splatnost)
// jsou proto psané slovy v textu, ne jen v tabulce nebo v obrázku.
//
// CO JE POTŘEBA NASTAVIT
//   MS_CLIENT_ID       z registrace aplikace v Microsoft Entra
//   MS_CLIENT_SECRET   tamtéž
//   MS_REFRESH_TOKEN   vznikne jednorázovým odsouhlasením přístupu
//   MS_TENANT          ID organizace; „common" funguje pro firemní i osobní účet
//   ODESILATEL_EMAIL   adresa, ze které pošta odchází
//   ODESILATEL_JMENO   nepovinné, jméno vedle adresy
//
// Aplikace potřebuje oprávnění `Mail.Send` a `offline_access`. U firemního
// Microsoftu 365 může první přihlášení vyžadovat souhlas správce — to je
// potřeba vědět dopředu, ne až v den spuštění.

import type { Priloha, Zprava } from './posta.ts';

const GRAPH = 'https://graph.microsoft.com/v1.0';

export interface NastaveniOutlooku {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  tenant: string;
  odesilatelEmail: string;
  odesilatelJmeno: string | null;
}

export function nactiNastaveniOutlooku(): NastaveniOutlooku | null {
  const clientId = Deno.env.get('MS_CLIENT_ID');
  const clientSecret = Deno.env.get('MS_CLIENT_SECRET');
  const refreshToken = Deno.env.get('MS_REFRESH_TOKEN');
  const odesilatelEmail = Deno.env.get('ODESILATEL_EMAIL');

  if (!clientId || !clientSecret || !refreshToken || !odesilatelEmail) return null;

  return {
    clientId,
    clientSecret,
    refreshToken,
    tenant: Deno.env.get('MS_TENANT') ?? 'common',
    odesilatelEmail,
    odesilatelJmeno: Deno.env.get('ODESILATEL_JMENO') ?? null,
  };
}

/**
 * Vymění dlouhodobý refresh token za krátkodobý přístupový token.
 * Přístupový token platí zhruba hodinu, takže se nikam neukládá — funkce
 * běží pár vteřin a příště si řekne o nový.
 */
async function ziskejToken(n: NastaveniOutlooku): Promise<string> {
  const odpoved = await fetch(
    `https://login.microsoftonline.com/${n.tenant}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: n.clientId,
        client_secret: n.clientSecret,
        refresh_token: n.refreshToken,
        grant_type: 'refresh_token',
        scope: 'https://graph.microsoft.com/Mail.Send offline_access',
      }),
    },
  );

  if (!odpoved.ok) {
    // Text odpovědi patří do hlášky celý. Microsoft v něm posílá kód chyby
    // (třeba AADSTS70008 = vypršel refresh token), bez kterého se to hledá
    // hodiny.
    throw new Error(
      `Microsoft nevydal přístupový token (${odpoved.status}): ${await odpoved.text()}`,
    );
  }

  const data = await odpoved.json();
  if (!data.access_token) throw new Error('Microsoft vrátil odpověď bez tokenu.');
  return data.access_token as string;
}

function naBase64(data: Uint8Array): string {
  // Po částech, ne najednou. `String.fromCharCode(...pole)` spadne na velkém
  // souboru, protože se celé pole rozbalí do argumentů funkce.
  let binarne = '';
  const krok = 8192;
  for (let i = 0; i < data.length; i += krok) {
    binarne += String.fromCharCode(...data.subarray(i, i + krok));
  }
  return btoa(binarne);
}

function prilohaProGraph(p: Priloha) {
  return {
    '@odata.type': '#microsoft.graph.fileAttachment',
    name: p.nazev,
    contentType: p.typ,
    contentBytes: naBase64(p.data),
  };
}

/**
 * Odešle zprávu. Vyhazuje výjimku, když se to nepovede — volající se musí
 * rozhodnout, jestli je to důvod celou operaci zrušit (u přihlášky není).
 *
 * @returns Prázdný řetězec. Graph na rozdíl od Gmailu nevrací identifikátor
 *          zprávy; kopie zůstává v Odeslané poště odesílatele.
 */
export async function odesliPresOutlook(
  n: NastaveniOutlooku,
  z: Zprava,
): Promise<string> {
  const token = await ziskejToken(n);

  const zprava: Record<string, unknown> = {
    subject: z.predmet,
    body: { contentType: 'HTML', content: z.html ?? z.text },
    toRecipients: [
      {
        emailAddress: z.prijemceJmeno
          ? { address: z.prijemce, name: z.prijemceJmeno }
          : { address: z.prijemce },
      },
    ],
  };

  if (z.odpovedetNa) {
    zprava.replyTo = [{ emailAddress: { address: z.odpovedetNa } }];
  }

  const prilohy = z.prilohy ?? [];
  if (prilohy.length > 0) {
    zprava.attachments = prilohy.map(prilohaProGraph);
  }

  const odpoved = await fetch(`${GRAPH}/me/sendMail`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    // Kopie se ukládá do Odeslané pošty schválně: když se někdo ozve, že mu
    // nic nepřišlo, je v Outlooku vidět, co a kdy odešlo.
    body: JSON.stringify({ message: zprava, saveToSentItems: true }),
  });

  if (!odpoved.ok) {
    throw new Error(
      `Odeslání přes Outlook selhalo (${odpoved.status}): ${await odpoved.text()}`,
    );
  }

  return '';
}
