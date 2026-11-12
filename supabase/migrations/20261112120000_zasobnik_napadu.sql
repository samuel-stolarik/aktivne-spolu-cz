-- Zásobník nápadů — zápisy po akci, výzvy k zápisu a úložiště fotek.
--
-- JAK TO JDE ZA SEBOU
--   1. Správce v administraci pošle pořadateli výzvu. Vznikne řádek
--      ve `vyzvy_k_zapisu` a e-mail s osobním odkazem /zapis/?t=<token>.
--   2. Pořadatel odkaz otevře. Funkce `zapis-napadu` podle tokenu najde
--      přihlášku a předvyplní formulář údaji z registrace.
--   3. Pořadatel nahraje 1–5 fotek a odešle zápis. Vznikne řádek v `napady`
--      ve stavu `ceka` a správce dostane upozornění.
--   4. Správce zápis schválí, vrátí k úpravě s důvodem, nebo zamítne.
--      Veřejně (funkce `verejne-napady`) je vidět JEN stav `schvaleno`.
--
-- ZABEZPEČENÍ — stejný vzor jako zbytek projektu
--   RLS zapnuté a vynucené, žádná policy, `anon` ani `authenticated` nemají
--   na nových tabulkách jediné oprávnění. Všechno jde přes Edge Funkce
--   se servisním klíčem. V zápisech jsou jména, e-maily a telefony.
--
-- Tabulky `prihlasky` se migrace nedotýká.
--
-- Klíče v CHECK podmínkách musí sedět se souborem
-- supabase/functions/_shared/ciselnik-napadu.ts.

-- ---------------------------------------------------------------------------
-- VÝZVY K ZÁPISU
-- ---------------------------------------------------------------------------
-- Token z odkazu se do databáze NEUKLÁDÁ. Ukládá se jen jeho otisk (SHA-256).
-- Kdo by se dostal k zálohám databáze, odkaz z nich nesestaví.
create table if not exists public.vyzvy_k_zapisu (
  id uuid primary key default gen_random_uuid(),
  vytvoreno timestamptz not null default now(),

  -- Když se přihláška smaže, odkaz přestane fungovat.
  prihlaska_id uuid not null references public.prihlasky (id) on delete cascade,

  -- SHA-256 tokenu jako 64 znaků šestnáctkově.
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),

  -- Odkaz platí do tohoto okamžiku. Novější výzva pro stejnou přihlášku
  -- platnost starší zkrátí na „hned", aby v oběhu byl vždy jen jeden odkaz.
  platnost_do timestamptz not null,

  -- Přihlašovací adresa správce, který výzvu poslal. Jen pro dohledání.
  odeslal text,

  -- Na jakou adresu e-mail šel. U ostré výzvy e-mail z přihlášky,
  -- u zkušební adresa správce.
  prijemce text not null,

  -- Zkušební výzva jde na adresu správce, ne pořadateli. Neruší platnost
  -- ostrých odkazů a v přehledu výzev se nepočítá jako odeslaná.
  zkusebni boolean not null default false,

  -- Řádek odchozí pošty s e-mailem. Podle něj administrace ukáže,
  -- jestli e-mail opravdu odešel.
  posta_id uuid references public.odchozi_posta (id) on delete set null,

  -- Kdy pořadatel odkaz poprvé otevřel a kdy podle něj naposledy odeslal zápis.
  otevreno_kdy timestamptz,
  pouzito_kdy timestamptz
);

comment on table public.vyzvy_k_zapisu is
  'Osobní odkazy na formulář zápisu po akci. Token se ukládá jen jako SHA-256.';

create index if not exists vyzvy_prihlaska_idx
  on public.vyzvy_k_zapisu (prihlaska_id, vytvoreno desc);

alter table public.vyzvy_k_zapisu enable row level security;
alter table public.vyzvy_k_zapisu force row level security;
revoke all on public.vyzvy_k_zapisu from anon, authenticated;

-- ---------------------------------------------------------------------------
-- NÁPADY (ZÁPISY PO AKCI)
-- ---------------------------------------------------------------------------
create table if not exists public.napady (
  id uuid primary key default gen_random_uuid(),
  vytvoreno timestamptz not null default now(),
  upraveno  timestamptz not null default now(),

  -- Jedna přihláška = jeden zápis. Opakované odeslání ze stejného odkazu
  -- zápis přepíše, nevznikne druhý.
  prihlaska_id uuid not null unique
    references public.prihlasky (id) on delete cascade,

  -- --- Pořadatel ----------------------------------------------------------
  -- Kopie údajů z přihlášky v podobě, jakou pořadatel potvrdil nebo opravil
  -- ve formuláři. Přihláška sama se kvůli zápisu nemění, protože z ní
  -- vycházejí faktury.
  typ_poradatele   text not null
    check (typ_poradatele in ('skola', 'organizace', 'jednotlivec')),
  nazev_poradatele text not null check (length(btrim(nazev_poradatele)) between 1 and 200),
  kontaktni_osoba  text not null check (length(btrim(kontaktni_osoba)) between 1 and 120),
  email            text not null check (length(email) between 3 and 254),
  telefon          text,
  mesto            text not null check (length(btrim(mesto)) between 1 and 120),
  kraj text not null check (kraj in (
    'Praha', 'Středočeský', 'Jihočeský', 'Plzeňský', 'Karlovarský',
    'Ústecký', 'Liberecký', 'Královéhradecký', 'Pardubický', 'Vysočina',
    'Jihomoravský', 'Olomoucký', 'Zlínský', 'Moravskoslezský'
  )),

  -- --- Akce ---------------------------------------------------------------
  nazev_akce text not null check (length(btrim(nazev_akce)) between 1 and 120),

  typ text not null check (typ in ('kulturni', 'pohyb', 'ostatni')),
  podtyp text not null check (
    (typ = 'kulturni' and podtyp in
      ('zpev', 'tanec', 'vytvarne', 'divadlo', 'cteni', 'vystava', 'jine'))
    or (typ = 'pohyb' and podtyp in
      ('turistika', 'olympiada', 'venkovni-hry', 'prochazka',
       'nordic-walking', 'sjizdeni-reky', 'plavani', 'jine'))
    or (typ = 'ostatni' and podtyp in
      ('kviz', 'hospodsky-kviz', 'prednaska', 'host', 'strelba-prakem',
       'povidani', 'karty-hry', 'jine'))
  ),
  -- Vlastní text u podtypu „jiné". U ostatních podtypů musí zůstat prázdný.
  podtyp_jine text check (podtyp_jine is null or length(btrim(podtyp_jine)) between 1 and 80),

  narocnost text not null check (narocnost in ('jednoducha', 'stredni', 'narocna')),

  pomucky_potreba boolean not null,
  pomucky_jake text check (pomucky_jake is null or length(pomucky_jake) <= 300),

  vek text[] not null check (
    cardinality(vek) >= 1
    and vek <@ array['bez-omezeni', 'predskolaci', 'skolaci', 'stredoskolaci',
                     'rodiny', 'mladsi-dospeli', 'seniori', 'vsechny']
  ),
  zdatnost text[] not null check (
    cardinality(zdatnost) >= 1
    and zdatnost <@ array['zdatni', 'mirne-omezeni', 'omezeni']
  ),

  delka text not null check (delka in ('hodina', '1-2h', '2-4h', 'vic-4h')),

  popis text not null check (char_length(btrim(popis)) between 100 and 1000),

  -- Nepovinné. Předvyplňuje se z přihlášky.
  datum_akce date,

  -- Cesty v bucketu `napady-fotky`, ve tvaru <prihlaska_id>/<nahodne>.jpg.
  -- Pořadí v poli je pořadí na webu, první fotka je titulní.
  fotky text[] not null check (cardinality(fotky) between 1 and 5),

  -- Neveřejný vzkaz organizátorům kampaně. Vidí ho jen administrace.
  vzkaz text check (vzkaz is null or char_length(vzkaz) <= 300),

  -- --- Souhlasy -----------------------------------------------------------
  -- CHECK na `true`, ne jen NOT NULL. Bez souhlasu se zápis neuloží vůbec.
  souhlas_zpracovani boolean not null check (souhlas_zpracovani = true),
  souhlas_foto       boolean not null check (souhlas_foto = true),
  -- Které kontakty smí být u nápadu veřejně. Aspoň jeden.
  verejny_kontakt text[] not null check (
    cardinality(verejny_kontakt) >= 1
    and verejny_kontakt <@ array['email', 'telefon']
  ),
  -- Přesné znění souhlasu, jak ho pořadatel viděl. Kdyby se text někdy
  -- změnil, u starších zápisů zůstane doloženo, s čím kdo souhlasil.
  souhlas_zneni text not null,

  -- --- Schvalování --------------------------------------------------------
  stav text not null default 'ceka'
    check (stav in ('ceka', 'schvaleno', 'vraceno', 'zamitnuto')),
  -- Důvod vrácení nebo zamítnutí. Pořadateli se pošle e-mailem.
  duvod text check (duvod is null or char_length(duvod) <= 1000),
  rozhodl text,
  rozhodnuto_kdy timestamptz,
  -- Kdy byl zápis poprvé schválený. Při úpravě se nemaže, aby šlo řadit
  -- Zásobník podle data zveřejnění.
  schvaleno_kdy timestamptz,

  constraint jine_jen_u_jine check (
    case when podtyp = 'jine'
      then podtyp_jine is not null
      else podtyp_jine is null
    end
  ),
  constraint pomucky_jen_kdyz_potreba check (
    pomucky_potreba or pomucky_jake is null
  ),
  constraint vraceni_ma_duvod check (
    stav <> 'vraceno' or (duvod is not null and length(btrim(duvod)) > 0)
  ),
  -- Zveřejnit telefon jde jen tehdy, když nějaký je.
  constraint telefon_kdyz_verejny check (
    not ('telefon' = any (verejny_kontakt))
    or (telefon is not null and length(btrim(telefon)) > 0)
  )
);

comment on table public.napady is
  'Zápisy po akci pro Zásobník nápadů. Veřejně jen stav schvaleno, přes funkci verejne-napady.';
comment on column public.napady.vzkaz is
  'Neveřejný vzkaz organizátorům kampaně. Nikdy nesmí do veřejného výdeje.';
comment on column public.napady.verejny_kontakt is
  'Kontakty, se zveřejněním kterých pořadatel souhlasil: email, telefon.';

-- Fronta v administraci a veřejný výpis filtrují podle stavu.
create index if not exists napady_stav_idx on public.napady (stav, vytvoreno desc);

-- Datum úpravy hlídá databáze, ne aplikace.
create or replace function public.napady_zapis_datum()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.upraveno := now();
  return new;
end;
$$;

drop trigger if exists napady_datum on public.napady;
create trigger napady_datum
  before update on public.napady
  for each row execute function public.napady_zapis_datum();

alter table public.napady enable row level security;
alter table public.napady force row level security;
revoke all on public.napady from anon, authenticated;
revoke all on function public.napady_zapis_datum() from anon, authenticated;

-- ---------------------------------------------------------------------------
-- ÚLOŽIŠTĚ FOTEK
-- ---------------------------------------------------------------------------
-- NEveřejný bucket. Na fotkách jsou lidé, často děti. Dokud zápis není
-- schválený, nesmí je vidět nikdo kromě správce. Veřejná funkce
-- `verejne-napady` vydává jen podepsané adresy s omezenou platností
-- a jen k fotkám schválených zápisů.
--
-- Fotky se zmenšují v prohlížeči na delší stranu 1600 px a ukládají jako JPEG.
-- Tím zmizí EXIF i poloha GPS. Proto jen image/jpeg.
--
-- Nahrávat smí jen podepsaná adresa, kterou vystaví funkce `zapis-napadu`
-- po ověření tokenu. Žádná policy na storage.objects se nepřidává.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('napady-fotky', 'napady-fotky', false, 5242880, array['image/jpeg'])
on conflict (id) do update
  set public = false,
      file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg'];
