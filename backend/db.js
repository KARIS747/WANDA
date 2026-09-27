const { Pool } = require('pg');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL;

const pool = new Pool({
  connectionString: connectionString || 'postgresql://postgres:postgres@localhost:5432/wanda',
  ssl: connectionString && !connectionString.includes('localhost')
    ? { rejectUnauthorized: false }
    : false
});

/**
 * Retourne la date courante au format YYYY-MM-DD selon le fuseau horaire du Cameroun (GMT+1 / WAT)
 */
function getCameroonDateString() {
  const now = new Date();
  // WAT is UTC+1
  const cameroonTime = new Date(now.getTime() + 1 * 60 * 60 * 1000);
  return cameroonTime.toISOString().split('T')[0];
}

/**
 * Initialisation des tables Postgres dans Neon
 */
async function initDb() {
  try {
    const client = await pool.connect();
    try {
      await client.query(`
        -- Table des publications anonymes
        CREATE TABLE IF NOT EXISTS posts (
          id SERIAL PRIMARY KEY,
          texte VARCHAR(140) NOT NULL,
          categories JSONB DEFAULT '[]'::jsonb,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          status VARCHAR(20) DEFAULT 'active',
          report_count INT DEFAULT 0,
          moderation_reason VARCHAR(100) DEFAULT NULL
        );

        -- Table des réactions
        CREATE TABLE IF NOT EXISTS reactions (
          id SERIAL PRIMARY KEY,
          post_id INT REFERENCES posts(id) ON DELETE CASCADE,
          type VARCHAR(20) NOT NULL,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          ip_hash VARCHAR(64) NOT NULL
        );

        -- Index pour accélérer le comptage des réactions
        CREATE INDEX IF NOT EXISTS idx_reactions_post ON reactions(post_id);

        -- Table du compteur quotidien
        CREATE TABLE IF NOT EXISTS counter (
          date DATE PRIMARY KEY,
          total INT DEFAULT 0
        );

        -- Table des mots bannis / modération
        CREATE TABLE IF NOT EXISTS banned_words (
          id SERIAL PRIMARY KEY,
          word VARCHAR(100) UNIQUE NOT NULL
        );
      `);

      // Insertion du compteur du jour si inexistant
      const today = getCameroonDateString();
      await client.query(`
        INSERT INTO counter (date, total) 
        VALUES ($1, 0) 
        ON CONFLICT (date) DO NOTHING;
      `, [today]);

      console.log('✅ Base de données PostgreSQL (Neon) initialisée avec succès.');
    } finally {
      client.release();
    }
  } catch (err) {
    console.warn('⚠️ Avertissement DB : Impossible de se connecter à PostgreSQL pour le moment (' + err.message + '). Assurez-vous que DATABASE_URL est configuré dans le fichier .env.');
  }
}

module.exports = {
  pool,
  getCameroonDateString,
  initDb
};
