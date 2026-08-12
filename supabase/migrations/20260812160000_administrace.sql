-- Administrace webu — správci, přepisy textů a úložiště obrázků.
--
-- K čemu to je
-- ------------
-- Web aktivne-spolu.cz je STATICKÝ. Hotové soubory se ručně nahrají FTP
-- klientem na hosting a od té chvíle je nemá kdo přestavět — žádný build
-- server neexistuje. Kdyby texty byly natvrdo v HTML, správce by je bez
-- programátora nikdy nezměnil.
--
-- Proto tabulka `obsah`: drží POUZE PŘEPISY. V HTML zůstávají původní texty
-- jako výchozí a stránka si po načtení vyzvedne přepisy a doplní je.
-- Když je databáze nedostupná nebo přepis neexistuje, zobrazí se výchozí text
-- a nikdo nepozná, že se něco nenačetlo. Výpadek databáze tedy nikdy
-- nevyprázdní web.
--
-- Co tahle migrace NEMĚNÍ
-- -----------------------
-- Tabulky `prihlasky` se nedotýká ANI JEDNÍM ŘÁDKEM. Zůstává na ní zapnuté
-- a vynucené RLS bez jediné policy a odebraná všechna oprávnění pro `anon`
-- i `authenticated` — přesně tak, jak to zavedla migrace
-- 20260812120000_prihlasky.sql.
--
-- Administrace se k přihláškám dostane VÝHRADNĚ přes Edge Funkci
-- `admin-obsah`, která běží servisním klíčem. Zdůvodnění, proč zrovna takhle
-- a ne přes policy, je dole v sekci ZABEZPEČENÍ.

-- ---------------------------------------------------------------------------
-- SPRÁVCI
-- ---------------------------------------------------------------------------
-- Jmenný seznam účtů, které smí do administrace. Bez záznamu v téhle tabulce
-- se přihlášený člověk k datům nedostane, i kdyby měl platné heslo.
--
-- Proč to nestačí ověřit tím, že je někdo přihlášený:
-- Role `authenticated` v Supabase znamená jen „má platný účet". Kdyby se
-- kdykoli v budoucnu k projektu přidalo cokoli, kde si účet zakládá běžný
-- návštěvník (třeba přihlašování do Zásobníku nápadů), měl by rázem přístup
-- i do administrace. Jmenný seznam tohle vylučuje jednou provždy.
create table if not exists public.spravci (
  -- Odkaz na účet v Supabase Auth. Když se účet smaže, zmizí i oprávnění.
  uzivatel uuid primary key references auth.users (id) on delete cascade,

  -- Jen pro lidi, ať je v tabulce poznat, komu řádek patří.
  -- Přihlašovací adresa je v auth.users, tohle je poznámka, ne zdroj pravdy.
  poznamka text,

  pridano timestamptz not null default now()
);

comment on table public.spravci is
  'Účty s přístupem do administrace. Ověřuje Edge Funkce admin-obsah. Řádky se zakládají ručně, viz README-supabase.md.';

alter table public.spravci enable row level security;
alter table public.spravci force row level security;

-- Záměrně žádná policy. Seznam správců čte jen Edge Funkce servisním klíčem.
-- Kdyby si ho mohl přečíst přihlášený uživatel, dozvěděl by se, na které účty
-- se vyplatí útočit.
revoke all on public.spravci from anon, authenticated;

-- ---------------------------------------------------------------------------
-- PŘEPISY TEXTŮ A OBRÁZKŮ
-- ---------------------------------------------------------------------------
-- Jeden řádek = jeden přepsaný text nebo obrázek.
--
-- Klíče (`klic`) jsou vypsané v souboru src/lib/obsah.ts. Tam je u každého
-- napsané, kde na webu je a jaký je jeho původní text. Tahle tabulka je
-- schválně „hloupá" — nezná seznam povolených klíčů. Kdyby ho znala, každá
-- změna textu na webu by znamenala zásah do databáze.
--
-- Řádek tu je JEN pro text, který správce opravdu změnil. Nezměněné texty
-- v tabulce nejsou vůbec a berou se z HTML.
create table if not exists public.obsah (
  -- Například `hero.nadpis`. Tečková notace jen pro přehlednost, databáze
  -- ji nijak nevyhodnocuje.
  klic text primary key,

  -- Nový text, který se má na webu zobrazit místo původního.
  -- U obrázků je tady celá adresa souboru v úložišti.
  hodnota text not null,

  upraveno timestamptz not null default now(),

  -- Přihlašovací adresa správce, který změnu udělal. Jen pro dohledání,
  -- kdo co přepsal — na oprávnění to nemá vliv.
  upravil text
);

comment on table public.obsah is
  'Přepisy textů a obrázků webu. Prázdná tabulka = web zobrazuje původní texty z HTML.';
comment on column public.obsah.klic is
  'Klíč z katalogu v src/lib/obsah.ts, například hero.nadpis.';
comment on column public.obsah.hodnota is
  'Nový text, u obrázků adresa souboru v úložišti.';

-- Datum poslední úpravy se má hlídat samo, ne spoléhat na to, že ho aplikace
-- pošle. Jinak by šlo uložit změnu s libovolným datem.
create or replace function public.obsah_zapis_datum()
returns trigger
language plpgsql
as $$
begin
  new.upraveno := now();
  return new;
end;
$$;

drop trigger if exists obsah_datum on public.obsah;
create trigger obsah_datum
  before insert or update on public.obsah
  for each row execute function public.obsah_zapis_datum();

-- ---------------------------------------------------------------------------
-- ÚLOŽIŠTĚ OBRÁZKŮ
-- ---------------------------------------------------------------------------
-- Vlastní bucket schválně. `qr` ani `faktury` se na tohle použít nesmí:
-- v `qr` jsou obrázky plateb a v `faktury` doklady s adresami plátců.
-- Míchat je s obrázky z webu by znamenalo, že jedno špatné nastavení práv
-- ohrozí i to druhé.
--
-- Tenhle bucket je veřejný pro ČTENÍ — obrázky se zobrazují návštěvníkům
-- webu, takže veřejně dostupné být musí. Nic osobního v nich není.
--
-- Nahrávat smí jen servisní klíč. Prohlížeč správce dostane od Edge Funkce
-- `admin-obsah` jednorázovou podepsanou adresu s krátkou platností a nahraje
-- soubor na ni. Servisní klíč se přitom do prohlížeče vůbec nedostane.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'obsah-obrazky',
  'obsah-obrazky',
  true,
  5242880,   -- 5 MB; fotka z webu se do toho vejde s rezervou
  array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
on conflict (id) do update
  set public = true,
      file_size_limit = 5242880,
      allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

-- Záměrně tu není žádná policy pro zápis. Bez policy nahraje soubor jen
-- servisní klíč (a podepsaná adresa, kterou servisní klíč vystavil).

-- ---------------------------------------------------------------------------
-- ZABEZPEČENÍ
-- ---------------------------------------------------------------------------
--
-- 1) TABULKA `obsah` — číst smí kdokoli, zapisovat nikdo zvenčí
--
-- Číst musí i nepřihlášený návštěvník: jsou to texty, které stejně vidí
-- na stránce. Nic osobního ani neveřejného v nich není. Web si je proto
-- vyzvedne přímo veřejným (anonymním) klíčem, bez Edge Funkce — je to
-- rychlejší a hlavně to znamená, že se stránka načte i tehdy, když by
-- Edge Funkce nejela.
--
-- Zapisovat NESMÍ nikdo kromě administrace. Zápis se hlídá dvakrát:
--   a) `anon` ani `authenticated` nemají oprávnění INSERT/UPDATE/DELETE,
--      takže dostanou rovnou „permission denied";
--   b) i kdyby oprávnění někdo omylem přidal, policy níž povoluje jen SELECT
--      a pro zápis žádná policy neexistuje.
alter table public.obsah enable row level security;
alter table public.obsah force row level security;

drop policy if exists obsah_ctou_vsichni on public.obsah;
create policy obsah_ctou_vsichni
  on public.obsah
  for select
  to anon, authenticated
  using (true);

-- Nejdřív všechno pryč, teprve pak přidat jen čtení. Kdyby se v budoucnu
-- migrace spustila znovu na změněné databázi, tenhle pořádek zaručí,
-- že se práva neseberou napůl.
revoke all on public.obsah from anon, authenticated;
grant select on public.obsah to anon, authenticated;

--
-- 2) TABULKA `prihlasky` — beze změny, přístup jen přes Edge Funkci
--
-- Migrace 20260812120000_prihlasky.sql tabulku uzamkla: RLS zapnuté
-- a vynucené, žádná policy, odebraná všechna oprávnění. Volba byla mezi
-- dvěma cestami, jak k datům pustit správce:
--
--   A) Přidat policy pro čtení a vrátit roli `authenticated` právo SELECT.
--      Policy by pouštěla jen ty, kdo jsou v tabulce `spravci`.
--      Nevýhoda: aby policy vůbec mohla fungovat, musí se roli
--      `authenticated` vrátit oprávnění na tabulku. Ochrana pak stojí
--      a padá na jediném řádku policy. Když ho někdo v budoucnu upraví,
--      omylem smaže nebo přidá druhou policy s `using (true)`, přihlášky
--      jsou venku a nikde to nezakřičí.
--
--   B) Nechat tabulku úplně zamčenou a číst ji Edge Funkcí se servisním
--      klíčem, která si sama ověří, kdo volá.  ← ZVOLENO
--
-- Proč B:
--   * Na `prihlasky` se nemění vůbec nic. Zůstává nula oprávnění pro `anon`
--     i `authenticated`, takže i kdyby se do administrace někdo dostal,
--     přímý dotaz na tabulku mu vrátí „permission denied". Nemá jak si
--     vytáhnout něco jiného, než co funkce sama vydá.
--   * Ověření je vidět na jednom místě v kódu funkce a dá se přečíst
--     i bez znalosti PostgreSQL — projekt se předává neziskovce a navazuje
--     na něj kroužek na základní škole.
--   * Funkce vydá jen sloupce potřebné pro přehled a povolí jedinou změnu
--     (stav přihlášky). Přes policy by šlo číst celý řádek vždycky.
--
-- Jak funkce pozná správce (podrobně v supabase/functions/admin-obsah):
--   1. Z hlavičky Authorization vezme přihlašovací token prohlížeče.
--   2. Nechá si ho ověřit Supabase Auth. Token se nedá vyrobit ani upravit
--      bez tajného klíče projektu, takže tady padne každý podvrh.
--   3. Ověřené ID účtu vyhledá v tabulce `spravci`. Když tam není, funkce
--      vrátí 403 a k databázi vůbec nesáhne.
-- Teprve po všech třech krocích sáhne funkce servisním klíčem na data.
--
-- Servisní klíč je uložený jako tajemství Edge Funkce v Supabase.
-- Do prohlížeče se nedostane nikdy.
