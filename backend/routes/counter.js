const express = require('express');
const router = express.Router();
const { pool, getCameroonDateString } = require('../db');

// Fallback en mémoire au cas où la base n'est pas encore connectée
let memoryCounter = { date: getCameroonDateString(), total: 42 };

/**
 * GET /api/counter
 * Récupère le compteur du jour (heure du Cameroun)
 */
router.get('/', async (req, res) => {
  const today = getCameroonDateString();

  try {
    const result = await pool.query(
      'SELECT total FROM counter WHERE date = $1',
      [today]
    );

    if (result.rows.length > 0) {
      return res.json({ date: today, total: result.rows[0].total });
    }

    // Si pas encore de ligne pour aujourd'hui, on l'initialise
    await pool.query(
      'INSERT INTO counter (date, total) VALUES ($1, 0) ON CONFLICT (date) DO NOTHING',
      [today]
    );
    return res.json({ date: today, total: 0 });
  } catch (err) {
    // Mode fallback
    if (memoryCounter.date !== today) {
      memoryCounter = { date: today, total: 0 };
    }
    return res.json(memoryCounter);
  }
});

/**
 * POST /api/counter/increment
 * Incrémente le compteur du jour
 */
router.post('/increment', async (req, res) => {
  const today = getCameroonDateString();

  try {
    const result = await pool.query(`
      INSERT INTO counter (date, total)
      VALUES ($1, 1)
      ON CONFLICT (date)
      DO UPDATE SET total = counter.total + 1
      RETURNING total;
    `, [today]);

    const newTotal = result.rows[0].total;
    return res.json({ success: true, date: today, total: newTotal, rank: newTotal });
  } catch (err) {
    // Mode fallback
    if (memoryCounter.date !== today) {
      memoryCounter = { date: today, total: 0 };
    }
    memoryCounter.total += 1;
    return res.json({ success: true, date: today, total: memoryCounter.total, rank: memoryCounter.total });
  }
});

module.exports = router;
