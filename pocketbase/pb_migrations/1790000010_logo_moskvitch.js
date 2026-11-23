/// <reference path="../pb_data/types.d.ts" />

/* Logo Moskvitch recadré : l'ancien découpage coupait l'emblème en deux.
   Remplace l'image déjà enregistrée en base. */
migrate((app) => {
  const existantes = app.findRecordsByFilter(
    "questions", "mode = 'logo' && reponse = 'Moskvitch'", "", 1, 0,
  );
  for (const question of existantes) {
    question.set("image", $filesystem.fileFromPath("donnees/images/logos/moskvitch.png"));
    app.save(question);
  }
}, () => {
  // Rien à défaire : l'ancien logo était incomplet.
});
