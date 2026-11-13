// E-maily Zásobníku nápadů: výzva k zápisu, vrácení k úpravě, zveřejnění.
//
// Texty jsou NÁVRH k odsouhlasení zadavatelkou. Vykání, krátké věty,
// bez anglicismů. Podpis se bere z nastavení (ZASOBNIK_PODPIS), aby šel
// změnit bez zásahu do kódu.

import { e } from './fronta-posty.ts';
import type { Zprava } from './posta.ts';

const WEB = (Deno.env.get('WEB_URL') ?? 'https://aktivne-spolu.cz').replace(/\/+$/, '');

/** Podpis pod e-maily. Řádky odděluje `|`. */
function podpisRadky(): string[] {
  return (Deno.env.get('ZASOBNIK_PODPIS') ?? 'Hana Čepová|Právě teď! o.p.s.')
    .split('|')
    .map((r) => r.trim())
    .filter(Boolean);
}

export function datumCesky(d: Date): string {
  // Bez časové zóny serveru: počítá se v Praze.
  const casti = new Intl.DateTimeFormat('cs-CZ', {
    timeZone: 'Europe/Prague',
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  }).formatToParts(d);
  const v = (t: string) => casti.find((c) => c.type === t)?.value ?? '';
  return `${v('day')}. ${v('month')}. ${v('year')}`;
}

/** Jednoduchá HTML obálka ve stylu webu. */
function obal(
  odstavce: string[],
  tlacitko?: { text: string; odkaz: string },
  poTlacitku: string[] = [],
): string {
  const odst = (o: string) =>
    `<p style="margin:0 0 16px;font-size:17px;line-height:1.55;color:#45443f;">${o}</p>`;
  const p = odstavce.map(odst).join('\n');
  const za = poTlacitku.map(odst).join('\n');
  const t = tlacitko
    ? `<p style="margin:24px 0;"><a href="${e(tlacitko.odkaz)}" style="display:inline-block;background:#e1252b;color:#ffffff;text-decoration:none;font-weight:600;font-size:17px;padding:14px 24px;border-radius:10px;">${e(tlacitko.text)}</a></p>
<p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#6b6a63;">Když tlačítko nefunguje, zkopírujte do prohlížeče tuto adresu:<br><a href="${e(tlacitko.odkaz)}" style="color:#12707f;word-break:break-all;">${e(tlacitko.odkaz)}</a></p>`
    : '';
  const podpis = podpisRadky().map(e).join('<br>');
  return `<!doctype html><html lang="cs"><body style="margin:0;padding:0;background:#fdfcfa;">
<div style="max-width:600px;margin:0 auto;padding:24px 20px;font-family:'Source Sans 3',Arial,sans-serif;">
${p}
${t}
${za}
<p style="margin:24px 0 0;font-size:17px;line-height:1.55;color:#45443f;">${podpis}</p>
</div></body></html>`;
}

function textovyPodpis(): string {
  return podpisRadky().join('\n');
}

function osloveni(jmeno: unknown): string {
  const j = String(jmeno ?? '').trim();
  return j ? `Dobrý den, ${j},` : 'Dobrý den,';
}

// ---------------------------------------------------------------------------

export interface PrihlaskaProEmail {
  email: string;
  kontaktni_osoba: string;
}

/** Výzva k zápisu po akci s osobním odkazem. */
export function emailVyzvy(
  p: PrihlaskaProEmail,
  token: string,
  platnostDo: Date,
  prijemce = p.email,
): Zprava {
  const odkaz = `${WEB}/zapis/#t=${token}`;
  const do_ = datumCesky(platnostDo);
  const predmet = 'Podělte se o svou akci v Zásobníku nápadů';

  const text = [
    osloveni(p.kontaktni_osoba),
    '',
    'děkujeme, že jste se zapojili do kampaně Mezigeneračně aktivně spolu. Z uspořádaných akcí teď vzniká Zásobník nápadů: veřejný přehled ověřených nápadů, ze kterého se mohou inspirovat další školy, spolky a firmy.',
    '',
    'Podělte se o tu svou. Zabere to asi 10 minut. Údaje z registrace už jsou ve formuláři vyplněné, doplníte jen popis akce a 1 až 5 fotek.',
    '',
    `Vyplnit zápis o akci: ${odkaz}`,
    `Odkaz platí do ${do_}. Je jen pro vás, prosím ho nikomu nepřeposílejte.`,
    '',
    'Zápis před zveřejněním zkontrolujeme. Kdyby bylo potřeba něco upravit, ozveme se.',
    '',
    textovyPodpis(),
  ].join('\n');

  const html = obal(
    [
      e(osloveni(p.kontaktni_osoba)),
      'děkujeme, že jste se zapojili do kampaně Mezigeneračně aktivně spolu. Z uspořádaných akcí teď vzniká <strong>Zásobník nápadů</strong>: veřejný přehled ověřených nápadů, ze kterého se mohou inspirovat další školy, spolky a firmy.',
      'Podělte se o tu svou. Zabere to asi 10 minut. Údaje z registrace už jsou ve formuláři vyplněné, doplníte jen popis akce a 1 až 5 fotek.',
    ],
    { text: 'Vyplnit zápis o akci', odkaz },
    [
      `Odkaz platí do ${e(do_)}. Je jen pro vás, prosím ho nikomu nepřeposílejte.`,
      'Zápis před zveřejněním zkontrolujeme. Kdyby bylo potřeba něco upravit, ozveme se.',
    ],
  );

  return { prijemce, prijemceJmeno: p.kontaktni_osoba, predmet, text, html };
}

/** Zápis vrácený k úpravě. Obsahuje nový osobní odkaz. */
export function emailVraceni(
  p: PrihlaskaProEmail,
  nazevAkce: string,
  duvod: string,
  token: string,
  platnostDo: Date,
): Zprava {
  const odkaz = `${WEB}/zapis/#t=${token}`;
  const predmet = `Prosíme o úpravu zápisu: ${nazevAkce}`;
  const text = [
    osloveni(p.kontaktni_osoba),
    '',
    `děkujeme za zápis „${nazevAkce}“. Než ho zveřejníme, prosíme o úpravu:`,
    '',
    duvod,
    '',
    `Upravit zápis: ${odkaz}`,
    `Odkaz platí do ${datumCesky(platnostDo)}.`,
    '',
    textovyPodpis(),
  ].join('\n');
  const html = obal(
    [
      e(osloveni(p.kontaktni_osoba)),
      `děkujeme za zápis „${e(nazevAkce)}“. Než ho zveřejníme, prosíme o úpravu:`,
      `<span style="display:block;background:#fbf1dc;border-radius:10px;padding:12px 16px;">${e(duvod).replaceAll('\n', '<br>')}</span>`,
    ],
    { text: 'Upravit zápis', odkaz },
    [`Odkaz platí do ${e(datumCesky(platnostDo))}.`],
  );
  return { prijemce: p.email, prijemceJmeno: p.kontaktni_osoba, predmet, text, html };
}

/** Zápis je schválený a veřejný. */
export function emailZverejneni(
  p: PrihlaskaProEmail,
  nazevAkce: string,
  napadId: string,
): Zprava {
  const odkaz = `${WEB}/zasobnik/?id=${encodeURIComponent(napadId)}`;
  const predmet = `Váš nápad je v Zásobníku: ${nazevAkce}`;
  const text = [
    osloveni(p.kontaktni_osoba),
    '',
    `váš zápis „${nazevAkce}“ jsme schválili a je teď v Zásobníku nápadů. Děkujeme, že se dělíte o své zkušenosti.`,
    '',
    `Podívat se na nápad: ${odkaz}`,
    '',
    textovyPodpis(),
  ].join('\n');
  const html = obal(
    [
      e(osloveni(p.kontaktni_osoba)),
      `váš zápis „${e(nazevAkce)}“ jsme schválili a je teď v Zásobníku nápadů. Děkujeme, že se dělíte o své zkušenosti.`,
    ],
    { text: 'Podívat se na nápad', odkaz },
  );
  return { prijemce: p.email, prijemceJmeno: p.kontaktni_osoba, predmet, text, html };
}
