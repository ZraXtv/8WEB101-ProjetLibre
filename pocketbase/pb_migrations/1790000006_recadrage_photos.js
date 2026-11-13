/// <reference path="../pb_data/types.d.ts" />

/* Photos des pièces recadrées sur la pièce : sur la photo entière, elle se
   perdait dans le reste de la voiture ou du moteur (aileron, couvre-
   culbuteurs, chaîne, courroie, sortie d'échappement avec sa plaque). */
migrate((app) => {
  const recadrees = ["Aileron", "Couvre-culbuteurs", "Chaîne de distribution",
    "Courroie d'alternateur", "Sortie d'échappement"];
  const fichiers = {};
  for (const q of JSON.parse(toString($os.readFile("donnees/questions.json")))) {
    if (q.mode === "piece") fichiers[q.reponse] = q.fichier;
  }
  for (const reponse of recadrees) {
    const liste = app.findRecordsByFilter("questions", "mode = 'piece' && reponse = {:r}", "", 1, 0, { r: reponse });
    if (!liste.length || !fichiers[reponse]) continue;
    liste[0].set("image", $filesystem.fileFromPath(`donnees/images/${fichiers[reponse]}`));
    app.save(liste[0]);
  }
}, () => {});
