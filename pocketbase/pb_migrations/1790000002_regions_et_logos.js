/// <reference path="../pb_data/types.d.ts" />

/* Apports de Senku (branches region et fix-text-logo) :
   - région du joueur, qui adapte la difficulté des logos
     (pb_hooks/quiz/regions.js) ;
   - difficulté figée au tirage dans chaque question de partie ;
   - logos en couleur sans le nom de la marque, nouvelles difficultés, et
     retrait des logos qui *sont* le nom de la marque.
   Sur une base neuve, la migration précédente a déjà chargé les bonnes
   questions ; sur une base plus ancienne, celle-ci les met à jour. */
migrate((app) => {
  // Codes de pb_hooks/quiz/regions.js (et noms des images de pb_public/assets/drapeaux/).
  const regions = ["ca", "us", "fr", "be", "ch", "gb", "de", "it", "es", "se", "jp", "kr", "cn"];

  const users = app.findCollectionByNameOrId("users");
  users.fields.add(new SelectField({ name: "region", values: regions, maxSelect: 1 }));
  app.save(users);

  const questionsPartie = app.findCollectionByNameOrId("questions_partie");
  // Difficulté figée au tirage, selon la région du joueur à ce moment-là.
  questionsPartie.fields.add(new NumberField({ name: "difficulte", min: 1, max: 3, onlyInt: true }));
  app.save(questionsPartie);

  // ---- Questions : alignement sur donnees/questions.json ----
  const questions = JSON.parse(toString($os.readFile("donnees/questions.json")));
  const parReponse = {};
  for (const q of questions) parReponse[`${q.mode}/${q.reponse}`] = q;

  for (const question of app.findRecordsByFilter("questions", "mode = 'logo'", "", 0, 0)) {
    const q = parReponse[`logo/${question.getString("reponse")}`];
    if (!q) {
      // Logo qui affiche le nom de la marque : désactivé plutôt que supprimé,
      // pour garder l'historique des parties déjà jouées.
      question.set("actif", false);
      app.save(question);
      continue;
    }
    // L'image est renvoyée dans tous les cas : 27 logos ont changé sans que
    // rien d'autre ne le signale. Sur une base neuve, c'est la même image.
    question.set("difficulte", q.difficulte);
    question.set("licence", q.licence || "");
    question.set("auteur", q.auteur || "");
    question.set("source", q.source || "");
    question.set("image", $filesystem.fileFromPath(`donnees/images/${q.fichier}`));
    app.save(question);
  }
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  users.fields.removeByName("region");
  app.save(users);
  const questionsPartie = app.findCollectionByNameOrId("questions_partie");
  questionsPartie.fields.removeByName("difficulte");
  app.save(questionsPartie);
});
