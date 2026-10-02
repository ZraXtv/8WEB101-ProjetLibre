// Allège un sous-ensemble d'un .glb (par exemple le moteur monté dans la
// Porsche) sans toucher aux noms de nœuds, auxquels le .json du modèle se
// réfère, ni au reste du fichier.
//
// Prérequis (dans un dossier de travail, pas dans le projet) :
//   npm i @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions meshoptimizer
// Usage :
//   node simplifier.mjs source.glb sortie.glb Moteur911SC 0.15 0.02
//   (nœud racine à alléger, part des triangles visée, erreur tolérée relative
//   à la taille de chaque pièce)
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dequantize, quantize, reorder, simplifyPrimitive, weldPrimitive } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

const [src, dst, racine, ratio, erreur] = process.argv.slice(2);
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder,
});
const doc = await io.read(src);
const root = doc.getRoot();
const buffer = root.listBuffers()[0];

const tris = (p) => (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3;
const cible = root.listNodes().find((n) => n.getName() === racine);
const meshes = new Set();
cible.traverse((n) => { if (n.getMesh()) meshes.add(n.getMesh()); });
// Un maillage partagé avec le reste du modèle ne doit pas être simplifié.
for (const n of root.listNodes()) {
  let o = n, dedans = false;
  while (o) { if (o === cible) { dedans = true; break; } o = o.getParentNode(); }
  if (!dedans && n.getMesh()) meshes.delete(n.getMesh());
}

/* Normales « à arêtes vives » : lisses sur les surfaces courbes, cassées
   au-delà de `angle` entre deux faces, comme sur une pièce usinée. Le
   maillage doit être indexé et soudé (un seul sommet par position). La
   primitive est réécrite avec un sommet par coin de triangle, puis ressoudée. */
function creaseNormals(prim, angle = Math.PI / 6) {
  const pos = prim.getAttribute('POSITION').getArray(), index = prim.getIndices().getArray();
  const n = index.length, nv = pos.length / 3;
  const unit = new Float32Array(n), area = new Float32Array(n);
  for (let f = 0; f < n / 3; f++) {
    const [a, b, c] = [index[3 * f], index[3 * f + 1], index[3 * f + 2]].map((v) => 3 * v);
    const ux = pos[c] - pos[b], uy = pos[c + 1] - pos[b + 1], uz = pos[c + 2] - pos[b + 2];
    const vx = pos[a] - pos[b], vy = pos[a + 1] - pos[b + 1], vz = pos[a + 2] - pos[b + 2];
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx, l = Math.hypot(x, y, z) || 1;
    area.set([x, y, z], 3 * f);
    unit.set([x / l, y / l, z / l], 3 * f);
  }
  // Faces adjacentes à chaque sommet, rangées à plat (format CSR).
  const start = new Uint32Array(nv + 1);
  for (let i = 0; i < n; i++) start[index[i] + 1]++;
  for (let v = 0; v < nv; v++) start[v + 1] += start[v];
  const fill = start.slice(0, -1), adj = new Uint32Array(n);
  for (let i = 0; i < n; i++) adj[fill[index[i]]++] = (i / 3) | 0;

  const limit = Math.cos(angle), outPos = new Float32Array(n * 3), outNor = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const f = (i / 3) | 0, v = index[i];
    let x = 0, y = 0, z = 0;
    for (let k = start[v]; k < start[v + 1]; k++) {
      const g = adj[k];
      if (unit[3 * f] * unit[3 * g] + unit[3 * f + 1] * unit[3 * g + 1] + unit[3 * f + 2] * unit[3 * g + 2] < limit) continue;
      x += area[3 * g]; y += area[3 * g + 1]; z += area[3 * g + 2];
    }
    const l = Math.hypot(x, y, z) || 1;
    outNor.set([x / l, y / l, z / l], 3 * i);
    outPos.set(pos.subarray(3 * v, 3 * v + 3), 3 * i);
  }
  const old = prim.getAttribute('POSITION');
  prim.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(outPos).setBuffer(buffer));
  prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(outNor).setBuffer(buffer));
  prim.setIndices(null);
  old.dispose();
  weldPrimitive(prim);
}

let avant = 0, apres = 0;
await doc.transform(dequantize());
for (const m of meshes) for (const p of m.listPrimitives()) {
  avant += tris(p);
  // Pièces de CAO : chaque arête vive duplique ses sommets (une normale par
  // face), ce qui bloque le simplificateur. Sans les normales, les sommets se
  // soudent ; elles sont recalculées après coup.
  p.setAttribute('NORMAL', null);
  weldPrimitive(p);
  simplifyPrimitive(p, { simplifier: MeshoptSimplifier, ratio: +ratio, error: +erreur, lockBorder: false });
  creaseNormals(p);
  apres += tris(p);
}
await doc.transform(reorder({ encoder: MeshoptEncoder }), quantize());
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
await io.write(dst, doc);
console.log(`${meshes.size} maillages, triangles (sans instances) : ${avant} -> ${apres}`);
