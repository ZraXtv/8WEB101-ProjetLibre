# Auto Quiz — projet libre 8WEB101 (Automne 2026)

Jeu de quiz automobile : reconnaître les marques à leur logo, les modèles
sur photo et les pièces mécaniques, avec classement, statistiques par joueur
et un explorateur 3D (« Anatomie 3D ») d'une Porsche 911 et de son moteur.

Le serveur est [PocketBase](https://pocketbase.io) : un seul programme qui
gère la base de données, les comptes, le stockage des images et sert le
site. La logique du jeu tourne dans PocketBase sous forme de hooks
JavaScript. L'ancienne version (serveur Flask) est conservée dans
[backup/](backup/).

## Lancer le projet

Tout se passe dans le dossier `pocketbase/`. Au premier lancement, la base
est créée et les 88 questions de logos y sont chargées automatiquement.

```bash
cd pocketbase
cp .env.example .env     # puis renseigner ADMIN_EMAIL et ADMIN_PASSWORD
./demarrer.sh            # Linux / macOS
```

Sous Windows : `powershell -ExecutionPolicy Bypass -File demarrer.ps1`.

Avec Docker (ou Podman), sans rien installer d'autre :

```bash
cd pocketbase
cp .env.example .env
docker compose up --build
```

Puis ouvrir :

- le site : http://127.0.0.1:8090
- le tableau de bord PocketBase : http://127.0.0.1:8090/_/ (compte de `.env`)

Les scripts téléchargent la version de PocketBase indiquée dans
`pocketbase/VERSION`, pour le bon système et le bon processeur, et vérifient
son empreinte SHA-256. Pour changer de version, modifier ce seul fichier.

### Administrateurs

Il y a deux sortes de comptes :

- le **superutilisateur** du tableau de bord PocketBase, créé à partir de
  `.env` à chaque démarrage ;
- les **joueurs**, inscrits depuis le site. Pour donner à un joueur l'accès
  à la page « Admin » du site : tableau de bord → collection `users` → le
  joueur → champ `role` → `admin`. Un joueur ne peut pas se donner ce rôle
  lui-même (règles d'accès de la collection).

## Structure

```
pocketbase/
├── pb_migrations/      structure de la base (collections, règles, limites)
│   ├── 1790000000_structure.js
│   └── 1790000001_questions_logos.js   chargement des 88 logos
├── pb_hooks/           logique côté serveur
│   ├── quiz.pb.js          API du jeu (/api/quiz/…)
│   ├── securite.pb.js      politique de mots de passe, en-têtes HTTP
│   └── quiz/               modules partagés par les hooks
├── pb_public/          le site : pages, CSS, JS, polices, explorateur 3D
├── donnees/            questions de départ et leurs images (non publiques)
├── outils/simplifier.mjs   allègement des modèles 3D (voir pb_public/anatomie/README.md)
├── demarrer.sh / demarrer.ps1, Dockerfile, docker-compose.yml
├── .env.example        réglages propres à chaque machine
├── VERSION             version de PocketBase utilisée
└── pb_data/            base de données et fichiers (créé au lancement, ignoré par git)
backup/                 ancienne version Flask, pour référence
```

Les **migrations** sont appliquées automatiquement au démarrage, une seule
fois chacune : une machine neuve obtient exactement la même base. Pour faire
évoluer la structure, la modifier depuis le tableau de bord : PocketBase
écrit alors lui-même une nouvelle migration dans `pb_migrations/`, à
commiter. Ne pas retoucher une migration déjà appliquée.

### Ajouter des questions

Depuis le tableau de bord, collection `questions` : choisir le mode, la
réponse, l'image, la difficulté (1 à 3) et cocher `actif`. Les épreuves
« modèles » et « pièces » s'ouvrent automatiquement à partir de 4 questions.
La page « Admin » du site permet ensuite d'activer, désactiver ou recalibrer
les questions.

## Comment marche une partie

1. Le navigateur demande une partie (`POST /api/quiz/parties`) en précisant
   l'épreuve et la difficulté.
2. Le serveur tire 10 questions au hasard et, pour chacune, fabrique
   4 propositions : la bonne réponse et trois réponses piochées parmi les
   autres questions de la même épreuve. Ces propositions sont **figées en
   base** au moment du tirage.
3. Le navigateur reçoit l'image et les 4 propositions, **mais jamais
   l'indication de la bonne réponse**. L'image passe par une adresse neutre
   (`/api/quiz/parties/<id>/image`) : le nom du fichier, qui contient souvent
   la marque, n'est jamais exposé.
4. À chaque réponse (`POST /api/quiz/parties/<id>/reponse`), le serveur
   compare, calcule les points et n'envoie qu'ensuite la solution.
5. La question suivante n'est envoyée que lorsque le joueur clique sur
   « Question suivante » (`POST /api/quiz/parties/<id>/question`), ce qui
   démarre son chrono. Le temps passé à lire la correction ne compte donc
   pas, et l'image de la question suivante n'est pas accessible avant.

C'est le point de conception le plus important : si le navigateur
connaissait la réponse à l'avance, n'importe qui pourrait la lire dans les
outils de développement et le classement n'aurait aucune valeur. Pour la
même raison, la collection `questions` n'est pas lisible par l'API standard
de PocketBase : seuls les hooks du jeu et le tableau de bord y accèdent.

### Barème

- 100 points par bonne réponse, multipliés par la difficulté (1 à 3)
- jusqu'à 100 points de bonus selon la rapidité, dégressif sur 20 secondes
- 20 secondes par question : passé ce délai (plus 1,5 s de tolérance pour le
  réseau), la réponse compte comme fausse. Le chrono affiché n'est
  qu'indicatif : le temps compté est mesuré par le serveur.

### Difficulté des logos

| Niveau | Contenu | Exemples |
|---|---|---|
| Facile (28) | le logo est le nom écrit | Ford, Lamborghini, Fiat |
| Moyen (10) | nom intégré au dessin | BMW, MINI, Bentley |
| Difficile (50) | symbole nu, aucun texte | Ferrari, Maybach, Moskvitch |

## API

Les comptes utilisent l'API standard de PocketBase
(`/api/collections/users/records` pour l'inscription,
`/api/collections/users/auth-with-password` pour la connexion). Le jeton
obtenu est envoyé dans l'en-tête `Authorization`. Le jeu a sa propre API :

| Méthode | Route | Description |
|---|---|---|
| GET | `/api/quiz/moi` | Joueur connecté |
| GET | `/api/quiz/modes` | Épreuves et nombre de questions disponibles |
| POST | `/api/quiz/parties` | Lancer une partie |
| POST | `/api/quiz/parties/<id>/question` | Afficher la question en cours et démarrer son chrono |
| GET | `/api/quiz/parties/<id>/image` | Image de la question en cours |
| POST | `/api/quiz/parties/<id>/reponse` | Répondre à la question en cours |
| GET | `/api/quiz/classement?mode=` | Meilleurs scores |
| GET | `/api/quiz/mes-statistiques` | Statistiques personnelles |
| GET | `/api/quiz/admin/questions` | Lister les questions (admin) |
| PATCH | `/api/quiz/admin/questions/<id>` | Activer ou recalibrer une question (admin) |
| GET | `/api/quiz/admin/questions/<id>/image` | Vignette d'une question (admin) |
| GET | `/api/quiz/admin/utilisateurs` | Lister les comptes (admin) |

## Sécurité

- Mots de passe hachés par PocketBase (bcrypt), 10 caractères minimum ;
  refus des mots de passe courants, uniquement numériques, ou contenant le
  pseudonyme ou le courriel (`pb_hooks/quiz/comptes.js`).
- Limites de requêtes par adresse IP, sur 15 minutes : 30 connexions,
  10 inscriptions, 60 parties (réglées dans la migration de structure).
- Connexion par jeton en en-tête, jamais par cookie : pas de faille CSRF
  possible.
- Collections du jeu fermées à l'API standard ; un joueur ne peut ni lire
  les réponses, ni modifier une partie, ni se donner le rôle admin.
- Images des questions en fichiers protégés, servies uniquement par le jeu.
- En-têtes : CSP stricte (une CSP à part pour l'explorateur 3D, avec
  l'empreinte de son importmap calculée au démarrage),
  `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
  `Permissions-Policy`, `Cross-Origin-Opener-Policy`.
- Le contenu venant du serveur est inséré dans les pages avec
  `textContent`, ce qui neutralise le XSS stocké.

## Mise en ligne

Le dossier `pocketbase/` se déploie tel quel chez un hébergeur qui fait
tourner PocketBase (PocketHost, Fly.io, un petit serveur VPS avec Docker…),
derrière HTTPS. Mettre alors `PB_HTTP=0.0.0.0:8090` dans `.env`.

Pour héberger les pages sur **GitHub Pages** et PocketBase ailleurs :
publier le contenu de `pocketbase/pb_public/`, renseigner l'adresse du
serveur dans la constante `SERVEUR` en haut de `pb_public/js/main.js`, et
autoriser le site dans `PB_ORIGINS` (par exemple
`https://zraxtv.github.io`). Le serveur PocketBase doit être en HTTPS.

## Anatomie 3D

`pb_public/anatomie/` contient un explorateur 3D (Three.js) d'une Porsche
911 et de son moteur : vue éclatée, visite guidée au défilement, fiche par
composant. Accessible depuis le menu « Anatomie 3D ». Son code est basé sur
[focus-parts-explorer](https://github.com/Gigadad11/focus-parts-explorer)
de Gigadad11 (licence MIT). Détails, performances et crédits des modèles
dans [pb_public/anatomie/README.md](pocketbase/pb_public/anatomie/README.md).

## Images et licences

Toutes les images de logos viennent de **Wikimedia Commons**, sous licence
libre (domaine public ou Creative Commons). L'auteur, la licence et le lien
vers la page d'origine sont enregistrés avec chaque question et **affichés
dans le jeu après chaque réponse** : pas avant, car le nom de l'auteur est
souvent celui de la marque.

La méthode de sélection (Wikidata, contrôle visuel, recadrage automatique
pour retirer le nom de la marque) est décrite dans
[backup/README.md](backup/README.md) ; les scripts Python correspondants
sont dans `backup/backend/` et restent utilisables pour préparer de
nouvelles images.

Les logos restent des marques déposées. Leur usage ici est pédagogique et
non commercial, sans lien ni approbation des constructeurs.
