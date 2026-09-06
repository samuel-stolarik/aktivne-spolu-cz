-- ===========================================================================
-- Číselná řada faktur začíná od 001 a nikdy nevydá číslo, které už někdo má
--
-- CO SE STALO
-- Počítadlo faktur bylo při spuštění ostrého provozu na 14, protože ho
-- posunulo zkoušení formuláře. První skutečná přihláška proto dostala
-- 26/03/014 a variabilní symbol 2603014 místo 26/03/001. V řadě tak
-- chybí faktury 001 až 013, což je při kontrole první otázka, na kterou
-- se účetní ptá: kde je těch třináct dokladů.
--
-- CO S TÍM
-- Počítadlo se vrací na jedničku, aby se řada dopočítala od začátku.
-- Jenže 014 a 015 už vydané jsou — PDF existují a jsou u zákazníků,
-- takže přečíslovat je nejde (musely by se stornovat opravným dokladem).
-- Až se počítadlo k těmhle číslům dostane, musí je přeskočit.
--
-- PROČ SE PTÁ DATABÁZE, A NE PEVNÝ SEZNAM VÝJIMEK
-- Hana psala „nevystavit 2603014 a přeskočit na 2603015". Než se k tomu
-- došlo, přišla druhá přihláška a vzala si 2603015 taky. Pevně zapsané
-- číslo výjimky by tuhle chybu zopakovalo při každé další přihlášce,
-- která přijde dřív, než se řada dopočítá. Proto se před vydáním čísla
-- kouká do tabulky, jestli už ho někdo nemá — to platí vždycky, bez
-- ohledu na to, kolik přihlášek mezitím přibude.
--
-- Na `variabilni_symbol` i `faktura_cislo` jsou unikátní indexy, takže
-- kolize by skončila chybou při zápisu, tedy ztracenou přihláškou.
-- Tohle jí předchází.
-- ===========================================================================

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
  cislo text;
  vs bigint;
  pokusu int := 0;
begin
  -- DAR: jen pořadové číslo, žádný doklad. Beze změny.
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

  rr := lpad((rok % 100)::text, 2, '0');
  ss := lpad(btrim(rada), 2, '0');

  -- Ber další číslo tak dlouho, dokud nenarazíš na volné. Počítadlo se
  -- posouvá i u přeskočených, takže se stejné číslo nezkouší podruhé.
  loop
    pokusu := pokusu + 1;
    if pokusu > 1000 then
      raise exception 'Nepodařilo se najít volné číslo faktury v řadě % pro rok %.', ss, rok;
    end if;

    nnn   := lpad(nextval('public.seq_faktura_poradi')::text, 3, '0');
    cislo := rr || '/' || ss || '/' || nnn;
    -- Variabilní symbol je totéž bez lomítek. Skládá se ze STEJNÝCH
    -- řetězců, ne dopočítáváním — jinak by se to při přechodu na
    -- čtyřmístné pořadí rozešlo.
    vs    := (rr || ss || nnn)::bigint;

    exit when not exists (
      select 1
        from public.prihlasky p
       where p.variabilni_symbol = vs
          or p.faktura_cislo = cislo
    );
  end loop;

  cislo_faktury := cislo;
  variabilni_symbol := vs;
  return next;
end;
$$;

comment on function public.pridel_cislo(int, text, boolean) is
  'Přidělí variabilní symbol. U faktury k němu vrátí i číslo dokladu '
  '(26/03/001 a 2603001), u daru jen symbol od 3001 a číslo dokladu NULL. '
  'Čísla, která už některá přihláška má, přeskakuje. '
  'POZOR: každé volání posune příslušné počítadlo.';

revoke all on function public.pridel_cislo(int, text, boolean) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Počítadlo zpátky na začátek
--
-- `is_called = false` znamená, že první nextval vrátí rovnou 1, ne 2.
-- Vydané 014 a 015 zůstávají, jak jsou — přeskočí je smyčka výš.
-- ---------------------------------------------------------------------------
select setval('public.seq_faktura_poradi', 1, false);
