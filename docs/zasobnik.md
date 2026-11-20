# Zásobník nápadů

Veřejná databáze ověřených nápadů na mezigenerační akce. Nápady vznikají ze
zápisů, které po akci posílají registrovaní pořadatelé.

## Jak to jde za sebou

1. **Výzva.** Správce v `/admin/` → záložka *Zásobník nápadů* → *Výzvy
   pořadatelům* pošle pořadateli e-mail s osobním odkazem
   `/zapis/#t=<token>`. Token je v databázi jen jako SHA-256 a odkaz platí
   60 dní. Nová výzva zruší starší odkaz téže přihlášky.
2. **Zápis.** Pořadatel otevře odkaz a projde 8 kroků (poslední je shrnutí). Údaje z registrace
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

## Pole a nepotvrzené předpoklady

Hodnoty, názvy polí i rozhodnutí, která zadavatelka zatím nepotvrdila, jsou
na jednom místě v `supabase/functions/_shared/ciselnik-napadu.ts`:

| Co | Konstanta | Teď |
|---|---|---|
| Upřesnění u typu akce | `TYPY[].podtypy` | Kulturní, Pohyb a sport a Společenská akce mají upřesnění, Jiná jen text |
| Poznámka/komentář je veřejná | `POZNAMKA_JE_VEREJNA` | ano, do 300 znaků |
| Rozpočet = celkové náklady pořadatele | `ROZPOCET_NAPOVEDA` | ano |
| Zdatnost seniorů, víc odpovědí | `ZDATNOST_VICE_VOLEB` | ne, jedna odpověď |
| Ve filtru víc hodnot ve skupině | `FILTR_VICE_VOLEB` | ano |
| Názvy polí | `POPISKY` | doslova podle e-mailu z 18. 11. 2026 |

Náročnost se od 20. 11. 2026 nevyplňuje. Sloupec `napady.narocnost` zůstal
i s daty. Starší zápisy bez nových polí ukazují „neuvedeno“.

## Administrace

- **Opravit texty**: název, popis, jaké pomůcky, poznámka a vlastní popis
  typu. Ukládá `admin-obsah` (akce `uprav-napad`), každá změna se zapíše
  do `napady_upravy` (kdo, kdy, původní a nová hodnota). Na webu se úprava
  neukazuje.
- **Náhled**: `/zasobnik/?nahled=<id>` vykreslí kartu i detail nápadu
  v jakémkoli stavu přesně jako na webu. Data dá jen přihlášenému správci.
- **Vrátit k rozhodnutí**: schválený, vrácený i zamítnutý zápis jde zpátky
  do stavu „čeká na kontrolu“. Pořadatel nedostane e-mail.
- **Stáhnout zápisy do Excelu (CSV)** podle filtru „Zobrazit“.

## Nasazení

```bash
npx supabase link --project-ref kourmwqxkhdtahbxyuaq
# POZOR: historie migrací v ostrém projektu není úplná (migrace od
# 20260821140000 do 20261112120000 se pouštěly ručně). `db push` by je
# zkusil přehrát znovu. Novou migraci proto pouštějte samostatně:
npx supabase db query --remote -f supabase/migrations/<nova>.sql
npx supabase migration repair --remote --status applied <cislo>
npx supabase secrets set ZASOBNIK_UPOZORNENI_EMAIL=... WEB_URL=https://aktivne-spolu.cz
npx supabase functions deploy zapis-napadu
npx supabase functions deploy verejne-napady
npx supabase functions deploy admin-obsah
npm run zip   # a nahrát na FTP podle README
```

## Spuštění

Zadavatelka Zásobník odsouhlasila 18. 11. 2026, naostro běží od 20. 11. 2026:
`/zasobnik/` je bez `noindex` a v sitemapě, tlačítko v hlavičce vede na
Zásobník. `/zapis/` zůstává skrytý (jen osobní odkazy z e-mailu).
