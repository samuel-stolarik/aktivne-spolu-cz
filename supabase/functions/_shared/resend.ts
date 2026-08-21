// Odesílání pošty přes Resend.
//
// Třetí a doporučená cesta vedle gmail.ts a outlook.ts. Vybírá se v posta.ts.
//
// PROČ PRÁVĚ TAHLE
// Gmail i Outlook stojí na OAuth: registrace aplikace, klientské tajemství,
// refresh token. Tajemství u Microsoftu vyprší po dvou letech a e-maily pak
// tiše přestanou chodit — dlouho po tom, co dodavatel z projektu odejde,
// a opravit to umí jen vývojář. Resend má obyčejný API klíč, který nevyprší.
//
// DRUHÝ DŮVOD: ODESÍLATEL JE PROJEKT, NE ČLOVĚK
// Pošta chodí z domény projektu (info@aktivne-spolu.cz), ne z osobní schránky.
// Přežije to výměnu člověka v organizaci. Odpovědi se dají nasměrovat komukoli
// přes `ODPOVEDET_NA` — příjemce klikne „odpovědět" a napíše skutečné osobě.
//
// CO JE POTŘEBA NASTAVIT
//   RESEND_API_KEY     klíč z resend.com (začíná re_)
//   ODESILATEL_EMAIL   adresa na ověřené doméně
//   ODESILATEL_JMENO   nepovinné, jméno vedle adresy
//   ODPOVEDET_NA       nepovinné, kam mají chodit odpovědi
//
// DOMÉNA MUSÍ BÝT OVĚŘENÁ. V Resendu se přidá doména a on vypíše záznamy
// SPF a DKIM do DNS. Bez nich odmítne odeslat. Ty záznamy pro aktivne-spolu.cz
// stejně potřebujeme, ať pošta nekončí ve spamu — je to práce, která se dělá
// tak jako tak.

import type { Priloha, Zprava } from './posta.ts';

const API = 'https://api.resend.com/emails';

export interface NastaveniResendu {
  apiKlic: string;
  odesilatelEmail: string;
  odesilatelJmeno: string | null;
  odpovedetNa: string | null;
}

export function nactiNastaveniResendu(): NastaveniResendu | null {
  const apiKlic = Deno.env.get('RESEND_API_KEY');
  const odesilatelEmail = Deno.env.get('ODESILATEL_EMAIL');

  if (!apiKlic || !odesilatelEmail) return null;

  return {
    apiKlic,
    odesilatelEmail,
    odesilatelJmeno: Deno.env.get('ODESILATEL_JMENO') ?? null,
    odpovedetNa: Deno.env.get('ODPOVEDET_NA') ?? null,
  };
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

function prilohaProResend(p: Priloha) {
  return { filename: p.nazev, content: naBase64(p.data) };
}

/**
 * Odešle zprávu. Vyhazuje výjimku, když se to nepovede — volající se musí
 * rozhodnout, jestli je to důvod celou operaci zrušit (u přihlášky není).
 *
 * @returns Identifikátor zprávy. Hodí se do logu i k dohledání v Resendu.
 */
export async function odesliPresResend(
  n: NastaveniResendu,
  z: Zprava,
): Promise<string> {
  const odesilatel = n.odesilatelJmeno
    ? `${n.odesilatelJmeno} <${n.odesilatelEmail}>`
    : n.odesilatelEmail;

  const telo: Record<string, unknown> = {
    from: odesilatel,
    to: [z.prijemce],
    subject: z.predmet,
    // Obě verze naráz. Na rozdíl od Microsoft Graphu to Resend umí, takže
    // kdo má v poštovním programu vypnuté HTML, dostane čitelný text.
    text: z.text,
  };

  if (z.html) telo.html = z.html;

  const odpovedetNa = z.odpovedetNa ?? n.odpovedetNa;
  if (odpovedetNa) telo.reply_to = odpovedetNa;

  const prilohy = z.prilohy ?? [];
  if (prilohy.length > 0) telo.attachments = prilohy.map(prilohaProResend);

  const odpoved = await fetch(API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${n.apiKlic}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(telo),
  });

  if (!odpoved.ok) {
    // Odpověď patří do hlášky celá. Resend v ní posílá důvod (neověřená
    // doména, špatný klíč), bez kterého se to hledá zbytečně dlouho.
    throw new Error(
      `Resend odmítl odeslání (${odpoved.status}): ${(await odpoved.text()).slice(0, 500)}`,
    );
  }

  const data = await odpoved.json();
  return String(data.id ?? '');
}
