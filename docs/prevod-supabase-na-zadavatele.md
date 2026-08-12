# Převod databáze (Supabase) na zadavatele

Návod, jak předat „zákulisí" webu aktivne-spolu.cz z účtu dodavatele (TrixTech)
do účtu zadavatele (Právě teď! o.p.s. — Hana).

Psané tak, aby ho zvládl přečíst i někdo, kdo Supabase nikdy neviděl. Podle
tohohle návodu bude někdo reálně klikat a udělá nevratnou věc, takže je u
každého tvrzení napsané, jestli je **ověřené**, nebo se má **ověřit v
dashboardu**.

Stav ověřený na živém projektu: **12. 8. 2026**.

---

## Nejdůležitější věta na začátek

**Převodem se nemění adresa databáze ani veřejný klíč. Web se proto nemusí
znovu sestavovat ani znovu nahrávat na FTP. Nic v projektu není na převodu
závislé.**

Proč to tak je: projekt má trvalé označení (tzv. *ref*) `kourmwqxkhdtahbxyuaq`.
Z něj je odvozená celá adresa `https://kourmwqxkhdtahbxyuaq.supabase.co` a je
zapečené i uvnitř veřejného klíče, kterým se web hlásí. Převod mezi
organizacemi je jen přeúčtování už existujícího projektu — nový projekt
nevzniká, nic se nepřestěhuje na jiný server, zůstává i stejný region
(Frankfurt) a stejná verze databáze.

To je zároveň jediné místo, kde by nás chyba mohla stát přebuildování, takže se
to hned po převodu **ověřuje jedním příkazem** (viz kapitola 6, krok 1).

---

## Slovníček — ať to dál dává smysl

| Pojem | Co to je lidsky |
| --- | --- |
| **Supabase** | Firma a služba, kde běží databáze projektu. Naše „serverovna". |
| **Projekt** | Jedna databáze se vším kolem. Náš se jmenuje `aktivne-spolu`. |
| **ref** (označení projektu) | Trvalé jméno projektu, `kourmwqxkhdtahbxyuaq`. Jako číslo popisné. Nemění se. |
| **Organizace** | Účetní obal nad projekty. Platí se za ni, patří pod ni lidé. **Tohle se převádí.** |
| **Veřejný klíč** (anon) | Klíč, který je v prohlížeči každého návštěvníka. Není to heslo, sám o sobě k datům nepustí. |
| **Servisní klíč** (service role) | Klíč, který obchází veškeré zabezpečení. Nesmí opustit server. |
| **Edge Funkce** | Malý program u databáze. Náš se jmenuje `prijmout-prihlasku` a zpracovává formulář. |
| **Tajemství funkce** (secrets) | Nastavení uložené u funkce — číslo účtu, přihlášení k odesílání pošty apod. |
| **RLS** | Zámek na tabulce. Určuje, kdo smí co číst a zapisovat. |
| **Sekvence** | Počítadlo. Máme dvě: variabilní symboly a pořadí faktur. |
| **Bucket** | Přihrádka na soubory. Máme `qr` (obrázky QR plateb) a `faktury` (PDF). |
| **Migrace** | Textový soubor, který popisuje stavbu databáze. Spouští se v pořadí. |

---

## 1. Co se převodem NEmění

Tohle je **ověřené** na živém projektu příkazy `supabase projects list`,
`functions list`, `migration list` a dotazy do databáze.

| Zůstává beze změny | Poznámka |
| --- | --- |
| **Označení projektu (`ref`)** `kourmwqxkhdtahbxyuaq` | Převod mění jen vlastníka, ne identitu projektu. |
| **Adresa `PUBLIC_SUPABASE_URL`** `https://kourmwqxkhdtahbxyuaq.supabase.co` | Odvozená od `ref`. |
| **Veřejný klíč `PUBLIC_SUPABASE_ANON_KEY`** | `ref` je uvnitř klíče a klíč je podepsaný tajemstvím projektu — převod ani jedno nemění. |
| **Adresa formulářové funkce** `…/functions/v1/prijmout-prihlasku` | Beze změny. |
| **Všechna data** — tabulka `prihlasky` i vše ostatní | Databáze se nepřesouvá. |
| **Zabezpečení (RLS)** na tabulce `prihlasky` | Zámek je uložený v databázi, jde s ní. |
| **Sekvence a jejich aktuální čísla** | Počítadla pokračují tam, kde skončila. Nevrací se na začátek. |
| **Databázová funkce `dalsi_cislo_faktury`** | Součást databáze. |
| **Buckety `qr` a `faktury` včetně souborů a nastavení veřejnosti** | Uložené v databázi (byly založené migrací). |
| **Edge Funkce `prijmout-prihlasku` včetně kódu a verze** | Verze zůstává, funkce neztratí historii. |
| **Tajemství Edge Funkce** (číslo účtu, částka, IBAN…) | Patří k projektu, ne k organizaci. Po převodu se ale **kontroluje** — viz kapitola 6, krok 5. |
| **Heslo k databázi** | Nemění se. Hana ho ale musí dostat, jinak si nesáhne na migrace. |
| **Region (Frankfurt, eu-central-1) a verze Postgresu 17** | Převod neumí měnit region — proto se ani nezmění. |
| **Historie migrací** | Obě nasazené migrace zůstávají zapsané jako proběhlé. |

**Praktický důsledek:** složka `dist/` na FTP zůstává platná. Adresa
`kourmwqxkhdtahbxyuaq.supabase.co` je sice zapečená v souborech
`dist/index.html`, `dist/kreativni/index.html` a `dist/varianta-b/index.html`
(vkládá se při sestavení webu) — ale protože se adresa nemění, nic se
přepisovat nemusí.

---

## 2. Co se změnit MŮŽE

### 2.1 Fakturace a tarif

- Do převodu platí spotřebu naše organizace, po převodu Hanina. Účtuje se to
  na nejbližším vyúčtování každé strany.
- Naše organizace `Samko.stolarik` je dnes na tarifu **Free** (ověřeno).
  Hanin nový účet bude taky Free. Takže se fakticky nic nemění — z Free na
  Free se ani neplatí, ani nevzniká výpadek.
- Kdyby se převádělo z placeného tarifu na Free, dokumentace upozorňuje na
  **1–2 minuty výpadku**. Nás se to netýká, protože jsme na Free už teď.

### 2.2 Limity tarifu Free — pozor, tohle je past

Supabase v dokumentaci uvádí: **dva aktivní projekty zdarma na organizaci.
Uspané projekty se do limitu nepočítají.** A dodává důležitou větu, kvůli
které se to komplikuje:

> Limit se v organizaci počítá ze všech členů, kteří mají roli Owner nebo
> Administrator. Pokud má organizace člena s rolí Admin nebo Owner, který už
> svou kvótu vyčerpal, další projekt zdarma v té organizaci nespustíte.

Jak na tom jsme teď (ověřeno):

| Projekt v naší organizaci | Stav |
| --- | --- |
| `aktivne-spolu` | běží |
| `Clutch` | běží |
| `FineNet Client` | uspaný — do limitu se nepočítá |

Tedy **2 ze 2**, jsme přesně na stropu. To znamená:

> **Kdyby dodavatel (stolarik@trixtech.eu) vstoupil do Haniny organizace jako
> Owner nebo Administrator, může to Hanině organizaci zablokovat převzetí
> projektu** — Supabase uvidí člena s vyčerpanou kvótou.
>
> Řešení je v kapitole 5: převod dělat, když je dodavatel v Hanině organizaci
> v roli **Developer** (ta se do kvóty nepočítá).

Další limity Free tarifu, které se po převodu počítají **Hanině** organizaci,
ne naší: 500 MB databáze na projekt, 1 GB úložiště souborů, 5 GB přenesených
dat měsíčně, 500 000 spuštění Edge Funkcí měsíčně, 1 den historie protokolů,
**žádné zálohy**. (Čísla podle veřejného ceníku Supabase, srpen 2026 —
**před převodem si je znovu ověřte na supabase.com/pricing**, ceníky se mění.)

> **Provozní varování k tarifu Free:** projekt, do kterého se týden nikdo
> nepodívá a nepřijde mu žádný požadavek, Supabase automaticky **uspí**. Uspaný
> projekt = formulář na webu přestane přijímat přihlášky, dokud ho někdo ručně
> neprobudí. Po převodu to hlídá Hana, ne my. Tohle jí musí někdo výslovně
> říct — je to nejpravděpodobnější způsob, jak se web „samo od sebe rozbije".

### 2.3 Kdo má přístup

Po převodu má nad projektem plnou moc **vlastník Haniny organizace**. Naše
role se **nedědí** — jsme v Hanině organizaci jen v té roli, kterou nám tam
Hana přidělí. To je rozebrané v kapitole 7.

Role, které Supabase nabízí (ověřeno v dokumentaci):

| Role | Smí spustit migrace (`db push`) | Smí nasadit Edge Funkci | Smí převést projekt jinam |
| --- | --- | --- | --- |
| **Owner** | ano | ano | ano |
| **Administrator** | ano | ano | **ne** |
| **Developer** | ano | **ne** | ne |
| Read-Only | ne | ne | ne (jen tarif Team/Enterprise) |

### 2.4 Co převod NEpřežije / co je nutné nastavit znovu

| Věc | Co s ní bude |
| --- | --- |
| **Naše přihlášení do projektu** | Zaniká ve chvíli, kdy nás Hana ze své organizace odebere. Do té doby platí role, kterou nám dá. |
| **Přiřazení k tarifu a fakturaci** | Přechází pod Hanu. Naše platební údaje s projektem nejdou. |
| **Spotřeba se počítá z Hanina koláče** | Přenesená data, spuštění funkcí, MAU — vše nově proti Hanině organizaci. |
| **Cokoliv nastaveného na úrovni organizace** | Nejde s projektem: členové organizace, název na fakturách, propojení s GitHubem, odvod protokolů (log drains), SSO. **U nás nic z toho nastavené nemáme** — ale je to potřeba ověřit v dashboardu, přes příkazovou řádku se to spolehlivě zjistit nedá. |
| **Naše lokální propojení `supabase link`** | Soubor v repozitáři zůstane platný (`ref` se nemění), ale příkazy začnou hlásit chybu přístupu, jakmile nám Hana roli vezme. |

**Přežije naopak i to, co se často čeká, že nepřežije:** servisní klíč,
tajemství Edge Funkce, buckety včetně obsahu, sekvence i s aktuálními čísly,
RLS, heslo k databázi.

---

## 3. Předletová kontrola — odškrtat PŘED převodem

Odškrtávejte položku po položce. Dokud nejsou všechny hotové, převod nezačínat.

### Na naší straně (dodavatel)

- [ ] **Nezbývá už žádné nasazování.** Žádná nová migrace ani nová Edge Funkce
      nečeká na nasazení. Ověřit:
      ```bash
      npx supabase migration list --linked
      npx supabase functions list --project-ref kourmwqxkhdtahbxyuaq
      ```
      U migrací musí u každého řádku sedět `local` a `remote`.
      Stav 12. 8. 2026: 2 migrace (`20260812120000`, `20260812130000`), obě
      nasazené; 1 funkce `prijmout-prihlasku` ve verzi 8, stav ACTIVE.
      **Pozor: dnes se pracuje na napojení na ARES — to znamená minimálně
      jednu novou Edge Funkci navíc. Dokud není hotová a nasazená, tenhle bod
      splněný není.**

- [ ] **Zapsat si čísla „před".** V Supabase → *SQL Editor* spustit a výsledky
      opsat do zápisu z převodu:
      ```sql
      select last_value, is_called from seq_variabilni_symbol;
      select last_value, is_called from seq_faktura_poradi;
      select count(*) from prihlasky;
      ```
      Stav 12. 8. 2026: variabilní symbol `100001` / `is_called = true` (další
      vydaný bude 100002); pořadí faktur `1` / `is_called = false` (první
      vydané bude 1); v tabulce `prihlasky` **1 řádek** — ověřit, jestli to
      není zbytek po testu, a před spuštěním ho případně smazat.

- [ ] **Zapsat si počet tajemství funkce.**
      ```bash
      npx supabase secrets list --project-ref kourmwqxkhdtahbxyuaq
      ```
      Stav 12. 8. 2026: **14 položek** — 7 našich (`IBAN_UCTU`, `SWIFT_UCTU`,
      `CISLO_UCTU`, `ZPRAVA_PLATBY`, `CASTKA_KC`, `SPLATNOST_DNI`,
      `NAZEV_PRIJEMCE`) a 7, které si Supabase doplňuje sám (začínají
      `SUPABASE_`). Příkaz vypisuje jen názvy a otisky, **žádné hodnoty** — dá
      se bez obav pustit i před někým.
      > **Zjištěno při kontrole:** nastavení pro **odesílání potvrzovacích
      > e-mailů chybí** (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
      > `GOOGLE_REFRESH_TOKEN`, `ODESILATEL_EMAIL`), stejně jako
      > `POVOLENE_ORIGINY` a `MAKE_WEBHOOK_URL`. Přihlášky se ukládají i tak,
      > ale **potvrzovací e-mail dnes nikomu nechodí**. Tohle je věc
      > k dořešení před spuštěním, ne až po převodu.

- [ ] **Ověřit v dashboardu**, že projekt **nemá zapnuté propojení s GitHubem**
      (Project Settings → Integrations). Dokumentace uvádí aktivní propojení
      s GitHubem jako **překážku převodu**.

- [ ] **Ověřit v dashboardu**, že projekt **nemá nastavený odvod protokolů**
      (log drains). Taky uvedeno jako překážka. Na tarifu Free se to nastavit
      nedá, takže to skoro jistě nemáme — ale koukněte se.

- [ ] **Zálohovat data ručně.** Free tarif zálohy nemá. Před nevratným úkonem
      se hodí mít vlastní kopii:
      ```bash
      npx supabase db dump --linked -f zaloha-pred-prevodem.sql
      npx supabase db dump --linked --data-only -f zaloha-pred-prevodem-data.sql
      ```
      Soubory uložit mimo repozitář — jsou v nich osobní údaje přihlášených.

- [ ] **Ověřit, že dodavatel je Owner naší organizace.** Ověřeno:
      organizace `Samko.stolarik`, jediný člen `stolarik@trixtech.eu`, role
      **Owner**. Sedí. *(Poznámka: Supabase účet visí na adrese
      `stolarik@trixtech.eu`, ne `info@`. Převod se dělá přihlášený pod
      `stolarik@`.)*

### Na straně zadavatelky (Hana)

- [ ] **Účet je opravdu založený a e-mail potvrzený.** Nestačí registrace, na
      kterou se nekliklo v potvrzovacím e-mailu.

- [ ] **Hana má v Supabase založenou organizaci** (ne jen účet) a **zná její
      název**. Nová organizace bývá pojmenovaná podle uživatele, což se snadno
      splete — ať název pošle písmenko po písmenku.

- [ ] **Hanina organizace je na tarifu Free a je v ní 0 aktivních projektů.**
      Kdyby jich měla dva, převod neprojde.

- [ ] **Hana ví, že po převodu jí projekt patří** — včetně toho, že web
      přestane přijímat přihlášky, když se projekt uspí (kapitola 2.2).

- [ ] **Domluvený termín** — ne pátek odpoledne, ne den před akcí.

---

## 4. Kdo koho musí kdy pozvat — past s členstvím

Tohle je nejčastější místo, kde se převod zasekne.

Dokumentace Supabase to říká takhle:

> Musíte být **vlastníkem (Owner) zdrojové organizace** a **alespoň členem
> cílové organizace**.

Přeloženo do naší situace:

1. **Dodavatel musí být Owner naší organizace.** ✅ Je (ověřeno).
2. **Dodavatel musí být zároveň členem Haniny organizace** — a to **ještě
   předtím**, než se převod spustí. Cílovou organizaci totiž v dialogu
   vybíráte ze seznamu; organizace, ve které nejste, se v seznamu vůbec
   neobjeví.
3. Pozvánku do Haniny organizace **může poslat jen Hana** (vlastník cílové
   organizace). My si ji poslat sami neumíme.
4. **Převod pak provádí dodavatel**, ne Hana. Hana ho spustit nemůže —
   k projektu zatím nemá přístup a převod smí spustit jedině Owner zdrojové
   organizace. (Ani role Administrator na to nestačí — Administrator výslovně
   nesmí převádět projekty ven z organizace.)

A na to se navazuje past z kapitoly 2.2:

> **Roli, kterou nám Hana pro účel převodu dá, volte co nejnižší — ideálně
> Developer.** Kdybychom v Hanině organizaci byli Owner nebo Administrator,
> Supabase při kontrole limitu Free tarifu uvidí člena, který má už dva
> aktivní projekty zdarma, a může převzetí projektu odmítnout. Role Developer
> se do limitu nepočítá a k převodu (kde stačí „alespoň člen") bohatě stačí.
>
> Jestli dialog v dashboardu roli Developer u cílové organizace přesto
> neuzná, **ověřte v dashboardu** a teprve pak Hana roli dočasně zvedne na
> Administrator — ale rovnou po dokončení převodu ji zase snižte.

---

## 5. Postup krok za krokem

Kroky 1–4 dělá Hana, kroky 5–8 dodavatel.

**1. (Hana)** Přihlásit se na <https://supabase.com/dashboard>.

**2. (Hana)** Ověřit, že má **organizaci** a zjistit její přesný název.
V dashboardu je přepínač organizace vlevo nahoře. Název poslat dodavateli.

**3. (Hana)** Pozvat dodavatele do své organizace. V dashboardu
*Organization Settings → Team → Invite member* (**přesné umístění ověřit
v dashboardu — rozhraní se mění**):
- e-mail: `stolarik@trixtech.eu`
- role: **Developer** (viz past v kapitole 4)

**4. (dodavatel)** Přijmout pozvánku z e-mailu. Potom se v dashboardu ověřit,
že se v přepínači organizací **Hanina organizace opravdu objevila**. Když tam
není, převod nemá kam mířit a nemá smysl pokračovat.

**5. (dodavatel)** Projít celou předletovou kontrolu z kapitoly 3 a mít
zapsaná čísla „před".

**6. (dodavatel)** V dashboardu otevřít projekt `aktivne-spolu` →
*Project Settings → General* → sekce věnovaná převodu projektu
(*Transfer project*). Tam vybrat cílovou organizaci a potvrdit.

> **Konkrétní podobu obrazovky tady schválně nepopisuju — nemám ji ověřenou
> a nechci vás navádět na tlačítko, které se jmenuje jinak.** Supabase u
> nevratných úkonů vyžaduje **opsat název projektu** (`aktivne-spolu`) do
> potvrzovacího pole. Čtěte, co na obrazovce stojí. Jestli je v dialogu
> uvedená jakákoli varovná hláška, kterou tenhle návod nezmiňuje, **převod
> zastavte** a nejdřív ji vyřešte.

**7. (dodavatel)** Projít celou kapitolu 6 — ověření po převodu. Výsledky
zapsat.

**8. (dodavatel + Hana)** Teprve po úspěšném ověření řešit role — kapitola 7.

### Kdyby to selhalo

| Hláška / projev | Nejpravděpodobnější příčina |
| --- | --- |
| Hanina organizace není v seznamu | Dodavatel ještě není členem Haniny organizace (krok 4), nebo pozvánka nebyla přijata |
| Stížnost na limit projektů | Past z kapitoly 2.2 — dodavatel je v cílové organizaci Owner/Admin a má už 2 aktivní projekty zdarma. Snížit roli na Developer |
| Stížnost na GitHub / log drains | Předletová kontrola, kapitola 3 — vypnout a zkusit znovu |
| Tlačítko převodu není vidět | Jste přihlášení pod špatným účtem, nebo nejste Owner zdrojové organizace |

**Selhaný převod nic nerozbije.** Projekt zůstane tam, kde byl, a data se
nikam neztratí. Neopakujte ho ale dokola „pro jistotu" — nejdřív zjistěte,
proč selhal.

---

## 6. Co po převodu ověřit

Projít všech šest kroků. Do zápisu si k nim napsat, co vyšlo.

### Krok 1 — projekt je pod Hanou, ale má pořád stejné `ref`

```bash
npx supabase projects list
```

Očekávaný výsledek: projekt `aktivne-spolu` má pořád
`"ref":"kourmwqxkhdtahbxyuaq"` a `"status":"ACTIVE_HEALTHY"`, ale u
`organization_id` je nově Hanina organizace (dnes tam je
`nimpcbdfqkewjroxqrpe`).

> Kdyby se — proti očekávání — `ref` změnilo, **tohle je ta chvíle, kdy se
> web musí přebuildovat**: přepsat `PUBLIC_SUPABASE_URL` i
> `PUBLIC_SUPABASE_ANON_KEY` v `.env`, spustit `npm run build` a nahrát
> `dist/` na FTP. Nečekáme to, ale je to jediná varianta, u které se to musí
> udělat, a tenhle příkaz to odhalí do deseti vteřin.

### Krok 2 — web se pořád připojí k databázi

Nejjistější je zkouška naostro: otevřít <https://aktivne-spolu.cz>, vyplnit
formulář testovací přihláškou (klidně na vlastní e-mail) a odeslat.

Očekávaný výsledek: formulář vrátí variabilní symbol. Musí to být **číslo
o jedna vyšší** než to zapsané v předletové kontrole (dnes by první po převodu
byl `100002`).

Pak testovací řádek **smazat** — v Supabase → *Table Editor* → `prihlasky`.
Sekvence se tím zpátky nevrátí a je to tak správně: díra v číslech
variabilních symbolů ničemu nevadí.

### Krok 3 — zámek na datech pořád drží

Zkouška, že veřejný klíč se pořád nedostane k osobním údajům:

```bash
# klíč se načte z .env, do terminálu se nevypisuje
ANON=$(grep '^PUBLIC_SUPABASE_ANON_KEY=' .env | cut -d= -f2-)
curl -s -o /dev/null -w '%{http_code}\n' \
  "https://kourmwqxkhdtahbxyuaq.supabase.co/rest/v1/prihlasky?select=*" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
```

Očekávaný výsledek: **`401`**. Když chcete vidět i text, pusťte totéž bez
`-o /dev/null -w`; má tam stát `permission denied for table prihlasky`.

> **`200` je poplach.** Znamenalo by to, že se k přihlášeným lidem dostane
> kdokoli, kdo si otevře zdroj stránky. V tom případě okamžitě zkontrolujte
> RLS na tabulce `prihlasky`.

### Krok 4 — Edge Funkce pořád běží

```bash
npx supabase functions list --project-ref kourmwqxkhdtahbxyuaq
```

Očekávaný výsledek: `prijmout-prihlasku`, `"status":"ACTIVE"`, verze **stejná
nebo vyšší** než před převodem (12. 8. 2026 to byla verze 8). Nižší verze nebo
chybějící funkce = něco je špatně.

### Krok 5 — nastavení funkce zůstalo

```bash
npx supabase secrets list --project-ref kourmwqxkhdtahbxyuaq
```

Očekávaný výsledek: **stejný počet položek jako před převodem** (12. 8. 2026
to bylo 14) a mezi nimi `IBAN_UCTU`, `CISLO_UCTU`, `CASTKA_KC`,
`NAZEV_PRIJEMCE`. Kdyby některá chyběla, doplní se znovu:

```bash
npx supabase secrets set --env-file supabase/functions/.env
npx supabase functions deploy prijmout-prihlasku
```

*(To druhé už potřebuje roli Administrator — viz kapitola 7.)*

### Krok 6 — sekvence pokračují ve správných číslech

V Supabase → *SQL Editor*:

```sql
select last_value, is_called from seq_variabilni_symbol;
select last_value, is_called from seq_faktura_poradi;
select count(*) from prihlasky;
```

Očekávaný výsledek: **stejná nebo vyšší** čísla než v předletové kontrole
(vyšší, pokud jste mezitím udělali testovací přihlášku z kroku 2). Nikdy nižší.

Kontrola číslování faktur se dá udělat i naostro, ale **pozor — každé zavolání
posune počítadlo**, takže jen pokud opravdu vystavujete fakturu:

```sql
select dalsi_cislo_faktury(2026, '03');
```

### A ještě jedna kontrola: migrace

```bash
npx supabase migration list --linked
```

Očekávaný výsledek: obě migrace mají shodné `local` i `remote`. Když příkaz
místo toho hlásí chybu přístupu, projekt je v pořádku — jen nám Hana už vzala
roli. To je kapitola 7.

---

## 7. Past s přístupem

**Ve dvou řádcích:** Jakmile nás Hana po převodu ze své organizace odebere,
přestanou fungovat `npx supabase db push` (změny databáze) i
`npx supabase functions deploy` (změny formulářové funkce) — a to jsou přesně
příkazy, kterými se projekt do spuštění ještě dodělává. Projekt sám poběží
dál, ale **nikdo v něm už nebude umět nic opravit**, dokud nás Hana nepozve
zpátky.

### Doporučení

**Dodavatel si nechá roli až do konce spuštění a záručního doběhu.**

Konkrétně navrhnout Hanovi tohle:

| Období | Role dodavatele v Hanině organizaci | Proč |
| --- | --- | --- |
| **Při samotném převodu** | **Developer** | Splňuje podmínku „alespoň člen" a nezapočítává se do limitu Free tarifu (kapitola 2.2) |
| **Do spuštění + 30 dní po něm** | **Administrator** | Jediná role pod Ownerem, která umí nasadit Edge Funkci. Bez ní se formulář nedá opravit. Zvednout ji **až po dokončeném převodu**, ne před ním — jinak hrozí past s limitem |
| **Po záručním doběhu** | **Developer**, nebo odebrat úplně | Když už se nic nenasazuje, stačí čtení. Odebrání je nejčistší |

**Napsat do zápisu / do smlouvy** jednu větu, ať se o tom nemusí vyjednávat
v panice: *„Dodavatel má v organizaci zadavatele roli Administrator do
[datum spuštění + 30 dní]. Po tomto datu ji zadavatel snižuje na Developer
nebo odebírá. Případný pozdější zásah do databáze nebo formulářové funkce
vyžaduje, aby zadavatel roli Administrator dočasně obnovil."*

**Co udělat, než roli ztratíme (uzavření předávky):**

- [ ] Předat Hanovi **heslo k databázi** (Supabase → *Project Settings →
      Database*) bezpečným kanálem — ne e-mailem, ne do chatu.
- [ ] Předat **servisní klíč** stejnou cestou, s upozorněním, že obchází
      veškeré zabezpečení a nesmí do prohlížeče.
- [ ] Předat repozitář se složkou `supabase/` — bez ní se databáze nedá
      znovu postavit ani rozumně měnit.
- [ ] Předat obsah `supabase/functions/.env` (do gitu nepatří).
- [ ] Ukázat Hanovi tři místa v dashboardu: **Table Editor → `prihlasky`**
      (seznam přihlášek), **Edge Functions → Logs** (co se pokazilo)
      a **přepínač uspání projektu** (kapitola 2.2).

**Když nám přístup přesto vezmou dřív**, než je hotovo: nedá se nic
„obejít". Servisní klíč umí zapisovat do databáze, ale **neumí nasadit novou
verzi funkce ani spustit migraci** — na to je potřeba role v organizaci. Jediné
řešení je požádat Hanu o obnovení role.

---

## 8. Kdy převod udělat

### Doporučení: **až po spuštění, ne teď.**

Konkrétně: až bude web živý, projde jím **první skutečná přihláška od
skutečného člověka**, dorazí potvrzovací e-mail a vystaví se první faktura.
Teprve pak převádět.

### Proč

**1. Odložení převodu nic nestojí.** Tohle je hlavní argument. Protože se
`ref` ani veřejný klíč nemění, převod je z pohledu webu neviditelná operace —
je úplně jedno, jestli se udělá dnes, nebo za měsíc. **Nic se tím nezdrží
a nic se tím nezkomplikuje.** Zato převod teď nám může zkomplikovat
dodělávky.

**2. Ještě se bude nasazovat.** Právě se pracuje na **napojení na ARES**
(automatické dotažení firemních údajů podle IČO). To znamená minimálně jednu
novou Edge Funkci, možná i novou migraci. Nasazení Edge Funkce vyžaduje roli
**Administrator**. Po převodu ji nemáme automaticky — musela by nám ji dát
Hana. Každý takový krok je čekání na člověka, který u toho nemusí zrovna být.

**3. Chybí ještě věci, které nejsou hotové.** Kontrola ukázala, že **nastavení
odesílání potvrzovacích e-mailů zatím není nahrané** — přihlášky se ukládají,
ale potvrzení nikomu nechodí. Dodělat se to musí. Dokud takové věci visí,
nemá smysl přehazovat projekt pod účet, kde na ně budeme mít slabší přístup.

**4. Hanin účet je čerstvý a neprošlapaný.** Nový účet, nová organizace,
pravděpodobně bez zkušenosti s tím, jak se přijímá pozvánka. Kdyby se
u kteréhokoli kroku zaseklo (nepotvrzený e-mail, spam filtr, špatná
organizace), děje se to **v týdnu spuštění** — v nejhorší možný čas.

**5. Chybu v nastavení projektu poznáme až za provozu.** Když je projekt ještě
u nás, opravíme ji do minuty. Když už je u Hany a nemáme roli, řeší se
telefonem.

### Co by nás na převodu teď mohlo zdržet

- Hana ještě nemá **organizaci**, jen účet. Pak se převod nemá kam mířit
  a čeká se, až si ji Hana založí.
- **Nepřijatá pozvánka.** Bez členství v Hanině organizaci se převod ani
  nenabídne. Typicky se to zasekne na tom, že pozvánka spadla do spamu.
- **Limit dvou projektů zdarma** (kapitola 2.2) — vyžaduje domyslet, v jaké
  roli do Haniny organizace vstupujeme. Vyřešitelné, ale ne za pět minut.
- **Ověření GitHubu a odvodu protokolů** v dashboardu. Skoro jistě nic
  nemáme, ale koukat se na to musí člověk.
- **Nutnost udělat si vlastní zálohu**, protože Free tarif zálohy nemá.
- Po převodu **kompletní znovuověření** podle kapitoly 6 — půl hodiny práce,
  kterou by bylo lepší v týdnu spuštění věnovat něčemu jinému.

### Kdy převod naopak neodkládat

Až se spustí a doběhne první měsíc provozu, převod **udělejte**. Projekt
s osobními údaji přihlášených lidí má dlouhodobě sedět v účtu toho, komu ta
data patří — ne u dodavatele. Odkládat to donekonečna je horší varianta než
udělat to teď.

---

## Příloha: ověřený stav projektu k 12. 8. 2026

Vypsáno příkazy `npx supabase projects list`, `functions list`,
`migration list --linked`, `secrets list` a dotazy do databáze. **Žádné klíče
ani hesla tady nejsou** a nikdy sem nepatří.

| Co | Hodnota |
| --- | --- |
| Projekt | `aktivne-spolu`, ref `kourmwqxkhdtahbxyuaq` |
| Region | eu-central-1 (Frankfurt), AWS |
| Databáze | PostgreSQL 17.6.1.155, stav ACTIVE_HEALTHY |
| Vznikl | 12. 8. 2026 |
| Organizace | `Samko.stolarik` (`nimpcbdfqkewjroxqrpe`), tarif **Free** |
| Členové organizace | jediný: `stolarik@trixtech.eu`, role **Owner** |
| Projekty v organizaci | `aktivne-spolu` (běží), `Clutch` (běží), `FineNet Client` (uspaný) → **2 aktivní ze 2 povolených** |
| Edge Funkce | `prijmout-prihlasku`, verze 8, ACTIVE, bez vyžadovaného přihlášení |
| Migrace | `20260812120000_prihlasky`, `20260812130000_bucket_faktury` — obě nasazené |
| Tajemství funkce | 14 položek (7 našich + 7 doplněných Supabasem) |
| Chybějící nastavení | odesílání e-mailů (`GOOGLE_*`, `ODESILATEL_EMAIL`), `POVOLENE_ORIGINY`, `MAKE_WEBHOOK_URL` |
| Buckety | `qr` (veřejný, 256 kB), `faktury` (neveřejný, 10 MB) |
| RLS | zapnuté na tabulce `prihlasky` |
| Sekvence | variabilní symbol: naposledy 100001; pořadí faktur: zatím nevydáno |
| Obsah tabulky | 1 přihláška (ověřit, jestli není testovací) |
| Síťová omezení | žádná |
| Kde je adresa zapečená ve webu | `dist/index.html`, `dist/kreativni/index.html`, `dist/varianta-b/index.html` |
