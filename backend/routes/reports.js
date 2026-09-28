const express = require('express');
const router = express.Router();
const { withTransaction, isForeignKeyViolation } = require('../db');
const { getIpFingerprint, reportRateLimiter } = require('../middleware/rateLimiter');

/**
 * POST /api/reports
 *
 * Signalement anonyme, un seul par personne et par post.
 *
 * Avant, la route faisait un simple `UPDATE posts SET report_count = report_count + 1`
 * sans rien enregistrer et sans rate limit. Une seule personne pouvait donc
 * masquer n'importe quel post en envoyant trois requêtes, ce qui rendait la règle
 * « masquage automatique après 3 signalements » sans valeur. Maintenant un index
 * unique sur (post_id, ip_hash) impose qu'il faille bien trois personnes
 * différentes pour masquer un post.
 */
router.post('/', reportRateLimiter, async (req, res) => {
  const { postId } = req.body;

  if (!postId) {
    return res.status(400).json({ error: 'Post ID manquant.' });
  }

  // Même validation que pour les réactions : un identifiant non entier se
  // comporte différemment sur les deux moteurs, on le refuse donc à l'entrée.
  const parsedId = Number(postId);
  if (!Number.isInteger(parsedId) || parsedId <= 0) {
    return res.status(400).json({ error: 'Identifiant de publication invalide.' });
  }

  /**
   * L'identité de signalement est l'ORIGINE RÉSEAU, pas le token client.
   *
   * C'est le point qui rend la règle « masquage après 3 signalements »
   * honnête. Avec une empreinte mêlant le token, une seule personne dont le
   * navigateur change de `x-client-token` produirait trois empreintes
   * différentes, donc trois lignes, donc un masquage — c'est-à-dire exactement
   * le contournement que la déduplication par index unique prétendait
   * empêcher. Le token est une aide à l'anonymat, pas une preuve d'identité :
   * n'importe qui peut le régénérer, mais personne ne change d'adresse IP
   * sans que ce soit visible.
   */
  const ipHash = getIpFingerprint(req);

  try {
    const outcome = await withTransaction(async (tx) => {
      // L'index unique (post_id, ip_hash) fait office de garde-fou : si cette
      // personne a déjà signalé ce post, l'insertion ne crée rien et on s'arrête.
      const inserted = await tx.query(
        `INSERT INTO reports (post_id, ip_hash)
         VALUES ($1, $2)
         ON CONFLICT (post_id, ip_hash) DO NOTHING
         RETURNING post_id`,
        [parsedId, ipHash]
      );

      if (inserted.rows.length === 0) {
        return { alreadyReported: true };
      }

      /**
       * Masquage automatique au 3e signalement.
       *
       * `report_count + 1` est évalué une seule fois par SQLite et Postgres, et
       * les deux l'appliquent au nouveau calcul dans le même UPDATE : c'est ce
       * qui rend l'opération atomique. Écrire `report_count` puis
       * `report_count + 1` dans deux instructions distinctes laisserait passer
       * deux signalements simultanés qui se répondraient l'un l'autre.
       */
      const updated = await tx.query(
        `UPDATE posts
         SET report_count = report_count + 1,
             status = CASE WHEN report_count + 1 >= 3 THEN 'hidden' ELSE status END,
             moderation_reason = CASE
               WHEN report_count + 1 >= 3 THEN 'user_reports_limit'
               ELSE moderation_reason
             END
         WHERE id = $1
         RETURNING id, report_count, status`,
        [parsedId]
      );

      return { alreadyReported: false, post: updated.rows[0] || null };
    });

    if (outcome.alreadyReported) {
      return res.json({
        success: true,
        alreadyReported: true,
        message: 'Vous avez déjà signalé ce wanda. Merci.'
      });
    }

    // Le post a disparu entre l'insertion et la mise à jour : rien à modérer,
    // mais le signalement reste bien enregistré.
    if (!outcome.post) {
      return res.status(404).json({ error: 'Post introuvable.' });
    }

    return res.json({
      success: true,
      reportCount: outcome.post.report_count,
      hidden: outcome.post.status === 'hidden',
      message: 'Signalement pris en compte.'
    });
  } catch (err) {
    /**
     * Clé étrangère violée : le post n'existe pas. `isForeignKeyViolation`
     * couvre les deux moteurs (23503 côté Postgres, 787 / SQLITE_CONSTRAINT_
     * FOREIGNKEY côté SQLite) — tester `err.code === '23503'` en dur ne
     * fonctionnerait pas en local.
     */
    if (isForeignKeyViolation(err)) {
      return res.status(404).json({ error: 'Post introuvable.' });
    }

    console.error('[reports] signalement échoué:', err.message);
    return res.status(503).json({
      error: 'Signalement indisponible. Réessaie dans un instant.'
    });
  }
});

module.exports = router;
