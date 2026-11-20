/// <reference path="../pb_data/types.d.ts" />

/* Voitures sœurs réunies sous un seul nom par Wikidata (« Renault 15 et 17 ») :
   la réponse devient « Renault 15 ou 17 », la photo ne montrant qu'une des
   deux. Renomme les questions déjà en base ; une base neuve reçoit
   directement les nouveaux noms de donnees/modeles.json. */
migrate((app) => {
  const renommages = {
    "Renault 8 et 10": "Renault 8 ou 10",
    "Renault 9 et 11": "Renault 9 ou 11",
    "Renault 15 et 17": "Renault 15 ou 17",
    "Renault Floride et Caravelle": "Renault Floride ou Caravelle",
  };
  for (const [ancien, nouveau] of Object.entries(renommages)) {
    const existantes = app.findRecordsByFilter(
      "questions", "mode = 'modele' && reponse = {:r}", "", 0, 0, { r: ancien },
    );
    for (const question of existantes) {
      question.set("reponse", nouveau);
      app.save(question);
    }
  }
}, (app) => {
  for (const [ancien, nouveau] of [
    ["Renault 8 et 10", "Renault 8 ou 10"], ["Renault 9 et 11", "Renault 9 ou 11"],
    ["Renault 15 et 17", "Renault 15 ou 17"], ["Renault Floride et Caravelle", "Renault Floride ou Caravelle"],
  ]) {
    for (const question of app.findRecordsByFilter(
      "questions", "mode = 'modele' && reponse = {:r}", "", 0, 0, { r: nouveau },
    )) {
      question.set("reponse", ancien);
      app.save(question);
    }
  }
});
