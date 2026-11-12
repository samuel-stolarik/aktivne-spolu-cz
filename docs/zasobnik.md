# Zásobník nápadů

Veřejná databáze ověřených nápadů na mezigenerační akce. Nápady vznikají ze
zápisů, které po akci posílají registrovaní pořadatelé.

## Jak to jde za sebou

1. **Výzva.** Správce v `/admin/` → záložka *Zásobník nápadů* → *Výzvy
   pořadatelům* pošle pořadateli e-mail s osobním odkazem
   `/zapis/#t=<token>`. Token je v databázi jen jako SHA-256 a odkaz platí
   60 dní. Nová výzva zruší starší odkaz téže přihlášky.
2. **Zápis.** Pořadatel otevře odkaz a vyplní 7 kroků. Údaje z registrace
   jsou předvyplněné. Nahraje 1–5 fotek, které se v prohlížeči zmenší na
   1600 px a uloží jako JPEG bez EXIF a GPS. Zápis se uloží ve stavu `ceka`
   a správce dostane upozornění e-mailem.
3. **Kontrola.** Správce zápis schválí, vrátí k úpravě s důvodem, nebo
   zamítne. Při vrácení dostane pořadatel e-mail s důvodem a novým odkazem.
   Při prvním schválení dostane odkaz na zveřejněný nápad.
4. **Zveřejnění.** `/zasobnik/` ukazuje jen schválené zápisy přes funkci
   `verejne-napady`. Ven nejdou vzkaz, souhlasy ani nic z přihlášky.
   Kontakt jde ven jen ten, se kterým pořadatel souhlasil.

## Kde je co

| Co | Soubor |
|---|---|
| Tabulky `napady`, `vyzvy_k_zapisu`, bucket `napady-fotky` | `supabase/migrations/20261112120000_zasobnik_napadu.sql` |
| Číselník voleb (jeden pro DB, funkce i web) | `supabase/functions/_shared/ciselnik-napadu.ts` |
| Formulář z osobního odkazu | `supabase/functions/zapis-napadu/`, `src/pages/zapis/`, `src/components/zasobnik/zapis.ts` |
| Veřejný výpis | `supabase/functions/verejne-napady/`, `src/pages/zasobnik/`, `src/components/zasobnik/prehled.ts` |
| Administrace | `supabase/functions/admin-obsah/zasobnik.ts`, `src/components/admin/zasobnik.ts` |
| Texty e-mailů | `supabase/functions/_shared/emaily-zasobniku.ts` |

Zabezpečení je stejné jako u přihlášek: RLS zapnuté a vynucené, žádná
policy, `anon` ani `authenticated` nemají na nových tabulkách práva. Bucket
s fotkami je soukromý a fotky jdou ven jen přes podepsané adresy.

## Nasazení

```bash
npx supabase link --project-ref kourmwqxkhdtahbxyuaq
npx supabase db push
npx supabase secrets set ZASOBNIK_UPOZORNENI_EMAIL=... WEB_URL=https://aktivne-spolu.cz
npx supabase functions deploy zapis-napadu
npx supabase functions deploy verejne-napady
npx supabase functions deploy admin-obsah
npm run zip   # a nahrát na FTP podle README
```

## Skryté spuštění

Dokud Zásobník neodsouhlasí zadavatelka:

- `/zasobnik/` a `/zapis/` mají `noindex` a nejsou v sitemapě,
- tlačítko vpravo nahoře v hlavičce pořád vede na registraci.

Po odsouhlasení: v `src/pages/zasobnik/index.astro` smazat `skryta`,
v `astro.config.mjs` pustit `/zasobnik/` do sitemapy a
v `src/components/aktualni/Hlavicka.astro` změnit `tlacitko` na
`{ odkaz: "/zasobnik/", text: "Zásobník nápadů" }`.
