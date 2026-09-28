/**
 * Adaptateur de dialecte SQL.
 *
 * WANDA parle deux bases : SQLite en local (un fichier, zéro installation) et
 * PostgreSQL en production (Neon ou équivalent). Le code applicatif doit être
 * identique dans les deux cas — c'est tout l'intérêt : ce qu'on teste en local
 * est littéralement ce qui tourne en prod.
 *
 * PostgreSQL et SQLite ne sont however pas le même langage. Les différences
 * rencontrées par le projet sont regroupées ici, ce qui évite de disséminer des
 * `if (isSqlite)` dans les routes. Chaque fonction renvoie un fragment SQL
 * équivalent pour les deux moteurs.
 *
 * Principe retenu : le SQL des routes reste écrit « à la Postgres » ($1,
 * NOW(), json_object_agg...). Ce module n'a qu'à produire l'équivalent SQLite.
 */

/** Le dialecte est décidé une fois, au chargement, et ne change plus. */
const dialect = process.env.DATABASE_URL ? 'postgres' : 'sqlite';
const isSqlite = dialect === 'sqlite';

/**
 * Horodatage courant SQL.
 * SQLite n'a pas NOW() mais datetime('now'), qui renvoie la même chose en
 * 'YYYY-MM-DD HH:MM:SS' (UTC) que CURRENT_TIMESTAMP.
 */
function nowSql() {
  return isSqlite ? "datetime('now')" : 'NOW()';
}

/**
 * Horodatage courant en secondes epoch, pour les comparaisons de fenêtre.
 * Renvoie une expression SQL, pas une valeur.
 */
function epochNowSql() {
  return isSqlite
    ? "CAST(strftime('%s','now') AS INTEGER)"
    : 'EXTRACT(EPOCH FROM NOW())';
}

/**
 * Âge d'une colonne timestamp, exprimé en heures décimales.
 *
 * Utilisé par le score HOT. Postgres a EXTRACT, SQLite non — mais les deux
 * savent convertir un timestamp en epoch, et le résultat est identique.
 */
function ageHoursSql(column) {
  return isSqlite
    ? `((CAST(strftime('%s','now') AS INTEGER) - CAST(strftime('%s',${column}) AS INTEGER)) / 3600.0)`
    : `(EXTRACT(EPOCH FROM (NOW() - ${column})) / 3600)`;
}

/**
 * Agrégat JSON objet.
 * Postgres: json_object_agg. SQLite: json_group_object. Les deux acceptent la
 * clause FILTER, donc le même appel fonctionne dans les deux cas.
 */
function jsonAggSql() {
  return isSqlite ? 'json_group_object' : 'json_object_agg';
}

/**
 * Littéral d'un objet JSON vide, destiné à un COALESCE autour d'un agrégat JSON.
 *
 * Piège à ne pas réintroduire : écrire `COALESCE(agg, {})` — c'est tentant, et
 * ça marche en local ? Non. Les deux moteurs le refusent ou le mal interprètent :
 *
 *   - SQLite lève « unrecognized token: "{" » et la requête entière échoue, donc
 *     le mur ne s'affiche plus du tout sur une publication sans réaction ;
 *   - PostgreSQL n'échoue pas, mais `{}` y est un TABLEAU vide. Le COALESCE
 *     renvoie alors `[]`, et `parseJsonColumn([])` le laisse passer tel quel
 *     (typeof [] === 'object'), si bien que la réponse partait avec
 *     `reactions: {}` reconstruit de justesse — un accident, pas une garantie.
 *
 * `'{}'` (une chaîne) est correct partout : en SQLite COALESCE renvoie le texte
 * que `parseJsonColumn` désérialise, et en PostgreSQL le littéral de type
 * « unknown » est converti dans le type jsonb de l'autre branche.
 *
 * À utiliser à chaque fois qu'un agrégat JSON peut ne produire aucune ligne.
 */
function emptyJsonObjectSql() {
  return "'{}'";
}

/**
 * Teste l'appartenance d'une catégorie.
 *
 * Postgres dispose de l'opérateur de containment JSONB `@>`, qui compare
 * exactement les valeurs (et pas des sous-chaînes). SQLite n'a pas
 * d'équivalent, mais `json_each` permet la même sémantique exacte : on
 * parcourt le tableau et on cherche la valeur. C'est important : un
 * `LIKE '%#Prix%'` confondrait `#Prix` avec `#PrixDuTicket`.
 *
 * La fonction renvoie `{ sql, param }` et NON un simple fragment SQL, parce
 * que les deux moteurs n'attendent pas le même paramètre pour la même
 * question :
 *
 *   - Postgres : `@> '["#Prix"]'::jsonb` — l'opérateur compare deux documents
 *     JSON, donc le paramètre est le tableau sérialisé.
 *   - SQLite : `json_each.value = '#Prix'` — on compare une valeur scalaire
 *     extraite du tableau, donc le paramètre est la chaîne seule.
 *
 * Si l'appelant devait choisir la forme du paramètre, il choisirait celle de
 * Postgres (c'est le SQL « de référence » du projet) et SQLite répondrait
 * silencieusement « aucune publication dans cette catégorie » au lieu de lever
 * une erreur. Un filtre cassé qui ne casse que la base locale, en silence :
 * c'est précisément la classe de bug que ce module existe pour empêcher.
 *
 * @param {string} column  colonne JSON (ex: `p.categories`)
 * @param {string} ph      placeholder déjà formaté ($1 ou ?)
 * @param {string} category valeur recherchée, telle qu'affichée (« #Prix »)
 */
function categoryContainsSql(column, ph, category) {
  return isSqlite
    ? {
        sql: `EXISTS (SELECT 1 FROM json_each(${column}) WHERE json_each.value = ${ph})`,
        param: category
      }
    : {
        sql: `${column} @> ${ph}::jsonb`,
        param: JSON.stringify([category])
      };
}

/**
 * Conversion d'une valeur JSON stockée.
 *
 * Postgres renvoie les JSONB déjà désérialisés (un objet JS). SQLite renvoie
 * le TEXT brut. Sans cette normalisation, `post.reactions.wanda` serait
 * `undefined` en local et un nombre en prod — un bug qui n'apparaît que sur la
 * machine du développeur.
 *
 * Garde-fou : si la valeur est un tableau alors qu'un objet est attendu (ou
 * l'inverse), on renvoie le `fallback` plutôt que de laisser passer une valeur
 * de forme inattendue. C'est le symptôme d'une requête mal écrite côté SQL — voir
 * `emptyJsonObjectSql()` pour le cas typique. Mieux vaut perdre une valeur
 * parasite que propager un `[]` là où le frontend attend `{ wanda: 0, ... }` et
 * afficher « undefined » à l'écran.
 */
function parseJsonColumn(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') {
    if (Array.isArray(value) !== Array.isArray(fallback)) return fallback;
    return value;
  }
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed) !== Array.isArray(fallback)) return fallback;
    return parsed;
  } catch (err) {
    return fallback;
  }
}

module.exports = {
  dialect,
  isSqlite,
  nowSql,
  epochNowSql,
  ageHoursSql,
  jsonAggSql,
  emptyJsonObjectSql,
  categoryContainsSql,
  parseJsonColumn
};
