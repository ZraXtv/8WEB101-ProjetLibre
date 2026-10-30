/// <reference path="../pb_data/types.d.ts" />

/* API du quiz, sous /api/quiz/. Reprend les règles de l'ancienne version
   Flask (backup/backend/app.py) :
   - le navigateur ne reçoit jamais la bonne réponse avant d'avoir répondu ;
   - le temps de réponse est mesuré par le serveur, pas par le navigateur ;
   - la question suivante n'est envoyée (et son chrono lancé) que sur demande,
     pour que la lecture de la correction ne soit pas décomptée.
   Les comptes (inscription, connexion) sont ceux de PocketBase :
   /api/collections/users/... */

// ---- Joueur connecté --------------------------------------------------------

routerAdd("GET", "/api/quiz/moi", (e) => {
  const q = require(`${__hooks}/quiz/commun.js`);
  const j = q.joueur(e);
  if (!j) return q.erreur(e, 401, "Non connecté.");
  return e.json(200, {
    id: j.id, nom: j.getString("name"), role: j.getString("role") || "membre",
    region: j.getString("region") || null,
  });
});

// Changement de région depuis la page « Mes stats » (vide = non précisée).
routerAdd("PATCH", "/api/quiz/moi", (e) => {
  const q = require(`${__hooks}/quiz/commun.js`);
  const { regionValide } = require(`${__hooks}/quiz/regions.js`);
  const j = q.joueur(e);
  if (!j) return q.erreur(e, 401, "Non connecté.");

  const region = String((e.requestInfo().body || {}).region || "").trim().toLowerCase();
  if (region && !regionValide(region)) return q.erreur(e, 400, "Région inconnue.");
  j.set("region", region);
  $app.save(j);
  return e.json(200, {
    id: j.id, nom: j.getString("name"), role: j.getString("role") || "membre", region: region || null,
  });
});

routerAdd("GET", "/api/quiz/regions", (e) => {
  return e.json(200, require(`${__hooks}/quiz/regions.js`).listerRegions());
});

// ---- Épreuves ---------------------------------------------------------------

routerAdd("GET", "/api/quiz/modes", (e) => {
  const q = require(`${__hooks}/quiz/commun.js`);
  const compteurs = {};
  for (const ligne of q.lignes(
    "SELECT mode, COUNT(*) AS nombre FROM questions WHERE actif = TRUE GROUP BY mode", {},
    { mode: "", nombre: 0 },
  )) compteurs[ligne.mode] = ligne.nombre;

  return e.json(200, Object.keys(q.MODES).map((mode) => ({
    mode, titre: q.MODES[mode].titre, questions: compteurs[mode] || 0,
  })));
});

// ---- Parties ----------------------------------------------------------------

routerAdd("POST", "/api/quiz/parties", (e) => {
  const q = require(`${__hooks}/quiz/commun.js`);
  const corps = e.requestInfo().body || {};
  const mode = String(corps.mode || "").trim();
  const difficulte = String(corps.difficulte || "toutes").trim();

  if (!q.MODES[mode]) return q.erreur(e, 400, "Mode de jeu inconnu.");
  if (!(difficulte in q.DIFFICULTES)) return q.erreur(e, 400, "Difficulté inconnue.");

  const { difficultePour } = require(`${__hooks}/quiz/regions.js`);
  const j = q.joueur(e);
  const region = j ? j.getString("region") : "";

  // La difficulté dépend de la région du joueur : le filtre se fait donc
  // ici plutôt que dans la requête.
  const voulue = q.DIFFICULTES[difficulte];
  const niveau = {};
  const disponibles = $app.findRecordsByFilter("questions", "mode = {:mode} && actif = true", "", 0, 0, { mode })
    .filter((r) => {
      niveau[r.id] = difficultePour(r.getString("reponse"), r.getInt("difficulte"), region);
      return voulue === null || niveau[r.id] === voulue;
    });
  const toutesReponses = [...new Set(disponibles.map((r) => r.getString("reponse")))];
  // Mauvaises réponses : d'abord les leurres choisis pour la question (modèles
  // proches), puis les autres questions du mode.
  const leurresDe = (question) => {
    const bonne = question.getString("reponse");
    const propres = q.melanger(q.leurresDe(question).filter((r) => r !== bonne));
    const autres = q.melanger(toutesReponses.filter((r) => r !== bonne && propres.indexOf(r) === -1));
    return propres.concat(autres).slice(0, q.NB_PROPOSITIONS - 1);
  };
  const jouables = disponibles.filter((r) => leurresDe(r).length === q.NB_PROPOSITIONS - 1);
  if (!jouables.length) {
    return q.erreur(e, 409, "Pas encore assez de questions dans ce mode. Revenez bientôt !");
  }

  const tirage = q.melanger(jouables.slice()).slice(0, q.NB_QUESTIONS);

  let partie, premiere;
  $app.runInTransaction((tx) => {
    partie = new Record(tx.findCollectionByNameOrId("parties"));
    if (j) partie.set("utilisateur", j.id);
    partie.set("mode", mode);
    partie.set("difficulte", difficulte);
    partie.set("nb_questions", tirage.length);
    partie.set("score", 0);
    partie.set("bonnes_reponses", 0);
    partie.set("terminee", false);
    // Le chrono de la première question part dès son envoi.
    partie.set("debut_question", Date.now());
    tx.save(partie);

    const collection = tx.findCollectionByNameOrId("questions_partie");
    tirage.forEach((question, position) => {
      const bonne = question.getString("reponse");
      const propositions = q.melanger(leurresDe(question).concat([bonne]));
      const qp = new Record(collection);
      qp.set("partie", partie.id);
      qp.set("position", position);
      qp.set("question", question.id);
      qp.set("propositions", propositions);
      qp.set("difficulte", niveau[question.id]);
      qp.set("repondue", false);
      tx.save(qp);
      if (position === 0) premiere = qp;
    });
  });

  return e.json(201, {
    partieId: partie.id,
    mode,
    titre: q.MODES[mode].titre,
    question: q.questionPublique(tirage[0], premiere, partie),
  });
});

routerAdd("POST", "/api/quiz/parties/{id}/question", (e) => {
  const q = require(`${__hooks}/quiz/commun.js`);
  const { partie, reponse } = q.partieDe(e);
  if (reponse) return reponse;

  const courante = q.questionCourante($app, partie);
  if (partie.getBool("terminee") || !courante) {
    return q.erreur(e, 409, "Plus aucune question en attente.");
  }
  // Redemander la question ne remet pas le chrono à zéro.
  if (!partie.getFloat("debut_question")) {
    partie.set("debut_question", Date.now());
    $app.save(partie);
  }
  const question = $app.findRecordById("questions", courante.getString("question"));
  return e.json(200, { question: q.questionPublique(question, courante, partie) });
});

routerAdd("POST", "/api/quiz/parties/{id}/reponse", (e) => {
  const q = require(`${__hooks}/quiz/commun.js`);
  const corps = e.requestInfo().body || {};
  // Une réponse vide signifie que le temps est écoulé côté navigateur.
  const choix = String(corps.choix || "").trim();

  const { partie, reponse } = q.partieDe(e);
  if (reponse) return reponse;

  // En transaction : deux réponses envoyées en même temps ne peuvent pas
  // compter deux fois. Toutes les lectures passent par « tx ».
  let statut = 200, resultat = null;
  $app.runInTransaction((tx) => {
    const p = tx.findRecordById("parties", partie.id);
    if (p.getBool("terminee")) { statut = 409; resultat = { erreur: "Cette partie est déjà terminée." }; return; }

    const courante = q.questionCourante(tx, p);
    if (!courante) { statut = 409; resultat = { erreur: "Plus aucune question en attente." }; return; }

    const propositions = q.propositionsDe(courante);
    if (choix && propositions.indexOf(choix) === -1) {
      statut = 400; resultat = { erreur: "Cette réponse ne fait pas partie des propositions." };
      return;
    }

    // Temps mesuré côté serveur : une durée envoyée par le navigateur serait
    // triviale à falsifier pour gonfler le bonus de rapidité. Sans chrono
    // démarré, la question n'a jamais été demandée : hors délai.
    const debut = p.getFloat("debut_question");
    let dureeMs = debut ? Math.round(Date.now() - debut) : null;
    const tempsEcoule = dureeMs === null || dureeMs > q.DUREE_MAX_QUESTION_MS + q.TOLERANCE_RESEAU_MS;
    if (dureeMs === null) dureeMs = q.DUREE_MAX_QUESTION_MS;

    const question = tx.findRecordById("questions", courante.getString("question"));
    const bonneReponse = question.getString("reponse");
    const correcte = !tempsEcoule && choix === bonneReponse;

    let points = 0, bonus = 0;
    if (correcte) {
      const rapidite = Math.max(0, q.DUREE_MAX_QUESTION_MS - dureeMs) / q.DUREE_MAX_QUESTION_MS;
      bonus = Math.floor(q.BONUS_RAPIDITE_MAX * rapidite);
      const niveau = courante.getInt("difficulte") || question.getInt("difficulte");
      points = q.POINTS_BASE * niveau + bonus;
    }

    courante.set("repondue", true);
    courante.set("reponse_donnee", choix);
    courante.set("correcte", correcte);
    courante.set("duree_ms", dureeMs);
    tx.save(courante);

    const terminee = !q.questionCourante(tx, p);
    p.set("score", p.getInt("score") + points);
    p.set("bonnes_reponses", p.getInt("bonnes_reponses") + (correcte ? 1 : 0));
    p.set("debut_question", 0);
    if (terminee) {
      p.set("terminee", true);
      p.set("date_fin", new DateTime());
    }
    tx.save(p);

    resultat = {
      correcte,
      tempsEcoule,
      bonneReponse,
      points,
      bonusRapidite: bonus,
      dureeMs,
      score: p.getInt("score"),
      bonnesReponses: p.getInt("bonnes_reponses"),
      terminee,
    };
  });
  return e.json(statut, resultat);
});

/* Image de la question en cours. Pas de vérification du joueur : une balise
   <img> n'envoie pas le jeton de connexion. L'identifiant de partie, aléatoire
   et connu du seul joueur, suffit ; et seule l'image de la question déjà
   affichée (chrono démarré) est servie, jamais celle de la suivante. */
routerAdd("GET", "/api/quiz/parties/{id}/image", (e) => {
  let partie;
  try {
    partie = $app.findRecordById("parties", e.request.pathValue("id"));
  } catch (_) {
    return e.json(404, { erreur: "Partie introuvable." });
  }
  const q = require(`${__hooks}/quiz/commun.js`);
  const courante = q.questionCourante($app, partie);
  if (!courante || !partie.getFloat("debut_question")) {
    return e.json(404, { erreur: "Aucune image à afficher." });
  }
  const question = $app.findRecordById("questions", courante.getString("question"));
  e.response.header().set("Cache-Control", "no-store, private");
  const stockage = $app.newFilesystem();
  try {
    stockage.serve(e.response, e.request, `${question.baseFilesPath()}/${question.getString("image")}`, "image");
  } finally {
    stockage.close();
  }
});

// ---- Classement et statistiques ---------------------------------------------

routerAdd("GET", "/api/quiz/classement", (e) => {
  const q = require(`${__hooks}/quiz/commun.js`);
  const mode = String(e.request.url.query().get("mode") || "").trim();
  if (mode && !q.MODES[mode]) return q.erreur(e, 400, "Mode inconnu.");

  return e.json(200, q.lignes(
    // Jamais NULL : PocketBase ne sait pas le ranger dans un champ texte, et la
    // requête entière échouait pour un joueur sans région.
    "SELECT u.name AS nom, COALESCE(u.region, '') AS region, MAX(p.score) AS meilleur_score, " +
    "COUNT(*) AS parties_jouees, " +
    "SUM(p.bonnes_reponses) AS total_bonnes " +
    "FROM parties p JOIN users u ON u.id = p.utilisateur " +
    "WHERE p.terminee = TRUE AND ({:mode} = '' OR p.mode = {:mode}) " +
    "GROUP BY p.utilisateur ORDER BY meilleur_score DESC LIMIT 50",
    { mode },
    { nom: "", region: "", meilleur_score: 0, parties_jouees: 0, total_bonnes: 0 },
  ));
});

routerAdd("GET", "/api/quiz/mes-statistiques", (e) => {
  const q = require(`${__hooks}/quiz/commun.js`);
  const j = q.joueur(e);
  if (!j) return q.erreur(e, 401, "Non connecté.");
  const params = { u: j.id };

  const global = q.lignes(
    "SELECT COUNT(*) AS parties, COALESCE(MAX(score), 0) AS meilleur, " +
    "COALESCE(SUM(bonnes_reponses), 0) AS bonnes, COALESCE(SUM(nb_questions), 0) AS posees " +
    "FROM parties WHERE utilisateur = {:u} AND terminee = TRUE",
    params, { parties: 0, meilleur: 0, bonnes: 0, posees: 0 },
  )[0];

  const parMode = q.lignes(
    "SELECT mode, COUNT(*) AS parties, MAX(score) AS meilleur, SUM(bonnes_reponses) AS bonnes, " +
    "SUM(nb_questions) AS posees FROM parties WHERE utilisateur = {:u} AND terminee = TRUE GROUP BY mode",
    params, { mode: "", parties: 0, meilleur: 0, bonnes: 0, posees: 0 },
  );

  const recentes = q.lignes(
    "SELECT mode, score, bonnes_reponses, nb_questions, date_fin FROM parties " +
    "WHERE utilisateur = {:u} AND terminee = TRUE ORDER BY date_fin DESC LIMIT 10",
    params, { mode: "", score: 0, bonnes_reponses: 0, nb_questions: 0, date_fin: "" },
  );

  return e.json(200, { global_: global, parMode, recentes });
});

// ---- Administration ---------------------------------------------------------

routerAdd("GET", "/api/quiz/admin/questions", (e) => {
  const q = require(`${__hooks}/quiz/commun.js`);
  if (!q.estAdmin(e)) return q.erreur(e, 403, "Accès réservé aux administrateurs.");
  return e.json(200, $app.findRecordsByFilter("questions", "", "mode,reponse", 0, 0).map((r) => ({
    id: r.id,
    mode: r.getString("mode"),
    reponse: r.getString("reponse"),
    difficulte: r.getInt("difficulte"),
    actif: r.getBool("actif"),
    licence: r.getString("licence"),
    auteur: r.getString("auteur"),
  })));
});

routerAdd("PATCH", "/api/quiz/admin/questions/{id}", (e) => {
  const q = require(`${__hooks}/quiz/commun.js`);
  if (!q.estAdmin(e)) return q.erreur(e, 403, "Accès réservé aux administrateurs.");

  let question;
  try {
    question = $app.findRecordById("questions", e.request.pathValue("id"));
  } catch (_) {
    return q.erreur(e, 404, "Question introuvable.");
  }
  const corps = e.requestInfo().body || {};
  let modifie = false;
  if ("actif" in corps) {
    question.set("actif", !!corps.actif);
    modifie = true;
  }
  if ("difficulte" in corps) {
    const d = Number(corps.difficulte);
    if ([1, 2, 3].indexOf(d) === -1) return q.erreur(e, 400, "La difficulté doit valoir 1, 2 ou 3.");
    question.set("difficulte", d);
    modifie = true;
  }
  if (!modifie) return q.erreur(e, 400, "Rien à modifier.");
  $app.save(question);
  return e.json(200, { ok: true });
});

// Vignette pour la page d'administration (chargée par fetch avec le jeton).
routerAdd("GET", "/api/quiz/admin/questions/{id}/image", (e) => {
  const q = require(`${__hooks}/quiz/commun.js`);
  if (!q.estAdmin(e)) return q.erreur(e, 403, "Accès réservé aux administrateurs.");
  let question;
  try {
    question = $app.findRecordById("questions", e.request.pathValue("id"));
  } catch (_) {
    return q.erreur(e, 404, "Question introuvable.");
  }
  const stockage = $app.newFilesystem();
  try {
    stockage.serve(e.response, e.request, `${question.baseFilesPath()}/${question.getString("image")}`, "image");
  } finally {
    stockage.close();
  }
});

routerAdd("GET", "/api/quiz/admin/utilisateurs", (e) => {
  const q = require(`${__hooks}/quiz/commun.js`);
  if (!q.estAdmin(e)) return q.erreur(e, 403, "Accès réservé aux administrateurs.");
  return e.json(200, q.lignes(
    "SELECT u.id AS id, u.name AS nom, u.email AS courriel, COALESCE(NULLIF(u.role, ''), 'membre') AS role, " +
    "u.created AS date_creation, (SELECT COUNT(*) FROM parties p WHERE p.utilisateur = u.id " +
    "AND p.terminee = TRUE) AS parties FROM users u ORDER BY u.created DESC",
    {}, { id: "", nom: "", courriel: "", role: "", date_creation: "", parties: 0 },
  ));
});
