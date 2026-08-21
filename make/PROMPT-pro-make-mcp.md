# Prompt pro Claude Code s připojeným Make MCP

Zkopíruj všechno pod čarou do Claude Code, kde je připojený Make MCP.

---

## KONTEXT

Stavíme registrační web **aktivne-spolu.cz** pro neziskovku **Právě teď! o.p.s.**
(IČO 29154901, **neplátce DPH**) ve spolupráci se ZŠ Magic Hill. Školy, firemní
týmy, neziskovky a jednotlivci se přihlašují k uspořádání mezigeneračního setkání
v týdnu kolem 1. 10. (Mezinárodní den seniorů) a platí registrační poplatek 500 Kč.

Web je hotový a běží. Přihlášky přijímá Supabase Edge Function `prijmout-prihlasku`,
která zapíše přihlášku do tabulky `prihlasky`, přidělí variabilní symbol, vygeneruje
QR platbu a pošle potvrzovací e-mail. Když člověk zvolí platbu **převodem na fakturu**,
funkce navíc zavolá webhook do Make.

**Tvoje práce je jen ta část v Make: vystavení faktury a odeslání e-mailu.**

Scénář se bude předávat Haně Čepové z Právě teď! o.p.s. Stavíme ho v našem účtu,
ona si ho pak převezme. Proto musí být všechno dohledatelné a popsané, ne nastavené
„od oka".

### Podklady v repozitáři

Repozitář: `~/Desktop/Trix VSCode/aktivne-spolu-cz`

| Soubor | Co v něm je |
| --- | --- |
| `make/fakturace-blueprint.json` | Hotový blueprint scénáře, 12 modulů. **Zdroj pravdy.** |
| `make/README-make.md` | Podrobný návod — přečti si ho celý, než začneš. |
| `supabase/functions/prijmout-prihlasku/index.ts` | Odesílá webhook. Tady je vidět, co přesně přijde. |
| `supabase/migrations/` | Schéma tabulky `prihlasky` a funkce `cislo_faktury_pro_vs`. |

---

## CÍL

1. Dostat scénář do Make tak, aby fungoval.
2. Ověřit ho **testovacím během, který nikomu nepošle ostrou fakturu**.
3. Nechat ho **VYPNUTÝ** a nahlásit mi, co ještě chybí.

---

## CO NESMÍŠ UDĚLAT

Tohle jsou tvrdá pravidla, ne doporučení:

1. **Nezapínej scénář.** Ani na konci, ani „na chvilku na test". Zapnutí je moje
   rozhodnutí a závisí na údaji od účetní, který ještě nemáme (viz níž).
2. **Nevymýšlej si hodnoty, které neznáš.** V modulu 2 je osm položek označených
   `[DOPLNIT: …]`. Když je neznáš, **nech je tak a zeptej se mě.** Vyplněná
   vymyšlená adresa nebo vymyšlená řada faktur je horší než prázdné pole — vypadá
   hotově a odejde s ní ostrá faktura.
3. **Neposílej testovací e-mail na cizí adresu.** Testuj výhradně na adresu, kterou
   ti dám.
4. **Nepřepisuj HTML e-mailu v modulu 8 na „moderní" CSS.** Je poskládaný z tabulek
   se styly psanými přímo u prvků a je to schválně — Outlook sází poštu přes Word,
   neumí flex ani grid a odkazovaný styl zahazuje. Kdo to „uklidí", rozbije to
   jen v Outlooku a nikde jinde si toho nevšimne.
5. **Nevypínej „Evaluate all states as errors"** u Supabase modulů (3, 4, 9, 10, 11)
   ani **„Allow storing incomplete executions"** u scénáře. Bez toho scénář při chybě
   Supabase vesele pokračuje a pošle člověku prázdnou fakturu.
6. **Nesmaž a nezakládej nový scénář, pokud už existuje.** Nejdřív zjisti, jestli
   v účtu je scénář **ID 9650926** (`aktivne-spolu.cz – vystavení faktury za
   registrační poplatek`). Když ano, aktualizuj ten. Když ne, založ nový.

---

## POSTUP

### Krok 1 — Zorientuj se

- Přečti `make/README-make.md` celý.
- Načti `make/fakturace-blueprint.json`.
- Přes Make MCP zjisti, jestli scénář 9650926 existuje a v jakém je stavu.

### Krok 2 — Import / aktualizace scénáře

Naimportuj blueprint. Scénář má **12 modulů** v jedné lineární větvi:

| # | Modul (typ v Make) | Co dělá |
| --- | --- | --- |
| 1 | `gateway:CustomWebHook` | Přijme zprávu z Edge Function. |
| 2 | `util:SetVariables` | Konfigurace — jediné místo, kde se něco edituje. |
| 3 | `http:ActionSendDataAPIKeyAuth` | Supabase REST: načte přihlášku podle `id`. |
| 4 | `http:ActionSendDataAPIKeyAuth` | Supabase RPC `cislo_faktury_pro_vs`: přidělí číslo faktury. |
| 5 | `util:SetVariables` | Odvozené údaje pro fakturu i e-mail. |
| 6 | `google-docs:createADocumentFromTemplate` | Vyplní šablonu faktury. |
| 7 | `google-docs:exportADocument` | Export do PDF. |
| 8 | `google-email:ActionSendEmail` | E-mail přihlašujícímu, kopie účetní, PDF v příloze. |
| 9 | `http:ActionSendDataAPIKeyAuth` | Uloží PDF do bucketu `faktury` (neveřejný). |
| 10 | `http:ActionSendDataAPIKeyAuth` | Vyrobí podepsaný odkaz na PDF. |
| 11 | `http:ActionSendDataAPIKeyAuth` | Zapíše `faktura_cislo` a `faktura_url` k přihlášce. |
| 12 | `google-docs:deleteADocument` | Smaže dočasný dokument z Disku. |

**Dva filtry, které tam MUSÍ zůstat a musí být přesně takhle:**

```
před modulem 2:  {{1.forma_platby}}  text:equal  "prevod"
před modulem 4:  {{3.data.faktura_cislo}}  text:notexist
```

První pustí dál jen platbu převodem (kdo platí QR kódem, fakturu nechce).
Druhý brání tomu, aby se hotová faktura vystavila a poslala podruhé — webhook
se občas doručí dvakrát.

⚠️ **Tohle už jednou bylo rozbité:** filtr testoval `forma_platby` obsahuje
`faktur`. V databázi ale existují jen hodnoty `qr` a `prevod`, takže by se
nespustil nikdy. Zkontroluj to.

### Krok 3 — Připojení

**S blueprintem se připojení nepřenášejí. Nikdy.** Po importu jsou pole
*Connection* prázdná a musíš je vyplnit ručně:

- **Gmail** (modul 8)
- **Google Docs** (moduly 6, 7, 12)
- **Supabase — API Key Auth** (moduly 3, 4, 9, 10, 11)
  - Klíč musí být **`service_role`**, ne `anon`. Tabulka `prihlasky` má zapnuté RLS
    bez jediné politiky, takže `anon` klíč nepřečte vůbec nic. Projeví se to jako
    401 nebo prázdná odpověď v modulu 3.
  - Klíč najdeš v Supabase → Project Settings → API. **Nikam ho nevypisuj** —
    ani do chatu, ani do souboru.

### Krok 4 — Vyplň modul 2

Osm hodnot označených `[DOPLNIT: …]`. **Zeptej se mě na ně, nevymýšlej si je:**

| Proměnná | Co to je |
| --- | --- |
| `odesilatel_email` | Adresa, ze které faktury odcházejí. |
| `kopie_email` | E-mail účetní, kam chodí kopie každé faktury. |
| `vystavovatel_email` | Fakturační e-mail Právě teď! o.p.s. |
| `vystavovatel_telefon` | Telefon kontaktní osoby pro fakturaci. |
| `rada_faktur` | **Dvoumístné číslo řady faktur — přiděluje účetní.** |
| `vystavovatel_rejstrik` | Zápis v rejstříku o.p.s. — soud, oddíl a vložka. |
| `gdocs_sablona_id` | ID šablony faktury v Google Docs. |
| `gdrive_slozka_id` | ID složky na Drive pro dočasné dokumenty. |

Ostatní proměnné (banka, adresa, částka, splatnost) už vyplněné jsou — nesahej na ně.

### Krok 5 — Šablona faktury v Google Docs

Návod, jaká pole má obsahovat, je v `make/README-make.md`, sekce
„Šablona faktury v Google Docs". Pozor na **neplátce DPH** — na faktuře nesmí být
sazba ani rekapitulace DPH, jen věta, že organizace není plátcem.

### Krok 6 — Webhook

**S blueprintem se webhook URL nepřenáší.** Vytvoř v modulu 1 nový webhook
(*Create a webhook*) a **zkopíruj jeho adresu.**

Tu adresu je pak potřeba zapsat do Supabase jako proměnnou `MAKE_WEBHOOK_URL`
a Edge Function nasadit znovu. **Tohle nedělej ty — dej mi tu adresu a udělám to já.**

Pro kontrolu, co webhook dostane — Edge Function posílá tohle:

```json
{
  "id": "uuid přihlášky",
  "forma_platby": "prevod",
  "variabilni_symbol": 100001,
  "splatnost": "2026-08-28",
  "email": "...",
  "kontaktni_osoba": "..."
}
```

⚠️ **Klíčové pole je `id`, ne `prihlaska_id`.** Scénář se na něj musí odkazovat
jako `{{1.id}}`. Tohle už jednou bylo špatně a projevilo se to tak, že modul 3
vrátil 406 nebo prázdno, ale běh doběhl jakoby v pořádku.

### Krok 7 — Test, který nic nespálí

1. Pošli do webhooku ručně testovací zprávu (Make umí *Run once* + poslat data).
   Použij `id` skutečné testovací přihlášky z databáze, ne vymyšlené uuid.
2. Zkontroluj, že:
   - modul 3 vrátil data (ne prázdno, ne 401),
   - modul 4 vrátil číslo faktury ve tvaru `RR/SS/NNNNNN`,
   - PDF vzniklo a vypadá jako faktura,
   - e-mail dorazil a **vypadá jako v náhledu** (shrnutí registrace, platební blok,
     PDF v příloze),
   - PDF leží v bucketu `faktury`,
   - u přihlášky v databázi přibylo `faktura_cislo` a `faktura_url`.

**Testováním se nespálí číslo faktury.** Funkce `cislo_faktury_pro_vs` ho odvozuje
z variabilního symbolu, ne z vlastní sekvence — pro stejný VS vrátí vždycky totéž
číslo. Spotřebuje se jen variabilní symbol testovací přihlášky.

### Krok 8 — Nech to vypnuté a nahlas mi výsledek

Napiš mi:

1. Jestli scénář prošel testem a co přesně jsi ověřil (ne „funguje to", ale co jsi viděl).
2. **Webhook URL** — potřebuju ji, abych ji zapsal do Supabase.
3. Které z osmi hodnot v modulu 2 pořád chybí.
4. Co ti nesedělo nebo co jsi musel proti blueprintu změnit a proč.
5. Screenshot nebo popis, jak dopadl testovací e-mail.

---

## ZNÁMÉ PASTI

| Příznak | Příčina |
| --- | --- |
| V *History* žádný běh | Nepřepsaná `MAKE_WEBHOOK_URL` v Supabase. |
| Běh hned skončí na modulu 2 u platby převodem | Rozbitý filtr (viz krok 2). |
| Modul 3 vrací 406 nebo prázdno | Odkaz na `prihlaska_id` místo `id`. |
| Modul 3 vrací 401 | Použitý `anon` klíč místo `service_role`. |
| Modul 4 vrací 404 | Špatný název funkce nebo parametru. |
| Na faktuře je vidět `[DOPLNIT: …]` | Nevyplněný modul 2. |
| Modul 9 vrací 400 | Bucket `faktury` neexistuje nebo je jinak pojmenovaný. |
| E-mail nedorazil | Nepřipojený Gmail nebo prázdný `odesilatel_email`. |

---

## POZNÁMKA K ŘADĚ FAKTUR

Číslo faktury má tvar `RR/SS/NNNNNN`, kde `SS` je řada od účetní a poslední část
je variabilní symbol té přihlášky. **Dokud nemáme řadu od účetní, nesmí odejít ani
jedna ostrá faktura — přečíslovat je zpětně nejde.**

Řada navíc **nebude souvislá**: variabilní symbol dostane každý hned při registraci,
ale fakturu jen ten, kdo platí převodem. Po lidech, kteří platí QR kódem, zůstanou
v číslech faktur díry. Zákon souvislou řadu nevyžaduje, ale účetní se na to ptá
jako na první věc — je to potřeba jí říct dopředu.
