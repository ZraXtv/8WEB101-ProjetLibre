# Auto Quiz — projet libre 8WEB101 (Automne 2026)

Jeu de quiz automobile : reconnaître les marques à leur logo, les modèles
sur photo, et les pièces mécaniques.

## Lancer le projet

Le serveur sert à la fois l'API et les pages, sur un seul port.

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate          # Windows : .venv\Scripts\activate
pip install -r requirements.txt
python3 importer_marques.py        # télécharge les logos (une seule fois)
pip install Pillow                 # nécessaire seulement pour l'étape suivante
python3 recadrer_logos.py --apercu # vérifier le résultat dans data/apercu_recadrage/
python3 recadrer_logos.py --appliquer
python3 charger_questions.py       # crée les questions en base
python3 app.py
```

Puis ouvrir http://127.0.0.1:5000

### Compte administrateur

Inscrivez-vous normalement, puis :

```bash
cd backend && source .venv/bin/activate
python3 promouvoir_admin.py votre@courriel.com
```

Le panneau d'administration permet d'activer/désactiver chaque question et
d'ajuster sa difficulté.

## État d'avancement

| Épreuve | État |
|---|---|
| Logos de marques | 64 questions prêtes |
| Modèles de voitures | à importer (images libres disponibles sur Commons) |
| Pièces automobiles | à importer (images libres disponibles sur Commons) |

Autres pistes : mode « série » sans limite de questions, badges, questions à saisie libre.

## Comment marche une partie

1. Le navigateur demande une partie (`POST /api/parties`) en précisant
   l'épreuve et la difficulté.
2. Le serveur tire 10 questions au hasard et, pour chacune, fabrique
   4 propositions : la bonne réponse et trois réponses piochées parmi les
   autres questions de la même épreuve. Ces propositions sont **figées en
   base** au moment du tirage.
3. Le navigateur reçoit l'image et les 4 propositions, **mais jamais
   l'indication de la bonne réponse**.
4. À chaque réponse (`POST /api/parties/<id>/reponse`), le serveur compare,
   calcule les points et n'envoie qu'ensuite la solution.
5. La question suivante n'est envoyée que lorsque le joueur clique sur
   « Question suivante » (`POST /api/parties/<id>/question`), ce qui démarre
   son chrono. Le temps passé à lire la correction ne compte donc pas, et
   l'image n'est pas visible avant le départ du compte à rebours.

C'est le point de conception le plus important : si le navigateur
connaissait la réponse à l'avance, n'importe qui pourrait la lire dans
les outils de développement et le classement n'aurait aucune valeur.

Le chronomètre du bonus de rapidité est lui aussi tenu côté serveur : une
durée envoyée par le navigateur serait triviale à falsifier.

### Retirer le nom de la marque des logos

Beaucoup de logos automobiles écrivent le nom à côté ou sous l'emblème, ce
qui rend la question triviale. `recadrer_logos.py` isole le symbole
automatiquement : il repère les pixels « encrés », cherche un couloir vide
qui sépare deux blocs, et écarte celui qui ressemble à un bandeau de texte
(large et plat). L'opération est répétée jusqu'à quatre fois — « CITROËN »
sous les chevrons demande deux passes, une pour la lettre isolée et une
pour le reste du mot.

Quand le symbole touche le texte (le trait de Moskvitch, la couronne de
Horch), un cadre fixe (`CADRES`) découpe le symbole seul.

Quand le nom fait partie du dessin, aucun recadrage ne suffit : `MASQUES`
l'efface. Les lettres du rondel BMW et de la bague Alfa Romeo sont repeintes
avec la couleur de l'anneau, angle par angle pour garder les reflets. Le mot
« VOLVO », le « MINI » central, les cartouches d'Aston Martin et de Borgward
sont remplis avec le fond. Les inscriptions du blason Porsche sont recouvertes
d'un dégradé entre les couleurs au-dessus et au-dessous.

Vingt-quatre logos *sont* le nom de la marque (Ford, Fiat, Jeep, Kia,
Nissan...) : il n'y a rien à isoler, ils sont donc retirés du quiz
(`LOGOS_TEXTUELS` dans `charger_questions.py`).

Toujours lancer `--apercu` avant `--appliquer` : le résultat s'écrit dans
`data/apercu_recadrage/` sans toucher aux originaux, pour pouvoir le
vérifier à l'œil. Les images étant remplacées sur place, on peut nommer les
logos à traiter (`--appliquer proton bmw`) pour ne pas retravailler les autres.

### Difficulté des logos

Plus aucun logo ne montre le nom de la marque : la difficulté dépend de la
notoriété du symbole.

| Niveau | Exemples |
|---|---|
| Facile (20) | Audi, BMW, Mercedes-Benz, Toyota, Volkswagen |
| Moyen (17) | Alfa Romeo, Aston Martin, Lexus, Maserati, Škoda |
| Difficile (27) | Borgward, Horch, Moskvitch, Perodua, Zastava |

### Barème

- 100 points par bonne réponse, multipliés par la difficulté (1 à 3)
- jusqu'à 100 points de bonus selon la rapidité, dégressif sur 20 secondes
- 20 secondes par question : passé ce délai (plus 1,5 s de tolérance pour le
  réseau), la réponse compte comme fausse. Un chrono visible décompte le temps
  restant ; il n'est qu'indicatif, le temps compté est mesuré par le serveur.

## API

| Méthode | Route | Description |
|---|---|---|
| POST | `/api/inscription` | Créer un compte |
| POST | `/api/connexion` | Se connecter |
| POST | `/api/deconnexion` | Fermer la session |
| GET | `/api/moi` | Utilisateur connecté |
| GET | `/api/modes` | Épreuves et nombre de questions disponibles |
| POST | `/api/parties` | Lancer une partie |
| POST | `/api/parties/<id>/question` | Afficher la question en cours et démarrer son chrono |
| POST | `/api/parties/<id>/reponse` | Répondre à la question en cours |
| GET | `/api/classement?mode=` | Meilleurs scores |
| GET | `/api/mes-statistiques` | Statistiques personnelles |
| GET | `/api/admin/questions` | Lister les questions (admin) |
| PATCH | `/api/admin/questions/<id>` | Activer ou recalibrer une question (admin) |
| GET | `/api/admin/utilisateurs` | Lister les comptes (admin) |

## Images et licences

Toutes les images viennent de **Wikimedia Commons** et ne sont retenues que
si leur licence est libre (domaine public ou Creative Commons). La plupart
des logos automobiles sont dans le domaine public : une forme géométrique
ou un texte simple n'est pas protégeable par le droit d'auteur.

Les noms de fichiers ne sont pas devinés ni cherchés en texte libre — les
deux méthodes renvoient trop souvent le mauvais fichier (« Ferrari World
Abu Dhabi » pour Ferrari). Ils viennent de **Wikidata**, propriété P154
(« logo »), via une requête SPARQL qui liste les constructeurs automobiles
triés par notoriété. La liste des marques retenues est ensuite curée à la
main : on écarte les motos, les poids lourds, les holdings comme Stellantis
et les écuries de course.

Six marques ont été écartées après contrôle visuel parce que Wikidata
pointait vers une photo de calandre plutôt qu'un logo (Cadillac, Morris,
Vauxhall, Lotus, Mahindra) ou vers une image contenant deux marques (SEAT).

Autre limite de Wikidata : la propriété « logo » donne le logo d'entreprise
**courant**, qui est souvent un lettrage alors que la marque est connue pour
son blason. Ferrari renvoyait ainsi le mot « Ferrari » au lieu du cheval
cabré, Maybach un M simple au lieu du double M. Ces cas sont corrigés à la
main dans `REMPLACEMENTS` (Ferrari, Maybach, Aston Martin, McLaren, Bentley,
Renault, BMW, Mercedes-Benz).

Le cheval cabré de Ferrari n'existe pas en vectoriel sous licence libre — le
dessin est protégé, seules des photographies du blason sont réutilisables.
Le script recadre donc automatiquement la photo sur le jaune de Modène.

L'auteur, la licence et le lien vers la page d'origine sont enregistrés
pour chaque image (`backend/sources_images.json`) et **affichés dans le jeu
après chaque réponse** — pas avant, car le nom de l'auteur est souvent
celui de la marque et donnerait la solution.

Les fichiers sont téléchargés en PNG plutôt qu'en SVG : un SVG peut
contenir du script, un PNG non.

Les logos restent des marques déposées. Leur usage ici est pédagogique et
non commercial, sans lien ni approbation des constructeurs.

## Sécurité

- Mots de passe hachés avec *scrypt*, jamais stockés en clair.
- Politique de mot de passe : 10 caractères minimum, refus des mots de
  passe courants et de ceux contenant le pseudonyme ou le courriel.
- Anti-force brute : 5 échecs par compte et 30 par adresse IP sur 15
  minutes (limite IP large : un campus partage une adresse publique).
- Comparaison à temps constant même quand le compte n'existe pas, sinon le
  temps de réponse révèle quelles adresses sont inscrites.
- Session régénérée à la connexion, cookie `HttpOnly` + `SameSite=Lax`,
  `Secure` dès que `COOKIE_SECURE=1`.
- Protection CSRF par *double submit cookie* (en-tête `X-CSRF-Token`).
- Clé secrète tirée au hasard dans `backend/data/secret_key`, jamais en dur.
- Requêtes SQL paramétrées ; le tri et les filtres viennent de listes fermées.
- Aucune donnée serveur insérée en HTML : le JavaScript construit le DOM
  avec `textContent`, ce qui neutralise le XSS stocké.
- En-têtes : CSP, `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`.
- Le serveur ne sert que les pages `.html` de la racine et les dossiers
  `css/`, `js/`, `assets/` : sans cette liste blanche, la base et le code
  source seraient téléchargeables.
- Base de données remise en permissions `600` au démarrage.
- Réponses de l'API en `Cache-Control: no-store`.
- Débogueur Werkzeug désactivé par défaut (il permet d'exécuter du code à
  distance) ; activable avec `FLASK_DEBUG=1` en local.

Limite connue : le compteur anti-abus est en mémoire, à remplacer par
Redis ou une table si le site tourne un jour sur plusieurs processus. Le
serveur de développement Flask ne doit pas être exposé tel quel.

## Performances

- Polices hébergées localement (79 Ko, versions variables, sous-ensemble
  latin) : aucune connexion externe, et le rendu n'attend pas un tiers.
- Index SQL sur les colonnes utilisées par le tirage et le classement.
- Compression gzip des réponses texte, cache navigateur sur les images.
- Session et contenu demandés en parallèle au chargement.
- Thème appliqué avant le premier rendu (`js/theme.js` dans le `<head>`).

## Structure

```
projet/
├── index.html          choix de l'épreuve et de la difficulté
├── jeu.html            écran de jeu
├── classement.html     meilleurs scores
├── profil.html         statistiques personnelles
├── connexion.html / inscription.html
├── admin.html          gestion des questions
├── css/style.css
├── js/main.js, js/theme.js
├── assets/
│   ├── fonts/          polices hébergées localement
│   └── images/logos/   images des questions
└── backend/
    ├── app.py              serveur Flask (API + pages)
    ├── db.py, schema.sql
    ├── importer_marques.py téléchargement des logos depuis Commons
    ├── recadrer_logos.py   retire le nom de la marque des logos
    ├── charger_questions.py
    ├── promouvoir_admin.py
    └── data/               base SQLite (ignoré par git)
```
