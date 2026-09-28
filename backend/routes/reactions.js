const express = require('express');
const router = express.Router();
const { withTransaction, isForeignKeyViolation } = require('../db');
const { getClientFingerprint, reactionRateLimiter } = require('../middleware/rateLimiter');

const VALID_REACTIONS = ['wanda', 'courage', 'mdr', 'priere', 'chaud'];

/**
 * POST /api/reactions
 * Ajoute ou retire une réaction emoji sur un post.
 *
 * Le toggle se fait en deux requêtes (DELETE ... RETURNING, puis INSERT si rien
 * n'a été supprimé) : l'index unique (post_id, type, ip_hash) posé en migration
 * garantit qu'aucun doublon ne peut se créer même sous concurrence, ce que
 * l'ancienne séquence SELECT-puis-INSERT ne garantissait pas.
 *
 * L'ensemble est enveloppé dans UNE transaction. Sans elle, le DELETE et le
 * SELECT des totaux peuvent être séparés par la requête d'un autre visiteur :
 * les compteurs renvoyés correspondraient alors à un état qui n'a jamais existé,
 * et le frontend afficherait un total incohérent avec ce qu'il optimiste.
 *
 * Un rate limit par IP s'applique également : sans lui, une personne pouvait
 * réagir avec les 5 emojis sur chacun des posts de la liste et rendre les
 * compteurs sans valeur.
 */
router.post('/', reactionRateLimiter, async (req, res) => {
  const { postId, type } = req.body;

  if (!postId || !VALID_REACTIONS.includes(type)) {
    return res.status(400).json({ error: 'Paramètres de réaction invalides.' });
  }

  /**
   * `postId` doit être un entier positif.
   *
   * Sans cette validation, un `postId` non numérique partait directement dans la
   * clause WHERE. Postgres rejette l'erreur de type, SQLite compare des chaînes
   * et renvoie zéro ligne — donc le même appel se comportait différemment selon
   * le moteur. En validant ici, les deux répondent 400 de façon identique, et on
   * évite au passage une requête qui ne peut aboutir qu'à un résultat vide.
   */
  const parsedId = Number(postId);
  if (!Number.isInteger(parsedId) || parsedId <= 0) {
    return res.status(400).json({ error: 'Identifiant de publication invalide.' });
  }

  const ipHash = getClientFingerprint(req);

  try {
    const { active, reactions } = await withTransaction(async (tx) => {
      // 1. Essaie de retirer la réaction : si elle existait, on vient de la toggle off.
      const removed = await tx.query(
        'DELETE FROM reactions WHERE post_id = $1 AND type = $2 AND ip_hash = $3 RETURNING id',
        [parsedId, type, ipHash]
      );

      // 2. Sinon on l'ajoute. ON CONFLICT DO NOTHING rend l'opération sûre si deux
      //    requêtes identiques arrivent en même temps.
      if (removed.rows.length === 0) {
        await tx.query(
          `INSERT INTO reactions (post_id, type, ip_hash)
           VALUES ($1, $2, $3)
           ON CONFLICT (post_id, type, ip_hash) DO NOTHING`,
          [parsedId, type, ipHash]
        );
      }

      const totals = await tx.query(
        `SELECT type, COUNT(*) AS count
         FROM reactions
         WHERE post_id = $1
         GROUP BY type`,
        [parsedId]
      );

      const reactionsMap = { wanda: 0, courage: 0, mdr: 0, priere: 0, chaud: 0 };
      totals.rows.forEach((r) => {
        reactionsMap[r.type] = parseInt(r.count, 10);
      });

      return { active: removed.rows.length === 0, reactions: reactionsMap };
    });

    return res.json({ success: true, active, reactions });
  } catch (err) {
    console.error('[reactions] réaction échouée:', err.message);

    /**
     * Un post qui n'existe pas (ou qui a été supprimé entre-temps) viole la clé
     * étrangère. Ce n'est pas une panne : c'est une demande invalide, et la
     * bonne réponse est 404. On le distingue ici de l'indisponibilité réelle
     * pour ne pas appliquer un rate limit d'échec à un simple 404, ni faire
     * croire à l'utilisateur que le site est en panne.
     */
    if (isForeignKeyViolation(err)) {
      return res.status(404).json({ error: 'Cette publication n\'existe plus.' });
    }

    // Plus de « Réaction enregistrée » retourné sur erreur : le client croyait
    // que son clic avait compté.
    return res.status(503).json({
      error: 'Réaction indisponible. Réessaie dans un instant.'
    });
  }
});

module.exports = router;
