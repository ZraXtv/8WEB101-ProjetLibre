/// <reference path="../pb_data/types.d.ts" />

/* Épreuve des modèles complétée : 50 photos libres de Wikimedia Commons
   (donnees/modeles.json). La migration précédente n'en chargeait qu'une ; sur
   une base où elle est déjà passée, celle-ci ajoute les autres et remet à jour
   les leurres et crédits des modèles déjà présents. Sur une base neuve, la
   précédente a déjà tout chargé et celle-ci ne change rien. */
migrate((app) => {
  const collection = app.findCollectionByNameOrId("questions");
  const modeles = JSON.parse(toString($os.readFile("donnees/modeles.json")));

  for (const q of modeles) {
    const existantes = app.findRecordsByFilter(
      collection, "mode = {:mode} && reponse = {:reponse}", "", 1, 0,
      { mode: q.mode, reponse: q.reponse },
    );
    const question = existantes.length ? existantes[0] : new Record(collection);
    if (!existantes.length) {
      question.set("mode", q.mode);
      question.set("reponse", q.reponse);
      question.set("actif", true);
      question.set("image", $filesystem.fileFromPath(`donnees/images/${q.fichier}`));
    }
    question.set("leurres", q.leurres || []);
    question.set("difficulte", q.difficulte);
    question.set("licence", q.licence || "");
    question.set("auteur", q.auteur || "");
    question.set("source", q.source || "");
    app.save(question);
  }
}, (app) => {
  // Retour à l'état de la migration précédente : seule la Peugeot 205 reste.
  const modeles = JSON.parse(toString($os.readFile("donnees/modeles.json")));
  for (const q of modeles) {
    if (q.reponse === "Peugeot 205") continue;
    const existantes = app.findRecordsByFilter(
      "questions", "mode = {:mode} && reponse = {:reponse}", "", 1, 0,
      { mode: q.mode, reponse: q.reponse },
    );
    for (const question of existantes) app.delete(question);
  }
});
