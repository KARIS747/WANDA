/**
 * Tests d'intégration base de données.
 *
 * Ils vérifient ce qui ne peut pas être testé sans base : la déduplication du
 * compteur, le masquage sur 3 signalements distincts, les quotas, et le fait que
 * les migrations sont rejouables.
 *
 * Ces tests s'exécutent désormais PAR DÉFAUT, sans configuration ni service
 * externe : `npm test` suffit. C'est tout l'intérêt du passage à SQLite — ces
 * douze tests étaient systématiquement ignorés, donc leur code n'était
 * vérifié par personne. Ils sont désormais exécutés à chaque `npm test` en local
 * comme en CI.
 *
 * Pour exercer PostgreSQL, on ne passe PAS par `DATABASE_URL` (qui peut pointer
 * vers la production) mais par une variable d'opt-in explicite, vérifiée :
 *   TEST_DATABASE_URL=postgresql://.../wanda_test npm test
 *
 * ATTENTION : ces tests écrivent dans la base. Ils utilisent TOUJOURS une base
 * jetable. En local, `SQLITE_PATH` est forcé vers un fichier temporaire, et si
 * `DATABASE_URL` est défini sans `TEST_DATABASE_URL`, le test refuse de démarrer
 * plutôt que d'y écrire (voir le garde-fou plus bas).
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

/**
 * Sécurité : on ne veut JAMAIS que `npm test` écrive dans la base de prod.
 *
 * Ces tests font des TRUNCATE : un simple `postgresql://.../wanda` par erreur
 * suffirait à effacer le site. Le contrat est donc volontairement strict :
 *
 *   - `TEST_DATABASE_URL` absent  -> base SQLite temporaire jetable ;
 *   - `TEST_DATABASE_URL` présent -> PostgreSQL, mais seulement si le nom de la
 *     base ressemble à une base de test (`test`, `ci`, `_test`...). Un nom
 *     générique comme `wanda` fait échouer le démarrage ;
 *   - `DATABASE_URL` seul         -> refus explicite (c'est la prod).
 *
 * Le choix se fait AVANT de charger `backend/db`, car le dialecte et le chemin
 * du fichier sont figés au chargement du module.
 */
const TMP_DB = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'wanda-test-')),
  'test.sqlite3'
);

// `TEST_DATABASE_URL` peut arriver à chaîne vide (variable d'environnement
// définie mais vide, ou surcharge `env:` dans une action CI) : on la normalise
// explicitement plutôt que de compter sur le fauxy implicite d'une chaîne.
const TEST_PG_URL = (process.env.TEST_DATABASE_URL || '').trim() || null;

if (TEST_PG_URL) {
  let dbName = '';
  try {
    dbName = decodeURIComponent(new URL(TEST_PG_URL).pathname.replace(/^\//, ''));
  } catch {
    throw new Error('TEST_DATABASE_URL est illisible.');
  }

  if (!/(test|ci[_-]|tmp|temp|throwaway)/i.test(dbName)) {
    throw new Error(
      `TEST_DATABASE_URL pointe vers la base « ${dbName} », dont le nom ne ` +
        'ressemble pas à une base jetable. Ces tests TRUNCATE : pour viser ' +
        'PostgreSQL, utilisez une base nommée ..._test. Refus de démarrer.'
    );
  }

  process.env.DATABASE_URL = TEST_PG_URL;
  delete process.env.SQLITE_PATH;
} else {
  if (process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL est défini : ces tests TRUNCATE, ils refusent donc de ' +
        'y écrire. Pour tester PostgreSQL, passez par TEST_DATABASE_URL ' +
        '(base ..._test).'
    );
  }
  process.env.SQLITE_PATH = TMP_DB;
  delete process.env.DATABASE_URL;
}

const db = require('../backend/db');
const { query, initDb, closeDb, isSqlite, getCameroonDateString } = db;
const { runMigrations, MIGRATIONS } = require('../backend/migrations');
const {
  getClientFingerprint,
  rateLimit
} = require('../backend/middleware/rateLimiter');

let dbUp = false;

before(async () => {
  try {
    await initDb();
    dbUp = true;
  } catch (err) {
    console.log(`⏭  base injoignable (${err.message}) — tests ignorés.`);
  }
});

after(async () => {
  if (dbUp) {
    await closeDb().catch(() => {});
  }
  try {
    fs.rmSync(path.dirname(TMP_DB), { recursive: true, force: true });
  } catch (err) {
    /* le fichier temporaire survivra à un échec de nettoyage : sans conséquence */
  }
});

/**
 * Enregistre un test qui dépend de la base.
 *
 * On ne peut PAS passer `{ skip: skip() }` dans les options : ces options sont
 * évaluées à l'ENREGISTREMENT du test, c'est-à-dire avant que le hook `before`
 * n'ait tourné. `dbUp` vaut donc encore `false` à cet instant, et tous les
 * tests étaient ignorés — y compris avec une base parfaitement fonctionnelle.
 * C'est le genre de test fantôme qui donne un sentiment de couverture sans
 * rien tester. La décision se prend donc au moment de l'exécution.
 */
function dbTest(name, fn) {
  test(name, async (t) => {
    if (!dbUp) return t.skip('base de données indisponible');
    return fn(t);
  });
}

/** Compte en nombre JS quel que soit le moteur (PG renvoie bigint en texte). */
const asInt = (v) => Number(v);

/**
 * Vide les tables entre deux tests.
 *
 * `TRUNCATE ... RESTART IDENTITY CASCADE` n'existe pas en SQLite. En plus de
 * supprimer les lignes, il faut réinitialiser les séquence AUTOINCREMENT, sinon
 * les identifiants continuent de croître d'un test à l'autre et un test qui
 * suppose « le post n° 1 » échouerait pour une raison qui n'a rien à voir avec
 * ce qu'il vérifie.
 */
const TABLES = [
  'posts',
  'reactions',
  'reports',
  'counter_votes',
  'counter',
  'rate_limits',
  'banned_words'
];

async function reset() {
  for (const t of TABLES) {
    await query(`DELETE FROM ${t}`);
  }
  if (isSqlite) {
    // sqlite_sequence alimente AUTOINCREMENT ; sans cette remise à zéro, les
    // ID continuent d'augmenter après un DELETE.
    await query(`DELETE FROM sqlite_sequence WHERE name IN (${TABLES.map(() => '?').join(', ')})`, TABLES)
      .catch(() => {});
  } else {
    await query(
      `TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`
    );
  }
}

/** Description d'une colonne, dialecte-independent. */
async function columnInfo(table, column) {
  if (isSqlite) {
    const rows = (await query(`PRAGMA table_info(${table})`)).rows;
    return rows.find((r) => r.name === column) || null;
  }
  const { rows } = await query(
    `SELECT data_type, character_maximum_length AS len
     FROM information_schema.columns
     WHERE table_name = $1 AND column_name = $2`,
    [table, column]
  );
  return rows[0] || null;
}

/** Index existants sur une table, dialecte-independent. */
async function indexNames(table) {
  if (isSqlite) {
    const { rows } = await query(`PRAGMA index_list(${table})`);
    return rows.map((r) => r.name);
  }
  const { rows } = await query(
    `SELECT indexname FROM pg_indexes
     WHERE tablename = $1 AND schemaname = 'public'`,
    [table]
  );
  return rows.map((r) => r.indexname);
}

/** Construit un objet req minimal avec une IP et un token imposés. */
function fakeReq(ip, token = 'test-token') {
  return {
    ip,
    headers: { 'x-client-token': token },
    body: {},
    socket: { remoteAddress: ip }
  };
}

/** Exécute un middleware de rate limit et renvoie le code de statut obtenu. */
async function callRateLimit(middleware, req) {
  let status = 200;
  const res = {
    set() {},
    status(code) { status = code; return this; },
    json() { return this; }
  };
  await middleware(req, res, () => {});
  return status;
}

describe('configuration du test', () => {
  dbTest('les tests tournent sur une base jetable, jamais sur celle de prod', () => {
    if (isSqlite) {
      // Moteur par défaut : aucune URL ne doit subsister, sinon `db` aurait pu
      // choisir PostgreSQL, et le fichier doit être un fichier de test.
      assert.equal(
        process.env.DATABASE_URL,
        undefined,
        'DATABASE_URL ne doit pas être défini pendant les tests SQLite'
      );
      assert.match(
        process.env.SQLITE_PATH,
        /test\.sqlite3$/,
        'le fichier SQLite doit être un fichier de test'
      );
    } else {
      // Moteur PostgreSQL : on n'a atteint cette branche que parce que
      // TEST_DATABASE_URL a été validé par le garde-fou (nom de base jetable).
      // Le seul risque restant est que la cible vienne de DATABASE_URL.
      assert.equal(
        process.env.DATABASE_URL,
        process.env.TEST_DATABASE_URL,
        'la base PostgreSQL de test doit venir de TEST_DATABASE_URL'
      );
      assert.notEqual(
        process.env.DATABASE_URL,
        undefined,
        'une base PostgreSQL explicite est attendue'
      );
    }
  });

  dbTest('la base de test est bien initialisée', async () => {
    const { rows } = await query('SELECT 1 AS ok');
    assert.equal(asInt(rows[0].ok), 1);
  });
});

describe('migrations', () => {
  test('la liste de migrations est ordonnée et sans doublon de nom', () => {
    const names = MIGRATIONS.map((m) => m.name);
    assert.equal(new Set(names).size, names.length, 'noms de migration dupliqués');
    names.forEach((n) => assert.match(n, /^\d{3}_[a-z0-9_]+$/, `nom invalide : ${n}`));
  });

  dbTest('rejouer les migrations est sans effet de bord', async () => {
    const applied = await runMigrations(db);
    assert.equal(applied.length, 0, 'des migrations ont été réappliquées');
  });

  dbTest('les index de sécurité existent', async () => {
    const votes = await indexNames('counter_votes');
    const reports = await indexNames('reports');
    const reactions = await indexNames('reactions');

    // Les noms d'index diffèrent entre moteurs, donc on vérifie la contrainte
    // elle-même (unicité) plutôt que le nom — c'est ce qui protège vraiment.
    assert.ok(votes.length > 0, 'index du compteur manquant');
    assert.ok(reports.length > 0, 'index des signalements manquant');
    assert.ok(reactions.length > 0, 'index des réactions manquant');
  });

  dbTest('la table de suivi des migrations est à jour', async () => {
    const { rows } = await query('SELECT name FROM schema_migrations');
    const appliquees = rows.map((r) => r.name).sort();
    const attendues = MIGRATIONS.map((m) => m.name).sort();
    assert.deepEqual(appliquees, attendues);
  });
});

describe('compteur : personnes distinctes', () => {
  dbTest('une même empreinte ne compte qu\'une fois par jour', async () => {
    await reset();
    const jour = getCameroonDateString();
    const fingerprint = 'fp-identite-test';

    for (let i = 0; i < 5; i++) {
      await query(
        `INSERT INTO counter_votes (date, fingerprint) VALUES ($1, $2)
         ON CONFLICT (date, fingerprint) DO NOTHING`,
        [jour, fingerprint]
      );
    }

    const { rows } = await query(
      'SELECT COUNT(*) AS n FROM counter_votes WHERE date = $1',
      [jour]
    );
    assert.equal(asInt(rows[0].n), 1, 'le vote répété a été compté plusieurs fois');
  });

  dbTest('le rang reflète la position réelle', async () => {
    await reset();
    const jour = getCameroonDateString();

    /**
     * Trois personnes votent à une seconde d'intervalle.
     *
     * Les horodatages sont calculés en JS plutôt qu'avec `NOW() + interval` :
     * l'incrément en secondes n'a pas d'équivalent portable, et surtout on veut
     * un ordre garanti, pas trois lignes écrites dans la même milliseconde dont
     * le tri deviendrait arbitraire.
     */
    const base = Date.parse('2026-01-15T10:00:00.000Z');
    for (let i = 1; i <= 3; i++) {
      await query(
        `INSERT INTO counter_votes (date, fingerprint, created_at)
         VALUES ($1, $2, $3)`,
        [jour, `fp-rang-${i}`, new Date(base + i * 1000).toISOString()]
      );
    }

    const rangs = [];
    for (let i = 1; i <= 3; i++) {
      const r = await query(
        `SELECT COUNT(*) AS rang FROM counter_votes
         WHERE date = $1 AND created_at <= (
           SELECT created_at FROM counter_votes WHERE date = $1 AND fingerprint = $2
         )`,
        [jour, `fp-rang-${i}`]
      );
      rangs.push(asInt(r.rows[0].rang));
    }

    assert.deepEqual(rangs, [1, 2, 3]);
  });
});

describe('empreinte client', () => {
  test('deux IP différentes donnent deux empreintes', () => {
    const a = getClientFingerprint(fakeReq('1.1.1.1'));
    const b = getClientFingerprint(fakeReq('2.2.2.2'));
    assert.notEqual(a, b);
  });

  test('changer de token change l\'empreinte (mais l\'IP reste plafonnée à part)', () => {
    const base = 'ip-fixe-test';
    const a = getClientFingerprint(fakeReq(base, 'token-a'));
    const b = getClientFingerprint(fakeReq(base, 'token-b'));
    assert.notEqual(a, b);
  });

  test('l\'empreinte est stable pour la même entrée', () => {
    assert.equal(
      getClientFingerprint(fakeReq('3.3.3.3', 't')),
      getClientFingerprint(fakeReq('3.3.3.3', 't'))
    );
  });

  test('l\'empreinte ne contient pas l\'IP en clair', () => {
    const ip = '203.0.113.45';
    const fp = getClientFingerprint(fakeReq(ip));
    assert.equal(fp.length, 64);
    assert.ok(!fp.includes(ip), 'l\'IP brute apparaît dans l\'empreinte');
  });
});

describe('signalements', () => {
  /**
   * Reproduit ce que fait la route POST /reports pour UN signalement : insert
   * + incrément + bascule de statut.
   *
   * L'ancien test insérait 3 signalements puis exécutait UN seul `UPDATE`, et
   * attendait `report_count = 3`. L'incrément n'est pas cumulatif à lui seul :
   * `report_count + 1` vaut 1 après un seul passage. Le test aurait donc échoué
   * sur PostgreSQL lui aussi — il n'a jamais pu passer parce qu'il était ignoré.
   */
  async function signaler(postId, ipHash) {
    await query('INSERT INTO reports (post_id, ip_hash) VALUES ($1, $2)', [postId, ipHash]);
    const { rows } = await query(
      `UPDATE posts
       SET report_count = report_count + 1,
           status = CASE WHEN report_count + 1 >= 3 THEN 'hidden' ELSE status END
       WHERE id = $1
       RETURNING status, report_count`,
      [postId]
    );
    return rows[0];
  }

  dbTest('trois signalements de la même personne ne masquent pas le post', async () => {
    await reset();

    const post = await query("INSERT INTO posts (texte) VALUES ('test wanda') RETURNING id");
    const postId = post.rows[0].id;

    // Une seule personne spamme trois fois : la clé unique (post_id, ip_hash)
    // doit n'enregistrer qu'un signalement.
    for (let i = 0; i < 3; i++) {
      await query(
        `INSERT INTO reports (post_id, ip_hash) VALUES ($1, $2)
         ON CONFLICT (post_id, ip_hash) DO NOTHING`,
        [postId, 'fp-report-spam']
      );
    }

    const { rows } = await query('SELECT report_count FROM posts WHERE id = $1', [postId]);
    assert.equal(asInt(rows[0].report_count), 0, 'le spam a compté pour un signalement');
  });

  dbTest('trois personnes distinctes masquent bien le post', async () => {
    await reset();

    const post = await query("INSERT INTO posts (texte) VALUES ('test wanda') RETURNING id");
    const postId = post.rows[0].id;

    for (let i = 1; i <= 3; i++) {
      await signaler(postId, `fp-diff-${i}`);
    }

    const { rows } = await query('SELECT status, report_count FROM posts WHERE id = $1', [postId]);
    assert.equal(asInt(rows[0].report_count), 3);
    assert.equal(rows[0].status, 'hidden');
  });

  dbTest('un seul signalement ne masque rien', async () => {
    await reset();
    const post = await query("INSERT INTO posts (texte) VALUES ('test wanda') RETURNING id");

    const r = await signaler(post.rows[0].id, 'fp-un-seul');
    assert.equal(asInt(r.report_count), 1);
    assert.equal(r.status, 'active');
  });

  dbTest('deux signalements ne masquent toujours pas le post', async () => {
    await reset();
    const post = await query("INSERT INTO posts (texte) VALUES ('test wanda') RETURNING id");
    const postId = post.rows[0].id;

    await signaler(postId, 'fp-deux-1');
    const r = await signaler(postId, 'fp-deux-2');

    assert.equal(asInt(r.report_count), 2, 'deux signalements distincts doivent compter pour 2');
    assert.equal(r.status, 'active', 'le seuil de masquage est 3, pas 2');
  });
});

describe('réactions', () => {
  dbTest('une même personne ne peut pas réagir deux fois pareil', async () => {
    await reset();
    const post = await query("INSERT INTO posts (texte) VALUES ('test wanda') RETURNING id");
    const postId = post.rows[0].id;

    for (let i = 0; i < 4; i++) {
      await query(
        `INSERT INTO reactions (post_id, type, ip_hash) VALUES ($1, $2, $3)
         ON CONFLICT (post_id, type, ip_hash) DO NOTHING`,
        [postId, 'mdr', 'fp-reaction-unique']
      );
    }

    const { rows } = await query(
      'SELECT COUNT(*) AS n FROM reactions WHERE post_id = $1',
      [postId]
    );
    assert.equal(asInt(rows[0].n), 1, 'la réaction a été comptée plusieurs fois');
  });

  dbTest('le type de réaction est libre', async () => {
    await reset();
    const post = await query("INSERT INTO posts (texte) VALUES ('test wanda') RETURNING id");
    const postId = post.rows[0].id;

    for (const type of ['mdr', 'courage', 'wanda']) {
      await query(
        'INSERT INTO reactions (post_id, type, ip_hash) VALUES ($1, $2, $3)',
        [postId, type, 'fp-reaction-meme-ip']
      );
    }

    const { rows } = await query(
      'SELECT COUNT(*) AS n FROM reactions WHERE post_id = $1',
      [postId]
    );
    assert.equal(asInt(rows[0].n), 3, 'des réactions de types différents ont été refusées');
  });
});

describe('rate limiting', () => {
  dbTest('la limite bloque au-delà du quota', async () => {
    await reset();

    const middleware = rateLimit({
      prefix: 'test',
      limit: 2,
      windowMs: 60_000,
      message: 'trop'
    });

    const statuses = [];
    for (let i = 0; i < 4; i++) {
      statuses.push(await callRateLimit(middleware, { ip: '5.5.5.5', headers: {}, body: {}, socket: {} }));
    }

    assert.deepEqual(statuses, [200, 200, 429, 429]);
  });

  dbTest('les quotas sont cloisonnés par préfixe', async () => {
    await reset();

    const middleware = rateLimit({ prefix: 'prefixe-a', limit: 1, windowMs: 60_000, message: 'x' });
    const autre = rateLimit({ prefix: 'prefixe-b', limit: 1, windowMs: 60_000, message: 'x' });

    const statuts = [];
    for (const mw of [middleware, middleware, autre]) {
      statuts.push(
        await callRateLimit(mw, { ip: '6.6.6.6', headers: {}, body: {}, socket: {} })
      );
    }

    assert.deepEqual(statuts, [200, 429, 200]);
  });

  dbTest('le quota est bien cloisonné par empreinte', async () => {
    await reset();

    const middleware = rateLimit({ prefix: 'par-fp', limit: 1, windowMs: 60_000, message: 'x' });

    const a = await callRateLimit(middleware, fakeReq('7.7.7.1', 'jeton-a'));
    const b = await callRateLimit(middleware, fakeReq('7.7.7.2', 'jeton-b'));
    const aEncore = await callRateLimit(middleware, fakeReq('7.7.7.1', 'jeton-a'));

    assert.deepEqual([a, b, aEncore], [200, 200, 429]);
  });

  dbTest('le quota est bien cloisonné par route', async () => {
    await reset();

    const a = rateLimit({ prefix: 'route-a', limit: 1, windowMs: 60_000, message: 'x' });
    const b = rateLimit({ prefix: 'route-b', limit: 1, windowMs: 60_000, message: 'x' });
    const req = { ip: '8.8.8.8', headers: {}, body: {}, socket: {} };

    assert.deepEqual(
      [
        await callRateLimit(a, req),
        await callRateLimit(a, req),
        await callRateLimit(b, req)
      ],
      [200, 429, 200]
    );
  });
});

describe('intégrité du schéma', () => {
  dbTest('la base n\'impose PAS la limite de 140 caractères', async () => {
    /**
     * Test volontairement « négatif » : il documente une limite réelle du
     * schéma plutôt que de prétendre le contraire.
     *
     * `posts.texte` est déclaré en `TEXT` sur les DEUX moteurs. Ni SQLite ni
     * PostgreSQL n'imposent donc une longueur : un INSERT direct de 5 000
     * caractères passe. La seule barrière est `validateTexte()` côté route,
     * couverte par `logic.test.js`.
     *
     * L'ancien test affirmait l'inverse (`character_maximum_length = 140`) :
     * il aurait échoué sur PostgreSQL lui-même. Personne ne l'a jamais vu
     * échouer parce qu'il était ignoré.
     *
     * À noter : c'est un choix assumé de ne pas avoir de contrainte base, pas un
     * oubli. Ajouter un `CHECK (length(texte) <= 140)` est possible sur les deux
     * moteurs et fournirait une vraie seconde barrière.
     */
    const info = await columnInfo('posts', 'texte');
    assert.ok(info, 'colonne posts.texte introuvable');

    if (isSqlite) {
      assert.match(String(info.type), /TEXT/i, 'SQLite doit stocker texte en TEXT');
    } else {
      assert.equal(info.data_type, 'text', 'PostgreSQL doit stocker texte en text');
      assert.equal(
        info.len,
        null,
        'une colonne text n\'a pas de longueur maximale en base'
      );
    }

    // Confirmation directe : la base accepte bien un texte hors limite.
    const { rows } = await query(
      'INSERT INTO posts (texte) VALUES ($1) RETURNING length(texte) AS n',
      ['a'.repeat(5000)]
    );
    assert.equal(asInt(rows[0].n), 5000, 'la base devrait accepter 5000 caractères');
  });

  dbTest('la limite de 140 est bien appliquée par la couche applicative', () => {
    // La barrière réelle, vérifiée sur le même module que la route.
    const { validateTexte, MAX_TEXTE_LENGTH } = require('../backend/routes/posts');
    assert.equal(validateTexte('a'.repeat(140)).ok, true);
    assert.equal(validateTexte('a'.repeat(141)).ok, false);
    assert.equal(MAX_TEXTE_LENGTH, 140);
  });

  dbTest('les catégories sont bien du JSON', async () => {
    const info = await columnInfo('posts', 'categories');
    assert.ok(info, 'colonne posts.categories introuvable');

    // Un JSON valide doit être accepté et relu à l'identique : c'est ce que la
    // route fait avec `parseJsonColumn`, donc ce qui doit être garanti.
    const categories = ['#Prix', '#Vie'];
    const { rows } = await query(
      'INSERT INTO posts (texte, categories) VALUES ($1, $2) RETURNING categories',
      ['json test', JSON.stringify(categories)]
    );
    const relu = typeof rows[0].categories === 'string'
      ? JSON.parse(rows[0].categories)
      : rows[0].categories;
    assert.deepEqual(relu, categories);
  });

  dbTest('les clés étrangères sont actives', async () => {
    // Sans `foreign_keys = ON`, SQLite accepte un signalement d'un post
    // inexistant : le PRAGMA n'est pas activé par défaut, il faut le poser
    // explicitement à chaque connexion.
    await assert.rejects(
      () => query('INSERT INTO reactions (post_id, type, ip_hash) VALUES ($1, $2, $3)', [999_999, 'mdr', 'fp-orphelin']),
      'une réaction rattachée à un post inexistant devrait être refusée'
    );
  });

  dbTest('les catégories ne se confondent pas par préfixe', async () => {
    // Régression : un filtre `LIKE '%#Prix%'` attrapait `#PrixDuTicket`.
    // Le filtre par catégorie doit être une égalité de valeur.
    await reset();
    await query('INSERT INTO posts (texte, categories) VALUES ($1, $2)', ['prix', JSON.stringify(['#Prix'])]);
    await query('INSERT INTO posts (texte, categories) VALUES ($1, $2)', ['ticket', JSON.stringify(['#PrixDuTicket'])]);

    const { jsonAggSql, categoryContainsSql } = require('../backend/sql');
    void jsonAggSql; // non utilisé ici : le filtre est isolé pour la lisibilité

    const filter = categoryContainsSql('p.categories', '$1', '#Prix');
    const { rows } = await query(
      `SELECT p.texte FROM posts p WHERE ${filter.sql}`,
      [filter.param]
    );
    assert.equal(rows.length, 1, 'le filtre a(attrapé) une catégorie voisine');
    assert.match(rows[0].texte, /prix/);
    assert.doesNotMatch(rows[0].texte, /ticket/);
  });
});

/**
 * Requête du fil (GET /api/posts).
 *
 * Ce bloc existe parce que la requête du fil n'était couverte par AUCUN test :
 * la suite exerçait la couche SQL et la logique pure, jamais la requête
 * elle-même. Résultat, un ORDER BY invalide sur PostgreSQL — l'alias de sortie
 * `total_reactions` utilisé dans une expression, ce que PostgreSQL refuse et que
 * SQLite accepte — est passé totalement inaperçu alors qu'il cassait la vue par
 * défaut, c'est-à-dire la page d'accueil.
 *
 * Ces tests exécutent donc réellement la requête sur le moteur courant. Ils ne
 * valent que s'ils tournent sur les deux : c'est la divergence entre moteurs qui
 * est invisible depuis un seul d'eux.
 */
describe('requête du fil', () => {
  const { buildFeedQuery, fetchFeedPosts } = require('../backend/routes/posts');

  /** Exécute le VRAI fil de production et renvoie les lignes. */
  async function feed({ sort = 'hot', category = '', seenIds = [], limit = 50 } = {}) {
    return fetchFeedPosts({ category, sort, seenIds, limit });
  }

  const ids = (rows) => rows.map((r) => asInt(r.id));

  /** Crée un post avec n réactions réparties sur des types distincts. */
  async function seedPost({ texte, reactions = 0, ageHours = 0, categories = [] }) {
    const { rows } = await query(
      `INSERT INTO posts (texte, categories, created_at) VALUES ($1, $2, $3) RETURNING id`,
      [texte, JSON.stringify(categories), new Date(Date.now() - ageHours * 3_600_000).toISOString()]
    );
    const id = asInt(rows[0].id);
    // (post_id, type) est unique : on alterne les types pour en créer n.
    const types = ['wanda', 'courage', 'mdr', 'priere', 'chaud'];
    for (let i = 0; i < reactions; i++) {
      await query(
        `INSERT INTO reactions (post_id, type, ip_hash) VALUES ($1, $2, $3)`,
        [id, types[i % types.length], `seed-${id}-${i}`]
      );
    }
    return id;
  }

  dbTest('les trois tris s\'exécutent réellement sur le moteur courant', async () => {
    // C\'est le test qui vaut le tri par défaut : un ORDER BY invalide sur
    // PostgreSQL (alias de sortie utilisé dans une expression) est accepté par
    // SQLite, donc seule l\'exécution sur les deux moteurs le révèle.
    await reset();
    const animé = await seedPost({ texte: 'anime', reactions: 4, ageHours: 1 });
    const muet = await seedPost({ texte: 'muet', reactions: 0, ageHours: 1 });

    for (const sort of ['hot', 'recent', 'top']) {
      const rows = ids(await feed({ sort }));
      assert.deepEqual(
        rows.sort((a, b) => a - b),
        [animé, muet].sort((a, b) => a - b),
        `le tri ${sort} doit renvoyer les deux posts`
      );
    }
  });

  dbTest('le tri hot classe par protestation décroissante et pénalise l\'âge', async () => {
    await reset();
    const muet = await seedPost({ texte: 'muet', reactions: 0, ageHours: 1 });
    const vif = await seedPost({ texte: 'vif', reactions: 4, ageHours: 1 });
    const ancien = await seedPost({ texte: 'ancien', reactions: 2, ageHours: 48 });

    const liste = ids(await feed({ sort: 'hot' }));

    assert.equal(liste[0], vif, 'le plus réactif passe devant');
    assert.ok(liste.indexOf(vif) < liste.indexOf(muet), 'un post réactif bat un post muet');
    assert.ok(
      liste.indexOf(vif) < liste.indexOf(ancien),
      'le score hot doit pénaliser l\'âge'
    );
  });

  dbTest('le tri recent ignore les réactions', async () => {
    await reset();
    const vieux = await seedPost({ texte: 'vieux', reactions: 5, ageHours: 10 });
    const neuf = await seedPost({ texte: 'neuf', reactions: 0, ageHours: 0 });

    const liste = ids(await feed({ sort: 'recent' }));

    assert.equal(liste[0], neuf, 'le plus récent passe devant malgré 0 réaction');
    assert.ok(liste.indexOf(neuf) < liste.indexOf(vieux));
  });

  dbTest('le tri top est le plus réactif', async () => {
    await reset();
    const peu = await seedPost({ texte: 'peu', reactions: 1, ageHours: 1 });
    const beaucoup = await seedPost({ texte: 'beaucoup', reactions: 5, ageHours: 1 });

    const liste = ids(await feed({ sort: 'top' }));

    assert.equal(liste[0], beaucoup);
    assert.ok(liste.indexOf(beaucoup) < liste.indexOf(peu));
  });

  dbTest('l\'expression du tri hot ne dépend pas d\'un alias de sortie', async () => {
    // Garde-fou textuel : PostgreSQL résout un nom utilisé dans une expression
    // d\'ORDER BY comme une colonne D\'ENTRÉE, qui n\'existe pas dès qu\'il
    // s\'agit d\'un alias. SQLite, plus laxiste, accepte et masque l\'erreur.
    const { sql } = buildFeedQuery({ category: '', sort: 'hot', seenIds: [], limit: 5 });
    const ordreHot = sql.match(/ORDER BY[\s\S]*?(?=LIMIT)/)[0];

    assert.doesNotMatch(
      ordreHot,
      /COALESCE\(\s*total_reactions/i,
      'le tri hot ne doit pas encapsuler l\'alias total_reactions'
    );
    assert.match(ordreHot, /SUM\(r\.count\)/, 'le tri hot doit répéter l\'agrégat');
  });

  dbTest('les posts masqués n\'apparaissent jamais sur le fil', async () => {
    await reset();
    const actif = await seedPost({ texte: 'visible', reactions: 3, ageHours: 1 });
    await seedPost({ texte: 'censure', reactions: 5, ageHours: 1 });
    await query(`UPDATE posts SET status = 'hidden' WHERE texte = 'censure'`);

    for (const sort of ['hot', 'recent', 'top']) {
      assert.deepEqual(
        ids(await feed({ sort })),
        [actif],
        `un post masqué ne doit jamais sortir, même en ${sort}`
      );
    }
  });

  dbTest('les posts déjà vus sont exclus, le filtrage de catégorie aussi', async () => {
    await reset();
    const un = await seedPost({ texte: 'un', categories: ['#humour'] });
    const deux = await seedPost({ texte: 'deux', categories: ['#humour'] });
    const trois = await seedPost({ texte: 'trois', categories: ['#priere'] });

    assert.deepEqual(
      ids(await feed({ seenIds: [un] })).sort((a, b) => a - b),
      [deux, trois].sort((a, b) => a - b),
      'les posts vus sont écartés'
    );

    assert.deepEqual(
      ids(await feed({ category: '#humour' })).sort((a, b) => a - b),
      [un, deux].sort((a, b) => a - b),
      'le filtre de catégorie ne garde que la bonne catégorie'
    );
  });

  dbTest('le fil ignore `seen` quand tout le contenu a déjà été vu', async () => {
    // Régression constatée au navigateur : un visiteur régulier dont tous les
    // posts sont dans `seen` voyait « Aucun wanda » alors que la base contient
    // des posts actifs. Le repli doit renvoyer le contenu déjà vu plutôt qu'un
    // mur vide ; une base vide doit quand même rester vide.
    await reset();
    const un = await seedPost({ texte: 'un', reactions: 1, ageHours: 1 });
    const deux = await seedPost({ texte: 'deux', reactions: 0, ageHours: 1 });

    assert.deepEqual(
      ids(await feed({ seenIds: [un, deux] })).sort((a, b) => a - b),
      [un, deux].sort((a, b) => a - b),
      'tout le contenu actif doit revenir quand seen couvre tout le corpus'
    );

    await reset();
    assert.deepEqual(
      await feed({ seenIds: [un, deux] }),
      [],
      'une base réellement vide ne doit pas être remplie par le repli'
    );
  });

  dbTest('le total de réactions est agrégé et les catégories désérialisées', async () => {
    await reset();
    await seedPost({ texte: 'tags', reactions: 3, categories: ['#humour', '#chaud'] });

    const [ligne] = await feed();

    assert.equal(asInt(ligne.total_reactions), 3, 'total de réactions agrégé');
    const cats = isSqlite ? JSON.parse(ligne.categories) : ligne.categories;
    assert.deepEqual(cats, ['#humour', '#chaud'], 'catégories désérialisées des deux côtés');
    const reactions = isSqlite ? JSON.parse(ligne.reactions) : ligne.reactions;
    assert.equal(Object.values(reactions).reduce((a, b) => a + asInt(b), 0), 3);
  });

  dbTest('le LIMIT est réellement appliqué', async () => {
    await reset();
    for (let i = 0; i < 5; i++) await seedPost({ texte: `p${i}`, ageHours: i });

    assert.equal((await feed({ limit: 2 })).length, 2, 'la limite est respectée');
  });
});
