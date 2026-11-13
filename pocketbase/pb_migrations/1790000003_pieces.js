/// <reference path="../pb_data/types.d.ts" />

/* Épreuve « Les pièces » : chaque question est une capture de l'explorateur
   3D (pocketbase/outils/captures-pieces.mjs), la pièce seule, sur fond blanc.
   Le champ « anatomie » ({ modele, piece }) relie la
   question à la pièce de l'explorateur : il sert à tirer les mauvaises
   réponses dans le même modèle et, une fois la réponse donnée, à proposer de
   réviser la pièce en 3D. */
migrate((app) => {
  const collection = app.findCollectionByNameOrId("questions");
  collection.fields.add(new JSONField({ name: "anatomie", maxSize: 200 }));
  app.save(collection);

  const questions = JSON.parse(toString($os.readFile("donnees/questions.json")))
    .filter((q) => q.mode === "piece");

  for (const q of questions) {
    const existantes = app.findRecordsByFilter(
      collection, "mode = 'piece' && reponse = {:reponse}", "", 1, 0, { reponse: q.reponse },
    );
    const question = existantes.length ? existantes[0] : new Record(collection);
    question.set("mode", "piece");
    question.set("reponse", q.reponse);
    question.set("difficulte", q.difficulte);
    question.set("actif", true);
    question.set("licence", q.licence || "");
    question.set("auteur", q.auteur || "");
    question.set("source", q.source || "");
    question.set("anatomie", q.anatomie);
    question.set("image", $filesystem.fileFromPath(`donnees/images/${q.fichier}`));
    app.save(question);
  }
}, (app) => {
  for (const question of app.findRecordsByFilter("questions", "mode = 'piece'", "", 0, 0)) {
    app.delete(question);
  }
  const collection = app.findCollectionByNameOrId("questions");
  collection.fields.removeByName("anatomie");
  app.save(collection);
});
