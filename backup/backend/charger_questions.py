"""Charge en base les questions à partir des images téléchargées.

Lit `sources_images.json` (écrit par les scripts d'import) et crée une
question par image. Relancer le script met à jour les images déjà connues
sans créer de doublon.

    python3 charger_questions.py
"""
import json
from pathlib import Path

from db import get_connection, init_db

DOSSIER_BACKEND = Path(__file__).parent
FICHIER_SOURCES = DOSSIER_BACKEND / "sources_images.json"
RACINE_IMAGES = DOSSIER_BACKEND.parent / "assets" / "images"

# Classement établi image par image après recadrage (recadrer_logos.py retire
# le nom quand il est séparable du symbole). Ce qui reste :
#   - un logo purement textuel se lit : c'est une question facile ;
#   - un logo dont le nom est intégré au dessin (le « BMW » du rondel) donne un
#     indice partiel ;
#   - un symbole nu ne se devine que si on connaît la marque.
LOGOS_TEXTUELS = {
    "Austin", "BYD", "Bugatti", "Buick", "Caterham", "Dodge", "Fiat", "Ford",
    "Geely", "Holden", "Isuzu", "Jeep", "Kia", "Lamborghini", "Lancia",
    "Land Rover", "Lincoln", "NSU", "Nissan", "Opel", "Packard", "Pagani",
    "Proton", "Saab", "Spyker", "TVR", "Tata", "Volvo",
}

LOGOS_TEXTE_INTEGRE = {
    "Auto Union", "BMW", "Bentley", "Borgward", "DKW", "DeLorean", "Horch",
    "MINI", "Moskvitch", "Rolls-Royce",
}


def difficulte_logo(marque):
    if marque in LOGOS_TEXTUELS:
        return 1
    if marque in LOGOS_TEXTE_INTEGRE:
        return 2
    return 3


def charger(connexion_bd, mode, entrees, difficulte):
    dossier = RACINE_IMAGES / f"{mode}s"
    ajoutees = mises_a_jour = ignorees = 0

    for reponse, infos in entrees.items():
        fichier = infos["fichier"]
        if not (dossier / fichier).is_file():
            ignorees += 1
            continue

        niveau = difficulte(reponse) if callable(difficulte) else difficulte
        existante = connexion_bd.execute(
            "SELECT id FROM questions WHERE mode = ? AND fichier = ?", (mode, fichier)
        ).fetchone()

        if existante:
            connexion_bd.execute(
                "UPDATE questions SET reponse = ?, difficulte = ?, licence = ?, "
                "auteur = ?, source = ? WHERE id = ?",
                (reponse, niveau, infos.get("licence", ""), infos.get("auteur", ""),
                 infos.get("source", ""), existante["id"]),
            )
            mises_a_jour += 1
        else:
            connexion_bd.execute(
                "INSERT INTO questions (mode, reponse, fichier, difficulte, licence, auteur, source) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (mode, reponse, fichier, niveau, infos.get("licence", ""),
                 infos.get("auteur", ""), infos.get("source", "")),
            )
            ajoutees += 1

    return ajoutees, mises_a_jour, ignorees


def main():
    init_db()
    if not FICHIER_SOURCES.exists():
        print("Aucun fichier sources_images.json : lancez d'abord importer_logos.py")
        return

    sources = json.loads(FICHIER_SOURCES.read_text(encoding="utf-8"))
    connexion_bd = get_connection()

    # Format historique : un dictionnaire plat de logos.
    if sources and "fichier" in next(iter(sources.values())):
        sources = {"logo": sources}

    total = 0
    for mode, entrees in sources.items():
        difficulte = difficulte_logo if mode == "logo" else 2
        ajoutees, majs, ignorees = charger(connexion_bd, mode, entrees, difficulte)
        total += ajoutees
        print(f"  {mode:8} {ajoutees:3} ajoutées, {majs:3} mises à jour"
              + (f", {ignorees} image(s) manquante(s)" if ignorees else ""))

    connexion_bd.commit()
    restant = connexion_bd.execute(
        "SELECT mode, COUNT(*) n FROM questions WHERE actif = 1 GROUP BY mode"
    ).fetchall()
    connexion_bd.close()

    print("\n  Questions actives en base :")
    for ligne in restant:
        print(f"    {ligne['mode']:8} {ligne['n']}")


if __name__ == "__main__":
    main()
