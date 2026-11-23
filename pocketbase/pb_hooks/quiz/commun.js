/// <reference path="../../pb_data/types.d.ts" />

/* Code partagé par les routes du quiz (quiz.pb.js).
   PocketBase exécute chaque route dans un contexte isolé : elles ne voient pas
   les fonctions déclarées à côté d'elles et doivent charger ce module avec
   require(`${__hooks}/quiz/commun.js`). */

const MODES = {
  logo: { titre: "Devine la marque", question: "À quelle marque appartient ce logo ?" },
  modele: { titre: "Devine le modèle", question: "Quel est ce modèle ?" },
  piece: { titre: "Devine la pièce", question: "Quelle est cette pièce ?" },
};
/* Réponses à ne jamais proposer ensemble : la photo de l'une montre aussi
   l'autre (sur celle du piston, on voit les bielles), le joueur aurait raison
   avec les deux. */
const CONFUSIONS = {
  Piston: ["Bielle"],
  Bielle: ["Piston"],
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

// Badges par marque : nombre de logos trouvés pour débloquer chaque palier.
const PALIERS_BADGES = [
  { nom: "bronze", seuil: 10 },
  { nom: "argent", seuil: 50 },
  { nom: "or", seuil: 100 },
];

/** Plus haut palier atteint avec ce nombre de bonnes réponses, ou null. */
function palierAtteint(bonnes) {
  let atteint = null;
  for (const p of PALIERS_BADGES) if (bonnes >= p.seuil) atteint = p.nom;
  return atteint;
}

function prochainPalier(bonnes) {
  return PALIERS_BADGES.find((p) => bonnes < p.seuil) || null;
}

/** Logos trouvés par le joueur, par marque ({ marque: nombre }). Calculé à
    partir des réponses enregistrées : aucun compteur à tenir à jour, et les
    parties jouées avant l'ajout des badges comptent aussi. Seules les bonnes
    réponses comptent, pas les questions simplement rencontrées. « app » peut
    être une transaction, pour voir la réponse qu'on vient d'y enregistrer. */
function bonnesParMarque(app, utilisateurId, marque) {
  const resultat = arrayOf(new DynamicModel({ marque: "", bonnes: 0 }));
  app.db().newQuery(
    "SELECT q.reponse AS marque, COUNT(*) AS bonnes FROM questions_partie qp " +
    "JOIN parties p ON p.id = qp.partie JOIN questions q ON q.id = qp.question " +
    "WHERE p.utilisateur = {:u} AND q.mode = 'logo' AND qp.correcte = TRUE " +
    "AND ({:m} = '' OR q.reponse = {:m}) GROUP BY q.reponse",
  ).bind({ u: utilisateurId, m: marque || "" }).all(resultat);
  const compteurs = {};
  for (const ligne of resultat) compteurs[ligne.marque] = ligne.bonnes;
  return compteurs;
}

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

/** Pièce de l'explorateur 3D liée à une question ({ modele, piece }), ou null. */
function anatomieDe(question) {
  try {
    const a = JSON.parse(toString(question.get("anatomie")) || "null");
    return a && a.modele && a.piece ? a : null;
  } catch (_) {
    return null;
  }
}

/** Page de l'explorateur qui ouvre la fiche de la pièce. À n'envoyer qu'après
    la réponse : l'adresse contient la solution. */
function lienRevision(question) {
  const a = anatomieDe(question);
  if (!a) return null;
  // Sans « index.html » : PocketBase redirige cette adresse vers le dossier
  // et perd les paramètres au passage.
  return `anatomie/?model=${encodeURIComponent(a.modele)}&piece=${encodeURIComponent(a.piece)}`;
}

/** Mauvaises réponses choisies pour cette question (modèles proches), ou []. */
function leurresDe(question) {
  const valeur = toString(question.get("leurres"));
  if (!valeur || valeur === "null") return [];
  const leurres = JSON.parse(valeur);
  return Array.isArray(leurres) ? leurres.map(String) : [];
}

/* Les mauvaises réponses commencent si possible par la même lettre que la
   bonne (Honda, Hyundai, Horch, Hanomag) : il faut alors vraiment reconnaître
   le logo, pas seulement éliminer les marques sans rapport.
   Les lettres rares parmi les questions (F, G, I, K, N, X…) sont complétées
   par ces marques réelles, qui ne servent que de leurres. Certaines ont été
   retirées du quiz parce que leur logo écrit leur nom. */
const LEURRES_SUPPLEMENTAIRES = {
  logo: [
    "Bugatti", "BYD", "Cadillac", "Chrysler", "Cupra", "Fiat", "Ford", "Fisker",
    "Geely", "Genesis", "GMC", "Infiniti", "Isuzu", "Iveco", "Kia", "Karma", "KTM", "Lamborghini", "Lancia", "Land Rover", "Lotus",
    "Nissan", "NSU", "Nash", "Oltcit", "Ram", "Rover", "Vauxhall", "Vector",
    "Xiaomi", "Zeekr", "Zotye",
  ],
};

/** Première lettre, sans accent : Škoda et Subaru commencent tous deux par S. */
function initiale(texte) {
  return String(texte).normalize("NFD").charAt(0).toUpperCase();
}

/** Leurres pris dans « reponses », ceux de même initiale que la bonne
    réponse en premier (dans un ordre aléatoire), puis les autres. */
function leurresParInitiale(mode, bonne, reponses) {
  const candidats = [...new Set(reponses.concat(LEURRES_SUPPLEMENTAIRES[mode] || []))]
    .filter((r) => r !== bonne);
  const lettre = initiale(bonne);
  const memeLettre = melanger(candidats.filter((r) => initiale(r) === lettre));
  const autres = melanger(candidats.filter((r) => initiale(r) !== lettre));
  return memeLettre.concat(autres);
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
  MODES, DIFFICULTES, CONFUSIONS, NB_QUESTIONS, NB_PROPOSITIONS, POINTS_BASE, BONUS_RAPIDITE_MAX,
  DUREE_MAX_QUESTION_MS, TOLERANCE_RESEAU_MS, PALIERS_BADGES,
  palierAtteint, prochainPalier, bonnesParMarque,
  erreur, joueur, estAdmin, melanger, anatomieDe, lienRevision, leurresDe, leurresParInitiale,
  propositionsDe, questionPublique,
  partieDe,
  questionCourante, lignes,
};
