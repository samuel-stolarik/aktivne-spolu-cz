-- ===========================================================================
-- Odchozí pošta
--
-- Tabulka, do které funkce odkládá hotové zprávy k odeslání. Make si je
-- odsud bere a posílá přes Outlook.
--
-- PROČ TO NEJDE JEDNODUŠEJI
-- Nabízí se poslat celý e-mail rovnou ve volání webhooku a Make by ho jen
-- předal dál. Nešlo by to: adresa webhooku je veřejná a nechráněná, takže
-- kdokoli, kdo ji zjistí, by přes ni mohl rozeslat libovolný text na
-- libovolnou adresu. Byla by z toho rozesílací služba pro spam.
--
-- Tímhle se to řeší: přes webhook jde jen ID. Obsah zprávy si Make přečte
-- odsud, kam se dostane jen se service_role klíčem. Útočník tak nanejvýš
-- způsobí, že se znovu odešle zpráva, která už stejně měla odejít.
--
-- DRUHÝ DŮVOD: ŠABLONA ZŮSTÁVÁ NA JEDNOM MÍSTĚ
-- Kdyby si e-mail skládal Make, existovala by šablona dvakrát — v kódu
-- a v modulu — a dřív nebo později by se rozešly. Takhle ji skládá funkce
-- a Make je jen doručovatel.
--
-- TŘETÍ DŮVOD: OPAKOVÁNÍ ZADARMO
-- Když odeslání selže, řádek prostě zůstane ve stavu „ceka". Nic se
-- neztratí a další běh ho vezme znovu.
-- ===========================================================================

create table if not exists public.odchozi_posta (
  id uuid primary key default gen_random_uuid(),
  vytvoreno timestamptz not null default now(),

  -- Ke které přihlášce zpráva patří. Když se přihláška smaže, zmizí
  -- i nedoručená pošta k ní — jinak by se odeslala zpráva o něčem,
  -- co už neexistuje.
  prihlaska_id uuid references public.prihlasky (id) on delete cascade,

  prijemce       text not null,
  prijemce_jmeno text,
  odpovedet_na   text,
  predmet        text not null,
  telo_text      text not null,
  telo_html      text,

  -- Příloha se NEUKLÁDÁ sem, jen cesta do úložiště. Faktura má desítky
  -- kilobajtů a leží v bucketu `faktury`; kopie v databázi by byla druhá
  -- pravda o tomtéž souboru.
  priloha_cesta text,
  priloha_nazev text,

  stav text not null default 'ceka'
    check (stav in ('ceka', 'odeslano', 'chyba')),
  pokusu integer not null default 0,
  odeslano_kdy timestamptz,
  chyba_text text
);

comment on table public.odchozi_posta is
  'Hotové zprávy k odeslání. Funkce sem zapisuje, odesílatel (Make přes '
  'Outlook, nebo přímo funkce) si je bere. Obsah se sem ukládá schválně: '
  'přes veřejný webhook smí jít jen ID, ne text zprávy.';

-- Odesílatel si vždycky bere nejstarší čekající. Index na to, ať nemusí
-- procházet celou tabulku, až jich tam bude pár tisíc.
create index if not exists odchozi_posta_ceka_idx
  on public.odchozi_posta (vytvoreno)
  where stav = 'ceka';

-- ---------------------------------------------------------------------------
-- ZABEZPEČENÍ
--
-- Stejný režim jako u přihlášek: RLS zapnuté a ŽÁDNÁ politika. Tím se
-- k tabulce nedostane nikdo kromě service_role klíče, který politiky
-- obchází. V tabulce jsou e-mailové adresy a celé texty zpráv — do
-- prohlížeče nesmí ani řádek.
-- ---------------------------------------------------------------------------
alter table public.odchozi_posta enable row level security;

revoke all on public.odchozi_posta from anon, authenticated;
