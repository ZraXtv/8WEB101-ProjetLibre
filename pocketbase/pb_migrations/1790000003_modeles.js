/// <reference path="../pb_data/types.d.ts" />

/* Épreuve « Devine le modèle » : questions de donnees/modeles.json.
   Les modèles ne peuvent pas se contenter des autres questions comme
   mauvaises réponses : une Peugeot 205 face à une Ferrari et un Hummer serait
   trop facile. Chaque question porte donc ses propres « leurres », des
   modèles proches (même marque, même époque, même silhouette). */
migrate((app) => {
  const collection = app.findCollectionByNameOrId("questions");
  collection.fields.add(new JSONField({ name: "leurres", maxSize: 2000 }));
  app.save(collection);

  const modeles = JSON.parse(toString($os.readFile("donnees/modeles.json")));
  for (const q of modeles) {
    const existantes = app.findRecordsByFilter(
      collection, "mode = {:mode} && reponse = {:reponse}", "", 1, 0,
      { mode: q.mode, reponse: q.reponse },
    );
    if (existantes.length) continue;

    const question = new Record(collection);
    question.set("mode", q.mode);
    question.set("reponse", q.reponse);
    question.set("leurres", q.leurres || []);
    question.set("difficulte", q.difficulte);
    question.set("actif", true);
    question.set("licence", q.licence || "");
    question.set("auteur", q.auteur || "");
    question.set("source", q.source || "");
    question.set("image", $filesystem.fileFromPath(`donnees/images/${q.fichier}`));
    app.save(question);
  }
}, (app) => {
  const modeles = JSON.parse(toString($os.readFile("donnees/modeles.json")));
  for (const q of modeles) {
    const existantes = app.findRecordsByFilter(
      "questions", "mode = {:mode} && reponse = {:reponse}", "", 1, 0,
      { mode: q.mode, reponse: q.reponse },
    );
    for (const question of existantes) app.delete(question);
  }
  const collection = app.findCollectionByNameOrId("questions");
  collection.fields.removeByName("leurres");
  app.save(collection);
});
