const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { checkContentModeration } = require('../middleware/wordFilter');
const { postRateLimiter } = require('../middleware/rateLimiter');

// Fallback en mémoire
let memoryPosts = [
  {
    id: 1,
    texte: "Coupure de lumière depuis 6h du matin à Makepe... Tout ce qui est dans le congélateur a déjà commencé à wanda !",
    categories: ["#NEPA", "#Cameroun"],
    created_at: new Date(Date.now() - 15 * 60000).toISOString(),
    status: "active",
    report_count: 0,
    reactions: { wanda: 34, courage: 12, mdr: 28, priere: 5, chaud: 19 }
  },
  {
    id: 2,
    texte: "Bouchon de Ndokoti bloqué depuis 2 heures. Le benskinneur me dit de descendre marcher sous la pluie... Seigneur !",
    categories: ["#Embouteillage", "#Benskin"],
    created_at: new Date(Date.now() - 45 * 60000).toISOString(),
    status: "active",
    report_count: 0,
    reactions: { wanda: 52, courage: 21, mdr: 64, priere: 8, chaud: 31 }
  },
  {
    id: 3,
    texte: "Le prix du maquereau au marché Mfoundi a encore augmenté ce matin. On va bientôt manger l'air conditionné.",
    categories: ["#Prix", "#Humour"],
    created_at: new Date(Date.now() - 90 * 60000).toISOString(),
    status: "active",
    report_count: 0,
    reactions: { wanda: 41, courage: 16, mdr: 85, priere: 3, chaud: 22 }
  }
];

/**
 * GET /api/posts
 * Récupère les posts actifs avec leurs totaux de réactions
 */
router.get('/', async (req, res) => {
  const { category, limit = 50 } = req.query;

  try {
    let query = `
      SELECT 
        p.id,
        p.texte,
        p.categories,
        p.created_at,
        p.status,
        p.report_count,
        COALESCE(
          json_object_agg(
            r.type, r.count
          ) FILTER (WHERE r.type IS NOT NULL), 
          '{}'::json
        ) AS reactions
      FROM posts p
      LEFT JOIN (
        SELECT post_id, type, COUNT(*) AS count
        FROM reactions
        GROUP BY post_id, type
      ) r ON p.id = r.post_id
      WHERE p.status = 'active'
    `;

    const params = [];
    if (category && category !== 'Tous') {
      params.push(`%"${category}"%`);
      query += ` AND p.categories::text ILIKE $${params.length}`;
    }

    query += ` GROUP BY p.id ORDER BY p.created_at DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit, 10) || 50);

    const result = await pool.query(query, params);

    // Formater les réactions par défaut
    const formatted = result.rows.map(post => ({
      ...post,
      reactions: {
        wanda: post.reactions?.wanda || 0,
        courage: post.reactions?.courage || 0,
        mdr: post.reactions?.mdr || 0,
        priere: post.reactions?.priere || 0,
        chaud: post.reactions?.chaud || 0
      }
    }));

    return res.json(formatted);
  } catch (err) {
    // Mode fallback
    let filtered = memoryPosts.filter(p => p.status === 'active');
    if (category && category !== 'Tous') {
      filtered = filtered.filter(p => p.categories.includes(category));
    }
    return res.json(filtered);
  }
});

/**
 * POST /api/posts
 * Création d'une nouvelle publication anonyme
 */
router.post('/', postRateLimiter, async (req, res) => {
  const { texte, categories = [] } = req.body;

  // Validation longueur (140 caractères max)
  if (!texte || typeof texte !== 'string' || texte.trim().length === 0) {
    return res.status(400).json({ error: "Le texte ne peut pas être vide." });
  }

  const cleanText = texte.trim();
  if (cleanText.length > 140) {
    return res.status(400).json({ error: "Un wanda doit faire 140 caractères maximum." });
  }

  // Modération de contenu (Pas de politique, pas de haine)
  const moderation = await checkContentModeration(cleanText);
  if (!moderation.valid) {
    return res.status(400).json({ error: moderation.reason });
  }

  // Assainissement des catégories
  const cleanCategories = Array.isArray(categories)
    ? categories.slice(0, 3).map(c => (c.startsWith('#') ? c : `#${c}`).trim())
    : [];

  try {
    const result = await pool.query(`
      INSERT INTO posts (texte, categories, status)
      VALUES ($1, $2, 'active')
      RETURNING id, texte, categories, created_at, status, report_count;
    `, [cleanText, JSON.stringify(cleanCategories)]);

    const newPost = {
      ...result.rows[0],
      reactions: { wanda: 0, courage: 0, mdr: 0, priere: 0, chaud: 0 }
    };

    return res.status(201).json(newPost);
  } catch (err) {
    // Mode fallback en mémoire
    const newPost = {
      id: Date.now(),
      texte: cleanText,
      categories: cleanCategories,
      created_at: new Date().toISOString(),
      status: "active",
      report_count: 0,
      reactions: { wanda: 0, courage: 0, mdr: 0, priere: 0, chaud: 0 }
    };
    memoryPosts.unshift(newPost);
    return res.status(201).json(newPost);
  }
});

module.exports = router;
