"""Isole le symbole d'un logo en retirant le nom de la marque.

Beaucoup de logos automobiles écrivent le nom à côté ou sous l'emblème, ce qui
rend le quiz trivial. Le script repère la zone « encrée » de l'image, cherche
le couloir vide le plus large, et garde le côté indiqué dans `DECOUPES`.

Une première version décidait toute seule quel bloc garder, en supposant que
le texte est toujours le bloc le plus plat. Elle se trompait : « LANCIA » a été
coupé en deux lettres et le lettrage « NISSAN » réduit à un « N » isolé. Les
consignes sont donc explicites et vérifiées image par image.

Quand le nom est dessiné dans le logo lui-même (les lettres du rondel BMW,
« VOLVO » au milieu du cercle), aucun recadrage ne peut l'enlever : il est
alors effacé par les consignes de `MASQUES`.

    python3 recadrer_logos.py --apercu    # écrit dans data/apercu_recadrage/
    python3 recadrer_logos.py --appliquer
    python3 recadrer_logos.py --apercu proton bmw   # seulement ces logos

Les images sont remplacées sur place : limiter `--appliquer` aux logos
modifiés évite de retravailler ceux qui l'ont déjà été.

Nécessite Pillow (`pip install Pillow`), utilisé uniquement par cet outil.
"""
import math
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
    "audi": "haut",          # les anneaux au-dessus de « Audi »
    "buick": "haut",         # le blason au-dessus de « BUICK »
    "aston-martin": "haut",  # les ailes au-dessus du nom
    "chery": "haut",
    "chevrolet": "haut",     # le nœud papillon au-dessus du nom
    "citroen": "haut",       # les chevrons au-dessus de « CITROËN »
    "dacia": "haut",
    "daihatsu": "gauche",
    "de-tomaso": "haut",
    "dodge": "droite",       # le Fratzog à droite de « DODGE »
    "delorean": "haut",      # « DMC » au-dessus de la raison sociale
    "great-wall": "gauche",
    "honda": "haut",         # le H au-dessus de « HONDA »
    "hyundai": "gauche",     # l'ovale à gauche du nom
    "koenigsegg": "gauche",
    "lada": "haut",
    "maybach": "haut",       # le double M au-dessus de « MAYBACH »
    "mitsubishi": "haut",
    "moskvitch": "gauche",
    "nio": "gauche",
    "oldsmobile": "haut",
    "perodua": "haut",
    "proton": "haut",        # le tigre au-dessus de « PROTON »
    "rimac": "gauche",
    "simca": "haut",
    "skoda": "haut",
    "ssangyong": "gauche",
    "subaru": "haut",
    "suzuki": "haut",
    "tesla": "haut",
    "togg": "gauche",
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

# Recadrage à une position fixe, en fractions de l'image, quand le symbole
# touche le texte et qu'aucun couloir vide ne les sépare.
CADRES = {
    "horch": (0.0, 0.36, 1.0, 1.0),      # le bas de la couronne et le H
    "lincoln": (0.0, 0.0, 0.12, 1.0),
    "mclaren": (0.79, 0.0, 1.0, 0.44),   # le speedmark au-dessus du « n »
    "moskvitch": (0.0, 0.0, 0.13, 1.0),  # le trait relie le M au nom
    "opel": (0.105, 0.105, 0.895, 0.70), # le carré jaune, sans le cadre ni « OPEL »
    "renault": (0.0, 0.0, 1.0, 0.875),   # le losange, au-dessus de « RENAULT »
}

FOND = (255, 255, 255, 0)
BLEU_MASERATI = (11, 14, 71, 255)

# Effacement du nom quand il fait partie du dessin. Coordonnées en fractions
# de l'image, mesurées sur une grille et vérifiées sur l'aperçu :
#   ("anneau", cx, cy, r_int, r_ext[, couleur]) repeint toute une couronne
#       (rayons en fraction de la demi-largeur). Sans couleur, chaque angle
#       reprend la teinte sombre de l'anneau à cet endroit, ce qui garde les
#       reflets du rondel BMW ;
#   ("zone", x0, y0, x1, y1[, couleur]) repeint un rectangle. Sans couleur,
#       chaque colonne reçoit un dégradé entre le pixel juste au-dessus et
#       celui juste au-dessous, pour un fond lui-même dégradé (Porsche).
MASQUES = {
    "bmw": [("anneau", 0.5, 0.5, 0.65, 0.95)],
    "alfa-romeo": [("anneau", 0.5, 0.487, 0.44, 0.62)],
    "volvo": [("zone", 0.13, 0.425, 0.87, 0.565)],     # la barre argentée
    "maserati": [("zone", 0.18, 0.635, 0.80, 0.68, BLEU_MASERATI),   # le bandeau bleu,
                 ("zone", 0.20, 0.68, 0.76, 0.73, BLEU_MASERATI)],  # qui se resserre
    "mini": [("anneau", 0.5, 0.5, 0.0, 0.76, FOND)],
    "aston-martin": [("zone", 0.30, 0.19, 0.70, 0.39, FOND)],
    "borgward": [("zone", 0.10, 0.47, 0.90, 0.545, FOND)],
    "porsche": [("zone", 0.20, 0.085, 0.80, 0.205), ("zone", 0.37, 0.36, 0.62, 0.42)],
}
SEUIL_SOMBRE = 0.45        # dans un anneau, clarté sous laquelle un pixel est le fond


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


def clarte(pixel):
    r, v, b, a = pixel
    if a < SEUIL_ALPHA:
        return 1.0
    return (0.299 * r + 0.587 * v + 0.114 * b) / 255


def effacer_anneau(image, pixels, cx, cy, r_int, r_ext, couleur=None):
    largeur, hauteur = image.size
    cx, cy = cx * largeur, cy * hauteur
    demi = min(largeur, hauteur) / 2
    r_int, r_ext = r_int * demi, r_ext * demi

    # Couleur de l'anneau, angle par angle : le fond est souvent dégradé
    # (reflet en haut du rondel BMW), une teinte unique ferait une tache.
    # Seuls les pixels sombres comptent, sinon les lettres éclairciraient
    # leur propre secteur et resteraient visibles en filigrane.
    secteurs = 180
    sommes = [[0, 0, 0, 0, 0] for _ in range(secteurs)]
    couronne = []
    for y in range(int(cy - r_ext), int(cy + r_ext) + 1):
        for x in range(int(cx - r_ext), int(cx + r_ext) + 1):
            if not (0 <= x < largeur and 0 <= y < hauteur):
                continue
            dx, dy = x - cx, y - cy
            if not r_int ** 2 <= dx * dx + dy * dy <= r_ext ** 2:
                continue
            secteur = int((math.atan2(dy, dx) + math.pi) / (2 * math.pi) * secteurs) % secteurs
            couronne.append((x, y, secteur))
            pixel = pixels[x, y]
            if clarte(pixel) < SEUIL_SOMBRE:
                somme = sommes[secteur]
                for i in range(4):
                    somme[i] += pixel[i]
                somme[4] += 1

    for x, y, secteur in couronne:
        if couleur:
            pixels[x, y] = couleur
            continue
        # Un secteur entièrement couvert par une lettre emprunte à ses voisins.
        for ecart in range(secteurs):
            somme = sommes[(secteur + ecart) % secteurs]
            if somme[4]:
                break
        pixels[x, y] = tuple(int(somme[i] / somme[4]) for i in range(4))
    return len(couronne)


def effacer_zone(image, pixels, x0, y0, x1, y1, couleur=None):
    largeur, hauteur = image.size
    x0, x1 = int(x0 * largeur), int(x1 * largeur)
    y0, y1 = int(y0 * hauteur), int(y1 * hauteur)
    haut, bas = max(0, y0 - 1), min(hauteur - 1, y1)
    for x in range(x0, x1):
        dessus, dessous = pixels[x, haut], pixels[x, bas]
        for y in range(y0, y1):
            if couleur:
                pixels[x, y] = couleur
                continue
            t = (y - haut) / max(1, bas - haut)
            pixels[x, y] = tuple(int(dessus[i] + (dessous[i] - dessus[i]) * t) for i in range(4))
    return (x1 - x0) * (y1 - y0)


def masquer(chemin, consignes):
    image = Image.open(chemin).convert("RGBA")
    pixels = image.load()
    touches = 0
    for forme, *valeurs in consignes:
        if forme == "anneau":
            touches += effacer_anneau(image, pixels, *valeurs)
        else:
            touches += effacer_zone(image, pixels, *valeurs)
    if not touches:
        return None, "rien à effacer"
    return image, f"{len(consignes)} masque(s), {touches} pixels repeints"


def recadrer_cadre(chemin, cadre):
    image = Image.open(chemin).convert("RGBA")
    largeur, hauteur = image.size
    x0, y0, x1, y1 = cadre
    return (image.crop((int(x0 * largeur), int(y0 * hauteur),
                        int(x1 * largeur), int(y1 * hauteur))),
            "cadre fixe")


def main():
    appliquer = "--appliquer" in sys.argv
    seulement = {argument for argument in sys.argv[1:] if not argument.startswith("--")}
    destination = DOSSIER_LOGOS if appliquer else DOSSIER_APERCU
    destination.mkdir(parents=True, exist_ok=True)

    recadres, echecs, intacts = [], [], 0
    for chemin in sorted(DOSSIER_LOGOS.glob("*.png")):
        nom = chemin.stem
        if seulement and nom not in seulement:
            continue

        if nom in MASQUES:
            image, note = masquer(chemin, MASQUES[nom])
        elif nom in CADRES:
            image, note = recadrer_cadre(chemin, CADRES[nom])
        elif nom in RECADRAGE_COULEUR:
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
