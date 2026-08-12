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
- **Supabase (service_role)** — moduly 3, 4, 9, 10 a 11. Zakládá se jako připojení typu
  **API Key Auth** (viz kapitola „Připojení k Supabase" níž).

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
| 1 | Webhook | Přijme zprávu z Edge Function. Stačí, když v ní je `prihlaska_id`. |
| 2 | Nastavení proměnných | **Jediné místo, kde se něco edituje.** Údaje vystavovatele, banka, řada faktur, adresy. |
| 3 | Supabase — načtení přihlášky | Načte skutečná data z databáze. Filtr před modulem 2 pustí dál jen platbu převodem s fakturou. |
| 4 | Supabase — číslo faktury (RPC) | Vyžádá si číslo z databáze. Filtr pustí dál jen přihlášky, které fakturu ještě nemají. |
| 5 | Sestavení faktury | Spočítá datum splatnosti (7 dní), název souboru, poskládá odběratele. |
| 6 | Google Docs — šablona | Vyplní Google dokument s fakturou. |
| 7 | Google Docs — PDF | Vyexportuje ho jako PDF. |
| 8 | Gmail | Pošle fakturu přihlašujícímu, kopii účetní. |
| 9 | Supabase Storage | Uloží PDF do neveřejného bucketu `faktury`. |
| 10 | Supabase Storage | Vyrobí podepsaný odkaz na to PDF. |
| 11 | Supabase — zápis | Zapíše `faktura_cislo` a `faktura_url` k přihlášce. |
| 12 | Google Docs — úklid | Smaže dočasný dokument z Disku. Nepovinné. |

---

## Číslo faktury: proč si ho Make nevymýšlí

Faktura má číslo ve tvaru **`RR/SS/NNN`**, například `26/03/001`:

- `RR` — rok (26 = rok 2026)
- `SS` — interní číslo řady, nastavuje se v modulu 2 jako `rada_faktur`
- `NNN` — pořadové číslo faktury v řadě

**Číslo si Make negeneruje sám.** Zavolá databázovou funkci
`public.dalsi_cislo_faktury(rok, rada)` v Supabase a ta mu vrátí hotový text. Důvod je jednoduchý:
kdyby si číslo počítal Make, mohly by při dvou přihláškách ve stejnou vteřinu vzniknout dvě faktury
se stejným číslem. Takhle pořadí hlídá jedna Postgres sekvence a řada je vždycky souvislá a jenom
na jednom místě.

**Stejné to je s variabilním symbolem.** Ten přiděluje Supabase už při registraci, Make ho jen
přebere z načtené přihlášky (modul 3) a opíše na fakturu. Nikde ho nedopočítává.

⚠️ **Pozor při testování:** každé volání modulu 4 posune sekvenci. Když si modul spustíš „jen tak
na zkoušku", spálíš tím jedno číslo v řadě a v číslování vznikne díra. Proto je před modulem 4
filtr, který pustí dál jen přihlášky, které fakturu opravdu ještě nemají — díky němu se při
opakovaném doručení webhooku číslo nepřidělí podruhé.

*(Parametr `rok` řešit nemusíš — funkce si dělá `rok % 100`, takže `26` i `2026` dají stejný
výsledek. Blueprint posílá dvojčíslí a je to v pořádku.)*

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
| Splatnost | **7 dní** od vystavení |

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
| `{{cislo_faktury}}` | Číslo faktury, např. 26/03/001 |
| `{{datum_vystaveni}}` | Datum vystavení |
| `{{datum_splatnosti}}` | Datum splatnosti (7 dní od vystavení) |
| `{{variabilni_symbol}}` | Variabilní symbol ze Supabase |
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

V Make: *Connections* → *Add* → **HTTP → API Key Auth**:

| Pole | Hodnota |
| --- | --- |
| Název připojení | `Supabase service_role – aktivne-spolu` |
| API Key | hodnota proměnné `SUPABASE_SERVICE_ROLE_KEY` |
| Key placement | Header |
| Key parameter name | `Authorization` |
| Key value prefix | `Bearer ` (včetně mezery na konci) |

> 🔒 **Service_role klíč obchází všechna oprávnění.** Nikam ho nepiš, neposílej ho e-mailem
> a nedávej ho do žádného souboru v gitu. Bere se z proměnné `SUPABASE_SERVICE_ROLE_KEY`
> v souboru `.env` a zadává se ručně jen tady, do připojení v Make.

Tohle jedno připojení pak vyber ve všech pěti modulech: 3, 4, 9, 10 a 11.

### 3. Co scénář v databázi čte a zapisuje

Čte z tabulky `public.prihlasky`: `id`, `email`, `kontaktni_osoba`, `variabilni_symbol`, `stav`,
`forma_platby`, `fakt_nazev`, `fakt_adresa`, `fakt_ic`, `fakt_dic`, `faktura_cislo`, `faktura_url`.

Zapisuje zpět jen dva sloupce: **`faktura_cislo`** a **`faktura_url`**.

Volá funkci `public.dalsi_cislo_faktury(rok, rada)`.

📌 Filtr před modulem 2 pouští dál přihlášky, kde `forma_platby` **obsahuje** text `faktur`.
Je to schválně volné, aby to fungovalo bez ohledu na přesný zápis. Až bude jasná přesná hodnota,
přepni filtr na „rovná se" a zadej ji přesně (bod 9 v seznamu níž).

---

## SEZNAM ÚDAJŮ K DOPLNĚNÍ

**Tohle je jediný seznam, který zbývá vyřídit** — nejspíš po konzultaci s účetní. Dá se vyplnit
najednou, na jedno posezení. Body 1–8 jsou všechny v **modulu 2 „Nastavení – údaje vystavovatele
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
| 9 | filtr u modulu 2 | `[DOPLNIT: přesná hodnota sloupce forma_platby pro převod s fakturou, např. prevod_faktura]` | vývojář formuláře |

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
5. **Vyplň modul 2** — všech 9 bodů ze seznamu „SEZNAM ÚDAJŮ K DOPLNĚNÍ".
6. **Vytvoř webhook** v modulu 1 (*Create a webhook*) a **zkopíruj si jeho adresu.**
7. **Přepiš `MAKE_WEBHOOK_URL` v Supabase** tou novou adresou a nasaď Edge Function znovu.
   *(Tenhle krok se nejčastěji zapomíná — viz varování na začátku.)*
8. **Zapni scénář** přepínačem *Scheduling* na ON.
9. **Otestuj** — pošli přes web zkušební přihlášku s volbou „převod s fakturou".
   Zkontroluj, že: přišel e-mail s PDF, PDF je v bucketu `faktury`, a že u přihlášky
   v databázi přibylo `faktura_cislo` i `faktura_url`.
10. **Zkušební přihlášku smaž** — ale číslo faktury už je ze sekvence spotřebované, takže první
    ostrá faktura bude mít o jedničku vyšší pořadí. To je v pořádku, jen ať tě to nepřekvapí.

---

## Když to spadne

Scénář má zapnuté **ukládání nedokončených běhů** (*Allow storing incomplete executions*).
Když něco selže — spadne Google, vyprší připojení, nebo je Supabase nedostupné — běh se uloží
do *Incomplete executions* a dá se **spustit znovu** po opravě příčiny. Nic se neztratí a nic se
netváří, že proběhlo.

Faktura je považovaná za vystavenou až ve chvíli, kdy modul 11 zapíše `faktura_cislo` k přihlášce.
Dokud je ten sloupec prázdný, filtr v modulu 4 pustí přihlášku znovu a faktura se dovystaví.

**Doporučení:** v Make si zapni e-mailová upozornění na chyby scénáře
(*Scenario settings* → *Notifications*), ať se o problému dozvíš dřív než přihlášený.

Nejčastější problémy:

| Příznak | Příčina |
| --- | --- |
| V *History* není vůbec žádný běh | Špatná nebo nepřepsaná `MAKE_WEBHOOK_URL` v Supabase. |
| Modul 3 vrací 401 nebo prázdno | Použitý anon klíč místo service_role. |
| Modul 4 vrací 404 | Špatný název funkce nebo špatné jméno parametru. |
| Na faktuře je vidět `[DOPLNIT: …]` | Nevyplněný modul 2. |
| Modul 9 vrací 400 | Bucket `faktury` neexistuje. |
| E-mail nedorazil | Nepřipojený Gmail, nebo prázdný `odesilatel_email`. |

---

## Poznámka k původu blueprintu

Blueprint je napsaný ručně jako soubor, ne vyexportovaný z běžícího scénáře — proto ho po importu
projdi podle bodu 3 postupu výš. Když u některého modulu Make hlásí, že nezná některé pole,
stačí ho v modulu doklikat ručně; logika scénáře i všechny texty jsou popsané v tomto návodu,
takže se dají obnovit.
