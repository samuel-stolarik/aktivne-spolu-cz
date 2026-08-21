"""
Úprava scénáře v Make: z holého odstavcového mailu udělá pořádný HTML e-mail
se shrnutím registrace a fakturou v příloze.

Proč skriptem a ne ručně: blueprint má 39 kB na jednom řádku a ruční zásah
do JSONu takové velikosti se nedá spolehlivě zkontrolovat očima.

MĚNÍ SE TŘI MODULY:
  3 — načtení přihlášky ze Supabase: doplněné sloupce, ze kterých se skládá
      shrnutí registrace (dosud se tahaly jen fakturační údaje)
  5 — odvozené údaje: čitelný typ pořadatele, český formát data akce
  8 — samotný e-mail
"""

import json
from pathlib import Path

SOUBOR = Path(
    "/Users/samstolarik/Desktop/Trix VSCode/aktivne-spolu-cz/make/fakturace-blueprint.json"
)

# Sloupce, které Make tahá ze Supabase. Bez těch nových by se shrnutí
# registrace nemělo z čeho poskládat.
SLOUPCE = (
    "id,vytvoreno,email,kontaktni_osoba,telefon,typ_poradatele,nazev_poradatele,"
    "mesto,kraj,datum_akce,napad_na_aktivitu,variabilni_symbol,stav,forma_platby,"
    "fakt_nazev,fakt_adresa,fakt_ic,fakt_dic,faktura_cislo,faktura_url"
)

# Barvy jsou opsané z src/styles/global.css. V e-mailu se nedají použít
# proměnné ani odkazovaný styl — každá hodnota musí být přímo v atributu.
TYRKYS = "#12707f"
INKOUST = "#0a3e47"
MERUNKA = "#f0b95e"
MLHA = "#fbf1dc"
PLOCHA = "#edf7f9"
TEXT = "#45443f"
LINKA = "#f7dcae"

# Odvozené údaje navíc do modulu 5.
NOVE_PROMENNE = [
    {
        "name": "typ_poradatele_text",
        "value": '{{switch(3.data.typ_poradatele; "skola"; "Škola nebo školka"; '
        '"organizace"; "Organizace nebo firma"; "jednotlivec"; "Jednotlivec"; '
        "3.data.typ_poradatele)}}",
    },
    {
        "name": "datum_akce_text",
        # Datum akce je nepovinné — když chybí, nesmí v mailu zůstat prázdný
        # řádek ani slovo „null".
        "value": '{{if(length(3.data.datum_akce) > 0; formatDate(parseDate(3.data.datum_akce; "YYYY-MM-DD"); "D.M.YYYY"); "zatím neurčeno")}}',
    },
    {
        "name": "misto_text",
        "value": "{{3.data.mesto}}, {{3.data.kraj}}",
    },
]


def radek(popisek: str, hodnota: str, posledni: bool = False) -> str:
    """Jeden řádek tabulky se shrnutím."""
    ram = "" if posledni else f"border-bottom:1px solid {LINKA};"
    return (
        f'<tr>'
        f'<td style="padding:10px 0;{ram}font-size:14px;line-height:1.5;'
        f'color:#6b6a64;width:42%;vertical-align:top;">{popisek}</td>'
        f'<td style="padding:10px 0;{ram}font-size:15px;line-height:1.5;'
        f'color:{TEXT};font-weight:600;vertical-align:top;">{hodnota}</td>'
        f"</tr>"
    )


def sestav_html() -> str:
    shrnuti = "".join(
        [
            radek("Kdo se hlásí", "{{5.typ_poradatele_text}}"),
            radek("Název", "{{3.data.nazev_poradatele}}"),
            radek("Kontaktní osoba", "{{3.data.kontaktni_osoba}}"),
            radek("E-mail", "{{3.data.email}}"),
            radek("Telefon", "{{3.data.telefon}}"),
            radek("Kde se akce koná", "{{5.misto_text}}"),
            radek("Kdy", "{{5.datum_akce_text}}", posledni=True),
        ]
    )

    platba = "".join(
        [
            radek("Částka", "{{5.castka_text}}"),
            radek("Číslo účtu", "{{2.banka_ucet}}"),
            radek("Variabilní symbol", "{{5.variabilni_symbol}}"),
            radek("Zpráva pro příjemce", "{{2.zprava_pro_prijemce}}"),
            radek("Splatnost", "{{5.datum_splatnosti}}", posledni=True),
        ]
    )

    return f"""<!-- Předmět v náhledu schránky. Skrytý text hned na začátku těla
     je jediný způsob, jak ovlivnit, co se ukáže vedle předmětu ve výpisu
     pošty — jinak si tam schránka vezme první větu i s pozdravem. -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">
  Registrace přijata. Faktura {{{{5.cislo_faktury}}}} je v příloze, splatnost {{{{5.datum_splatnosti}}}}.
</div>

<!-- CELÝ E-MAIL STOJÍ NA TABULKÁCH A STYLECH PSANÝCH PŘÍMO U PRVKŮ.
     Není to zastaralost: poštovní klienti (hlavně Outlook, který sází přes
     Word) neumí flex, grid ani odkazovaný styl. Tabulka a atribut jsou
     jediné, co vysází všude stejně. -->
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
       style="background-color:#f4f1ea;margin:0;padding:24px 12px;">
  <tr>
    <td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600"
             style="max-width:600px;width:100%;background-color:#ffffff;border-radius:14px;overflow:hidden;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">

        <!-- Hlavička -->
        <tr>
          <td style="background-color:{INKOUST};padding:28px 32px;">
            <p style="margin:0;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:{MERUNKA};font-weight:600;">
              Mezinárodní den seniorů
            </p>
            <p style="margin:8px 0 0;font-size:24px;line-height:1.25;color:#ffffff;font-weight:600;">
              Mezigeneračně aktivně spolu
            </p>
          </td>
        </tr>

        <!-- Potvrzení -->
        <tr>
          <td style="padding:32px 32px 8px;">
            <p style="margin:0;font-size:16px;line-height:1.6;color:{TEXT};">
              Dobrý den, {{{{3.data.kontaktni_osoba}}}},
            </p>
            <p style="margin:16px 0 0;font-size:16px;line-height:1.6;color:{TEXT};">
              máme vaši přihlášku a moc si jí vážíme. Níž je shrnutí toho, co jste
              vyplnili, a údaje k zaplacení registračního poplatku.
              <strong style="color:{TYRKYS};">Fakturu {{{{5.cislo_faktury}}}} najdete v příloze</strong>
              tohoto e-mailu.
            </p>
          </td>
        </tr>

        <!-- Shrnutí registrace -->
        <tr>
          <td style="padding:28px 32px 0;">
            <p style="margin:0 0 4px;font-size:12px;letter-spacing:1.6px;text-transform:uppercase;color:{TYRKYS};font-weight:600;">
              Shrnutí registrace
            </p>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              {shrnuti}
            </table>
          </td>
        </tr>

        <!-- Platba -->
        <tr>
          <td style="padding:28px 32px 0;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
                   style="background-color:{PLOCHA};border-radius:12px;">
              <tr>
                <td style="padding:20px 22px;">
                  <p style="margin:0 0 4px;font-size:12px;letter-spacing:1.6px;text-transform:uppercase;color:{TYRKYS};font-weight:600;">
                    Kam poslat platbu
                  </p>
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                    {platba}
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Proč na VS záleží -->
        <tr>
          <td style="padding:20px 32px 0;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
                   style="background-color:{MLHA};border-radius:12px;">
              <tr>
                <td style="padding:16px 20px;font-size:14px;line-height:1.6;color:{TEXT};">
                  <strong>Variabilní symbol prosím nevynechávejte.</strong> Podle něj
                  platbu poznáme a spárujeme s vaší přihláškou. Je to zároveň poslední
                  část čísla faktury {{{{5.cislo_faktury}}}}, takže se nedá splést.
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Platba ze zahraničí -->
        <tr>
          <td style="padding:20px 32px 0;font-size:14px;line-height:1.6;color:#6b6a64;">
            Platíte-li ze zahraničí, použijte IBAN <strong style="color:{TEXT};">{{{{2.banka_iban}}}}</strong>
            a SWIFT <strong style="color:{TEXT};">{{{{2.banka_swift}}}}</strong>.<br>
            {{{{2.veta_neplatce_dph}}}}
          </td>
        </tr>

        <!-- Co bude dál -->
        <tr>
          <td style="padding:28px 32px 0;">
            <p style="margin:0 0 4px;font-size:12px;letter-spacing:1.6px;text-transform:uppercase;color:{TYRKYS};font-weight:600;">
              Co bude dál
            </p>
            <p style="margin:0;font-size:15px;line-height:1.7;color:{TEXT};">
              Uspořádejte své mezigenerační setkání v týdnu kolem 1.&nbsp;10. Po akci
              vám přijde odkaz na krátký formulář — z něj vznikne záznam ve veřejném
              Zásobníku nápadů, ze kterého budou čerpat organizátoři z celé ČR.
            </p>
          </td>
        </tr>

        <!-- Patička -->
        <tr>
          <td style="padding:28px 32px 32px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr><td style="border-top:1px solid {LINKA};padding-top:20px;font-size:14px;line-height:1.7;color:#6b6a64;">
                Kdyby cokoliv, napište na
                <a href="mailto:{{{{2.vystavovatel_email}}}}" style="color:{TYRKYS};font-weight:600;text-decoration:none;">{{{{2.vystavovatel_email}}}}</a>
                nebo zavolejte na {{{{2.vystavovatel_telefon}}}}.<br><br>
                Těšíme se na vaše setkání!<br>
                <strong style="color:{TEXT};">{{{{2.vystavovatel_nazev}}}}</strong><br>
                {{{{2.vystavovatel_web}}}}
              </td></tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>"""


def main() -> None:
    data = json.loads(SOUBOR.read_text(encoding="utf-8"))

    zmeneno = []
    for uzel in data["flow"]:
        if uzel["id"] == 3:
            uzel["mapper"]["url"] = (
                "{{2.supabase_url}}/rest/v1/prihlasky?id=eq.{{1.id}}&select=" + SLOUPCE
            )
            zmeneno.append("3 — načtení přihlášky")

        elif uzel["id"] == 5:
            promenne = uzel["mapper"]["variables"]
            existujici = {p["name"] for p in promenne}
            for nova in NOVE_PROMENNE:
                if nova["name"] not in existujici:
                    promenne.append(nova)
            zmeneno.append("5 — odvozené údaje")

        elif uzel["id"] == 8:
            uzel["mapper"]["html"] = sestav_html()
            uzel["mapper"]["subject"] = (
                "Registrace přijata – faktura {{5.cislo_faktury}} "
                "| Mezigeneračně aktivně spolu"
            )
            zmeneno.append("8 — e-mail")

    SOUBOR.write_text(
        json.dumps(data, ensure_ascii=False, indent=4) + "\n", encoding="utf-8"
    )
    print("upraveno:", ", ".join(zmeneno))
    print("velikost:", SOUBOR.stat().st_size, "B")


main()
