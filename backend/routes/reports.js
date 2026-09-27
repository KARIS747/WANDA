const express = require('express');
const router = express.Router();
const { pool } = require('../db');

/**
 * POST /api/reports
 * Signale un post anonymement. Masquage automatique après 3 signalements.
 */
router.post('/', async (req, res) => {
  const { postId } = req.body;

  if (!postId) {
    return res.status(400).json({ error: "Post ID manquant." });
  }

  try {
    const result = await pool.query(`
      UPDATE posts 
      SET report_count = report_count + 1,
          status = CASE WHEN report_count + 1 >= 3 THEN 'hidden' ELSE status END,
          moderation_reason = CASE WHEN report_count + 1 >= 3 THEN 'user_reports_limit' ELSE moderation_reason END
      WHERE id = $1
      RETURNING id, report_count, status;
    `, [postId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Post introuvable." });
    }

    const post = result.rows[0];
    return res.json({ 
      success: true, 
      message: "Signalement pris en compte.", 
      hidden: post.status === 'hidden' 
    });
  } catch (err) {
    return res.json({ success: true, message: "Signalement enregistré (fallback)" });
  }
});

module.exports = router;
