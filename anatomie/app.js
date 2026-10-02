import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from './vendor/three-mesh-bvh/index.module.js';

/* Survol et clic : sans index spatial, le rayon de la souris était testé
   contre chacun des centaines de milliers de triangles du modèle. La BVH
   (hiérarchie de boîtes) ramène ça à quelques dizaines de tests. Une
   géométrie sans BVH, le temps qu'elle se construise, garde le test classique. */
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

/* Modèles proposés : models/index.json. Choix par l'URL : ?model=moteur, ou ?config=models/autre.json */
const CATALOG_URL = 'models/index.json';
const query = new URLSearchParams(location.search);

const $ = (s) => document.querySelector(s);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const nfInt = new Intl.NumberFormat('fr-FR');
const STAGGER = 0.4;
const DOLLY = 0.35;

/* ---------- Scène ---------- */
const canvas = $('#scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
// 1,5 au lieu de 2 : sur un écran haute densité, c'est près de deux fois moins
// de pixels à calculer, pour une différence à peine visible avec l'antialiasing.
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// L'ombre au sol ne dépend que de la position des pièces, pas de la caméra :
// elle n'est recalculée que lorsqu'une pièce bouge (voir frame()).
renderer.shadowMap.autoUpdate = false;

/* Rendu à la demande : une image n'est dessinée que si quelque chose a changé
   (caméra, pièce, matériau, taille de fenêtre). À l'arrêt, la carte graphique
   ne travaille plus. */
let dirty = true, shadowDirty = true, shadowPending = false;
const redraw = () => { dirty = true; };
const moved = () => { dirty = shadowDirty = true; };

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.95;

const camera = new THREE.PerspectiveCamera(36, innerWidth / innerHeight, 0.05, 200);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.495;
controls.minDistance = 1.5;
controls.maxDistance = 22;
controls.addEventListener('change', redraw);

const sun = new THREE.DirectionalLight(0xffffff, 1.7);
sun.position.set(4, 9, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 0.5, far: 30 });
sun.shadow.bias = -0.0004;
sun.shadow.radius = 4;
scene.add(sun, new THREE.HemisphereLight(0xffffff, 0x8a9199, 0.35));

const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.2 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
const ring = new THREE.Mesh(new THREE.RingGeometry(1, 1.004, 160), new THREE.MeshBasicMaterial({ color: 0x17202a, transparent: true, opacity: 0.22 }));
ring.rotation.x = -Math.PI / 2;
ring.position.y = 0.002;
scene.add(ground, ring);

const carGroup = new THREE.Group();
scene.add(carGroup);

/* ---------- État ---------- */
const S = {
  config: null, gltf: null, parts: [], byId: new Map(), meshes: [], owner: new Map(),
  t: 0, tTarget: 0, selected: null, hovered: null, view: 'complet', isolated: false,
  openings: new Map(), accent: new THREE.Color('#a3162b'), variants: [], paint: null, size: new THREE.Vector3(),
  focus: null,
  // Visite guidée : étapes, étape en cours (-1 = introduction), pièce cadrée.
  tour: null
};

/* ---------- Chargement ---------- */
const loader = new GLTFLoader();
// Décodeurs servis en local : les .glb compressés (Draco, Meshopt) s'ouvrent aussi.
loader.setDRACOLoader(new DRACOLoader().setDecoderPath('vendor/addons/libs/draco/'));
loader.setMeshoptDecoder(MeshoptDecoder);
const sanitize = (n) => THREE.PropertyBinding.sanitizeNodeName(n);

function setLoad(text, pct, isError) {
  $('#loadText').textContent = text;
  $('#loadText').classList.toggle('load-err', !!isError);
  if (pct != null) $('#loadBar').style.width = pct + '%';
  $('#loader').classList.remove('done');
}

let catalog = [];
async function boot() {
  try {
    const res = await fetch(CATALOG_URL);
    if (res.ok) catalog = await res.json();
  } catch { /* pas de catalogue : un seul modèle */ }
  const wanted = catalog.find((m) => m.id === query.get('model')) || catalog[0];
  buildChooser(wanted?.id);
  await loadConfig(query.get('config') || wanted?.config || 'models/porsche-911.json');
}

function buildChooser(current) {
  const box = $('#models');
  box.innerHTML = '';
  box.style.display = catalog.length > 1 ? '' : 'none';
  for (const m of catalog) {
    const b = document.createElement('button');
    b.className = 'seg'; b.textContent = m.label; b.dataset.model = m.id;
    b.setAttribute('aria-pressed', m.id === current);
    b.onclick = async () => {
      if (b.getAttribute('aria-pressed') === 'true') return;
      box.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b));
      history.replaceState(null, '', `?model=${m.id}`);
      await loadConfig(m.config);
    };
    box.appendChild(b);
  }
}

async function loadConfig(url) {
  exitTour();
  try {
    setLoad('Chargement de la configuration', 2);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} introuvable (HTTP ${res.status})`);
    const config = await res.json();
    const gltf = await new Promise((ok, ko) => loader.load(config.model, ok, (e) => {
      if (e.total) setLoad(`Chargement du modèle ${Math.round((e.loaded / e.total) * 100)} %`, 5 + (e.loaded / e.total) * 90);
    }, ko));
    await mountCar(gltf, config);
    setView('complet');
    setExplode(0);
    $('#search').value = '';
    renderIndex();
  } catch (err) {
    const local = location.protocol === 'file:';
    setLoad(local
      ? "La page est ouverte en file://, le navigateur bloque le chargement. Lancer un serveur HTTP dans le dossier (par exemple python3 -m http.server) puis ouvrir http://localhost:8000."
      : `Le modèle n'a pas pu être chargé : ${err.message || err}`, 100, true);
    console.error(err);
  }
}

function disposeCar() {
  bvhRun++;
  for (const m of S.meshes) { m.userData.own.userData.ghost?.dispose(); m.userData.own.dispose(); }
  carGroup.clear();
  S.parts = []; S.byId.clear(); S.meshes = []; S.owner.clear(); S.openings.clear();
  S.selected = null; S.hovered = null; S.isolated = false; S.t = S.tTarget = 0; S.variants = [];
  closeSheet();
}

async function mountCar(gltf, config, title) {
  disposeCar();
  S.gltf = gltf;
  const root = gltf.scene;
  carGroup.add(root);

  // Pose la voiture au sol, centrée.
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  box.getSize(S.size);
  const c = box.getCenter(new THREE.Vector3());
  root.position.sub(new THREE.Vector3(c.x, box.min.y, c.z));
  root.updateMatrixWorld(true);

  if (!config) { config = autoConfig(root); if (title) config.title = title; }
  S.config = config;

  // Matériaux propres à chaque maillage pour pouvoir surligner une pièce sans toucher aux autres.
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = o.receiveShadow = true;
    o.material = o.userData.own = prepMaterial(o.material.clone());
    S.meshes.push(o);
  });

  buildParts(root, config);
  buildVariants(gltf, config);
  buildUI(config);

  // Caméra
  const len = Math.max(S.size.x, S.size.z);
  controls.minDistance = len * 0.3;
  controls.maxDistance = len * 6;
  ring.scale.setScalar(len * 0.62);
  if (config.camera) {
    camera.position.fromArray(config.camera.position);
    controls.target.fromArray(config.camera.target);
  } else {
    controls.target.set(0, S.size.y * 0.45, 0);
    camera.position.set(len * 1.05, len * 0.55, len * 1.15);
  }
  // Écran en portrait : on recule pour que la voiture tienne en largeur.
  if (camera.aspect < 1) camera.position.sub(controls.target).multiplyScalar(Math.min(2.2, 0.9 / camera.aspect)).add(controls.target);
  controls.update();
  applyMaterials();
  moved();
  $('#loader').classList.add('done');
  buildBoundsTrees(S.meshes);
}

/* Construit les BVH par petits lots entre deux images, pour que la page reste
   fluide pendant ce temps. Un changement de modèle interrompt la construction. */
let bvhRun = 0;
async function buildBoundsTrees(meshes) {
  const run = ++bvhRun;
  const geometries = [...new Set(meshes.map((m) => m.geometry))];
  let budget = performance.now() + 8;
  for (const g of geometries) {
    if (run !== bvhRun) return;
    if (!g.boundsTree) g.computeBoundsTree();
    if (performance.now() > budget) {
      await new Promise((r) => setTimeout(r, 0));
      budget = performance.now() + 8;
    }
  }
}

function prepMaterial(m) {
  // La transmission (verre réfractant) oblige three.js à dessiner toute la
  // scène une seconde fois à chaque image. Un verre simplement transparent
  // rend presque pareil pour une fraction du coût.
  if (m.transmission > 0) {
    m.opacity = Math.min(m.opacity, 0.35);
    m.transparent = true;
    m.depthWrite = false;
    m.transmission = 0;
  }
  m.userData.base = {
    opacity: m.opacity, transparent: m.transparent, depthWrite: m.depthWrite,
    emissive: m.emissive ? m.emissive.clone() : null, emissiveIntensity: m.emissiveIntensity ?? 1,
    transmission: m.transmission ?? 0
  };
  return m;
}

function buildParts(root, config) {
  const registered = new Map();
  const scale = config.auto ? 1 : (config.scale ?? 1);
  const parts = [];

  for (const def of config.parts) {
    // Un nœud peut être un nom, ou { name, offset } pour lui donner son propre déplacement.
    const refs = def.objects ? def.objects.map((o) => ({ obj: o })) : def.nodes.map((n) => {
      const name = typeof n === 'string' ? n : n.name;
      return { name, offset: n.offset, obj: root.getObjectByName(sanitize(name)) || root.getObjectByName(name) };
    });
    const ok = refs.filter((r) => { if (!r.obj) console.warn(`Nœud introuvable pour « ${def.name} » :`, r.name); return !!r.obj; });
    const nodes = ok.map((r) => r.obj);
    if (!nodes.length && !def.fallback) continue;
    const part = { ...def, nodes, nodeOffsets: ok.map((r) => r.offset), meshes: [], center: new THREE.Vector3(), restBox: new THREE.Box3(), tris: 0, open: def.open ? { ...def.open } : null };
    for (const n of nodes) registered.set(n, part);
    parts.push(part);
  }

  // Chaque maillage appartient à la pièce enregistrée la plus proche dans sa hiérarchie.
  let fallback = parts.find((p) => p.fallback);
  for (const m of S.meshes) {
    let o = m, owner = null;
    while (o && !owner) { owner = registered.get(o); o = o.parent; }
    if (!owner) {
      if (!fallback) { fallback = { id: 'autres', name: 'Autres éléments', system: config.systems.at(-1), nodes: [], meshes: [], center: new THREE.Vector3(), restBox: new THREE.Box3(), tris: 0, dir: [0, 0, 0], dist: 0, desc: 'Éléments du modèle non rattachés à un composant.', points: [] }; parts.push(fallback); }
      owner = fallback;
    }
    owner.meshes.push(m);
    S.owner.set(m, owner);
  }

  const offset = new THREE.Vector3(), wp = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
  for (const p of parts) {
    for (const m of p.meshes) {
      p.restBox.expandByObject(m);
      const g = m.geometry;
      p.tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    }
    p.restBox.getCenter(p.center);
    if (p.offset) offset.fromArray(p.offset).multiplyScalar(scale);
    else {
      offset.fromArray(p.dir || [0, 0, 0]);
      if (offset.lengthSq() > 0) offset.normalize().multiplyScalar((p.dist ?? 0) * scale);
    }
    p.offsetWorld = offset.clone();
    p.reach = offset.length();
    p.nodeData = p.nodes.map((n, i) => {
      const o = p.nodeOffsets?.[i] ? new THREE.Vector3().fromArray(p.nodeOffsets[i]).multiplyScalar(scale) : offset;
      p.reach = Math.max(p.reach, o.length());
      n.getWorldPosition(wp);
      a.copy(wp); b.copy(wp).add(o);
      n.parent.worldToLocal(a); n.parent.worldToLocal(b);
      return { node: n, pos: n.position.clone(), quat: n.quaternion.clone(), local: b.clone().sub(a) };
    });
    if (p.open) {
      const ax = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[p.open.axis] || p.open.axis;
      p.open.axisVec = new THREE.Vector3().fromArray(ax).normalize();
      p.open.rad = THREE.MathUtils.degToRad(p.open.angle);
      p.open.v = 0; p.open.target = 0;
    }
  }

  // Ordre d'éclatement : l'extérieur part en premier, puis l'intérieur.
  const order = [...parts].sort((x, y) => (y.shell ? 1 : 0) - (x.shell ? 1 : 0) || y.reach - x.reach);
  order.forEach((p, i) => { p.delay = order.length > 1 ? (i / (order.length - 1)) * STAGGER : 0; });

  S.parts = parts;
  for (const p of parts) S.byId.set(p.id, p);
}

/* Configuration générée pour un .glb quelconque : un composant par objet de premier niveau. */
function autoConfig(root) {
  const tri = (o) => { let n = 0; o.traverse((m) => { if (m.isMesh) { const g = m.geometry; n += (g.index ? g.index.count : g.attributes.position.count) / 3; } }); return n; };
  let base = root;
  while (base.children.length === 1 && !base.isMesh) base = base.children[0];
  const total = tri(base) || 1;
  let cands = base.children.filter((c) => tri(c) > 0);
  for (let pass = 0; pass < 3; pass++) {
    const next = [];
    for (const c of cands) {
      const kids = c.children.filter((k) => tri(k) > 0);
      if (kids.length > 1 && tri(c) > total * 0.3 && !c.isMesh) next.push(...kids); else next.push(c);
    }
    cands = next;
  }
  if (cands.length > 60) cands = cands.sort((x, y) => tri(y) - tri(x)).slice(0, 60);

  const rootBox = new THREE.Box3().setFromObject(base);
  const center = rootBox.getCenter(new THREE.Vector3());
  const size = rootBox.getSize(new THREE.Vector3());
  const len = Math.max(size.x, size.z);
  const vol = size.x * size.y * size.z || 1;
  const pretty = (s, i) => (s || '').replace(/[_\-.]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim() || `Pièce ${i + 1}`;
  const used = new Map();

  const parts = cands.map((o, i) => {
    const bb = new THREE.Box3().setFromObject(o);
    const c = bb.getCenter(new THREE.Vector3());
    const s = bb.getSize(new THREE.Vector3());
    const d = c.clone().sub(center);
    d.y *= 0.6;
    if (d.lengthSq() < 1e-6) d.set(0, 1, 0);
    const big = (s.x * s.y * s.z) / vol > 0.35;
    let name = pretty(o.name, i);
    const k = used.get(name) || 0; used.set(name, k + 1);
    if (k) name += ` ${k + 1}`;
    return {
      id: `p${i}`, name, system: 'Pièces', objects: [o], shell: big,
      dir: d.toArray(), dist: big ? 0 : len * (0.18 + 0.25 * Math.min(1, d.length() / (len * 0.5))),
      desc: 'Pièce importée depuis le fichier. Pour lui donner un nom et une description, ajouter une entrée dans un fichier de configuration JSON (voir le README).',
      points: []
    };
  });
  parts.push({ id: 'base', name: 'Structure principale', system: 'Pièces', objects: [], fallback: true, shell: true, dir: [0, 0, 0], dist: 0, desc: 'Maillages rattachés directement à la racine du modèle.', points: [] });
  return { title: 'Modèle importé', auto: true, systems: ['Pièces'], openings: [], paints: [], parts };
}

/* ---------- Peintures (extension KHR_materials_variants) ---------- */
function buildVariants(gltf, config) {
  const ext = gltf.parser.json.extensions?.KHR_materials_variants;
  S.variants = ext ? ext.variants.map((v) => v.name) : [];
  // Une peinture est soit une variante KHR_materials_variants, soit une couleur appliquée à des matériaux nommés.
  const paints = (config.paints || []).filter((p) => p.color || S.variants.includes(p.variant));
  config._paints = paints;
  if (paints.length) setPaint(paints[0]); else setAccent(config.accent || '#a3162b');
}

async function setPaint(paint) {
  S.paint = paint;
  setAccent(paint.accent);
  document.querySelectorAll('.swatch').forEach((b) => b.setAttribute('aria-pressed', b.dataset.variant === (paint.variant || paint.label)));
  if (paint.color) {
    const names = new Set(paint.materials || S.config.paintMaterials || []);
    for (const m of S.meshes) if (names.has(m.userData.own.name)) m.userData.own.color.set(paint.color);
    applyMaterials();
    return;
  }
  const parser = S.gltf.parser, idx = S.variants.indexOf(paint.variant);
  await Promise.all(S.meshes.map(async (m) => {
    const asso = parser.associations.get(m);
    if (!asso || asso.primitives === undefined) return;
    const prim = parser.json.meshes[asso.meshes].primitives[asso.primitives];
    const maps = prim.extensions?.KHR_materials_variants?.mappings;
    if (!maps) return;
    const hit = maps.find((x) => x.variants.includes(idx));
    const matIndex = hit ? hit.material : prim.material;
    if (m.userData.matIndex === matIndex) return;
    const mat = await parser.getDependency('material', matIndex);
    const old = m.userData.own;
    m.material = m.userData.own = prepMaterial(mat.clone());
    old.userData.ghost?.dispose();
    m.userData.matIndex = matIndex;
    old.dispose();
  }));
  applyMaterials();
}

function setAccent(hex) {
  S.accent.set(hex);
  document.documentElement.style.setProperty('--accent', hex);
}

/* ---------- Apparence (sélection, transparence, isolement) ---------- */
function applyMaterials() {
  let shown = false;
  // Une étape de visite peut masquer des pièces qui gêneraient la vue, ou
  // estomper tout ce qui n'appartient pas au système présenté.
  const step = S.tour?.steps[S.tour.index];
  for (const m of S.meshes) {
    const p = S.owner.get(m), mat = m.userData.own, base = mat.userData.base;
    const sel = isSelected(p);
    const visible = !((S.view === 'pieces' && p.shell) || (S.isolated && S.selected && !sel) || step?.hide.has(p));
    if (visible !== m.visible) { m.visible = visible; shown = true; }
    const ghost = !sel && ((S.view === 'transparent' && p.shell) || !!step?.ghost);
    m.material = ghost ? ghostOf(mat) : mat;
    if (mat.emissive) {
      if (sel) { mat.emissive.copy(S.accent); mat.emissiveIntensity = 0.55; }
      else if (p === S.hovered) { mat.emissive.copy(S.accent); mat.emissiveIntensity = 0.22; }
      else { mat.emissive.copy(base.emissive); mat.emissiveIntensity = base.emissiveIntensity; }
    }
  }
  // Une pièce masquée ou réaffichée change l'ombre ; un simple surlignage non.
  if (shown) moved(); else redraw();
}

// La sélection est une pièce, ou un groupe de pièces (un système, en visite).
const isSelected = (p) => !!S.selected && (p === S.selected || !!S.selected.members?.has(p));

/* Matériau d'une pièce estompée. Des centaines de pièces transparentes se
   superposent sur chaque pixel : avec le matériau réaliste (reflets, lumière
   d'environnement), la carte graphique refaisait ce calcul à chaque couche.
   Un matériau sans éclairage, de la même couleur, rend presque pareil pour
   un coût minime. Un par matériau d'origine, pour garder sa teinte. */
function ghostOf(mat) {
  const base = mat.userData.base;
  if (!mat.userData.ghost) {
    mat.userData.ghost = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, opacity: Math.min(base.opacity, 0.13) });
  }
  const g = mat.userData.ghost;
  if (mat.color) g.color.copy(mat.color); // suit la peinture choisie
  return g;
}

function setView(v) {
  S.view = v;
  document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.view === v));
  applyMaterials();
}

/* ---------- Interface ---------- */
function buildUI(config) {
  $('#title').textContent = config.title;
  tourBtn.hidden = !tourSteps(config).length;
  document.title = `${config.title}, anatomie interactive`;
  const n = S.parts.length, sysCount = new Set(S.parts.map((p) => p.system)).size;
  $('#count').textContent = sysCount > 1 ? `${n} composants répartis en ${sysCount} systèmes.` : `${n} composants.`;
  $('#credit').innerHTML = config.credit ? (config.creditUrl ? `<a href="${config.creditUrl}" target="_blank" rel="noopener">${esc(config.credit)}</a>` : esc(config.credit)) : '';

  const pw = $('#paints');
  pw.innerHTML = '';
  pw.style.display = config._paints.length ? '' : 'none';
  for (const p of config._paints) {
    const b = document.createElement('button');
    b.className = 'swatch'; b.style.setProperty('--c', p.swatch || p.color); b.dataset.variant = p.variant || p.label;
    b.setAttribute('aria-label', `Peinture ${p.label}`); b.title = p.label;
    b.setAttribute('aria-pressed', S.paint === p);
    b.onclick = () => setPaint(p);
    pw.appendChild(b);
  }

  const op = $('#openings');
  op.innerHTML = '';
  for (const o of config.openings || []) {
    const parts = o.parts.map((id) => S.byId.get(id)).filter((p) => p?.open);
    if (!parts.length) continue;
    const b = document.createElement('button');
    b.className = 'btn';
    b.setAttribute('aria-pressed', 'false');
    const label = () => `${b.getAttribute('aria-pressed') === 'true' ? 'Fermer' : 'Ouvrir'} ${o.label}`;
    b.textContent = label();
    b.onclick = () => {
      const on = b.getAttribute('aria-pressed') !== 'true';
      parts.forEach((p) => { p.open.target = on ? 1 : 0; });
      b.setAttribute('aria-pressed', on); b.textContent = label();
      refreshSheetActions();
    };
    S.openings.set(o.id, { button: b, parts, sync: () => { const on = parts.every((p) => p.open.target === 1); b.setAttribute('aria-pressed', on); b.textContent = label(); } });
    op.appendChild(b);
  }
  renderIndex();
}

function renderIndex() {
  const q = $('#search').value.trim().toLowerCase();
  const box = $('#parts');
  box.innerHTML = '';
  const systems = [...new Set([...(S.config.systems || []), ...S.parts.map((p) => p.system)])];
  let shown = 0;
  for (const sys of systems) {
    const list = S.parts.filter((p) => p.system === sys && (!q || `${p.name} ${p.system} ${p.desc || ''}`.toLowerCase().includes(q)));
    if (!list.length) continue;
    const h = document.createElement('div');
    h.className = 'sys';
    h.innerHTML = `<span>${esc(sys)}</span><span>${list.length}</span>`;
    box.appendChild(h);
    for (const p of list) {
      const b = document.createElement('button');
      b.className = 'part'; b.textContent = p.name; b.dataset.id = p.id;
      b.setAttribute('aria-current', S.selected === p);
      b.onclick = () => { select(p); if (innerWidth <= 860) toggleIndex(false); };
      b.onmouseenter = () => hover(p);
      b.onmouseleave = () => hover(null);
      box.appendChild(b);
      shown++;
    }
  }
  if (!shown) box.innerHTML = `<p class="empty">Aucune pièce ne correspond à « ${esc(q)} ».</p>`;
}

function select(p) {
  S.selected = p;
  if (!p) { S.isolated = false; closeSheet(); applyMaterials(); markIndex(); return; }
  // Une pièce intérieure est cachée par la carrosserie : on rend la coque transparente.
  if (!p.shell && S.view === 'complet' && S.tTarget < 0.35) setView('transparent');
  S.focus = p;
  openSheet(p);
  applyMaterials();
  markIndex();
}

function hover(p) {
  if (S.hovered === p) return;
  S.hovered = p;
  applyMaterials();
}

function markIndex() {
  document.querySelectorAll('.part').forEach((b) => b.setAttribute('aria-current', S.selected?.id === b.dataset.id));
}

function openSheet(p) {
  const sh = $('#sheet');
  sh.querySelector('.s-sys').textContent = p.system;
  sh.querySelector('.s-name').textContent = p.name;
  sh.querySelector('.s-desc').textContent = p.desc || '';
  sh.querySelector('.s-points').innerHTML = (p.points || []).map((t) => `<li>${esc(t)}</li>`).join('');
  const s = p.restBox.getSize(new THREE.Vector3());
  const mm = S.config.unit === 'mm';
  sh.querySelector('.s-measure').innerHTML = [['Longueur', s.z], ['Largeur', s.x], ['Hauteur', s.y]]
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${mm ? nfInt.format(Math.round(v * 1000)) : nf.format(v)}&nbsp;${mm ? 'mm' : 'm'}</dd></div>`).join('');
  sh.querySelector('.s-mesh').textContent = `Mesuré sur le modèle 3D. Maillage de ${nfInt.format(Math.round(p.tris))} triangles.`;
  refreshSheetActions();
  sh.classList.add('open');
}

function refreshSheetActions() {
  const p = S.selected, box = $('#sheet .s-actions');
  if (!p) return;
  box.innerHTML = '';
  const iso = document.createElement('button');
  iso.className = 'btn'; iso.textContent = S.isolated ? 'Tout afficher' : 'Isoler la pièce';
  iso.setAttribute('aria-pressed', S.isolated);
  iso.onclick = () => { S.isolated = !S.isolated; applyMaterials(); refreshSheetActions(); };
  box.appendChild(iso);
  if (p.open) {
    const o = document.createElement('button');
    o.className = 'btn'; o.textContent = p.open.target ? 'Fermer' : 'Ouvrir';
    o.onclick = () => { p.open.target = p.open.target ? 0 : 1; S.openings.forEach((x) => x.sync()); refreshSheetActions(); };
    box.appendChild(o);
  }
  if (p.link) {
    const l = document.createElement('button');
    l.className = 'btn solid'; l.textContent = p.link.label;
    l.onclick = () => document.querySelector(`[data-model="${p.link.model}"]`)?.click();
    box.appendChild(l);
  }
  const f = document.createElement('button');
  f.className = 'btn'; f.textContent = 'Centrer la vue';
  f.onclick = () => { S.focus = p; };
  box.appendChild(f);
}

function closeSheet() {
  $('#sheet').classList.remove('open');
  $('#leader').style.display = 'none';
}

function toggleIndex(force) {
  const idx = $('#index'), on = force ?? !idx.classList.contains('open');
  idx.classList.toggle('open', on);
  $('#toggleIndex').setAttribute('aria-expanded', on);
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------- Commandes ---------- */
const slider = $('#explode');
$('.ticks').innerHTML = '<i></i>'.repeat(21);
function setExplode(v) {
  S.tTarget = THREE.MathUtils.clamp(v, 0, 1);
  slider.value = Math.round(S.tTarget * 100);
  slider.style.setProperty('--p', slider.value + '%');
  $('#pct').innerHTML = `${slider.value}&nbsp;%`;
}
slider.addEventListener('input', () => setExplode(slider.value / 100));
document.querySelectorAll('[data-view]').forEach((b) => (b.onclick = () => setView(b.dataset.view)));
$('#sheet .close').onclick = () => select(null);
// Le trait qui relie la fiche à la pièce suit la fiche pendant qu'elle glisse.
$('#sheet').addEventListener('transitionend', redraw);
$('#search').addEventListener('input', renderIndex);
$('#toggleIndex').onclick = () => toggleIndex();

addEventListener('keydown', (e) => {
  if (e.target.matches('input')) { if (e.key === 'Escape') e.target.blur(); return; }
  if (S.tour) { if (e.key === 'Escape') exitTour(); return; }
  if (e.key === 'Escape') select(null);
  if (e.key === 'e' || e.key === 'E') setExplode(S.tTarget > 0.5 ? 0 : 1);
});

// Import d'un .glb depuis le disque (bouton ou glisser-déposer).
async function loadFile(file) {
  if (!file) return;
  if (!/\.glb$/i.test(file.name)) { alert('Ce lecteur accepte les fichiers .glb (glTF binaire, textures incluses).'); return; }
  setLoad(`Lecture de ${file.name}`, 30);
  await loadBuffer(await file.arrayBuffer(), file.name.replace(/\.glb$/i, ''));
}
async function loadBuffer(buf, title) {
  exitTour();
  try {
    const gltf = await loader.parseAsync(buf, '');
    setLoad('Préparation des pièces', 80);
    await mountCar(gltf, null, title);
    setView('complet');
    setExplode(0);
  } catch (err) {
    setLoad(`Le fichier n'a pas pu être lu : ${err.message || err}.`, 100, true);
    setTimeout(() => $('#loader').classList.add('done'), 5000);
  }
}
$('#file').addEventListener('change', (e) => loadFile(e.target.files[0]));
$('.file-btn').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#file').click(); } });
let dragDepth = 0;
addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; $('#drop').classList.add('on'); });
addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#drop').classList.remove('on'); } });
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => { e.preventDefault(); dragDepth = 0; $('#drop').classList.remove('on'); loadFile(e.dataTransfer.files[0]); });

/* ---------- Visite guidée ----------
   La page devient haute et défile pour de vrai (molette, doigt, clavier,
   barre d'espace) ; la scène 3D reste fixe derrière. Le premier écran de
   défilement éclate la voiture, puis chaque écran suivant cadre une pièce et
   affiche sa fiche. Les étapes viennent de « tour » dans le .json du modèle,
   à défaut de toutes les pièces quand il y en a peu. */
const TOUR_EXPLODE = 0.75;
const tourBtn = $('#tourBtn');

/* Une étape de « tour » est :
   - un identifiant de pièce : "coffre" ;
   - une pièce avec des pièces à masquer pendant l'étape : { "id": "aileron", "hide": ["moteur"] } ;
   - un système entier, présenté comme une seule pièce, les autres estompés :
     { "system": "Distribution", "desc": "…" }. */
function tourSteps(config) {
  const defs = config.tour || (S.parts.length <= 20 ? S.parts.map((p) => p.id) : []);
  return defs.map((d) => {
    if (typeof d === 'string') d = { id: d };
    const part = d.system ? systemGroup(d.system, d.desc) : S.byId.get(d.id);
    if (!part) return null;
    const hide = new Set((d.hide || []).map((id) => S.byId.get(id)).filter(Boolean));
    return { part, hide, ghost: !!d.system };
  }).filter(Boolean);
}

/* Regroupe les pièces d'un système pour la fiche et la caméra : boîte
   englobante, triangles et direction d'éclatement cumulés ; la liste des
   pièces tient lieu de points clés. */
function systemGroup(system, desc) {
  const members = S.parts.filter((p) => p.system === system);
  if (!members.length) return null;
  const g = {
    id: `systeme:${system}`, name: system, system: `Système · ${members.length} pièce${members.length > 1 ? 's' : ''}`,
    desc: desc || '', points: members.map((p) => p.name), members: new Set(members),
    meshes: members.flatMap((p) => p.meshes), restBox: new THREE.Box3(), tris: 0,
    shell: members.every((p) => p.shell), offsetWorld: new THREE.Vector3()
  };
  for (const p of members) { g.restBox.union(p.restBox); g.tris += p.tris; g.offsetWorld.add(p.offsetWorld); }
  return g;
}

function tourLayout() {
  // Hauteurs en pixels : l'introduction est un peu plus longue qu'une étape.
  return { intro: innerHeight * 1.2, step: innerHeight * 0.9 };
}

function buildTourTrack() {
  const { intro, step } = tourLayout(), track = $('#tourTrack');
  track.innerHTML = '';
  const add = (h) => { const d = document.createElement('div'); d.style.height = h + 'px'; track.appendChild(d); };
  add(intro);
  S.tour.steps.forEach(() => add(step));
  add(innerHeight * 0.4);
}

/* Sur téléphone, la fiche occupe le bas de l'écran : on décale l'image 3D vers
   le haut pour que la pièce cadrée reste visible au-dessus. */
function tourViewOffset() {
  if (S.tour && innerWidth <= 860) camera.setViewOffset(innerWidth, innerHeight, 0, innerHeight * 0.22, innerWidth, innerHeight);
  else camera.clearViewOffset();
  redraw();
}

function enterTour() {
  const steps = tourSteps(S.config);
  if (!steps.length) return;
  S.tour = { steps, index: null };
  select(null);
  setView('complet');
  controls.enabled = false;
  lastMove = null; hover(null); $('#tag').style.display = 'none';
  toggleIndex(false);

  const list = $('#tourSteps');
  list.innerHTML = '';
  steps.forEach(({ part: p }, i) => {
    const li = document.createElement('li'), b = document.createElement('button');
    b.textContent = p.name;
    b.onclick = () => scrollTo({ top: tourLayout().intro + i * tourLayout().step + 1, behavior: reduceMotion ? 'auto' : 'smooth' });
    li.appendChild(b); list.appendChild(li);
  });

  document.documentElement.classList.add('tour');
  $('#tour').hidden = false;
  $('#tourHint').hidden = false;
  tourBtn.setAttribute('aria-pressed', 'true');
  tourBtn.textContent = 'Quitter la visite';
  buildTourTrack();
  tourViewOffset();
  scrollTo(0, 0);
  onTourScroll();
}

function exitTour() {
  if (!S.tour) return;
  S.tour = null;
  document.documentElement.classList.remove('tour');
  $('#tour').hidden = true;
  $('#tourHint').hidden = true;
  $('#tourTrack').innerHTML = '';
  tourBtn.setAttribute('aria-pressed', 'false');
  tourBtn.textContent = 'Visite guidée';
  controls.enabled = true;
  tourViewOffset();
  select(null);
  setView('complet');
  setExplode(0);
  scrollTo(0, 0);
}

function onTourScroll() {
  if (!S.tour) return;
  const { intro, step } = tourLayout(), y = scrollY;
  const n = S.tour.steps.length;
  setExplode(Math.min(1, y / intro) * TOUR_EXPLODE);
  $('#tourHint').classList.toggle('gone', y > 40);
  goTourStep(y < intro ? -1 : Math.min(n - 1, Math.floor((y - intro) / step)));
}

function goTourStep(i) {
  const T = S.tour;
  if (T.index === i) return;
  T.index = i;
  const p = T.steps[i]?.part || null;
  $('#tourNum').textContent = p ? `${String(i + 1).padStart(2, '0')} / ${String(T.steps.length).padStart(2, '0')}` : 'Visite guidée';
  $('#tourName').textContent = p ? p.name : '';
  $('#tourSteps').querySelectorAll('li').forEach((li, k) => {
    li.classList.toggle('done', k < i);
    if (k === i) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
  });
  if (!p) { select(null); setView('complet'); redraw(); return; }
  // Pièce de carrosserie : vue complète ; pièce intérieure : coque transparente.
  setView(p.shell ? 'complet' : 'transparent');
  select(p);
  S.focus = null;  // la caméra de la visite prend le relais (voir tourCamera)
  const sh = $('#sheet');
  sh.classList.remove('swap'); void sh.offsetWidth; sh.classList.add('swap');
}

/* Caméra de la visite : vise le centre de la pièce, à une distance qui la fait
   tenir dans le cadre, depuis le côté vers lequel elle s'écarte (les roues de
   profil, les phares de face, le moteur de derrière et au-dessus). */
const tourBase = new THREE.Vector3(), tourDir = new THREE.Vector3(), tourPos = new THREE.Vector3(), tourAim = new THREE.Vector3();
function tourCamera(dt) {
  const p = S.tour.steps[S.tour.index]?.part;
  const cam = S.config.camera;
  if (cam) tourBase.fromArray(cam.position).sub(tourAim.fromArray(cam.target)).normalize();
  else tourBase.set(1, 0.5, 1.1).normalize();
  if (p) {
    carGroup.updateMatrixWorld(true);
    tmpBox.makeEmpty();
    for (const m of p.meshes) tmpBox.expandByObject(m);
    if (tmpBox.isEmpty()) return;
    tmpBox.getCenter(tourAim);
    const radius = tmpBox.getSize(tmpV).length() / 2;
    tourDir.copy(p.offsetWorld).setY(0);
    if (tourDir.lengthSq() < 1e-6) tourDir.copy(tourBase).setY(0);
    tourDir.normalize().multiplyScalar(0.8).addScaledVector(tourBase, 0.6).setY(0.55).normalize();
    // La pièce doit tenir en hauteur et en largeur : en portrait, c'est la
    // largeur qui limite.
    const half = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * Math.min(1, camera.aspect));
    const fit = radius / Math.sin(half);
    const dist = THREE.MathUtils.clamp(fit * 1.25, controls.minDistance, controls.maxDistance);
    tourPos.copy(tourAim).addScaledVector(tourDir, dist);
  } else {
    // Introduction : vue d'ensemble, qui recule à mesure que la voiture s'éclate.
    if (cam) tourAim.fromArray(cam.target); else tourAim.set(0, S.size.y * 0.45, 0);
    const len = Math.max(S.size.x, S.size.z);
    const base = cam ? new THREE.Vector3().fromArray(cam.position).distanceTo(tourAim) : len * 1.7;
    const k = S.config.dolly ?? DOLLY;
    tourPos.copy(tourAim).addScaledVector(tourBase, base * (1 + k * S.t) * (camera.aspect < 1 ? Math.min(2.2, 0.9 / camera.aspect) : 1));
  }
  const a = reduceMotion ? 1 : 1 - Math.exp(-dt * 3);
  if (controls.target.distanceTo(tourAim) + camera.position.distanceTo(tourPos) < 1e-3) return;
  controls.target.lerp(tourAim, a);
  camera.position.lerp(tourPos, a);
  redraw();
}

tourBtn.onclick = () => (S.tour ? exitTour() : enterTour());
addEventListener('scroll', onTourScroll, { passive: true });

/* ---------- Pointeur ---------- */
const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
// Avec la BVH, chaque pièce ne renvoie que son impact le plus proche.
ray.firstHitOnly = true;
let down = null, lastMove = null, movedSincePick = false;
function pick(x, y) {
  ptr.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
  ray.setFromCamera(ptr, camera);
  const targets = S.meshes.filter((m) => m.visible && m.material.opacity > 0.2);
  const hit = ray.intersectObjects(targets, false)[0];
  return hit ? S.owner.get(hit.object) : null;
}
canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', (e) => {
  if (!down) return;
  const moved = Math.hypot(e.clientX - down[0], e.clientY - down[1]);
  down = null;
  if (moved > 5) return;
  select(pick(e.clientX, e.clientY));
});
canvas.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') { lastMove = [e.clientX, e.clientY]; movedSincePick = true; } });
canvas.addEventListener('pointerleave', () => { lastMove = null; hover(null); $('#tag').style.display = 'none'; });

/* ---------- Animation ---------- */
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const qOpen = new THREE.Quaternion(), tmpBox = new THREE.Box3(), tmpV = new THREE.Vector3();
const clock = new THREE.Clock();
let hoverTick = 0;

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const tPrev = S.t;
  S.t = reduceMotion ? S.tTarget : S.t + (S.tTarget - S.t) * (1 - Math.exp(-dt * 5));
  if (Math.abs(S.t - S.tTarget) < 1e-4) S.t = S.tTarget;
  // La caméra recule pendant l'éclatement pour garder toutes les pièces dans le cadre
  // (en visite guidée, c'est tourCamera qui la place).
  if (S.t !== tPrev && !S.tour) {
    const k = S.config?.dolly ?? DOLLY, f = (1 + k * S.t) / (1 + k * tPrev);
    camera.position.sub(controls.target).multiplyScalar(f).add(controls.target);
  }

  // Les pièces ne sont replacées que pendant un éclatement ou une ouverture.
  let animating = S.t !== tPrev;
  for (const p of S.parts) {
    if (p.open && p.open.v !== p.open.target) animating = true;
  }
  // Pendant le mouvement, l'ombre au sol reste figée : la recalculer à chaque
  // image redessinait tout le modèle une seconde fois. Elle est mise à jour une
  // fois les pièces arrêtées.
  if (animating) { redraw(); shadowPending = true; }
  else if (shadowPending) { shadowPending = false; moved(); }
  if (animating) {
    for (const p of S.parts) {
      const k = easeInOut(THREE.MathUtils.clamp((S.t - p.delay) / (1 - STAGGER), 0, 1));
      let ang = 0;
      if (p.open) {
        const step = reduceMotion ? 1 : dt / 1.1;
        p.open.v += THREE.MathUtils.clamp(p.open.target - p.open.v, -step, step);
        ang = p.open.rad * easeInOut(p.open.v);
      }
      p.nodeData.forEach((d, i) => {
        d.node.position.copy(d.pos).addScaledVector(d.local, k);
        if (p.open && i === 0) d.node.quaternion.copy(d.quat).multiply(qOpen.setFromAxisAngle(p.open.axisVec, ang));
      });
    }
  }

  // Survol : seulement si la souris a bougé, et jamais pendant une rotation.
  if (lastMove && movedSincePick && !down && performance.now() - hoverTick > 70) {
    hoverTick = performance.now();
    movedSincePick = false;
    const p = pick(lastMove[0], lastMove[1]);
    hover(p);
    const tag = $('#tag');
    if (p) { tag.textContent = p.name; tag.style.display = 'block'; tag.style.left = lastMove[0] + 'px'; tag.style.top = lastMove[1] + 'px'; }
    else tag.style.display = 'none';
    canvas.style.cursor = p ? 'pointer' : 'grab';
  }

  if (S.tour) tourCamera(dt);

  // Recentrage doux sur la pièce choisie.
  if (S.focus && !S.tour) {
    carGroup.updateMatrixWorld(true);
    tmpBox.makeEmpty();
    for (const m of S.focus.meshes) if (m.visible || S.isolated) tmpBox.expandByObject(m);
    if (!tmpBox.isEmpty()) {
      tmpBox.getCenter(tmpV);
      controls.target.lerp(tmpV, reduceMotion ? 1 : 0.08);
      if (controls.target.distanceTo(tmpV) < 0.01) S.focus = null;
      redraw();
    } else S.focus = null;
  }

  controls.update();
  if (dirty) {
    if (shadowDirty) renderer.shadowMap.needsUpdate = true;
    renderer.render(scene, camera);
    drawLeader();
    dirty = shadowDirty = false;
  }
  requestAnimationFrame(frame);
}

function drawLeader() {
  const svg = $('#leader'), sh = $('#sheet');
  if (!S.selected || !sh.classList.contains('open')) { svg.style.display = 'none'; return; }
  tmpBox.makeEmpty();
  for (const m of S.selected.meshes) tmpBox.expandByObject(m);
  if (tmpBox.isEmpty()) { svg.style.display = 'none'; return; }
  tmpBox.getCenter(tmpV).project(camera);
  if (tmpV.z > 1) { svg.style.display = 'none'; return; }
  const x = (tmpV.x + 1) / 2 * innerWidth, y = (1 - tmpV.y) / 2 * innerHeight;
  const r = sh.getBoundingClientRect();
  let d;
  if (innerWidth <= 860) {
    const ax = r.left + 34, ay = r.top;
    d = `M${x},${y} L${x},${(y + ay) / 2} L${ax},${(y + ay) / 2} L${ax},${ay}`;
  } else {
    const ax = r.left, ay = r.top + 58, ex = ax - 36;
    d = `M${x},${y} L${ex},${ay} L${ax},${ay}`;
  }
  svg.style.display = 'block';
  svg.querySelector('path').setAttribute('d', d);
  svg.querySelectorAll('circle').forEach((c) => { c.setAttribute('cx', x); c.setAttribute('cy', y); });
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  if (S.tour) { buildTourTrack(); onTourScroll(); }
  tourViewOffset();
  redraw();
});

setExplode(0);
boot();
frame();

// Accès console pour le débogage et les captures automatiques.
window.__car = { S, loadBuffer, setExplode, setView, select: (id) => select(S.byId.get(id) || null), camera, controls, renderer, pick };
