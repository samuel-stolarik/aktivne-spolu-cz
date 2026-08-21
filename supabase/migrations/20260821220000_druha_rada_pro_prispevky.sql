-- ===========================================================================
-- Dvě oddělená číslování: faktury a dary
--
--   škola / organizace   26/03/001   VS 2603001   faktura ANO
--   jednotlivec          —           VS 3001      faktura NE
--
-- PROČ TO NEJDE MÍCHAT
-- Registrační poplatek je úhrada služby a vystavuje se na něj faktura.
-- Příspěvek jednotlivce se účtuje jako DAR — doklad se na něj nevystavuje
-- a do řady faktur nepatří. Účetní to musí rozdělit už podle čísla na
-- bankovním výpisu, ne až dohledáváním v tabulce.
--
-- JEDNOTLIVEC NEMÁ ŘADU. Jeho variabilní symbol je prosté pořadové číslo
-- od 3001 výš: 3001, 3002, 3003. Žádný rok, žádná řada — není to doklad,
-- je to jen značka, podle které se platba spáruje s přihláškou.
--
-- PROČ ZROVNA OD 3001
-- Aby se symboly darů na výpisu nedaly splést se symboly faktur. Ty mají
-- sedm míst a začínají rokem (2603001), dary mají čtyři (3001). Na první
-- pohled je poznat, co je co.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Počítadlo darů
--
-- Začíná na 3001, ne na 1 — číslo samo o sobě má být rozeznatelné.
-- ---------------------------------------------------------------------------
create sequence if not exists public.seq_prispevek_poradi
  as bigint
  start with 3001
  increment by 1
  no cycle;

-- Kdyby sekvence z dřívějška existovala a začínala jinde, srovná se.
-- `is_called = false` znamená, že první nextval vrátí rovnou 3001,
-- ne 3002.
select setval('public.seq_prispevek_poradi', 3001, false)
 where (select last_value from public.seq_prispevek_poradi) < 3001;

comment on sequence public.seq_prispevek_poradi is
  'Variabilní symboly dobrovolných příspěvků od jednotlivců, od 3001. '
  'Účtuje se jako dar — nemá řadu ani číslo dokladu, oddělené od faktur.';

revoke all on sequence public.seq_prispevek_poradi from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Přidělení čísla
--
-- Vrací dvě hodnoty. U daru je `cislo_faktury` schválně NULL — doklad se
-- nevystavuje a prázdná hodnota je pravdivější než vymyšlené číslo.
--
-- Parametr `rada` se u daru ignoruje a nemusí se posílat.
-- ---------------------------------------------------------------------------
create or replace function public.pridel_cislo(
  rok int,
  rada text default null,
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
  -- DAR: jen pořadové číslo, žádný doklad.
  if prispevek then
    cislo_faktury := null;
    variabilni_symbol := nextval('public.seq_prispevek_poradi');
    return next;
    return;
  end if;

  -- FAKTURA: rok, řada a pořadí.
  if rok is null then
    raise exception 'Chybí rok.';
  end if;
  if rada is null or length(btrim(rada)) = 0 then
    raise exception 'Chybí číslo řady faktur (parametr rada).';
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

comment on function public.pridel_cislo(int, text, boolean) is
  'Přidělí variabilní symbol. U faktury k němu vrátí i číslo dokladu '
  '(26/03/001 a 2603001), u daru jen symbol od 3001 a číslo dokladu NULL. '
  'POZOR: každé volání posune příslušné počítadlo.';

revoke all on function public.pridel_cislo(int, text, boolean) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Stará dvouparametrová verze pryč
--
-- Postgres umí obě verze najednou (přetížení) a to je tu nebezpečné:
-- volání se dvěma parametry by tiše sáhlo do řady faktur i pro jednotlivce,
-- tedy přesně ta chyba, kterou tahle migrace odstraňuje.
-- ---------------------------------------------------------------------------
drop function if exists public.pridel_cislo(int, text);
