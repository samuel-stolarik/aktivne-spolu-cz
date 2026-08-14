-- Hlídání limitu dotazů na OpenStreetMap (Nominatim).
--
-- PROČ TAHLE MIGRACE VZNIKLA
-- Souřadnice měst se dohledávají ve veřejné službě Nominatim. Její podmínky
-- užití dovolují NEJVÝŠ JEDEN DOTAZ ZA VTEŘINU. Kdo je poruší, dostane zákaz
-- a přestane fungovat dohledávání souřadnic pro celý web.
--
-- Původně limit hlídala fronta uvnitř Edge Funkce. PŘI TESTU SE UKÁZALO, ŽE TO
-- NESTAČÍ: Supabase spouští souběžné požadavky ve VÍC ODDĚLENÝCH PROCESECH
-- a každý má vlastní paměť, tedy i vlastní frontu. Pět požadavků naráz proto
-- odešlo na Nominatim skoro současně a služba nás odmítla (HTTP 429/403).
--
-- Fronta proto musí být na jediném místě, které všechny procesy sdílejí —
-- v databázi. Tahle migrace k tomu přidává jeden řádek a jednu funkci.
--
-- Tabulka `prihlasky` se tím nijak nemění a zabezpečení zůstává, jak bylo.

-- ---------------------------------------------------------------------------
-- KDY SMÍ ODEJÍT DALŠÍ DOTAZ
-- ---------------------------------------------------------------------------
-- Schválně jeden jediný řádek. Není to log dotazů, jen značka „další dotaz
-- nejdřív v tuhle chvíli".
create table if not exists public.nominatim_limit (
  -- Pojistka, že řádek bude vždycky právě jeden. Druhý se do tabulky
  -- nevejde, protože `true` už je obsazené.
  jediny boolean primary key default true check (jediny),

  -- Nejbližší okamžik, kdy se smí zeptat další dotaz.
  volno_od timestamptz not null default now()
);

comment on table public.nominatim_limit is
  'Jeden řádek hlídající limit 1 dotaz/s na Nominatim. Sdílený všemi procesy Edge Funkcí.';

insert into public.nominatim_limit (jediny, volno_od)
values (true, now())
on conflict (jediny) do nothing;

-- ---------------------------------------------------------------------------
-- REZERVACE MÍSTA VE FRONTĚ
-- ---------------------------------------------------------------------------
-- Funkce si zabere nejbližší volný okamžik a vrátí, kolik milisekund má
-- volající počkat, než se smí zeptat. Když se sejde pět volání naráz,
-- dostanou postupně 0, 1100, 2200, 3300 a 4400 ms — a Nominatim tak uvidí
-- přesně jeden dotaz za 1,1 vteřiny.
--
-- Zámek `pg_advisory_xact_lock` je tu proto, aby si dva souběžné procesy
-- nezabraly stejný okamžik. Drží se jen do konce transakce, tedy zlomek
-- vteřiny — samotné čekání probíhá až v Edge Funkci, ne v databázi.
create or replace function public.nominatim_rezervuj(rozestup_ms int default 1100)
returns double precision
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  muj_cas timestamptz;
begin
  -- Číslo zámku je libovolné, jen musí být pro tenhle účel jedinečné.
  perform pg_advisory_xact_lock(hashtext('nominatim_limit'));

  update public.nominatim_limit
     set volno_od = greatest(volno_od, clock_timestamp())
                    + make_interval(secs => rozestup_ms / 1000.0)
   where jediny
  returning volno_od - make_interval(secs => rozestup_ms / 1000.0)
       into muj_cas;

  -- Kolik zbývá do zabraného okamžiku. Záporné číslo znamená „můžeš hned".
  return greatest(
    0,
    extract(epoch from (muj_cas - clock_timestamp())) * 1000
  );
end;
$$;

comment on function public.nominatim_rezervuj(int) is
  'Zabere místo ve frontě dotazů na Nominatim a vrátí, kolik ms má volající počkat.';

-- ---------------------------------------------------------------------------
-- ZABEZPEČENÍ
-- ---------------------------------------------------------------------------
-- Tabulka i funkce patří výhradně Edge Funkcím. Kdyby na ně mohl `anon`,
-- šlo by posunutím `volno_od` daleko do budoucnosti zablokovat dohledávání
-- souřadnic pro celý web.
alter table public.nominatim_limit enable row level security;
alter table public.nominatim_limit force row level security;

-- Záměrně žádná policy — projde jen servisní klíč.
revoke all on public.nominatim_limit from anon, authenticated;

revoke all on function public.nominatim_rezervuj(int) from public, anon, authenticated;
grant execute on function public.nominatim_rezervuj(int) to service_role;
