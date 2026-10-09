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

# Logos qui *sont* le nom de la marque : aucun recadrage ni masque ne peut
# l'enlever (recadrer_logos.py traite ceux où le nom est séparable ou peut être
# effacé). Les afficher donnerait la réponse : ils sont retirés du quiz.
LOGOS_TEXTUELS = {
    "Austin", "Auto Union", "BYD", "Bugatti", "Caterham", "DKW", "Fiat", "Ford",
    "Geely", "Holden", "Isuzu", "Jeep", "Kia", "Lamborghini", "Lancia",
    "Land Rover", "NSU", "Nissan", "Packard", "Pagani", "Saab", "Spyker",
    "TVR", "Tata",
}

# Plus aucun logo ne montre le nom : la difficulté dépend seulement de la
# notoriété du symbole.
LOGOS_CONNUS = {
    "Audi", "BMW", "Chevrolet", "Citroën", "Ferrari", "Honda", "Hyundai",
    "MINI", "Mazda", "Mercedes-Benz", "Mitsubishi", "Opel", "Porsche",
    "Renault", "Subaru", "Suzuki", "Tesla", "Toyota", "Volkswagen", "Volvo",
}

LOGOS_ASSEZ_CONNUS = {
    "Alfa Romeo", "Alpine", "Aston Martin", "Bentley", "Buick", "DS Automobiles",
    "Dacia", "Dodge", "Koenigsegg", "Lada", "Lexus", "Lincoln", "Maserati",
    "McLaren", "Polestar", "Rolls-Royce", "Škoda",
}


def difficulte_logo(marque):
    if marque in LOGOS_CONNUS:
        return 1
    if marque in LOGOS_ASSEZ_CONNUS:
        return 2
    return 3


def charger(connexion_bd, mode, entrees, difficulte):
    dossier = RACINE_IMAGES / f"{mode}s"
    ajoutees = mises_a_jour = ignorees = retirees = 0

    for reponse, infos in entrees.items():
        fichier = infos["fichier"]
        if mode == "logo" and reponse in LOGOS_TEXTUELS:
            # Une base chargée avant ce tri contient encore la question.
            connexion_bd.execute(
                "UPDATE questions SET actif = 0 WHERE mode = ? AND fichier = ?", (mode, fichier)
            )
            retirees += 1
            continue

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

    return ajoutees, mises_a_jour, ignorees, retirees


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
        ajoutees, majs, ignorees, retirees = charger(connexion_bd, mode, entrees, difficulte)
        total += ajoutees
        print(f"  {mode:8} {ajoutees:3} ajoutées, {majs:3} mises à jour"
              + (f", {retirees} retirée(s) (nom écrit sur le logo)" if retirees else "")
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
