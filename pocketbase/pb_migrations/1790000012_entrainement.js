/// <reference path="../pb_data/types.d.ts" />

/* Mode entraînement : pas de points ni de partie enregistrée, une difficulté
   qui s'adapte au taux de réussite, et les questions ratées qui reviennent
   de plus en plus tard à mesure qu'on les réussit (répétition espacée).
   Les écarts se comptent en questions d'entraînement, d'une séance à l'autre.
   Seules les routes du jeu (pb_hooks) lisent et écrivent ces collections. */
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const questions = app.findCollectionByNameOrId("questions");

  // ---- État d'entraînement d'un joueur (un enregistrement par joueur) ----
  const entrainements = new Collection({
    type: "base",
    name: "entrainements",
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { type: "relation", name: "utilisateur", collectionId: users.id, maxSelect: 1, required: true, cascadeDelete: true },
      // « toutes » (les épreuves en alternance) ou une seule épreuve.
      { type: "text", name: "modes", max: 20 },
      // Nombre total de questions d'entraînement répondues : l'horloge des
      // révisions (« revient dans 3 questions »).
      { type: "number", name: "compteur", onlyInt: true },
      // Niveau (1 à 3) et dernières réponses (1 = juste) de chaque épreuve.
      { type: "json", name: "niveaux", maxSize: 200 },
      { type: "json", name: "historiques", maxSize: 500 },
      { type: "text", name: "dernier_mode", max: 20 },
      // Question en cours, propositions figées au tirage.
      { type: "relation", name: "question", collectionId: questions.id, maxSelect: 1 },
      { type: "json", name: "propositions", maxSize: 2000 },
      { type: "number", name: "difficulte", onlyInt: true },
      { type: "bool", name: "a_revoir" },
      { type: "bool", name: "repondue" },
      // Bilan de la séance en cours.
      { type: "number", name: "seance_bonnes", onlyInt: true },
      { type: "number", name: "seance_ratees", onlyInt: true },
      { type: "autodate", name: "created", onCreate: true },
      { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_entrainements_joueur ON entrainements (utilisateur)"],
  });
  app.save(entrainements);

  // ---- Suivi de chaque question vue en entraînement ----
  const revisions = new Collection({
    type: "base",
    name: "revisions",
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { type: "relation", name: "utilisateur", collectionId: users.id, maxSelect: 1, required: true, cascadeDelete: true },
      { type: "relation", name: "question", collectionId: questions.id, maxSelect: 1, required: true, cascadeDelete: true },
      { type: "select", name: "mode", values: ["logo", "modele", "piece"], maxSelect: 1, required: true },
      // Écart actuel en questions (3, 6, 12…) et compteur auquel la question
      // redevient due.
      { type: "number", name: "ecart", onlyInt: true },
      { type: "number", name: "echeance", onlyInt: true },
      // Bonnes réponses d'affilée depuis la dernière erreur.
      { type: "number", name: "serie", onlyInt: true },
      // Plus à revoir : jamais ratée, ou réussie assez de fois de suite.
      { type: "bool", name: "apprise" },
      { type: "autodate", name: "created", onCreate: true },
      { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_revisions_question ON revisions (utilisateur, question)",
      "CREATE INDEX idx_revisions_dues ON revisions (utilisateur, mode, apprise, echeance)",
    ],
  });
  app.save(revisions);

  // ---- Journal des réponses d'entraînement (les badges en tiennent compte) ----
  const reponses = new Collection({
    type: "base",
    name: "reponses_entrainement",
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { type: "relation", name: "utilisateur", collectionId: users.id, maxSelect: 1, required: true, cascadeDelete: true },
      { type: "relation", name: "question", collectionId: questions.id, maxSelect: 1, required: true, cascadeDelete: true },
      { type: "bool", name: "correcte" },
      { type: "autodate", name: "created", onCreate: true },
    ],
    indexes: ["CREATE INDEX idx_reponses_entrainement ON reponses_entrainement (utilisateur, correcte)"],
  });
  app.save(reponses);
}, (app) => {
  for (const nom of ["reponses_entrainement", "revisions", "entrainements"]) {
    app.delete(app.findCollectionByNameOrId(nom));
  }
});
