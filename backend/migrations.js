/**
 * Migrateur de schéma minimaliste, multi-dialecte.
 *
 * Le projet n'a pas de dépendance de migration, et c'est volontaire : WANDA
 * privilégie le peu de dépendances possible. On tient donc un simple registre
 * `schema_migrations` et une liste ordonnée d'étapes appliquées exactement une
 * fois chacune.
 *
 * Ajouter une étape :
 *   1. Ajouter une entrée à MIGRATIONS (ne jamais modifier une étape existante).
 *   2. Rendre le SQL idempotent (`IF NOT EXISTS`, `ON CONFLICT`) afin qu'une
 *      réexécution sur une base déjà migrée ne fasse rien.
 *   3. N'utiliser que des jetons de type (voir TYPES) pour les colonnes, afin
 *      que l'étape reste valable sur les deux moteurs.
 *
 * Ne jamais modifier une migration déjà appliquée : les bases existantes ont
 * déjà enregistré son nom, elle ne serait jamais rejouée.
 */

/**
 * Jetons de type, par dialecte.
 *
 * On ne recopie pas le DDL deux fois : cela permettrait aux deux versions de
 * diverger au fil des révisions, et une divergence silencieuse dans le schéma
 * est justement le bug le plus coûteux à rattraper (ça ne se voit qu'en prod).
 * Ici, la forme des colonnes est écrite UNE fois, avec des jetons ; seul le
 * type concret change.
 *
 * Détail SQLite qui compte : `INTEGER PRIMARY KEY AUTOINCREMENT` est la seule
 * forme qui produit une clé autoincrémentée. `INT PRIMARY KEY` créerait une
 * colonne ordinaire, et chaque insertion devrait fournir son id à la main.
 */
const TYPES = {
  postgres: {
    PK: 'SERIAL PRIMARY KEY',
    INT: 'INT',
    TXT: 'TEXT',
    JSON: "JSONB DEFAULT '[]'::jsonb",
    TS: 'TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP',
    TS_NN: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP',
    DATE: 'DATE'
  },
  sqlite: {
    PK: 'INTEGER PRIMARY KEY AUTOINCREMENT',
    INT: 'INTEGER',
    TXT: 'TEXT',
    JSON: "TEXT DEFAULT '[]'",
    TS: 'TEXT DEFAULT CURRENT_TIMESTAMP',
    TS_NN: 'TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP',
    DATE: 'TEXT'
  }
};

const MIGRATIONS = [
  {
    name: '001_initial_schema',
    sql: `
      CREATE TABLE IF NOT EXISTS posts (
        id {{PK}},
        texte {{TXT}} NOT NULL,
        categories {{JSON}},
        created_at {{TS}},
        status {{TXT}} DEFAULT 'active',
        report_count {{INT}} DEFAULT 0,
        moderation_reason {{TXT}} DEFAULT NULL
      );

      CREATE TABLE IF NOT EXISTS reactions (
        id {{PK}},
        post_id {{INT}} REFERENCES posts(id) ON DELETE CASCADE,
        type {{TXT}} NOT NULL,
        created_at {{TS}},
        ip_hash {{TXT}} NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_reactions_post ON reactions(post_id);

      CREATE TABLE IF NOT EXISTS counter (
        date {{DATE}} PRIMARY KEY,
        total {{INT}} DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS banned_words (
        id {{PK}},
        word {{TXT}} UNIQUE NOT NULL
      );
    `
  },
  {
    // Le compteur ne doit plus compter des clics mais des personnes distinctes.
    // `counter_votes` porte la garantie d'unicité (clé primaire composite) ;
    // `counter.total` reste le compteur matérialisé pour une lecture rapide.
    name: '002_counter_distinct_votes',
    sql: `
      CREATE TABLE IF NOT EXISTS counter_votes (
        date {{DATE}} NOT NULL,
        fingerprint {{TXT}} NOT NULL,
        created_at {{TS_NN}},
        PRIMARY KEY (date, fingerprint)
      );

      CREATE INDEX IF NOT EXISTS idx_counter_votes_date ON counter_votes(date);
    `
  },
  {
    // Chaque personne ne peut signaler un post qu'une seule fois, sinon le
    // masquage automatique à 3 signalements se déclenchait sur des clics
    // répétés d'une seule personne.
    name: '003_reports_dedup',
    sql: `
      CREATE TABLE IF NOT EXISTS reports (
        id {{PK}},
        post_id {{INT}} NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        ip_hash {{TXT}} NOT NULL,
        created_at {{TS_NN}}
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_post_hash
        ON reports(post_id, ip_hash);
    `
  },
  {
    // Une réaction = une ligne par (post, type, personne). L'index unique
    // rend le toggle insensible aux requêtes concurrentes.
    name: '004_reactions_unique',
    sql: `
      CREATE UNIQUE INDEX IF NOT EXISTS idx_reactions_unique
        ON reactions(post_id, type, ip_hash);
    `
  },
  {
    // Quotas de débit persistés : survit à un redémarrage et reste cohérent
    // si l'application tourne sur plusieurs instances.
    name: '005_rate_limits',
    sql: `
      CREATE TABLE IF NOT EXISTS rate_limits (
        key {{TXT}} PRIMARY KEY,
        hits {{INT}} NOT NULL DEFAULT 0,
        window_start {{TS_NN}}
      );
    `
  },
  {
    name: '006_tags',
    sql: `
      CREATE TABLE IF NOT EXISTS tags (
        id {{PK}},
        slug {{TXT}} NOT NULL UNIQUE,
        display {{TXT}} NOT NULL,
        usage_count {{INT}} DEFAULT 0,
        created_at {{TS_NN}}
      );

      CREATE TABLE IF NOT EXISTS post_tags (
        post_id {{INT}} NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        tag_id {{INT}} NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        created_at {{TS_NN}},
        PRIMARY KEY (post_id, tag_id)
      );

      CREATE TABLE IF NOT EXISTS tag_aliases (
        id {{PK}},
        alias {{TXT}} NOT NULL UNIQUE,
        tag_id {{INT}} NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        created_at {{TS_NN}}
      );

      CREATE INDEX IF NOT EXISTS idx_tags_slug ON tags(slug);
      CREATE INDEX IF NOT EXISTS idx_tags_usage ON tags(usage_count DESC);
      CREATE INDEX IF NOT EXISTS idx_post_tags_tag ON post_tags(tag_id);
      CREATE INDEX IF NOT EXISTS idx_post_tags_post ON post_tags(post_id);
      CREATE INDEX IF NOT EXISTS idx_tag_aliases_tag ON tag_aliases(tag_id);
    `
  }
];

/** Remplace les jetons {{TOKEN}} par le type réel du dialecte demandé. */
function renderTypes(sql, dialect) {
  const types = TYPES[dialect];

  if (!types) {
    throw new Error(
      `Dialecte SQL inconnu : "${dialect}". Attendu : "postgres" ou "sqlite".`
    );
  }

  return sql.replace(/\{\{(\w+)\}\}/g, (match, token) => {
    if (!(token in types)) {
      throw new Error(
        `Jeton de type inconnu "${token}" dans une migration. ` +
          `Jetons disponibles : ${Object.keys(types).join(', ')}.`
      );
    }
    return types[token];
  });
}

/**
 * Applique les migrations manquantes dans l'ordre.
 *
 * Chaque étape est atomique : soit elle passe entièrement, soit elle n'est pas
 * enregistrée et sera rejouée au prochain démarrage. Sans cela, un plantage au
 * milieu d'un `CREATE TABLE` laisserait un schéma à moitié écrit que le
 * `IF NOT EXISTS` ne rattraperait pas toujours.
 *
 * @param {object} db      adaptateur fourni par db.js
 * @param {Function} db.query        requête paramétrée
 * @param {Function} db.execScript   script multi-statements (DDL)
 * @param {Function} db.withTransaction
 * @param {string} db.dialect  'postgres' | 'sqlite'
 * @param {object} [options]
 * @param {boolean} [options.verbose]
 * @returns {Promise<string[]>} noms des migrations appliquées
 */
async function runMigrations(db, { verbose = false } = {}) {
  const { query, execScript, withTransaction, dialect } = db;
  const applied = [];

  await execScript(
    renderTypes(
      `
        CREATE TABLE IF NOT EXISTS schema_migrations (
          name {{TXT}} PRIMARY KEY,
          applied_at {{TS_NN}}
        );
      `,
      dialect
    )
  );

  const { rows } = await query('SELECT name FROM schema_migrations');
  const done = new Set(rows.map((r) => r.name));

  for (const migration of MIGRATIONS) {
    if (done.has(migration.name)) continue;

    await withTransaction(async (tx) => {
      await tx.exec(renderTypes(migration.sql, dialect));
      await tx.query('INSERT INTO schema_migrations (name) VALUES ($1)', [
        migration.name
      ]);
    });

    applied.push(migration.name);
    if (verbose) console.log(`  ✔ migration ${migration.name}`);
  }

  return applied;
}

module.exports = { MIGRATIONS, TYPES, renderTypes, runMigrations };
