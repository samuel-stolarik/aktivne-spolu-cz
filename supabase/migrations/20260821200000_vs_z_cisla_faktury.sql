-- ===========================================================================
-- Variabilní symbol je číslo faktury bez lomítek
--
--   číslo faktury      26/03/001
--   variabilní symbol    2603001
--
-- Obojí vzniká z JEDNOHO pořadového čísla, takže se nemůžou rozejít.
-- Do teď to byly dvě nezávislé řady (VS ze seq_variabilni_symbol od 100001,
-- pořadí faktury zvlášť) a čísla spolu nesouvisela.
--
-- CO SE TÍM ZÍSKÁVÁ
-- Na výpisu z banky i na faktuře je vidět totéž číslo. Účetní páruje platbu
-- s dokladem na první pohled, bez hledání v tabulce.
--
-- ⚠️ CO SE TÍM ZTRÁCÍ — ŘADA FAKTUR NEBUDE SOUVISLÁ
-- Pořadové číslo dostane KAŽDÁ přihláška, ale fakturu jen ten, kdo platí
-- převodem. Po lidech, co platí QR kódem nebo jako jednotlivci nepřispívají,
-- zůstanou v číslech faktur díry: 26/03/001, 26/03/004, 26/03/007.
--
-- Zákon souvislou řadu nevyžaduje (§ 11 zákona o účetnictví chce jen
-- jednoznačné označení dokladu), ale účetní se na to ptá jako na první věc.
-- MUSÍ o tom vědět dopředu.
--
-- ⚠️ STROP JE 999 PŘIHLÁŠEK za rok a řadu. Při tisící se pořadí rozšíří na
-- čtyři místa (26/03/1000, VS 26031000) — pořád jednoznačné, jen delší.
-- Číslo se skládá z textu, ne počítáním, takže se nic nezlomí.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Jedna sekvence pro obojí
--
-- seq_faktura_poradi tu už je z první migrace. Přebírá roli hlavního počítadla;
-- seq_variabilni_symbol se přestává používat.
-- ---------------------------------------------------------------------------
comment on sequence public.seq_variabilni_symbol is
  'NEPOUŽÍVÁ SE od migrace 20260821200000. Variabilní symbol se nově odvozuje '
  'z pořadového čísla faktury (seq_faktura_poradi). Sekvence zůstává kvůli '
  'starým přihláškám, jejichž symboly z ní vzešly.';

-- ---------------------------------------------------------------------------
-- 2. Funkce, která přidělí obojí naráz
--
-- Vrací jeden řádek se dvěma sloupci. Volá se JEDNOU při přijetí přihlášky —
-- posouvá sekvenci, takže opakované volání spotřebuje další číslo.
--
-- Rok se přijímá dvouciferný i čtyřciferný (26 i 2026).
-- ---------------------------------------------------------------------------
create or replace function public.pridel_cislo(rok int, rada text)
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
    raise exception 'Chybí řada faktur (parametr rada).';
  end if;

  rr  := lpad((rok % 100)::text, 2, '0');
  ss  := lpad(btrim(rada), 2, '0');
  nnn := lpad(nextval('public.seq_faktura_poradi')::text, 3, '0');

  cislo_faktury := rr || '/' || ss || '/' || nnn;
  -- Variabilní symbol je totéž bez lomítek. Skládá se ze STEJNÝCH řetězců,
  -- ne dopočítáváním — jinak by se to při přechodu na čtyřmístné pořadí
  -- rozešlo.
  variabilni_symbol := (rr || ss || nnn)::bigint;

  return next;
end;
$$;

comment on function public.pridel_cislo(int, text) is
  'Přidělí pořadové číslo a vrátí z něj číslo faktury (26/03/001) '
  'i variabilní symbol (2603001). POZOR: každé volání posune sekvenci.';

revoke all on function public.pridel_cislo(int, text) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Podmínka, že číslo faktury odpovídá variabilnímu symbolu
--
-- Tohle je ta pojistka, o kterou tu celou dobu jde: kdyby se někdy obojí
-- přidělovalo zvlášť a rozešlo se, databáze zápis odmítne. Porovnává se
-- číslo faktury bez lomítek s variabilním symbolem.
-- ---------------------------------------------------------------------------
alter table public.prihlasky
  drop constraint if exists faktura_cislo_tvar;

alter table public.prihlasky
  drop constraint if exists faktura_cislo_odpovida_vs;

-- NOT VALID schválně: podmínka platí pro všechny NOVÉ a měněné řádky, ale
-- existující se nekontrolují. V databázi jsou zkušební přihlášky z dnešního
-- ladění, které mají čísla podle starého pravidla (26/03/001 se symbolem
-- 100023) — bez tohohle by migrace neprošla a musela by se kvůli ní mazat
-- data, což je horší než je nechat dožít.
--
-- Až se zkušební přihlášky před spuštěním smažou, dá se podmínka dotáhnout
-- na plnou platnost:
--   alter table public.prihlasky validate constraint faktura_cislo_odpovida_vs;
alter table public.prihlasky
  add constraint faktura_cislo_odpovida_vs check (
    faktura_cislo is null
    or (
      faktura_cislo ~ '^[0-9]{2}/[0-9]{2}/[0-9]{3,}$'
      and replace(faktura_cislo, '/', '') = variabilni_symbol::text
    )
  ) not valid;

-- ---------------------------------------------------------------------------
-- 4. Stará funkce pryč
--
-- Přidělovala jen číslo faktury a variabilní symbol neřešila. Kdyby zůstala,
-- byly by dvě cesty, jak číslo získat, a jedna z nich by tu podmínku výš
-- porušila.
-- ---------------------------------------------------------------------------
drop function if exists public.cislo_faktury(int, text);
