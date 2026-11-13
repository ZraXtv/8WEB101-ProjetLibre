/// <reference path="../pb_data/types.d.ts" />

/* Épreuve des pièces, troisième version : de vraies photos tirées des
   articles Wikipédia (Wikimedia Commons, licences libres), à la place des
   captures du modèle 3D, trop pauvres pour certaines pièces (une poulie vue
   de face n'était qu'un rond). Le lien « Réviser en 3D », l'indice et
   l'explication restent.
   Alignement complet sur donnees/questions.json : les pièces sans photo
   utilisable sont désactivées (pas supprimées : l'historique des parties y
   renvoie), « Vitrages » devient « Pare-brise ». */
migrate((app) => {
  const collection = app.findCollectionByNameOrId("questions");
  const questions = {};
  for (const q of JSON.parse(toString($os.readFile("donnees/questions.json")))) {
    if (q.mode === "piece") questions[q.reponse] = q;
  }

  const vues = {};
  for (const question of app.findRecordsByFilter("questions", "mode = 'piece'", "", 0, 0)) {
    const reponse = question.getString("reponse");
    vues[reponse] = true;
    if (!questions[reponse]) {
      question.set("actif", false);
      app.save(question);
    }
  }

  for (const reponse of Object.keys(questions)) {
    const q = questions[reponse];
    let question;
    if (vues[reponse]) {
      question = app.findFirstRecordByFilter("questions", "mode = 'piece' && reponse = {:r}", { r: reponse });
    } else {
      question = new Record(collection);
      question.set("mode", "piece");
      question.set("reponse", reponse);
    }
    question.set("difficulte", q.difficulte);
    question.set("actif", true);
    question.set("licence", q.licence || "");
    question.set("auteur", q.auteur || "");
    question.set("source", q.source || "");
    question.set("anatomie", q.anatomie);
    question.set("indice", q.indice || "");
    question.set("explication", q.explication || "");
    question.set("image", $filesystem.fileFromPath(`donnees/images/${q.fichier}`));
    app.save(question);
  }
}, () => {
  // Rien à défaire : les captures 3D ne sont plus dans le dépôt.
});
