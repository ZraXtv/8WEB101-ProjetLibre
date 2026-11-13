/// <reference path="../pb_data/types.d.ts" />

/* Épreuve des pièces, deuxième version :
   - captures refaites : la pièce seule, dans sa vraie matière, sur fond blanc ;
   - un indice (la famille de la pièce : « Distribution », « Allumage »…),
     affiché avec la question ;
   - une explication d'une phrase (à quoi sert la pièce), envoyée seulement
     avec la correction ;
   - pièces retirées (illisibles une fois isolées : phares et pare-chocs
     éclatés en petits morceaux, antenne réduite à un trait) désactivées
     plutôt que supprimées, pour garder l'historique des parties. */
migrate((app) => {
  const collection = app.findCollectionByNameOrId("questions");
  if (!collection.fields.getByName("explication")) {
    collection.fields.add(new TextField({ name: "explication", max: 300 }));
    app.save(collection);
  }

  const questions = {};
  for (const q of JSON.parse(toString($os.readFile("donnees/questions.json")))) {
    if (q.mode === "piece") questions[q.reponse] = q;
  }
  for (const question of app.findRecordsByFilter("questions", "mode = 'piece'", "", 0, 0)) {
    const q = questions[question.getString("reponse")];
    if (q) {
      question.set("image", $filesystem.fileFromPath(`donnees/images/${q.fichier}`));
      question.set("indice", q.indice || "");
      question.set("explication", q.explication || "");
    } else {
      question.set("actif", false);
    }
    app.save(question);
  }
}, (app) => {
  const collection = app.findCollectionByNameOrId("questions");
  collection.fields.removeByName("explication");
  app.save(collection);
});
