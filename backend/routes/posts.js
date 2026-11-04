const express = require('express');
const router = express.Router();
const {
  query,
  parseJsonColumn,
  toIso,
  nowIso,
  getCameroonDayStartIso
} = require('../db');
const {
  ageHoursSql,
  jsonAggSql,
  emptyJsonObjectSql,
  categoryContainsSql
} = require('../sql');
const { checkContentModeration } = require('../middleware/wordFilter');
const { postRateLimiter } = require('../middleware/rateLimiter');
const { normalizeTagSlug, normalizeTagDisplay, extractHashtagsFromText } = require('../utils/tags');

// Garde-fou : la liste `seen` vient du client. Sans plafond, un appelant
// pourrait envoyer des milliers d'IDs et faire exploser la requête SQL.
const MAX_SEEN_IDS = 500;
const MAX_LIMIT = 100;

/**
 * Longueur maximale d'un wanda.
 *
 * Cette limite n'est PAS appliquée par la base : la colonne `posts.texte` est
 * un `TEXT` sur les deux moteurs, et ni SQLite ni PostgreSQL n'en imposent une.
 * Elle n'existe qu'ici, dans le code applicatif. D'où l'export : les tests
 * l'importent au lieu de recopier le nombre, parce qu'un « 140 » recopié dans
 * un test ne vérifie rien — le test passe alors que la route accepte 300
 * caractères.
 */
const MAX_TEXTE_LENGTH = 140;

/**
 * Valide le corps d'une publication.
 *
 * Fonction pure, sans accès base : c'est ce qui la rend testable. Elle renvoie
 * le texte nettoyé ou la raison du refus, pour que la route n'ait plus qu'à
 * traduire en réponse HTTP.
 */
function validateTexte(texte) {
  if (!texte || typeof texte !== 'string' || texte.trim().length === 0) {
    return { ok: false, error: 'Le texte ne peut pas être vide.' };
  }
  const cleanText = texte.trim();
  if (cleanText.length > MAX_TEXTE_LENGTH) {
    return {
      ok: false,
      error: `Un wanda doit faire ${MAX_TEXTE_LENGTH} caractères maximum.`
    };
  }
  return { ok: true, text: cleanText };
}

/**
 * Score HOT (formule inspirée de Reddit) :
 *   score = total des réactions / (âge en heures + 2)^1.5
 *
 * Cette implémentation JavaScript est la RÉFÉRENCE. Le classement est
 * désormais calculé en SQL par `ageHoursSql`, qui produit la même formule
 * traduite pour chaque moteur — mais SQL et JS sont deux implémentations
 * distinctes de la même arithmétique, et le test `hot-score-parity.test.js`
 * continue de vérifier qu'elles restent d'accord.
 */
function computeHotScore(reactions, createdAt, now = Date.now()) {
  const total = (reactions?.wanda || 0)
    + (reactions?.courage || 0)
    + (reactions?.mdr || 0)
    + (reactions?.priere || 0)
    + (reactions?.chaud || 0);

  const ageHours = (now - new Date(createdAt).getTime()) / 3_600_000;
  return total / Math.pow(ageHours + 2, 1.5);
}

/**
 * Construit la requête du fil : filtres, tri, agrégat de réactions.
 *
 * Toute la construction SQL vit ici, et non dans la route, pour que les tests
 * exercent la VRAIE requête. Une version antérieure laissait le SQL dans le
 * handler ; les tests recopièrent alors leur propre clause ORDER BY, et
 * n'auraient rien attrapé d'une régression de la production — c'est-à-dire
 * exactement le bug qu'ils étaient censés couvrir.
 *
 * @param {object}  options
 * @param {string}  options.category  catégorie filtrée, ou vide / 'Tous'
 * @param {string}  options.sort      'hot' (défaut) | 'recent' | 'top'
 * @param {number[]} options.seenIds  identifiants déjà vus, à exclure
 * @param {number}  options.limit      nombre maximal de lignes
 * @returns {{sql: string, params: Array}}
 */
function buildFeedQuery({ category, sort, seenIds = [], limit }) {
  const params = [];
  const where = [`p.status = 'active'`];

  // Filtre par catégorie : correspondance exacte sur le tableau JSON.
  // `categoryContainsSql` renvoie le fragment ET le paramètre attendus par le
  // moteur courant — la syntaxe est la même des deux côtés, mais pas la forme
  // du paramètre (Postgres veut le tableau JSON sérialisé, SQLite la valeur
  // scalaire). Voir `categoryContainsSql` pour le détail.
  if (category && category !== 'Tous') {
    const filter = categoryContainsSql(
      'p.categories',
      `$${params.length + 1}`,
      category
    );
    params.push(filter.param);
    where.push(filter.sql);
  }

  // Déduplication locale : les posts déjà vus sont écartés du résultat tant
  // qu'il reste du contenu inédit. Le repli est dans `fetchFeedPosts` : sans
  // lui, un visiteur régulier dont `seen` couvre tout le corpus voyait un mur
  // vide alors que la base contient des posts actifs.
  if (seenIds.length > 0) {
    const start = params.length + 1;
    where.push(
      `p.id NOT IN (${seenIds.map((_, i) => `$${start + i}`).join(', ')})`
    );
    seenIds.forEach((id) => params.push(id));
  }

  let whereClause = `WHERE ${where.join(' AND ')}`;
  let orderClause;

  if (sort === 'recent') {
    orderClause = `ORDER BY p.created_at DESC`;
  } else if (sort === 'top') {
    /**
     * Top du jour. La frontière est calculée en JS (`getCameroonDayStartIso`),
     * plus en SQL : CURRENT_DATE est en UTC côté SQLite, ce qui décalerait la
     * bascule de minuit d'une heure et ferait entrer dans le « top » des posts
     * de la veille entre 00h et 01h WAT — précisément l'heure de bascule.
     */
    params.push(getCameroonDayStartIso());
    whereClause += ` AND p.created_at >= $${params.length}`;
    orderClause = `ORDER BY total_reactions DESC, p.created_at DESC`;
  } else {
    /**
     * Mode HOT par défaut, calculé en SQL : c'est la référence.
     * `ageHoursSql` donne l'âge en heures pour le moteur courant, ce qui évite
     * d'écrire EXTRACT (Postgres) ou une arithmétique epoch (SQLite) ici.
     */
    // Ne pas réutiliser l'alias `total_reactions` ici : PostgreSQL n'accepte
    // un nom de colonne de sortie dans ORDER BY que s'il est *seul* dans
    // l'expression. Encapsulé dans COALESCE/POWER, il est résolu comme une
    // colonne d'entrée, qui n'existe pas -> « column "total_reactions" does
    // not exist ». SQLite, plus laxiste, acceptait l'alias et masquait donc
    // l'erreur. On répète l'agrégat, ce qui est valide sur les deux moteurs.
    orderClause = `ORDER BY
        COALESCE(SUM(r.count), 0) / POWER(
          ${ageHoursSql('p.created_at')} + 2,
          1.5
        ) DESC,
        p.created_at DESC`;
  }

  const limitParam = `$${params.length + 1}`;
  params.push(limit);

  return {
    sql: `
      SELECT
        p.id,
        p.texte,
        p.categories,
        p.created_at,
        p.status,
        p.report_count,
        COALESCE(
          ${jsonAggSql()}(r.type, r.count) FILTER (WHERE r.type IS NOT NULL),
          ${emptyJsonObjectSql()}
        ) AS reactions,
        COALESCE(SUM(r.count), 0) AS total_reactions
      FROM posts p
      LEFT JOIN (
        SELECT post_id, type, COUNT(*) AS count
        FROM reactions
        GROUP BY post_id, type
      ) r ON p.id = r.post_id
      ${whereClause}
      GROUP BY p.id
      ${orderClause}
      LIMIT ${limitParam}
    `,
    params
  };
}

/**
 * Exécute le fil avec le repli « contenu déjà vu ».
 *
 * 1. La requête exclut d'abord les identifiants `seenIds`, ce qui priorise les
 *    posts inédits.
 * 2. Si ce premier passage renvoie zéro ligne alors que des identifiants
 *    étaient fournis, la même requête est rejouée sans `seenIds`.
 *
 * Le second passage conserve tous les autres filtres, donc un post masqué ne
 * réapparaît jamais. Une base réellement vide renvoie toujours zéro ligne.
 *
 * @param {object}  options
 * @param {string}  options.category
 * @param {string}  options.sort
 * @param {number[]} options.seenIds
 * @param {number}  options.limit
 * @returns {Promise<Array>} lignes brutes du fil.
 */
async function fetchFeedPosts({ category, sort, seenIds = [], limit }) {
  const { sql, params } = buildFeedQuery({ category, sort, seenIds, limit });
  const { rows } = await query(sql, params);

  if (rows.length === 0 && seenIds.length > 0) {
    const retry = buildFeedQuery({ category, sort, seenIds: [], limit });
    const fallback = await query(retry.sql, retry.params);
    return fallback.rows;
  }

  return rows;
}

// ============================================================
// GET /api/posts
// Paramètres :
//   ?sort=hot|recent|top    (défaut: hot)
//   ?category=#NEPA|Tous    (défaut: Tous)
//   ?limit=50               (défaut: 50, plafonné à 100)
//   ?seen=1,2,3             (IDs déjà vus — priorisés, pas définitivement exclus)
// ============================================================
router.get('/', async (req, res) => {
  const { category, sort = 'hot', seen = '' } = req.query;

  const parsedLimit = parseInt(req.query.limit, 10);
  const limit = Math.min(Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 50, MAX_LIMIT);

  const seenIds = seen
    ? seen
        .split(',')
        .map((id) => parseInt(id, 10))
        .filter((id) => Number.isInteger(id) && id > 0)
        .slice(0, MAX_SEEN_IDS)
    : [];

  try {
    const rows = await fetchFeedPosts({ category, sort, seenIds, limit });
    const formatted = rows.map((post) => {
      // `reactions` arrive en objet sur Postgres (JSONB déjà désérialisé) et en
      // texte JSON sur SQLite. Sans parseJsonColumn, les compteurs seraient
      // undefined en local et corrects en prod.
      const rawReactions = parseJsonColumn(post.reactions, {});

      return {
        id: post.id,
        texte: post.texte,
        categories: parseJsonColumn(post.categories, []),
        created_at: toIso(post.created_at),
        status: post.status,
        report_count: post.report_count,
        total_reactions: parseInt(post.total_reactions, 10),
        reactions: {
          wanda: parseInt(rawReactions?.wanda || 0, 10),
          courage: parseInt(rawReactions?.courage || 0, 10),
          mdr: parseInt(rawReactions?.mdr || 0, 10),
          priere: parseInt(rawReactions?.priere || 0, 10),
          chaud: parseInt(rawReactions?.chaud || 0, 10)
        }
      };
    });

    return res.json(formatted);
  } catch (err) {
    // Une base locale SQLite ne peut pas être « injoignable » au sens réseau :
    // si la requête échoue, c'est un vrai problème (fichier corrompu, disque
    // plein, schéma obsolète) qu'il faut remonter, jamais masquer derrière des
    // données fictives.
    console.error('[posts] lecture échouée:', err.message);
    return res.status(503).json({
      error: 'Mur indisponible. Réessaie dans un instant.'
    });
  }
});

/**
 * POST /api/posts
 * Création d'une nouvelle publication anonyme
 */
router.post('/', postRateLimiter, async (req, res) => {
  const { texte, categories = [], tags = [] } = req.body;

  const validation = validateTexte(texte);
  if (!validation.ok) {
    return res.status(400).json({ error: validation.error });
  }
  const cleanText = validation.text;

  const moderation = await checkContentModeration(cleanText);
  if (!moderation.valid) {
    return res.status(400).json({ error: moderation.reason });
  }

  // Extraire les hashtags depuis le texte (libres)
  const extractedFromText = extractHashtagsFromText(cleanText);
  
  // Normaliser les tags fournis explicitement
  const explicitTags = Array.isArray(tags)
    ? tags
        .map((t) => {
          const slug = normalizeTagSlug(t);
          const display = normalizeTagDisplay(t);
          if (!slug || !display) return null;
          return { slug, display };
        })
        .filter(Boolean)
    : [];

  // Fusionner (texte + explicites), éviter doublons, max 5
  const tagMap = new Map();
  for (const t of [...extractedFromText, ...explicitTags]) {
    if (!tagMap.has(t.slug)) {
      tagMap.set(t.slug, t);
    }
  }
  const allTags = Array.from(tagMap.values()).slice(0, 5);

  // Pour compatibilité avec l'existant (catégories)
  const cleanCategories = allTags.map((t) => `#${t.display}`);

  try {
    // `created_at` est fourni explicitement : SQLite ne ferait qu'une précision à
    // la seconde, ce qui confondrait plusieurs posts publiés dans la même
    // seconde, alors que le tri « hot » et le classement « récent » doivent
    // pouvoir les départager. La même horloge (JS) est utilisée partout.
    const result = await query(
      `INSERT INTO posts (texte, categories, status, created_at)
       VALUES ($1, $2, 'active', $3)
       RETURNING id, texte, categories, created_at, status, report_count`,
      [cleanText, JSON.stringify(cleanCategories), nowIso()]
    );

    const post = result.rows[0];
    const postId = post.id;

    // Associer les tags
    for (const tag of allTags) {
      try {
        // Upsert tag
        let tagResult = await query(
          `SELECT id FROM tags WHERE slug = $1`,
          [tag.slug]
        );
        let tagId;
        if (tagResult.rows.length === 0) {
          const insertTag = await query(
            `INSERT INTO tags (slug, display, usage_count, created_at)
             VALUES ($1, $2, 0, $3)
             RETURNING id`,
            [tag.slug, tag.display, nowIso()]
          );
          tagId = insertTag.rows[0].id;
        } else {
          tagId = tagResult.rows[0].id;
        }
        // Lier post_tag
        await query(
          `INSERT INTO post_tags (post_id, tag_id, created_at)
           VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [postId, tagId, nowIso()]
        );
        // Incrémenter usage_count
        await query(
          `UPDATE tags SET usage_count = usage_count + 1 WHERE id = $1`,
          [tagId]
        );
      } catch (tagErr) {
        console.error('[posts] erreur tag:', tagErr.message);
      }
    }

    return res.status(201).json({
      ...post,
      categories: parseJsonColumn(post.categories, cleanCategories),
      tags: allTags,
      created_at: toIso(post.created_at),
      total_reactions: 0,
      reactions: { wanda: 0, courage: 0, mdr: 0, priere: 0, chaud: 0 }
    });
  } catch (err) {
    console.error('[posts] création échouée:', err.message);

    // Jamais de 201 en cas d'échec : le comportement précédent confirmait la
    // publication alors que rien n'avait été écrit, donc l'utilisateur croyait
    // son wanda posté — il avait disparu.
    return res.status(503).json({
      error: 'Publication impossible pour le moment. Réessaie dans un instant.'
    });
  }
});

/**
 * GET /api/posts/tags/suggest
 * Suggestions de tags pour autocomplétion
 */
router.get('/tags/suggest', async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) {
    return res.json([]);
  }
  const slug = require('../utils/tags').normalizeTagSlug(q);
  if (!slug) {
    return res.json([]);
  }
  try {
    const { rows } = await query(
      `SELECT slug, display, usage_count 
       FROM tags 
       WHERE slug LIKE $1 OR display LIKE $2
       ORDER BY usage_count DESC, slug ASC
       LIMIT $3`,
      [`${slug}%`, `%${q.toLowerCase()}%`, Math.min(parseInt(req.query.limit, 10) || 8, 20)]
    );
    return res.json(rows);
  } catch (err) {
    console.error('[tags] suggest échoué:', err.message);
    return res.json([]);
  }
});

/**
 * GET /api/posts/search
 * Recherche par tag ou texte
 */
router.get('/search', async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q || q.length < 2) {
    return res.json({ tags: [], posts: [] });
  }
  try {
    const { normalizeTagSlug } = require('../utils/tags');
    const slug = normalizeTagSlug(q);
    
    // Chercher tags correspondants
    let tagRows = [];
    if (slug) {
      const { rows } = await query(
        `SELECT slug, display, usage_count 
         FROM tags 
         WHERE slug LIKE $1 OR slug = $2
         ORDER BY usage_count DESC
         LIMIT 10`,
        [`${slug}%`, slug]
      );
      tagRows = rows;
    }
    
    // Chercher posts par tag ou texte
    let postRows = [];
    if (slug || q) {
      // D'abord par tag si slug correspond à un tag existant
      if (slug) {
        const { rows } = await query(
          `SELECT DISTINCT p.id, p.texte, p.categories, p.created_at, p.status, p.report_count
           FROM posts p
           JOIN post_tags pt ON pt.post_id = p.id
           JOIN tags t ON t.id = pt.tag_id
           WHERE p.status = 'active' AND t.slug LIKE $1
           ORDER BY p.created_at DESC
           LIMIT 50`,
          [`${slug}%`]
        );
        postRows = rows;
      }
      // Si pas assez de résultats, chercher dans le texte
      if (postRows.length < 10) {
        const { rows } = await query(
          `SELECT id, texte, categories, created_at, status, report_count
           FROM posts
           WHERE status = 'active' AND LOWER(texte) LIKE $1
           ORDER BY created_at DESC
           LIMIT 50`,
          [`%${q.toLowerCase()}%`]
        );
        // Éviter doublons
        const existingIds = new Set(postRows.map(r => r.id));
        for (const r of rows) {
          if (!existingIds.has(r.id)) {
            postRows.push(r);
          }
        }
        postRows = postRows.slice(0, 50);
      }
    }
    
    const formatted = postRows.map((post) => {
      const rawReactions = parseJsonColumn(post.reactions, {});
      return {
        id: post.id,
        texte: post.texte,
        categories: parseJsonColumn(post.categories, []),
        created_at: toIso(post.created_at),
        status: post.status,
        report_count: post.report_count,
        total_reactions: parseInt(post.total_reactions || 0, 10),
        reactions: {
          wanda: parseInt(rawReactions?.wanda || 0, 10),
          courage: parseInt(rawReactions?.courage || 0, 10),
          mdr: parseInt(rawReactions?.mdr || 0, 10),
          priere: parseInt(rawReactions?.priere || 0, 10),
          chaud: parseInt(rawReactions?.chaud || 0, 10)
        }
      };
    });
    
    return res.json({ tags: tagRows, posts: formatted });
  } catch (err) {
    console.error('[search] échoué:', err.message);
    return res.json({ tags: [], posts: [] });
  }
});

module.exports = router;
module.exports.computeHotScore = computeHotScore;
module.exports.MAX_TEXTE_LENGTH = MAX_TEXTE_LENGTH;
module.exports.validateTexte = validateTexte;
module.exports.buildFeedQuery = buildFeedQuery;
module.exports.fetchFeedPosts = fetchFeedPosts;
