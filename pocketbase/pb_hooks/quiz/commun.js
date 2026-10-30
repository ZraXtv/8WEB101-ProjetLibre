/// <reference path="../../pb_data/types.d.ts" />

/* Code partagé par les routes du quiz (quiz.pb.js).
   PocketBase exécute chaque route dans un contexte isolé : elles ne voient pas
   les fonctions déclarées à côté d'elles et doivent charger ce module avec
   require(`${__hooks}/quiz/commun.js`). */

const MODES = {
  logo: { titre: "Devine la marque", question: "À quelle marque appartient ce logo ?" },
  modele: { titre: "Devine le modèle", question: "Quel est ce modèle ?" },
  piece: { titre: "Devine la pièce", question: "Quelle pièce automobile est-ce ?" },
};
const DIFFICULTES = { toutes: null, facile: 1, moyen: 2, difficile: 3 };

const NB_QUESTIONS = 10;
const NB_PROPOSITIONS = 4;
const POINTS_BASE = 100;
const BONUS_RAPIDITE_MAX = 100;
const DUREE_MAX_QUESTION_MS = 20000;
// Marge pour le trajet réseau et le chargement de l'image : le chrono serveur
// démarre avant que la question ne s'affiche dans le navigateur.
const TOLERANCE_RESEAU_MS = 1500;

function erreur(e, statut, message) {
  return e.json(statut, { erreur: message });
}

/** Joueur connecté (collection « users »), ou null. */
function joueur(e) {
  const auth = e.auth;
  if (!auth || auth.collection().name !== "users") return null;
  return auth;
}

function estAdmin(e) {
  if (e.hasSuperuserAuth()) return true;
  const j = joueur(e);
  return !!j && j.getString("role") === "admin";
}

function melanger(liste) {
  for (let i = liste.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = liste[i]; liste[i] = liste[j]; liste[j] = tmp;
  }
  return liste;
}

/** Mauvaises réponses choisies pour cette question (modèles proches), ou []. */
function leurresDe(question) {
  const valeur = toString(question.get("leurres"));
  if (!valeur || valeur === "null") return [];
  const leurres = JSON.parse(valeur);
  return Array.isArray(leurres) ? leurres.map(String) : [];
}

function propositionsDe(qp) {
  return JSON.parse(toString(qp.get("propositions")) || "[]");
}

/** Ce que le navigateur reçoit : jamais la bonne réponse, ni le nom du
    fichier image (il contient souvent la marque). L'image passe par une
    adresse neutre, liée à la partie. */
function questionPublique(question, qp, partie) {
  return {
    position: qp.getInt("position"),
    total: partie.getInt("nb_questions"),
    question: MODES[question.getString("mode")].question,
    image: `/api/quiz/parties/${partie.id}/image?q=${qp.getInt("position")}`,
    propositions: propositionsDe(qp),
    indice: question.getString("indice") || null,
    // Difficulté figée au tirage (selon la région du joueur) ; les parties
    // lancées avant l'ajout des régions n'en ont pas.
    difficulte: qp.getInt("difficulte") || question.getInt("difficulte"),
    tempsLimiteMs: DUREE_MAX_QUESTION_MS,
    credit: {
      licence: question.getString("licence"),
      auteur: question.getString("auteur"),
      source: question.getString("source"),
    },
  };
}

/** Partie de la requête, si elle existe et appartient bien au joueur. */
function partieDe(e) {
  let partie;
  try {
    partie = $app.findRecordById("parties", e.request.pathValue("id"));
  } catch (_) {
    return { reponse: erreur(e, 404, "Partie introuvable.") };
  }
  const proprietaire = partie.getString("utilisateur");
  const j = joueur(e);
  if (proprietaire && (!j || j.id !== proprietaire)) {
    return { reponse: erreur(e, 403, "Cette partie ne vous appartient pas.") };
  }
  return { partie };
}

/** Question en attente de réponse (la première non répondue), ou null. */
function questionCourante(app, partie) {
  const liste = app.findRecordsByFilter(
    "questions_partie", "partie = {:p} && repondue = false", "position", 1, 0, { p: partie.id },
  );
  return liste.length ? liste[0] : null;
}

/** Lignes d'une requête SQL, en objets JavaScript simples. */
function lignes(sql, params, modele) {
  const resultat = arrayOf(new DynamicModel(modele));
  $app.db().newQuery(sql).bind(params || {}).all(resultat);
  return resultat.map((ligne) => {
    const objet = {};
    for (const cle of Object.keys(modele)) objet[cle] = ligne[cle];
    return objet;
  });
}

module.exports = {
  MODES, DIFFICULTES, NB_QUESTIONS, NB_PROPOSITIONS, POINTS_BASE, BONUS_RAPIDITE_MAX,
  DUREE_MAX_QUESTION_MS, TOLERANCE_RESEAU_MS,
  erreur, joueur, estAdmin, melanger, leurresDe, propositionsDe, questionPublique, partieDe,
  questionCourante, lignes,
};
