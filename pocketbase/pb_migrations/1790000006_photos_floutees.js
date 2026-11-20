/// <reference path="../pb_data/types.d.ts" />

/* Photos de modèles corrigées après coup (texte qui donnait la réponse,
   flouté) : les migrations précédentes ne renvoient pas l'image d'une
   question déjà en base, celle-ci la remplace. Pour une prochaine correction,
   ajouter le modèle à la liste dans une nouvelle migration. */
migrate((app) => {
  const corrigees = ["BMW X4"];
  const modeles = JSON.parse(toString($os.readFile("donnees/modeles.json")));

  for (const q of modeles.filter((m) => corrigees.indexOf(m.reponse) !== -1)) {
    const existantes = app.findRecordsByFilter(
      "questions", "mode = {:mode} && reponse = {:reponse}", "", 1, 0,
      { mode: q.mode, reponse: q.reponse },
    );
    for (const question of existantes) {
      question.set("image", $filesystem.fileFromPath(`donnees/images/${q.fichier}`));
      question.set("auteur", q.auteur || "");
      app.save(question);
    }
  }
}, () => {
  // Rien à défaire : l'ancienne photo donnait la réponse.
});
