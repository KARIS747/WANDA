/*
 * Service worker WANDA.
 *
 * Stratégie : le projet vise une connexion 3G/4G, où chaque aller-retour réseau
 * coûte cher. Le service worker précédent était en network-first pour TOUT, y
 * compris la feuille de style et le script : sur une connexion lente, l'UI
 * attendait le réseau avant de s'afficher, ce qui contredisait la promesse
 * « instantané sur 3G ».
 *
 * On sépare donc les deux cas :
 *   - le shell statique (versionné) est servi depuis le cache, et rafraîchi en
 *     arrière-plan (stale-while-revalidate) ;
 *   - le HTML et les appels /api restent network-first, parce que leur contenu
 *     change et qu'une donnée périmée est pire qu'une attente.
 */

const CACHE_VERSION = 'v6';
const CACHE_NAME = `wanda-${CACHE_VERSION}`;

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/script.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-192-maskable.png',
  '/icons/icon-512-maskable.png',
  '/icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      // addAll est atomique : si un seul fichier manque, l'installation échoue
      // et le nouveau worker n'est pas activé. C'est préférable à un shell
      // à moitié mis en cache.
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .catch((err) => {
        console.error('[sw] pré-cache incomplet :', err);
        throw err;
      })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('wanda-') && key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

/**
 * Le HTML n'est jamais servi depuis le cache sans vérification : c'est le
 * document qui référence le CSS et le JS, donc le garder à jour conditionne
 * le coordinateur de version.
 */
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;

    if (request.mode === 'navigate') {
      const shell = await caches.match('/index.html');
      if (shell) return shell;
    }

    return new Response(
      JSON.stringify({ error: 'Hors-ligne. Vérifie ta connexion.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Les appels API ne sont JAMAIS servis depuis le cache, et ne sont jamais
 * écrits dedans.
 *
 * C'est la seule stratégie qui honore la promesse du site. Le compteur est un
 * chiffre affiché comme un fait (« tu es la 5e personne ») : le rendre depuis
 * une réponse ancienne afficherait un total que personne n'a voté, et le
 * visiteur verrait un mensonge présenté comme un nombre exact. Idem pour le
 * fil : y servir un mur périmé fait croire que des publications ont disparu.
 *
 * Hors-ligne, on renvoie donc une erreur explicite, et `script.js` affiche son
 * état « hors-ligne » plutôt que de fabriquer un contenu.
 */
async function networkOnly(request) {
  try {
    return await fetch(request);
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Hors-ligne. Vérifie ta connexion.', offline: true }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

/**
 * Cache d'abord, puis rafraîchissement en arrière-plan. L'utilisateur obtient
 * la version en cache immédiatement ; la version fraîche sera utilisée au
 * prochain chargement.
 */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  if (cached) return cached;

  const response = await network;
  if (response) return response;

  return new Response('', { status: 504, statusText: 'Ressource indisponible' });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // On ne s'occupe que des requêtes HTTP(S) de même origine.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Les données de l'API ne sont jamais mises en cache : un compteur figé ou
  // un mur obsolète serait pire que pas de données du tout.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkOnly(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});

self.addEventListener('message', (event) => {
  // Permet à la page de forcer l'activation du nouveau worker.
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
