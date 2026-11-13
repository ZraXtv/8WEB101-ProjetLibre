"""Importe des modèles de voitures depuis Wikidata et Wikimedia Commons.

Complète donnees/modeles.json jusqu'à --total modèles, en gardant ceux déjà
présents (leurs leurres ont pu être choisis à la main) :

- les modèles viennent de Wikidata (instances de « modèle d'automobile »
  avec un constructeur et une photo), classés par notoriété : nombre
  d'articles Wikipédia qui leur sont consacrés ;
- la photo est l'image représentative choisie sur Wikidata, hébergée sur
  Commons, donc sous licence libre ; auteur, licence et lien sont gardés pour
  le crédit affiché pendant le jeu ;
- les trois leurres sont des modèles de la même marque, de l'époque la plus
  proche : le logo étant visible sur la photo, une autre marque s'éliminerait
  d'un coup d'œil ;
- la difficulté suit la notoriété (les plus connus sont faciles).

    pip install pillow
    python outils/importer_modeles.py --total 1000     (depuis pocketbase/)

Les réponses de l'API sont gardées dans outils/.cache/ : relancer le script
ne refait pas les mêmes requêtes. Une photo inadaptée (arrière qui montre le
nom du modèle, mauvais véhicule…) se désactive ensuite depuis la page Admin.
"""
import argparse
import hashlib
import io
import json
import re
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image

RACINE = Path(__file__).resolve().parent.parent
FICHIER_MODELES = RACINE / "donnees" / "modeles.json"
DOSSIER_IMAGES = RACINE / "donnees" / "images" / "modeles"
CACHE = Path(__file__).resolve().parent / ".cache"
UA = {"User-Agent": "AutoQuiz/1.0 (projet etudiant 8WEB101)"}

LARGEUR_IMAGE = 640
MIN_ARTICLES = 6

LICENCES_LIBRES = re.compile(r"^(CC BY|CC0|Public domain|PD)", re.I)
# Noms de fichiers qui trahissent une photo inutilisable : arrière (le nom du
# modèle y est souvent écrit), intérieur, détail, maquette…
FICHIERS_EXCLUS = re.compile(
    r"rear|heck|back|arri[eè]re|tr[aá]s|interior|innen|int[eé]rieur|cockpit|dash|"
    r"engine|motor(?!sport)|moteur|badge|logo|emblem|detail|wheel|seat|"
    r"drawing|sketch|zeichnung|lego|toy|spielzeug|scale model|maquette|diecast|"
    r"\.svg|\.gif|\.tif", re.I)
# Véhicules qui ne sont pas des voitures de série reconnaissables sur photo.
NOMS_EXCLUS = re.compile(
    r"concept|prototype|\bF1\b|formula|formule|racing|race car|rally car|\bGT1\b|"
    r"\bLMP|truck|camion|bus\b|autobus|tractor|tracteur|\bvan\b", re.I)
MARQUES_SUPPLEMENTAIRES = [
    "Acura", "Cadillac", "Chrysler", "Cupra", "Datsun", "Fiat", "Ford", "Genesis", "GMC",
    "Infiniti", "Iso", "Jaguar", "Jeep", "Kia", "Lamborghini", "Lancia", "Land Rover", "Lotus",
    "Nissan", "Plymouth", "Pontiac", "Ram", "Saab", "SEAT", "Trabant", "UAZ", "Vauxhall",
    "Willys", "GAZ", "ZAZ", "Wartburg",
]
SUFFIXES_CONSTRUCTEUR = re.compile(
    r"\s+(Motor Company|Motor Corporation|Motors?|Automobiles?|Automobile|Cars|"
    r"Car Company|Company|Corporation|Group|AG|GmbH|S\.p\.A\.|SpA|S\.A\.|SA|Ltd\.?|"
    r"Limited|Inc\.?|plc|Co\.|Werke|Aktiengesellschaft|automobiles)$", re.I)


# ---- Accès aux API, avec cache ----------------------------------------------

def lire_json(url, donnees=None):
    cle = hashlib.sha1((url + json.dumps(donnees or {}, sort_keys=True)).encode()).hexdigest()
    fichier = CACHE / f"{cle}.json"
    if fichier.exists():
        return json.loads(fichier.read_text(encoding="utf-8"))
    corps = urllib.parse.urlencode(donnees).encode() if donnees else None
    for essai in range(8):
        try:
            requete = urllib.request.Request(url, data=corps, headers=UA)
            with urllib.request.urlopen(requete, timeout=120) as reponse:
                resultat = json.load(reponse)
            break
        except Exception as erreur:
            if essai == 7:
                raise
            # Trop de requêtes : on attend le délai demandé par le serveur.
            attente = 5 + essai * 10
            if isinstance(erreur, urllib.error.HTTPError) and erreur.code == 429:
                attente = max(attente, int(erreur.headers.get("Retry-After") or 60))
            print(f"  serveur occupé, nouvel essai dans {attente} s", flush=True)
            time.sleep(attente)
    CACHE.mkdir(exist_ok=True)
    fichier.write_text(json.dumps(resultat), encoding="utf-8")
    time.sleep(1)
    return resultat


def telecharger(url):
    for essai in range(6):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as reponse:
                return reponse.read()
        except urllib.error.HTTPError as erreur:
            if erreur.code != 429 or essai == 5:
                raise
            attente = max(10 + essai * 10, int(erreur.headers.get("Retry-After") or 30))
            print(f"  images : serveur occupé, nouvel essai dans {attente} s", flush=True)
            time.sleep(attente)


def sparql(requete):
    url = "https://query.wikidata.org/sparql"
    return lire_json(url, {"query": requete, "format": "json"})["results"]["bindings"]


def libelles(ids):
    """Libellés français (à défaut anglais) d'entités Wikidata."""
    sortie = {}
    ids = sorted(set(ids))
    for i in range(0, len(ids), 50):
        d = lire_json("https://www.wikidata.org/w/api.php?" + urllib.parse.urlencode({
            "action": "wbgetentities", "ids": "|".join(ids[i:i + 50]), "props": "labels",
            "languages": "fr|en", "format": "json",
        }))
        for qid, entite in d.get("entities", {}).items():
            noms = entite.get("labels", {})
            nom = (noms.get("fr") or noms.get("en") or {}).get("value")
            if nom:
                sortie[qid] = nom
    return sortie


def infos_images(fichiers):
    """Licence, auteur, page et vignette de fichiers Commons."""
    sortie = {}
    fichiers = sorted(set(fichiers))
    for i in range(0, len(fichiers), 50):
        d = lire_json("https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode({
            "action": "query", "titles": "|".join(f"File:{f}" for f in fichiers[i:i + 50]),
            "prop": "imageinfo", "iiprop": "url|size|extmetadata", "iiurlwidth": LARGEUR_IMAGE,
            "iiextmetadatafilter": "LicenseShortName|Artist", "format": "json",
        }))
        normalises = {n["to"]: n["from"] for n in d.get("query", {}).get("normalized", [])}
        for page in d.get("query", {}).get("pages", {}).values():
            if "imageinfo" not in page:
                continue
            ii = page["imageinfo"][0]
            meta = ii.get("extmetadata", {})
            nom = page["title"]
            nom = normalises.get(nom, nom).removeprefix("File:")
            sortie[nom] = {
                "licence": meta.get("LicenseShortName", {}).get("value", ""),
                "auteur": re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", meta.get("Artist", {}).get("value", ""))).strip(),
                "page": ii["descriptionurl"],
                "vignette": ii.get("thumburl") or ii["url"],
                "largeur": ii["width"], "hauteur": ii["height"],
            }
    return sortie


# ---- Noms --------------------------------------------------------------------

def sans_accents(texte):
    return "".join(c for c in unicodedata.normalize("NFD", texte) if unicodedata.category(c) != "Mn")


def cle(texte):
    # « Ford Model T » et « Ford T » désignent la même voiture.
    texte = re.sub(r"\b(model|modele|type)\b", " ", sans_accents(texte).lower())
    return re.sub(r"[^a-z0-9]+", " ", texte).strip()


def compacte(texte):
    # « Citroën 2 CV » et « Citroën 2CV » aussi.
    return cle(texte).replace(" ", "")


def nettoyer_constructeur(nom):
    precedent = None
    while precedent != nom:
        precedent, nom = nom, SUFFIXES_CONSTRUCTEUR.sub("", nom).strip(" ,")
    return nom


def nettoyer_modele(nom):
    # « Ford Mustang (première génération) » -> « Ford Mustang »
    return re.sub(r"\s*\([^)]*\)", "", nom).strip()


def variante(a, b):
    """Vrai si un nom prolonge l'autre (« Golf » / « Golf GTI ») : les deux ne
    peuvent pas être proposés ensemble, la photo irait aux deux."""
    if compacte(a) == compacte(b):
        return True
    a, b = cle(a), cle(b)
    return a == b or a.startswith(b + " ") or b.startswith(a + " ")


def meme_voiture(a, b):
    """Même modèle sous deux noms de marque (« British Mini » / « Austin
    Mini ») : comparé sans le premier mot, pour les noms en lettres."""
    fin_a, fin_b = cle(a).split(" ", 1)[-1], cle(b).split(" ", 1)[-1]
    return fin_a == fin_b and len(fin_a) >= 4 and not any(c.isdigit() for c in fin_a)


def slug(nom):
    return re.sub(r"[^a-z0-9]+", "-", sans_accents(nom).lower()).strip("-")


# ---- Import ------------------------------------------------------------------

def charger_candidats():
    lignes = sparql(f"""
        SELECT ?item ?marque ?image ?debut ?liens WHERE {{
          ?item wdt:P31 wd:Q3231690 ; wdt:P176 ?marque ; wdt:P18 ?image ;
                wikibase:sitelinks ?liens .
          FILTER(?liens >= {MIN_ARTICLES})
          OPTIONAL {{ ?item wdt:P571 ?debut }}
        }}""")
    modeles = {}
    for l in lignes:
        qid = l["item"]["value"].rsplit("/", 1)[-1]
        m = modeles.setdefault(qid, {
            "qid": qid, "liens": int(l["liens"]["value"]), "marques": [], "images": [], "annee": None,
        })
        m["marques"].append(l["marque"]["value"].rsplit("/", 1)[-1])
        m["images"].append(urllib.parse.unquote(l["image"]["value"].rsplit("/", 1)[-1]))
        if "debut" in l:
            annee = re.match(r"-?\d+", l["debut"]["value"])
            if annee:
                m["annee"] = min(int(annee.group()), m["annee"] or 9999)
    print(f"{len(modeles)} modèles sur Wikidata")

    noms = libelles(list(modeles))
    noms_marques = {q: nettoyer_constructeur(n) for q, n in
                    libelles([q for m in modeles.values() for q in m["marques"]]).items()}
    # Vraies marques : celles du quiz des logos et quelques autres. Le
    # constructeur de Wikidata est souvent un groupe (« Groupe BMW »,
    # « Stellantis North America », Toyota pour Lexus) : quand le nom du
    # modèle commence par une vraie marque, c'est elle qui compte.
    logos = json.loads((RACINE / "donnees" / "questions.json").read_text(encoding="utf-8"))
    vraies_marques = {cle(q["reponse"]): q["reponse"] for q in logos} | {
        cle(n): n for n in MARQUES_SUPPLEMENTAIRES}
    vraies_marques = dict(sorted(vraies_marques.items(), key=lambda m: -len(m[0])))

    candidats = []
    for m in modeles.values():
        nom = nom_brut = noms.get(m["qid"])
        if not nom or re.fullmatch(r"Q\d+", nom) or "/" in nom:
            continue
        nom = nettoyer_modele(nom)
        marque = next((noms_marques[q] for q in m["marques"] if q in noms_marques), None)
        if not marque:
            continue
        connue = next((v for k, v in vraies_marques.items() if cle(nom).startswith(k + " ")), None)
        if connue:
            marque = connue
        elif cle(nom).startswith(cle(marque) + " "):
            pass
        elif cle(nom) == cle(marque):
            continue
        else:
            marque = re.sub(r"^(Groupe|Grupo|Gruppo)\s+", "", marque)
            nom = f"{marque} {nom}"
        if len(nom) > 60 or NOMS_EXCLUS.search(nom) or NOMS_EXCLUS.search(nom_brut):
            continue
        candidats.append({**m, "nom": nom, "marque": marque})
    return candidats


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--total", type=int, default=1000)
    total = parser.parse_args().total

    existants = json.loads(FICHIER_MODELES.read_text(encoding="utf-8"))
    candidats = sorted(charger_candidats(), key=lambda m: -m["liens"])

    # Une seule entrée par modèle : la plus connue l'emporte sur ses variantes.
    retenus_pool = []
    for c in candidats:
        if not any(c["marque"] == r["marque"] and variante(c["nom"], r["nom"]) for r in retenus_pool):
            retenus_pool.append(c)
    print(f"{len(retenus_pool)} modèles distincts")

    par_marque = {}
    for c in retenus_pool:
        par_marque.setdefault(c["marque"], []).append(c)

    def leurres_pour(c):
        autres = [a for a in par_marque[c["marque"]] if not variante(a["nom"], c["nom"])]
        autres.sort(key=lambda a: (abs((a["annee"] or 1990) - (c["annee"] or 1990)), -a["liens"]))
        return [a["nom"] for a in autres[:3]]

    images = infos_images([img for c in retenus_pool for img in c["images"]])

    a_ajouter = total - len(existants)
    nouveaux = []
    for c in retenus_pool:
        if len(nouveaux) >= a_ajouter:
            break
        if any(variante(c["nom"], e["reponse"]) or meme_voiture(c["nom"], e["reponse"])
               for e in existants + nouveaux):
            continue
        leurres = leurres_pour(c)
        if len(leurres) < 3:
            continue
        info = next((images[i] for i in c["images"] if i in images
                     and not FICHIERS_EXCLUS.search(i)
                     and LICENCES_LIBRES.match(images[i]["licence"])
                     and images[i]["largeur"] >= 800 and images[i]["largeur"] > images[i]["hauteur"]), None)
        if not info:
            continue

        fichier = DOSSIER_IMAGES / f"{slug(c['nom'])}.jpg"
        if not fichier.exists():
            try:
                image = Image.open(io.BytesIO(telecharger(info["vignette"]))).convert("RGB")
            except Exception as erreur:
                print("  image ignorée :", c["nom"], erreur)
                continue
            if image.width > LARGEUR_IMAGE:
                image = image.resize((LARGEUR_IMAGE, round(image.height * LARGEUR_IMAGE / image.width)))
            image.save(fichier, quality=78, optimize=True)
            time.sleep(0.5)

        nouveaux.append({
            "mode": "modele",
            "reponse": c["nom"],
            "leurres": leurres,
            "fichier": f"modeles/{fichier.name}",
            "liens": c["liens"],
            "licence": info["licence"],
            "auteur": (info["auteur"] or "Auteur inconnu")[:200],
            "source": info["page"],
        })
        if len(nouveaux) % 50 == 0:
            print(f"  {len(nouveaux)} / {a_ajouter}", flush=True)

    # Difficulté selon la notoriété : premier tiers facile, dernier tiers difficile.
    for rang, q in enumerate(nouveaux):
        q["difficulte"] = 1 if rang < len(nouveaux) / 3 else 2 if rang < 2 * len(nouveaux) / 3 else 3
        del q["liens"]

    FICHIER_MODELES.write_text(
        json.dumps(existants + nouveaux, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    # Photos d'un import précédent qui ne servent plus (modèle renommé, écarté).
    utilisees = {Path(q["fichier"]).name for q in existants + nouveaux}
    for image in DOSSIER_IMAGES.glob("*.jpg"):
        if image.name not in utilisees:
            image.unlink()
    print(f"{len(nouveaux)} modèles ajoutés, {len(existants) + len(nouveaux)} au total")


if __name__ == "__main__":
    main()
