-- ===========================================================================
-- Dvě číselné řady: poplatky zvlášť, dobrovolné příspěvky zvlášť
--
--   škola / organizace   řada 03   →  26/03/001,  VS 2603001
--   jednotlivec          řada 04   →              VS 2604001
--
-- PROČ TO NEJDE MÍCHAT
-- Registrační poplatek je úhrada služby a vystavuje se na něj faktura.
-- Dobrovolný příspěvek jednotlivce je dar — faktura na něj nepatří a nesmí
-- se míchat do stejné řady dokladů. Účetní to musí umět rozdělit už podle
-- čísla, ne až podle typu přihlášky.
--
-- KAŽDÁ ŘADA MÁ VLASTNÍ POČÍTADLO, takže obě začínají od 001 a neovlivňují
-- se. Kdyby sdílely jedno, měla by jedna z nich hned na začátku díru.
--
-- JEDNOTLIVEC NEDOSTÁVÁ ČÍSLO FAKTURY, jen variabilní symbol. Sloupec
-- faktura_cislo mu zůstane prázdný — na dar se doklad nevystavuje.
-- Číslo se mu přesto přiděluje, protože platbu je potřeba spárovat.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Počítadlo pro příspěvky
-- ---------------------------------------------------------------------------
create sequence if not exists public.seq_prispevek_poradi
  as bigint
  start with 1
  increment by 1
  no cycle;

comment on sequence public.seq_prispevek_poradi is
  'Pořadí dobrovolných příspěvků od jednotlivců. Vlastní řada, oddělená od '
  'faktur za registrační poplatek (seq_faktura_poradi).';

revoke all on sequence public.seq_prispevek_poradi from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Funkce bere navíc, ze které řady má čerpat
--
-- Parametr `prispevek` rozhoduje o počítadle, ne o tvaru čísla — ten je
-- pro obě řady stejný. Výchozí `false` je schválně: kdyby ho někdo zapomněl
-- poslat, přidělí se číslo z řady faktur, což je ta přísnější varianta.
-- ---------------------------------------------------------------------------
create or replace function public.pridel_cislo(
  rok int,
  rada text,
  prispevek boolean default false
)
returns table (cislo_faktury text, variabilni_symbol bigint)
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
    raise exception 'Chybí rok.';
  end if;
  if rada is null or length(btrim(rada)) = 0 then
    raise exception 'Chybí číslo řady (parametr rada).';
  end if;

  rr := lpad((rok % 100)::text, 2, '0');
  ss := lpad(btrim(rada), 2, '0');

  if prispevek then
    nnn := lpad(nextval('public.seq_prispevek_poradi')::text, 3, '0');
  else
    nnn := lpad(nextval('public.seq_faktura_poradi')::text, 3, '0');
  end if;

  cislo_faktury := rr || '/' || ss || '/' || nnn;
  -- Variabilní symbol je totéž bez lomítek. Skládá se ze STEJNÝCH řetězců,
  -- ne dopočítáváním — jinak by se to při přechodu na čtyřmístné pořadí
  -- rozešlo.
  variabilni_symbol := (rr || ss || nnn)::bigint;

  return next;
end;
$$;

comment on function public.pridel_cislo(int, text, boolean) is
  'Přidělí pořadové číslo z řady faktur, nebo z řady příspěvků (prispevek = true). '
  'Vrací číslo dokladu (26/03/001) i variabilní symbol (2603001). '
  'POZOR: každé volání posune příslušné počítadlo.';

revoke all on function public.pridel_cislo(int, text, boolean) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Stará dvouparametrová verze pryč
--
-- Postgres umí obě najednou (přetížení) a to je tu nebezpečné: volání se
-- dvěma parametry by tiše sáhlo do řady faktur i pro jednotlivce, což je
-- přesně ta chyba, kterou tahle migrace odstraňuje.
-- ---------------------------------------------------------------------------
drop function if exists public.pridel_cislo(int, text);
