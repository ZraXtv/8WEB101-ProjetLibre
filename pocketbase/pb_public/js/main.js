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

/* Adresse du serveur PocketBase. Vide quand PocketBase sert lui-même le site
   (cas normal) ; à renseigner, par exemple "https://mon-quiz.pockethost.io",
   si les pages sont hébergées ailleurs (GitHub Pages). */
const SERVEUR = "";

// Jeton de connexion PocketBase : envoyé en en-tête, jamais en cookie, ce qui
// rend la protection CSRF inutile.
const CLE_JETON = "jeton_quiz";

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

function lireJeton() {
  try { return localStorage.getItem(CLE_JETON) || ""; } catch { return ""; }
}

function ecrireJeton(jeton) {
  try {
    if (jeton) localStorage.setItem(CLE_JETON, jeton);
    else localStorage.removeItem(CLE_JETON);
  } catch { /* navigation privée : la connexion ne survivra pas à la page */ }
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

/* Régions : la liste vient du serveur, qui s'en sert pour la difficulté. Les
   drapeaux sont des images, les émojis de drapeaux s'affichant comme deux
   lettres sous Windows. */

let promesseRegions = null;

function chargerRegions() {
  if (!promesseRegions) {
    promesseRegions = api("/regions")
      .then((regions) => regions.sort((a, b) => a.nom.localeCompare(b.nom, "fr")))
      .catch(() => []);
  }
  return promesseRegions;
}

function creerDrapeau(code, regions) {
  const region = regions.find((r) => r.code === code);
  if (!region) return null;
  const image = el("img", "drapeau");
  image.src = `assets/drapeaux/${region.code}.png`;
  image.alt = region.nom;
  image.title = region.nom;
  return image;
}

async function remplirChoixRegion(select, valeur) {
  const regions = await chargerRegions();
  select.replaceChildren(
    new Option("Non précisée", ""),
    ...regions.map((region) => new Option(region.nom, region.code)),
  );
  select.value = valeur || "";
}

async function afficherDrapeauNav(region) {
  const lien = document.querySelector("#nav-profil a");
  if (!lien) return;
  lien.querySelector(".drapeau")?.remove();
  if (!region) return;
  const drapeau = creerDrapeau(region, await chargerRegions());
  if (drapeau) lien.prepend(drapeau);
}

function dateCourte(valeur) {
  if (!valeur) return "";
  // PocketBase stocke en UTC (« 2026-10-08 12:00:00.000Z ») : le format ISO
  // garde le fuseau.
  return new Date(String(valeur).replace(" ", "T"))
    .toLocaleDateString("fr-CA", { day: "numeric", month: "short", year: "numeric" });
}

/* Messages en français pour les erreurs propres à PocketBase (comptes), qui
   répond en anglais et champ par champ. */
function messageErreur(statut, corps) {
  if (corps && corps.erreur) return corps.erreur;
  if (statut === 429) return "Trop de tentatives, réessayez dans quelques minutes.";
  const champs = (corps && corps.data) || {};
  if (champs.email) {
    return champs.email.code === "validation_not_unique"
      ? "Un compte existe déjà avec ce courriel." : "Adresse courriel invalide.";
  }
  if (champs.password) return "Le mot de passe doit faire entre 10 et 71 caractères.";
  if (champs.name) return "Le pseudonyme est requis (40 caractères au plus).";
  if (champs.region) return "Région inconnue.";
  if (champs.identity) return "Courriel ou mot de passe invalide.";
  // Nos propres refus (politique de mots de passe) sont déjà en français.
  if (corps && corps.message && !/^(Failed|Something|The request)/.test(corps.message)) return corps.message;
  if (statut === 400 && corps && /authenticate/i.test(corps.message || "")) return "Courriel ou mot de passe invalide.";
  return "Une erreur est survenue.";
}

/* Appel au serveur. Les chemins commençant par « /api/ » sont pris tels
   quels ; les autres sont ceux de l'API du quiz (/api/quiz/…). */
async function api(chemin, options = {}) {
  const entetes = { "Content-Type": "application/json", ...options.headers };
  const jeton = lireJeton();
  if (jeton) entetes.Authorization = jeton;

  const url = `${SERVEUR}${chemin.startsWith("/api/") ? chemin : `/api/quiz${chemin}`}`;
  const reponse = await fetch(url, { ...options, headers: entetes });

  const corps = reponse.status === 204 ? null : await reponse.json().catch(() => null);

  if (!reponse.ok) {
    // Jeton expiré ou compte supprimé : on oublie la connexion.
    if (reponse.status === 401 && jeton) ecrireJeton("");
    const erreur = new Error(messageErreur(reponse.status, corps));
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

// Début de la phrase d'accueil, selon la difficulté choisie.
const INTRO_EPREUVES = {
  toutes: "Trois épreuves",
  facile: "Trois épreuves faciles",
  moyen: "Trois épreuves de difficulté moyenne",
  difficile: "Trois épreuves difficiles",
};

function afficherIntroEpreuves() {
  const intro = document.getElementById("intro-epreuves");
  if (intro) intro.textContent = INTRO_EPREUVES[difficulteChoisie] || INTRO_EPREUVES.toutes;
}

function construireChoixDifficulte() {
  const zone = document.getElementById("choix-difficulte");
  if (!zone) return;
  afficherIntroEpreuves();

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
      afficherIntroEpreuves();
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
    // Les modèles ont leurs propres mauvaises réponses : une seule question
    // suffit pour jouer.
    const pret = infos.questions >= 1;
    let etiquette = `${infos.questions} question${infos.questions > 1 ? "s" : ""}`;
    if (infos.coefficient > 1) {
      etiquette += ` · points ×${String(infos.coefficient).replace(".", ",")}`;
    }
    pied.appendChild(el("span", `etiquette ${pret ? "pret" : "vide"}`,
      pret ? etiquette : "bientôt disponible"));
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

// « historique » : une ligne par question répondue, pour le récapitulatif de fin.
const partie = { id: null, mode: null, score: 0, bonnes: 0, total: 0, verrou: false, historique: [] };

// Le chrono affiché n'est qu'indicatif : c'est le serveur qui mesure le temps
// réellement compté. Celui-ci part au moment où la question s'affiche.
const chrono = { minuterie: null };

function arreterChrono() {
  clearInterval(chrono.minuterie);
  chrono.minuterie = null;
}

function construireChrono(limiteMs, quandEcoule) {
  const bloc = el("div", "chrono");
  bloc.setAttribute("role", "timer");
  const texte = el("span", "chrono-texte");
  const jauge = el("div", "chrono-jauge");
  const remplissage = el("div", "chrono-remplissage");
  jauge.appendChild(remplissage);
  bloc.append(texte, jauge);

  const depart = performance.now();
  const rafraichir = () => {
    const restant = Math.max(0, limiteMs - (performance.now() - depart));
    const fraction = restant / limiteMs;
    texte.textContent = `${Math.ceil(restant / 1000)} s`;
    remplissage.style.width = `${fraction * 100}%`;
    bloc.classList.toggle("urgent", fraction <= 0.25);
    if (restant === 0) {
      arreterChrono();
      quandEcoule();
    }
  };

  arreterChrono();
  rafraichir();
  chrono.minuterie = setInterval(rafraichir, 100);
  return bloc;
}

function construireCadreImage(question) {
  const cadre = el("div", "cadre-image");
  const image = el("img");
  image.src = `${SERVEUR}${question.image}`;
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
    const lien = el("a", null, /wikimedia\.org/.test(credit.source) ? "Wikimedia Commons" : "source");
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

  // Sur ordinateur (flexbox) : chrono et question en haut, l'image à gauche,
  // les réponses et le retour à droite. Sur mobile, tout s'empile.
  const carte = el("div", "carte-question disposition-jeu");
  carte.appendChild(el("p", "enonce", question.question));
  if (question.indice) carte.appendChild(el("p", "indice-question", `Indice : ${question.indice}`));

  const corps = el("div", "corps-jeu");
  corps.appendChild(construireCadreImage(question));
  const colonne = el("div", "colonne-reponses");

  // Chaque réponse porte son numéro : les touches 1 à 4 la choisissent.
  const propositions = el("div", "propositions");
  question.propositions.forEach((choix, index) => {
    const bouton = el("button", "proposition");
    bouton.type = "button";
    bouton.dataset.choix = choix;
    const touche = el("kbd", "touche", String(index + 1));
    touche.setAttribute("aria-hidden", "true");
    bouton.append(touche, el("span", "proposition-texte", choix));
    bouton.addEventListener("click", () => repondre(choix, propositions, carte));
    propositions.appendChild(bouton);
  });
  colonne.appendChild(propositions);

  // Place réservée au retour et au crédit : sans elle, la carte grandit à
  // chaque réponse puis rétrécit à la question suivante, et la page saute.
  // Les modèles (astuce) et les pièces (explication) affichent un texte de
  // plus : leur zone est plus haute.
  const avecTexte = partie.mode === "modele" || partie.mode === "piece";
  const zoneRetour = el("div", `zone-retour${avecTexte ? " avec-astuce" : ""}`);
  // Rappel des raccourcis, visible seulement sur ordinateur.
  zoneRetour.appendChild(el("p", "retour-attente", "Touches 1 à 4 pour répondre, Entrée pour continuer."));
  colonne.appendChild(zoneRetour);

  corps.appendChild(colonne);
  carte.appendChild(corps);
  carte.insertBefore(
    construireChrono(question.tempsLimiteMs, () => repondre("", propositions, carte)),
    carte.firstChild,
  );

  // Le crédit est gardé de côté : le nom de l'auteur est souvent celui de la
  // marque, l'afficher avant la réponse donnerait la solution.
  carte.dataset.credit = JSON.stringify(question.credit || {});

  zone.replaceChildren(barre, jauge, carte);
  // La page a pu défiler pendant la correction : on remonte, sinon le chrono
  // de la nouvelle question reste hors de vue.
  window.scrollTo({ top: 0 });
}

async function repondre(choix, zonePropositions, carte) {
  if (partie.verrou) return;
  partie.verrou = true;
  arreterChrono();

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
  partie.historique.push({
    reponse: resultat.bonneReponse, choix, correcte: resultat.correcte, revision: resultat.revision,
  });

  if (resultat.badgeDebloque) {
    const { marque, palier } = resultat.badgeDebloque;
    const infos = PALIERS_BADGES[palier];
    toast(`${infos.icone} Badge ${infos.libelle.toLowerCase()} débloqué : ${marque} !`, "succes");
  }

  zonePropositions.querySelectorAll(".proposition").forEach((bouton) => {
    bouton.disabled = true;
    if (bouton.dataset.choix === resultat.bonneReponse) bouton.classList.add("correcte");
    else if (bouton.dataset.choix === choix) bouton.classList.add("incorrecte");
  });

  carte.querySelector(".chrono")?.classList.add("fige");

  let message = "Bonne réponse !";
  if (resultat.tempsEcoule) message = `Temps écoulé — c'était ${resultat.bonneReponse}`;
  else if (!resultat.correcte) message = `Raté — c'était ${resultat.bonneReponse}`;

  const retour = el("div", "retour-reponse");
  const texte = el("span", `retour-texte ${resultat.correcte ? "gagne" : "perdu"}`, message);
  retour.appendChild(texte);

  if (resultat.correcte) {
    const secondes = (resultat.dureeMs / 1000).toFixed(1).replace(".", ",");
    const points = el("span", "retour-points", `+${resultat.points} pts`);
    points.appendChild(el("span", "retour-bonus",
      ` dont +${resultat.bonusRapidite} rapidité (${secondes} s)`));
    retour.appendChild(points);
  }

  const boutons = el("div", "retour-actions");

  const suite = el("button", "btn btn-primary",
    resultat.terminee ? "Voir le résultat" : "Question suivante");
  suite.type = "button";
  suite.addEventListener("click", async () => {
    if (resultat.terminee) {
      afficherResultat();
      return;
    }
    suite.disabled = true;
    try {
      const { question } = await api(`/parties/${partie.id}/question`, { method: "POST" });
      afficherQuestion(question);
    } catch (erreur) {
      toast(erreur.message, "erreur");
      suite.disabled = false;
    }
  });
  if (resultat.revision) {
    // Nouvel onglet : la partie en cours reste ouverte.
    const reviser = el("a", "btn btn-secondary", "Réviser en 3D");
    reviser.href = resultat.revision;
    reviser.target = "_blank";
    reviser.rel = "noopener";
    boutons.appendChild(reviser);
  }
  boutons.appendChild(suite);
  retour.appendChild(boutons);

  const zoneRetour = carte.querySelector(".zone-retour") || carte;
  zoneRetour.querySelector(".retour-attente")?.remove();
  zoneRetour.appendChild(retour);

  // Pièces : à quoi sert la pièce, dans le même encadré que l'astuce des modèles.
  if (resultat.explication) {
    const explication = el("p", "astuce");
    explication.appendChild(el("strong", null, "À quoi ça sert : "));
    explication.appendChild(document.createTextNode(resultat.explication));
    zoneRetour.appendChild(explication);
  }

  // Comment reconnaître le modèle, montré une fois la réponse donnée.
  if (resultat.astuce) {
    const astuce = el("p", "astuce");
    astuce.appendChild(el("strong", null, "Comment le reconnaître : "));
    astuce.appendChild(document.createTextNode(resultat.astuce));
    zoneRetour.appendChild(astuce);
  }

  // Le crédit n'apparaît qu'une fois la réponse donnée.
  let credit = null;
  try {
    credit = JSON.parse(carte.dataset.credit || "{}");
  } catch { credit = null; }
  const blocCredit = construireCredit(credit);
  if (blocCredit) zoneRetour.appendChild(blocCredit);

  suite.focus({ preventScroll: true });
  retour.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

/* Récapitulatif de fin : chaque question avec la bonne réponse et, en cas
   d'erreur, ce qui avait été choisi et le lien pour réviser la pièce. */
function construireRecapitulatif() {
  if (!partie.historique.length) return null;
  const liste = el("ol", "recap");
  partie.historique.forEach((ligne) => {
    const item = el("li", `recap-ligne ${ligne.correcte ? "gagne" : "perdu"}`);
    item.appendChild(el("span", "recap-marque", ligne.correcte ? "✓" : "✗"));
    const texte = el("span", "recap-texte");
    texte.appendChild(el("strong", null, ligne.reponse));
    if (!ligne.correcte) {
      texte.appendChild(el("span", "recap-choix", ligne.choix ? ` — vous : ${ligne.choix}` : " — temps écoulé"));
    }
    item.appendChild(texte);
    if (!ligne.correcte && ligne.revision) {
      const lien = el("a", "recap-lien", "Réviser en 3D");
      lien.href = ligne.revision;
      lien.target = "_blank";
      lien.rel = "noopener";
      item.appendChild(lien);
    }
    liste.appendChild(item);
  });
  return liste;
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
  // Après les boutons, pour qu'ils restent visibles sans défiler.
  const recap = construireRecapitulatif();
  if (recap) carte.appendChild(recap);
  zone.replaceChildren(carte);
  window.scrollTo({ top: 0 });
}

/* Raccourcis clavier pendant une partie : 1 à 4 choisissent une réponse,
   Entrée passe à la question suivante (ou au résultat). */
function raccourcisJeu(evenement) {
  if (evenement.ctrlKey || evenement.altKey || evenement.metaKey || evenement.repeat) return;
  const cible = evenement.target;
  if (cible.closest && cible.closest("input, textarea, select, [contenteditable]")) return;

  const zone = document.getElementById("zone-jeu");
  if (/^[1-4]$/.test(evenement.key)) {
    const bouton = zone.querySelectorAll(".proposition")[Number(evenement.key) - 1];
    if (bouton && !bouton.disabled) {
      evenement.preventDefault();
      bouton.click();
    }
    return;
  }

  // Entrée sur un bouton déjà sélectionné : le navigateur le déclenche seul.
  if (evenement.key === "Enter" && !(cible instanceof HTMLButtonElement || cible instanceof HTMLAnchorElement)) {
    const suite = zone.querySelector(".retour-reponse .btn");
    if (suite && !suite.disabled) {
      evenement.preventDefault();
      suite.click();
    }
  }
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

  document.addEventListener("keydown", raccourcisJeu);

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
  partie.historique = [];
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
  let regions = [];
  try {
    [lignes, regions] = await Promise.all([
      api(`/classement${modeClassement ? `?mode=${modeClassement}` : ""}`),
      chargerRegions(),
    ]);
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
    const celluleJoueur = el("td", "cellule-joueur");
    const drapeau = creerDrapeau(ligne.region, regions);
    if (drapeau) celluleJoueur.appendChild(drapeau);
    celluleJoueur.appendChild(document.createTextNode(ligne.nom));
    tr.appendChild(celluleJoueur);
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

  document.getElementById("titre-profil").textContent = `Profil de ${utilisateur.nom}`;
  initFormulaireRegion(utilisateur);
  initProgression();
  initBadges();

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

/* Courbe de progression : en abscisse les parties dans l'ordre, en ordonnée
   leur score (difficulté et rapidité comprises). Les modèles rapportent
   1,5 fois plus : le sélecteur permet de suivre une épreuve seule. Dessinée en
   SVG, sans bibliothèque. */

const FILTRES_PROGRESSION = [
  ["tous", "Tous les modes"],
  ["logo", "Les logos"],
  ["modele", "Les modèles"],
  ["piece", "Les pièces"],
];

const FENETRE_MOYENNE = 5;
const NS_SVG = "http://www.w3.org/2000/svg";

function noeudSvg(balise, attributs = {}, classe = "") {
  const noeud = document.createElementNS(NS_SVG, balise);
  for (const [nom, valeur] of Object.entries(attributs)) noeud.setAttribute(nom, valeur);
  if (classe) noeud.setAttribute("class", classe);
  return noeud;
}

// Forme du point selon l'épreuve : rond, carré ou triangle, pour que la
// couleur ne soit jamais le seul moyen de les distinguer.
function formePoint(mode, x, y, r, classe) {
  if (mode === "modele") {
    return noeudSvg("rect", { x: x - r, y: y - r, width: 2 * r, height: 2 * r, rx: 1.5 }, classe);
  }
  if (mode === "piece") {
    const h = r * 1.25;
    return noeudSvg("path", { d: `M${x} ${y - h}L${x + h} ${y + h * 0.8}L${x - h} ${y + h * 0.8}Z` }, classe);
  }
  return noeudSvg("circle", { cx: x, cy: y, r }, classe);
}

// Moyenne des FENETRE_MOYENNE dernières parties, à partir de la 5e.
function moyenneGlissante(valeurs) {
  return valeurs.map((_, i) => {
    if (i < FENETRE_MOYENNE - 1) return null;
    const tranche = valeurs.slice(i - FENETRE_MOYENNE + 1, i + 1);
    return tranche.reduce((somme, v) => somme + v, 0) / tranche.length;
  });
}

function points(nombre) {
  return `${Math.round(nombre).toLocaleString("fr-FR")} pts`;
}

function libelleDifficulte(cle) {
  const trouvee = DIFFICULTES.find(([valeur]) => valeur === cle);
  return trouvee ? trouvee[1] : cle;
}

function pasGraduation(nombre) {
  return [1, 2, 5, 10, 20, 50, 100].find((pas) => nombre / pas <= 8) || 100;
}

function elementLegende(forme, texte) {
  const item = el("li");
  const icone = noeudSvg("svg", { width: 18, height: 12, "aria-hidden": "true" });
  icone.appendChild(forme);
  item.appendChild(icone);
  item.appendChild(document.createTextNode(texte));
  return item;
}

function dessinerProgression(zone, legende, parties, filtre) {
  const tous = filtre === "tous";
  const serie = tous ? parties : parties.filter((p) => p.mode === filtre);

  legende.replaceChildren();
  if (!serie.length) {
    zone.replaceChildren(creerEtatVide({
      icone: "📈",
      titre: tous ? "Pas encore de partie terminée" : `Aucune partie terminée pour ${libelleMode(filtre).toLowerCase()}`,
      message: "Terminez une partie pour voir votre courbe de progression.",
      lien: "index.html",
      libelleLien: "Jouer",
    }));
    return;
  }

  const scores = serie.map((p) => p.score);
  const moyennes = moyenneGlissante(scores);
  const avecMoyenne = serie.length >= FENETRE_MOYENNE;

  // Légende : les épreuves présentes (vue « Tous les modes »), puis la moyenne.
  if (tous) {
    Object.keys(MODES).filter((mode) => serie.some((p) => p.mode === mode)).forEach((mode) => {
      legende.appendChild(elementLegende(formePoint(mode, 9, 6, 4.5, `legende-forme serie-${mode}`), libelleMode(mode)));
    });
  }
  if (avecMoyenne) {
    legende.appendChild(elementLegende(
      noeudSvg("path", { d: "M0 6H18" }, "courbe-moyenne"),
      `Moyenne sur ${FENETRE_MOYENNE} parties`,
    ));
  }

  // Dimensions en pixels réels : le texte garde sa taille quelle que soit la largeur.
  const largeur = Math.max(280, Math.round(zone.clientWidth));
  const hauteur = largeur < 520 ? 220 : 260;
  const marge = { haut: 12, droite: 14, bas: 28, gauche: 48 };
  const utileL = largeur - marge.gauche - marge.droite;
  const utileH = hauteur - marge.haut - marge.bas;

  const maxScore = Math.max(...scores);
  const pasY = maxScore > 2000 ? 1000 : 500;
  const maxY = Math.max(pasY * 2, Math.ceil(maxScore / pasY) * pasY);
  const n = serie.length;
  const xDe = (i) => marge.gauche + (n === 1 ? utileL / 2 : (i * utileL) / (n - 1));
  const yDe = (v) => marge.haut + utileH - (v / maxY) * utileH;

  const dessin = noeudSvg("svg", {
    viewBox: `0 0 ${largeur} ${hauteur}`, width: largeur, height: hauteur,
    role: "img", tabindex: "0",
    "aria-label": `Score de vos ${n} dernières parties, de ${points(Math.min(...scores))} à ${points(maxScore)}. `
      + "Flèches gauche et droite pour parcourir les parties.",
  });

  // Grille horizontale et graduations des scores.
  for (let v = 0; v <= maxY; v += pasY) {
    dessin.appendChild(noeudSvg("line", { x1: marge.gauche, x2: largeur - marge.droite, y1: yDe(v), y2: yDe(v) }, "courbe-grille"));
    const texte = noeudSvg("text", { x: marge.gauche - 8, y: yDe(v) + 4, "text-anchor": "end" }, "courbe-axe-texte");
    texte.textContent = v.toLocaleString("fr-FR");
    dessin.appendChild(texte);
  }

  // Graduations des parties (numéro de partie).
  const pas = pasGraduation(n);
  serie.forEach((_, i) => {
    if (n > 1 && i !== 0 && (i + 1) % pas !== 0) return;
    const texte = noeudSvg("text", { x: xDe(i), y: hauteur - 8, "text-anchor": "middle" }, "courbe-axe-texte");
    texte.textContent = String(i + 1);
    dessin.appendChild(texte);
  });

  const trace = (valeurs) => valeurs
    .map((v, i) => (v === null ? null : `${xDe(i)} ${yDe(v)}`))
    .filter(Boolean)
    .map((p, i) => `${i ? "L" : "M"}${p}`).join("");

  // Un mode : ligne à sa couleur. Tous les modes : liaison neutre, la couleur
  // reste sur les points.
  if (n > 1) {
    dessin.appendChild(noeudSvg("path", { d: trace(scores) },
      tous ? "courbe-liaison" : `courbe-ligne serie-${filtre}`));
  }
  if (avecMoyenne) dessin.appendChild(noeudSvg("path", { d: trace(moyennes) }, "courbe-moyenne"));

  const repere = noeudSvg("line", { y1: marge.haut, y2: marge.haut + utileH }, "courbe-repere");
  dessin.appendChild(repere);

  const rayon = n > 60 ? 3.5 : 4.5;
  const marques = serie.map((p, i) => {
    const marque = formePoint(p.mode, xDe(i), yDe(p.score), rayon, `courbe-point serie-${p.mode}`);
    dessin.appendChild(marque);
    return marque;
  });

  // Bulle d'information : au survol, au doigt ou au clavier.
  const bulle = el("div", "bulle-courbe");
  bulle.hidden = true;
  let actif = -1;

  const montrer = (i) => {
    if (actif >= 0) marques[actif].classList.remove("actif");
    actif = i;
    const p = serie[i];
    marques[i].classList.add("actif");
    repere.setAttribute("x1", xDe(i));
    repere.setAttribute("x2", xDe(i));
    repere.classList.add("visible");

    const titre = el("div", "bulle-titre");
    const icone = noeudSvg("svg", { width: 12, height: 12, "aria-hidden": "true" });
    icone.appendChild(formePoint(p.mode, 6, 6, 4.5, `legende-forme serie-${p.mode}`));
    titre.appendChild(icone);
    titre.appendChild(document.createTextNode(`Partie ${i + 1} · ${libelleMode(p.mode)}`));
    bulle.replaceChildren(
      titre,
      el("strong", null, points(p.score)),
      el("div", null, `${p.bonnes_reponses}/${p.nb_questions} bonnes réponses`),
      el("div", null, `Difficulté : ${libelleDifficulte(p.difficulte).toLowerCase()}`),
      el("div", null, dateCourte(p.date_fin)),
    );
    if (moyennes[i] !== null) bulle.appendChild(el("div", null, `Moyenne : ${points(moyennes[i])}`));
    bulle.hidden = false;

    // Bulle à droite du point, ou à gauche si elle déborderait.
    const x = xDe(i);
    const gauche = x + 14 + bulle.offsetWidth > largeur ? x - 14 - bulle.offsetWidth : x + 14;
    const haut = Math.min(Math.max(0, yDe(p.score) - bulle.offsetHeight / 2), hauteur - bulle.offsetHeight);
    bulle.style.transform = `translate(${Math.max(0, gauche)}px, ${haut}px)`;
  };

  const cacher = () => {
    if (actif >= 0) marques[actif].classList.remove("actif");
    actif = -1;
    repere.classList.remove("visible");
    bulle.hidden = true;
  };

  // Partie la plus proche du pointeur en abscisse : la cible est toute la
  // colonne, pas seulement le petit point.
  const suivrePointeur = (evenement) => {
    const cadre = dessin.getBoundingClientRect();
    const x = ((evenement.clientX - cadre.left) / cadre.width) * largeur;
    const i = n === 1 ? 0 : Math.round(((x - marge.gauche) / utileL) * (n - 1));
    montrer(Math.min(n - 1, Math.max(0, i)));
  };
  // pointerdown : un simple appui du doigt ne déclenche pas pointermove.
  dessin.addEventListener("pointermove", suivrePointeur);
  dessin.addEventListener("pointerdown", suivrePointeur);
  dessin.addEventListener("pointerleave", cacher);
  dessin.addEventListener("blur", cacher);
  dessin.addEventListener("keydown", (evenement) => {
    if (evenement.key !== "ArrowLeft" && evenement.key !== "ArrowRight") return;
    evenement.preventDefault();
    const sens = evenement.key === "ArrowRight" ? 1 : -1;
    montrer(actif < 0 ? n - 1 : Math.min(n - 1, Math.max(0, actif + sens)));
  });

  zone.replaceChildren(dessin, bulle);
}

function resumeProgression(parties, filtre) {
  const serie = filtre === "tous" ? parties : parties.filter((p) => p.mode === filtre);
  if (!serie.length) return "";
  const nb = `${serie.length} partie${serie.length > 1 ? "s" : ""}`;
  if (serie.length < FENETRE_MOYENNE * 2) {
    return `${nb}. Meilleur score : ${points(Math.max(...serie.map((p) => p.score)))}.`;
  }
  const moyenne = (tranche) => tranche.reduce((s, p) => s + p.score, 0) / tranche.length;
  const recentes = moyenne(serie.slice(-FENETRE_MOYENNE));
  const avant = moyenne(serie.slice(-FENETRE_MOYENNE * 2, -FENETRE_MOYENNE));
  const ecart = Math.round(recentes - avant);
  const tendance = ecart === 0 ? "stable" : `${ecart > 0 ? "+" : "−"}${points(Math.abs(ecart))}`;
  return `${nb}. Moyenne des ${FENETRE_MOYENNE} dernières : ${points(recentes)} `
    + `(${tendance} par rapport aux ${FENETRE_MOYENNE} précédentes).`;
}

async function initProgression() {
  const zone = document.getElementById("courbe-progression");
  if (!zone) return;
  const legende = document.getElementById("legende-progression");
  const resume = document.getElementById("resume-progression");

  let parties;
  try {
    ({ parties } = await api("/ma-progression"));
  } catch {
    toast("Impossible de charger votre progression.", "erreur");
    return;
  }

  let filtre = "tous";
  const afficher = () => {
    resume.textContent = resumeProgression(parties, filtre);
    dessinerProgression(zone, legende, parties, filtre);
  };

  const zoneFiltre = document.getElementById("filtre-progression");
  zoneFiltre.replaceChildren(...FILTRES_PROGRESSION.map(([cle, libelle]) => {
    const puce = el("button", "puce", libelle);
    puce.type = "button";
    puce.setAttribute("aria-pressed", String(cle === filtre));
    puce.addEventListener("click", () => {
      filtre = cle;
      zoneFiltre.querySelectorAll(".puce").forEach((autre, index) => {
        autre.setAttribute("aria-pressed", String(FILTRES_PROGRESSION[index][0] === cle));
      });
      afficher();
    });
    return puce;
  }));

  afficher();

  // Redessine à la bonne largeur quand la fenêtre change de taille.
  let largeurConnue = zone.clientWidth;
  new ResizeObserver(() => {
    if (Math.abs(zone.clientWidth - largeurConnue) < 2) return;
    largeurConnue = zone.clientWidth;
    afficher();
  }).observe(zone);
}

/* Badges : un par marque du quiz des logos, en bronze, argent puis or selon
   le nombre de logos trouvés. Les seuils viennent du serveur. */

const PALIERS_BADGES = {
  bronze: { libelle: "Bronze", icone: "🥉" },
  argent: { libelle: "Argent", icone: "🥈" },
  or: { libelle: "Or", icone: "🥇" },
};

const FILTRES_BADGES = [
  ["tous", "Tous"],
  ["obtenus", "Obtenus"],
  ["a-debloquer", "À débloquer"],
];

/* Comme les images des questions, les logos ne sont pas publics : ils sont
   téléchargés avec le jeton du joueur, puis affichés. */
async function chargerLogoBadge(image, chemin) {
  try {
    const reponse = await fetch(`${SERVEUR}${chemin}`, { headers: { Authorization: lireJeton() } });
    if (!reponse.ok) return;
    image.src = URL.createObjectURL(await reponse.blob());
  } catch { /* logo absent : la médaille reste vide */ }
}

function carteBadge(badge) {
  const carte = el("article", `badge ${badge.palier ? `badge-${badge.palier}` : "badge-verrouille"}`);

  const medaille = el("div", "badge-medaille");
  if (badge.logo) {
    const logo = el("img");
    logo.alt = "";
    chargerLogoBadge(logo, badge.logo);
    medaille.appendChild(logo);
  } else {
    // Marque jamais trouvée : son logo la trahirait dans le quiz.
    medaille.appendChild(el("span", "badge-initiale", badge.marque.charAt(0)));
  }
  carte.appendChild(medaille);

  carte.appendChild(el("div", "badge-nom", badge.marque));
  carte.appendChild(el("div", "badge-palier",
    badge.palier ? PALIERS_BADGES[badge.palier].libelle : "À débloquer"));

  const jauge = el("div", "badge-jauge");
  const remplissage = el("div", "badge-jauge-remplissage");
  const cible = badge.prochain ? badge.prochain.seuil : badge.bonnes;
  remplissage.style.width = `${cible ? Math.min(100, (badge.bonnes / cible) * 100) : 0}%`;
  jauge.appendChild(remplissage);
  carte.appendChild(jauge);

  carte.appendChild(el("div", "badge-compte", badge.prochain
    ? `${badge.bonnes} / ${badge.prochain.seuil} vers ${PALIERS_BADGES[badge.prochain.nom].libelle.toLowerCase()}`
    : `${badge.bonnes} logos trouvés`));

  carte.title = `${badge.marque} : ${badge.bonnes} logo${badge.bonnes > 1 ? "s" : ""} trouvé${badge.bonnes > 1 ? "s" : ""}`;
  return carte;
}

async function initBadges() {
  const grille = document.getElementById("grille-badges");
  if (!grille) return;

  let donnees;
  try {
    donnees = await api("/mes-badges");
  } catch {
    toast("Impossible de charger vos badges.", "erreur");
    return;
  }

  const { badges, paliers } = donnees;
  const parPalier = (nom) => badges.filter((b) => b.palier === nom).length;
  const obtenus = badges.filter((b) => b.palier).length;
  const decompte = paliers.slice().reverse()
    .map((p) => `${PALIERS_BADGES[p.nom].icone} ${parPalier(p.nom)}`).join("   ");
  const regle = paliers
    .map((p) => `${PALIERS_BADGES[p.nom].libelle.toLowerCase()} à ${p.seuil}`).join(", ");
  document.getElementById("resume-badges").textContent =
    `${obtenus} badge${obtenus > 1 ? "s" : ""} sur ${badges.length} marques   ${decompte}. `
    + `Logos d'une même marque à trouver : ${regle}.`;

  let filtre = "tous";
  const afficher = () => {
    const visibles = badges.filter((b) =>
      filtre === "tous" || (filtre === "obtenus" ? b.palier : !b.palier));
    if (!visibles.length) {
      grille.replaceChildren(creerEtatVide({
        icone: "🏅",
        titre: filtre === "obtenus" ? "Aucun badge pour l'instant" : "Tous les badges sont débloqués",
        message: filtre === "obtenus"
          ? `Trouvez ${paliers[0].seuil} fois le logo d'une même marque pour gagner son badge bronze.`
          : "Visez maintenant l'or pour chaque marque !",
        lien: filtre === "obtenus" ? "index.html" : null,
        libelleLien: "Jouer",
      }));
      return;
    }
    grille.replaceChildren(...visibles.map(carteBadge));
  };

  const zoneFiltre = document.getElementById("filtre-badges");
  zoneFiltre.replaceChildren(...FILTRES_BADGES.map(([cle, libelle]) => {
    const puce = el("button", "puce", libelle);
    puce.type = "button";
    puce.setAttribute("aria-pressed", String(cle === filtre));
    puce.addEventListener("click", () => {
      filtre = cle;
      zoneFiltre.querySelectorAll(".puce").forEach((autre, index) => {
        autre.setAttribute("aria-pressed", String(FILTRES_BADGES[index][0] === cle));
      });
      afficher();
    });
    return puce;
  }));

  afficher();
}

function initFormulaireRegion(utilisateur) {
  const formulaire = document.getElementById("form-region");
  if (!formulaire) return;

  const select = formulaire.elements.region;
  remplirChoixRegion(select, utilisateur.region);

  formulaire.addEventListener("submit", async (evenement) => {
    evenement.preventDefault();
    const bouton = formulaire.querySelector("button[type='submit']");
    bouton.disabled = true;
    try {
      const misAJour = await api("/moi", {
        method: "PATCH",
        body: JSON.stringify({ region: select.value }),
      });
      afficherDrapeauNav(misAJour.region);
      toast("Région enregistrée.", "succes");
    } catch (erreur) {
      toast(erreur.message, "erreur");
    }
    bouton.disabled = false;
  });
}

/* ==========================================================================
   Administration
   ========================================================================== */

/* Les images ne sont pas publiques (leur nom donnerait la réponse) : la
   vignette est téléchargée avec le jeton d'administrateur, puis affichée. */
async function chargerVignette(image, questionId) {
  try {
    const reponse = await fetch(`${SERVEUR}/api/quiz/admin/questions/${questionId}/image`, {
      headers: { Authorization: lireJeton() },
    });
    if (!reponse.ok) return;
    image.src = URL.createObjectURL(await reponse.blob());
  } catch { /* vignette absente, la ligne reste utilisable */ }
}

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
    vignette.alt = "";
    vignette.width = 64;
    chargerVignette(vignette, question.id);
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

async function seConnecter(courriel, motDePasse) {
  const reponse = await api("/api/collections/users/auth-with-password", {
    method: "POST",
    body: JSON.stringify({
      identity: String(courriel || "").trim().toLowerCase(),
      password: motDePasse,
    }),
  });
  ecrireJeton(reponse.token);
}

function initFormulaireConnexion() {
  const formulaire = document.getElementById("form-connexion");
  if (!formulaire) return;

  formulaire.addEventListener("submit", async (evenement) => {
    evenement.preventDefault();
    const donnees = new FormData(formulaire);
    const bouton = formulaire.querySelector("button[type='submit']");
    bouton.disabled = true;

    try {
      await seConnecter(donnees.get("courriel"), donnees.get("mot-de-passe"));
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

  remplirChoixRegion(formulaire.elements.region, "");

  formulaire.addEventListener("submit", async (evenement) => {
    evenement.preventDefault();
    const donnees = new FormData(formulaire);
    const bouton = formulaire.querySelector("button[type='submit']");
    bouton.disabled = true;

    try {
      const motDePasse = donnees.get("mot-de-passe");
      await api("/api/collections/users/records", {
        method: "POST",
        body: JSON.stringify({
          name: donnees.get("nom"),
          email: String(donnees.get("courriel") || "").trim().toLowerCase(),
          password: motDePasse,
          passwordConfirm: motDePasse,
          region: donnees.get("region") || "",
        }),
      });
      await seConnecter(donnees.get("courriel"), motDePasse);
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
      const sombre = valeur === "sombre";
      bouton.textContent = sombre ? "☀️" : "🌙";
      bouton.setAttribute("aria-label", sombre ? "Passer au thème clair" : "Passer au thème sombre");
    }
  };

  let theme = null;
  try { theme = localStorage.getItem("theme"); } catch { theme = null; }
  appliquer(theme);

  if (bouton) {
    bouton.addEventListener("click", () => {
      const nouveau = racine.getAttribute("data-theme") === "sombre" ? "" : "sombre";
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
  if (lireJeton()) {
    try { utilisateur = await api("/moi"); } catch { utilisateur = null; }
  }

  if (utilisateur) {
    if (elements.connexion) elements.connexion.hidden = true;
    if (elements.inscription) elements.inscription.hidden = true;
    if (elements.deconnexion) elements.deconnexion.hidden = false;
    if (elements.profil) elements.profil.hidden = false;
    if (elements.admin) elements.admin.hidden = utilisateur.role !== "admin";
    afficherDrapeauNav(utilisateur.region);
  }

  if (elements.deconnexion) {
    elements.deconnexion.addEventListener("click", async (evenement) => {
      evenement.preventDefault();
      ecrireJeton("");
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
