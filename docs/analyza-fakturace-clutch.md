# Analýza fakturace a plateb — co přebíráme z Clutche

Dokument popisuje, co se pro web **aktivne-spolu.cz** přebírá z existující aplikace
Clutch (fakturační modul), co se muselo změnit a co se naopak nepřebírá vůbec.

Je psaný tak, aby mu rozuměl i netechnický čtenář. Technické názvy souborů a funkcí
jsou uvedené proto, aby se v tom vyznal i programátor, který na projekt naváže —
včetně žáků z kroužku na ZŠ Magic Hill.

---

## 1. K čemu to celé je

Na webu se organizátoři přihlašují na mezigenerační setkání a platí **registrační
poplatek 500 Kč**. Potřebujeme kvůli tomu dvě věci:

1. **QR kód k platbě** — člověk ho naskenuje mobilním bankovnictvím a příkaz
   k úhradě se mu předvyplní sám.
2. **Fakturu** — pro školy a organizace, které potřebují doklad do účetnictví.

Obojí Clutch už umí, jen v mnohem složitější podobě (Clutch je fakturační nástroj
pro firmu, která je plátce DPH, vystavuje zálohové i běžné faktury, různým
zákazníkům, v různých měnách). Náš případ je proti tomu jediný a pořád stejný:
**jedna položka, 500 Kč, jeden příjemce.**

Proto se z Clutche nepřebírá aplikace, ale jen ty **výpočetní a formátovací části,
které jsou obecně platné** — ověření čísla účtu, sestavení QR platby, formátování.

Nový kód je v adresáři `src/lib/platba/` a je celý česky.

---

## 2. Co přebírám

### 2.1 Ověřování a formátování čísla účtu (IBAN)

**Zdroj v Clutchi:** `src/lib/iban.ts`

| Původní funkce (Clutch) | Nová funkce (`src/lib/platba/iban.ts`) | Co dělá |
|---|---|---|
| `normalizeIban` | `normalizujIban` | Odstraní mezery, převede na velká písmena |
| `formatIban` | `naformatujIban` | Rozdělí IBAN po čtveřicích, aby se dal přečíst |
| `isValidIban` | `jePlatnyIban` | Spočítá kontrolní součet (mod 97) a řekne ano/ne |
| `formatBankAccount` | `naformatujTuzemskyUcet` | Složí české číslo účtu, např. `19-2000145399/0800` |

**Proč je kontrola důležitá:** v IBANu jsou dvě číslice hned za kódem země
kontrolní. Když se v čísle účtu někdo překlepne, výpočet nevyjde a my chybu
poznáme **dřív, než někomu ukážeme QR kód s cizím účtem**. Bez téhle kontroly by
peníze mohly odejít na neexistující nebo cizí účet a nikdo by si toho nevšiml.

Přebrán je i technický detail: číslo se dělí po sedmi číslicích, protože celé by
se do běžného čísla v JavaScriptu nevešlo a počítalo by se špatně. Tohle měl
Clutch vyřešené správně a nemělo smysl to vymýšlet znovu.

### 2.2 Sestavení QR platby (SPAYD)

**Zdroj v Clutchi:** `src/lib/pdf/spayd.ts`

SPAYD je český standard pro QR platby. Je to jeden řádek textu, který se zakóduje
do čtverečku:

```
SPD*1.0*ACC:CZ6508000000192000145399*AM:500.00*CC:CZK*X-VS:2603001*MSG:REGISTRACNI POPLATEK
```

Z Clutche se přebírá **veškerá logika čištění vstupů**, protože je to přesně to
místo, kde se chyby dělají a kde je Clutch má odladěné praxí:

| Původní (Clutch, `__internal`) | Nová (`src/lib/platba/spayd.ts`) | Co řeší |
|---|---|---|
| `normalizeIban` | využívá `jePlatnyIban` z `iban.ts` | Neplatný účet se do QR nedostane |
| `normalizeVs` | `normalizujVs` | Variabilní symbol smí být jen číslice, nejvýš 10 |
| `formatAmount` | `naformatujCastku` | Vždy dvě desetinná místa, s tečkou (`500.00`) |
| `formatDateYYYYMMDD` | `naformatujDatum` | `2026-09-15` → `20260915` |
| `sanitizeMsg` | `ocistiZpravu` | Zprávu zkrátí na 60 znaků a vyhodí hvězdičku |
| `buildSpaydPayload` | `sestavSpayd` | Poskládá celý řetězec |

Hvězdička se ze zprávy maže proto, že **odděluje jednotlivé části SPAYD řetězce**.
Kdyby ji někdo napsal do zprávy pro příjemce, rozpadl by se celý QR kód.

### 2.3 Generování QR obrázku

**Zdroj v Clutchi:** `src/lib/pdf/qr.ts`

Přebírá se nastavení, které Clutch používá a které se osvědčilo:

- **úroveň zabezpečení „M"** — kód přežije, i když je asi 15 % plochy poškozené.
  Vyšší úroveň by kód zbytečně zahustila, nižší by nepřežila vytištění na papír
  a naskenování z něj.
- **okraj 2 čtverečky** místo doporučených 4 — na fakturu se vejde víc a čtečkám
  to stačí.
- **načtení knihovny až ve chvíli potřeby** — stránka se tím nezpomaluje pro
  návštěvníky, kteří QR kód vůbec nechtějí.

### 2.4 Formátování částek a dat

**Zdroj v Clutchi:** `src/lib/pdf/format.ts`, `src/lib/invoiceFormatting.ts`

Přebírají se pravidla, ne kód: částky v českém tvaru (`500,00 Kč` s nedělitelnou
mezerou mezi tisíci a před „Kč"), data ve tvaru `15. 9. 2026`. Tohle se doplní
až při sazbě faktury, na kterou navazuje jiná část projektu.

### 2.5 Struktura faktury a její povinné náležitosti

**Zdroj v Clutchi:** `src/lib/pdf/documentData.ts`, `documentDefinition.ts`

Z Clutche přebíráme **seznam údajů, které na faktuře musí být**:

- označení dokladu a jeho číslo,
- kdo fakturu vystavil (název, adresa, IČ, zápis v rejstříku),
- komu je určená (název, adresa, IČ, případně DIČ),
- datum vystavení a datum splatnosti,
- popis položky, počet, cena,
- celková částka,
- platební údaje: číslo účtu, variabilní symbol, QR kód,
- **věta o tom, že vystavovatel není plátce DPH.**

Samotný kód na sazbu PDF se nepřebírá — viz kapitola 4.

---

## 3. Co jsem musel upravit a proč

### 3.1 Zrušená vazba na Clutch

Původní funkce Clutche pracovaly s objektem `InvoiceDocumentData`, což je popis
faktury se zhruba dvaceti poli, navázaný na databázi Clutche. Kdybychom ho
přebrali, táhli bychom si s sebou celý jeho datový model kvůli jedné částce.

**Nové funkce dostávají jen to, co opravdu potřebují** — IBAN, částku, variabilní
symbol, zprávu a splatnost. Modul se tím dá použít kdekoliv a dá se otestovat
bez databáze.

### 3.2 Vyhozené přepínače, které tady nedávají smysl

Z původního `buildSpaydPayload` zmizelo šest podmínek, které Clutch potřeboval
a my ne:

| Vyhozeno | Proč |
|---|---|
| `mode: "draft-preview" \| "issued"` | Nemáme koncepty faktur, které se rozpracují a pak vystaví |
| kontrola `data.status` | Nemáme stavy dokladu (koncept / vystavená / zrušená) |
| `documentType`, `advance_invoice` | Nemáme zálohové faktury |
| `data.showQr` | QR kód chceme vždycky, není co vypínat |
| kontrola `paymentMethod` | Platí se jen převodem, jiná možnost není |
| kontrola měny | Účtuje se jen v korunách |

### 3.3 Chyba se ukáže, netiší se

**Tohle je nejdůležitější změna oproti Clutchi.** Původní funkce při jakémkoli
problému vrátila prázdnou hodnotu (`null`) a QR kód se prostě nezobrazil.
Nikdo — ani uživatel, ani správce webu — se nedozvěděl proč.

Nová `sestavSpayd` **vyhodí chybu s českým vysvětlením**, například:

> `IBAN "CZ650800000019200014539" není platný (nesedí kontrolní součet).`

Díky tomu je poznat rozdíl mezi „ještě se to načítá", „nepovedlo se to" a
„hotovo". Prázdné místo na stránce, u kterého se neví, co se stalo, je pro
uživatele to nejhorší.

### 3.4 Odstranění diakritiky ve zprávě pro příjemce

Clutch měl texty zpráv napsané rovnou bez háčků (`"Zalohova faktura"`), takže
problém neřešil. My chceme psát česky (`"Registrační poplatek"`), ale některé
banky háčky a čárky v QR platbě nezobrazí správně nebo je rozhází.

Přidána proto funkce `odstranDiakritiku`, která z „Registrační poplatek" udělá
„Registracni poplatek". V bance to vypadá stroze, ale čitelně a spolehlivě
všude stejně.

### 3.5 QR kód musí fungovat i na serveru, nejen v prohlížeči

Clutch generoval QR kód výhradně v prohlížeči, kde je k dispozici plátno
(`canvas`). Náš QR kód ale může vznikat i na serveru v Supabase Edge Function,
kde plátno neexistuje a PNG obrázek by se tam nevyrobil.

Modul `src/lib/platba/qr.ts` proto nabízí dvě cesty a rozdíl je v něm
zdokumentovaný hned nahoře:

| Funkce | Kde funguje | Kdy použít |
|---|---|---|
| `vytvorQrDataUrl`, `vytvorQrSvg` | prohlížeč, Node.js **i Deno** | **výchozí volba** — kód je jenom text s obdélníčky, nepotřebuje nic navíc |
| `vytvorQrPngDataUrl` | prohlížeč a Node.js | jen když je potřeba skutečný obrázek PNG |

Navíc jde načtení knihovny podstrčit parametrem (`nactiKnihovnu`), protože Deno
vyžaduje jiný zápis importu (`npm:qrcode`) než prohlížeč.

---

## 4. Co nepřebírám a proč

### 4.1 Celý rozpis DPH — Právě teď! o.p.s. je NEPLÁTCE DPH

**Tohle je tvrdý požadavek zadavatele a promítá se do celé faktury.**

Faktury vystavuje **Právě teď! o.p.s., která není plátcem DPH**. Vystavuje tedy
běžnou fakturu (výzvu k úhradě), **nikoli daňový doklad**. Z Clutche kvůli tomu
konkrétně vypadlo:

| Co v Clutchi je | Proč to u nás není |
|---|---|
| Sazby DPH u položek (21 %, 12 %, 0 %) | Neplátce daň nevyčísluje |
| Sloupce „Základ daně" a „DPH" v tabulce položek | Není z čeho a co počítat |
| Souhrnná rekapitulace DPH pod tabulkou | Nemá co shrnovat |
| Rozdíl mezi cenou „bez DPH" a „s DPH" | Existuje jediná částka |
| Pole DIČ u vystavovatele (`is_vat_payer`, `dic`) | Neplátce DIČ nemá |
| Režim přenesené daňové povinnosti | Týká se jen plátců |
| Označení dokladu jako „daňový doklad" | Neplátce daňový doklad nevystavuje |

**Co na faktuře naopak zůstává:**

- jedna položka — *Registrační poplatek za účast v projektu*,
- jedna částka — **500 Kč**,
- věta: **„Dodavatel není plátcem DPH."**

Faktura tak má jen jedno číslo, které se platí. Žádný základ daně, žádná sazba,
žádný přepočet. Je to pro účetní jednodušší a nedá se v tom udělat chyba.

> Poznámka pro programátora: v Clutchi je tahle věta v
> `src/lib/pdf/documentDefinition.ts` (řádek 348) navěšená na podmínku
> `if (!data.supplier.isVatPayer)`. **U nás podmínka není** — věta na faktuře
> je vždy, natvrdo. Ta podmínka je přesně to místo, kde by šlo omylem vystavit
> fakturu bez povinného upozornění.

### 4.2 Clutchovská číselná řada — máme vlastní `RR/SS/NNN`

**Druhý tvrdý požadavek zadavatele.**

Clutch čísluje faktury ve tvaru `2026-0001` (u zálohových `Z2026-0001`). Tenhle
tvar **nepřebíráme**. Naše číselná řada vypadá takhle:

```
26 / 03 / 001
│    │    │
│    │    └── NNN — pořadí faktury, zleva doplněné nulami na tři místa
│    └─────── SS  — interní číslo řady, dvě číslice, z proměnné prostředí
└──────────── RR  — poslední dvě číslice roku vystavení (2026 → 26)
```

Příklad: první faktura řady 03 v roce 2026 má číslo **`26/03/001`**.

**Pořadové číslo generuje databáze, nikdy ne aplikace.**

Zdrojem pořadí je Postgres sekvence **`seq_faktura_poradi`** v Supabase,
zpřístupněná funkcí **`dalsi_cislo_faktury(rok, rada)`**. Ta je už nasazená.
Aplikační kód si pořadí **nepočítá za žádných okolností** — jen si o něj řekne.

*Proč tak striktně:* kdyby si pořadí počítala aplikace („najdi nejvyšší číslo
a přičti jedna"), stačilo by, aby se dva lidé přihlásili ve stejnou vteřinu,
a vznikly by **dvě faktury se stejným číslem**. To je v účetnictví chyba, která
se špatně opravuje a která se navíc projeví až za několik měsíců. Databázová
sekvence stejné číslo nevydá dvakrát ani při stovce souběžných přihlášek.

Modul `src/lib/platba/cisloFaktury.ts` proto dělá **jenom dvě věci**:

- `sestavCisloFaktury({ rok, cisloRady, poradi })` — z dílů složí `26/03/001`,
- `jePlatneCisloFaktury(…)`, `rozlozCisloFaktury(…)` — ověří a rozebere tvar.

Navíc `variabilniSymbolZCisla("26/03/001")` → `"2603001"`, aby se platba dala na
bankovním výpisu spárovat s konkrétní fakturou.

Interní číslo řady (`SS`) si určuje účetní organizace, ne programátor. Čte se
z proměnné prostředí `FAKTURY_CISLO_RADY` pomocí `nactiCisloRadyZEnv(…)`.

Nepřebíráme tedy z Clutche celou funkci `issue_invoice` v databázi
(`supabase/migrations/…`), včetně tabulky `invoice_sequences`, možnosti zadat
číslo ručně (`p_manual_number`) a zvláštního číslování zálohových faktur.

### 4.3 Ostatní nepřebrané části

| Co | Proč to nepotřebujeme |
|---|---|
| `src/lib/invoicing.ts` (~390 řádků) | Celá správa faktur: koncepty, položky, stavy, historie verzí PDF. Clutch spravuje faktury jako agendu, my vystavíme jednu automaticky. |
| Zálohové faktury (`advance_invoice`) a jejich zúčtování | Nezálohuje se, platí se rovnou jednou částkou. |
| Zrušení faktury (`void_invoice`), vodoznak „ZRUŠENO" | Nemáme proces rušení dokladů. |
| Náhled konceptu, vodoznak „NÁHLED" | Fakturu nikdo ručně nerozpracovává. |
| Sazba PDF přes knihovnu `pdfmake` (`pdfEngine.ts`, ~170 řádků) | Řeší hlavně obcházení chyb v načítání knihovny a fontů v prohlížeči. Pro jednu jednoduchou fakturu je to nepřiměřená zátěž; řešení PDF je samostatné rozhodnutí. |
| Logo ve faktuře (`logo.ts`, `imageAssets.ts`, úložiště) | Clutch řeší nahrávání a podepisované odkazy na loga pro každého uživatele. My máme logo jedno a pevné. |
| Nabídky, finanční reporty, výkazy práce (`quote*.ts`, `financeReport*.ts`, `timeReport*.ts`) | Jiná agenda, s registračním poplatkem nesouvisí. |
| Napojení na účetnictví Pohoda | Není součástí zadání. |
| Údaje o dodavateli natvrdo v kódu | Do projektu nesmí patřit žádný účet, klíč ani adresa vázaná na dodavatele Clutche. Vše jde přes parametry nebo proměnné prostředí. |

Naopak **přebíráme myšlenku** vyhledání firmy podle IČ z rejstříku ARES
(v Clutchi `aresLookup`), kterou zadavatel zmiňuje v podkladech u fakturačního
bloku formuláře. Podle dřívější zkušenosti se ale **nesmí spouštět samo při
otevření formuláře** — jen po stisknutí tlačítka, aby uživatel viděl, že se
někam volá, a věděl, když to selže.

---

## 5. Přehled vzniklých souborů

| Soubor | Obsah |
|---|---|
| `src/lib/platba/iban.ts` | Normalizace, formátování a kontrola čísla účtu |
| `src/lib/platba/spayd.ts` | Sestavení řetězce pro QR platbu, konstanta `REGISTRACNI_POPLATEK_KC = 500` |
| `src/lib/platba/qr.ts` | Vytvoření QR obrázku (SVG všude, PNG jen v prohlížeči) |
| `src/lib/platba/cisloFaktury.ts` | Skládání a kontrola čísla faktury `RR/SS/NNN` |

Každý soubor má nahoře komentář s vysvětlením a příkladem použití, včetně
příkladu pro Supabase Edge Function.

---

## 6. Co už doplněné je

Doplněno 12. 8. 2026, ověřeno v ARESu a potvrzeno zadavatelem. Nic z toho
není zadrátované v kódu — všechno jde přes proměnné prostředí, aby to šlo
po předání klientovi změnit.

| Údaj | Hodnota | Kde |
|---|---|---|
| Dodavatel | Právě teď! o.p.s., IČO 29154901 | `DODAVATEL_NAZEV`, `DODAVATEL_ICO` |
| Sídlo | Fügnerovo náměstí 1808/3, Nové Město, 120 00 Praha 2 | `DODAVATEL_ADRESA` |
| Plátcovství DPH | **Neplátce** — ARES vrací `stavZdrojeDph: NEEXISTUJICI` | na faktuře žádný rozpis daně |
| Účet | 258492161/0300 (ČSOB) | `CISLO_UCTU` |
| IBAN | CZ2303000000000258492161 (ověřen kontrolním součtem mod-97) | `IBAN_UCTU` |
| SWIFT/BIC | CEKOCZPP | `SWIFT_UCTU` |
| Splatnost | 7 dní | `SPLATNOST_DNI` |
| Zpráva pro příjemce | AKTIVNE SPOLU | `ZPRAVA_PRO_PRIJEMCE` |

Celá platební cesta je ověřená naostro: přihláška prošla Edge Funkcí,
dostala variabilní symbol ze sekvence a vznikl QR kód, jehož dekódovaný
obsah odpovídá výše uvedeným údajům:

```
SPD*1.0*ACC:CZ2303000000000258492161+CEKOCZPP*AM:500.00*CC:CZK
*DT:20260819*X-VS:100001*RN:Prave ted! o.p.s.*MSG:AKTIVNE SPOLU 100001
```

Číslo faktury skládá funkce `dalsi_cislo_faktury(rok, rada)` nad sekvencí
`seq_faktura_poradi` — obojí je v Supabase nasazené.

---

## 7. Co ještě chybí doplnit

Následující údaje nejsou a nesmějí být v kódu — zadavatel je doplní
po konzultaci s účetní.

| Označení | Co je potřeba |
|---|---|
| `[DOPLNIT: interní číslo řady faktur]` | Dvě číslice do proměnné `FAKTURY_CISLO_RADY` (v příkladu `03`). Určuje účetní organizace. Bez něj se faktura nevystaví. |
| `[DOPLNIT: zápis v rejstříku o.p.s.]` | Soud, oddíl a vložka. Patří na fakturu jako jedna z povinných náležitostí. |
| `[DOPLNIT: text položky na faktuře]` | Přesné znění, např. „Registrační poplatek — Mezigenerační setkání 2026". |
| `[DOPLNIT: kontaktní e-mail pro faktury]` | Adresa, na kterou se organizátoři obrátí, když je s fakturou něco špatně. |
