# Anatomie mécanique

Explorateur 3D d'une Porsche 911 avec son moteur et du moteur seul : vue éclatée, ouverture du coffre avant, fiche par composant, peintures, vue transparente. Tout est servi en local : aucun CDN, aucun compte, aucune requête externe.

## Lancer

La page est servie par le serveur du quiz (voir le README à la racine) :
lancer `python3 app.py` dans `backend/`, puis ouvrir
http://127.0.0.1:5000/anatomie/index.html, ou cliquer sur « Anatomie 3D »
dans le menu du site.

Les modules JavaScript ne fonctionnent pas en `file://` : la page doit
toujours passer par un serveur HTTP.

## Utilisation

- Sélecteur « Porsche 911 », « Moteur » en haut à droite. Liens directs : `?model=porsche`, `?model=moteur`.
- Sur la Porsche, la fiche du moteur propose « Explorer le moteur pièce par pièce ».
- Glisser pour tourner, molette ou pincement pour zoomer.
- Curseur « Vue éclatée » (ou touche `E`) pour écarter les pièces.
- Clic sur une pièce, ou dans la liste, pour ouvrir sa fiche. `Échap` pour fermer.
- « Isoler la pièce » masque tout le reste.
- « Visite guidée » : la page défile, la voiture s'éclate pendant le premier écran puis chaque écran suivant cadre une pièce et affiche sa fiche. `Échap` ou « Quitter la visite » pour revenir à l'exploration libre. Les étapes sont listées dans le champ `tour` du `.json` : un identifiant de composant (`"coffre"`), un composant avec des pièces à masquer pendant l'étape (`{ "id": "aileron", "hide": ["moteur"] }`), ou un système entier présenté d'un bloc, les autres pièces estompées (`{ "system": "Distribution", "desc": "…" }`, utilisé pour le moteur). Sans ce champ, toutes les pièces si le modèle en a 20 au plus, sinon le bouton est masqué.
- « Charger un .glb » ou glisser-déposer un fichier : n'importe quel modèle est découpé automatiquement en composants (Draco et Meshopt pris en charge).

## Structure

```
index.html                 interface
style.css                  styles (fichier séparé : la CSP du site interdit les styles inline)
app.js                     logique (Three.js r170)
models/porsche-911.glb     Porsche 911 série G avec le moteur 911 SC monté dans sa baie (moteur allégé, voir Performances)
models/porsche-911.json    composants, ouverture du coffre avant, quatre teintes
models/moteur-911sc.glb    moteur Porsche 911 SC, 266 pièces assemblées (allégé, voir Performances)
models/moteur-911sc.json   114 composants en 13 systèmes, avec références Porsche
models/index.json          liste des modèles proposés dans le sélecteur
vendor/                    Three.js, addons, décodeurs Draco/Meshopt, three-mesh-bvh, police Archivo
outils/simplifier.mjs      script d'allègement d'une partie d'un .glb (Node.js)
LICENSE-focus-parts-explorer  licence MIT du projet d'origine du code
```

## Ajouter une voiture avec ses fiches

1. Copier le `.glb` dans `models/`.
2. Le charger une première fois avec « Charger un .glb » : la liste affiche les noms des objets du modèle.
3. Créer `models/ma-voiture.json` sur le modèle de `porsche-911.json`, puis l'ajouter dans `models/index.json` pour qu'il apparaisse dans le sélecteur.

Champs d'un composant :

| Champ | Rôle |
|---|---|
| `id`, `name`, `system` | identifiant, nom affiché, système de rattachement |
| `nodes` | noms des objets du `.glb` qui forment la pièce (leurs enfants suivent) |
| `dir`, `dist` | direction d'éclatement (x gauche, y haut, z avant) et distance en mètres |
| `offset` | à la place de `dir`/`dist` : déplacement exact `[x, y, z]` en mètres. Un nœud peut aussi être `{ "name": …, "offset": […] }` pour bouger seul |
| `shell` | `true` pour la carrosserie : rendue transparente ou masquée selon la vue |
| `open` | `{ "axis": "z", "angle": -68 }` rotation autour du pivot de l'objet, en degrés |
| `desc`, `points` | texte de la fiche |

Au niveau racine : `scale` multiplie toutes les distances, `dolly` règle le recul de la caméra pendant l'éclatement, `unit` vaut `"mm"` pour afficher les cotes en millimètres, `openings` crée les boutons d'ouverture, `paints` relie des pastilles aux variantes `KHR_materials_variants` du modèle.

Pour que portes et capot s'ouvrent correctement, leur origine doit être placée sur la charnière dans Blender avant l'export.

## Performances

- **Moteur de la Porsche allégé** : il représentait 87 % des triangles de la
  voiture (1,68 million sur 1,92). Il est simplifié à 383 000 triangles dans
  `porsche-911.glb` avec `outils/simplifier.mjs` (part visée 15 %, erreur
  tolérée 2 % de la taille de chaque pièce), et les normales sont recalculées
  avec des arêtes vives au-delà de 30°.
- **Modèle « Moteur » allégé** de 1,68 million à 627 000 triangles, avec un
  réglage plus doux puisqu'on le regarde de près (part visée 30 %, erreur
  tolérée 0,8 %) : `node simplifier.mjs moteur-911sc.glb sortie.glb Engine911SC 0.3 0.008`.
  Les fichiers d'origine des deux modèles restent dans l'historique git
  (commit `d850bad`) pour relancer le script avec d'autres réglages.
- **Pièces estompées** (vue transparente, étapes de la visite) : un matériau
  sans éclairage de la même couleur, au lieu du matériau réaliste recalculé
  pour chaque couche transparente superposée.
- **Survol et clic** : une BVH (three-mesh-bvh) évite de tester chaque
  triangle ; elle se construit en tâche de fond après le chargement.
- **Rendu à la demande** : une image n'est dessinée que si la caméra, une
  pièce ou un matériau change ; l'ombre au sol reste figée pendant les
  mouvements et n'est recalculée qu'une fois les pièces arrêtées.
- **Verre** : les matériaux à transmission (réfraction) sont remplacés par une
  simple transparence, qui évite un second rendu complet de la scène.
- Résolution plafonnée à 1,5× sur les écrans haute densité.

## Crédits

Le code de l'explorateur (`app.js`, `index.html`, `style.css`) est basé sur [focus-parts-explorer](https://github.com/Gigadad11/focus-parts-explorer) de Gigadad11, licence MIT (texte complet dans `LICENSE-focus-parts-explorer`). Il a été adapté ici : modèles et textes en français, intégration au site du quiz, optimisations et visite guidée.

Porsche « Free 1975 Porsche 911 (930) Turbo » de Lionsharp Studios, licence CC BY 4.0 (github.com/BigSmoke4/3D-Porsche-911), textures réduites et pièces renommées. Moteur Porsche 911 SC 3.0 (type 930/03) de Joseph Schneider (github.com/josephschneider77-sys/porsche-911sc-engine), licence ISC ; textes traduits et regroupés en français. Three.js et three-mesh-bvh sous licence MIT. Police Archivo sous licence SIL OFL.
