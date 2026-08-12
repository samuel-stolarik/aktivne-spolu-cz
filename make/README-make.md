# Fakturace v Make — návod k předání

Tenhle adresář obsahuje automatizaci, která **vystavuje faktury za registrační poplatek 500 Kč**
u přihlášek na projekt k Mezinárodnímu dni seniorů (web aktivne-spolu.cz).

Návod je psaný pro člověka, který projekt nezná. Nemusíš umět programovat, ale budeš potřebovat
přístup do Make, do Google Workspace (Gmail) a do Supabase.

Soubory:

| Soubor | Co to je |
| --- | --- |
| `fakturace-blueprint.json` | Samotný scénář. Tenhle soubor se v Make naimportuje. |
| `README-make.md` | Tento návod. |

> ✅ **Blueprint je ověřený proti Make.** Není to jen ručně napsaný soubor „na dobré slovo" —
> Make ho skutečně přijal. Jak přesně, je popsané v kapitole
> „[Jak je blueprint ověřený](#jak-je-blueprint-ověřený)" na konci návodu.

---

## ⚠️ DVĚ VĚCI, KTERÉ SE PŘI IMPORTU ROZBIJÍ. VŽDYCKY.

Blueprint je jen popis, jak jsou moduly poskládané za sebou. **Nejsou v něm přístupy ani adresy.**
Tohle nejde obejít, je to tak schválně kvůli bezpečnosti. Počítej s tím a projdi oba body níž.

### 1. S blueprintem se NEPŘENÁŠEJÍ PŘIPOJENÍ

V exportu nejsou žádná hesla, tokeny ani přihlášení. Po importu bude u modulů prázdné pole
„Connection" a scénář nepůjde spustit.

**Po importu musíš v cílovém účtu znovu připojit:**

- **Gmail / Google Workspace** — modul 8 (odeslání faktury). Přihlas se adresou, ze které mají
  faktury odcházet.
- **Google Docs** — moduly 6, 7 a 12 (vyplnění šablony, export do PDF, úklid). Může to být stejný
  Google účet jako u Gmailu, ale připojení se v Make zakládá zvlášť.
- **Supabase (service_role)** — moduly 3, 4, 9, 10 a 11. Nezakládá se jako „připojení aplikace",
  ale jako **klíč typu API Key Auth** v poli *Credentials* přímo v modulu
  (viz kapitola „Připojení k Supabase" níž).

**Tohle je v pořádku a počítá se s tím.** Není to chyba exportu ani chyba dodavatele.
Prostě se po importu jednou proklikáš připojeními a máš hotovo.

### 2. S blueprintem se NEPŘENÁŠÍ WEBHOOK URL

Scénář startuje webhookem — adresou, na kterou web pošle zprávu „přišla nová přihláška".
**Tahle adresa se s blueprintem nepřenáší.** Po importu je pole webhooku prázdné, klikneš na
*Create a webhook*, a Make vygeneruje **úplně novou adresu**, jinou než měl původní scénář.

**A teď to důležité:**

> **Novou webhook URL MUSÍŠ přepsat do proměnné `MAKE_WEBHOOK_URL` v Supabase.**
>
> **Když se na to zapomene, nic nespadne a nikde se nic červeně nerozsvítí.
> Formulář na webu poběží dál, lidé se budou normálně přihlašovat, budou vidět „děkujeme
> za přihlášku" — a faktury prostě tiše nepojedou. Nikdo se to nedozví, dokud někdo
> nezavolá, že mu faktura nepřišla.**

Kde se to přepisuje:
Supabase → projekt `kourmwqxkhdtahbxyuaq` → *Project Settings* → *Edge Functions* → *Secrets* →
proměnná `MAKE_WEBHOOK_URL`. Po změně se Edge Function musí nasadit znovu (redeploy).

**Ověření, že to funguje:** pošli přes web jednu zkušební přihlášku s volbou „převod s fakturou"
a v Make se koukni do *History*. Když tam po půl minutě není žádný běh, adresa je špatně.

---

## Co scénář dělá, modul po modulu

```
webhook z Edge Function
   └─ 2. načtení konfigurace (údaje vystavovatele)
        └─ 3. Supabase: načtení přihlášky
             └─ 4. Supabase RPC: přidělení čísla faktury
                  └─ 5. sestavení faktury
                       └─ 6.+7. Google Docs → PDF
                            └─ 8. Gmail: odeslání přihlašujícímu
                                 └─ 9.+10. uložení PDF do Storage
                                      └─ 11. zápis čísla a odkazu zpět k přihlášce
                                           └─ 12. úklid
```

| # | Modul | Co dělá |
| --- | --- | --- |
| 1 | Webhook | Přijme zprávu z Edge Function. Klíčové je pole **`id`** (uuid přihlášky). |
| 2 | Nastavení proměnných | **Jediné místo, kde se něco edituje.** Údaje vystavovatele, banka, řada faktur, adresy. |
| 3 | Supabase — načtení přihlášky | Načte skutečná data z databáze podle `id`. Filtr před modulem 2 pustí dál jen platbu převodem. |
| 4 | Supabase — číslo faktury (RPC) | Vyžádá si číslo z databáze. Filtr pustí dál jen přihlášky, které fakturu ještě nemají. |
| 5 | Sestavení faktury | Převezme datum splatnosti z webhooku, složí název souboru a odběratele. |
| 6 | Google Docs — šablona (*Create a Document from a Template*) | Vyplní Google dokument s fakturou. |
| 7 | Google Docs — PDF (*Download a Document*) | Vyexportuje ho jako PDF. |
| 8 | Gmail (*Send an email*) | Pošle fakturu přihlašujícímu, kopii účetní. |
| 9 | Supabase Storage | Uloží PDF do neveřejného bucketu `faktury`. |
| 10 | Supabase Storage | Vyrobí podepsaný odkaz na to PDF. |
| 11 | Supabase — zápis | Zapíše `faktura_cislo` a `faktura_url` k přihlášce. |
| 12 | Google Docs — úklid | Smaže dočasný dokument z Disku. Nepovinné. |

---

## Co přesně posílá webhook

Tělo webhooku určuje **Edge Function v Supabase — ta je nasazená a odzkoušená, a je to zdroj
pravdy.** Scénář v Make se přizpůsobuje jí, ne naopak. Kdyby se někdy měnila, musí se změnit
i tenhle scénář.

⚠️ **Pole s ID přihlášky se jmenuje `id`, ne `prihlaska_id`.** Scénář se na něj odkazuje jako
`{{1.id}}` (moduly 3 a 11). Kdyby se to popletlo, dotaz do databáze by se ptal na prázdné ID,
nic by nenašel a faktura by se nevystavila.

Tělo obsahuje: `id`, `variabilni_symbol`, `castka_kc`, `splatnost` (ISO datum), `qr_url`,
`spayd`, `email_odeslan` a k tomu všechna pole přihlášky — `typ_poradatele`, `nazev_poradatele`,
`kontaktni_osoba`, `email`, `telefon`, `mesto`, `kraj`, `napad_na_aktivitu`, `forma_platby`,
`fakt_nazev`, `fakt_adresa`, `fakt_ic`, `fakt_dic`, `souhlas_gdpr`.

**Proč tedy modul 3 znovu čte z databáze, když už to všechno přišlo?** Protože data v těle
webhooku pocházejí z prohlížeče a šla by podvrhnout — někdo by si mohl poslat vlastní fakturační
údaje nebo cizí variabilní symbol. Fakturační údaje proto bereme z databáze. **Je to schválně
a nemazat to.**

**Datum splatnosti se v Make nepočítá.** Edge Function ho posílá hotové v poli `splatnost`
(dnes + 7 dní) a modul 5 ho jen přeformátuje na `D.M.YYYY`. Důvod: stejné datum je i v QR kódu
k platbě, takže kdyby si ho Make počítal po svém, mohlo by se na přelomu dne rozejít s QR kódem
a člověk by měl na faktuře jiné datum než v bance. Proměnná `splatnost_dnu` v modulu 2 je
už jen informativní — **když chceš měnit splatnost, mění se v Edge Function, ne tady.**

---

## Číslo faktury: je v něm variabilní symbol

Faktura má číslo ve tvaru **`RR/SS/<variabilní symbol>`**, například `26/03/100001`:

- `RR` — rok (26 = rok 2026)
- `SS` — interní číslo řady, nastavuje se v modulu 2 jako `rada_faktur`
- poslední část — **variabilní symbol té konkrétní přihlášky**, tedy zároveň pořadové číslo faktury

### Proč není číslo faktury a variabilní symbol úplně stejné

Zadavatel chtěl, aby „variabilní symbol byl stejný jako číslo faktury" — ať se platba na výpisu
spáruje s fakturou bez hledání v tabulce. **Doslova stejné to být nemůže:**

- variabilní symbol smí obsahovat **jen číslice**, nejvýš deset. Do QR platby jde jako `X-VS`
  a banka jiný tvar nepřijme,
- číslo faktury obsahuje **lomítka** (`26/03/…`).

Sjednocené je proto **pořadové číslo, ne celý řetězec**:

```
variabilní symbol   100001
číslo faktury       26/03/100001
                          ^^^^^^ tentýž variabilní symbol
```

Na faktuře i na platbě je tak vidět stejné číslo a spárování je na první pohled. Blíž se
k „naprosto stejné" dostat nedá.

⚠️ **Řada faktur není souvislá a účetní o tom musí vědět.** Variabilní symbol dostane každý hned
při registraci, ale fakturu jen ten, kdo platí převodem. Kdo se přihlásí a nezaplatí, spotřebuje
variabilní symbol, ale fakturu nedostane — v číslech faktur po něm zůstane díra
(`26/03/100003`, `26/03/100007`, `26/03/100008`). Zákon souvislou řadu nevyžaduje, ale bývá to
první věc, na kterou se účetní ptá.

### Číslo si Make negeneruje sám

Zavolá databázovou funkci `public.cislo_faktury_pro_vs(rok, rada, variabilni_symbol)` v Supabase
a ta mu vrátí hotový text. Variabilní symbol do ní posílá **z modulu 3, tedy z databáze**, ne
z webhooku — data z webhooku pocházejí z prohlížeče a daly by se podvrhnout.

✅ **Testováním se nedá nic spálit.** Funkce nic neposouvá: pro stejný variabilní symbol vrátí
vždycky stejné číslo faktury. Když se webhook doručí dvakrát (což se stává), vznikne dvakrát
totéž číslo místo dvou různých. Filtr před modulem 4 přesto zůstává — ne kvůli číslu, ale aby se
hotová faktura nevystavovala a neposílala podruhé.

*(Parametr `rok` řešit nemusíš — funkce si dělá `rok % 100`, takže `26` i `2026` dají stejný
výsledek. Blueprint posílá dvojčíslí a je to v pořádku.)*

### Co se změnilo oproti dřívější verzi

Původně měla faktura tvar `26/03/001` a pořadí bralo z vlastní sekvence `seq_faktura_poradi`.
Ta se **už nepoužívá** (v databázi zůstává jen pro případ návratu k oddělené řadě) a stará funkce
`dalsi_cislo_faktury(rok, rada)` je **zrušená**. Kdyby na ni někde zůstalo staré volání, dostane
HTTP 404 a scénář se zastaví — je to schválně: lepší hlasitá chyba než tiše vystavená faktura
ze zahozené řady.

---

## Údaje dodavatele a platební údaje

Tyhle údaje jsou v blueprintu už vyplněné, ověřené v ARESu 12. 8. 2026. Měnit je nemusíš.

| Údaj | Hodnota |
| --- | --- |
| Název | Právě teď! o.p.s. |
| IČO | 29154901 |
| Sídlo | Fügnerovo náměstí 1808/3, Nové Město, 120 00 Praha 2 |
| DIČ | **žádné — organizace není plátcem DPH a DIČ nemá přiděleno** |
| Právní forma | obecně prospěšná společnost (kód 141), vznik 22. 1. 2013 |
| Číslo účtu | 258492161/0300 (ČSOB) |
| IBAN | CZ2303000000000258492161 |
| SWIFT / BIC | CEKOCZPP |
| Zpráva pro příjemce | AKTIVNE SPOLU |
| Splatnost | **7 dní** od vystavení (počítá Edge Function, Make ji jen přebírá z webhooku) |

---

## Jak vypadá faktura (POZOR: neplátce DPH)

Fakturu vystavuje **Právě teď! o.p.s., která NENÍ plátcem DPH.** Potvrzeno v ARESu — registr DPH
u tohoto IČO vrací stav „neexistující plátce". Z toho plyne pár tvrdých pravidel, která se nesmí
porušit ani při úpravě šablony:

- ❌ **Žádný rozpis daně.** Na faktuře není sazba DPH, není základ daně, není řádek „DPH 21 %",
  není rekapitulace daně.
- ❌ **Doklad se NEJMENUJE „daňový doklad".** Jmenuje se **FAKTURA**. Neplátce DPH daňový doklad
  vystavovat nemůže.
- ❌ **Na faktuře NENÍ pole „DIČ dodavatele".** Právě teď! o.p.s. žádné DIČ nemá. Nedávej tam
  prázdný řádek ani pomlčku — to pole na fakturu vůbec nepatří.
- ✅ **Je tam jedna položka a jedna částka:** registrační poplatek, 500 Kč. Ta částka je konečná.
- ✅ **Je tam věta o neplátcovství:** *„Právě teď! o.p.s. není plátcem DPH a nemá přiděleno DIČ.
  Fakturovaná částka je konečná, daň se neuplatňuje."*
- ✅ DIČ **odběratele** se na fakturu opíše, když ho vyplnil, ale nic se z něj nepočítá.

---

## Šablona faktury v Google Docs

Scénář nekreslí fakturu sám — vyplňuje **Google dokument, který si založíš.** Vyrob si obyčejný
Google dokument, který vypadá jako faktura, a na místa, kam patří údaje, napiš pole ve složených
závorkách. Make je při každém běhu nahradí skutečnými hodnotami.

**Pole, která šablona musí obsahovat:**

| Pole v šabloně | Co se doplní |
| --- | --- |
| `{{cislo_faktury}}` | Číslo faktury, např. 26/03/100001 |
| `{{datum_vystaveni}}` | Datum vystavení |
| `{{datum_splatnosti}}` | Datum splatnosti (7 dní od vystavení) |
| `{{variabilni_symbol}}` | Variabilní symbol ze Supabase, např. 100001 |
| `{{vystavovatel_nazev}}` | Právě teď! o.p.s. |
| `{{vystavovatel_adresa}}` | Ulice a číslo |
| `{{vystavovatel_mesto_psc}}` | PSČ a město |
| `{{vystavovatel_ic}}` | IČO |
| `{{vystavovatel_rejstrik}}` | Zápis v rejstříku o.p.s. |
| `{{vystavovatel_email}}` | Kontaktní e-mail |
| `{{vystavovatel_telefon}}` | Kontaktní telefon |
| `{{banka_nazev}}` | Název banky |
| `{{banka_ucet}}` | Číslo účtu |
| `{{banka_iban}}` | IBAN |
| `{{banka_swift}}` | SWIFT / BIC |
| `{{zprava_pro_prijemce}}` | Zpráva pro příjemce (AKTIVNE SPOLU) |
| `{{odberatel_nazev}}` | Název dle rejstříku, nebo jméno kontaktní osoby |
| `{{odberatel_adresa}}` | Fakturační adresa |
| `{{odberatel_ic}}` | IČ odběratele (nebo pomlčka) |
| `{{odberatel_dic}}` | DIČ odběratele (nebo pomlčka) |
| `{{polozka_nazev}}` | Název položky |
| `{{castka_text}}` | 500 Kč |
| `{{veta_neplatce_dph}}` | Věta o neplátcovství DPH |

⚠️ V seznamu schválně **není pole pro DIČ dodavatele** a není tam ani nic o DPH. Do šablony to
nepřidávej — viz kapitola výš.

Až budeš mít šablonu hotovou, otevři ji a z adresního řádku si opiš její ID — je to ten dlouhý
kód mezi `/d/` a `/edit`. To ID patří do modulu 2 jako `gdocs_sablona_id`.

> Po výběru šablony v modulu 6 si Make sám načte pole ze šablony a nabídne je k namapování.
> Zkontroluj, že jsou vyplněná podle tabulky výš.

⚠️ **Do šablony se pole píší se závorkami (`{{castka_text}}`), do modulu 6 BEZ nich.**
V modulu 6 (sekce *Values*) je vlevo jen holý název pole — `castka_text` — protože složené
závorky si tam Make doplňuje sám. Kdybys tam napsal `{{castka_text}}`, Make by v dokumentu hledal
`{{{{castka_text}}}}` a nenašel nic. V blueprintu je to už takhle správně.

---

## Co je potřeba připravit v Supabase

### 1. Bucket na faktury — jen zkontrolovat

Storage bucket **`faktury`** se zakládá spolu s databází. Než scénář zapneš, ověř, že existuje
a že je **neveřejný**: Supabase → *Storage* → v seznamu bucket `faktury`, sloupec *Public* musí
být prázdný / vypnutý.

Kdyby tam nebyl, založíš ho ručně: *Storage* → *New bucket* → název `faktury` →
**Public bucket nechat VYPNUTÝ.**

⚠️ Bucket **nesmí být veřejný** — jsou v něm faktury s osobními a fakturačními údaji.
Existující bucket `qr` je veřejný, ale slouží jen pro QR obrázky k platbě, faktury do něj nepatří.
Protože je bucket neveřejný, vyrábí modul 10 podepsaný odkaz s platností 10 let a ten se ukládá
do sloupce `faktura_url`.

### 2. Připojení k Supabase v Make (service_role klíč)

V databázi je zapnuté RLS a **veřejný `anon` klíč nemá na tabulku `prihlasky` vůbec žádná práva.**
Make proto musí používat **service_role klíč**. S anon klíčem scénář nepojede — bude vracet
prázdné výsledky nebo chybu 401.

Zakládá se přímo v modulu: otevři modul 3 → pole **Credentials** → *Add* → **API Key Auth**.
(V Make to není „Connection", ale „Key" — najdeš je pak v levém menu pod *Keys*.)

| Pole | Hodnota |
| --- | --- |
| Název | `Supabase service_role – aktivne-spolu` |
| API Key | hodnota proměnné `SUPABASE_SERVICE_ROLE_KEY` |
| Key placement | Header |
| Key parameter name | `Authorization` |
| Key value prefix | `Bearer ` (včetně mezery na konci) |

> 🔒 **Service_role klíč obchází všechna oprávnění.** Nikam ho nepiš, neposílej ho e-mailem
> a nedávej ho do žádného souboru v gitu. Bere se z proměnné `SUPABASE_SERVICE_ROLE_KEY`
> v souboru `.env` a zadává se ručně jen tady, do připojení v Make.

Tenhle jeden klíč pak vyber ve všech pěti modulech: 3, 4, 9, 10 a 11.

### 3. Co scénář v databázi čte a zapisuje

Čte z tabulky `public.prihlasky`: `id`, `email`, `kontaktni_osoba`, `variabilni_symbol`, `stav`,
`forma_platby`, `fakt_nazev`, `fakt_adresa`, `fakt_ic`, `fakt_dic`, `faktura_cislo`, `faktura_url`.

Zapisuje zpět jen dva sloupce: **`faktura_cislo`** a **`faktura_url`**.

Volá funkci `public.cislo_faktury_pro_vs(rok, rada, variabilni_symbol)`.

📌 Zápis `faktura_cislo` hlídá databáze podmínkou `faktura_cislo_odpovida_vs`: číslo faktury musí
končit variabilním symbolem té přihlášky, ke které se zapisuje. Cizí nebo ručně přepsané číslo
neprojde a zápis skončí chybou 400. Je to pojistka proti překlepu ve scénáři — číslo faktury je
účetní údaj a nemá se dát „nějak" opravit.

📌 Filtr před modulem 2 pouští dál jen přihlášky, kde se `forma_platby` **rovná** `prevod`.
Databáze má na tom sloupci omezení `check (forma_platby in ('qr', 'prevod'))` a formulář posílá
přesně tyhle dvě hodnoty — jiná tam nevznikne. `qr` znamená, že člověk platí rovnou QR kódem
a fakturu nechce; `prevod` je ten případ, kdy se fakturuje.

⚠️ Kdyby někdo do formuláře přidal třetí formu platby, která má taky dostat fakturu, musí se
přidat i sem do filtru. Jinak se ta přihláška tiše přeskočí — scénář naskočí a hned skončí,
nikde se nic nerozsvítí.

---

## SEZNAM ÚDAJŮ K DOPLNĚNÍ

**Tohle je jediný seznam, který zbývá vyřídit** — nejspíš po konzultaci s účetní. Dá se vyplnit
najednou, na jedno posezení. Všech osm bodů je v **modulu 2 „Nastavení – údaje vystavovatele
a konfigurace"**, což je jediné místo scénáře, kde se něco edituje.

⚠️ **Dokud tam zůstane byť jediný `[DOPLNIT:`, vytiskne se ta hranatá závorka doslova na fakturu,
kterou dostane přihlášený.**

| # | Proměnná | Co doplnit | Kdo to ví |
| --- | --- | --- | --- |
| 1 | `vystavovatel_rejstrik` | `[DOPLNIT: zápis v rejstříku o.p.s. – soud, oddíl a vložka]` | účetní / zakládací listina |
| 2 | `vystavovatel_email` | `[DOPLNIT: fakturační e-mail Právě teď! o.p.s.]` | organizace |
| 3 | `vystavovatel_telefon` | `[DOPLNIT: telefon kontaktní osoby pro fakturaci]` | organizace |
| 4 | `rada_faktur` | `[DOPLNIT: dvoumístné interní číslo řady faktur, např. 03]` | **účetní** — musí to být řada, která se nekříží s ostatními |
| 5 | `gdocs_sablona_id` | `[DOPLNIT: ID Google Docs šablony faktury]` | vznikne při tvorbě šablony |
| 6 | `gdrive_slozka_id` | `[DOPLNIT: ID složky na Google Drive pro dočasné dokumenty]` | kdo spravuje Disk |
| 7 | `odesilatel_email` | `[DOPLNIT: adresa v Google Workspace, ze které faktury odcházejí]` | organizace |
| 8 | `kopie_email` | `[DOPLNIT: e-mail účetní, kam má chodit kopie každé faktury]` | účetní |

*(Dřív tu byl ještě devátý bod — přesná hodnota `forma_platby` do filtru. Ta je už známá, je to
`prevod`, a v blueprintu je zapsaná natvrdo. Doplňovat ji nemusíš.)*

**Už vyplněné, needituj:** `vystavovatel_nazev`, `vystavovatel_adresa`, `vystavovatel_mesto_psc`,
`vystavovatel_ic` (29154901), `vystavovatel_web`, `banka_nazev`, `banka_ucet`, `banka_iban`,
`banka_swift`, `zprava_pro_prijemce`, `polozka_nazev`, `polozka_castka` (500),
`veta_neplatce_dph`, `splatnost_dnu` (7), `supabase_url`, `storage_bucket`.

---

## Postup nasazení, krok za krokem

1. **Import.** Make → *Scenarios* → *Create a new scenario* → tři tečky vpravo nahoře →
   *Import Blueprint* → vyber `fakturace-blueprint.json`.
2. **Zkontroluj bucket `faktury`** v Supabase Storage — musí existovat a být **neveřejný**.
3. **Vytvoř připojení** — Gmail, Google Docs, Supabase API Key Auth (viz výš).
   Připoj je ve všech modulech, kde je pole Connection prázdné.
4. **Vytvoř šablonu faktury** v Google Docs a zkopíruj si její ID.
5. **Vyplň modul 2** — všech 8 bodů ze seznamu „SEZNAM ÚDAJŮ K DOPLNĚNÍ".
6. **Vytvoř webhook** v modulu 1 (*Create a webhook*) a **zkopíruj si jeho adresu.**
7. **Přepiš `MAKE_WEBHOOK_URL` v Supabase** tou novou adresou a nasaď Edge Function znovu.
   *(Tenhle krok se nejčastěji zapomíná — viz varování na začátku.)*
8. **Zapni scénář** přepínačem *Scheduling* na ON.
9. **Otestuj** — pošli přes web zkušební přihlášku s volbou „převod s fakturou".
   Zkontroluj, že: přišel e-mail s PDF, PDF je v bucketu `faktury`, a že u přihlášky
   v databázi přibylo `faktura_cislo` i `faktura_url`.
10. **Zkušební přihlášku smaž.** Číslo faktury se z ničeho nespálí — odvozuje se z variabilního
    symbolu, ne z vlastní sekvence. Spotřebovaný zůstane jen ten variabilní symbol zkušební
    přihlášky, takže první ostrá faktura na něj nenaváže. To je v pořádku, jen ať tě to
    nepřekvapí.

---

## Když to spadne

Scénář má zapnuté **ukládání nedokončených běhů** (*Allow storing incomplete executions*).
Když něco selže — spadne Google, vyprší připojení, nebo je Supabase nedostupné — běh se uloží
do *Incomplete executions* a dá se **spustit znovu** po opravě příčiny. Nic se neztratí a nic se
netváří, že proběhlo.

Všech pět Supabase modulů (3, 4, 9, 10, 11) má navíc zapnuté **„Evaluate all states as errors"**.
Znamená to, že když Supabase vrátí 4xx nebo 5xx, modul spadne a běh skončí v *Incomplete
executions* — místo aby scénář vesele pokračoval s chybovou odpovědí místo dat a poslal člověku
prázdnou fakturu. Tohle nevypínej.

Faktura je považovaná za vystavenou až ve chvíli, kdy modul 11 zapíše `faktura_cislo` k přihlášce.
Dokud je ten sloupec prázdný, filtr v modulu 4 pustí přihlášku znovu a faktura se dovystaví.

**Doporučení:** v Make si zapni e-mailová upozornění na chyby scénáře
(*Scenario settings* → *Notifications*), ať se o problému dozvíš dřív než přihlášený.

Nejčastější problémy:

| Příznak | Příčina |
| --- | --- |
| V *History* není vůbec žádný běh | Špatná nebo nepřepsaná `MAKE_WEBHOOK_URL` v Supabase. |
| Běh je v *History*, ale hned skončí na modulu 2 | Přihláška měla `forma_platby` = `qr` (platí QR kódem, fakturu nechce) — tak to má být. Když to dělá i u `prevod`, změnil se filtr. |
| Modul 3 vrací 406 nebo prázdno, ale běh doběhl | Do dotazu se dosadilo prázdné ID — zkontroluj, že se scénář odkazuje na `{{1.id}}`, ne na `prihlaska_id`. |
| Modul 3 vrací 401 nebo prázdno | Použitý anon klíč místo service_role. |
| Modul 4 vrací 404 | Špatný název funkce nebo špatné jméno parametru. |
| Na faktuře je vidět `[DOPLNIT: …]` | Nevyplněný modul 2. |
| Modul 9 vrací 400 | Bucket `faktury` neexistuje. |
| E-mail nedorazil | Nepřipojený Gmail, nebo prázdný `odesilatel_email`. |

---

## Jak je blueprint ověřený

Blueprint původně vznikl ručně, jako psaný soubor. **Teď už je ale ověřený přímo proti Make**
(12. 8. 2026, přes Make API):

1. **Kontrola struktury** — blueprint prošel schématem Make (`validate_blueprint_schema`).
   Tahle kontrola sama o sobě nestačí: projde i s vymyšleným názvem modulu.
2. **Kontrola názvů modulů** — u každé použité aplikace (`gateway`, `util`, `http`, `google-docs`,
   `google-email`) byl vytažen seznam skutečně existujících modulů a všech dvanáct názvů se proti
   němu porovnalo.
3. **Kontrola nastavení modulů** — u modulů, kde to jde bez připojeného účtu, se ověřilo, že
   souhlasí názvy polí a povolené hodnoty.
4. **Zkušební vytvoření scénáře** — blueprint byl v Make skutečně nahrán a Make z něj scénář
   vytvořil bez chyby a bez varování (scénář `9650926` v týmu *My Team*, **záměrně vypnutý**,
   bez připojení a bez reálných údajů). Soubor v tomhle adresáři je pak vyexportovaný zpátky
   z Make — je to tedy přesně to, co Make přijal.
5. **Porovnání se skutečným tělem webhooku** — názvy polí v blueprintu se porovnaly s tím, co
   opravdu posílá nasazená Edge Function, a s omezeními (`check`) na tabulce `prihlasky`.
   Tady se našly dvě chyby, které by fakturaci **tiše zabily** (viz tabulka níž) — scénář by
   naskočil, hned skončil a nikdo by nepoznal, že něco nejede.

**Co se při tom našlo a opravilo** (kdyby tě zajímalo, proč se soubor liší od dřívější verze):

| Co bylo špatně | Jak to je teď |
| --- | --- |
| Modul 7 se jmenoval `downloadADocument` — takový modul v Make neexistuje | správně `exportADocument` (v UI *Download a Document*) |
| Modul 7 měl `format: pdf` | správně `mimeType: application/pdf` + `destination` |
| Modul 6 dosazoval pole objektem `values` | správně seznam `requests` s dvojicemi *Tags* / *Replaced Value* |
| Moduly 6, 7 a 12 neměly povinné pole „Choose a Drive" | doplněno `destination: drive` |
| Gmail (modul 8) měl `content` + `contentType` a `replyTo` | správně `html`; Reply-To Gmail modul nemá, kontakt je proto v textu mailu |
| Gmail měl připojení v poli `__IMTCONN__` | správně `account` |
| Supabase moduly měly připojení v poli `__IMTCONN__` | správně `auth` (klíč API Key Auth) + `handleErrors` |
| Supabase modulům chybělo povinné pole `serializeUrl` | doplněno |
| Filtr pouštěl dál `forma_platby` obsahující `faktur` — **taková hodnota v databázi nikdy nevznikne** (je tam `check in ('qr','prevod')`), takže by se nevystavila ani jedna faktura | rovná se `prevod` |
| Scénář četl `{{1.prihlaska_id}}`, ale Edge Function posílá pole `id` — dotaz by se ptal na prázdné ID | všude `{{1.id}}` |
| Modul 5 si počítal splatnost znovu přes `addDays(now; 7)`, mohla se rozejít s datem v QR kódu | bere se hotová z webhooku (`splatnost`) |

**Co ověřit nešlo a čeká to na tebe:** cokoliv, co potřebuje reálný účet nebo reálné údaje —
tedy že Google šablona existuje a má správná pole, že Gmail smí odesílat z dané adresy, že
service_role klíč sedí a že bucket `faktury` odpovídá. To se pozná až prvním zkušebním během
podle bodu 9 postupu výš.
