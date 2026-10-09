/// <reference path="../pb_data/types.d.ts" />

/* Règles de sécurité reprises de l'ancienne version Flask :
   - politique de mots de passe à l'inscription et au changement ;
   - en-têtes HTTP (CSP, anti-iframe, etc.) sur les pages du site.
   La limitation des tentatives est réglée dans la migration de structure
   (rateLimits), et la protection CSRF n'est plus nécessaire : la connexion
   passe par un jeton envoyé en en-tête, jamais par un cookie. */

// ---- Comptes ----------------------------------------------------------------

onRecordCreateRequest((e) => {
  require(`${__hooks}/quiz/comptes.js`).verifierCompte(e);
  e.next();
}, "users");

onRecordUpdateRequest((e) => {
  require(`${__hooks}/quiz/comptes.js`).verifierCompte(e);
  e.next();
}, "users");

// ---- En-têtes HTTP ----------------------------------------------------------

/* L'explorateur 3D a besoin d'une CSP à part : son importmap est forcément
   inline (autorisé par son empreinte, calculée au démarrage), les décodeurs
   Draco et Meshopt compilent du WebAssembly dans des workers blob:, et les
   textures du .glb sont chargées en blob:. */
onBootstrap((e) => {
  e.next();
  const page = toString($os.readFile(`${__hooks}/../pb_public/anatomie/index.html`));
  const importmap = page.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1];
  // sha256 renvoie de l'hexadécimal ; la CSP attend du base64.
  const hex = $security.sha256(importmap);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const octets = [];
  for (let i = 0; i < hex.length; i += 2) octets.push(parseInt(hex.substr(i, 2), 16));
  let base64 = "";
  for (let i = 0; i < octets.length; i += 3) {
    const n = (octets[i] << 16) | ((octets[i + 1] || 0) << 8) | (octets[i + 2] || 0);
    base64 += alphabet[(n >> 18) & 63] + alphabet[(n >> 12) & 63];
    base64 += i + 1 < octets.length ? alphabet[(n >> 6) & 63] : "=";
    base64 += i + 2 < octets.length ? alphabet[n & 63] : "=";
  }
  e.app.store().set("csp_anatomie",
    `default-src 'self'; script-src 'self' 'sha256-${base64}' 'wasm-unsafe-eval'; ` +
    "style-src 'self'; font-src 'self'; img-src 'self' data: blob:; " +
    "connect-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; " +
    "base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
});

routerUse((e) => {
  const chemin = e.request.url.path;
  const h = e.response.header();
  // Le tableau de bord de PocketBase (/_/) a ses propres besoins : on n'y
  // touche pas.
  if (!chemin.startsWith("/_/")) {
    h.set("Content-Security-Policy", chemin.startsWith("/anatomie/")
      ? $app.store().get("csp_anatomie")
      : "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; " +
        "img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; " +
        "base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
    h.set("X-Frame-Options", "DENY");
    h.set("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
    h.set("Cross-Origin-Opener-Policy", "same-origin");
  }
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Referrer-Policy", "same-origin");

  if (chemin.startsWith("/api/")) h.set("Cache-Control", "no-store, private");
  else if (chemin.startsWith("/assets/")) h.set("Cache-Control", "public, max-age=604800");
  // Revalidation à chaque chargement (304 si inchangé) : avec un max-age, un
  // ancien main.js resterait en cache face à une API mise à jour.
  else if (/\.(html|css|js)$/.test(chemin) || chemin.endsWith("/")) h.set("Cache-Control", "no-cache");
  return e.next();
});
