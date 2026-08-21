-- ===========================================================================
-- Číslo faktury je zase pořadové: 26/03/001
--
-- Chvíli se číslovalo variabilním symbolem (26/03/100001), aby bylo na
-- platbě i na faktuře vidět stejné číslo. Zadavatel se po konzultaci
-- s účetní vrátil k pořadové řadě.
--
-- CO SE TÍM ZÍSKÁVÁ
-- Řada je SOUVISLÁ: 001, 002, 003. To je přesně to, co účetní čekají.
-- U číslování podle variabilního symbolu zůstávaly v řadě díry, protože
-- variabilní symbol dostal každý, ale fakturu jen ten, kdo platí převodem.
--
-- CO SE TÍM ZTRÁCÍ — A JE POTŘEBA TO VĚDĚT
-- Na faktuře už není vidět variabilní symbol platby. Párování platby
-- s fakturou tedy není na první pohled a dělá se přes variabilní symbol,
-- který je na faktuře uvedený zvlášť jako údaj k platbě.
--
-- ⚠️ ČÍSLA SE UŽ NEDAJÍ ZKOUŠET NAPRÁZDNO
-- Předchozí způsob byl opakovatelný: pro stejný variabilní symbol vracel
-- pořád totéž číslo, takže se testováním nedalo nic spálit. Sekvence se
-- posouvá při každém volání. Každá zkušební faktura tedy spotřebuje jedno
-- číslo a v řadě po ní zůstane díra.
--
-- Před ostrým spuštěním se sekvence vrátí na začátek:
--   select setval('public.seq_faktura_poradi', 1, false);
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Pryč s podmínkou, která vázala číslo faktury na variabilní symbol
--
-- Vyžadovala tvar `RR/SS/<variabilní symbol>`. Pořadové číslo by neprošlo
-- a zápis faktury by skončil chybou 400.
-- ---------------------------------------------------------------------------
alter table public.prihlasky
  drop constraint if exists faktura_cislo_odpovida_vs;

-- Tvar čísla se přesto hlídá dál, jen volněji: dvě číslice roku, dvě řady
-- a alespoň tři číslice pořadí. Chrání to před překlepem při ručním zásahu.
alter table public.prihlasky
  drop constraint if exists faktura_cislo_tvar;

alter table public.prihlasky
  add constraint faktura_cislo_tvar check (
    faktura_cislo is null
    or faktura_cislo ~ '^[0-9]{2}/[0-9]{2}/[0-9]{3,}$'
  );

-- ---------------------------------------------------------------------------
-- 2. Funkce, která číslo přidělí
--
-- POZOR: NENÍ OPAKOVATELNÁ. Každé volání posune sekvenci. Volající se proto
-- musí sám ujistit, že fakturu vystavuje jen jednou — v Edge Function to
-- hlídá podmínka, že `faktura_cislo` je zatím prázdné.
--
-- Rok se přijímá dvouciferný i čtyřciferný (26 i 2026), ať se nedá splést.
-- ---------------------------------------------------------------------------
create or replace function public.cislo_faktury(rok int, rada text)
returns text
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  rr text;
  ss text;
  nnn text;
begin
  if rok is null then
    raise exception 'Chybí rok pro číslo faktury.';
  end if;
  if rada is null or length(btrim(rada)) = 0 then
    raise exception 'Chybí řada faktur (parametr rada).';
  end if;

  rr := lpad((rok % 100)::text, 2, '0');
  ss := lpad(btrim(rada), 2, '0');
  nnn := lpad(nextval('public.seq_faktura_poradi')::text, 3, '0');

  return rr || '/' || ss || '/' || nnn;
end;
$$;

comment on function public.cislo_faktury(int, text) is
  'Přidělí další pořadové číslo faktury ve tvaru RR/SS/NNN (26/03/001). '
  'POZOR: každé volání posune sekvenci — není opakovatelné.';

-- ---------------------------------------------------------------------------
-- 3. Oprávnění
--
-- Funkci i sekvenci smí použít jen service_role, tedy Edge Function.
-- Z prohlížeče se k číslování nikdo nedostane.
-- ---------------------------------------------------------------------------
revoke all on function public.cislo_faktury(int, text) from anon, authenticated;
revoke all on sequence public.seq_faktura_poradi from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Stará funkce pryč
--
-- Nechat ji tu by znamenalo dvě cesty, jak přidělit číslo, a každá jinou
-- řadou. Když ji někdo zavolá po smazání, dostane srozumitelnou chybu 404
-- místo tiše vyrobeného čísla ze zahozené řady.
-- ---------------------------------------------------------------------------
drop function if exists public.cislo_faktury_pro_vs(int, text, bigint);
