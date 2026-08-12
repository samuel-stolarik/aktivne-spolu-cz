-- Úložiště vystavených faktur.
--
-- Proč zvlášť a ne do bucketu `qr`: obrázek QR kódu je veřejný schválně —
-- musí se načíst přímo v e-mailu a není v něm nic osobního. Na faktuře je
-- naopak jméno, adresa a IČO plátce. Kdyby ležela ve veřejném bucketu, stačilo
-- by uhodnout název souboru a faktury by si mohl stáhnout kdokoli.
--
-- Proto je tenhle bucket NEveřejný. Přístup má jen servisní klíč (fakturační
-- automat) a odkaz pro člověka se vytváří jako podepsaný, dočasně platný.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('faktury', 'faktury', false, 10485760, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = 10485760,   -- 10 MB, faktura je pár set kilobajtů
      allowed_mime_types = array['application/pdf'];

-- Záměrně tu NENÍ žádná policy pro čtení ani zápis. Bez policy se k bucketu
-- dostane pouze servisní klíč, který bezpečnostní pravidla obchází. Kdyby se
-- sem někdy přidávala policy, musí být vázaná na přihlášeného správce —
-- nikdy ne na veřejnou roli `anon`.
