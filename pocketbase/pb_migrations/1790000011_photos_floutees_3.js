/// <reference path="../pb_data/types.d.ts" />

/* Photos corrigées après coup, comme dans 1790000006 et 1790000008 : un
   contrôle par reconnaissance de texte (OCR) de toutes les photos a trouvé
   le nom du modèle écrit dessus (plaque, carrosserie, affiche du stand).
   Ces inscriptions sont floutées ; remplace les images déjà en base. */
migrate((app) => {
  const corrigees = [
    "Alfa Romeo 155", "Alfa Romeo 1900", "Alfa Romeo 24 HP", "Alfa Romeo GT",
    "Aston Martin Rapide", "BMW 507", "BMW 700", "BMW E38", "BMW X3",
    "Bentley Continental GT", "Dacia Duster", "Dacia Jogger", "Ford Galaxy",
    "Ford Ka", "GAZ-61", "Honda CR-V", "Hyundai Creta", "Hyundai Ioniq 5",
    "Hyundai Ioniq 6", "Hyundai NEXO", "Hyundai Venue", "Jaguar XK140",
    "Kia Cerato", "Kia Sportage", "Kia Stonic", "Land Rover Discovery Sport",
    "Lexus ES", "Lexus SC", "Mazda CX-5", "Mazda MX-30", "Mazda R360",
    "Mercedes-Benz EQS", "Mercedes-Benz Type 126", "Mitsubishi ASX",
    "Moskvitch 408", "Nissan Elgrand", "Nissan LEAF", "Nissan Pulsar",
    "Nissan Rogue", "Opel Combo", "Opel Diplomat", "Peugeot 202",
    "Peugeot 607", "Peugeot DS 5", "Porsche Macan", "Porsche Taycan",
    "Renault Arkana", "Renault Symbol", "Rolls-Royce Camargue",
    "Rolls-Royce Cullinan", "Saab 9-4X", "SsangYong Korando", "Suzuki Splash",
    "Volkswagen Amarok", "Volvo S40", "Škoda Octavia",
  ];
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
  // Rien à défaire : les anciennes photos donnaient la réponse.
});
