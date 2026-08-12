# Supabase — databáze a příjem přihlášek

Tahle složka je celé „zákulisí" webu aktivne-spolu.cz. Web samotný jsou
statické stránky na FTP hostingu — nic neumí a nic si nepamatuje. Všechno, co
si má projekt zapamatovat (přihlášky, variabilní symboly, čísla faktur), je
tady.

Návod je psaný tak, aby ho zvládl i někdo, kdo Supabase nikdy neviděl.

---

## Co je kde

```
supabase/
├── config.toml                    nastavení projektu
├── migrations/                    stavba databáze, spouští se po pořadí
│   ├── 20260812120000_prihlasky.sql       tabulka, sekvence, číslování faktur, zabezpečení
│   └── 20260812130000_bucket_faktury.sql  neveřejné úložiště na PDF faktur
├── functions/
│   ├── .env.example               vzor nastavení (patří do gitu)
│   ├── .env                       skutečné nastavení (do gitu NEPATŘÍ)
│   ├── _shared/                   společné kousky kódu
│   │   ├── spayd.ts                 skládání platebního řetězce pro QR
│   │   ├── qr.ts                    vykreslení QR kódu do obrázku PNG
│   │   └── gmail.ts                 odesílání e-mailů přes Google
│   ├── prijmout-prihlasku/
│   │   └── index.ts               příjem přihlášky z formuláře
│   └── ares-lookup/
│       └── index.ts               vyhledání fakturačních údajů v ARESu podle IČO
└── README-supabase.md             tenhle soubor
```

---

## Jak to funguje dohromady

1. Návštěvník vyplní formulář na webu.
2. Web pošle data na adresu funkce `prijmout-prihlasku`.
3. Funkce si data **znovu zkontroluje** (kontrole ve formuláři se nevěří).
4. Z databázové sekvence si vyzvedne **variabilní symbol**.
5. Přihlášku uloží.
6. Vyrobí **QR kód platby**, uloží ho do úložiště a získá na něj odkaz.
7. Pošle **potvrzovací e-mail** s částkou, číslem účtu a QR kódem.
8. Ozve se do **fakturace** (nepovinné).
9. Vrátí webu variabilní symbol a odkaz na QR kód.

**Kroky 6 až 8 nesmí přihlášku shodit.** Když nejede pošta nebo chybí číslo
účtu, přihláška se přesto uloží a člověk dostane svůj variabilní symbol.
Nedoručený e-mail se dá poslat ručně, ztracená přihláška se nedá vrátit.

---

## Databáze

### Tabulka `prihlasky`

Jeden řádek = jedna přihláška. Kromě kontaktů obsahuje:

| Sloupec | K čemu je |
| --- | --- |
| `variabilni_symbol` | číslo platby, unikátní, přiděluje se hned při registraci |
| `stav` | `nova` → `zaplaceno` nebo `zruseno` |
| `faktura_cislo`, `faktura_url` | prázdné, dokud se faktura nevystaví |

Databáze si sama hlídá, že:

- typ pořadatele, kraj, forma platby a stav jsou jen z povoleného seznamu
  (kraje jsou všechny české, přesně tak, jak se píšou),
- **souhlas se zpracováním údajů je `true`** — přihláška bez souhlasu se
  fyzicky nedá uložit,
- **fakturační údaje sedí k formě platby**: u převodu musí být vyplněný
  název, adresa a osmimístné IČO, u QR platby musí zůstat prázdné.

### Dvě oddělené sekvence

| Sekvence | Od kolika | Kdy se posune |
| --- | --- | --- |
| `seq_variabilni_symbol` | 100001 | při každé přijaté přihlášce |
| `seq_faktura_poradi` | 1 | **už se nepoužívá**, viz níž |

### Číslo faktury

Zadavatel chtěl, aby „variabilní symbol byl stejný jako číslo faktury" — ať se
platba na výpisu spáruje s fakturou bez hledání v tabulce. Doslova stejné to být
nemůže: variabilní symbol smí obsahovat **jen číslice** (jde do QR platby jako
`X-VS` a banka jiný tvar nepřijme), kdežto číslo faktury obsahuje lomítka.

Sjednocené je proto **pořadové číslo, ne celý řetězec**:

```
variabilní symbol   100001
číslo faktury       26/03/100001
```

```sql
select cislo_faktury_pro_vs(2026, '03', 100001);   -- 26/03/100001
```

Funkce je `immutable` a **nic neposouvá** — pro stejný variabilní symbol vrátí
vždycky totéž číslo. Dvojí doručení webhooku tak nevyrobí druhé číslo faktury.
Řada je **parametr**, ne pevná hodnota v kódu.

> **Co má vědět účetní:** řada faktur není souvislá. Kdo se přihlásí
> a nezaplatí, spotřebuje variabilní symbol, ale fakturu nedostane — čísla pak
> vypadají třeba `26/03/100003`, `26/03/100007`. Zákon souvislou řadu
> nevyžaduje, ale je lepší o tom vědět dopředu.

Původní funkce `dalsi_cislo_faktury(rok, rada)` a sekvence `seq_faktura_poradi`
dávaly samostatné třímístné pořadí (`26/03/001`). Funkce je **zrušená** schválně:
kdyby zůstala vedle nové, staré volání by tiše vystavilo fakturu ze zahozené
řady. Takhle skončí chybou a je to hned vidět. Sekvence smazaná není, jen se
nepoužívá — kdyby se zadavatel k oddělené řadě vracel, hodnota tam zůstává.

Jedinečnost čísel hlídá databáze, ne důvěra: `variabilni_symbol` je `unique`,
podmínka `faktura_cislo_odpovida_vs` nepustí k přihlášce číslo faktury, které
nekončí *jejím* variabilním symbolem, a nad `faktura_cislo` je unikátní index.

### Zabezpečení — proč se k přihláškám nikdo nedostane

V přihláškách jsou jména, e-maily, telefony a adresy. Veřejný klíč (`anon`) je
v prohlížeči každého návštěvníka a dá se z něj přečíst — je to veřejný údaj,
ne heslo. Proto s ním na tabulku `prihlasky` **není žádný přístup**: ani čtení,
ani zápis.

Zapisuje výhradně Edge Funkce servisním klíčem, který je uložený na serveru
a do prohlížeče se nikdy nedostane.

> **Vědomá odchylka od zadání:** původně mělo být „anon smí jen INSERT".
> Nakonec nesmí ani ten, a to ze dvou důvodů. Zaprvé zápis přes API umí vrátit
> vložený řádek zpátky (`Prefer: return=representation`) — je to zbytečně tenký
> led. Zadruhé s právem zápisu by kdokoli mohl tabulku zaplavit nesmysly
> a protočit sekvenci variabilních symbolů. Formulář zapisuje přes funkci, takže
> přísnější nastavení nic neomezuje.

Ověřeno skutečným dotazem veřejným klíčem:

```
GET  /rest/v1/prihlasky?select=*        → HTTP 401  permission denied for table prihlasky
POST /rest/v1/prihlasky                 → HTTP 401  permission denied for table prihlasky
POST /rest/v1/rpc/dalsi_variabilni_symbol → HTTP 401  permission denied for function dalsi_variabilni_symbol
POST /rest/v1/rpc/cislo_faktury_pro_vs   → HTTP 401  permission denied for function cislo_faktury_pro_vs
```

### Úložiště souborů

| Bucket | Veřejný? | Co v něm je |
| --- | --- | --- |
| `qr` | **ano** | obrázky QR kódů plateb, PNG do 256 kB |
| `faktury` | **ne** | vystavené faktury, PDF do 10 MB |

`qr` je veřejný schválně — obrázek se musí načíst přímo v e-mailu a není v něm
nic osobního, jen číslo účtu a variabilní symbol.

`faktury` veřejný **není** — na faktuře je jméno, adresa a IČO plátce. Přístup
má jen servisní klíč a odkaz pro člověka se vytváří jako podepsaný, dočasně
platný.

---

## Nastavení funkce (proměnné prostředí)

Vyplňte je v souboru `supabase/functions/.env` (vzor je v `.env.example`)
a nahrajte příkazem:

```bash
npx supabase secrets set --env-file supabase/functions/.env
```

### Platba

| Proměnná | Povinná? | K čemu |
| --- | --- | --- |
| `IBAN_UCTU` | ne | číslo účtu ve tvaru IBAN, z něj se skládá QR kód |
| `SWIFT_UCTU` | ne | SWIFT (BIC) banky, připojí se v QR za IBAN |
| `CISLO_UCTU` | ne | číslo účtu v českém tvaru, píše se do e-mailu |
| `NAZEV_PRIJEMCE` | ne | jméno příjemce, uvidí ho plátce v bankovní aplikaci |
| `ZPRAVA_PLATBY` | ne | zpráva pro příjemce, doplní se za ni variabilní symbol |
| `CASTKA_KC` | ne | poplatek v korunách, bez vyplnění 500 |
| `SPLATNOST_DNI` | ne | za kolik dní má být zaplaceno, bez vyplnění 7 |

Bez `IBAN_UCTU` se QR kód přeskočí a přihláška se uloží normálně. IBAN se
kontroluje kontrolní číslicí (mod-97) — při překlepu se QR radši nevyrobí, než
aby posílal peníze na cizí účet.

Do QR kódu jde IBAN, protože ho tak platební standard vyžaduje. Do e-mailu se
naopak píše číslo účtu v tuzemském tvaru (`258492161/0300`) — to lidé opisují
do bankovnictví mnohem častěji. IBAN je v e-mailu jen jako doplněk pro platby
ze zahraničí.

Datum splatnosti se počítá v českém čase, ne v čase serveru. Přihláška odeslaná
v deset večer by se jinak počítala už od dalšího dne a splatnost by seděla
o den vedle proti tomu, co má člověk na hodinkách.

Háčky a čárky se v QR kódu automaticky odstraňují — z `Právě teď! o.p.s.` se
stane `Prave ted! o.p.s.`. Platební standard počítá jen se základní abecedou
a bankovní aplikace by diakritiku zobrazily rozbitě.

### Potvrzovací e-maily

| Proměnná | Povinná? | K čemu |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | ne | Client ID OAuth klienta |
| `GOOGLE_CLIENT_SECRET` | ne | Client Secret OAuth klienta |
| `GOOGLE_REFRESH_TOKEN` | ne | dlouhodobé povolení odesílat ze schránky |
| `ODESILATEL_EMAIL` | ne | adresa, ze které pošta odchází |
| `ODESILATEL_JMENO` | ne | jméno odesílatele, které uvidí příjemce |

Když kterákoli z prvních čtyř chybí, e-mail se přeskočí a přihláška se uloží
tak jako tak. V protokolu funkce pak zůstane varování a variabilní symbol,
takže se dá potvrzení doposlat ručně.

### Ostatní

| Proměnná | Povinná? | K čemu |
| --- | --- | --- |
| `POVOLENE_ORIGINY` | ne | odkud smí formulář volat, víc adres oddělte čárkou |
| `MAKE_WEBHOOK_URL` | ne | adresa fakturace; prázdná = krok se přeskočí |

`SUPABASE_URL` a `SUPABASE_SERVICE_ROLE_KEY` doplňuje Supabase sám, nikam se
nevyplňují.

---

## Jak získat povolení k odesílání e-mailů

Jednorázový úkon, pak už to jede samo.

1. V [Google Cloud Console](https://console.cloud.google.com/) založte projekt.
2. **APIs & Services → Library** → zapněte **Gmail API**.
3. **OAuth consent screen** → typ *External*, vyplňte název a kontaktní e-mail.
   Přidejte oprávnění `https://www.googleapis.com/auth/gmail.send` — nic víc
   funkce nepotřebuje. Do *Test users* přidejte schránku, ze které má pošta
   odcházet.
4. **Credentials → Create credentials → OAuth client ID** → typ *Web
   application*. Jako *Authorized redirect URI* zadejte
   `https://developers.google.com/oauthplayground`.
   Vzniklé **Client ID** a **Client Secret** patří do `.env`.
5. Otevřete [OAuth Playground](https://developers.google.com/oauthplayground/):
   - vpravo nahoře ozubené kolo → zaškrtněte *Use your own OAuth credentials*
     a vložte Client ID a Secret,
   - vlevo do políčka *Input your own scopes* napište
     `https://www.googleapis.com/auth/gmail.send`,
   - **Authorize APIs** → přihlaste se schránkou, ze které má pošta chodit,
   - **Exchange authorization code for tokens**.
6. Vzniklý **Refresh token** patří do `GOOGLE_REFRESH_TOKEN`.

Refresh token platí, dokud ho někdo ručně nezruší. Nikomu ho neposílejte —
umožňuje odesílat poštu jménem té schránky.

---

## Nasazení

Potřebujete [Node.js](https://nodejs.org/) a heslo k databázi
(Supabase → *Project Settings* → *Database*).

**Poprvé** — propojení s projektem:

```bash
npx supabase login
npx supabase link --project-ref kourmwqxkhdtahbxyuaq
```

**Změny v databázi** (soubory ve složce `migrations/`):

```bash
npx supabase db push
```

Spustí jen to, co ještě neproběhlo. Už nasazenou migraci nikdy neupravujte —
na změnu se přidává nový soubor. Název začíná časovým razítkem
(`RRRRMMDDHHMMSS_kratky_popis.sql`), podle něj se řadí pořadí.

**Změny ve funkcích:**

```bash
npx supabase functions deploy prijmout-prihlasku
npx supabase functions deploy ares-lookup
```

**Změny v nastavení:**

```bash
npx supabase secrets set --env-file supabase/functions/.env
```

Po změně nastavení funkci raději nasaďte znovu, ať se nové hodnoty jistě
projeví.

---

## Adresa pro formulář

```
POST https://kourmwqxkhdtahbxyuaq.supabase.co/functions/v1/prijmout-prihlasku
Content-Type: application/json
```

Funkce **nevyžaduje přihlášení** — web je statický a nikdo se na něm
nepřihlašuje. Nic ven nevydává, jen přijímá přihlášky, a proti robotům ji
chrání skryté pole ve formuláři.

### Co se posílá

```json
{
  "typ_poradatele": "skola",
  "nazev_poradatele": "ZŠ Komenského",
  "kontaktni_osoba": "Jana Nováková",
  "email": "jana@example.cz",
  "telefon": "+420 777 888 999",
  "mesto": "Ostrava",
  "kraj": "Moravskoslezský",
  "napad_na_aktivitu": "Úklid okolí školy",
  "forma_platby": "qr",
  "souhlas_gdpr": true,
  "web": ""
}
```

- `typ_poradatele`: `skola` / `organizace` / `jednotlivec`
- `forma_platby`: `qr` / `prevod`
- při `prevod` navíc `fakt_nazev`, `fakt_adresa`, `fakt_ic` (8 číslic)
  a nepovinné `fakt_dic`
- `napad_na_aktivitu` je nepovinné
- **`web` je past na roboty** — musí zůstat prázdné, viz níž
- formulář posílá u školy a organizace navíc `ico` (pomocné pole pro načtení
  z ARESu). Funkce ho **ignoruje** — na faktuře platí `fakt_ic`.

### Co přijde zpátky

Povedlo se:

```json
{ "ok": true, "variabilni_symbol": 100001,
  "qr_url": "https://…/storage/v1/object/public/qr/platba-100001.png" }
```

`qr_url` může být `null` (chybí číslo účtu). Není to chyba — přihláška je
uložená, jen se zaplatí ručně podle údajů z e-mailu.

Něco chybí nebo je špatně:

```json
{ "ok": false,
  "chyba": "Ve formuláři je potřeba něco doplnit nebo opravit.",
  "chyby": { "email": "Tenhle e-mail nevypadá správně. Zkontrolujte překlep." } }
```

V `chyby` je ke každému rozbitému poli česká věta — dá se rovnou zobrazit
u příslušného políčka formuláře.

### Past na roboty

Ve formuláři musí být skryté políčko `web`, které živý člověk nevidí, a tedy
nikdy nevyplní. Automat, který vyplňuje všechno, se do něj chytí.

```html
<div style="position:absolute;left:-9999px" aria-hidden="true">
  <label>Web <input type="text" name="web" tabindex="-1" autocomplete="off"></label>
</div>
```

Když políčko dorazí vyplněné, funkce **neuloží nic** a odpoví úplně obyčejným
„v pořádku". Je to schválně: kdyby robot dostal chybovou hlášku, jeho autor by
past objevil a příště ji obešel. Takhle si myslí, že uspěl — a přitom se
neuložila žádná přihláška ani nespotřeboval variabilní symbol.

---

## Vyhledání v ARESu (`ares-lookup`)

Druhá, mnohem menší funkce. Škola nebo organizace vyplní ve formuláři IČO,
klikne na **Načíst z rejstříku** a fakturační údaje se předvyplní samy.

```
GET  https://kourmwqxkhdtahbxyuaq.supabase.co/functions/v1/ares-lookup?ico=29154901
POST https://kourmwqxkhdtahbxyuaq.supabase.co/functions/v1/ares-lookup   {"ico":"29154901"}
```

Také **nevyžaduje přihlášení**. Nevrací nic, co by nebylo ve veřejném
rejstříku, a nic neukládá — je to jen průchoďák. Prohlížeč se na ARES nemůže
zeptat sám, protože rejstřík nemá pro cizí domény nastavené CORS hlavičky.

Zdroj dat (veřejné rozhraní ARESu, bez klíče a bez registrace):

```
GET https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/{ico}
```

**Povedlo se:**

```json
{ "ok": true, "ico": "29154901", "nazev": "Právě teď! o.p.s.",
  "adresa": "Fügnerovo náměstí 1808/3, Nové Město, 120 00 Praha 2" }
```

Pole `dic` v odpovědi je jen u plátců DPH. Když chybí, subjekt plátcem není —
**není to chyba** a formulář to takhle i napíše.

**Nepovedlo se:**

```json
{ "ok": false, "duvod": "nenalezeno",
  "chyba": "Rejstřík ARES IČO 00000019 nezná. Zkontrolujte prosím číslice, nebo fakturační údaje vyplňte ručně." }
```

| `duvod` | HTTP | Kdy nastane |
| --- | --- | --- |
| `neplatne_ico` | 400 | IČO nemá osm číslic. Kontroluje se **dřív**, než se kamkoli sáhne. |
| `nenalezeno` | 404 | ARES odpověděl, ale takové IČO nezná. Nejspíš překlep. |
| `nedostupne` | 502 / 504 | ARES neodpověděl do osmi vteřin nebo vrátil chybu. |
| `spatny_pozadavek` | 400 / 405 | Špatná metoda nebo nečitelné tělo požadavku. |

`nenalezeno` a `nedostupne` se schválně rozlišuje — u překlepu má člověk
opravit číslice, u výpadku rovnou vyplnit údaje ručně. **Výpadek rejstříku
nesmí zablokovat registraci**, formulář jde vždycky doplnit rukou.

Poštovní směrovací číslo se v adrese upraví do českého tvaru
(`12000 Praha 2` → `120 00 Praha 2`). Všechna předvyplněná pole ve formuláři
jde přepsat — ARES má adresu občas v jiném tvaru, než chce účetní.

---

## Ověřeno na živém projektu

| Co | Výsledek |
| --- | --- |
| přihláška bez QR (chybí IBAN) | `{"ok":true,"variabilni_symbol":100001,"qr_url":null}` |
| přihláška s QR | `{"ok":true,"variabilni_symbol":100001,"qr_url":"…/platba-100001.png"}` |
| obsah QR kódu | `SPD*1.0*ACC:CZ2303000000000258492161+CEKOCZPP*AM:500.00*CC:CZK*DT:20260819*X-VS:100001*RN:Prave ted! o.p.s.*MSG:AKTIVNE SPOLU 100001` |
| QR kód přečtený zpátky ze čtečky | 456 × 456 bodů, PNG, 26 kB, čitelný |
| past na roboty | uloženo 0 řádků, odpověď `{"ok":true,…}` |
| serverová validace při obejití formuláře | HTTP 400 se seznamem chyb po polích |
| čtení veřejným klíčem | HTTP 401, `permission denied for table prihlasky` |
| číslování faktur | `26/03/100001` — číslo vychází z variabilního symbolu |
| ARES, existující IČO 29154901 | `{"ok":true,"ico":"29154901","nazev":"Právě teď! o.p.s.","adresa":"Fügnerovo náměstí 1808/3, Nové Město, 120 00 Praha 2"}` |
| ARES, neexistující IČO 00000019 | HTTP 404, `{"ok":false,"duvod":"nenalezeno",…}` |
| ARES, plátce DPH (27082440) | v odpovědi navíc `"dic":"CZ27082440"` |
| ARES, špatný tvar IČO (`123`) | HTTP 400, `{"ok":false,"duvod":"neplatne_ico",…}`, na ARES se vůbec nesáhne |

Testovací záznamy byly po zkoušce smazané a sekvence vrácené na začátek.

---

## Když se něco pokazí

Protokol funkce najdete v Supabase → **Edge Functions → prijmout-prihlasku →
Logs**. Píše se do něj česky a vždy s variabilním symbolem, takže se dá dohledat
konkrétní přihláška.

| Co v protokolu stojí | Co s tím |
| --- | --- |
| `QR přeskočeno: chybí nastavení IBAN_UCTU` | doplňte `IBAN_UCTU` |
| `QR přeskočeno: číslo účtu … neprošlo kontrolou` | v IBANu je překlep |
| `E-mail přeskočen: chybí nastavení odesílání` | doplňte proměnné pro Google |
| `Potvrzení se nepovedlo odeslat` | prošlo povolení, získejte nový refresh token |
| `Fakturaci se nepovedlo zavolat` | přihláška je v pořádku, fakturu vystavte ručně |

Ve všech těchhle případech je **přihláška uložená** — chybí jen doprovodný
krok. Seznam přihlášek najdete v Supabase → **Table Editor → prihlasky**.
