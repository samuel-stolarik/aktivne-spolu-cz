-- ===========================================================================
-- Dobrovolný příspěvek u jednotlivců
--
-- Do teď platili registrační poplatek 500 Kč všichni stejně a částka nebyla
-- nikde uložená — brala se z konstanty v Edge Function. Zadavatel rozhodl,
-- že JEDNOTLIVEC platit nemusí: buď přispěje částkou, kterou si sám vybere
-- (nejmíň 100 Kč), nebo nepřispěje vůbec. Škol a organizací se to netýká,
-- těm zůstává poplatek 500 Kč.
--
-- PROČ SE ČÁSTKA MUSÍ UKLÁDAT DO DATABÁZE
-- Když si ji každý volí sám, přestává být konstantou. Musí sedět v QR kódu,
-- na potvrzení, v e-mailu i v účetnictví — a všechna ta místa si ji musí
-- vzít z jednoho zdroje, jinak se rozejdou. Sloupec je proto `not null`
-- s výchozí pětistovkou: existující přihlášky se doplní zpětně a nová
-- přihláška bez částky nevznikne.
--
-- PROČ JE PRAVIDLO V DATABÁZI, A NE JEN VE FUNKCI
-- Edge Function si vstup kontroluje sama, ale je to jen software, který se
-- dá nasadit ve špatné verzi. Podmínka níž hlídá to, co se nesmí stát ani
-- omylem: aby škola nebo organizace mohla přihlášku poslat bez zaplacení,
-- nebo aby jednotlivec přispěl korunou.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Částka
-- ---------------------------------------------------------------------------
alter table public.prihlasky
  add column if not exists castka_kc integer;

comment on column public.prihlasky.castka_kc is
  'Kolik má člověk zaplatit v Kč. U škol a organizací vždy 500, '
  'u jednotlivce jím zvolený dobrovolný příspěvek (min. 100) nebo 0.';

-- Přihlášky, které vznikly dřív, platily pětistovku.
update public.prihlasky
   set castka_kc = 500
 where castka_kc is null;

alter table public.prihlasky
  alter column castka_kc set default 500,
  alter column castka_kc set not null;

-- ---------------------------------------------------------------------------
-- 2. Nová forma platby: „nepřispívám"
--
-- Původní podmínku je potřeba zahodit, protože povoluje jen 'qr' a 'prevod'.
-- Hledá se podle definice, ne podle jména — jméno si Postgres u podmínek
-- zapsaných rovnou u sloupce vymýšlí sám a nemusí být, co čekáme.
-- ---------------------------------------------------------------------------
do $$
declare
  podminka record;
begin
  for podminka in
    select conname
      from pg_constraint
     where conrelid = 'public.prihlasky'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%forma_platby%'
       and pg_get_constraintdef(oid) like '%''prevod''%'
  loop
    execute format(
      'alter table public.prihlasky drop constraint %I', podminka.conname
    );
  end loop;
end $$;

alter table public.prihlasky
  add constraint prihlasky_forma_platby_check
  check (forma_platby in ('qr', 'prevod', 'neprispivam'));

-- ---------------------------------------------------------------------------
-- 3. Co si smí dovolit kdo
--
--   jednotlivec   — buď nepřispěje (0 Kč), nebo přispěje QR platbou
--                   od 100 Kč výš. Fakturu nedostává: dobrovolný příspěvek
--                   není úhrada služby a faktura na dar nepatří.
--   škola, firma  — poplatek 500 Kč, QR kódem nebo převodem na fakturu.
--                   „Nepřispívám" u nich neexistuje.
--
-- Horní hranice je tu proti překlepu, ne proti štědrosti: kdo omylem napíše
-- o tři nuly víc, dostane QR kód na sto tisíc a zjistí to až v bance.
-- ---------------------------------------------------------------------------
alter table public.prihlasky
  drop constraint if exists prihlasky_platba_podle_typu;

alter table public.prihlasky
  add constraint prihlasky_platba_podle_typu check (
    case
      when typ_poradatele = 'jednotlivec' then
        (forma_platby = 'neprispivam' and castka_kc = 0)
        or (forma_platby = 'qr' and castka_kc between 100 and 100000)
      else
        forma_platby in ('qr', 'prevod') and castka_kc = 500
    end
  );
