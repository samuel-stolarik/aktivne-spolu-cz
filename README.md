# aktivne-spolu.cz

Registrační web k celostátnímu projektu **Mezigeneračně aktivně spolu** —
k Mezinárodnímu dni seniorů.

Školy, firemní týmy, neziskovky a jednotlivci se tu přihlásí, že v týdnu kolem
1. října uspořádají mezigenerační setkání se seniory. Za registraci zaplatí
500 Kč. Po akci vyplní rozšířený formulář a z toho v listopadu vznikne veřejná
databáze inspirace — Zásobník mezigeneračních aktivit, který staví kroužek
na ZŠ Magic Hill. Zásobník **není** součástí tohoto webu.

Pořadatel: **Právě teď! o.p.s.** (IČO 29154901), neplátce DPH, ve spolupráci
se ZŠ Magic Hill.

---

## Co tenhle web umí

- Jedna statická stránka s osmi sekcemi
- Dvě právní podstránky
- Registrační formulář, který uloží přihlášku, přidělí variabilní symbol
  a pošle potvrzovací e-mail s platebními údaji a QR kódem
- Škole a organizaci předvyplní fakturační údaje z rejstříku ARES podle IČO
  (na stisk tlačítka, nikdy samo od sebe)
- Volitelně spustí vystavení faktury (scénář v Make)

Na hostingu běží **jen statické soubory**. Žádné PHP, žádný server.
Všechno dynamické obstarává Supabase.

---

## Co potřebuješ

- **Node.js 22.12** nebo novější (`node -v`)
- Přístup k Supabase projektu (viz níž)
- FTP klienta pro nahrání na hosting

---

## Spuštění na svém počítači

```bash
npm install          # jednou, stáhne závislosti
cp .env.example .env # a doplň hodnoty, viz komentáře v souboru
npm run dev          # spustí náhled na http://localhost:4321
```

Změny v souborech se v prohlížeči projeví samy, není potřeba nic obnovovat.

---

## Sestavení a nahrání na hosting

```bash
npm run zip
```

Příkaz sestaví web a zabalí ho do `dist.zip`. V archivu je **obsah** složky
`dist/`, ne složka samotná — po rozbalení tedy rovnou vznikne `index.html`
v kořeni webu.

Postup na FTP (WebGlobe):

1. Připoj se FTP klientem k hostingu.
2. Přejdi do kořenové složky webu (obvykle `www` nebo `public_html`).
3. **Smaž její dosavadní obsah.**
4. Nahraj do ní obsah `dist.zip`.

Web jde na kořen domény, takže v `astro.config.mjs` je `base: "/"`.
Kdyby se web někdy přesouval do podsložky, mění se to tam.

---

## Kde je co

```
podklady/         Schválené texty a logo od zadavatele. Zdroj pravdy pro obsah.
src/pages/        Stránky webu (každý soubor = jedna adresa)
src/components/   Stavební díly stránek
src/layouts/      Společný obal všech stránek
src/lib/platba/   Výpočty kolem platby — IBAN, QR kód, číslo faktury
src/styles/       Barvy, písmo, animace
public/           Soubory kopírované beze změny (písmo, obrázky)
supabase/         Databáze a serverová funkce
make/             Scénář pro vystavování faktur
docs/             Doplňující dokumentace
```

### Texty

Texty sekcí jsou v `podklady/texty.md` a jsou **schválené zadavatelem**.
Nepřepisují se ani nezkracují. Když je potřeba změna, mění se nejdřív tam
a pak v komponentě.

Místa, kde údaj zatím chybí, jsou označená `[DOPLNIT: co]`. Kompletní seznam
najdeš příkazem:

```bash
grep -rn "DOPLNIT" --include="*.astro" --include="*.ts" --include="*.md" --include="*.json" .
```

---

## Supabase

Projekt: `kourmwqxkhdtahbxyuaq`, region eu-central-1 (Frankfurt).

### Tabulka `prihlasky`

Všechna pole z formuláře, plus:

| Sloupec | K čemu |
|---|---|
| `variabilni_symbol` | Přiděluje se při registraci ze sekvence `seq_variabilni_symbol` (od 100001) |
| `stav` | `nova` → `zaplaceno` / `zruseno` |
| `faktura_cislo` | Doplní se až při vystavení faktury, tvar `RR/SS/<variabilní symbol>`, např. `26/03/100001` |
| `faktura_url` | Odkaz na PDF faktury |

**Variabilní symbol a číslo faktury jsou dvě různé věci.** Variabilní symbol
dostane každý hned při registraci. Číslo faktury se přiděluje až ve chvíli,
kdy se faktura opravdu vystavuje — jinak by v číslech faktur byly díry
po lidech, kteří se přihlásili a nezaplatili. Každé má proto vlastní sekvenci
a obě čísla vydává výhradně databáze, nikdy aplikace ani Make.

### Zabezpečení

V přihláškách jsou jména, e-maily, telefony a adresy lidí. Veřejný klíč je
v prohlížeči každého návštěvníka, takže se s ním k tabulce nesmí dostat nikdo:

- RLS je zapnuté (`enable` i `force`)
- Na tabulce **není žádná policy** — zapnuté RLS bez policy znamená,
  že neprojde nikdo kromě servisního klíče
- Anonymní i přihlášené roli jsou navíc odebraná všechna oprávnění

Zápis dělá výhradně Edge Funkce `prijmout-prihlasku` servisním klíčem, který
se do prohlížeče nikdy nedostane.

Ověřeno reálným dotazem — pokus anonymním klíčem skončí
`HTTP 401, code 42501, permission denied`:

```bash
curl "$PUBLIC_SUPABASE_URL/rest/v1/prihlasky?select=*" \
  -H "apikey: $PUBLIC_SUPABASE_ANON_KEY"
```

### Nasazení změn

```bash
npx supabase link --project-ref kourmwqxkhdtahbxyuaq
npx supabase db push                          # migrace databáze
npx supabase functions deploy prijmout-prihlasku
npx supabase functions deploy ares-lookup
```

Podrobnosti v [supabase/README-supabase.md](supabase/README-supabase.md).

### Načítání z ARESu

Když se hlásí škola nebo organizace, formulář se zeptá na IČO a na stisk
tlačítka **Načíst z rejstříku** předvyplní název, adresu a případně DIČ.

- Data dodává Edge Funkce `ares-lookup` — prohlížeč na ARES sám nedosáhne
  kvůli chybějícím CORS hlavičkám.
- Načítá se **výhradně po stisku tlačítka**. Nikdy tiše při otevření stránky.
- Všechna předvyplněná pole jde přepsat. ARES má adresu občas v jiném tvaru,
  než chce účetní.
- Chybějící DIČ znamená neplátce DPH, ne chybu.
- Když rejstřík IČO nezná nebo neodpovídá, řekne se to slovně a formulář jde
  vyplnit ručně. **Výpadek ARESu registraci nezablokuje.**

Kód: `src/lib/ares.ts` (volání z prohlížeče) a
`supabase/functions/ares-lookup/index.ts` (průchoďák na ARES).

---

## Fakturace přes Make

Scénář a návod k importu jsou v [make/README-make.md](make/README-make.md).

**Dvě věci, které se nepřenášejí s blueprintem** a bez kterých fakturace
nepojede:

1. **Připojení služeb.** Po importu se musí v cílovém účtu znovu připojit
   Gmail a ostatní služby. To je normální a počítá se s tím.
2. **Adresa webhooku.** Po importu vznikne nová a musí se přepsat do proměnné
   `MAKE_WEBHOOK_URL` v Supabase. Když se na to zapomene, **formulář poběží
   dál, lidem se zobrazí poděkování a faktury tiše nepojedou.**

Dokud je `MAKE_WEBHOOK_URL` prázdná, krok se přeskočí bez chyby — přihlášky
se ukládají a potvrzovací e-maily chodí, jen se nevystavují faktury.

---

## DNS pro aktivne-spolu.cz

Aby potvrzovací e-maily nekončily ve spamu, musí doména povolit odesílání
přes Google Workspace. Nastavuje se to u správce domény:

| Typ | Název | Hodnota |
|---|---|---|
| TXT | `@` | `v=spf1 include:_spf.google.com ~all` |
| TXT | `google._domainkey` | klíč DKIM vygenerovaný v konzoli Google Workspace |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:[DOPLNIT: adresa pro souhrnné zprávy]` |

DKIM se generuje v **Google Admin → Aplikace → Google Workspace → Gmail →
Ověřit e-mail**. Vygenerovaný záznam se vloží do DNS a pak se v konzoli
zapne autentizace.

Záznamy se v internetu rozšíří obvykle do hodiny, výjimečně za 24 hodin.
Dokud se tak nestane, e-maily mohou padat do spamu.

---

## Co se doplní v další fázi

- **Zásobník mezigeneračních aktivit** — samostatná aplikace, kterou staví
  kroužek na ZŠ Magic Hill. Spouští se 1. listopadu.

---

## Varianty vzhledu k rozhodnutí

Dočasně jsou k dispozici dvě varianty oddělení sekcí, obě nad úplně stejným
obsahem:

- `/` — varianta A: velkorysý prostor, změna plochy a jemná meruňková linka
- `/varianta-b/` — varianta B: sekce jako bílé listy s měkkým stínem

Při `npm run dev` se dole zobrazí přepínač mezi nimi. Do produkčního buildu
se nedostane. Až padne rozhodnutí, smaže se `src/pages/varianta-b.astro`
a `src/components/PrepinacVariant.astro`.
