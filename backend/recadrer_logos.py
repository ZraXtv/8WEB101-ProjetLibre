"""Isole le symbole d'un logo en retirant le nom de la marque.

Beaucoup de logos automobiles écrivent le nom à côté ou sous l'emblème, ce qui
rend le quiz trivial. Le script repère la zone « encrée » de l'image, cherche
le couloir vide le plus large, et garde le côté indiqué dans `DECOUPES`.

Une première version décidait toute seule quel bloc garder, en supposant que
le texte est toujours le bloc le plus plat. Elle se trompait : « LANCIA » a été
coupé en deux lettres et le lettrage « NISSAN » réduit à un « N » isolé. Les
consignes sont donc explicites et vérifiées image par image.

    python3 recadrer_logos.py --apercu    # écrit dans data/apercu_recadrage/
    python3 recadrer_logos.py --appliquer

Nécessite Pillow (`pip install Pillow`), utilisé uniquement par cet outil.
"""
import sys
from pathlib import Path

from PIL import Image

DOSSIER_LOGOS = Path(__file__).parent.parent / "assets" / "images" / "logos"
DOSSIER_APERCU = Path(__file__).parent / "data" / "apercu_recadrage"

SEUIL_BLANC = 235          # au-dessus, on considère le pixel comme du fond
SEUIL_ALPHA = 24           # en-dessous, le pixel est transparent
GAP_MINIMAL = 0.015        # largeur minimale d'un couloir vide, en % du contenu
GAP_PLANCHER = 5           # ...et jamais moins que ce nombre de pixels
MARGE = 6                  # marge laissée autour du symbole, en pixels
AIRE_MINIMALE = 0.18       # on refuse de garder un bloc plus petit que ça
PASSES_MAX = 3             # le nom peut tenir sur deux lignes

# Où se trouve le symbole par rapport au texte, marque par marque. Les marques
# absentes de cette table ne sont jamais recadrées.
DECOUPES = {
    "alpine": "haut",        # le A au-dessus de « ALPINE »
    "amc": "haut",
    "aston-martin": "haut",  # les ailes au-dessus du nom
    "chery": "haut",
    "chevrolet": "haut",     # le nœud papillon au-dessus du nom
    "citroen": "haut",       # les chevrons au-dessus de « CITROËN »
    "dacia": "haut",
    "daihatsu": "gauche",
    "de-tomaso": "haut",
    "delorean": "haut",      # « DMC » au-dessus de la raison sociale
    "great-wall": "gauche",
    "honda": "haut",         # le H au-dessus de « HONDA »
    "hyundai": "gauche",     # l'ovale à gauche du nom
    "koenigsegg": "gauche",
    "lada": "haut",
    "maserati": "haut",      # le trident au-dessus du nom
    "maybach": "haut",       # le double M au-dessus de « MAYBACH »
    "mazda": "haut",
    "mitsubishi": "haut",
    "moskvitch": "gauche",
    "nio": "gauche",
    "oldsmobile": "haut",
    "opel": "gauche",
    "perodua": "haut",
    "proton": "gauche",
    "renault": "haut",       # le losange au-dessus de « RENAULT »
    "rimac": "gauche",
    "simca": "haut",
    "skoda": "haut",
    "ssangyong": "gauche",
    "subaru": "haut",
    "suzuki": "haut",
    "tesla": "haut",
    "togg": "gauche",
    "toyota": "gauche",
    "xpeng": "gauche",
    "zastava": "haut",
}

# Quelques blasons n'existent pas en vectoriel sous licence libre : le dessin
# lui-même est protégé, seules des photographies sont librement réutilisables.
# On recadre alors sur la couleur dominante du blason.
RECADRAGE_COULEUR = {
    "ferrari": (252, 209, 22),   # jaune de Modène du Cavallino rampante
}
TOLERANCE_COULEUR = 62


def masque_encre(image):
    """Pour chaque pixel, True s'il porte de l'encre (ni transparent ni blanc)."""
    image = image.convert("RGBA")
    largeur, hauteur = image.size
    pixels = image.load()
    masque = [[False] * largeur for _ in range(hauteur)]

    for y in range(hauteur):
        for x in range(largeur):
            r, v, b, a = pixels[x, y]
            if a < SEUIL_ALPHA:
                continue
            if r > SEUIL_BLANC and v > SEUIL_BLANC and b > SEUIL_BLANC:
                continue
            masque[y][x] = True
    return masque, largeur, hauteur


def bornes(masque, largeur, hauteur):
    xs = [x for x in range(largeur) if any(masque[y][x] for y in range(hauteur))]
    ys = [y for y in range(hauteur) if any(masque[y][x] for x in range(largeur))]
    if not xs or not ys:
        return None
    return xs[0], ys[0], xs[-1] + 1, ys[-1] + 1


def projections(masque, boite, largeur, hauteur):
    x0, y0, x1, y1 = boite
    colonnes = [0] * largeur
    lignes = [0] * hauteur
    for y in range(y0, y1):
        for x in range(x0, x1):
            if masque[y][x]:
                colonnes[x] += 1
                lignes[y] += 1
    return colonnes, lignes


def couloirs(projection, debut, fin, taille_minimale):
    trouves = []
    courant = None
    for i in range(debut, fin):
        if projection[i] == 0:
            courant = i if courant is None else courant
        else:
            if courant is not None and i - courant >= taille_minimale:
                trouves.append((courant, i))
            courant = None
    return trouves


def aire(boite):
    return max(0, boite[2] - boite[0]) * max(0, boite[3] - boite[1])


def une_passe(masque, boite, largeur, hauteur, cote):
    """Coupe au couloir vide le plus large et renvoie le bloc demandé."""
    vertical = cote in ("haut", "bas")
    colonnes, lignes = projections(masque, boite, largeur, hauteur)
    projection = lignes if vertical else colonnes
    debut = boite[1] if vertical else boite[0]
    fin = boite[3] if vertical else boite[2]

    vides = couloirs(projection, debut, fin, max(GAP_PLANCHER, int((fin - debut) * GAP_MINIMAL)))
    if not vides:
        return None

    couloir = max(vides, key=lambda c: c[1] - c[0])
    if vertical:
        premier = (boite[0], boite[1], boite[2], couloir[0])
        second = (boite[0], couloir[1], boite[2], boite[3])
    else:
        premier = (boite[0], boite[1], couloir[0], boite[3])
        second = (couloir[1], boite[1], boite[2], boite[3])

    garde = premier if cote in ("haut", "gauche") else second
    if garde[2] - garde[0] < 8 or garde[3] - garde[1] < 8:
        return None
    return garde


def recadrer_selon_consigne(chemin, cote):
    image = Image.open(chemin)
    masque, largeur, hauteur = masque_encre(image)
    depart = bornes(masque, largeur, hauteur)
    if not depart:
        return None, "image vide"

    boite = depart
    passes = 0
    while passes < PASSES_MAX:
        suivante = une_passe(masque, boite, largeur, hauteur, cote)
        # Garde-fou : si le bloc restant devient minuscule, c'est qu'on est en
        # train de découper le symbole lui-même, pas d'enlever du texte.
        if not suivante or aire(suivante) < aire(depart) * AIRE_MINIMALE:
            break
        boite = suivante
        passes += 1

    if passes == 0:
        return None, "aucun couloir vide exploitable"

    recadre = (max(0, boite[0] - MARGE), max(0, boite[1] - MARGE),
               min(largeur, boite[2] + MARGE), min(hauteur, boite[3] + MARGE))
    part = aire(boite) / aire(depart)
    return image.convert("RGBA").crop(recadre), f"{cote}, {passes} passe(s), {part:.0%} gardé"


def recadrer_sur_couleur(chemin, couleur):
    """Recadre sur la zone occupée par une couleur, avec une marge légère."""
    image = Image.open(chemin).convert("RGB")
    largeur, hauteur = image.size
    pixels = image.load()
    cible_r, cible_v, cible_b = couleur

    # Un simple écart par canal attrape aussi la végétation ensoleillée : on
    # exige en plus un jaune vif et saturé.
    xs, ys = [], []
    for y in range(0, hauteur, 2):
        for x in range(0, largeur, 2):
            r, v, b = pixels[x, y]
            if (abs(r - cible_r) < TOLERANCE_COULEUR
                    and abs(v - cible_v) < TOLERANCE_COULEUR
                    and abs(b - cible_b) < TOLERANCE_COULEUR
                    and abs(r - v) < 55 and b < 120 and r > 190):
                xs.append(x)
                ys.append(y)

    if len(xs) < 40:
        return None, "couleur du blason introuvable"

    # Un seul pixel parasite ailleurs dans la photo étirerait la boîte à
    # travers toute l'image : on borne sur les centiles, pas sur les extrêmes.
    def centile(valeurs, part):
        triees = sorted(valeurs)
        return triees[min(len(triees) - 1, int(len(triees) * part))]

    x_min, x_max = centile(xs, 0.01), centile(xs, 0.99)
    y_min, y_max = centile(ys, 0.01), centile(ys, 0.99)
    marge_x = int((x_max - x_min) * 0.08) + 4
    marge_y = int((y_max - y_min) * 0.08) + 4
    boite = (max(0, x_min - marge_x), max(0, y_min - marge_y),
             min(largeur, x_max + marge_x), min(hauteur, y_max + marge_y))
    return image.crop(boite), f"couleur, {len(xs)} pixels repérés"


def main():
    appliquer = "--appliquer" in sys.argv
    destination = DOSSIER_LOGOS if appliquer else DOSSIER_APERCU
    destination.mkdir(parents=True, exist_ok=True)

    recadres, echecs, intacts = [], [], 0
    for chemin in sorted(DOSSIER_LOGOS.glob("*.png")):
        nom = chemin.stem

        if nom in RECADRAGE_COULEUR:
            image, note = recadrer_sur_couleur(chemin, RECADRAGE_COULEUR[nom])
        elif nom in DECOUPES:
            image, note = recadrer_selon_consigne(chemin, DECOUPES[nom])
        else:
            intacts += 1
            if not appliquer:
                Image.open(chemin).save(destination / chemin.name)
            continue

        if image is None:
            echecs.append((nom, note))
            if not appliquer:
                Image.open(chemin).save(destination / chemin.name)
            continue

        image.save(destination / chemin.name)
        recadres.append((nom, note))

    print(f"  {len(recadres)} recadré(s) :")
    for nom, note in recadres:
        print(f"    {nom:16} {note}")
    if echecs:
        print(f"\n  {len(echecs)} consigne(s) sans effet :")
        for nom, note in echecs:
            print(f"    {nom:16} {note}")
    print(f"\n  {intacts} logo(s) laissé(s) intacts (aucune consigne)")

    if appliquer:
        print(f"\n  Images remplacées dans {DOSSIER_LOGOS}")
    else:
        print(f"\n  Aperçu dans {destination} — rien n'a été modifié.")
        print("  Relancer avec --appliquer pour remplacer les images.")


if __name__ == "__main__":
    main()
