const express = require('express');
const router = express.Router();
const {
  query,
  withTransaction,
  getCameroonDateString,
  nowIso
} = require('../db');
const { getClientFingerprint, counterRateLimiter } = require('../middleware/rateLimiter');

/**
 * Compteur journalier.
 *
 * Le compteur ne compte pas des clics mais des PERSONNES DISTINCTES : la table
 * `counter_votes` a une clé primaire (date, fingerprint), donc une même
 * empreinte ne peut être comptée qu'une fois par jour. Avant, l'endpoint
 * n'avait aucune protection et un `while true; do curl ...; done` suffisait à
 * gonfler le chiffre — c'est-à-dire à détruire la promesse sociale du site.
 *
 * `counter.total` est conservé comme compteur matérialisé (lecture rapide en une
 * ligne) et reste cohérent avec `counter_votes` puisque les deux sont mis à
 * jour dans la même transaction. `counter_votes` reste la source de vérité.
 */

const SERVICE_UNAVAILABLE = {
  error: 'Compteur indisponible. Réessaie dans un instant.'
};

/**
 * GET /api/counter
 * Récupère le compteur du jour (fuseau Africa/Douala).
 *
 * La date du jour est calculée en JS (getCameroonDateString) et passée en
 * paramètre plutôt que d'utiliser CURRENT_DATE. Raison : CURRENT_DATE est
 * interprété dans le fuseau du serveur, qui n'est ni celui du site (WAT) ni
 * forcément celui de la machine du développeur. En SQLite ce serait l'UTC, ce
 * qui décalerait la bascule de minuit d'une heure. Calculé en JS, le compteur
 * change de jour à la même heure en local comme en production.
 */
router.get('/', async (req, res) => {
  const today = getCameroonDateString();

  try {
    const { rows } = await query('SELECT total FROM counter WHERE date = $1', [
      today
    ]);

    return res.json({ date: today, total: rows.length > 0 ? rows[0].total : 0 });
  } catch (err) {
    console.error('[counter] lecture échouée:', err.message);
    return res.status(503).json(SERVICE_UNAVAILABLE);
  }
});

/**
 * POST /api/counter/increment
 *
 * Enregistre la participation d'une personne pour la journée et renvoie son
 * rang réel (position parmi les participants du jour), ce qui rend le message
 * « Tu es la Xe personne » enfin exact — y compris « 1re » pour la première.
 */
router.post('/increment', counterRateLimiter, async (req, res) => {
  const fingerprint = getClientFingerprint(req);
  const today = getCameroonDateString();

  try {
    const { total, rank, alreadyCounted } = await withTransaction(async (tx) => {
      /**
       * Insertion idempotente : si la personne a déjà compté aujourd'hui, la
       * ligne existe déjà et le compteur n'augmente pas.
       *
       * `created_at` est fourni explicitement plutôt que laissé au défaut
       * CURRENT_TIMESTAMP. En SQLite, CURRENT_TIMESTAMP n'a qu'une précision à
       * la seconde : deux personnes cliquant dans la même seconde recevraient
       * le même horodatage, et le calcul du rang en dessous (basé sur
       * `created_at <= $1`) leur attribuerait à toutes deux le même rang — le
       * « Tu es la 5e personne » deviendrait faux. En passant l'instant depuis
       * JS on obtient la même précision à la milliseconde sur les deux moteurs.
       */
      const inserted = await tx.query(
        `INSERT INTO counter_votes (date, fingerprint, created_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (date, fingerprint) DO NOTHING
         RETURNING created_at`,
        [today, fingerprint, nowIso()]
      );

      // Si l'insertion n'a rien retourné, on récupère l'horodatage d'origine,
      // pour calculer le même rang qu'à la première visite.
      let votedAt = inserted.rows[0]?.created_at;
      if (!votedAt) {
        const existing = await tx.query(
          `SELECT created_at FROM counter_votes
           WHERE date = $1 AND fingerprint = $2`,
          [today, fingerprint]
        );
        if (existing.rows.length === 0) {
          throw new Error('vote introuvable après conflit ON CONFLICT');
        }
        votedAt = existing.rows[0].created_at;
      }

      /**
       * Le total affiché est le nombre de personnes distinctes du jour.
       * On le recalcule depuis `counter_votes` plutôt que de l'incrémenter :
       * cela rend le compteur matérialisé autoréparateur, et évite qu'un vote
       * répété (déjà compté) ne fasse diverger le total du nombre réel de
       * personnes. `EXCLUDED` est la valeur qu'on essayait d'insérer ; c'est le
       * moyen idiomatique d'écrire « le total vaut ce que je viens de compter »
       * en une seule requête atomique, et cela fonctionne à l'identique sur
       * PostgreSQL et SQLite.
       */
      const totalResult = await tx.query(
        `INSERT INTO counter (date, total)
         SELECT $1, COUNT(*) FROM counter_votes WHERE date = $1
         ON CONFLICT (date) DO UPDATE SET total = EXCLUDED.total
         RETURNING total`,
        [today]
      );

      /**
       * Le rang : combien de participants ont voté avant ou en même temps.
       *
       * On compare les timestamps comme des chaînes ISO, ce qui est correct
       * parce que le format ISO 8601 a un ordre lexicographique identique à
       * l'ordre chronologique (longueur fixe, unités croissantes). C'est ce
       * qui rend cette requête fonctionnelle sur les deux moteurs : en SQLite
       * une colonne TEXT se compare directement, sans fonction de date.
       */
      const rankResult = await tx.query(
        `SELECT COUNT(*) AS rank
         FROM counter_votes
         WHERE date = $1 AND created_at <= $2`,
        [today, votedAt]
      );

      return {
        total: totalResult.rows[0].total,
        rank: parseInt(rankResult.rows[0].rank, 10),
        alreadyCounted: inserted.rows.length === 0
      };
    });

    return res.json({ success: true, date: today, total, rank, alreadyCounted });
  } catch (err) {
    console.error('[counter] incrément échoué:', err.message);
    return res.status(503).json(SERVICE_UNAVAILABLE);
  }
});

module.exports = router;
