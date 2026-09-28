const crypto = require('crypto');
const { query, nowIso } = require('../db');
const { isSqlite } = require('../sql');

/**
 * Résout le sel de hachage.
 *
 * En production, l'absence de SALT_SECRET est une erreur fatale : sans lui,
 * les empreintes IP+token seraient calculées avec un secret public connu de
 * tous (la valeur par défaut est dans le dépôt), donc triviales à inverser.
 * On préfère refuser de démarrer plutôt que de dégrader silencieusement
 * l'anonymat.
 */
function getSalt() {
  const salt = process.env.SALT_SECRET;

  if (salt && salt.trim().length > 0) {
    return salt;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'SALT_SECRET est obligatoire en production. Refus de démarrer avec un secret par défaut.'
    );
  }

  return 'wanda_dev_salt';
}

/**
 * Génère une empreinte stable et non réversible d'un client.
 *
 * IMPORTANT — plus de confiance aveugle dans `x-forwarded-for` :
 * n'importe quel client peut envoyer ce header et forger une IP arbitraire,
 * ce qui rendait le rate limit contournable en une ligne. On utilise `req.ip`,
 * qu'Express ne renseigne depuis les proxies qu'après configuration explicite
 * de `trust proxy` (voir server.js).
 *
 * Le token client reste une dimension secondaire utile (plusieurs personnes
 * derrière une même box), mais il ne peut plus servir à lui seul à contourner
 * la limite : chaque IP dispose de son propre quota.
 */
function getClientFingerprint(req) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown-ip';
  const clientToken = req.headers['x-client-token'] || req.body?.clientToken || '';
  const salt = getSalt();

  return crypto
    .createHash('sha256')
    .update(`${salt}::${ip}::${clientToken}`)
    .digest('hex');
}

/**
 * Empreinte de la seule IP, indépendante du token client.
 * Utilisée pour plafonner le débit par origine réseau (un seul NAT
 * partagé ne doit pas pouvoir dépasser le quota plusieurs fois).
 */
function getIpFingerprint(req) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown-ip';
  const salt = getSalt();

  return crypto.createHash('sha256').update(`${salt}::ip::${ip}`).digest('hex');
}

/**
 * Middleware de rate limiting persisté en base.
 *
 * Stocker les quotas en Postgres (plutôt qu'une Map en mémoire) permet de
 * survivre à un redémarrage et de rester cohérent si l'application tourne sur
 * plusieurs instances. L'incrément se fait en une seule requête atomique, donc
 * deux requêtes concurrentes ne peuvent pas « gagner » la même place.
 *
 * @param {object}   options
 * @param {string}   options.prefix   Namespace de la clé (ex: 'post')
 * @param {number}   options.limit    Nombre de requêtes autorisées par fenêtre
 * @param {number}   options.windowMs Durée de la fenêtre en millisecondes
 * @param {string}   options.message  Message d'erreur renvoyé au client
 * @param {boolean}  [options.byIp]   Limiter par IP seule (ignore le token)
 */
function rateLimit({ prefix, limit, windowMs, message, byIp = false }) {
  return async function rateLimitMiddleware(req, res, next) {
    const fingerprint = byIp ? getIpFingerprint(req) : getClientFingerprint(req);
    const key = `${prefix}:${fingerprint}`;

    /**
     * Frontière de la fenêtre glissante, calculée en JS.
     *
     * La version PostgreSQL d'origine calculait le seuil en SQL
     * (`NOW() - ($2 || ' seconds')::interval`). Cette syntaxe n'a pas
     * d'équivalent SQLite : il n'y a ni type `interval`, ni opérateur `||` sur
     * des durées, ni fonction `NOW()`.
     *
     * Calculer l'instant en JS et le passer en ISO 8601 résout le problème pour
     * les deux moteurs d'un coup, et rend le calcul testable hors SQL. Le
     * fragment `expiredCheck` se contente ensuite d'adapter la comparaison au
     * type de la colonne.
     */
    const windowStartIso = new Date(Date.now() - windowMs).toISOString();

    /**
     * Comparaison « la fenêtre est-elle expirée ? »
     *
     * PostgreSQL : comparaison temporelle native sur TIMESTAMPTZ.
     * SQLite : la colonne est un TEXT, donc on normalise les deux côtés avec
     * julianday() avant de comparer.
     *
     * Deux pièges évités ici :
     *
     * 1. On ne compare pas les chaînes. Deux formats cohabitent dans la
     *    colonne (l'ISO '2026-09-27T15:00:00.000Z' que nous écrivons, et le
     *    '2026-09-27 15:00:00' que produirait CURRENT_TIMESTAMP) : le premier
     *    trie APRÈS le second alors qu'il peut être antérieur, donc
     *    l'ordre lexicographique donnerait des résultats faux.
     *
     * 2. On n'utilise pas strftime('%s', ...) comme on le ferait
     *    intuitivement : cet entier est tronqué à la SECONDE. Une fenêtre de
     *    1200 ms et un délai écoulé de 1400 ms ne laissent que 200 ms d'écart,
     *    et 200 ms disparaissent entièrement sous la troncature — les deux
     *    instants tombent dans la même seconde, la comparaison renvoie « pas
     *    encore expirée », et le quota ne se renouvelle jamais. La fenêtre
     *    deviendrait donc définitive après le premier dépassement.
     *    julianday() travaille en jours fractionnaires et conserve la
     *    milliseconde.
     */
    const expiredCheck = isSqlite
      ? `julianday(rate_limits.window_start) < julianday($2)`
      : `rate_limits.window_start < $2::timestamptz`;

    try {
      const result = await query(
        `INSERT INTO rate_limits (key, hits, window_start)
         VALUES ($1, 1, $3)
         ON CONFLICT (key) DO UPDATE SET
           hits = CASE
             WHEN ${expiredCheck} THEN 1
             ELSE rate_limits.hits + 1
           END,
           window_start = CASE
             WHEN ${expiredCheck} THEN $3
             ELSE rate_limits.window_start
           END
         RETURNING hits`,
        [key, windowStartIso, nowIso()]
      );

      const hits = result.rows[0].hits;

      if (hits > limit) {
        res.set('Retry-After', String(Math.ceil(windowMs / 1000)));
        return res.status(429).json({
          error: message,
          retryAfterSeconds: Math.ceil(windowMs / 1000)
        });
      }

      // Nettoyage opportuniste des lignes expirées (1% des appels) pour que
      // la table ne grossisse pas indéfiniment. Asynchrone et volontairement
      // sans await : un échec de nettoyage ne doit jamais bloquer une requête.
      if (Math.random() < 0.01) {
        const cutoffIso = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
        const cleanup = isSqlite
          ? 'DELETE FROM rate_limits WHERE julianday(window_start) < julianday($1)'
          : 'DELETE FROM rate_limits WHERE window_start < $1::timestamptz';

        query(cleanup, [cutoffIso]).catch(() => {});
      }

      req.clientFingerprint = fingerprint;
      return next();
    } catch (err) {
      /**
       * Fail-closed : si on ne peut pas vérifier le quota, on refuse plutôt que
       * d'ouvrir grand la porte.
       *
       * Il n'y a plus de mode « démo » à contourner : en local, la base est un
       * fichier SQLite, donc une erreur ici signifie un vrai problème
       * (fichier corrompu, disque plein, permissions) qu'il vaut mieux
       * surfaced qu'en silence. Ouvrir le quota au premier échec rendrait le
       * rate limiting décoratif — exactement ce qu'il sert à empêcher.
       */
      console.error('[rateLimit] échec de la vérification du quota:', err.message);
      return res.status(503).json({
        error: 'Service momentanément indisponible. Réessaie dans un instant.'
      });
    }
  };
}

const postRateLimiter = rateLimit({
  prefix: 'post',
  limit: 1,
  windowMs: (parseInt(process.env.RATE_LIMIT_MINUTES, 10) || 5) * 60 * 1000,
  message: "Calme le jeu ! Tu as déjà partagé un wanda récemment."
});

const reactionRateLimiter = rateLimit({
  prefix: 'reaction',
  limit: 60,
  windowMs: 60 * 1000,
  message: 'Tu reacts trop vite. Respire un instant.'
});

const reportRateLimiter = rateLimit({
  prefix: 'report',
  limit: 20,
  windowMs: 60 * 1000,
  message: 'Trop de signalements en peu de temps.',
  // Par IP, et non par token : sinon il suffit de régénérer le token client
  // pour retrouver un quota neuf, ce qui viderait la modération de son sens.
  byIp: true
});

const counterRateLimiter = rateLimit({
  prefix: 'counter',
  limit: 10,
  windowMs: 60 * 1000,
  message: 'Trop de clics en peu de temps.',
  byIp: true
});

module.exports = {
  getSalt,
  getClientFingerprint,
  getIpFingerprint,
  rateLimit,
  postRateLimiter,
  reactionRateLimiter,
  reportRateLimiter,
  counterRateLimiter
};
