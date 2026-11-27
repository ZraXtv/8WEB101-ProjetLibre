/// <reference path="../pb_data/types.d.ts" />

/* API du mode entraînement, sous /api/quiz/entrainement (logique dans
   quiz/entrainement.js). Pas de points, pas de chrono, rien dans « parties » :
   le classement, les statistiques et la courbe du profil ne le voient pas.
   Comme dans le jeu, la bonne réponse n'est envoyée qu'après la réponse. */

// Démarre une séance : { modes: "toutes" | "logo" | "modele" | "piece" }.
routerAdd("POST", "/api/quiz/entrainement", (e) => {
  const q = require(`${__hooks}/quiz/commun.js`);
  const ent = require(`${__hooks}/quiz/entrainement.js`);
  const j = q.joueur(e);
  if (!j) return q.erreur(e, 401, "Connectez-vous pour vous entraîner : vos questions à revoir sont gardées d'une séance à l'autre.");

  const modes = String((e.requestInfo().body || {}).modes || "toutes").trim();
  if (modes !== "toutes" && !q.MODES[modes]) return q.erreur(e, 400, "Épreuve inconnue.");
  if (!ent.modesDisponibles($app, modes).length) {
    return q.erreur(e, 409, "Pas encore de questions dans cette épreuve.");
  }

  const etat = ent.etatDe($app, j.id);
  etat.set("modes", modes);
  etat.set("seance_bonnes", 0);
  etat.set("seance_ratees", 0);
  // Une question laissée sans réponse est reprise (sinon il suffirait de
  // recharger la page pour éviter une question à revoir), sauf si elle n'est
  // pas de l'épreuve choisie.
  let reprise = false;
  if (!etat.getBool("repondue") && etat.getString("question")) {
    try {
      const question = $app.findRecordById("questions", etat.getString("question"));
      reprise = modes === "toutes" || question.getString("mode") === modes;
    } catch (_) {
      reprise = false;
    }
  }
  $app.save(etat);
  if (!reprise && !ent.preparerQuestionSuivante($app, etat, j.getString("region"))) {
    return q.erreur(e, 409, "Pas encore de questions dans cette épreuve.");
  }

  return e.json(201, {
    question: ent.questionPublique($app, etat),
    seance: ent.seanceDe($app, etat),
  });
});

// Question suivante (ou la question en cours, si elle attend sa réponse).
routerAdd("POST", "/api/quiz/entrainement/question", (e) => {
  const q = require(`${__hooks}/quiz/commun.js`);
  const ent = require(`${__hooks}/quiz/entrainement.js`);
  const j = q.joueur(e);
  if (!j) return q.erreur(e, 401, "Non connecté.");

  const etat = ent.etatDe($app, j.id);
  if (etat.getBool("repondue") || !etat.getString("question")) {
    if (!ent.preparerQuestionSuivante($app, etat, j.getString("region"))) {
      return q.erreur(e, 409, "Plus aucune question disponible.");
    }
  }
  return e.json(200, { question: ent.questionPublique($app, etat), seance: ent.seanceDe($app, etat) });
});

routerAdd("POST", "/api/quiz/entrainement/reponse", (e) => {
  const q = require(`${__hooks}/quiz/commun.js`);
  const ent = require(`${__hooks}/quiz/entrainement.js`);
  const j = q.joueur(e);
  if (!j) return q.erreur(e, 401, "Non connecté.");
  const choix = String((e.requestInfo().body || {}).choix || "").trim();

  let statut = 200, resultat = null;
  // En transaction : deux réponses envoyées en même temps ne comptent qu'une fois.
  $app.runInTransaction((tx) => {
    const etat = ent.etatDe(tx, j.id);
    if (etat.getBool("repondue") || !etat.getString("question")) {
      statut = 409; resultat = { erreur: "Aucune question en attente." }; return;
    }
    const propositions = JSON.parse(toString(etat.get("propositions")) || "[]");
    if (propositions.indexOf(choix) === -1) {
      statut = 400; resultat = { erreur: "Cette réponse ne fait pas partie des propositions." }; return;
    }

    const question = tx.findRecordById("questions", etat.getString("question"));
    const mode = question.getString("mode");
    const bonneReponse = question.getString("reponse");
    const correcte = choix === bonneReponse;

    const numero = etat.getInt("compteur") + 1;
    etat.set("compteur", numero);
    etat.set("repondue", true);
    etat.set(correcte ? "seance_bonnes" : "seance_ratees", etat.getInt(correcte ? "seance_bonnes" : "seance_ratees") + 1);
    const niveau = ent.ajusterNiveau(etat, mode, correcte);
    tx.save(etat);

    const devenir = ent.mettreAJourRevision(tx, j.id, question, correcte, numero);

    const trace = new Record(tx.findCollectionByNameOrId("reponses_entrainement"));
    trace.set("utilisateur", j.id);
    trace.set("question", question.id);
    trace.set("correcte", correcte);
    tx.save(trace);

    // Les logos trouvés en entraînement comptent pour les badges.
    let badgeDebloque = null;
    if (correcte && mode === "logo") {
      const bonnes = q.bonnesParMarque(tx, j.id, bonneReponse)[bonneReponse] || 0;
      const palier = q.PALIERS_BADGES.find((pal) => pal.seuil === bonnes);
      if (palier) badgeDebloque = { marque: bonneReponse, palier: palier.nom };
    }

    resultat = {
      correcte,
      bonneReponse,
      mode,
      devenir,
      niveau,
      badgeDebloque,
      revision: q.lienRevision(question),
      explication: question.getString("explication") || null,
      astuce: question.getString("astuce") || null,
      seance: ent.seanceDe(tx, etat),
    };
  });
  return e.json(statut, resultat);
});

/* Image de la question en cours. Comme pour les parties, une balise <img>
   n'envoie pas le jeton : l'identifiant de l'état d'entraînement, aléatoire
   et connu du seul joueur, suffit. Seule la question déjà tirée est servie. */
routerAdd("GET", "/api/quiz/entrainement/{id}/image", (e) => {
  let etat;
  try {
    etat = $app.findRecordById("entrainements", e.request.pathValue("id"));
  } catch (_) {
    return e.json(404, { erreur: "Entraînement introuvable." });
  }
  if (!etat.getString("question")) return e.json(404, { erreur: "Aucune image à afficher." });
  const question = $app.findRecordById("questions", etat.getString("question"));
  e.response.header().set("Cache-Control", "no-store, private");
  const stockage = $app.newFilesystem();
  try {
    stockage.serve(e.response, e.request, `${question.baseFilesPath()}/${question.getString("image")}`, "image");
  } finally {
    stockage.close();
  }
});

// Bilan de la séance en cours (bouton « Arrêter »).
routerAdd("GET", "/api/quiz/entrainement/bilan", (e) => {
  const q = require(`${__hooks}/quiz/commun.js`);
  const ent = require(`${__hooks}/quiz/entrainement.js`);
  const j = q.joueur(e);
  if (!j) return q.erreur(e, 401, "Non connecté.");
  return e.json(200, ent.seanceDe($app, ent.etatDe($app, j.id)));
});
