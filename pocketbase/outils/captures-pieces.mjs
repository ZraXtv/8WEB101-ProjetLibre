// Produit les images de l'épreuve « Les pièces » à partir de l'explorateur 3D :
// pour chaque question « piece » de donnees/questions.json, la pièce est
// affichée seule sur fond blanc, dans sa vraie matière, puis capturée dans
// donnees/images/<fichier>.
//
// Prérequis (dans un dossier de travail, pas dans le projet) :
//   npm i playwright && npx playwright install chromium
// Le site doit être servi, par exemple par PocketBase (./demarrer.sh) :
//   node captures-pieces.mjs [http://127.0.0.1:8090] [id-de-piece ...]
// Sans identifiant, toutes les pièces sont recapturées.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ici = dirname(fileURLToPath(import.meta.url));
const donnees = join(ici, '..', 'donnees');
const [serveur = 'http://127.0.0.1:8090', ...filtre] = process.argv.slice(2);

const pieces = JSON.parse(readFileSync(join(donnees, 'questions.json'), 'utf8'))
  .filter((q) => q.mode === 'piece' && q.anatomie)
  .filter((q) => !filtre.length || filtre.includes(q.anatomie.piece));

// WebGL logiciel (SwiftShader) : lent mais identique sur toutes les machines.
const navigateur = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await navigateur.newPage({ viewport: { width: 960, height: 720 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('  erreur de la page :', e.message));

for (const q of pieces) {
  const { modele, piece } = q.anatomie;
  const url = `${serveur}/anatomie/?model=${modele}&piece=${encodeURIComponent(piece)}&capture`;
  await page.goto(url);
  await page.waitForFunction(() => window.__car?.S.ready, null, { timeout: 180000 });
  // Quelques images pour que l'ombre et les matériaux soient à jour.
  await page.evaluate(() => new Promise((ok) => {
    let n = 0;
    const tour = () => (++n > 30 ? ok() : requestAnimationFrame(tour));
    requestAnimationFrame(tour);
  }));
  const sortie = join(donnees, 'images', q.fichier);
  await page.screenshot({ path: sortie, type: 'jpeg', quality: 82 });
  console.log(`${q.reponse.padEnd(28)} → ${q.fichier}`);
}

await navigateur.close();
