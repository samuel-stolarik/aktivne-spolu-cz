-- Zásobník nápadů — úpravy podle zpětné vazby zadavatelky (e-mail 18. 11. 2026).
--
-- CO SE MĚNÍ
--   1. Typ akce: „Ostatní" (klíč `ostatni`) je nově „Společenská akce"
--      (klíč `spolecenska`) se stejnými upřesněními. Přibyl typ „Jiná"
--      (klíč `jina`) bez upřesnění, jen s vlastním textem: ukládá se
--      jako podtyp `jine` + `podtyp_jine`.
--   2. Náročnost se ve formuláři už nevyplňuje. Sloupec `narocnost` ZŮSTÁVÁ
--      i s daty, jen přestal být povinný.
--   3. „Pro koho je akce vhodná" (sloupec `vek`): volba `bez-omezeni` zmizela
--      a převádí se na `vsechny`, přibyla `firmy`. Klíče `rodiny` a `vsechny`
--      zůstaly, změnily se jen jejich názvy (Rodiny, Všechny skupiny).
--   4. Nové sloupce `misto_konani`, `rozpocet` a `poznamka`. Ve formuláři
--      jsou první dva povinné, v databázi ne: starší zápisy je nemají
--      a na webu u nich stojí „neuvedeno".
--   5. Úpravy textů správcem: kdo a kdy upravil (`texty_upravil`,
--      `texty_upraveno_kdy`) a podrobný záznam každé změny v `napady_upravy`.
--
-- Klíče musí sedět se supabase/functions/_shared/ciselnik-napadu.ts.
-- Migrace jde pustit opakovaně (drop … if exists, add … if not exists).

-- ---------------------------------------------------------------------------
-- 1. Staré podmínky pryč, aby šly převést hodnoty
-- ---------------------------------------------------------------------------
alter table public.napady
  drop constraint if exists napady_typ_check,
  drop constraint if exists napady_check,           -- podtyp podle typu
  drop constraint if exists napady_podtyp_check,
  drop constraint if exists napady_vek_check,
  drop constraint if exists napady_narocnost_check;

-- ---------------------------------------------------------------------------
-- 2. Převod existujících hodnot
-- ---------------------------------------------------------------------------
update public.napady set typ = 'spolecenska' where typ = 'ostatni';

-- „Bez omezení" → „Všechny skupiny", bez zdvojení, pořadí zůstane.
update public.napady
set vek = (
  select array_agg(v order by min_poradi)
  from (
    select case when x = 'bez-omezeni' then 'vsechny' else x end as v,
           min(poradi) as min_poradi
    from unnest(vek) with ordinality as t(x, poradi)
    group by 1
  ) s
)
where 'bez-omezeni' = any (vek);

-- ---------------------------------------------------------------------------
-- 3. Nové podmínky
-- ---------------------------------------------------------------------------
alter table public.napady
  add constraint napady_typ_check
    check (typ in ('kulturni', 'pohyb', 'spolecenska', 'jina')),
  add constraint napady_podtyp_check check (
    (typ = 'kulturni' and podtyp in
      ('zpev', 'tanec', 'vytvarne', 'divadlo', 'cteni', 'vystava', 'jine'))
    or (typ = 'pohyb' and podtyp in
      ('turistika', 'olympiada', 'venkovni-hry', 'prochazka',
       'nordic-walking', 'sjizdeni-reky', 'plavani', 'jine'))
    or (typ = 'spolecenska' and podtyp in
      ('kviz', 'hospodsky-kviz', 'prednaska', 'host', 'strelba-prakem',
       'povidani', 'karty-hry', 'jine'))
    -- Jiná nemá upřesnění, jen vlastní text („Jaká akce to byla?").
    or (typ = 'jina' and podtyp = 'jine')
  ),
  add constraint napady_vek_check check (
    cardinality(vek) >= 1
    and vek <@ array['predskolaci', 'skolaci', 'stredoskolaci', 'rodiny',
                     'mladsi-dospeli', 'firmy', 'seniori', 'vsechny']
  );

-- Náročnost: data zůstávají, sloupec už není povinný a nové zápisy ho nevyplňují.
alter table public.napady alter column narocnost drop not null;
alter table public.napady
  add constraint napady_narocnost_check
    check (narocnost is null or narocnost in ('jednoducha', 'stredni', 'narocna'));
comment on column public.napady.narocnost is
  'Od 20. 11. 2026 se nevyplňuje (zadavatelka náročnost z formuláře vyřadila). Starší data zůstávají.';

-- ---------------------------------------------------------------------------
-- 4. Nová pole
-- ---------------------------------------------------------------------------
alter table public.napady
  add column if not exists misto_konani text,
  add column if not exists rozpocet text,
  add column if not exists poznamka text;

alter table public.napady
  drop constraint if exists napady_misto_konani_check,
  drop constraint if exists napady_rozpocet_check,
  drop constraint if exists napady_poznamka_check;

alter table public.napady
  add constraint napady_misto_konani_check
    check (misto_konani is null or misto_konani in ('venku', 'uvnitr', 'oboji')),
  add constraint napady_rozpocet_check
    check (rozpocet is null or rozpocet in ('zadny', 'do-500', '500-1000', 'vic-1000')),
  add constraint napady_poznamka_check
    check (poznamka is null or char_length(poznamka) <= 300);

comment on column public.napady.misto_konani is 'Místo konání: venku, uvnitr, oboji.';
comment on column public.napady.rozpocet is 'Rozpočet na akci (celkové náklady pořadatele): zadny, do-500, 500-1000, vic-1000.';
comment on column public.napady.poznamka is
  'Poznámka/komentář pořadatele. VEŘEJNÁ (zobrazí se u nápadu), do 300 znaků. Neveřejný je jen `vzkaz`.';

-- ---------------------------------------------------------------------------
-- 5. Úpravy textů správcem
-- ---------------------------------------------------------------------------
alter table public.napady
  add column if not exists texty_upravil text,
  add column if not exists texty_upraveno_kdy timestamptz;

comment on column public.napady.texty_upravil is
  'Přihlašovací e-mail správce, který naposledy opravil texty. Na webu se nezobrazuje.';

-- Každá změněná hodnota jako jeden řádek: co bylo předtím a co je teď.
-- Když pořadatel zápis po vrácení pošle znovu, záznam zůstane.
create table if not exists public.napady_upravy (
  id uuid primary key default gen_random_uuid(),
  napad_id uuid not null references public.napady (id) on delete cascade,
  upraveno timestamptz not null default now(),
  upravil text not null,
  pole text not null
    check (pole in ('nazev_akce', 'popis', 'pomucky_jake', 'poznamka', 'podtyp_jine')),
  puvodni text,
  nove text
);

comment on table public.napady_upravy is
  'Záznam oprav textů nápadů správcem: kdo, kdy, které pole, původní a nová hodnota.';

create index if not exists napady_upravy_napad_idx
  on public.napady_upravy (napad_id, upraveno desc);

-- Stejné zabezpečení jako zbytek: RLS vynucené, žádná policy, žádná práva.
alter table public.napady_upravy enable row level security;
alter table public.napady_upravy force row level security;
revoke all on public.napady_upravy from anon, authenticated;
