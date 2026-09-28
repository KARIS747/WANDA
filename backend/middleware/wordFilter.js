const { query } = require('../db');

/**
 * Liste noire par défaut : politique partisane, tribalisme, haine, violence.
 *
 * À garder synchronisée avec le ton affiché dans l'UI — la charte du site est
 * « fun et solidaire », pas « tolérante ».
 */
const DEFAULT_BANNED_WORDS = [
  'politique', 'rdpc', 'mrc', 'biya', 'kamto', 'tontinard', 'sardinard',
  'tribalisme', 'bamileke', 'beti', 'anglo', 'francophone', 'terroriste',
  'ambazonie', 'secession', 'ebola', 'assassin'
];

// Durée de vie du cache de la liste de mots venant de la base.
const BANNED_WORDS_TTL_MS = 60_000;

let cache = { words: null, expiresAt: 0 };

/**
 * Échappe les métacaractères d'une expression régulière.
 *
 * SÉCURITÉ : les mots issus de `banned_words` sont injectés dans une RegExp.
 * Un mot contenant « ( » produisait une regex invalide qui levait une
 * SyntaxError, attrapée silencieusement — et la modération se retrouvait
 * entièrement désactivée pour tout le site. Un seul mot mal saisi suffisait.
 * On échappe donc systématiquement, et on ignore silencieusement (avec un
 * warning) tout mot qui reste inexploitable.
 */
function escapeRegex(word) {
  return String(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Retire les accents et normalise le texte pour la recherche.
 * Permet ainsi de bloquer « beti » comme « béti ».
 */
function normalize(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

async function getBannedWords() {
  const now = Date.now();
  if (cache.words && now < cache.expiresAt) {
    return cache.words;
  }

  try {
    const result = await query('SELECT word FROM banned_words');
    const dbWords = [];

    for (const row of result.rows) {
      try {
        dbWords.push(new RegExp(`\\b${escapeRegex(row.word)}\\b`, 'i'));
      } catch (err) {
        // Mot inexploitable : on le signale mais on ne casse pas la modération.
        console.warn(`[wordFilter] mot ignoré (regex invalide) : ${row.word}`);
      }
    }

    cache = { words: dbWords, expiresAt: now + BANNED_WORDS_TTL_MS };
    return dbWords;
  } catch (err) {
    console.error('[wordFilter] lecture de banned_words échouée:', err.message);
    // En cas de panne, on renvoie la dernière version connue plutôt qu'une
    // liste vide : filtrer sur du vide reviendrait à désactiver la modération.
    return cache.words || [];
  }
}

/**
 * Vérifie qu'un texte ne contient aucun mot interdit.
 * @returns {Promise<{valid: boolean, reason?: string}>}
 */
async function checkContentModeration(text) {
  if (!text || typeof text !== 'string') {
    return { valid: false, reason: 'Texte vide' };
  }

  const normalized = normalize(text);
  const REJECTION =
    "WANDA est un espace de solidarité et d'humour. Pas de politique, de tribalisme ou d'attaques ici !";

  for (const word of DEFAULT_BANNED_WORDS) {
    if (new RegExp(`\\b${escapeRegex(word)}\\b`, 'i').test(normalized)) {
      return { valid: false, reason: REJECTION };
    }
  }

  const dbWords = await getBannedWords();
  for (const regex of dbWords) {
    if (regex.test(normalized)) {
      return { valid: false, reason: REJECTION };
    }
  }

  return { valid: true };
}

/** Réservé aux tests : invalide le cache de la liste de mots. */
function __resetCache() {
  cache = { words: null, expiresAt: 0 };
}

module.exports = {
  DEFAULT_BANNED_WORDS,
  checkContentModeration,
  escapeRegex,
  normalize,
  __resetCache
};
