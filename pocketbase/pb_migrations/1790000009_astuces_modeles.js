/// <reference path="../pb_data/types.d.ts" />

/* Astuces des modèles : comment reconnaître la voiture sur la photo
   (calandre, phares, silhouette...). Le jeu ne l'envoie qu'une fois la
   réponse donnée. Ajoute le champ et charge les astuces de
   donnees/modeles.json dans les questions déjà en base, avec leurs leurres
   (corrigés pour les modèles nommés par leur code, comme la BMW F15). */
migrate((app) => {
  const collection = app.findCollectionByNameOrId("questions");
  collection.fields.add(new TextField({ name: "astuce", max: 300 }));
  app.save(collection);

  const modeles = JSON.parse(toString($os.readFile("donnees/modeles.json")));
  for (const q of modeles) {
    const existantes = app.findRecordsByFilter(
      "questions", "mode = {:mode} && reponse = {:reponse}", "", 1, 0,
      { mode: q.mode, reponse: q.reponse },
    );
    for (const question of existantes) {
      question.set("astuce", q.astuce || "");
      question.set("leurres", q.leurres || []);
      app.save(question);
    }
  }
}, (app) => {
  const collection = app.findCollectionByNameOrId("questions");
  collection.fields.removeByName("astuce");
  app.save(collection);
});
