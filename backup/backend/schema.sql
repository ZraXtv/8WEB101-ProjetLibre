CREATE TABLE IF NOT EXISTS utilisateurs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nom TEXT NOT NULL,
    courriel TEXT NOT NULL UNIQUE,
    mot_de_passe_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'membre' CHECK (role IN ('membre', 'admin')),
    date_creation TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Une question = une image et sa bonne réponse. Les mauvaises réponses ne sont
-- pas stockées : elles sont tirées au hasard parmi les autres questions du même
-- mode au moment de lancer une partie.
CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mode TEXT NOT NULL CHECK (mode IN ('logo', 'modele', 'piece')),
    reponse TEXT NOT NULL,
    fichier TEXT NOT NULL,
    indice TEXT,
    difficulte INTEGER NOT NULL DEFAULT 1 CHECK (difficulte BETWEEN 1 AND 3),
    actif INTEGER NOT NULL DEFAULT 1,
    licence TEXT NOT NULL DEFAULT '',
    auteur TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT '',
    date_ajout TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS index_questions_mode ON questions(mode, actif, difficulte);

CREATE TABLE IF NOT EXISTS parties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    utilisateur_id INTEGER,
    mode TEXT NOT NULL,
    difficulte TEXT NOT NULL DEFAULT 'toutes',
    nb_questions INTEGER NOT NULL,
    score INTEGER NOT NULL DEFAULT 0,
    bonnes_reponses INTEGER NOT NULL DEFAULT 0,
    terminee INTEGER NOT NULL DEFAULT 0,
    date_debut TEXT NOT NULL DEFAULT (datetime('now')),
    date_fin TEXT,
    FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS index_parties_classement
    ON parties(mode, terminee, score DESC);
CREATE INDEX IF NOT EXISTS index_parties_joueur
    ON parties(utilisateur_id, date_debut DESC);

-- Les propositions de chaque question sont figées ici au lancement de la
-- partie : le navigateur ne reçoit jamais la bonne réponse avant d'avoir
-- répondu, et le serveur peut vérifier qu'on ne triche pas.
CREATE TABLE IF NOT EXISTS questions_partie (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    partie_id INTEGER NOT NULL,
    position INTEGER NOT NULL,
    question_id INTEGER NOT NULL,
    propositions TEXT NOT NULL,
    reponse_donnee TEXT,
    correcte INTEGER,
    duree_ms INTEGER,
    FOREIGN KEY (partie_id) REFERENCES parties(id) ON DELETE CASCADE,
    FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS index_questions_partie
    ON questions_partie(partie_id, position);
