/// <reference path="../../pb_data/types.d.ts" />

/* Régions des joueurs et difficulté des logos selon la région (traduit de
   backup/backend/regions.py, écrit par Senku).

   La difficulté enregistrée (questions.difficulte) mesure la notoriété d'un
   symbole « en général ». Elle ne dit pas tout : une Subaru est banale au
   Canada et rare en France, une Dacia l'inverse. Pour un joueur qui a
   renseigné sa région, la difficulté d'un logo est donc recalculée ici :

     1. une marque nationale ou omniprésente dans le pays prend la valeur de
        PAYS[region] (souvent 1, facile) ;
     2. sinon, la valeur du marché (MARCHES) s'applique si la marque y est
        nettement plus ou moins visible qu'ailleurs ;
     3. sinon, la difficulté de base reste.

   Le résultat sert à la fois au filtre Facile / Moyen / Difficile et au
   barème (les points sont multipliés par la difficulté) : il est figé au
   tirage de la partie, dans questions_partie.difficulte.
   La liste des codes est aussi déclarée dans la migration 1790000002. */

// code (nom du drapeau dans pb_public/assets/drapeaux/) -> [nom, marché]
const REGIONS = {
  ca: ["Canada", "amerique"],
  us: ["États-Unis", "amerique"],
  fr: ["France", "europe"],
  be: ["Belgique", "europe"],
  ch: ["Suisse", "europe"],
  gb: ["Royaume-Uni", "europe"],
  de: ["Allemagne", "europe"],
  it: ["Italie", "europe"],
  es: ["Espagne", "europe"],
  se: ["Suède", "europe"],
  jp: ["Japon", "asie"],
  kr: ["Corée du Sud", "asie"],
  cn: ["Chine", "asie"],
};

// Écarts propres à tout un marché, par rapport à la difficulté de base.
const MARCHES = {
  europe: {
    // Marques européennes courantes sur les routes.
    "Dacia": 1, "Škoda": 1, "Alfa Romeo": 2, "DS Automobiles": 2,
    // Marques nord-américaines ou japonaises peu vendues en Europe.
    "Subaru": 2, "Chevrolet": 2, "Dodge": 2, "Lexus": 2,
    "Buick": 3, "Lincoln": 3,
  },
  amerique: {
    // Absentes du continent, ou parties depuis longtemps.
    "Opel": 3, "Citroën": 3, "Renault": 3, "Dacia": 3, "DS Automobiles": 3,
    "Škoda": 3, "Alpine": 3, "Lada": 3, "Suzuki": 2,
    // Omniprésentes en Amérique du Nord.
    "Chevrolet": 1, "Dodge": 1, "Buick": 1, "Lincoln": 1, "Lexus": 1,
    "Oldsmobile": 2, "DeLorean": 2,
  },
  asie: {
    "Opel": 3, "Dacia": 3, "Citroën": 2, "Renault": 2, "Chevrolet": 2,
    "Lexus": 1, "Daihatsu": 2,
  },
};

// Marques nationales ou très répandues dans un pays précis.
const PAYS = {
  ca: { "Subaru": 1, "Mazda": 1, "Hyundai": 1, "Mitsubishi": 1, "Oldsmobile": 2 },
  us: { "Tesla": 1, "Subaru": 1, "AMC": 2, "Studebaker": 2 },
  fr: { "Citroën": 1, "Renault": 1, "DS Automobiles": 1, "Alpine": 1, "Simca": 2, "Talbot": 2 },
  be: { "Citroën": 1, "Renault": 1, "DS Automobiles": 2 },
  ch: {},
  gb: { "Aston Martin": 1, "Bentley": 1, "McLaren": 1, "Rolls-Royce": 1, "Talbot": 2 },
  de: { "Opel": 1, "Maybach": 2, "Borgward": 2, "Horch": 2, "Hanomag": 2 },
  it: { "Alfa Romeo": 1, "Maserati": 1, "Autobianchi": 2, "De Tomaso": 2 },
  es: {},
  se: { "Volvo": 1, "Polestar": 1, "Koenigsegg": 1 },
  jp: { "Daihatsu": 1, "Subaru": 1, "Suzuki": 1 },
  kr: { "Hyundai": 1, "SsangYong": 1 },
  cn: { "Chery": 1, "Great Wall": 1, "Changan": 1, "Nio": 1, "XPeng": 1, "Buick": 1 },
};

function regionValide(code) {
  return Object.prototype.hasOwnProperty.call(REGIONS, code);
}

function listerRegions() {
  return Object.keys(REGIONS).map((code) => ({ code, nom: REGIONS[code][0] }));
}

/** Difficulté d'un logo pour un joueur de cette région (base si aucune). */
function difficultePour(marque, base, region) {
  if (!regionValide(region)) return base;
  if (Object.prototype.hasOwnProperty.call(PAYS[region], marque)) return PAYS[region][marque];
  const marche = MARCHES[REGIONS[region][1]];
  return Object.prototype.hasOwnProperty.call(marche, marque) ? marche[marque] : base;
}

module.exports = { REGIONS, regionValide, listerRegions, difficultePour };
