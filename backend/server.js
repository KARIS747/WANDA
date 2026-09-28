const express = require('express');
const path = require('path');
const helmet = require('helmet');
require('dotenv').config();

const { initDb, query, isDbAvailable, dialect } = require('./db');
const counterRoutes = require('./routes/counter');
const postsRoutes = require('./routes/posts');
const reactionsRoutes = require('./routes/reactions');
const reportsRoutes = require('./routes/reports');

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

/**
 * Confiance envers le proxy.
 *
 * `req.ip` ne reflète l'adresse réelle du client que si on indique explicitement
 * combien de proxys précèdent l'application. La valeur `1` correspond au
 * déploiement cible (l'application tourne derrière le proxy d'hébergement).
 *
 * Ce réglage est directement lié à la sécurité : `getClientFingerprint` se base
 * sur `req.ip`. Avec `trust proxy` activé sans borne, n'importe quel client
 * pouvait envoyer `X-Forwarded-For: 1.2.3.4` et forger une empreinte neuve à
 * chaque requête, rendant le rate limit inopérant. D'où un `1` strict et
 * surchargeable via TRUST_PROXY pour les déploiements à plusieurs sauts.
 */
const trustProxy = process.env.TRUST_PROXY
  ? isNaN(Number(process.env.TRUST_PROXY))
    ? process.env.TRUST_PROXY
    : Number(process.env.TRUST_PROXY)
  : isProduction
    ? 1
    : false;

app.set('trust proxy', trustProxy);

/**
 * Content Security Policy.
 *
 * Elle était entièrement désactivée (`contentSecurityPolicy: false`) sous un
 * commentaire justifiant cela par le Service Worker et Web Audio — ce qui n'est
 * exact pour aucun des deux. La CSP n'a aucune influence sur l'enregistrement
 * d'un service worker ni sur Web Audio.
 *
 * `style-src` n'autorise pas 'unsafe-inline' : les quelques attributs style=""
 * qui traînaient dans index.html ont été convertis en classes CSS.
 * C'est ce qui rend la CSP réellement utile contre l'injection de balises.
 */
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        manifestSrc: ["'self'"],
        workerSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"]
      }
    },
    // Le cross-origin embedder policy bloque les polices Google et l'API
    // Vibration sur certains navigateurs ; on garde l'isolation simple.
    crossOriginEmbedderPolicy: false,
    // HSTS est inutile en local et peut perturber le développement.
    hsts: isProduction ? undefined : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
  })
);

// L'API est servie sur la même origine que la PWA (le frontend utilise des URL
// relatives : API_URL = '/api'), et aucune requête cross-origin n'est légitime.
// Le CORS ouvert était donc inutile, et il exposait l'API à n'importe quel site
// tiers capable de forger une requête depuis le navigateur d'un visiteur.
app.use(express.json({ limit: '16kb' }));

// Les réponses API sont des faits dynamiques (compteur, mur, quotas), jamais
// des documents à conserver. Sans `no-store`, le cache HTTP du navigateur peut
// répondre à la place du réseau — y compris hors-ligne, où le service worker
// recevrait alors une ancienne réponse 200 au lieu d'une erreur explicite.
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// Routes API
app.use('/api/counter', counterRoutes);
app.use('/api/posts', postsRoutes);
app.use('/api/reactions', reactionsRoutes);
app.use('/api/reports', reportsRoutes);

// Health check : `live` répond dès que le processus tourne, `ready` indique si la
// base est réellement utilisable. C'est ce second endpoint qu'un orchestrateur
// doit interroger avant d'envoyer du trafic.
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'WANDA API',
    time: new Date().toISOString()
  });
});

app.get('/api/ready', async (req, res) => {
  let reachable = false;
  try {
    await query('SELECT 1');
    reachable = true;
  } catch (err) {
    reachable = false;
  }

  const ready = isDbAvailable() && reachable;
  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'degraded',
    database: reachable ? 'up' : 'down',
    engine: dialect
  });
});

// Servir les fichiers statiques du Frontend PWA
app.use(express.static(path.join(__dirname, '../frontend')));

// Fallback SPA / PWA.
// On exclut /api : sans cela, une route API inconnue renvoyait du HTML et le
// frontend interpretait la réponse comme un objet JSON valide.
app.get(/^(?!\/api\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Gestionnaire d'erreurs : rien ne doit fuir de trace technique au client.
app.use((err, req, res, next) => {
  console.error('[erreur serveur]', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Erreur interne du serveur.' });
});

async function start() {
  /**
   * La base est requise, sans exception ni mode dégradé.
   *
   * En local, c'est un fichier SQLite : s'il ne s'ouvre pas, c'est qu'il est
   * corrompu, que le dossier n'est pas inscriptible, ou que le disque est plein.
   * Dans tous ces cas démarrer quand même ne ferait que repousser l'échec à la
   * première requête, avec un message d'erreur bien moins clair. On arrête donc
   * le process et on laisse `initDb` avoir déjà expliqué ce qui ne va pas.
   */
  try {
    await initDb();
  } catch (err) {
    console.error('\n💥 Démarrage annulé : la base de données est requise.');
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log('\n===========================================');
    console.log(`💥 WANDA Server actif sur http://localhost:${PORT}`);
    console.log(`🚀 Mode: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🗄️  Base: ${dialect === 'sqlite' ? 'SQLite locale' : 'PostgreSQL'}`);
    if (trustProxy) {
      console.log(`🔒 trust proxy: ${trustProxy}`);
    }
    console.log('===========================================\n');
  });
}

start();
