# Anatomie mécanique

Explorateur 3D d'une Porsche 911 avec son moteur, du moteur seul et d'une voiture concept : vue éclatée, ouverture des portes et du capot, fiche par composant, peintures, vue transparente. Tout est servi en local : aucun CDN, aucun compte, aucune requête externe.

## Lancer

La page est servie par le serveur du quiz (voir le README à la racine) :
lancer `python3 app.py` dans `backend/`, puis ouvrir
http://127.0.0.1:5000/anatomie/index.html, ou cliquer sur « Anatomie 3D »
dans le menu du site.

Les modules JavaScript ne fonctionnent pas en `file://` : la page doit
toujours passer par un serveur HTTP.

## Utilisation

- Sélecteur « Porsche 911 », « Moteur », « Concept Car » en haut à droite. Liens directs : `?model=porsche`, `?model=moteur`, `?model=concept`.
- Sur la Porsche, la fiche du moteur propose « Explorer le moteur pièce par pièce ».
- Glisser pour tourner, molette ou pincement pour zoomer.
- Curseur « Vue éclatée » (ou touche `E`) pour écarter les pièces.
- Clic sur une pièce, ou dans la liste, pour ouvrir sa fiche. `Échap` pour fermer.
- « Isoler la pièce » masque tout le reste.
- « Charger un .glb » ou glisser-déposer un fichier : n'importe quel modèle est découpé automatiquement en composants (Draco et Meshopt pris en charge).

## Structure

```
index.html                 interface
style.css                  styles (fichier séparé : la CSP du site interdit les styles inline)
app.js                     logique (Three.js r170)
models/porsche-911.glb     Porsche 911 série G avec le moteur 911 SC monté dans sa baie
models/porsche-911.json    composants, ouverture du coffre avant, quatre teintes
models/concept-car.glb     voiture concept
models/concept-car.json    composants, textes, ouvertures, peintures
models/moteur-911sc.glb    moteur Porsche 911 SC, 266 pièces assemblées
models/moteur-911sc.json   114 composants en 13 systèmes, avec références Porsche
models/index.json          liste des modèles proposés dans le sélecteur
vendor/                    Three.js, addons, décodeurs Draco/Meshopt, police Archivo
```

## Ajouter une voiture avec ses fiches

1. Copier le `.glb` dans `models/`.
2. Le charger une première fois avec « Charger un .glb » : la liste affiche les noms des objets du modèle.
3. Créer `models/ma-voiture.json` sur le modèle de `concept-car.json`, puis l'ajouter dans `models/index.json` pour qu'il apparaisse dans le sélecteur.

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

## Crédits

Porsche « Free 1975 Porsche 911 (930) Turbo » de Lionsharp Studios, licence CC BY 4.0 (github.com/BigSmoke4/3D-Porsche-911), textures réduites et pièces renommées. Modèle « Car Concept » du Khronos Group, d'après un modèle de Unity Fan, licence CC BY 4.0 (l'attribution doit rester affichée). Moteur Porsche 911 SC 3.0 (type 930/03) de Joseph Schneider (github.com/josephschneider77-sys/porsche-911sc-engine), licence ISC ; textes traduits et regroupés en français. Three.js sous licence MIT. Police Archivo sous licence SIL OFL.
