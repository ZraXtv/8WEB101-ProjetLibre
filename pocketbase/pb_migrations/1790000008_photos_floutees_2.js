/// <reference path="../pb_data/types.d.ts" />

/* Photo corrigée après coup, comme dans 1790000006 : la plaque « Superb
   Combi » donnait la réponse sur la Škoda Superb. Remplace l'image déjà
   enregistrée en base. */
migrate((app) => {
  const corrigees = ["Škoda Superb"];
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
