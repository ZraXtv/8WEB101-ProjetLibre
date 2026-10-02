import gzip
import json
import os
import random
import re
import secrets
import sqlite3
import time
from collections import defaultdict, deque
from datetime import timedelta
from pathlib import Path, PurePosixPath

from flask import Flask, g, jsonify, request, send_from_directory, session
from werkzeug.security import check_password_hash, generate_password_hash

from db import get_connection, init_db
from regions import difficulte_pour, lister_regions, region_valide

RACINE_PROJET = Path(__file__).parent.parent
DOSSIER_DONNEES = Path(__file__).parent / "data"

MODES = {
    "logo": {"titre": "Devine la marque", "question": "À quelle marque appartient ce logo ?"},
    "modele": {"titre": "Devine le modèle", "question": "Quel est ce modèle ?"},
    "piece": {"titre": "Devine la pièce", "question": "Quelle pièce automobile est-ce ?"},
}
DIFFICULTES = {"toutes": None, "facile": 1, "moyen": 2, "difficile": 3}

NB_QUESTIONS = 10
NB_PROPOSITIONS = 4
POINTS_BASE = 100
BONUS_RAPIDITE_MAX = 100
DUREE_MAX_QUESTION_MS = 20000
# Marge pour le trajet réseau et le chargement de l'image : le chrono serveur
# démarre avant que la question ne s'affiche dans le navigateur.
TOLERANCE_RESEAU_MS = 1500

MAX_LONGUEUR_NOM = 40
MAX_LONGUEUR_COURRIEL = 254
MAX_LONGUEUR_MOT_DE_PASSE = 128
MIN_LONGUEUR_MOT_DE_PASSE = 10

MOTIF_COURRIEL = re.compile(r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$")

MOTS_DE_PASSE_INTERDITS = {
    "password", "password1", "password123", "motdepasse", "motdepasse1",
    "motdepasse123", "123456789", "1234567890", "12345678", "azertyuiop",
    "qwertyuiop", "azerty123", "qwerty123", "iloveyou", "bonjour123",
    "administrateur", "admin1234", "quizvoiture", "voiture123", "automobile1",
}

# Seuls ces dossiers et les pages .html de la racine sont servis : sans liste
# blanche, la base et le code source seraient téléchargeables.
DOSSIERS_PUBLICS = {"css", "js", "assets"}

FENETRE_TENTATIVES = 900
MAX_ECHECS_COMPTE = 5
MAX_ECHECS_IP = 30
MAX_INSCRIPTIONS = 10
MAX_PARTIES = 60
_compteurs = defaultdict(deque)


def charger_cle_secrete():
    """Clé aléatoire persistée hors du code : une clé en dur dans le dépôt
    permettrait de forger un cookie de session administrateur."""
    cle = os.environ.get("SECRET_KEY")
    if cle:
        return cle

    DOSSIER_DONNEES.mkdir(exist_ok=True)
    fichier = DOSSIER_DONNEES / "secret_key"
    if fichier.exists():
        return fichier.read_text(encoding="utf-8").strip()

    cle = secrets.token_hex(32)
    fichier.write_text(cle, encoding="utf-8")
    fichier.chmod(0o600)
    return cle


app = Flask(__name__, static_folder=None)
app.secret_key = charger_cle_secrete()
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.environ.get("COOKIE_SECURE") == "1",
    PERMANENT_SESSION_LIFETIME=timedelta(days=7),
    MAX_CONTENT_LENGTH=8 * 1024 * 1024,
)

HACHAGE_FACTICE = generate_password_hash("comparaison-a-temps-constant")


# ---- Compteurs anti-abus ---------------------------------------------------

def _purger(file_attente):
    limite = time.monotonic() - FENETRE_TENTATIVES
    while file_attente and file_attente[0] < limite:
        file_attente.popleft()


def trop_d_actions(cle, maximum):
    file_attente = _compteurs[cle]
    _purger(file_attente)
    return len(file_attente) >= maximum


def enregistrer_action(cle):
    _compteurs[cle].append(time.monotonic())


def oublier_actions(cle):
    _compteurs.pop(cle, None)


def client_ip():
    return request.remote_addr or "inconnu"


# ---- Session ---------------------------------------------------------------

def utilisateur_courant():
    """Relit le rôle en base à chaque requête pour qu'une promotion ou une
    suppression de compte prenne effet sans attendre une reconnexion. Le
    résultat est mémorisé le temps de la requête HTTP seulement."""
    if "utilisateur" in g:
        return g.utilisateur

    utilisateur_id = session.get("utilisateur_id")
    if not utilisateur_id:
        g.utilisateur = None
        return None

    connexion_bd = get_connection()
    try:
        ligne = connexion_bd.execute(
            "SELECT id, nom, role, region FROM utilisateurs WHERE id = ?", (utilisateur_id,)
        ).fetchone()
    finally:
        connexion_bd.close()

    if not ligne:
        session.clear()
        g.utilisateur = None
        return None

    g.utilisateur = {"id": ligne["id"], "nom": ligne["nom"], "role": ligne["role"],
                     "region": ligne["region"]}
    return g.utilisateur


def lire_region(donnees):
    """Région envoyée par le navigateur : un code connu, ou None si non précisée.
    Lève ValueError pour une valeur inconnue."""
    region = (donnees.get("region") or "").strip().lower()
    if not region:
        return None
    if not region_valide(region):
        raise ValueError
    return region


def demarrer_session(utilisateur_id):
    """Repart d'une session vierge : un jeton fixé par un tiers avant la
    connexion ne reste pas valide après."""
    session.clear()
    session["utilisateur_id"] = utilisateur_id
    session.permanent = True


def mot_de_passe_refuse(mot_de_passe, courriel, nom):
    if len(mot_de_passe) < MIN_LONGUEUR_MOT_DE_PASSE:
        return f"Le mot de passe doit faire au moins {MIN_LONGUEUR_MOT_DE_PASSE} caractères."
    if len(mot_de_passe) > MAX_LONGUEUR_MOT_DE_PASSE:
        return "Le mot de passe est trop long."
    if mot_de_passe.lower() in MOTS_DE_PASSE_INTERDITS:
        return "Ce mot de passe est trop courant, choisissez-en un autre."
    if mot_de_passe.isdigit():
        return "Le mot de passe ne peut pas contenir uniquement des chiffres."
    identifiant = courriel.split("@")[0].lower()
    if identifiant and identifiant in mot_de_passe.lower():
        return "Le mot de passe ne doit pas contenir votre adresse courriel."
    if nom and nom.lower() in mot_de_passe.lower():
        return "Le mot de passe ne doit pas contenir votre nom."
    return None


# ---- Sécurité transversale -------------------------------------------------

@app.before_request
def verifier_csrf():
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return None
    jeton_cookie = request.cookies.get("jeton_csrf")
    jeton_entete = request.headers.get("X-CSRF-Token")
    if not jeton_cookie or not jeton_entete or not secrets.compare_digest(jeton_cookie, jeton_entete):
        return jsonify(erreur="Jeton CSRF invalide ou manquant."), 403
    return None


@app.after_request
def securiser_reponse(reponse):
    if not request.cookies.get("jeton_csrf"):
        reponse.set_cookie(
            "jeton_csrf", secrets.token_urlsafe(32), samesite="Lax",
            secure=app.config["SESSION_COOKIE_SECURE"], httponly=False,
            max_age=60 * 60 * 24 * 7,
        )

    reponse.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; "
        "img-src 'self' data:; connect-src 'self'; object-src 'none'; "
        "base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
    )
    reponse.headers["X-Content-Type-Options"] = "nosniff"
    reponse.headers["X-Frame-Options"] = "DENY"
    reponse.headers["Referrer-Policy"] = "same-origin"
    reponse.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    reponse.headers["Cross-Origin-Opener-Policy"] = "same-origin"
    if request.is_secure:
        reponse.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"

    if request.path.startswith("/api/"):
        reponse.headers["Cache-Control"] = "no-store, private"
    elif request.path.startswith("/assets/"):
        reponse.headers["Cache-Control"] = "public, max-age=604800"
    elif request.path.startswith(("/css/", "/js/")):
        # Revalidation à chaque chargement (304 si inchangé) : avec un max-age,
        # un ancien main.js resterait en cache face à une API mise à jour.
        reponse.headers["Cache-Control"] = "no-cache"

    return compresser(reponse)


def compresser(reponse):
    if reponse.status_code >= 300:
        return reponse
    if "gzip" not in request.headers.get("Accept-Encoding", ""):
        return reponse
    if reponse.headers.get("Content-Encoding"):
        return reponse

    type_contenu = reponse.headers.get("Content-Type", "")
    if not type_contenu.startswith(("text/", "application/json", "image/svg")):
        return reponse

    # Les fichiers lus sur le disque arrivent en flux : il faut le désactiver
    # pour pouvoir lire leur contenu.
    reponse.direct_passthrough = False
    donnees = reponse.get_data()
    if len(donnees) < 1024:
        return reponse

    reponse.set_data(gzip.compress(donnees, 6))
    reponse.headers["Content-Encoding"] = "gzip"
    reponse.headers["Content-Length"] = len(reponse.get_data())
    reponse.headers.add("Vary", "Accept-Encoding")
    return reponse


@app.errorhandler(404)
def introuvable(_erreur):
    return jsonify(erreur="Ressource introuvable."), 404


@app.errorhandler(413)
def trop_volumineux(_erreur):
    return jsonify(erreur="Fichier trop volumineux."), 413


@app.errorhandler(500)
def erreur_serveur(_erreur):
    return jsonify(erreur="Erreur interne du serveur."), 500


# ---- Comptes ---------------------------------------------------------------

@app.post("/api/inscription")
def inscription():
    if trop_d_actions(f"inscription:{client_ip()}", MAX_INSCRIPTIONS):
        return jsonify(erreur="Trop de tentatives, réessayez dans quelques minutes."), 429

    donnees = request.get_json(silent=True) or {}
    nom = (donnees.get("nom") or "").strip()
    courriel = (donnees.get("courriel") or "").strip().lower()
    mot_de_passe = donnees.get("motDePasse") or ""

    if not nom or len(nom) > MAX_LONGUEUR_NOM:
        return jsonify(erreur=f"Le pseudonyme est requis (max {MAX_LONGUEUR_NOM} caractères)."), 400
    if len(courriel) > MAX_LONGUEUR_COURRIEL or not MOTIF_COURRIEL.match(courriel):
        return jsonify(erreur="Adresse courriel invalide."), 400

    probleme = mot_de_passe_refuse(mot_de_passe, courriel, nom)
    if probleme:
        return jsonify(erreur=probleme), 400
    try:
        region = lire_region(donnees)
    except ValueError:
        return jsonify(erreur="Région inconnue."), 400

    enregistrer_action(f"inscription:{client_ip()}")

    connexion_bd = get_connection()
    try:
        curseur = connexion_bd.execute(
            "INSERT INTO utilisateurs (nom, courriel, mot_de_passe_hash, region) "
            "VALUES (?, ?, ?, ?)",
            (nom, courriel, generate_password_hash(mot_de_passe), region),
        )
        connexion_bd.commit()
        utilisateur_id = curseur.lastrowid
    except sqlite3.IntegrityError:
        return jsonify(erreur="Un compte existe déjà avec ce courriel."), 409
    finally:
        connexion_bd.close()

    demarrer_session(utilisateur_id)
    return jsonify(id=utilisateur_id, nom=nom, role="membre", region=region), 201


@app.post("/api/connexion")
def connexion_route():
    donnees = request.get_json(silent=True) or {}
    courriel = (donnees.get("courriel") or "").strip().lower()
    mot_de_passe = donnees.get("motDePasse") or ""

    cle_ip = f"connexion:{client_ip()}"
    cle_compte = f"connexion:{courriel}"
    if trop_d_actions(cle_ip, MAX_ECHECS_IP) or trop_d_actions(cle_compte, MAX_ECHECS_COMPTE):
        return jsonify(erreur="Trop de tentatives, réessayez dans 15 minutes."), 429

    connexion_bd = get_connection()
    ligne = connexion_bd.execute(
        "SELECT id, nom, role, region, mot_de_passe_hash FROM utilisateurs WHERE courriel = ?",
        (courriel,),
    ).fetchone()
    connexion_bd.close()

    # On compare toujours un hachage, même si le compte n'existe pas : sinon la
    # durée de la réponse révèle quelles adresses sont inscrites.
    hachage = ligne["mot_de_passe_hash"] if ligne else HACHAGE_FACTICE
    correct = check_password_hash(hachage, mot_de_passe)

    if not ligne or not correct:
        enregistrer_action(cle_ip)
        enregistrer_action(cle_compte)
        return jsonify(erreur="Courriel ou mot de passe invalide."), 401

    oublier_actions(cle_ip)
    oublier_actions(cle_compte)
    demarrer_session(ligne["id"])
    return jsonify(id=ligne["id"], nom=ligne["nom"], role=ligne["role"], region=ligne["region"])


@app.post("/api/deconnexion")
def deconnexion():
    session.clear()
    return "", 204


@app.get("/api/moi")
def moi():
    utilisateur = utilisateur_courant()
    if not utilisateur:
        return jsonify(erreur="Non connecté."), 401
    return jsonify(utilisateur)


@app.patch("/api/moi")
def modifier_profil():
    utilisateur = utilisateur_courant()
    if not utilisateur:
        return jsonify(erreur="Non connecté."), 401

    donnees = request.get_json(silent=True) or {}
    try:
        region = lire_region(donnees)
    except ValueError:
        return jsonify(erreur="Région inconnue."), 400

    connexion_bd = get_connection()
    connexion_bd.execute(
        "UPDATE utilisateurs SET region = ? WHERE id = ?", (region, utilisateur["id"])
    )
    connexion_bd.commit()
    connexion_bd.close()
    return jsonify({**utilisateur, "region": region})


@app.get("/api/regions")
def regions():
    return jsonify(lister_regions())


# ---- Parties ---------------------------------------------------------------

def question_publique(ligne, propositions, position, total):
    """Ce que le navigateur reçoit : jamais la bonne réponse."""
    return {
        "position": position,
        "total": total,
        "question": MODES[ligne["mode"]]["question"],
        "image": f"assets/images/{ligne['mode']}s/{ligne['fichier']}",
        "propositions": propositions,
        "indice": ligne["indice"],
        "difficulte": ligne["difficulte"],
        "tempsLimiteMs": DUREE_MAX_QUESTION_MS,
        "credit": {
            "licence": ligne["licence"],
            "auteur": ligne["auteur"],
            "source": ligne["source"],
        },
    }


@app.post("/api/parties")
def creer_partie():
    if trop_d_actions(f"partie:{client_ip()}", MAX_PARTIES):
        return jsonify(erreur="Trop de parties lancées, faites une pause."), 429

    donnees = request.get_json(silent=True) or {}
    mode = (donnees.get("mode") or "").strip()
    difficulte = (donnees.get("difficulte") or "toutes").strip()

    if mode not in MODES:
        return jsonify(erreur="Mode de jeu inconnu."), 400
    if difficulte not in DIFFICULTES:
        return jsonify(erreur="Difficulté inconnue."), 400

    utilisateur = utilisateur_courant()
    region = utilisateur["region"] if utilisateur else None

    connexion_bd = get_connection()
    lignes = connexion_bd.execute(
        "SELECT id, mode, reponse, fichier, indice, difficulte, licence, auteur, source "
        "FROM questions WHERE mode = ? AND actif = 1", (mode,)
    ).fetchall()

    # La difficulté dépend de la région du joueur : le filtre se fait donc
    # ici plutôt qu'en SQL.
    questions = [
        {**dict(ligne), "difficulte": difficulte_pour(ligne["reponse"], ligne["difficulte"], region)}
        for ligne in lignes
    ]
    voulue = DIFFICULTES[difficulte]
    disponibles = [q for q in questions if voulue is None or q["difficulte"] == voulue]

    if len(disponibles) < NB_PROPOSITIONS:
        connexion_bd.close()
        return jsonify(
            erreur="Pas encore assez de questions dans ce mode. Revenez bientôt !"
        ), 409

    tirage = random.sample(disponibles, min(NB_QUESTIONS, len(disponibles)))
    toutes_reponses = list({ligne["reponse"] for ligne in disponibles})

    curseur = connexion_bd.execute(
        "INSERT INTO parties (utilisateur_id, mode, difficulte, nb_questions) "
        "VALUES (?, ?, ?, ?)",
        (utilisateur["id"] if utilisateur else None, mode, difficulte, len(tirage)),
    )
    partie_id = curseur.lastrowid

    for position, ligne in enumerate(tirage):
        distracteurs = [r for r in toutes_reponses if r != ligne["reponse"]]
        propositions = random.sample(distracteurs, min(NB_PROPOSITIONS - 1, len(distracteurs)))
        propositions.append(ligne["reponse"])
        random.shuffle(propositions)
        connexion_bd.execute(
            "INSERT INTO questions_partie "
            "(partie_id, position, question_id, propositions, difficulte) VALUES (?, ?, ?, ?, ?)",
            (partie_id, position, ligne["id"], json.dumps(propositions, ensure_ascii=False),
             ligne["difficulte"]),
        )

    connexion_bd.commit()
    premiere = connexion_bd.execute(
        "SELECT propositions FROM questions_partie WHERE partie_id = ? AND position = 0",
        (partie_id,),
    ).fetchone()
    connexion_bd.close()

    session[f"debut_{partie_id}"] = time.time()
    return jsonify(
        partieId=partie_id,
        mode=mode,
        titre=MODES[mode]["titre"],
        question=question_publique(tirage[0], json.loads(premiere["propositions"]), 0, len(tirage)),
    ), 201


@app.post("/api/parties/<int:partie_id>/reponse")
def repondre(partie_id):
    donnees = request.get_json(silent=True) or {}
    # Une réponse vide signifie que le temps est écoulé côté navigateur.
    choix = (donnees.get("choix") or "").strip()

    connexion_bd = get_connection()
    partie = connexion_bd.execute("SELECT * FROM parties WHERE id = ?", (partie_id,)).fetchone()
    if not partie:
        connexion_bd.close()
        return jsonify(erreur="Partie introuvable."), 404

    utilisateur = utilisateur_courant()
    proprietaire = partie["utilisateur_id"]
    if proprietaire is not None and (not utilisateur or utilisateur["id"] != proprietaire):
        connexion_bd.close()
        return jsonify(erreur="Cette partie ne vous appartient pas."), 403
    if partie["terminee"]:
        connexion_bd.close()
        return jsonify(erreur="Cette partie est déjà terminée."), 409

    # Les parties lancées avant l'ajout des régions n'ont pas de difficulté figée.
    courante = connexion_bd.execute(
        "SELECT qp.*, q.reponse, q.fichier, q.mode, q.indice, "
        "COALESCE(qp.difficulte, q.difficulte) AS difficulte_effective, "
        "q.licence, q.auteur, q.source "
        "FROM questions_partie qp JOIN questions q ON q.id = qp.question_id "
        "WHERE qp.partie_id = ? AND qp.reponse_donnee IS NULL "
        "ORDER BY qp.position LIMIT 1",
        (partie_id,),
    ).fetchone()

    if not courante:
        connexion_bd.close()
        return jsonify(erreur="Plus aucune question en attente."), 409

    propositions = json.loads(courante["propositions"])
    if choix and choix not in propositions:
        connexion_bd.close()
        return jsonify(erreur="Cette réponse ne fait pas partie des propositions."), 400

    # Le temps est mesuré côté serveur : une horloge envoyée par le navigateur
    # serait trivialement falsifiable pour gonfler le bonus de rapidité.
    # Sans chrono démarré, la question n'a jamais été demandée : hors délai.
    debut = session.pop(f"debut_{partie_id}", None)
    duree_ms = int((time.time() - debut) * 1000) if debut else None
    temps_ecoule = duree_ms is None or duree_ms > DUREE_MAX_QUESTION_MS + TOLERANCE_RESEAU_MS
    if duree_ms is None:
        duree_ms = DUREE_MAX_QUESTION_MS

    correcte = not temps_ecoule and choix == courante["reponse"]

    points = 0
    bonus = 0
    if correcte:
        rapidite = max(0, DUREE_MAX_QUESTION_MS - duree_ms) / DUREE_MAX_QUESTION_MS
        bonus = int(BONUS_RAPIDITE_MAX * rapidite)
        points = POINTS_BASE * courante["difficulte_effective"] + bonus

    connexion_bd.execute(
        "UPDATE questions_partie SET reponse_donnee = ?, correcte = ?, duree_ms = ? WHERE id = ?",
        (choix, 1 if correcte else 0, duree_ms, courante["id"]),
    )
    connexion_bd.execute(
        "UPDATE parties SET score = score + ?, bonnes_reponses = bonnes_reponses + ? WHERE id = ?",
        (points, 1 if correcte else 0, partie_id),
    )

    suivante = connexion_bd.execute(
        "SELECT qp.propositions, qp.position, q.mode, q.fichier, q.indice, q.difficulte, "
        "q.licence, q.auteur, q.source "
        "FROM questions_partie qp JOIN questions q ON q.id = qp.question_id "
        "WHERE qp.partie_id = ? AND qp.reponse_donnee IS NULL "
        "ORDER BY qp.position LIMIT 1",
        (partie_id,),
    ).fetchone()

    if not suivante:
        connexion_bd.execute(
            "UPDATE parties SET terminee = 1, date_fin = datetime('now') WHERE id = ?",
            (partie_id,),
        )

    connexion_bd.commit()
    etat = connexion_bd.execute(
        "SELECT score, bonnes_reponses, nb_questions FROM parties WHERE id = ?", (partie_id,)
    ).fetchone()
    connexion_bd.close()

    return jsonify(
        correcte=correcte,
        tempsEcoule=temps_ecoule,
        bonneReponse=courante["reponse"],
        points=points,
        bonusRapidite=bonus,
        dureeMs=duree_ms,
        score=etat["score"],
        bonnesReponses=etat["bonnes_reponses"],
        terminee=suivante is None,
    )


@app.post("/api/parties/<int:partie_id>/question")
def question_suivante(partie_id):
    """Envoie la question en cours et démarre son chrono.

    La question n'est plus jointe à la réponse précédente : le chrono
    démarrerait alors pendant que le joueur lit la correction, et un tricheur
    pourrait étudier l'image avant de lancer le compte à rebours."""
    connexion_bd = get_connection()
    partie = connexion_bd.execute("SELECT * FROM parties WHERE id = ?", (partie_id,)).fetchone()
    if not partie:
        connexion_bd.close()
        return jsonify(erreur="Partie introuvable."), 404

    utilisateur = utilisateur_courant()
    proprietaire = partie["utilisateur_id"]
    if proprietaire is not None and (not utilisateur or utilisateur["id"] != proprietaire):
        connexion_bd.close()
        return jsonify(erreur="Cette partie ne vous appartient pas."), 403

    courante = connexion_bd.execute(
        "SELECT qp.propositions, qp.position, q.mode, q.fichier, q.indice, "
        "COALESCE(qp.difficulte, q.difficulte) AS difficulte, "
        "q.licence, q.auteur, q.source "
        "FROM questions_partie qp JOIN questions q ON q.id = qp.question_id "
        "WHERE qp.partie_id = ? AND qp.reponse_donnee IS NULL "
        "ORDER BY qp.position LIMIT 1",
        (partie_id,),
    ).fetchone()
    connexion_bd.close()

    if partie["terminee"] or not courante:
        return jsonify(erreur="Plus aucune question en attente."), 409

    # Redemander la question ne remet pas le chrono à zéro.
    session.setdefault(f"debut_{partie_id}", time.time())
    return jsonify(question=question_publique(
        courante, json.loads(courante["propositions"]),
        courante["position"], partie["nb_questions"],
    ))


# ---- Classement et statistiques --------------------------------------------

@app.get("/api/classement")
def classement():
    mode = (request.args.get("mode") or "").strip()
    if mode and mode not in MODES:
        return jsonify(erreur="Mode inconnu."), 400

    conditions = "parties.terminee = 1 AND parties.utilisateur_id IS NOT NULL"
    parametres = []
    if mode:
        conditions += " AND parties.mode = ?"
        parametres.append(mode)

    connexion_bd = get_connection()
    lignes = connexion_bd.execute(
        f"SELECT utilisateurs.nom, utilisateurs.region, MAX(parties.score) AS meilleur_score, "
        f"COUNT(*) AS parties_jouees, "
        f"SUM(parties.bonnes_reponses) AS total_bonnes "
        f"FROM parties JOIN utilisateurs ON utilisateurs.id = parties.utilisateur_id "
        f"WHERE {conditions} "
        f"GROUP BY parties.utilisateur_id ORDER BY meilleur_score DESC LIMIT 50",
        parametres,
    ).fetchall()
    connexion_bd.close()
    return jsonify([dict(ligne) for ligne in lignes])


@app.get("/api/mes-statistiques")
def mes_statistiques():
    utilisateur = utilisateur_courant()
    if not utilisateur:
        return jsonify(erreur="Non connecté."), 401

    connexion_bd = get_connection()
    global_ = connexion_bd.execute(
        "SELECT COUNT(*) AS parties, COALESCE(MAX(score), 0) AS meilleur, "
        "COALESCE(SUM(bonnes_reponses), 0) AS bonnes, "
        "COALESCE(SUM(nb_questions), 0) AS posees "
        "FROM parties WHERE utilisateur_id = ? AND terminee = 1",
        (utilisateur["id"],),
    ).fetchone()

    par_mode = connexion_bd.execute(
        "SELECT mode, COUNT(*) AS parties, MAX(score) AS meilleur, "
        "SUM(bonnes_reponses) AS bonnes, SUM(nb_questions) AS posees "
        "FROM parties WHERE utilisateur_id = ? AND terminee = 1 GROUP BY mode",
        (utilisateur["id"],),
    ).fetchall()

    recentes = connexion_bd.execute(
        "SELECT mode, score, bonnes_reponses, nb_questions, date_fin "
        "FROM parties WHERE utilisateur_id = ? AND terminee = 1 "
        "ORDER BY date_fin DESC LIMIT 10",
        (utilisateur["id"],),
    ).fetchall()
    connexion_bd.close()

    return jsonify(
        global_=dict(global_),
        parMode=[dict(ligne) for ligne in par_mode],
        recentes=[dict(ligne) for ligne in recentes],
    )


@app.get("/api/modes")
def lister_modes():
    connexion_bd = get_connection()
    lignes = connexion_bd.execute(
        "SELECT mode, COUNT(*) AS nombre FROM questions WHERE actif = 1 GROUP BY mode"
    ).fetchall()
    connexion_bd.close()

    compteurs = {ligne["mode"]: ligne["nombre"] for ligne in lignes}
    return jsonify([
        {"mode": cle, "titre": infos["titre"], "questions": compteurs.get(cle, 0)}
        for cle, infos in MODES.items()
    ])


# ---- Administration --------------------------------------------------------

def exiger_admin():
    utilisateur = utilisateur_courant()
    if not utilisateur or utilisateur["role"] != "admin":
        return None
    return utilisateur


@app.get("/api/admin/questions")
def admin_lister_questions():
    if not exiger_admin():
        return jsonify(erreur="Accès réservé aux administrateurs."), 403

    connexion_bd = get_connection()
    lignes = connexion_bd.execute(
        "SELECT id, mode, reponse, fichier, difficulte, actif, licence, auteur "
        "FROM questions ORDER BY mode, reponse"
    ).fetchall()
    connexion_bd.close()
    return jsonify([dict(ligne) for ligne in lignes])


@app.patch("/api/admin/questions/<int:question_id>")
def admin_modifier_question(question_id):
    if not exiger_admin():
        return jsonify(erreur="Accès réservé aux administrateurs."), 403

    donnees = request.get_json(silent=True) or {}
    champs, valeurs = [], []

    if "actif" in donnees:
        champs.append("actif = ?")
        valeurs.append(1 if donnees["actif"] else 0)
    if "difficulte" in donnees:
        try:
            difficulte = int(donnees["difficulte"])
        except (TypeError, ValueError):
            return jsonify(erreur="Difficulté invalide."), 400
        if difficulte not in (1, 2, 3):
            return jsonify(erreur="La difficulté doit valoir 1, 2 ou 3."), 400
        champs.append("difficulte = ?")
        valeurs.append(difficulte)

    if not champs:
        return jsonify(erreur="Rien à modifier."), 400

    connexion_bd = get_connection()
    curseur = connexion_bd.execute(
        f"UPDATE questions SET {', '.join(champs)} WHERE id = ?", valeurs + [question_id]
    )
    connexion_bd.commit()
    connexion_bd.close()

    if curseur.rowcount == 0:
        return jsonify(erreur="Question introuvable."), 404
    return jsonify(ok=True)


@app.get("/api/admin/utilisateurs")
def admin_lister_utilisateurs():
    if not exiger_admin():
        return jsonify(erreur="Accès réservé aux administrateurs."), 403

    connexion_bd = get_connection()
    lignes = connexion_bd.execute(
        "SELECT utilisateurs.id, nom, courriel, role, date_creation, "
        "(SELECT COUNT(*) FROM parties WHERE parties.utilisateur_id = utilisateurs.id "
        " AND terminee = 1) AS parties "
        "FROM utilisateurs ORDER BY date_creation DESC"
    ).fetchall()
    connexion_bd.close()
    return jsonify([dict(ligne) for ligne in lignes])


# ---- Fichiers statiques ----------------------------------------------------

def chemin_public(chemin):
    parties = PurePosixPath(chemin).parts
    if not parties or any(partie in ("..", "", ".") for partie in parties):
        return False
    if len(parties) == 1:
        return parties[0].endswith(".html")
    return parties[0] in DOSSIERS_PUBLICS


@app.get("/")
@app.get("/<path:chemin>")
def servir_front(chemin="index.html"):
    if not chemin_public(chemin) or not (RACINE_PROJET / chemin).is_file():
        return jsonify(erreur="Ressource introuvable."), 404
    return send_from_directory(RACINE_PROJET, chemin)


if __name__ == "__main__":
    from werkzeug.serving import WSGIRequestHandler

    WSGIRequestHandler.server_version = "Quiz Auto"
    WSGIRequestHandler.sys_version = ""

    init_db()
    # Le débogueur Werkzeug permet d'exécuter du code à distance : il ne
    # s'active qu'explicitement, en local.
    app.run(debug=os.environ.get("FLASK_DEBUG") == "1")
