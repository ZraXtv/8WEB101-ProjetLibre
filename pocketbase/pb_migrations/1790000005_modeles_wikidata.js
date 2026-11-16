/// <reference path="../pb_data/types.d.ts" />

/* Épreuve des modèles portée à 1000 voitures, importées de Wikidata et
   Wikimedia Commons par outils/importer_modeles.py (donnees/modeles.json).
   Même principe que la migration précédente : ajoute les modèles absents et
   met à jour leurres et crédits de ceux déjà en base, sans doublon. */
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
  // Retour aux 50 modèles choisis à la main.
  const modeles = JSON.parse(toString($os.readFile("donnees/modeles.json")));
  for (const q of modeles.slice(50)) {
    const existantes = app.findRecordsByFilter(
      "questions", "mode = {:mode} && reponse = {:reponse}", "", 1, 0,
      { mode: q.mode, reponse: q.reponse },
    );
    for (const question of existantes) app.delete(question);
  }
});
