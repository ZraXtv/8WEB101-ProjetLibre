const MODES = {
  logo: { icone: "🏷️", titre: "Les logos", texte: "Reconnaissez la marque à partir de son emblème." },
  modele: { icone: "🚙", titre: "Les modèles", texte: "Identifiez le modèle d'après une photo." },
  piece: { icone: "🔧", titre: "Les pièces", texte: "Nommez la pièce mécanique présentée." },
};

const DIFFICULTES = [
  ["toutes", "Toutes"],
  ["facile", "Facile"],
  ["moyen", "Moyen"],
  ["difficile", "Difficile"],
];

const PAGES_INTERNES = new Set([
  "index.html", "jeu.html", "classement.html", "profil.html",
  "connexion.html", "inscription.html", "admin.html",
]);

/* ==========================================================================
   Utilitaires
   ========================================================================== */

// Tout le contenu venant du serveur est inséré via textContent : construire du
// HTML par concaténation laisserait une réponse piégée s'exécuter.
function el(balise, classe, texte) {
  const element = document.createElement(balise);
  if (classe) element.className = classe;
  if (texte !== undefined && texte !== null) element.textContent = texte;
  return element;
}

function jetonCsrf() {
  const entree = document.cookie.split("; ").find((c) => c.startsWith("jeton_csrf="));
  return entree ? decodeURIComponent(entree.slice("jeton_csrf=".length)) : "";
}

function destinationSure(valeur) {
  if (!valeur) return null;
  return PAGES_INTERNES.has(valeur.split("?")[0]) ? valeur : null;
}

function libelleMode(mode) {
  return (MODES[mode] || {}).titre || mode;
}

function pourcentage(bonnes, total) {
  return total ? Math.round((bonnes / total) * 100) : 0;
}

function dateCourte(valeur) {
  if (!valeur) return "";
  // SQLite stocke en UTC : sans le « Z », le navigateur lirait une heure locale.
  return new Date(`${String(valeur).replace(" ", "T")}Z`)
    .toLocaleDateString("fr-CA", { day: "numeric", month: "short", year: "numeric" });
}

async function api(chemin, options = {}) {
  const methode = (options.method || "GET").toUpperCase();
  const entetes = { "Content-Type": "application/json", ...options.headers };
  if (methode !== "GET" && methode !== "HEAD") entetes["X-CSRF-Token"] = jetonCsrf();

  const reponse = await fetch(`/api${chemin}`, {
    credentials: "same-origin",
    ...options,
    headers: entetes,
  });

  const corps = reponse.status === 204 ? null : await reponse.json().catch(() => null);

  if (!reponse.ok) {
    const erreur = new Error((corps && corps.erreur) || "Une erreur est survenue.");
    erreur.status = reponse.status;
    throw erreur;
  }
  return corps;
}

function zoneToasts() {
  let zone = document.querySelector(".zone-toasts");
  if (!zone) {
    zone = el("div", "zone-toasts");
    zone.setAttribute("role", "status");
    zone.setAttribute("aria-live", "polite");
    document.body.appendChild(zone);
  }
  return zone;
}

function toast(message, type = "info") {
  const element = el("div", `toast ${type}`);
  element.appendChild(el("span", null, { succes: "✅", erreur: "⚠️" }[type] || "ℹ️"));
  element.appendChild(el("span", null, message));
  zoneToasts().appendChild(element);
  setTimeout(() => {
    element.classList.add("sortie");
    element.addEventListener("animationend", () => element.remove(), { once: true });
  }, 4000);
}

function afficherErreur(id, message) {
  const zone = document.getElementById(id);
  if (!zone) return;
  zone.textContent = message;
  zone.hidden = !message;
}

function creerEtatVide({ icone, titre, message, lien, libelleLien }) {
  const bloc = el("div", "etat-vide");
  bloc.appendChild(el("div", "etat-vide-icone", icone));
  bloc.appendChild(el("h2", null, titre));
  bloc.appendChild(el("p", null, message));
  if (lien) {
    const action = el("a", "btn btn-primary", libelleLien);
    action.href = lien;
    bloc.appendChild(action);
  }
  return bloc;
}

/* ==========================================================================
   Accueil : choix du mode et de la difficulté
   ========================================================================== */

let difficulteChoisie = "toutes";

function construireChoixDifficulte() {
  const zone = document.getElementById("choix-difficulte");
  if (!zone) return;

  zone.replaceChildren(...DIFFICULTES.map(([cle, libelle]) => {
    const puce = el("button", "puce", libelle);
    puce.type = "button";
    puce.setAttribute("aria-pressed", String(cle === difficulteChoisie));
    puce.addEventListener("click", () => {
      difficulteChoisie = cle;
      try {
        localStorage.setItem("difficulte", cle);
      } catch { /* navigation privée */ }
      zone.querySelectorAll(".puce").forEach((autre, index) => {
        autre.setAttribute("aria-pressed", String(DIFFICULTES[index][0] === cle));
      });
    });
    return puce;
  }));
}

async function initAccueil() {
  const grille = document.getElementById("grille-modes");
  if (!grille) return;

  try {
    difficulteChoisie = localStorage.getItem("difficulte") || "toutes";
  } catch { difficulteChoisie = "toutes"; }
  if (!DIFFICULTES.some(([cle]) => cle === difficulteChoisie)) difficulteChoisie = "toutes";

  construireChoixDifficulte();

  let modes = [];
  try {
    modes = await api("/modes");
  } catch {
    toast("Impossible de charger les épreuves.", "erreur");
    return;
  }

  grille.replaceChildren(...modes.map((infos) => {
    const details = MODES[infos.mode] || {};
    const item = el("li");
    const carte = el("button", "carte-mode");
    carte.type = "button";

    carte.appendChild(el("span", "carte-mode-icone", details.icone || "❓"));
    carte.appendChild(el("h2", null, details.titre || infos.titre));
    carte.appendChild(el("p", null, details.texte || ""));

    const pied = el("div", "carte-mode-pied");
    const pret = infos.questions >= 4;
    pied.appendChild(el("span", `etiquette ${pret ? "pret" : "vide"}`,
      pret ? `${infos.questions} questions` : "bientôt disponible"));
    pied.appendChild(el("span", null, pret ? "Jouer →" : ""));
    carte.appendChild(pied);

    carte.disabled = !pret;
    if (pret) {
      carte.addEventListener("click", () => {
        window.location.href =
          `jeu.html?mode=${encodeURIComponent(infos.mode)}&difficulte=${encodeURIComponent(difficulteChoisie)}`;
      });
    }

    item.appendChild(carte);
    return item;
  }));
}

/* ==========================================================================
   Écran de jeu
   ========================================================================== */

const partie = { id: null, mode: null, score: 0, bonnes: 0, total: 0, verrou: false };

function construireCadreImage(question) {
  const cadre = el("div", "cadre-image");
  const image = el("img");
  image.src = question.image;
  image.alt = "Image à identifier";
  cadre.appendChild(image);
  return cadre;
}

function construireCredit(credit) {
  if (!credit || !credit.licence) return null;

  const bloc = el("p", "credit-image");
  bloc.appendChild(document.createTextNode(
    `Image : ${credit.auteur || "auteur inconnu"} — ${credit.licence} · `));
  if (credit.source) {
    const lien = el("a", null, "Wikimedia Commons");
    lien.href = credit.source;
    lien.target = "_blank";
    lien.rel = "noopener";
    bloc.appendChild(lien);
  }
  return bloc;
}

function afficherQuestion(question) {
  const zone = document.getElementById("zone-jeu");
  partie.verrou = false;

  const barre = el("div", "barre-jeu");
  barre.appendChild(el("span", null, `Question ${question.position + 1} / ${question.total}`));
  barre.appendChild(el("span", "score-actuel", `${partie.score} pts`));

  const jauge = el("div", "jauge");
  const remplissage = el("div", "jauge-remplissage");
  remplissage.style.width = `${(question.position / question.total) * 100}%`;
  jauge.appendChild(remplissage);

  const carte = el("div", "carte-question");
  carte.appendChild(el("p", "enonce", question.question));
  carte.appendChild(construireCadreImage(question));

  const propositions = el("div", "propositions");
  question.propositions.forEach((choix) => {
    const bouton = el("button", "proposition", choix);
    bouton.type = "button";
    bouton.addEventListener("click", () => repondre(choix, propositions, carte));
    propositions.appendChild(bouton);
  });
  carte.appendChild(propositions);

  // Le crédit est gardé de côté : le nom de l'auteur est souvent celui de la
  // marque, l'afficher avant la réponse donnerait la solution.
  carte.dataset.credit = JSON.stringify(question.credit || {});

  zone.replaceChildren(barre, jauge, carte);
}

async function repondre(choix, zonePropositions, carte) {
  if (partie.verrou) return;
  partie.verrou = true;

  let resultat;
  try {
    resultat = await api(`/parties/${partie.id}/reponse`, {
      method: "POST",
      body: JSON.stringify({ choix }),
    });
  } catch (erreur) {
    toast(erreur.message, "erreur");
    partie.verrou = false;
    return;
  }

  partie.score = resultat.score;
  partie.bonnes = resultat.bonnesReponses;

  zonePropositions.querySelectorAll(".proposition").forEach((bouton) => {
    bouton.disabled = true;
    if (bouton.textContent === resultat.bonneReponse) bouton.classList.add("correcte");
    else if (bouton.textContent === choix) bouton.classList.add("incorrecte");
  });

  const retour = el("div", "retour-reponse");
  const texte = el("span", `retour-texte ${resultat.correcte ? "gagne" : "perdu"}`,
    resultat.correcte ? "Bonne réponse !" : `Raté — c'était ${resultat.bonneReponse}`);
  retour.appendChild(texte);

  if (resultat.correcte) {
    retour.appendChild(el("span", "retour-points", `+${resultat.points} pts`));
  }

  const suite = el("button", "btn btn-primary",
    resultat.terminee ? "Voir le résultat" : "Question suivante");
  suite.type = "button";
  suite.addEventListener("click", () => {
    if (resultat.terminee) afficherResultat();
    else afficherQuestion(resultat.question);
  });
  retour.appendChild(suite);

  carte.appendChild(retour);

  // Le crédit n'apparaît qu'une fois la réponse donnée.
  let credit = null;
  try {
    credit = JSON.parse(carte.dataset.credit || "{}");
  } catch { credit = null; }
  const blocCredit = construireCredit(credit);
  if (blocCredit) carte.appendChild(blocCredit);

  suite.focus();
}

function afficherResultat() {
  const zone = document.getElementById("zone-jeu");
  const reussite = pourcentage(partie.bonnes, partie.total);

  const carte = el("div", "carte-resultat");
  carte.appendChild(el("p", null, "Partie terminée"));
  carte.appendChild(el("div", "resultat-score", `${partie.score} pts`));
  carte.appendChild(el("p", "resultat-detail",
    `${partie.bonnes} bonne${partie.bonnes > 1 ? "s" : ""} réponse${partie.bonnes > 1 ? "s" : ""} sur ${partie.total} — ${reussite} %`));

  let commentaire = "Il y a de la marge de progression.";
  if (reussite === 100) commentaire = "Sans faute. Impressionnant.";
  else if (reussite >= 80) commentaire = "Excellent résultat !";
  else if (reussite >= 50) commentaire = "Pas mal, continuez.";
  carte.appendChild(el("p", "resultat-detail", commentaire));

  const actions = el("div", "resultat-actions");
  const rejouer = el("button", "btn btn-primary", "Rejouer");
  rejouer.type = "button";
  rejouer.addEventListener("click", () => window.location.reload());
  actions.appendChild(rejouer);

  const classement = el("a", "btn btn-secondary", "Voir le classement");
  classement.href = "classement.html";
  actions.appendChild(classement);

  const accueil = el("a", "btn btn-secondary", "Changer d'épreuve");
  accueil.href = "index.html";
  actions.appendChild(accueil);

  carte.appendChild(actions);
  zone.replaceChildren(carte);
}

async function initJeu(promesseUtilisateur) {
  const zone = document.getElementById("zone-jeu");
  if (!zone) return;

  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode");
  const difficulte = params.get("difficulte") || "toutes";

  if (!MODES[mode]) {
    window.location.href = "index.html";
    return;
  }

  const chargement = el("div", "carte-question");
  chargement.appendChild(el("div", "squelette", " "));
  zone.replaceChildren(creerEtatVide({
    icone: "⏳", titre: "Préparation de la partie", message: "Un instant...",
  }));

  let debut;
  try {
    [debut] = await Promise.all([
      api("/parties", { method: "POST", body: JSON.stringify({ mode, difficulte }) }),
      promesseUtilisateur,
    ]);
  } catch (erreur) {
    zone.replaceChildren(creerEtatVide({
      icone: "🚧",
      titre: "Partie impossible",
      message: erreur.message,
      lien: "index.html",
      libelleLien: "Retour aux épreuves",
    }));
    return;
  }

  partie.id = debut.partieId;
  partie.mode = debut.mode;
  partie.score = 0;
  partie.bonnes = 0;
  partie.total = debut.question.total;

  document.title = `${debut.titre} — Auto Quiz`;
  afficherQuestion(debut.question);
}

/* ==========================================================================
   Classement
   ========================================================================== */

let modeClassement = "";

async function chargerClassement() {
  const zone = document.getElementById("zone-classement");
  if (!zone) return;

  let lignes = [];
  try {
    lignes = await api(`/classement${modeClassement ? `?mode=${modeClassement}` : ""}`);
  } catch {
    lignes = [];
  }

  if (!lignes.length) {
    zone.replaceChildren(creerEtatVide({
      icone: "🏁",
      titre: "Aucun score enregistré",
      message: "Soyez la première personne à terminer une partie dans cette épreuve.",
      lien: "index.html",
      libelleLien: "Jouer maintenant",
    }));
    return;
  }

  const table = el("table");
  const entete = el("thead");
  const ligneEntete = el("tr");
  ["", "Joueur", "Meilleur score", "Parties", "Bonnes réponses"].forEach((titre) => {
    ligneEntete.appendChild(el("th", null, titre));
  });
  entete.appendChild(ligneEntete);
  table.appendChild(entete);

  const corps = el("tbody");
  lignes.forEach((ligne, index) => {
    const tr = el("tr");
    const celluleRang = el("td");
    const medailles = ["or", "argent", "bronze"];
    celluleRang.appendChild(el("span", `rang ${medailles[index] || ""}`.trim(), String(index + 1)));
    tr.appendChild(celluleRang);
    tr.appendChild(el("td", null, ligne.nom));
    tr.appendChild(el("td", null, `${ligne.meilleur_score} pts`));
    tr.appendChild(el("td", null, String(ligne.parties_jouees)));
    tr.appendChild(el("td", null, String(ligne.total_bonnes)));
    corps.appendChild(tr);
  });
  table.appendChild(corps);

  const cadre = el("div", "table-wrapper");
  cadre.appendChild(table);
  zone.replaceChildren(cadre);
}

function initClassement() {
  const filtre = document.getElementById("filtre-mode");
  if (!filtre) return;

  const options = [["", "Toutes les épreuves"], ...Object.keys(MODES).map((m) => [m, libelleMode(m)])];
  filtre.replaceChildren(...options.map(([cle, libelle]) => {
    const puce = el("button", "puce", libelle);
    puce.type = "button";
    puce.setAttribute("aria-pressed", String(cle === modeClassement));
    puce.addEventListener("click", () => {
      modeClassement = cle;
      filtre.querySelectorAll(".puce").forEach((autre, index) => {
        autre.setAttribute("aria-pressed", String(options[index][0] === cle));
      });
      chargerClassement();
    });
    return puce;
  }));

  chargerClassement();
}

/* ==========================================================================
   Profil
   ========================================================================== */

function carteStat(valeur, libelle) {
  const carte = el("div", "carte-stat");
  carte.appendChild(el("div", "carte-stat-valeur", valeur));
  carte.appendChild(el("div", "carte-stat-libelle", libelle));
  return carte;
}

async function initProfil(utilisateur) {
  const zone = document.getElementById("stats-globales");
  if (!zone) return;

  if (!utilisateur) {
    window.location.href = "connexion.html?suivant=profil.html";
    return;
  }

  document.getElementById("titre-profil").textContent = `Statistiques de ${utilisateur.nom}`;

  let stats;
  try {
    stats = await api("/mes-statistiques");
  } catch {
    toast("Impossible de charger vos statistiques.", "erreur");
    return;
  }

  const global = stats.global_;
  document.getElementById("sous-titre-profil").textContent =
    global.parties ? `${global.parties} partie${global.parties > 1 ? "s" : ""} terminée${global.parties > 1 ? "s" : ""}`
                   : "Aucune partie terminée pour l'instant.";

  zone.replaceChildren(
    carteStat(String(global.meilleur), "meilleur score"),
    carteStat(String(global.parties), "parties jouées"),
    carteStat(`${pourcentage(global.bonnes, global.posees)} %`, "de réussite"),
    carteStat(String(global.bonnes), "bonnes réponses"),
  );

  const zoneModes = document.getElementById("stats-modes");
  if (!stats.parMode.length) {
    zoneModes.replaceChildren(creerEtatVide({
      icone: "🎯",
      titre: "Pas encore de partie terminée",
      message: "Lancez une épreuve pour voir vos statistiques apparaître ici.",
      lien: "index.html",
      libelleLien: "Jouer",
    }));
  } else {
    const grille = el("div", "grille-stats");
    stats.parMode.forEach((ligne) => {
      const carte = el("div", "carte-stat");
      carte.appendChild(el("div", "carte-stat-valeur", `${ligne.meilleur} pts`));
      carte.appendChild(el("div", "carte-stat-libelle",
        `${libelleMode(ligne.mode)} — ${pourcentage(ligne.bonnes, ligne.posees)} % sur ${ligne.parties} partie(s)`));
      grille.appendChild(carte);
    });
    zoneModes.replaceChildren(grille);
  }

  const zoneRecentes = document.getElementById("parties-recentes");
  if (!stats.recentes.length) {
    zoneRecentes.replaceChildren();
    return;
  }

  const table = el("table");
  const entete = el("thead");
  const ligneEntete = el("tr");
  ["Épreuve", "Score", "Réussite", "Date"].forEach((t) => ligneEntete.appendChild(el("th", null, t)));
  entete.appendChild(ligneEntete);
  table.appendChild(entete);

  const corps = el("tbody");
  stats.recentes.forEach((ligne) => {
    const tr = el("tr");
    tr.appendChild(el("td", null, libelleMode(ligne.mode)));
    tr.appendChild(el("td", null, `${ligne.score} pts`));
    tr.appendChild(el("td", null,
      `${ligne.bonnes_reponses}/${ligne.nb_questions}`));
    tr.appendChild(el("td", null, dateCourte(ligne.date_fin)));
    corps.appendChild(tr);
  });
  table.appendChild(corps);

  const cadre = el("div", "table-wrapper");
  cadre.appendChild(table);
  zoneRecentes.replaceChildren(cadre);
}

/* ==========================================================================
   Administration
   ========================================================================== */

async function chargerAdmin() {
  const corps = document.getElementById("corps-questions");
  if (!corps) return;

  let questions = [];
  try {
    questions = await api("/admin/questions");
  } catch {
    questions = [];
  }

  const zoneStats = document.getElementById("admin-stats");
  const actives = questions.filter((q) => q.actif).length;
  const parMode = {};
  questions.forEach((q) => { parMode[q.mode] = (parMode[q.mode] || 0) + 1; });

  zoneStats.replaceChildren(
    carteStat(String(questions.length), "questions au total"),
    carteStat(String(actives), "questions actives"),
    ...Object.entries(parMode).map(([mode, n]) => carteStat(String(n), libelleMode(mode))),
  );

  corps.replaceChildren(...questions.map((question) => {
    const tr = el("tr");

    const celluleImage = el("td");
    const vignette = el("img");
    vignette.src = `assets/images/${question.mode}s/${question.fichier}`;
    vignette.alt = "";
    vignette.width = 64;
    vignette.loading = "lazy";
    celluleImage.appendChild(vignette);
    tr.appendChild(celluleImage);

    tr.appendChild(el("td", null, libelleMode(question.mode)));
    tr.appendChild(el("td", null, question.reponse));

    const celluleDifficulte = el("td");
    const selection = el("select");
    [[1, "Facile"], [2, "Moyen"], [3, "Difficile"]].forEach(([valeur, libelle]) => {
      const option = el("option", null, libelle);
      option.value = String(valeur);
      if (question.difficulte === valeur) option.selected = true;
      selection.appendChild(option);
    });
    selection.addEventListener("change", async () => {
      try {
        await api(`/admin/questions/${question.id}`, {
          method: "PATCH",
          body: JSON.stringify({ difficulte: Number(selection.value) }),
        });
        toast("Difficulté mise à jour.", "succes");
      } catch (erreur) {
        toast(erreur.message, "erreur");
      }
    });
    celluleDifficulte.appendChild(selection);
    tr.appendChild(celluleDifficulte);

    tr.appendChild(el("td", null, question.licence || "—"));

    const celluleActif = el("td");
    const bascule = el("input");
    bascule.type = "checkbox";
    bascule.checked = Boolean(question.actif);
    bascule.setAttribute("aria-label", `Activer ${question.reponse}`);
    bascule.addEventListener("change", async () => {
      try {
        await api(`/admin/questions/${question.id}`, {
          method: "PATCH",
          body: JSON.stringify({ actif: bascule.checked }),
        });
        toast(bascule.checked ? "Question activée." : "Question désactivée.", "succes");
      } catch (erreur) {
        toast(erreur.message, "erreur");
        bascule.checked = !bascule.checked;
      }
    });
    celluleActif.appendChild(bascule);
    tr.appendChild(celluleActif);

    return tr;
  }));
}

function initAdmin(utilisateur) {
  const corps = document.getElementById("corps-questions");
  if (!corps) return;

  if (!utilisateur) {
    window.location.href = "connexion.html?suivant=admin.html";
    return;
  }
  if (utilisateur.role !== "admin") {
    window.location.href = "index.html";
    return;
  }
  chargerAdmin();
}

/* ==========================================================================
   Formulaires
   ========================================================================== */

function initFormulaireConnexion() {
  const formulaire = document.getElementById("form-connexion");
  if (!formulaire) return;

  formulaire.addEventListener("submit", async (evenement) => {
    evenement.preventDefault();
    const donnees = new FormData(formulaire);
    const bouton = formulaire.querySelector("button[type='submit']");
    bouton.disabled = true;

    try {
      await api("/connexion", {
        method: "POST",
        body: JSON.stringify({
          courriel: donnees.get("courriel"),
          motDePasse: donnees.get("mot-de-passe"),
        }),
      });
      const suivant = destinationSure(new URLSearchParams(window.location.search).get("suivant"));
      window.location.href = suivant || "index.html";
    } catch (erreur) {
      afficherErreur("message-erreur", erreur.message);
      bouton.disabled = false;
    }
  });
}

function initFormulaireInscription() {
  const formulaire = document.getElementById("form-inscription");
  if (!formulaire) return;

  formulaire.addEventListener("submit", async (evenement) => {
    evenement.preventDefault();
    const donnees = new FormData(formulaire);
    const bouton = formulaire.querySelector("button[type='submit']");
    bouton.disabled = true;

    try {
      await api("/inscription", {
        method: "POST",
        body: JSON.stringify({
          nom: donnees.get("nom"),
          courriel: donnees.get("courriel"),
          motDePasse: donnees.get("mot-de-passe"),
        }),
      });
      window.location.href = "index.html";
    } catch (erreur) {
      afficherErreur("message-erreur", erreur.message);
      bouton.disabled = false;
    }
  });
}

/* ==========================================================================
   Thème, menu, session
   ========================================================================== */

function initTheme() {
  const bouton = document.getElementById("bascule-theme");
  const racine = document.documentElement;

  const appliquer = (valeur) => {
    if (valeur) racine.setAttribute("data-theme", valeur);
    else racine.removeAttribute("data-theme");
    if (bouton) {
      const clair = valeur === "clair";
      bouton.textContent = clair ? "🌙" : "☀️";
      bouton.setAttribute("aria-label", clair ? "Passer au thème sombre" : "Passer au thème clair");
    }
  };

  let theme = null;
  try { theme = localStorage.getItem("theme"); } catch { theme = null; }
  appliquer(theme);

  if (bouton) {
    bouton.addEventListener("click", () => {
      const nouveau = racine.getAttribute("data-theme") === "clair" ? "" : "clair";
      try {
        if (nouveau) localStorage.setItem("theme", nouveau);
        else localStorage.removeItem("theme");
      } catch { /* navigation privée */ }
      appliquer(nouveau);
    });
  }
}

function initMenuMobile() {
  const bouton = document.getElementById("bouton-menu");
  const menu = document.getElementById("menu-principal");
  if (!bouton || !menu) return;

  bouton.addEventListener("click", () => {
    const ouvert = menu.classList.toggle("ouvert");
    bouton.setAttribute("aria-expanded", String(ouvert));
    bouton.textContent = ouvert ? "✕" : "☰";
  });
}

async function initEtatSession() {
  const elements = {
    connexion: document.getElementById("nav-connexion"),
    inscription: document.getElementById("nav-inscription"),
    deconnexion: document.getElementById("nav-deconnexion"),
    profil: document.getElementById("nav-profil"),
    admin: document.getElementById("nav-admin"),
  };

  let utilisateur = null;
  try { utilisateur = await api("/moi"); } catch { utilisateur = null; }

  if (utilisateur) {
    if (elements.connexion) elements.connexion.hidden = true;
    if (elements.inscription) elements.inscription.hidden = true;
    if (elements.deconnexion) elements.deconnexion.hidden = false;
    if (elements.profil) elements.profil.hidden = false;
    if (elements.admin) elements.admin.hidden = utilisateur.role !== "admin";
  }

  if (elements.deconnexion) {
    elements.deconnexion.addEventListener("click", async (evenement) => {
      evenement.preventDefault();
      await api("/deconnexion", { method: "POST" });
      window.location.href = "index.html";
    });
  }

  return utilisateur;
}

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initMenuMobile();

  // La session part en parallèle du contenu : l'attendre avant de demander la
  // partie ajouterait un aller-retour complet avant le premier affichage.
  const promesseUtilisateur = initEtatSession();

  initAccueil();
  initJeu(promesseUtilisateur);
  initClassement();
  initFormulaireConnexion();
  initFormulaireInscription();

  promesseUtilisateur.then((utilisateur) => {
    initProfil(utilisateur);
    initAdmin(utilisateur);
  });
});
