-- Číslo faktury se nově odvozuje z variabilního symbolu přihlášky.
--
-- ---------------------------------------------------------------------------
-- PROČ TAHLE ZMĚNA VZNIKLA
-- ---------------------------------------------------------------------------
-- Zadavatel chce, aby „variabilní symbol byl stejný jako číslo faktury" — ať
-- se na bankovním výpisu pozná, ke které faktuře platba patří, bez hledání
-- v tabulce.
--
-- DOSLOVA STEJNÉ TO BÝT NEMŮŽE a je potřeba to říct nahlas:
--   * variabilní symbol smí být POUZE ČÍSLICE, nejvýš deset. Do platebního
--     řetězce jde jako `X-VS` a banka jiný tvar nepřijme,
--   * číslo faktury má tvar `RR/SS/…` a obsahuje lomítka.
-- Lomítko se do variabilního symbolu nedostane, takže „stejný řetězec" není
-- technicky možný.
--
-- Místo toho se obě řady sjednocují na JEDNO POŘADOVÉ ČÍSLO:
--
--     variabilní symbol   100001
--     číslo faktury       26/03/100001
--                               ^^^^^^ tentýž variabilní symbol
--
-- Na faktuře i na platbě je pak vidět totéž číslo a spárování je na první
-- pohled. Víc než tohle jazyk platebních řetězců a číslování faktur dohromady
-- nedovolí.
--
-- ---------------------------------------------------------------------------
-- CO TÍM ZADAVATEL VĚDOMĚ MĚNÍ
-- ---------------------------------------------------------------------------
-- Původní návrh měl obě řady schválně oddělené (viz migraci
-- 20260812120000_prihlasky.sql): variabilní symbol se přiděluje hned při
-- registraci, kdežto pořadí faktury až při jejím vystavení. Díky tomu byla
-- řada faktur souvislá — 001, 002, 003 — bez ohledu na to, kolik lidí se
-- přihlásilo a nezaplatilo.
--
-- Po téhle změně bude v číslech faktur ŘÍDKÁ ŘADA: kdo se přihlásí a
-- nezaplatí, spotřebuje variabilní symbol, ale fakturu nedostane. Řada faktur
-- pak vypadá třeba 26/03/100003, 26/03/100007, 26/03/100008.
--
-- Je to vědomé rozhodnutí zadavatele a účetní o něm musí vědět. Zákon souvislou
-- číselnou řadu nevyžaduje (stačí, aby čísla byla jedinečná a vzestupná), díry
-- v řadě ale bývají první věc, na kterou se účetní ptá.
--
-- ---------------------------------------------------------------------------
-- SEKVENCE seq_faktura_poradi — UŽ SE NEPOUŽÍVÁ
-- ---------------------------------------------------------------------------
-- Pořadí faktury se nově nebere odnikud jinud než z variabilního symbolu, a ten
-- pochází ze `seq_variabilni_symbol`. Sekvence `seq_faktura_poradi` proto
-- ztrácí smysl.
--
-- ZÁMĚRNĚ SE NEMAŽE. Kdyby se zadavatel rozhodl vrátit k oddělené řadě (třeba
-- na doporučení účetní), je sekvence i s dosaženou hodnotou na místě a nemusí
-- se dohledávat, kde řada skončila. Smazat ji je jednořádková operace, obnovit
-- správnou hodnotu po smazání už ne.
--
-- Aby se nedala použít omylem, je opatřená komentářem a stará funkce, která ji
-- točila, je zrušená (níž).

-- ---------------------------------------------------------------------------
-- 1. ZRUŠENÍ STARÉ FUNKCE
-- ---------------------------------------------------------------------------
-- `dalsi_cislo_faktury(rok, rada)` brala pořadí ze `seq_faktura_poradi`.
-- Nechat ji vedle nové funkce by bylo nebezpečné: kdyby na ni někde zůstalo
-- staré volání, tiše by vystavilo fakturu ze zrušené řady (26/03/001) a nikdo
-- by si toho nevšiml až do chvíle účetní uzávěrky.
--
-- Zrušením se z tichého omylu stane hlasitá chyba: PostgREST na volání
-- `/rest/v1/rpc/dalsi_cislo_faktury` odpoví HTTP 404 „Could not find the
-- function", scénář v Make se zastaví a faktura zůstane nevystavená. Protože
-- se `faktura_cislo` zapisuje až na konci scénáře, pustí filtr přihlášku
-- příště znovu a faktura se dovystaví — nic se neztratí.
drop function if exists public.dalsi_cislo_faktury(int, text);

-- ---------------------------------------------------------------------------
-- 2. NOVÁ FUNKCE: ČÍSLO FAKTURY Z VARIABILNÍHO SYMBOLU
-- ---------------------------------------------------------------------------
-- Jméno se schválně změnilo z „dalsi_…" na „…_pro_vs". Slovo „další" slibovalo,
-- že funkce něco posouvá dopředu. Tahle nic neposouvá — pro stejný variabilní
-- symbol vrátí vždycky stejné číslo faktury.
--
-- Je to podstatná vlastnost, ne detail: když se webhook do fakturace doručí
-- dvakrát (což se stává), vznikne dvakrát TOTÉŽ číslo faktury místo dvou
-- různých. Duplicitní běh tedy nespálí číslo navíc a nevyrobí v řadě další díru.
--
--   26/03/100001
--   │  │  └── variabilní symbol přihlášky ze seq_variabilni_symbol
--   │  └───── SS – interní číslo řady faktur, dvě číslice, z konfigurace
--   └──────── RR – dvojčíslí roku vystavení (přijímá 2026 i 26)
create or replace function public.cislo_faktury_pro_vs(
  rok int,
  rada text,
  variabilni_symbol bigint
)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  rr text;
  ss text;
  vs text;
begin
  if rok is null then
    raise exception 'Chybí rok pro číslo faktury.';
  end if;
  if rada is null or length(btrim(rada)) = 0 then
    raise exception 'Chybí řada faktur (parametr rada).';
  end if;
  if variabilni_symbol is null then
    raise exception 'Chybí variabilní symbol. Číslo faktury se z něj odvozuje, bez něj nevznikne.';
  end if;
  if variabilni_symbol <= 0 then
    raise exception 'Variabilní symbol musí být kladné číslo, dostali jsme %.', variabilni_symbol;
  end if;

  vs := variabilni_symbol::text;

  -- Deset číslic je strop variabilního symbolu daný bankami. Kdyby ho řada
  -- někdy překročila, přestal by fungovat QR kód k platbě — a to se musí
  -- poznat tady, ne až u klienta v bankovní aplikaci.
  if length(vs) > 10 then
    raise exception 'Variabilní symbol % má víc než 10 číslic, banky takový nepřijmou.', vs;
  end if;

  -- 2026 i 26 dají stejné „26"
  rr := lpad((rok % 100)::text, 2, '0');

  -- Řada se nechává tak, jak přijde z konfigurace, jen se zarovná na 2 znaky.
  ss := lpad(btrim(rada), 2, '0');

  return rr || '/' || ss || '/' || vs;
end;
$$;

comment on function public.cislo_faktury_pro_vs(int, text, bigint) is
  'Číslo faktury RR/SS/<variabilní symbol>, například 26/03/100001. Nic neposouvá — pro stejný VS vrátí vždy totéž číslo.';

comment on sequence public.seq_faktura_poradi is
  'NEPOUŽÍVÁ SE od migrace 20260812170000. Pořadí faktury je nově variabilní symbol přihlášky. Sekvence zůstává jen pro případ návratu k oddělené řadě — viz komentář v té migraci.';

-- ---------------------------------------------------------------------------
-- 3. OPRÁVNĚNÍ
-- ---------------------------------------------------------------------------
-- Stejná přísnost jako u ostatních funkcí: cokoli v `public` je přes RPC
-- veřejně volatelné, dokud se to výslovně nezakáže. Číslo faktury si nemá
-- generovat návštěvník webu.
revoke all on function public.cislo_faktury_pro_vs(int, text, bigint) from public, anon, authenticated;
grant execute on function public.cislo_faktury_pro_vs(int, text, bigint) to service_role;

-- ---------------------------------------------------------------------------
-- 4. JEDINEČNOST ČÍSEL FAKTUR — HLÍDÁ DATABÁZE, NE DŮVĚRA
-- ---------------------------------------------------------------------------
-- Dvě faktury se stejným číslem jsou v účetnictví problém, který se špatně
-- opravuje a přijde se na něj pozdě. Že to nemůže nastat, plyne z řetězu:
--
--   1. `variabilni_symbol` je `not null unique` a bere se výhradně z sekvence
--      `seq_variabilni_symbol`. Sekvence stejné číslo nevydá dvakrát ani při
--      stovce souběžných přihlášek.
--   2. Číslo faktury končí právě tímhle variabilním symbolem. Dvě různé
--      přihlášky mají různý VS, tedy i různé číslo faktury.
--   3. VS se nikdy neresetuje ani mezi roky, takže se čísla faktur nekříží ani
--      napříč roky a řadami.
--
-- Spoléhat se na to, že tenhle řetěz nikdo nikdy neporuší, ale nestačí — číslo
-- faktury se do sloupce zapisuje zvenčí (scénář v Make) a tam se dá překlepnout
-- cokoli. Proto dvě pojistky přímo v databázi:

-- (a) Číslo faktury MUSÍ končit variabilním symbolem téhož řádku.
--     Tohle je ta silnější pojistka: fyzicky znemožňuje uložit k přihlášce
--     číslo faktury odvozené z cizího (nebo vymyšleného) variabilního symbolu.
alter table public.prihlasky
  drop constraint if exists faktura_cislo_odpovida_vs;
alter table public.prihlasky
  add constraint faktura_cislo_odpovida_vs check (
    faktura_cislo is null
    or faktura_cislo ~ ('^[0-9]{2}/[0-9]{2}/' || variabilni_symbol::text || '$')
  );

-- (b) Jedinečnost čísla faktury i tak, natvrdo.
--     Vyplývá už z bodu (a) a z unikátního VS, ale unikátní index je levný
--     a je to poslední záchytná síť, kdyby se někdy podmínka (a) uvolnila.
--     Prázdné hodnoty index nevadí — Postgres bere každé NULL jako jiné,
--     takže nevystavených faktur může být kolik chce.
create unique index if not exists prihlasky_faktura_cislo_idx
  on public.prihlasky (faktura_cislo);

-- ---------------------------------------------------------------------------
-- 5. AKTUALIZACE POPISŮ
-- ---------------------------------------------------------------------------
comment on column public.prihlasky.faktura_cislo is
  'Prázdné, dokud se faktura nevystaví. Formát RR/SS/<variabilní symbol>, například 26/03/100001. Skládá funkce cislo_faktury_pro_vs().';
comment on column public.prihlasky.variabilni_symbol is
  'Přiděluje se při registraci ze sekvence seq_variabilni_symbol. Slouží zároveň jako pořadové číslo faktury.';
