/// <reference path="../pb_data/types.d.ts" />

/* Questions de départ : les 88 logos de donnees/questions.json, avec leur
   image (donnees/images/), chargés dans la collection « questions ».
   Les chemins sont relatifs au dossier pocketbase/, d'où les scripts de
   démarrage lancent PocketBase. Une question déjà présente (même mode, même
   réponse) n'est pas recréée. */
migrate((app) => {
  const dossier = "donnees";
  const questions = JSON.parse(toString($os.readFile(`${dossier}/questions.json`)));
  const collection = app.findCollectionByNameOrId("questions");

  for (const q of questions) {
    const existantes = app.findRecordsByFilter(
      collection, "mode = {:mode} && reponse = {:reponse}", "", 1, 0,
      { mode: q.mode, reponse: q.reponse },
    );
    if (existantes.length) continue;

    const question = new Record(collection);
    question.set("mode", q.mode);
    question.set("reponse", q.reponse);
    question.set("difficulte", q.difficulte);
    question.set("actif", true);
    question.set("licence", q.licence || "");
    question.set("auteur", q.auteur || "");
    question.set("source", q.source || "");
    question.set("image", $filesystem.fileFromPath(`${dossier}/images/${q.fichier}`));
    app.save(question);
  }
}, (app) => {
  const questions = JSON.parse(toString($os.readFile("donnees/questions.json")));
  for (const q of questions) {
    const existantes = app.findRecordsByFilter(
      "questions", "mode = {:mode} && reponse = {:reponse}", "", 1, 0,
      { mode: q.mode, reponse: q.reponse },
    );
    for (const question of existantes) app.delete(question);
  }
});
