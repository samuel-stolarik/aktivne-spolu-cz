-- Datum konání akce v přihlášce.
--
-- PROČ TAHLE MIGRACE VZNIKLA
-- Původně padlo rozhodnutí datum při registraci NESBÍRAT — mělo se zjistit až
-- po akci z druhého formuláře. Zadavatel to teď vědomě obrací: datum se ptáme
-- rovnou v přihlášce. Důvod je praktický — podle sekce „Jak to funguje" si
-- pořadatel domlouvá termín se seniorským místem DŘÍV, než se registruje
-- (krok 1 a 2 jsou před krokem 3), takže datum v tu chvíli zná. A hlavně:
-- návštěvník mapky se pak dozví nejen KDE, ale i KDY se co chystá.
--
-- Tabulka `prihlasky` se tím rozšiřuje o jeden sloupec. Zabezpečení zůstává
-- beze změny — zapnuté a vynucené RLS bez jediné policy, `anon`
-- i `authenticated` mají dál nula oprávnění. Viz sekce ZABEZPEČENÍ dole.

-- ---------------------------------------------------------------------------
-- SLOUPEC
-- ---------------------------------------------------------------------------
-- Typ `date`, ne `timestamptz`. Ptáme se na DEN konání, ne na hodinu. Kdyby
-- to byl časový údaj s pásmem, akce zadaná na 1. 10. by se v UTC uložila jako
-- 30. 9. večer a v přehledech by se o den rozcházela s tím, co člověk vyplnil.
--
-- Schválně BEZ `not null`:
--   * V databázi už jsou řádky z doby, kdy se datum nesbíralo (ukázkové akce
--     pro mapku), a mazat je nechceme.
--   * Povinnost pole hlídá Edge Funkce `prijmout-prihlasku`, která umí říct
--     česky, co přesně chybí. Databázová chyba `null value violates not-null
--     constraint` by se návštěvníkovi ukázat nedala.
--   * Kdyby zadavatel jednou chtěl mít pole nepovinné, obejde se to bez další
--     migrace — přepne se jedna konstanta v Edge Funkci a jedna ve sdíleném
--     souboru pro formuláře. Podrobně je to popsané u obou konstant.
alter table public.prihlasky
  add column if not exists datum_akce date;

-- ---------------------------------------------------------------------------
-- ROZUMNÉ ROZMEZÍ
-- ---------------------------------------------------------------------------
-- Akce se konají „v týdnu kolem 1. října" — to je zadání, ne přesné datum.
-- Kolem 1. 10. 2026 vychází týden na 28. 9. až 4. 10.
--
-- ROZMEZÍ JE PŘESTO ŠIROKÉ: 1. 9. 2026 až 31. 10. 2026, tedy celé září
-- a celý říjen. Důvod je jediný a je důležitější než přesnost:
--
--   FORMULÁŘ NESMÍ ODMÍTNOUT ČLOVĚKA, KTERÝ SE OPRAVDU CHCE ZAPOJIT.
--
-- Kdo uspořádá setkání 5. října, protože se s domovem pro seniory na dřívějším
-- termínu nedomluvil, do projektu patří úplně stejně jako ten, kdo to stihne
-- přesně 1. 10. Podmínka je proto jen POJISTKA PROTI NESMYSLU (překlep v roce,
-- datum narození místo data akce, loňský termín), ne nástroj na vymáhání
-- termínu. Slovní doporučení „v týdnu kolem 1. 10." je ve formuláři pod polem
-- jako nápověda — tam patří, ne do databázové podmínky.
--
-- ROČNÍK 2026. Rozmezí je schválně napsané konkrétními daty, ne vzorcem přes
-- „aktuální rok". Web je postavený na jeden ročník a konkrétní datum je vidět
-- na první pohled. Pro další ročník se rozmezí mění na TŘECH místech, která
-- na sebe navzájem odkazují:
--   1. tahle podmínka,
--   2. `OBDOBI_OD` / `OBDOBI_DO` v supabase/functions/prijmout-prihlasku/index.ts,
--   3. `OBDOBI_OD` / `OBDOBI_DO` v src/lib/datumAkce.ts (obojí pro formuláře).
--
-- `datum_akce is null` podmínku projde — prázdné datum řeší povinnost pole
-- v Edge Funkci, ne tahle podmínka (viz komentář u sloupce výš).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.prihlasky'::regclass
      and conname = 'prihlasky_datum_akce_obdobi'
  ) then
    alter table public.prihlasky
      add constraint prihlasky_datum_akce_obdobi
      check (
        datum_akce is null
        or (datum_akce >= date '2026-09-01' and datum_akce <= date '2026-10-31')
      );
  end if;
end;
$$;

comment on column public.prihlasky.datum_akce is
  'Den, kdy se mezigenerační setkání koná. Rozmezí 1. 9. – 31. 10. 2026 je široká pojistka proti překlepu, ne vymáhání termínu — doporučení „týden kolem 1. 10." je jen nápověda ve formuláři.';

-- Index se schválně nezakládá. Podle data se nefiltruje ani neřadí v dotazu —
-- administrace si načte přihlášky celé (jsou jich stovky, ne miliony) a řadí
-- je v prohlížeči. Index by tu byl jen náklad při každém zápisu.

-- ---------------------------------------------------------------------------
-- UKÁZKOVÉ AKCE
-- ---------------------------------------------------------------------------
-- V databázi je pět ukázkových akcí (e-maily na `@ukazka.test`, variabilní
-- symboly 999901–999905). Vznikly kvůli tomu, aby šlo ukázat, jak bude mapka
-- vypadat, až se lidé začnou hlásit — smaže je `npm run smaz-ukazku` před
-- ostrým provozem.
--
-- Doplňujeme jim datum, jinak by po téhle změně na mapce svítilo „kde" bez
-- „kdy" a ukázka by vypadala rozbitě. Termíny jsou schválně rozházené kolem
-- 1. 10. včetně 5. 10. — ať je na ukázce vidět, že pozdější termín je v
-- pořádku a formulář ho přijme.
--
-- Aktualizuje se JEN ukázková data (`@ukazka.test`) a jen tam, kde datum ještě
-- není. Skutečných přihlášek se to nedotkne ani při opakovaném spuštění.
update public.prihlasky set datum_akce = date '2026-10-01'
  where email = 'ukazka999901@ukazka.test' and datum_akce is null;
update public.prihlasky set datum_akce = date '2026-10-02'
  where email = 'ukazka999902@ukazka.test' and datum_akce is null;
update public.prihlasky set datum_akce = date '2026-09-30'
  where email = 'ukazka999903@ukazka.test' and datum_akce is null;
update public.prihlasky set datum_akce = date '2026-10-05'
  where email = 'ukazka999904@ukazka.test' and datum_akce is null;
update public.prihlasky set datum_akce = date '2026-10-01'
  where email = 'ukazka999905@ukazka.test' and datum_akce is null;

-- ---------------------------------------------------------------------------
-- ZABEZPEČENÍ
-- ---------------------------------------------------------------------------
-- Datum konání NENÍ osobní údaj — je to informace o veřejné akci, stejně jako
-- město a kraj. Půjde proto ven i na veřejnou mapku (Edge Funkce
-- `verejne-akce`, kde je nový sloupec výslovně dopsaný do seznamu
-- `SLOUPCE_PRO_MAPU`).
--
-- Co se tím NEMĚNÍ:
--   * `prihlasky` mají dál zapnuté i vynucené RLS a ani jednu policy.
--   * `anon` i `authenticated` mají dál nula oprávnění — k datům se dostanou
--     výhradně Edge Funkce servisním klíčem.
--   * `verejne-akce` dál NEPOSÍLÁ `email`, `telefon`, `kontaktni_osoba`,
--     `variabilni_symbol` ani fakturační údaje a u `typ_poradatele
--     = 'jednotlivec'` neposílá ani `nazev_poradatele`.
--
-- Pro jistotu se oprávnění odebírají znovu. Kdyby je někdo mezitím omylem
-- přidal, tenhle řádek to vrátí zpátky.
revoke all on public.prihlasky from anon, authenticated;
