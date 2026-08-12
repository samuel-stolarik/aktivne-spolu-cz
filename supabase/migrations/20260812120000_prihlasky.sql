-- Přihlášky na akci — tabulka, sekvence, čísla faktur a zabezpečení.
--
-- Celý formulář z webu končí tady. Ukládá se výhradně přes Edge Funkci
-- `prijmout-prihlasku` servisním klíčem; veřejný (anonymní) klíč na tuhle
-- tabulku nemá sáhnout vůbec — viz sekce ZABEZPEČENÍ na konci souboru.

-- ---------------------------------------------------------------------------
-- SEKVENCE
-- ---------------------------------------------------------------------------
-- Dvě oddělené sekvence schválně. Variabilní symbol dostane každý hned při
-- registraci, kdežto pořadí faktury se přiděluje AŽ ve chvíli, kdy se faktura
-- opravdu vystavuje. Kdyby to byla jedna sekvence, v číslech faktur by byly
-- díry po lidech, kteří se přihlásili a nezaplatili.

-- Variabilní symbol platby. Začíná na 100001, ať je šestimístný a nepletl se
-- s ničím jiným.
create sequence if not exists seq_variabilni_symbol
  as bigint
  start with 100001
  increment by 1
  minvalue 100001
  no maxvalue
  cache 1;

-- Pořadové číslo faktury v rámci řady. Jediný zdroj pravdy pro číslování —
-- nikde jinde se pořadí nepočítá.
create sequence if not exists seq_faktura_poradi
  as bigint
  start with 1
  increment by 1
  minvalue 1
  no maxvalue
  cache 1;

-- ---------------------------------------------------------------------------
-- TABULKA prihlasky
-- ---------------------------------------------------------------------------
create table if not exists public.prihlasky (
  id uuid primary key default gen_random_uuid(),
  vytvoreno timestamptz not null default now(),

  -- Kdo se hlásí
  typ_poradatele text not null
    check (typ_poradatele in ('skola', 'organizace', 'jednotlivec')),
  nazev_poradatele text not null,
  kontaktni_osoba  text not null,
  email            text not null,
  telefon          text not null,
  mesto            text not null,

  -- Kraj z pevného číselníku, ať se v přehledech nesejde „Vysočina",
  -- „Kraj Vysočina" a „vysocina" jako tři různé věci.
  kraj text not null check (kraj in (
    'Praha',
    'Středočeský',
    'Jihočeský',
    'Plzeňský',
    'Karlovarský',
    'Ústecký',
    'Liberecký',
    'Královéhradecký',
    'Pardubický',
    'Vysočina',
    'Jihomoravský',
    'Olomoucký',
    'Zlínský',
    'Moravskoslezský'
  )),

  -- Nepovinné: čím chtějí přispět do programu
  napad_na_aktivitu text,

  -- Platba
  forma_platby text not null check (forma_platby in ('qr', 'prevod')),

  -- Fakturační údaje. Vyplňují se jen u převodu, u QR zůstávají prázdné.
  -- Hlídá to podmínka `fakturace_jen_u_prevodu` níž.
  fakt_nazev  text,
  fakt_adresa text,
  fakt_ic     text,
  fakt_dic    text,

  -- Bez souhlasu se zpracováním údajů se přihláška nesmí uložit vůbec.
  -- Proto CHECK na `true`, ne jen NOT NULL.
  souhlas_gdpr boolean not null check (souhlas_gdpr = true),

  -- Variabilní symbol ze `seq_variabilni_symbol`. Default schválně NENÍ —
  -- ať se nedá vyrobit řádek s číslem odjinud než ze sekvence.
  variabilni_symbol bigint not null unique,

  stav text not null default 'nova'
    check (stav in ('nova', 'zaplaceno', 'zruseno')),

  -- Doplní se až při vystavení faktury
  faktura_cislo text,
  faktura_url   text,

  -- U převodu musí fakturační blok být vyplněný, u QR platby musí být prázdný.
  -- Jinak by v databázi zbyly polovyplněné údaje z rozmyšleného formuláře.
  constraint fakturace_jen_u_prevodu check (
    case
      when forma_platby = 'prevod' then
        fakt_nazev is not null and length(btrim(fakt_nazev)) > 0
        and fakt_adresa is not null and length(btrim(fakt_adresa)) > 0
        and fakt_ic is not null and fakt_ic ~ '^[0-9]{8}$'
      else
        fakt_nazev is null and fakt_adresa is null
        and fakt_ic is null and fakt_dic is null
    end
  )
);

comment on table public.prihlasky is
  'Přihlášky z webového formuláře. Zapisuje jen Edge Funkce prijmout-prihlasku servisním klíčem.';
comment on column public.prihlasky.variabilni_symbol is
  'Přiděluje se při registraci ze sekvence seq_variabilni_symbol.';
comment on column public.prihlasky.faktura_cislo is
  'Prázdné, dokud se faktura nevystaví. Formát RR/SS/NNN z funkce dalsi_cislo_faktury().';

-- Vyhledávání v administraci: podle stavu, data a variabilního symbolu.
create index if not exists prihlasky_stav_idx      on public.prihlasky (stav);
create index if not exists prihlasky_vytvoreno_idx on public.prihlasky (vytvoreno desc);
create index if not exists prihlasky_email_idx     on public.prihlasky (lower(email));

-- ---------------------------------------------------------------------------
-- ČÍSLOVÁNÍ FAKTUR
-- ---------------------------------------------------------------------------
-- Vrátí další číslo faktury ve tvaru RR/SS/NNN, například 26/03/001.
--   RR  – dvojčíslí roku (parametr `rok`, bere 2026 i 26)
--   SS  – řada faktur (parametr `rada`, chodí z konfigurace, není v kódu)
--   NNN – pořadí ze sekvence seq_faktura_poradi, doplněné nulami na 3 místa
--
-- POZOR: každé zavolání sekvenci posune. Volat až ve chvíli, kdy se faktura
-- opravdu vystavuje, ne „pro jistotu dopředu" — jinak vzniknou díry v řadě.
create or replace function public.dalsi_cislo_faktury(rok int, rada text)
returns text
language plpgsql
volatile
security definer
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

  -- 2026 i 26 dají stejné „26"
  rr := lpad((rok % 100)::text, 2, '0');

  -- Řada se nechává tak, jak přijde z konfigurace, jen se zarovná na 2 znaky.
  ss := lpad(btrim(rada), 2, '0');

  nnn := lpad(nextval('public.seq_faktura_poradi')::text, 3, '0');

  return rr || '/' || ss || '/' || nnn;
end;
$$;

comment on function public.dalsi_cislo_faktury(int, text) is
  'Další číslo faktury RR/SS/NNN. Posouvá sekvenci — volat až při vystavení faktury.';

-- Přidělení variabilního symbolu. Obal nad sekvencí, aby se dal zavolat
-- z Edge Funkce přes RPC. V kódu se VS negeneruje nikdy.
create or replace function public.dalsi_variabilni_symbol()
returns bigint
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  select nextval('public.seq_variabilni_symbol');
$$;

comment on function public.dalsi_variabilni_symbol() is
  'Další variabilní symbol ze seq_variabilni_symbol. Jediný povolený zdroj VS.';

-- ---------------------------------------------------------------------------
-- ZABEZPEČENÍ (RLS a oprávnění)
-- ---------------------------------------------------------------------------
-- V přihláškách jsou jména, e-maily, telefony a adresy lidí. Veřejný klíč
-- (`anon`) je v prohlížeči každého návštěvníka, takže se s ním k téhle
-- tabulce nesmí dostat vůbec nikdo.
--
-- Proč to není „anon smí INSERT":
--   1. INSERT přes PostgREST umí vrátit vložený řádek přes RETURNING
--      (hlavička `Prefer: return=representation`). Bez SELECT policy to sice
--      selže, ale je to zbytečně tenký led.
--   2. S právem INSERT může kdokoli tabulku zaplavit nesmysly a hlavně
--      protočit sekvenci variabilních symbolů.
-- Zápis proto dělá výhradně Edge Funkce `prijmout-prihlasku` servisním klíčem,
-- který RLS obchází a na server se z prohlížeče nikdy nedostane.

alter table public.prihlasky enable row level security;
-- I kdyby se někdo dostal k roli vlastníka tabulky, RLS platí i na ni.
alter table public.prihlasky force row level security;

-- Záměrně tu NENÍ ŽÁDNÁ policy. Zapnuté RLS bez policy = nikdo kromě
-- service_role neprojde. Kdyby se sem někdy přidávala policy pro čtení,
-- musí být vázaná na přihlášeného správce, nikdy ne na `anon`.

-- Samotné RLS by u čtení vrátilo prázdný seznam a HTTP 200. Odebráním
-- oprávnění dostane volající rovnou „permission denied" — je to jasnější
-- při kontrole a chrání to i proti omylem přidané policy.
revoke all on public.prihlasky from anon, authenticated;
revoke all on sequence public.seq_variabilni_symbol from anon, authenticated;
revoke all on sequence public.seq_faktura_poradi   from anon, authenticated;

-- Funkce v public jsou přes RPC veřejně volatelné. Sekvencemi nesmí točit
-- nikdo zvenku, jinak by šlo číslování faktur posunout kamkoli.
revoke all on function public.dalsi_cislo_faktury(int, text) from public, anon, authenticated;
revoke all on function public.dalsi_variabilni_symbol()      from public, anon, authenticated;
grant execute on function public.dalsi_cislo_faktury(int, text) to service_role;
grant execute on function public.dalsi_variabilni_symbol()      to service_role;

-- ---------------------------------------------------------------------------
-- ÚLOŽIŠTĚ QR KÓDŮ
-- ---------------------------------------------------------------------------
-- Obrázek QR platby se ukládá sem a do e-mailu jde jako odkaz. Gmail
-- nezobrazuje obrázky vložené přímo v těle e-mailu (data URI), takže musí
-- být veřejně dostupný na adrese.
--
-- Bucket je veřejný pro ČTENÍ. Název souboru je variabilní symbol, žádné
-- osobní údaje v obrázku ani v názvu nejsou. Nahrávat smí jen servisní klíč.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('qr', 'qr', true, 262144, array['image/png'])
on conflict (id) do update
  set public = true,
      file_size_limit = 262144,
      allowed_mime_types = array['image/png'];
