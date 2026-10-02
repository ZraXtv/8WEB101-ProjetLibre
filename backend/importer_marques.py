"""Télécharge les logos de constructeurs automobiles depuis Wikimedia Commons.

Les noms de fichiers viennent de Wikidata (propriété P154, « logo »), ce qui
évite de les deviner : chercher « Ferrari logo » sur Commons renvoie aussi
bien le parc d'attractions Ferrari World que le vrai logo.

La liste ci-dessous est curée à la main à partir des constructeurs les plus
liés sur Wikidata : on écarte les motos, les poids lourds, les holdings
(Stellantis, General Motors) et les écuries de course, qui ne sont pas des
marques de voitures reconnaissables par un joueur.

    python3 importer_marques.py
    python3 importer_marques.py Mazda Opel   # seulement ces marques

Un logo retéléchargé remplace l'image recadrée : limiter l'import aux marques
modifiées, puis relancer recadrer_logos.py sur ces seules marques.
"""
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

DOSSIER = Path(__file__).parent.parent / "assets" / "images" / "logos"
FICHIER_SOURCES = Path(__file__).parent / "sources_images.json"
ENTETE = {"User-Agent": "ProjetEtudiantUQAC/1.0 (cours 8WEB101; usage pedagogique)"}
LARGEUR = 480

# étiquette Wikidata -> nom affiché dans le jeu
MARQUES = {
    # déjà présentes, conservées pour que le script reste la source unique
    "Toyota": "Toyota", "Volkswagen": "Volkswagen", "Audi": "Audi",
    "Ford": "Ford", "Renault": "Renault", "Honda": "Honda", "Nissan": "Nissan",
    "Fiat": "Fiat", "Kia": "Kia", "Citroën": "Citroën", "Hyundai": "Hyundai",
    "Jeep": "Jeep", "Mitsubishi": "Mitsubishi", "Subaru": "Subaru",
    "BMW": "BMW", "Mercedes-Benz": "Mercedes-Benz", "MINI": "MINI",
    "Tesla": "Tesla", "Bugatti": "Bugatti", "Suzuki": "Suzuki",

    # grandes marques européennes
    "Ferrari": "Ferrari", "Porsche": "Porsche", "Opel": "Opel",
    "Lamborghini": "Lamborghini", "Škoda": "Škoda", "Alfa Romeo": "Alfa Romeo",
    "Volvo Cars": "Volvo", "Aston Martin": "Aston Martin",
    "Land Rover": "Land Rover", "Rolls-Royce Motor Cars": "Rolls-Royce",
    "Maserati": "Maserati", "Lancia": "Lancia", "SEAT": "SEAT",
    "Dacia": "Dacia", "Saab": "Saab", "Alpine": "Alpine",
    "Pagani": "Pagani", "McLaren": "McLaren", "Lotus Cars": "Lotus",
    "Koenigsegg": "Koenigsegg", "Vauxhall": "Vauxhall", "Maybach": "Maybach",
    "DS Automobiles": "DS Automobiles", "Polestar": "Polestar",
    "Rimac Automobili": "Rimac", "Spyker Cars": "Spyker", "TVR": "TVR",
    "Caterham": "Caterham", "De Tomaso": "De Tomaso", "Morgan Motor Company": "Morgan",
    "Bentley": "Bentley",

    # marques nord-américaines
    "Chevrolet": "Chevrolet", "Cadillac": "Cadillac", "Dodge": "Dodge",
    "Buick": "Buick", "Lincoln": "Lincoln", "Oldsmobile": "Oldsmobile",
    "Studebaker": "Studebaker", "Automobiles Packard": "Packard",
    "DeLorean Motor Company": "DeLorean",
    "American Motors Corporation": "AMC",

    # marques asiatiques
    "Mazda": "Mazda", "Lexus": "Lexus", "Daihatsu": "Daihatsu",
    "Isuzu": "Isuzu", "Ssangyong": "SsangYong", "Tata": "Tata",
    "Mahindra & Mahindra": "Mahindra", "Proton": "Proton",
    "Perodua": "Perodua", "BYD": "BYD", "Geely": "Geely",
    "Chery": "Chery", "Great Wall": "Great Wall", "XPeng": "XPeng",
    "Nio": "Nio", "Changan Automobile": "Changan", "Holden": "Holden",

    # Europe de l'Est et Moyen-Orient
    "AvtoVAZ": "Lada", "Moskvitch": "Moskvitch",
    "Ulyanovsky Avtomobilny Zavod": "UAZ", "ZAZ": "ZAZ",
    "Zastava Automobiles": "Zastava", "Iran Khodro": "Iran Khodro",
    "Togg": "Togg",

    # marques historiques
    "Simca": "Simca", "Talbot": "Talbot", "Autobianchi": "Autobianchi",
    "NSU": "NSU", "DKW": "DKW", "Horch": "Horch", "Borgward": "Borgward",
    "Auto Union": "Auto Union", "Hanomag": "Hanomag", "Austin (automobile)": "Austin",
    "Morris": "Morris",
}

# Wikidata référence parfois un logo moins utilisable que ce qu'on trouve sur
# Commons : celui d'un groupe plutôt que de la marque, ou une variante avec le
# nom écrit alors qu'une version symbole existe.
REMPLACEMENTS = {
    "BMW": "File:BMW.svg",                          # idem, « BMW Group »
    "Mercedes-Benz": "File:Mercedes-Logo.svg",      # idem, « Mercedes-Benz Group »
    "MINI": "File:MINI logo.svg",
    "Tesla": "File:Tesla Motors.svg",
    "Bugatti": "File:Bugatti logo.svg",
    "Suzuki": "File:Suzuki Motor Corporation logo.svg",

    # Wikidata donne le logo d'entreprise courant, qui est souvent un lettrage
    # alors que la marque est connue pour son blason. Un quiz doit montrer le
    # blason.
    "Ferrari": "File:Ferrari-Cavalino-rampante-Saint-Briac-sur-Mer-byRundvald.jpg",
    "Maybach": "File:Maybach Manufaktur logo.svg",       # le double M
    "Aston Martin": "File:Aston Martin 1935.svg",        # les ailes
    "Bentley": "File:Bentley.svg",                       # le B ailé
    "Honda": "File:Honda.svg",                            # le H, pas le lettrage
    "BYD": "File:BYD Auto Logo.svg",                     # l'ovale, reconnaissable

    # Wikidata donne souvent la version monochrome (« flat ») du logo, alors
    # que le joueur connaît la version en couleur qu'il voit sur les voitures.
    "Audi": "File:Audi Logo 1995.svg",                  # anneaux chromés
    "Chevrolet": "File:Chevrolet-logo.png",              # nœud papillon doré
    "Citroën": "File:Citroen-logo-2009.png",             # chevrons argentés
    "DS Automobiles": "File:DS Logo.jpg",                # monogramme chromé
    "Lexus": "File:LexusLogoDileo.png",
    "Maserati": "File:Maserati - logo.jpg",              # trident rouge, ovale bleu
    "Mazda": "File:Mazda-Logo.png",
    "McLaren": "File:McLaren 2018 logo.svg",             # speedmark orange
    "Opel": "File:Opel Logo 1987.svg",                   # éclair sur fond jaune
    "Renault": "File:Renault Logo 1982.svg",             # losange sur fond jaune
    "Toyota": "File:Toyota Symbol.svg",                 # emblème rouge
    "Volvo": "File:Volvo Trucks & Bus logo.jpg",         # même emblème que les voitures
    "Zastava": "File:Logo de l'entreprise automobile Zastava.jpg",
}

# Écartées après vérification visuelle : ce sont des photos de calandre ou de
# badge sur une carrosserie, pas des logos exploitables dans un quiz, ou bien
# l'image mélange deux marques.
REFUSEES = {
    "Cadillac": "photo d'une calandre",
    "Morris": "photo d'un badge sur la carrosserie",
    "Vauxhall": "photo d'une enseigne lumineuse",
    "Lotus": "photo d'un badge sur fond gris",
    "Mahindra": "logo d'une sous-marque, illisible",
    "SEAT": "l'image contient les logos SEAT et Cupra",
}

FICHIER_LISTE = Path(__file__).parent / "data" / "marques_wikidata.json"

REQUETE_SPARQL = """
SELECT ?marque ?marqueLabel ?logo (COUNT(DISTINCT ?lien) AS ?notoriete) WHERE {
  ?marque wdt:P31/wdt:P279* wd:Q786820 .
  ?marque wdt:P154 ?logo .
  ?lien schema:about ?marque .
  SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,en". }
}
GROUP BY ?marque ?marqueLabel ?logo
ORDER BY DESC(?notoriete)
LIMIT 300
"""


def appeler(url, essais=4):
    for tentative in range(essais):
        try:
            requete = urllib.request.Request(url, headers=ENTETE)
            return urllib.request.urlopen(requete, timeout=60)
        except urllib.error.HTTPError as erreur:
            if erreur.code == 429:
                time.sleep(5 * (tentative + 1))
                continue
            raise
    raise RuntimeError(f"échec après {essais} tentatives : {url}")


def recuperer_liste():
    """Interroge Wikidata, ou réutilise la réponse déjà enregistrée."""
    if FICHIER_LISTE.exists():
        return json.loads(FICHIER_LISTE.read_text(encoding="utf-8"))

    url = "https://query.wikidata.org/sparql?" + urllib.parse.urlencode(
        {"query": REQUETE_SPARQL, "format": "json"})
    donnees = json.load(appeler(url))

    liste = {}
    for ligne in donnees["results"]["bindings"]:
        etiquette = ligne["marqueLabel"]["value"]
        fichier = urllib.parse.unquote(ligne["logo"]["value"].rsplit("/", 1)[-1])
        # on garde le premier logo rencontré : la requête est triée par notoriété
        liste.setdefault(etiquette, fichier)

    FICHIER_LISTE.parent.mkdir(exist_ok=True)
    FICHIER_LISTE.write_text(json.dumps(liste, indent=1, ensure_ascii=False), encoding="utf-8")
    return liste


def licence_libre(nom):
    minuscule = (nom or "").lower()
    return "public domain" in minuscule or minuscule.startswith("cc")


def nettoyer_html(valeur):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", valeur or "")).strip()


def nom_fichier_pour(marque):
    base = marque.lower()
    for accentue, simple in [("é", "e"), ("è", "e"), ("ë", "e"), ("ô", "o"),
                             ("ö", "o"), ("š", "s"), ("ç", "c"), ("à", "a")]:
        base = base.replace(accentue, simple)
    return re.sub(r"[^a-z0-9]+", "-", base).strip("-") + ".png"


def main():
    DOSSIER.mkdir(parents=True, exist_ok=True)
    liste = recuperer_liste()

    seulement = set(sys.argv[1:])
    voulues = {}
    absentes = []
    for etiquette, affichage in MARQUES.items():
        if affichage in REFUSEES or (seulement and affichage not in seulement):
            continue
        if affichage in REMPLACEMENTS:
            voulues[affichage] = REMPLACEMENTS[affichage]
        elif etiquette in liste:
            voulues[affichage] = f"File:{liste[etiquette]}"
        else:
            absentes.append(affichage)

    print(f"  {len(voulues)} marques retenues"
          + (f", {len(REFUSEES)} écartées après contrôle visuel" if REFUSEES else "")
          + (f", {len(absentes)} absentes de Wikidata : {', '.join(absentes)}" if absentes else ""))

    # licences et URL, par lots de 20
    titres = list(voulues.values())
    details = {}
    for debut in range(0, len(titres), 20):
        url = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode({
            "action": "query", "format": "json", "prop": "imageinfo",
            "iiprop": "url|extmetadata", "iiurlwidth": str(LARGEUR),
            "titles": "|".join(titres[debut:debut + 20]),
        })
        pages = json.load(appeler(url)).get("query", {}).get("pages", {})
        for page in pages.values():
            if page.get("imageinfo"):
                details[page["title"]] = page["imageinfo"][0]
        time.sleep(1.2)

    sources = {}
    if FICHIER_SOURCES.exists():
        sources = json.loads(FICHIER_SOURCES.read_text(encoding="utf-8"))
        if sources and "fichier" in next(iter(sources.values())):
            sources = {"logo": sources}
    sources.setdefault("logo", {})

    ajoutes, refuses = 0, []
    for marque, titre in voulues.items():
        infos = details.get(titre)
        if not infos:
            refuses.append((marque, "fichier introuvable"))
            continue

        meta = infos.get("extmetadata", {})
        licence = meta.get("LicenseShortName", {}).get("value", "")
        if not licence_libre(licence):
            refuses.append((marque, f"licence {licence or 'inconnue'}"))
            continue

        nom_fichier = nom_fichier_pour(marque)
        try:
            contenu = appeler(infos["thumburl"]).read()
        except Exception as erreur:
            refuses.append((marque, f"téléchargement impossible ({erreur})"))
            continue

        (DOSSIER / nom_fichier).write_bytes(contenu)
        sources["logo"][marque] = {
            "fichier": nom_fichier,
            "licence": licence,
            "auteur": nettoyer_html(meta.get("Artist", {}).get("value", "")) or "inconnu",
            "source": infos.get("descriptionurl", ""),
        }
        ajoutes += 1
        time.sleep(0.4)

    FICHIER_SOURCES.write_text(
        json.dumps(sources, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"\n  {ajoutes} logos téléchargés, {len(sources['logo'])} marques au total")
    if refuses:
        print(f"\n  Écartés ({len(refuses)}) :")
        for marque, raison in refuses:
            print(f"    {marque:18} {raison}")


if __name__ == "__main__":
    main()
