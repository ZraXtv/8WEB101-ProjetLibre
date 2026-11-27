/// <reference path="../../pb_data/types.d.ts" />

/* Mode entraînement (routes dans entrainement.pb.js).
   - Les épreuves alternent : logo, modèle, pièce, logo… (une épreuve sans
     question est sautée).
   - Chaque épreuve a son niveau (1 à 3), qui suit le taux de réussite des
     dernières réponses.
   - Une question ratée revient ECART_INITIAL questions plus tard ; chaque
     bonne réponse double l'écart ; après SERIE_APPRISE réussites d'affilée,
     elle est apprise. Une erreur remet l'écart au départ.
   Les questions sont numérotées par le compteur du joueur (toutes séances
   confondues) : « revient dans 6 questions » se compte sur ce numéro. */

const ORDRE_MODES = ["logo", "modele", "piece"];
const NIVEAU_DEPART = 2;
const FENETRE = 8;            // dernières réponses regardées pour le niveau
const MIN_REPONSES = 6;       // avant de pouvoir changer de niveau
const SEUIL_MONTEE = 0.8;
const SEUIL_DESCENTE = 0.5;
const ECART_INITIAL = 3;
const SERIE_APPRISE = 4;

function lireJson(record, champ, defaut) {
  try {
    const valeur = JSON.parse(toString(record.get(champ)) || "null");
    return valeur === null ? defaut : valeur;
  } catch (_) {
    return defaut;
  }
}

/** État d'entraînement du joueur, créé au premier passage. */
function etatDe(app, utilisateurId) {
  try {
    return app.findFirstRecordByFilter("entrainements", "utilisateur = {:u}", { u: utilisateurId });
  } catch (_) {
    const etat = new Record(app.findCollectionByNameOrId("entrainements"));
    etat.set("utilisateur", utilisateurId);
    etat.set("modes", "toutes");
    etat.set("compteur", 0);
    etat.set("niveaux", {});
    etat.set("historiques", {});
    etat.set("repondue", true);
    etat.set("seance_bonnes", 0);
    etat.set("seance_ratees", 0);
    app.save(etat);
    return etat;
  }
}

function niveauxDe(etat) {
  const niveaux = lireJson(etat, "niveaux", {});
  const complets = {};
  for (const mode of ORDRE_MODES) complets[mode] = niveaux[mode] || NIVEAU_DEPART;
  return complets;
}

/** Épreuves jouables pour ce choix (« toutes » ou une épreuve), dans l'ordre. */
function modesDisponibles(app, choix) {
  const compte = {};
  const resultat = arrayOf(new DynamicModel({ mode: "", nombre: 0 }));
  app.db().newQuery("SELECT mode, COUNT(*) AS nombre FROM questions WHERE actif = TRUE GROUP BY mode")
    .all(resultat);
  for (const ligne of resultat) compte[ligne.mode] = ligne.nombre;
  return ORDRE_MODES.filter((m) => (choix === "toutes" || choix === m) && compte[m] > 0);
}

/** Épreuve qui suit « derniere » dans l'ordre, parmi les disponibles. */
function modeSuivant(disponibles, derniere) {
  if (!disponibles.length) return null;
  const depart = ORDRE_MODES.indexOf(derniere);
  for (let pas = 1; pas <= ORDRE_MODES.length; pas++) {
    const mode = ORDRE_MODES[(depart + pas + ORDRE_MODES.length) % ORDRE_MODES.length];
    if (disponibles.indexOf(mode) !== -1) return mode;
  }
  return disponibles[0];
}

/** Choisit la prochaine question de l'épreuve, pour la question numéro
    « numero ». Priorité : une question à revoir arrivée à échéance (la plus
    en retard) ; sinon une question jamais vue au niveau voulu, puis une déjà
    apprise, puis le niveau le plus proche ; en dernier recours la révision
    la plus proche, même pas encore due. */
function choisirQuestion(app, utilisateurId, mode, niveauVoulu, numero, region, precedente) {
  const q = require(`${__hooks}/quiz/commun.js`);
  const tirage = q.preparerTirage(app, mode, region);
  // Jamais deux fois de suite la même question (s'il y a le choix).
  if (tirage.jouables.length > 1) tirage.jouables = tirage.jouables.filter((r) => r.id !== precedente);
  if (!tirage.jouables.length) return null;

  const suivi = {};
  for (const r of app.findRecordsByFilter(
    "revisions", "utilisateur = {:u} && mode = {:m}", "", 0, 0, { u: utilisateurId, m: mode },
  )) suivi[r.getString("question")] = r;

  const aRevoir = tirage.jouables
    .filter((question) => suivi[question.id] && !suivi[question.id].getBool("apprise"))
    .sort((a, b) => suivi[a.id].getInt("echeance") - suivi[b.id].getInt("echeance"));
  const dues = aRevoir.filter((question) => suivi[question.id].getInt("echeance") <= numero);
  if (dues.length) return { question: dues[0], aRevoir: true, tirage };

  // Les questions programmées pour plus tard ne sont pas retirées en avance.
  const libres = tirage.jouables.filter((question) => !suivi[question.id] || suivi[question.id].getBool("apprise"));
  if (libres.length) {
    const rang = (question) => Math.abs(tirage.niveau[question.id] - niveauVoulu) * 2
      + (suivi[question.id] ? 1 : 0);
    const meilleur = Math.min(...libres.map(rang));
    const choix = q.melanger(libres.filter((question) => rang(question) === meilleur))[0];
    return { question: choix, aRevoir: false, tirage };
  }
  return { question: aRevoir[0], aRevoir: true, tirage };
}

/** Tire la question suivante et la range dans l'état du joueur. Renvoie
    false s'il n'y a rien à proposer. */
function preparerQuestionSuivante(app, etat, region) {
  const q = require(`${__hooks}/quiz/commun.js`);
  const disponibles = modesDisponibles(app, etat.getString("modes"));
  const mode = modeSuivant(disponibles, etat.getString("dernier_mode"));
  if (!mode) return false;

  const numero = etat.getInt("compteur") + 1;
  const choix = choisirQuestion(
    app, etat.getString("utilisateur"), mode, niveauxDe(etat)[mode], numero, region, etat.getString("question"),
  );
  if (!choix) return false;

  const bonne = choix.question.getString("reponse");
  etat.set("question", choix.question.id);
  etat.set("propositions", q.melanger(choix.tirage.leurresDe(choix.question).concat([bonne])));
  etat.set("difficulte", choix.tirage.niveau[choix.question.id]);
  etat.set("a_revoir", choix.aRevoir);
  etat.set("repondue", false);
  etat.set("dernier_mode", mode);
  app.save(etat);
  return true;
}

/** Met à jour le suivi d'une question après une réponse (numéro de la
    question = compteur après réponse). Renvoie ce qui attend la question :
    { apprise } ou { dans: écart en questions }. */
function mettreAJourRevision(app, utilisateurId, question, correcte, numero) {
  let suivi;
  try {
    suivi = app.findFirstRecordByFilter(
      "revisions", "utilisateur = {:u} && question = {:q}", { u: utilisateurId, q: question.id },
    );
  } catch (_) {
    suivi = null;
  }

  const programmer = (ecart, serie) => {
    suivi.set("ecart", ecart);
    suivi.set("echeance", numero + ecart);
    suivi.set("serie", serie);
    suivi.set("apprise", false);
  };

  let devenir;
  if (!suivi) {
    suivi = new Record(app.findCollectionByNameOrId("revisions"));
    suivi.set("utilisateur", utilisateurId);
    suivi.set("question", question.id);
    suivi.set("mode", question.getString("mode"));
    if (correcte) {
      // Trouvée du premier coup : rien à revoir.
      suivi.set("ecart", 0);
      suivi.set("echeance", 0);
      suivi.set("serie", 1);
      suivi.set("apprise", true);
      devenir = { apprise: true, premiereFois: true };
    } else {
      programmer(ECART_INITIAL, 0);
      devenir = { dans: ECART_INITIAL };
    }
  } else if (!correcte) {
    programmer(ECART_INITIAL, 0);
    devenir = { dans: ECART_INITIAL };
  } else if (suivi.getBool("apprise")) {
    suivi.set("serie", suivi.getInt("serie") + 1);
    devenir = { apprise: true };
  } else {
    const serie = suivi.getInt("serie") + 1;
    if (serie >= SERIE_APPRISE) {
      suivi.set("serie", serie);
      suivi.set("apprise", true);
      devenir = { apprise: true, vientDetre: true };
    } else {
      const ecart = Math.max(ECART_INITIAL, suivi.getInt("ecart")) * 2;
      programmer(ecart, serie);
      devenir = { dans: ecart, serie, restantes: SERIE_APPRISE - serie };
    }
  }
  app.save(suivi);
  return devenir;
}

/** Ajoute la réponse à l'historique de l'épreuve et ajuste son niveau.
    Renvoie { niveau, change: -1 | 0 | 1 }. */
function ajusterNiveau(etat, mode, correcte) {
  const niveaux = niveauxDe(etat);
  const historiques = lireJson(etat, "historiques", {});
  const historique = (historiques[mode] || []).concat([correcte ? 1 : 0]).slice(-FENETRE);

  let change = 0;
  if (historique.length >= MIN_REPONSES) {
    const taux = historique.reduce((s, v) => s + v, 0) / historique.length;
    if (taux >= SEUIL_MONTEE && niveaux[mode] < 3) change = 1;
    else if (taux <= SEUIL_DESCENTE && niveaux[mode] > 1) change = -1;
  }
  niveaux[mode] += change;
  // Nouveau niveau : on repart d'un historique vide pour le juger.
  historiques[mode] = change ? [] : historique;
  etat.set("niveaux", niveaux);
  etat.set("historiques", historiques);
  return { niveau: niveaux[mode], change };
}

/** Nombre de questions encore à revoir (pas apprises) pour ce joueur. */
function nombreARevoir(app, utilisateurId) {
  const resultat = arrayOf(new DynamicModel({ nombre: 0 }));
  app.db().newQuery("SELECT COUNT(*) AS nombre FROM revisions WHERE utilisateur = {:u} AND apprise = FALSE")
    .bind({ u: utilisateurId }).all(resultat);
  return resultat.length ? resultat[0].nombre : 0;
}

/** Ce que le navigateur reçoit pour la question en cours : jamais la bonne
    réponse ni le nom du fichier image. */
function questionPublique(app, etat) {
  const q = require(`${__hooks}/quiz/commun.js`);
  const question = app.findRecordById("questions", etat.getString("question"));
  const mode = question.getString("mode");
  return {
    mode,
    question: q.MODES[mode].question,
    // Le numéro dans l'adresse évite que le navigateur réaffiche l'image
    // précédente depuis son cache.
    image: `/api/quiz/entrainement/${etat.id}/image?n=${etat.getInt("compteur")}`,
    propositions: lireJson(etat, "propositions", []),
    indice: question.getString("indice") || null,
    difficulte: etat.getInt("difficulte"),
    aRevoir: etat.getBool("a_revoir"),
    numeroSeance: etat.getInt("seance_bonnes") + etat.getInt("seance_ratees") + 1,
    credit: {
      licence: question.getString("licence"),
      auteur: question.getString("auteur"),
      source: question.getString("source"),
    },
  };
}

function seanceDe(app, etat) {
  return {
    bonnes: etat.getInt("seance_bonnes"),
    ratees: etat.getInt("seance_ratees"),
    niveaux: niveauxDe(etat),
    aRevoir: nombreARevoir(app, etat.getString("utilisateur")),
  };
}

module.exports = {
  ORDRE_MODES, ECART_INITIAL, SERIE_APPRISE,
  etatDe, niveauxDe, modesDisponibles, preparerQuestionSuivante,
  mettreAJourRevision, ajusterNiveau, questionPublique, seanceDe,
};
