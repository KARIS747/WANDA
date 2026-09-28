const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { DatabaseSync } = require('node:sqlite');
require('dotenv').config();

const { runMigrations } = require('./migrations');
const { dialect, isSqlite, parseJsonColumn } = require('./sql');

/**
 * Deux moteurs, une seule interface.
 *
 *   DATABASE_URL défini  -> PostgreSQL (production : Neon, Railway, Supabase…)
 *   DATABASE_URL absent   -> SQLite local, un simple fichier. Zéro installation,
 *                            zéro service à lancer, et des données qui survivent
 *                            au redémarrage.
 *
 * Le point important : en local on utilise un VRAI moteur de base de données,
 * pas un jeu de données fictif en mémoire. Les migrations, les transactions,
 * les index uniques et les requêtes sont donc réellement exécutés et testés —
 * exactement comme en production. Il n'y a plus de « mode démo » : le bouton
 * écrit en base pour de vrai, et les quotas sont réellement appliqués.
 *
 * `pool` reste exporté par commodité (aucune route ne l'utilise plus, mais
 * `pg` reste requis pour ne pas casser un import tiers éventuel).
 */

// ============================================================
// Horodatages : calculés en JS, jamais laissés au moteur
// ============================================================

/**
 * Date du jour au format YYYY-MM-DD en heure camerounaise (WAT, UTC+1).
 *
 * On passe par Intl plutôt que par un décalage manuel : c'est plus lisible, et
 * cela resterait correct si le Cameroun introduisait un jour une règle d'heure
 * d'été. Le Cameroun n'en a pas aujourd'hui, donc WAT = UTC+1 en permanence.
 */
function getCameroonDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Douala',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

/**
 * Instant ISO du début de la journée camerounaise.
 *
 * Sert au « Top du jour ». Le code ne peut pas utiliser CURRENT_DATE comme
 * avant : en SQLite, CURRENT_DATE est en UTC, ce qui décalerait la bascule de
 * minuit d'une heure et ferait entrer dans le « top » des posts de la veille.
 * En calculant l'instant depuis la date WAT obtenue ci-dessus, les deux moteurs
 * appliquent exactement la même frontière.
 */
function getCameroonDayStartIso(date = new Date()) {
  const [year, month, day] = getCameroonDateString(date)
    .split('-')
    .map(Number);

  // WAT = UTC+1 sans heure d'été : minuit WAT = minuit UTC moins une heure.
  return new Date(Date.UTC(year, month - 1, day) - 3_600_000).toISOString();
}

/**
 * Horodatage ISO à la milliseconde, utilisé comme valeur explicite dans les
 * INSERT.
 *
 * Pourquoi ne pas laisser DEFAULT CURRENT_TIMESTAMP faire son travail ?
 *   - SQLite ne donne qu'une précision à la seconde : deux votes dans la même
 *     seconde recevraient le même `created_at`, donc le même rang. Le classement
 *     « tu es la Xe personne » devient alors faux ou arbitraire.
 *   - Passer la valeur depuis JS donne la même précision aux deux moteurs, donc
 *     le même comportement en local et en prod.
 */
function nowIso() {
  return new Date().toISOString();
}

// ============================================================
// Pilote SQLite
// ============================================================

const SQLITE_PATH = process.env.SQLITE_PATH || path.join(__dirname, '..', 'data', 'wanda.sqlite3');

let sqliteDb = null;

/**
 * Ouverture (et création au besoin) du fichier SQLite.
 *
 * Trois PRAGMA comptent vraiment :
 *  - journal_mode=WAL : lectures et écritures ne se bloquent pas mutuellement.
 *  - foreign_keys=ON : SQLite ignore les clés étrangères par défaut ! Sans ça,
 *    le ON DELETE CASCADE de `reactions` ne ferait rien et le contrôle
 *    d'existence des signalements disparaîtrait en local alors qu'il existe en
 *    prod. C'est le genre de divergence invisible jusqu'au jour où elle coûte.
 *  - busy_timeout : évite une erreur SQLITE_BUSY si deux écritures se suivent
 *    très vite.
 */
function openSqlite() {
  fs.mkdirSync(path.dirname(SQLITE_PATH), { recursive: true });
  sqliteDb = new DatabaseSync(SQLITE_PATH);
  sqliteDb.exec('PRAGMA journal_mode = WAL');
  sqliteDb.exec('PRAGMA foreign_keys = ON');
  sqliteDb.exec('PRAGMA busy_timeout = 5000');
  return sqliteDb;
}

/**
 * Retourne la connexion SQLite, en l'ouvrissant au premier besoin.
 *
 * Ouverture paresseuse plutôt qu'au chargement du module : `require('./db')`
 * ne doit pas créer de fichier sur le disque. Les tests manipulent la base,
 * et un import inutile ne laisserait pas de `.sqlite3` orphelin.
 */
function getSqlite() {
  return sqliteDb || openSqlite();
}

/**
 * Sérialisation des requêtes SQLite.
 *
 * POINT D'ARCHITECTURE IMPORTANT
 * ------------------------------
 * `DatabaseSync` est synchrone et il n'y a qu'une seule connexion. Or une
 * transaction s'étend sur plusieurs `await` (notre callback est asynchrone).
 * Sans sérialisation, deux requêtes HTTP pourraient s'entrelacer : le BEGIN de
 * l'une pendant que l'autre écrit, et les modifications de la seconde seraient
 * annulées par le ROLLBACK de la première.
 *
 * Le pool Postgres n'a pas ce problème — chaque requête y obtient sa propre
 * connexion, donc ses transactions sont naturellement isolées.
 *
 * On impose donc à SQLite un ordre total : une file d'attente FIFO. Le
 * verrou est détenu pendant toute la durée de l'opération, ce qui rend
 * l'entrelacement des transactions impossible.
 *
 * Coût : en local, les requêtes s'exécutent l'une après l'autre. Sans
 * conséquence ici (SQLite est en dessous de la milliseconde et l'usage local
 * est faible). En production, on n'est pas sur ce chemin : c'est Postgres avec
 * un pool concurrentiel.
 */
let sqliteQueue = Promise.resolve();

/** Exécute `task` une fois que toutes les opérations précédentes sont finies. */
function enqueueSqlite(task) {
  const run = sqliteQueue.then(task);

  // La chaîne doit survivre à un échec : sinon un rejet ferait dérailler la
  // file, et plus aucune requête ne s'exécuterait pour le reste du process.
  sqliteQueue = run.then(
    () => undefined,
    () => undefined
  );

  return run;
}

/**
 * Réécrit les placeholders Postgres ($1, $2) en placeholders positionnels
 * SQLite (?) et reconstruit la liste de valeurs dans l'ordre d'apparition.
 *
 * On ne veut surtout pas réécrire le SQL des routes : $1 reste $1 partout, et
 * c'est le pilote qui traduit. Un `$1` répété (`WHERE a = $1 OR b = $1`) produit
 * deux `?` liés à la même valeur, ce qui est le comportement attendu.
 */
function translatePlaceholders(text, params) {
  const chunks = [];
  const values = [];
  const pattern = /\$(\d+)/g;
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    chunks.push(text.slice(lastIndex, match.index));
    chunks.push('?');
    values.push(params[Number(match[1]) - 1]);
    lastIndex = match.index + match[0].length;
  }

  chunks.push(text.slice(lastIndex));

  return { sql: chunks.join(''), values };
}

/**
 * SQLite refuse de lier `undefined` et `boolean`. On normalise pour que les
 * routes puissent transmettre ces valeurs sans connaître le moteur.
 */
function normalizeBindValue(value) {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

function runSqliteStatement(text, params = []) {
  const { sql, values } = translatePlaceholders(text, params);
  const bound = values.map(normalizeBindValue);
  const statement = getSqlite().prepare(sql);

  // On utilise toujours `.all()`, y compris pour les INSERT/UPDATE/DELETE.
  // Deux raisons :
  //   - la propriété `reader` d'un StatementSync n'existe pas de façon fiable
  //     selon la version de Node (elle vaut `undefined` ici), on ne peut donc
  //     pas s'en servir pour distinguer une lecture d'une écriture ;
  //   - `.all()` sur une écriture renvoie `[]` sans lever d'exception, ce qui
  //     donne exactement la même forme de résultat que `pg.query()`.
  // Les routes lisent donc `rows` uniformément, quel que soit le moteur.
  const rows = statement.all(...bound);
  return { rows, rowCount: rows.length };
}

/** Exécute une requête SELECT et renvoie ses lignes. */
async function sqliteQuery(text, params = []) {
  return enqueueSqlite(() => runSqliteStatement(text, params));
}

/**
 * Exécute une instruction non-SELECT.
 * Sur Postgres la distinction n'existe pas (tout passe par query) ; c'est donc
 * surtout une commodité de lecture pour l'appelant.
 */
async function sqliteExec(text, params = []) {
  return enqueueSqlite(() => runSqliteStatement(text, params));
}

// ============================================================
// Pilote PostgreSQL
// ============================================================

const connectionString = process.env.DATABASE_URL;

const isLocal =
  !connectionString ||
  connectionString.includes('localhost') ||
  connectionString.includes('127.0.0.1');

/**
 * Pool Postgres. Utilisé uniquement quand DATABASE_URL est défini.
 */
const pool = new Pool({
  connectionString,
  ssl: !isLocal ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000
});

// ============================================================
// Interface commune
// ============================================================

let dbAvailable = false;

function isDbAvailable() {
  return dbAvailable;
}

/**
 * Exécute une requête. Même signature sur les deux moteurs : renvoie toujours
 * `{ rows }`, comme le fait `pg`. Le reste du code ignore le dialecte.
 */
async function query(text, params = []) {
  if (isSqlite) return sqliteQuery(text, params);
  return pool.query(text, params);
}

/** Variante de `query` pour les instructions qui ne renvoient pas de lignes. */
async function exec(text, params = []) {
  if (isSqlite) return sqliteExec(text, params);
  return pool.query(text, params);
}

/**
 * Exécute un script SQL pouvant contenir PLUSIEURS instructions séparées par
 * des points-virgules.
 *
 * C'est le cas des migrations, qui regroupent parfois plusieurs CREATE TABLE.
 * On ne peut pas passer par `prepare()` : cette méthode de node:sqlite
 * n'accepte qu'une seule instruction et échouerait sur la deuxième.
 * `DatabaseSync.exec()` exécute tout le script d'un bloc.
 *
 * Réservé au DDL : aucun paramètre n'est accepté, donc jamais aucune
 * interpolation de valeur utilisateur dans ce chemin.
 */
async function execScript(text) {
  if (isSqlite) {
    return enqueueSqlite(() => {
      getSqlite().exec(text);
      return { rows: [] };
    });
  }
  return pool.query(text);
}

/**
 * Exécute une fonction dans une transaction.
 *
 * Notez la signature : on ne reçoit plus de client, la fonction s'en charge.
 * Auparavant chaque route faisait `pool.connect()` puis `withTransaction(client)`,
 * en devant managing le `client.release()` elle-même — et comme `pool.connect()`
 * était hors du `try/catch`, une base injoignable suffisait à tuer le process
 * (Express 4 ne rattrape pas les rejets de promesse dans un handler async).
 * Cette responsabilité appartient au pilote, pas aux routes.
 *
 * @param {(tx: {query: Function, exec: Function}) => Promise<T>} fn
 * @returns {Promise<T>}
 * @template T
 */
async function withTransaction(fn) {
  if (isSqlite) {
    return enqueueSqlite(async () => {
      const db = getSqlite();
      db.exec('BEGIN IMMEDIATE');

      try {
        const result = await fn({
          query: async (text, params) => runSqliteStatement(text, params),
          // `exec` doit exécuter TOUTES les instructions du script. Passer par
          // `prepare()` ici ne compilerait que la première et laisserait le
          // reste silencieusement de côté : une migration à plusieurs CREATE
          // TABLE créerait une table sur deux, sans la moindre erreur.
          // On est déjà dans la file (le verrou est tenu), donc on peut
          // appeler exec() directement sans risque de réentrance.
          exec: async (text) => {
            getSqlite().exec(text);
            return { rows: [] };
          }
        });
        db.exec('COMMIT');
        return result;
      } catch (err) {
        try {
          db.exec('ROLLBACK');
        } catch (rollbackErr) {
          console.error('[db] ROLLBACK impossible:', rollbackErr.message);
        }
        throw err;
      }
    });
  }

  // Le client doit être acquis DANS le périmètre de gestion d'erreur.
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await fn({
      query: (text, params) => client.query(text, params),
      exec: (text, params) => client.query(text, params)
    });
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Le code applicatif a parfois besoin de savoir si une erreur vient d'une clé
 * étrangère. Postgres dit '23503', SQLite dit 'SQLITE_CONSTRAINT_FOREIGNKEY'.
 * Les deux sont traités ici pour que les routes n'aient pas à connaître le
 * moteur.
 */
function isForeignKeyViolation(err) {
  return (
    err?.code === '23503' ||
    err?.errcode === 787 ||
    err?.code === 'SQLITE_CONSTRAINT_FOREIGNKEY'
  );
}

/**
 * Convertit un timestamp lu en base vers de l'ISO 8601.
 *
 * Postgres renvoie un objet Date (JSON-sérialisé en ISO par Express). SQLite
 * renvoie le texte 'YYYY-MM-DD HH:MM:SS' en UTC, que `new Date()` interpréterait
 * comme de l'heure LOCALE — décalage d'une heure en Cameroon, et un décalage
 * arbitraire pour un poste configuré autrement. Le frontend s'en sert pour
 * afficher « il y a 15 min », donc l'erreur serait immédiatement visible.
 */
function toIso(value) {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') return new Date(value).toISOString();

  const text = String(value);
  // 'YYYY-MM-DD HH:MM:SS' est déjà en UTC côté SQLite : on lui ajoute le Z
  // explicite avant de convertir, sinon Node le lit comme heure locale.
  const withZone = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)
    ? `${text.replace(' ', 'T')}Z`
    : text;

  const date = new Date(withZone);
  return Number.isNaN(date.getTime()) ? withZone : date.toISOString();
}

/**
 * Prépare le schéma et vérifie que la base répond. Ne masque pas les erreurs :
 * si la base est cassée, l'application doit le dire au lieu de tourner à moitié.
 */
async function initDb() {
  try {
    const applied = await runMigrations(
      { query, execScript, withTransaction, dialect },
      { verbose: true }
    );
    dbAvailable = true;

    const engine = isSqlite ? `SQLite locale (${SQLITE_PATH})` : 'PostgreSQL';
    console.log(`✅ Base de données ${engine} initialisée avec succès.`);

    if (applied.length > 0) {
      console.log(`   ${applied.length} migration(s) appliquée(s) : ${applied.join(', ')}`);
    } else {
      console.log('   Schéma déjà à jour, aucune migration à appliquer.');
    }
  } catch (err) {
    dbAvailable = false;

    console.error(
      '❌ Impossible d\'initialiser la base de données : ' + err.message + '\n' +
        (isSqlite
          ? '   Vérifiez que le dossier du fichier SQLite est accessible en écriture.'
          : '   Vérifiez DATABASE_URL dans votre .env.')
    );

    throw err;
  }
}

/** Ferme proprement la base (utilisé par les tests). */
async function closeDb() {
  if (isSqlite) {
    if (sqliteDb) {
      sqliteDb.close();
      sqliteDb = null;
    }
    return;
  }

  await pool.end();
}

module.exports = {
  pool,
  query,
  exec,
  execScript,
  withTransaction,
  initDb,
  closeDb,
  isDbAvailable,
  isForeignKeyViolation,
  toIso,
  parseJsonColumn,
  nowIso,
  getCameroonDateString,
  getCameroonDayStartIso,
  dialect,
  isSqlite
};
