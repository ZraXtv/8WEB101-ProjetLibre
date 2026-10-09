/// <reference path="../../pb_data/types.d.ts" />

/* Politique de mots de passe, reprise de l'ancienne version Flask.
   Chargé par securite.pb.js avec require() : les hooks PocketBase ne voient
   pas les fonctions déclarées à côté d'eux. */

function verifierCompte(e) {
  const motsInterdits = [
    "password", "password1", "password123", "motdepasse", "motdepasse1",
    "motdepasse123", "123456789", "1234567890", "12345678", "azertyuiop",
    "qwertyuiop", "azerty123", "qwerty123", "iloveyou", "bonjour123",
    "administrateur", "admin1234", "quizvoiture", "voiture123", "automobile1",
  ];
  const corps = e.requestInfo().body || {};
  const record = e.record;

  record.set("name", String(record.getString("name")).trim());
  record.set("email", String(record.getString("email")).trim().toLowerCase());

  const motDePasse = corps.password;
  if (typeof motDePasse !== "string" || !motDePasse) return;
  const minuscules = motDePasse.toLowerCase();
  if (motsInterdits.indexOf(minuscules) !== -1) {
    throw new BadRequestError("Ce mot de passe est trop courant, choisissez-en un autre.");
  }
  if (/^\d+$/.test(motDePasse)) {
    throw new BadRequestError("Le mot de passe ne peut pas contenir uniquement des chiffres.");
  }
  const identifiant = record.getString("email").split("@")[0];
  if (identifiant && minuscules.indexOf(identifiant) !== -1) {
    throw new BadRequestError("Le mot de passe ne doit pas contenir votre adresse courriel.");
  }
  const nom = record.getString("name").toLowerCase();
  if (nom && minuscules.indexOf(nom) !== -1) {
    throw new BadRequestError("Le mot de passe ne doit pas contenir votre nom.");
  }
}

module.exports = { verifierCompte };
