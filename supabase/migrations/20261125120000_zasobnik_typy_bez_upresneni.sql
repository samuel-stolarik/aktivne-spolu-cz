-- Zásobník nápadů — typ akce bez upřesnění (zadavatelka 18. 11. a 24. 11. 2026).
--
-- CO SE MĚNÍ
--   Typ akce má jen čtyři volby: Kulturní, Pohyb a sport, Společenská akce
--   a Jiná. Upřesnění (Zpěv, Tanec, Kvíz…) zmizelo. U „Jiná" pořadatel
--   napíše vlastní text.
--
--   Ukládání:
--     - kulturni / pohyb / spolecenska: podtyp = NULL, podtyp_jine = NULL
--     - jina: podtyp = 'jine', podtyp_jine = vlastní text (povinný, hlídá
--       ho stávající podmínka `jine_jen_u_jine`)
--
--   Sloupec `podtyp` proto přestává být povinný.
--
-- STARŠÍ DATA
--   Kdyby v tabulce byl zápis se starým upřesněním (např. kulturni/zpev),
--   migrace NIC nezmění a skončí chybou. Data se nesmí tiše zahodit; o převodu
--   by se muselo rozhodnout zvlášť. V ostré databázi bylo 25. 11. 2026
--   0 zápisů.
--
-- Klíče musí sedět se supabase/functions/_shared/ciselnik-napadu.ts.
-- Migrace jde pustit opakovaně.

do $$
declare
  starych integer;
begin
  select count(*) into starych
  from public.napady
  where not (
    (typ in ('kulturni', 'pohyb', 'spolecenska') and podtyp is null)
    or (typ = 'jina' and podtyp is not distinct from 'jine')
  );
  if starych > 0 then
    raise exception
      'V tabulce napady je % zápisů se starým upřesněním typu. Migrace se nepustila, nejdřív rozhodněte o jejich převodu.',
      starych;
  end if;
end $$;

alter table public.napady alter column podtyp drop not null;

alter table public.napady drop constraint if exists napady_podtyp_check;
alter table public.napady
  add constraint napady_podtyp_check check (
    (typ in ('kulturni', 'pohyb', 'spolecenska') and podtyp is null)
    -- Jiná: jen vlastní text („Jaká akce to byla?").
    or (typ = 'jina' and podtyp is not distinct from 'jine')
  );

comment on column public.napady.podtyp is
  'Jen u typu „Jiná": hodnota jine (vlastní text je v podtyp_jine). U ostatních typů prázdné. Upřesnění typu zrušeno 25. 11. 2026.';
comment on column public.napady.rozpocet is
  'Rozpočet na celou akci (celkové náklady): zadny, do-500, 500-1000, vic-1000.';
