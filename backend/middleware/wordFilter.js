const crypto = require('crypto');
const { pool } = require('../db');

// Liste noire par défaut : politique partisane, tribalisme, haine, grossièretés graves
const DEFAULT_BANNED_WORDS = [
  'politique', 'rdpc', 'mrc', 'biya', 'kamto', 'tontinard', 'sardinard',
  'tribalisme', 'bamileke', 'beti', 'anglo', 'francophone', 'terroriste',
  'ambazonie', 'secession', 'ebola', 'assassin'
];

/**
 * Vérifie si un texte contient des mots interdits
 */
async function checkContentModeration(text) {
  if (!text || typeof text !== 'string') return { valid: false, reason: 'Texte vide' };

  const normalized = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // 1. Vérification liste locale
  for (const word of DEFAULT_BANNED_WORDS) {
    const regex = new RegExp(`\\b${word}\\b`, 'i');
    if (regex.test(normalized)) {
      return {
        valid: false,
        reason: 'WANDA est un espace de solidarité et d\'humour. Pas de politique, de tribalisme ou d\'attaques ici !'
      };
    }
  }

  // 2. Vérification base de données si connectée
  try {
    const result = await pool.query('SELECT word FROM banned_words');
    for (const row of result.rows) {
      const regex = new RegExp(`\\b${row.word}\\b`, 'i');
      if (regex.test(normalized)) {
        return {
          valid: false,
          reason: 'Contenu non conforme à la charte WANDA.'
        };
      }
    }
  } catch (e) {
    // Si la DB n'est pas encore connectée, la liste locale suffit
  }

  return { valid: true };
}

module.exports = {
  checkContentModeration
};
