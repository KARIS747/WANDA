const crypto = require('crypto');

// Mémoire temporaire pour le rate limiting
const userLastPostTimes = new Map();
const COOLDOWN_MS = (parseInt(process.env.RATE_LIMIT_MINUTES, 10) || 5) * 60 * 1000;

/**
 * Génère un identifiant unique combinant l'IP et le token client envoyé par le frontend
 */
function getClientFingerprint(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = forwarded ? forwarded.split(',')[0].trim() : req.socket.remoteAddress || 'unknown-ip';
  const clientToken = req.headers['x-client-token'] || req.body?.clientToken || '';
  const salt = process.env.SALT_SECRET || 'wanda_salt_237';

  return crypto.createHash('sha256').update(`${ip}-${clientToken}-${salt}`).digest('hex');
}

/**
 * Middleware qui limite la création de posts à 1 post par cooldown
 */
function postRateLimiter(req, res, next) {
  const fingerprint = getClientFingerprint(req);
  const now = Date.now();
  const lastTime = userLastPostTimes.get(fingerprint);

  if (lastTime && (now - lastTime) < COOLDOWN_MS) {
    const remainingSeconds = Math.ceil((COOLDOWN_MS - (now - lastTime)) / 1000);
    return res.status(429).json({
      error: `Calme le jeu ! Tu as déjà partagé un wanda récemment. Reviens dans ${remainingSeconds}s.`,
      remainingSeconds
    });
  }

  // Enregistrer le timestamp
  userLastPostTimes.set(fingerprint, now);

  // Nettoyage périodique
  if (userLastPostTimes.size > 10000) {
    for (const [k, time] of userLastPostTimes.entries()) {
      if (now - time > COOLDOWN_MS) userLastPostTimes.delete(k);
    }
  }

  req.clientFingerprint = fingerprint;
  next();
}

module.exports = {
  getClientFingerprint,
  postRateLimiter
};
