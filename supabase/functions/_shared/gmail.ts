// Odeslání e-mailu přes Gmail / Google Workspace.
//
// Proč zrovna Gmail: schránka pro spolek už existuje a e-maily z ní chodí
// z opravdové adresy, na kterou jde odpovědět. Žádná služba navíc, žádné
// ověřování domény, žádná měsíční platba.
//
// Jak to funguje: v Google Cloudu je jednou provždy vytvořený OAuth klient
// a k němu „refresh token" — dlouhodobé povolení odesílat poštu z jedné
// konkrétní schránky. Ten token se uloží mezi tajné hodnoty funkce a při
// každém odeslání se za něj vymění krátkodobý přístupový token.
// Postup, jak refresh token získat, je popsaný v supabase/README-supabase.md.
//
// Celý modul je bez jediné natvrdo zapsané adresy — všechno chodí z nastavení.

/** Oprávnění, které OAuth klient potřebuje. Nic víc funkce nechce. */
export const GMAIL_SCOPE_ODESILANI = 'https://www.googleapis.com/auth/gmail.send';

export interface NastaveniGmailu {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** Adresa, ze které pošta odchází. Musí patřit ke schránce, která dala souhlas. */
  odesilatelEmail: string;
  /** Jméno odesílatele, které uvidí příjemce. Nepovinné. */
  odesilatelJmeno?: string | null;
}

/**
 * Načte nastavení Gmailu z proměnných prostředí.
 *
 * @returns `null`, když některá hodnota chybí. Není to chyba — e-mail se
 *          přeskočí a přihláška se uloží tak jako tak. Přijít o přihlášku
 *          kvůli nefungující poště by bylo mnohem horší.
 */
export function nactiNastaveniGmailu(): NastaveniGmailu | null {
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');
  const refreshToken = Deno.env.get('GOOGLE_REFRESH_TOKEN');
  const odesilatelEmail = Deno.env.get('ODESILATEL_EMAIL');

  if (!clientId || !clientSecret || !refreshToken || !odesilatelEmail) return null;

  return {
    clientId,
    clientSecret,
    refreshToken,
    odesilatelEmail,
    odesilatelJmeno: Deno.env.get('ODESILATEL_JMENO') ?? null,
  };
}

/**
 * Vymění dlouhodobý refresh token za krátkodobý přístupový token.
 * Přístupový token platí zhruba hodinu, takže se nikam neukládá — funkce
 * běží pár vteřin a příště si řekne o nový.
 */
async function ziskejPristupovyToken(n: NastaveniGmailu): Promise<string> {
  const odpoved = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: n.clientId,
      client_secret: n.clientSecret,
      refresh_token: n.refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!odpoved.ok) {
    throw new Error(`Google odmítl obnovit přihlášení [${odpoved.status}]: ${await odpoved.text()}`);
  }

  const data = await odpoved.json();
  if (!data.access_token) throw new Error('Google nevrátil přístupový token.');
  return data.access_token as string;
}

/** Base64 po částech — najednou by delší e-mail přetekl zásobník. */
function naBase64(bajty: Uint8Array): string {
  let text = '';
  const krok = 0x8000;
  for (let i = 0; i < bajty.length; i += krok) {
    text += String.fromCharCode(...bajty.subarray(i, i + krok));
  }
  return btoa(text);
}

/**
 * Zakóduje hlavičku podle RFC 2047.
 * Bez toho se z „Přihláška" v předmětu stanou otazníky.
 */
function zakodujHlavicku(hodnota: string): string {
  return `=?UTF-8?B?${naBase64(new TextEncoder().encode(hodnota))}?=`;
}

function adresa(email: string, jmeno?: string | null): string {
  return jmeno ? `${zakodujHlavicku(jmeno)} <${email}>` : email;
}

export interface Email {
  prijemce: string;
  prijemceJmeno?: string | null;
  predmet: string;
  /** Prostý text. Uvidí ho ten, kdo má vypnuté HTML. */
  text: string;
  /** HTML verze. Nepovinná — bez ní se pošle jen text. */
  html?: string | null;
  /** Adresa pro odpověď, když je jiná než odesílatel. */
  odpovedetNa?: string | null;
}

/**
 * Sestaví surovou zprávu ve formátu, který Gmail API očekává
 * (celý e-mail jako base64 bezpečný pro URL).
 */
function sestavZpravu(n: NastaveniGmailu, e: Email): string {
  const hranice = `hranice_${crypto.randomUUID().replace(/-/g, '')}`;

  const hlavicky = [
    `From: ${adresa(n.odesilatelEmail, n.odesilatelJmeno)}`,
    `To: ${adresa(e.prijemce, e.prijemceJmeno)}`,
    `Subject: ${zakodujHlavicku(e.predmet)}`,
    'MIME-Version: 1.0',
  ];
  if (e.odpovedetNa) hlavicky.push(`Reply-To: ${e.odpovedetNa}`);

  // Tělo se posílá v base64. Dlouhé řádky s diakritikou by se jinak
  // po cestě polámaly a v e-mailu by zůstaly rozsekané znaky.
  const telo = (obsah: string) => naBase64(new TextEncoder().encode(obsah));

  let radky: string[];

  if (e.html) {
    // Dvě verze téhož: nejdřív text, pak HTML. Poštovní program si vybere.
    radky = [
      ...hlavicky,
      `Content-Type: multipart/alternative; boundary="${hranice}"`,
      '',
      `--${hranice}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      telo(e.text),
      '',
      `--${hranice}`,
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      telo(e.html),
      '',
      `--${hranice}--`,
    ];
  } else {
    radky = [
      ...hlavicky,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      telo(e.text),
    ];
  }

  const surova = new TextEncoder().encode(radky.join('\r\n'));
  return naBase64(surova).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Odešle e-mail. Vyhazuje výjimku, když se to nepovede — volající se musí
 * rozhodnout, jestli je to důvod celou operaci zrušit (u přihlášky není).
 *
 * @returns Identifikátor zprávy v Gmailu, hodí se do logu.
 */
export async function odesliEmail(n: NastaveniGmailu, e: Email): Promise<string> {
  const token = await ziskejPristupovyToken(n);

  const odpoved = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: sestavZpravu(n, e) }),
    },
  );

  if (!odpoved.ok) {
    throw new Error(`Gmail odmítl odeslání [${odpoved.status}]: ${(await odpoved.text()).slice(0, 500)}`);
  }

  const data = await odpoved.json();
  return String(data.id ?? '');
}
