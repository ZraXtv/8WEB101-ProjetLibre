/// <reference path="../pb_data/types.d.ts" />

/* Structure de la base : appliquée automatiquement au premier démarrage de
   PocketBase, puis jamais rejouée. Pour changer la structure, ajouter une
   nouvelle migration (ou modifier depuis le tableau de bord, qui en écrit une
   dans ce dossier) plutôt que de retoucher celle-ci. */
migrate((app) => {
  // ---- Comptes : la collection « users » créée par PocketBase, adaptée ----
  const users = app.findCollectionByNameOrId("users");

  const nom = users.fields.getByName("name");
  nom.required = true;
  nom.min = 1;
  nom.max = 40;
  nom.presentable = true;

  const motDePasse = users.fields.getByName("password");
  motDePasse.min = 10;
  // bcrypt ne tient compte que des 71 premiers octets : PocketBase plafonne là.
  motDePasse.max = 71;

  users.fields.add(new SelectField({
    name: "role",
    values: ["membre", "admin"],
    maxSelect: 1,
  }));

  // Un joueur ne peut ni se déclarer admin à l'inscription, ni se promouvoir
  // ensuite : le rôle ne se change que depuis le tableau de bord.
  users.createRule = "@request.body.role:isset = false";
  users.updateRule = "id = @request.auth.id && @request.body.role:isset = false";
  users.authToken.duration = 7 * 24 * 3600;
  app.save(users);

  // ---- Questions : une image et sa bonne réponse ----
  // Les mauvaises réponses ne sont pas stockées : elles sont tirées parmi les
  // autres questions du même mode au lancement de chaque partie.
  // Aucune règle d'accès : seuls les hooks (pb_hooks/quiz.pb.js) et le
  // tableau de bord y touchent, la bonne réponse ne doit jamais fuiter.
  const questions = new Collection({
    type: "base",
    name: "questions",
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { type: "select", name: "mode", values: ["logo", "modele", "piece"], maxSelect: 1, required: true },
      { type: "text", name: "reponse", required: true, max: 100, presentable: true },
      {
        type: "file", name: "image", required: true, maxSelect: 1, maxSize: 2 * 1024 * 1024,
        mimeTypes: ["image/png", "image/jpeg", "image/webp"], thumbs: ["100x100"],
        // Le nom du fichier contient souvent la marque : il ne doit pas être
        // téléchargeable directement. Le jeu le sert par une adresse neutre.
        protected: true,
      },
      { type: "text", name: "indice", max: 200 },
      { type: "number", name: "difficulte", required: true, min: 1, max: 3, onlyInt: true },
      { type: "bool", name: "actif" },
      { type: "text", name: "licence", max: 100 },
      { type: "text", name: "auteur", max: 200 },
      { type: "text", name: "source", max: 500 },
      { type: "autodate", name: "created", onCreate: true },
      { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE INDEX idx_questions_mode ON questions (mode, actif, difficulte)"],
  });
  app.save(questions);

  // ---- Parties ----
  const parties = new Collection({
    type: "base",
    name: "parties",
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      // Vide pour une partie jouée sans compte.
      { type: "relation", name: "utilisateur", collectionId: users.id, maxSelect: 1, cascadeDelete: true },
      { type: "select", name: "mode", values: ["logo", "modele", "piece"], maxSelect: 1, required: true },
      { type: "select", name: "difficulte", values: ["toutes", "facile", "moyen", "difficile"], maxSelect: 1, required: true },
      { type: "number", name: "nb_questions", onlyInt: true },
      { type: "number", name: "score", onlyInt: true },
      { type: "number", name: "bonnes_reponses", onlyInt: true },
      { type: "bool", name: "terminee" },
      // Instant (ms) où la question en cours a été envoyée : le temps de
      // réponse est mesuré ici, jamais par le navigateur. 0 = pas démarrée.
      { type: "number", name: "debut_question" },
      { type: "date", name: "date_fin" },
      { type: "autodate", name: "created", onCreate: true },
    ],
    indexes: [
      "CREATE INDEX idx_parties_classement ON parties (mode, terminee, score)",
      "CREATE INDEX idx_parties_joueur ON parties (utilisateur, created)",
    ],
  });
  app.save(parties);

  // ---- Questions d'une partie ----
  // Les propositions sont figées au lancement : le navigateur ne reçoit
  // jamais la bonne réponse avant d'avoir répondu.
  const questionsPartie = new Collection({
    type: "base",
    name: "questions_partie",
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { type: "relation", name: "partie", collectionId: parties.id, maxSelect: 1, required: true, cascadeDelete: true },
      { type: "number", name: "position", onlyInt: true },
      { type: "relation", name: "question", collectionId: questions.id, maxSelect: 1, required: true, cascadeDelete: true },
      { type: "json", name: "propositions", maxSize: 2000 },
      // Une réponse vide est valable (temps écoulé) : « repondue » distingue
      // « pas encore répondu » de « répondu sans rien choisir ».
      { type: "bool", name: "repondue" },
      { type: "text", name: "reponse_donnee", max: 100 },
      { type: "bool", name: "correcte" },
      { type: "number", name: "duree_ms", onlyInt: true },
    ],
    indexes: ["CREATE INDEX idx_questions_partie ON questions_partie (partie, position)"],
  });
  app.save(questionsPartie);

  // ---- Réglages ----
  const reglages = app.settings();
  reglages.meta.appName = "Auto Quiz";
  // Limites par adresse IP, sur des fenêtres de 15 minutes comme l'ancienne
  // version. Large pour la connexion : un campus partage une adresse publique.
  reglages.rateLimits.enabled = true;
  reglages.rateLimits.rules = [
    { label: "*:auth", audience: "", duration: 900, maxRequests: 30 },
    { label: "users:create", audience: "", duration: 900, maxRequests: 10 },
    { label: "POST /api/quiz/parties", audience: "", duration: 900, maxRequests: 60 },
    { label: "/api/", audience: "", duration: 10, maxRequests: 300 },
  ];
  app.save(reglages);
}, (app) => {
  for (const nom of ["questions_partie", "parties", "questions"]) {
    app.delete(app.findCollectionByNameOrId(nom));
  }
  const users = app.findCollectionByNameOrId("users");
  users.fields.removeByName("role");
  users.createRule = "";
  users.updateRule = "id = @request.auth.id";
  app.save(users);
});
