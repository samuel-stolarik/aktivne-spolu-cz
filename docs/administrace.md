# Administrace webu (`/admin`)

Stránka `/admin/` slouží správci webu ke dvěma věcem:

1. **vidí, kdo se přihlásil** přes registrační formulář, může měnit stav
   přihlášky a stáhnout všechno do tabulky pro Excel,
2. **upravuje texty a obrázky na webu** bez toho, aby web musel někdo znovu
   sestavit a nahrát na hosting — buď klepnutím přímo do náhledu webu, nebo
   v seznamu všech textů.

Odkaz na administraci nikde na webu není a být nesmí. Do adresního řádku se
zadává ručně: `https://aktivne-spolu.cz/admin/`.

---

## Jak se založí první účet

Účty se zakládají **ručně v Supabase**. Samoobslužná registrace je vypnutá,
takže si přístup nikdo nezaloží sám. Postup má dva kroky a oba je potřeba
udělat — samotný účet bez druhého kroku do administrace nepustí.

### Krok 1 — založit účet

1. Otevřít <https://supabase.com/dashboard/project/kourmwqxkhdtahbxyuaq>
2. V levém menu **Authentication → Users**
3. Tlačítko **Add user → Create new user**
4. Vyplnit e-mail a heslo. **Zaškrtnout „Auto Confirm User"** — jinak se účet
   nepřihlásí, dokud si nepotvrdí e-mail, a potvrzovací pošta zatím z projektu
   neodchází.
5. **Create user**

### Krok 2 — pustit účet do administrace

Platný účet ještě neznamená přístup. Musí se dopsat do tabulky `spravci`.

1. V levém menu **SQL Editor → New query**
2. Vložit a spustit (adresu nahradit skutečnou):

```sql
insert into public.spravci (uzivatel, poznamka)
select id, 'správce webu'
from auth.users
where email = 'sem@patri.adresa';
```

3. Ověřit, že se řádek opravdu přidal:

```sql
select s.uzivatel, u.email, s.poznamka, s.pridano
from public.spravci s
join auth.users u on u.id = s.uzivatel;
```

Hotovo. Účet se teď přihlásí na `/admin/`.

### Odebrání přístupu

```sql
delete from public.spravci
where uzivatel = (select id from auth.users where email = 'sem@patri.adresa');
```

Účet zůstane existovat, ale do administrace se nedostane. Když má zmizet
úplně, smaže se v **Authentication → Users** — řádek v `spravci` odejde s ním.

---

## Jak funguje úprava textů

Tohle je jediné místo v projektu, které stojí za to pochopit celé, protože
je postavené kolem jednoho omezení: **web je statický a nemá kdo ho po změně
textu znovu sestavit.**

1. V HTML zůstávají **původní texty** — přesně tak, jak je napsal autor.
2. Správce v administraci uloží nové znění do tabulky `obsah` v databázi.
   Ukládají se **jen změněné** texty, ostatní v tabulce nejsou vůbec.
3. Každá stránka webu si při načtení vyzvedne uložené přepisy a doplní je
   do už vykresleného HTML. Vyměňuje jen to, co se opravdu liší.

Z toho plyne to nejdůležitější:

> **Když databáze nejede, web vypadá úplně normálně.**
> Zobrazí se původní texty a návštěvník nepozná, že se něco nenačetlo.

Přepis se s místem na stránce páruje **podle původního textu**, ne podle
značek v HTML. Seznam všeho upravitelného je v `src/lib/obsah.ts` a u každé
položky je napsané, kde na webu je a jaké je její původní znění.

### Dva způsoby, jak text upravit

V záložce **Texty a obrázky na webu** se přepíná mezi dvěma způsoby. Oba
zapisují do stejné tabulky, takže co se uloží v jednom, je hned vidět
i v druhém.

**Klepnutím v náhledu webu** (výchozí). V administraci se ukáže skutečný web,
upravitelné texty jsou v něm vyznačené a klepnutím na text se rovnou otevře
kartička s polem. Co se do pole píše, je hned vidět v náhledu; dokud se
neuloží, je u toho napsané „Rozepsáno — zatím neuloženo".

**V seznamu všech textů.** Políčka pod sebou, u každého popis, kde na webu je.
Zůstává tu proto, že klepnout nejde na všechno: na text, který se ukáže jen
v některém stavu formuláře, na obrázek použitý jinde než na hlavní stránce
a vůbec na cokoli, co se v náhledu nepodaří najít. Co se v náhledu nenašlo,
administrace vypíše jménem a nabídne odskok do seznamu.

Ke dni psaní jde klepnutím upravit **všech 65 položek katalogu** (65 položek
na 69 místech — logo a hlavní tlačítko jsou na stránce dvakrát).

### Jak je klikací náhled udělaný

Web se ukazuje ve vloženém rámu (`iframe`). Rám i administrace jsou na stejné
adrese, takže administrace vidí do dokumentu náhledu a pracuje s ním rovnou —
bez posílání zpráv mezi okny.

> **Do veřejných stránek se kvůli tomu nepřidal ani řádek.**
> Vyznačení textů, obsluha klepnutí i styly vzniknou až v prohlížeči správce.
> V souborech, které jdou na hosting, po editační vrstvě není ani stopa.

Hledání textu na stránce dělá tentýž kód jako na webu (`src/lib/obsah.ts`),
jen nad dokumentem rámu — proto mají jeho funkce nepovinný parametr `kde`.
Kdyby si náhled párování dělal po svém, upravovalo by se v něm něco jiného,
než co se pak objeví návštěvníkovi.

Náhled je **jen na ukázku**: klepnutí uvnitř rámu se zastavuje, takže z něj
nejde odeslat přihlášku ani odejít na jinou stránku. Rám má k tomu ještě
`sandbox` bez `allow-forms`, takže odeslání formuláře zakazuje i sám prohlížeč.

### Pozor při změně textů v kódu

Když někdo změní text přímo v HTML (v `.astro` souborech), musí stejně změnit
i `vychozi` v `src/lib/obsah.ts`. Jinak by se přepis přestal používat —
potichu. Správce by v administraci uložil nový text a na webu by se nic
nestalo.

Hlídá to kontrola:

```bash
npm run build
npm run kontrola-obsahu
```

Projde sestavený web a vypíše každou položku, jejíž původní znění už na
stránkách není. Vyplatí se ji pustit před každým nahráním webu na hosting.

---

## Obrázky

Nahrávají se do bucketu `obsah-obrazky` v Supabase Storage. Ten je veřejný
pro čtení, protože obrázky se musí zobrazit návštěvníkům webu. Nic osobního
v nich není.

Se dvěma existujícími buckety se schválně nemíchá:

- `qr` — obrázky QR plateb,
- `faktury` — vystavené faktury, **neveřejné**, jsou na nich adresy plátců.

Do úložiště smí zapisovat jenom servisní klíč. Prohlížeč správce dostane od
Edge Funkce jednorázovou podepsanou adresu s platností dvou minut a nahraje
soubor na ni. Servisní klíč se do prohlížeče nedostane nikdy.

---

## Zabezpečení v kostce

| Kdo                             | `prihlasky` | `obsah`     | `spravci` |
| ------------------------------- | ----------- | ----------- | --------- |
| Nepřihlášený návštěvník (`anon`)| nic         | jen čtení   | nic       |
| Přihlášený účet mimo `spravci`  | nic         | jen čtení   | nic       |
| Správce (přes Edge Funkci)      | čtení, stav | čtení, zápis| —         |

- Tabulka `prihlasky` je zamčená úplně: zapnuté a vynucené RLS, žádná policy,
  odebraná všechna oprávnění. Ani přihlášený správce ji nepřečte přímo —
  dostane „permission denied".
- Data vydává výhradně Edge Funkce `admin-obsah`. Ta si ověří podepsaný
  přihlašovací token **a k tomu** záznam v tabulce `spravci`.
- Tabulka `obsah` je čitelná veřejně, protože jsou v ní texty, které jsou
  stejně vidět na stránce. Zapisovat do ní zvenčí nejde vůbec.
- V prohlížeči je jen veřejný (anonymní) klíč. Servisní klíč žije pouze jako
  tajemství Edge Funkce na serveru.

Podrobné zdůvodnění je v komentářích v migraci
`supabase/migrations/20260812160000_administrace.sql`.

---

## Nasazení změn

```bash
# databáze (tabulky, oprávnění, bucket)
npx supabase db push --linked

# Edge Funkce administrace
npx supabase functions deploy admin-obsah --project-ref kourmwqxkhdtahbxyuaq

# web včetně stránky /admin/
npm run build
npm run kontrola-obsahu
npm run zip          # vznikne dist.zip k nahrání na FTP
```

Stránka `/admin/` je součástí běžného buildu — na hosting jde spolu se
zbytkem webu jako složka `admin/`.
