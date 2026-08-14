-- Schvalování přihlášek na veřejnou mapku a souřadnice měst.
--
-- K ČEMU TO JE
-- Na webu vznikla veřejná mapka přihlášených akcí. Nesmí se na ni dostat
-- cokoli, co kdo vyplní do formuláře — správkyně (Hana) každou přihlášku
-- napřed projde a teprve schválená akce se na mapce objeví.
--
-- DVĚ RŮZNÉ OSY, KTERÉ SE NESMÍ MÍCHAT
--   `stav`     — nova / zaplaceno / zruseno. Jak je na tom PLATBA.
--   `schvaleno`— ceka / schvaleno / zamitnuto. Jestli se akce smí ukázat
--                na VEŘEJNÉ MAPCE.
-- Zaplaceno neznamená schváleno a naopak. Kdyby to byl jeden sloupec, mohla
-- by se na mapku dostat akce jen proto, že někdo poslal peníze — a naopak by
-- schválení akce vypadalo jako potvrzení platby. Proto dva sloupce.
--
-- CO TAHLE MIGRACE NEMĚNÍ
-- Zabezpečení tabulky `prihlasky`. Zůstává zapnuté a vynucené RLS bez jediné
-- policy a `anon` i `authenticated` mají dál nula oprávnění — přesně tak, jak
-- to zavedla migrace 20260812120000_prihlasky.sql a jak to zdůvodnila migrace
-- 20260812160000_administrace.sql. Veřejná mapka se k datům nedostane přímo,
-- ale přes Edge Funkci `verejne-akce`, která servisním klíčem vydá jen
-- schválené akce a jen neosobní sloupce. Podrobně v sekci ZABEZPEČENÍ dole.

-- ---------------------------------------------------------------------------
-- SCHVÁLENÍ NA MAPU
-- ---------------------------------------------------------------------------

alter table public.prihlasky
  -- Výchozí `ceka` schválně: nová přihláška se na mapce NEOBJEVÍ, dokud ji
  -- někdo ručně nepustí dál. Kdyby výchozí hodnota byla `schvaleno`, stačilo
  -- by jedno zapomenutí a na veřejné mapce by byl kdokoli.
  add column if not exists schvaleno text not null default 'ceka',

  -- Přihlašovací adresa toho, kdo rozhodl. Jen pro dohledání „kdo to pustil
  -- na web", na oprávnění to nemá vliv.
  add column if not exists schvalil text,

  -- Kdy padlo rozhodnutí. Vyplňuje Edge Funkce při každé změně.
  add column if not exists schvaleno_kdy timestamptz;

-- Povolené hodnoty. Přidává se zvlášť, aby migrace prošla i na databázi,
-- kde sloupec z nějakého důvodu už existuje.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.prihlasky'::regclass
      and conname = 'prihlasky_schvaleno_hodnoty'
  ) then
    alter table public.prihlasky
      add constraint prihlasky_schvaleno_hodnoty
      check (schvaleno in ('ceka', 'schvaleno', 'zamitnuto'));
  end if;
end;
$$;

comment on column public.prihlasky.schvaleno is
  'Schválení na VEŘEJNOU MAPKU: ceka / schvaleno / zamitnuto. Jiná osa než sloupec stav, který řeší platbu.';
comment on column public.prihlasky.schvalil is
  'E-mail správce, který o zveřejnění rozhodl. Jen pro dohledání.';
comment on column public.prihlasky.schvaleno_kdy is
  'Kdy padlo rozhodnutí o zveřejnění na mapce.';

-- ---------------------------------------------------------------------------
-- SOUŘADNICE PRO MAPKU
-- ---------------------------------------------------------------------------
-- Přihláška obsahuje město a kraj, ne souřadnice. Dohledávají se v OpenStreetMap
-- (Nominatim) JEDNOU při schválení a ukládají se sem.
--
-- Proč se neschovávají až do načtení mapky: Nominatim je veřejná služba
-- s limitem jeden dotaz za vteřinu. Kdyby se souřadnice hledaly při každém
-- otevření mapky, po pár desítkách akcí by mapka trvala minutu a nás by
-- zablokovali. Takhle se hledá jednou na akci a mapka jen čte hotová čísla.

alter table public.prihlasky
  add column if not exists lat double precision,
  add column if not exists lng double precision,

  -- Jak dopadlo hledání. Musí se poznat rozdíl mezi „ještě se nehledalo",
  -- „město se nenašlo" a „služba zrovna nejela" — s každou situací naloží
  -- správkyně jinak (překlep v názvu vs. zkusit za chvíli znovu).
  add column if not exists souradnice_stav text not null default 'nezjistovano',

  -- Kdy se naposledy hledalo.
  add column if not exists souradnice_kdy timestamptz,

  -- Celá česká věta, proč se to nepovedlo. Zobrazuje se v administraci,
  -- takže musí být srozumitelná i pro netechnického člověka.
  add column if not exists souradnice_duvod text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.prihlasky'::regclass
      and conname = 'prihlasky_souradnice_stav_hodnoty'
  ) then
    alter table public.prihlasky
      add constraint prihlasky_souradnice_stav_hodnoty
      check (souradnice_stav in ('nezjistovano', 'nalezeno', 'nenalezeno', 'chyba'));
  end if;

  -- Buď jsou obě čísla, nebo ani jedno. Polovina souřadnice je bod
  -- uprostřed oceánu, ne chyba, které si někdo všimne.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.prihlasky'::regclass
      and conname = 'prihlasky_souradnice_par'
  ) then
    alter table public.prihlasky
      add constraint prihlasky_souradnice_par
      check ((lat is null) = (lng is null));
  end if;

  -- Rozsah zeměpisných souřadnic. Pojistka proti prohozenému lat/lng
  -- nebo špatně přečtené odpovědi ze služby.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.prihlasky'::regclass
      and conname = 'prihlasky_souradnice_rozsah'
  ) then
    alter table public.prihlasky
      add constraint prihlasky_souradnice_rozsah
      check (
        (lat is null or (lat >= -90 and lat <= 90))
        and (lng is null or (lng >= -180 and lng <= 180))
      );
  end if;
end;
$$;

comment on column public.prihlasky.lat is
  'Zeměpisná šířka města. Dohledává se jednou při schválení přes Nominatim (OpenStreetMap).';
comment on column public.prihlasky.lng is
  'Zeměpisná délka města. Prázdné = akce se na mapce neukáže, ale schválená je.';
comment on column public.prihlasky.souradnice_stav is
  'nezjistovano / nalezeno / nenalezeno / chyba. Rozlišuje překlep v názvu města od výpadku služby.';
comment on column public.prihlasky.souradnice_duvod is
  'Česká věta pro administraci, proč se souřadnice nepovedlo dohledat.';

-- Mapka se ptá vždycky na totéž: schválené akce, které mají souřadnice.
-- Částečný index je proto malý a dotaz mapky přes něj projde rovnou.
create index if not exists prihlasky_na_mapu_idx
  on public.prihlasky (schvaleno)
  where schvaleno = 'schvaleno' and lat is not null;

-- Administrace filtruje podle schválení, i u čekajících a zamítnutých.
create index if not exists prihlasky_schvaleno_idx
  on public.prihlasky (schvaleno);

-- ---------------------------------------------------------------------------
-- ZABEZPEČENÍ
-- ---------------------------------------------------------------------------
-- Tady je nejcitlivější místo celé změny: na veřejnou mapku se poprvé dostávají
-- data z tabulky, ve které jsou jména, e-maily, telefony a fakturační adresy.
--
-- ZVAŽOVANÉ CESTY
--   A) Přidat `anon` právo SELECT a policy `using (schvaleno = 'schvaleno')`.
--      ZAMÍTNUTO. Policy sice omezí ŘÁDKY, ale ne SLOUPCE — kdokoli s veřejným
--      klíčem (a ten je v prohlížeči každého návštěvníka) by si mohl vyžádat
--      `select=email,telefon,kontaktni_osoba` u všech schválených akcí.
--      Sloupcová práva by se musela hlídat zvlášť a při každém přidání sloupce
--      by na ně někdo musel myslet. To je jistá budoucí chyba.
--
--   B) Veřejný pohled (view) jen s neosobními sloupci.
--      ZAMÍTNUTO. Fungovalo by, ale znamená to vrátit `anon` právo číst něco
--      v `public` a nadobro tím ztratit jednoduché pravidlo „anon na přihlášky
--      nemá vůbec nic", které se dá zkontrolovat jedním dotazem.
--
--   C) Edge Funkce `verejne-akce` se servisním klíčem, která vybere řádky
--      i sloupce v kódu.  ← ZVOLENO
--
-- PROČ C
--   * Na oprávněních se nemění ANI ŘÁDEK. `anon` i `authenticated` mají na
--     `prihlasky` dál nula práv a přímý dotaz jim vrátí „permission denied".
--   * Seznam veřejných polí je na jednom místě v kódu funkce, česky
--     okomentovaný. Nový sloupec v tabulce se na web nedostane sám od sebe —
--     musel by ho tam někdo výslovně dopsat.
--   * Funkce umí i pravidlo, které se v SQL vyjadřuje blbě: `nazev_poradatele`
--     se posílá jen u školy a organizace. U jednotlivce je to jméno člověka
--     a na veřejnou mapu nepatří.
--
-- Pro jistotu se oprávnění odebírají znovu. Kdyby je někdo mezitím omylem
-- přidal, tenhle řádek to vrátí zpátky.
revoke all on public.prihlasky from anon, authenticated;
