/**
 * Normalisation des hashtags pour WANDA
 */

function stripAccents(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeTagSlug(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let s = stripAccents(raw)
    .toLowerCase()
    .trim();
  // Enlever le # en début si présent
  s = s.replace(/^#+/, '');
  // Remplacer espaces et underscores par tirets
  s = s.replace(/[\s_]+/g, '-');
  // Garder uniquement lettres, chiffres, tirets
  s = s.replace(/[^a-z0-9-]/g, '');
  // Nettoyer les tirets multiples et en début/fin
  s = s.replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  if (s.length === 0 || s.length > 30) return null;
  return s;
}

function normalizeTagDisplay(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let s = stripAccents(raw).trim();
  s = s.replace(/^#+/, '');
  // Limiter longueur
  if (s.length === 0 || s.length > 30) return null;
  // Normaliser espaces
  s = s.replace(/\s+/g, ' ');
  return s;
}

function extractHashtagsFromText(text) {
  if (!text || typeof text !== 'string') return [];
  // Cherche #mot ou #mot-composé
  const matches = text.match(/#[\p{L}\p{N}_-]+/gu) || [];
  const seen = new Set();
  const tags = [];
  for (const m of matches) {
    const slug = normalizeTagSlug(m);
    const display = normalizeTagDisplay(m);
    if (slug && display && !seen.has(slug)) {
      seen.add(slug);
      tags.push({ slug, display });
    }
  }
  return tags;
}

module.exports = {
  stripAccents,
  normalizeTagSlug,
  normalizeTagDisplay,
  extractHashtagsFromText
};
