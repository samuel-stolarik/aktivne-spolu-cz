"""
Rozřezání dodané předlohy na čtyři kresby pro úvodní obrazovku.

Předloha je jeden obrázek 1408x768 se čtyřmi scénami v mřížce 2x2, nakreslený
černou linkou na papírovém podkladu. Na web potřebujeme čtyři samostatné
soubory s PRŮHLEDNÝM pozadím, aby seděly na jakoukoli plochu.

DVĚ VĚCI, KTERÉ SE TU ŘEŠÍ A NEJSOU SAMOZŘEJMÉ:

1. PAPÍR MUSÍ ZMIZET ÚPLNĚ. Podklad není čistě bílý, má texturu. Když se
   odbarví jen to nejsvětlejší, zůstane po něm našedlý čtverec a vypadá to
   jako špína — přesně to už jednou zadavatel vytkl. Práh je proto vysoko
   (165) a mezi ním a plnou černou je plynulý přechod, aby linka neměla
   zubaté okraje.

2. VŠECHNY ČTYŘI MUSÍ MÍT STEJNÝ ROZMĚR. Na úvodní obrazovce se střídají
   v jednom místě; kdyby měla každá jiný poměr stran, stránka by při každé
   výměně poskočila. Kresby se proto nejdřív oříznou natěsno k lince a pak
   se vloží doprostřed společného plátna, jehož velikost určí ta největší
   z nich. Vodorovně na střed, svisle ke spodní hraně — postavy tak stojí
   na společné čáře a nepoletují nahoru a dolů.
"""

import subprocess
import sys
from pathlib import Path

from PIL import Image

PREDLOHA = Path(sys.argv[1])
KAM = Path(sys.argv[2])

# Pořadí odpovídá mřížce 2x2: vlevo nahoře, vpravo nahoře, vlevo dole, …
NAZVY = [
    "kresba-babicka-darek",
    "kresba-babicka-kytice",
    "kresba-babicka-kvetina",
    "kresba-babicka-s-detmi",
]

PRAH_PAPIR = 165   # světlejší než tohle je papír → úplně průhledné
PRAH_INKOUST = 90  # tmavší než tohle je linka → úplně neprůhledné
OKRAJ = 14         # průhledný lem, aby se tah neořízl

# ZVĚTŠOVAT SE NEVYPLATÍ, i když je předloha na úvodní obrazovku spíš malá
# (jedna scéna je ve výřezu 704x384). V předloze je průhlednost skoro
# dvouhodnotová — buď papír, nebo tah — a taková se komprimuje skvěle.
# Jakékoli přepočítání z ní udělá plynulý přechod podél každé linky a soubor
# nabobtná: naměřeno 10 kB při původní velikosti, 87 kB při 1,4x a 158 kB
# při dvojnásobku. Za to se nekupuje žádný detail navíc — ten v předloze
# prostě není, jen by se hladily hrany. Ostřejší kresby se dosáhne jedině
# tím, že se předloha vygeneruje větší.
ZVETSENI = 1

# Barva tahu. Tmavá, ale ne úplně černá — sedne to k tyrkysové a meruňkové
# na zbytku stránky líp než plná čerň.
INKOUST = (32, 38, 40)


def bez_pozadi(vyrez: Image.Image) -> Image.Image:
    """Papír na průhledno, linka zůstane. Mezi prahy plynulý přechod."""
    seda = vyrez.convert("L")
    rozsah = PRAH_PAPIR - PRAH_INKOUST

    def kryti(jas: int) -> int:
        if jas >= PRAH_PAPIR:
            return 0
        if jas <= PRAH_INKOUST:
            return 255
        return round((PRAH_PAPIR - jas) / rozsah * 255)

    alfa = seda.point([kryti(j) for j in range(256)])

    # Linka dostane JEDNU plnou barvu a všechny přechody nese průhlednost.
    # Předloha je černá kresba, takže se tím nic neztrácí — odstíny v ní jsou
    # jen vyhlazené okraje tahu, a ty umí alfa sama. Zato se tím z barevných
    # kanálů stane jednolitá plocha, která se komprimuje skoro na nic:
    # se zachovanou barvou z předlohy měly soubory 95 až 193 kB, takhle
    # zlomek. Na úvodní obrazovce se střídají čtyři, takže na velikosti
    # opravdu záleží.
    ven = Image.new("RGB", vyrez.size, INKOUST)
    ven.putalpha(alfa)
    return ven


def orizni_k_lince(obraz: Image.Image) -> Image.Image:
    """Odřízne prázdno kolem kresby. Rozhoduje alfa, ne barva."""
    ram = obraz.split()[3].getbbox()
    return obraz.crop(ram) if ram else obraz


def main() -> None:
    predloha = Image.open(PREDLOHA)
    sirka, vyska = predloha.size
    pul_s, pul_v = sirka // 2, vyska // 2

    kresby = []
    for poradi, nazev in enumerate(NAZVY):
        sloupec, radek = poradi % 2, poradi // 2
        vyrez = predloha.crop(
            (sloupec * pul_s, radek * pul_v, (sloupec + 1) * pul_s, (radek + 1) * pul_v)
        )
        kresby.append((nazev, orizni_k_lince(bez_pozadi(vyrez))))

    # Společné plátno podle té největší kresby (viz bod 2 v hlavičce).
    platno_s = max(k.width for _, k in kresby) + 2 * OKRAJ
    platno_v = max(k.height for _, k in kresby) + 2 * OKRAJ
    print(f"společné plátno: {platno_s}x{platno_v}")

    KAM.mkdir(parents=True, exist_ok=True)
    for nazev, kresba in kresby:
        plocha = Image.new("RGBA", (platno_s, platno_v), (0, 0, 0, 0))
        plocha.paste(
            kresba,
            ((platno_s - kresba.width) // 2, platno_v - OKRAJ - kresba.height),
        )

        if ZVETSENI != 1:
            plocha = plocha.resize(
                (platno_s * ZVETSENI, platno_v * ZVETSENI), Image.LANCZOS
            )

        png = KAM / f"{nazev}.png"
        plocha.save(png)
        subprocess.run(
            ["cwebp", "-quiet", "-lossless", "-m", "6", str(png),
             "-o", str(KAM / f"{nazev}.webp")],
            check=True,
        )
        png.unlink()
        velikost = (KAM / f"{nazev}.webp").stat().st_size
        print(f"  {nazev}.webp  {velikost // 1024} kB  (kresba {kresba.width}x{kresba.height})")


main()
