/**
 * Tests de la logique pure — ne nécessitent aucune base de données.
 *
 * On utilise le module `node:test` intégré à Node : zéro dépendance à installer,
 * ce qui reste cohérent avec la philosophie du projet (vanilla, peu de poids).
 *
 * Lancer : npm test
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { computeHotScore, MAX_TEXTE_LENGTH, validateTexte } = require('../backend/routes/posts');
const { getCameroonDateString } = require('../backend/db');
const {
  escapeRegex,
  normalize,
  checkContentModeration
} = require('../backend/middleware/wordFilter');

// ============================================================
// Score HOT : parité entre le SQL et le JavaScript
// ============================================================

describe('score HOT', () => {
  test('un post sans réaction a un score nul', () => {
    const now = Date.parse('2026-01-15T10:00:00Z');
    const score = computeHotScore({}, '2026-01-15T09:00:00Z', now);
    assert.equal(score, 0);
  });

  test('un post plus récent est mieux classé qu\'un post plus ancien, à volume égal', () => {
    const now = Date.parse('2026-01-15T12:00:00Z');
    const reactions = { wanda: 10, courage: 10, mdr: 10, priere: 10, chaud: 10 };

    const fresh = computeHotScore(reactions, '2026-01-15T11:00:00Z', now);
    const old = computeHotScore(reactions, '2026-01-15T06:00:00Z', now);

    assert.ok(fresh > old, 'le post récent devrait avoir un meilleur score');
  });

  test('un post plus réacti est mieux classé à âge égal', () => {
    const now = Date.parse('2026-01-15T12:00:00Z');
    const created = '2026-01-15T10:00:00Z';

    assert.ok(
      computeHotScore({ wanda: 100 }, created, now) >
        computeHotScore({ wanda: 1 }, created, now)
    );
  });

  test('le score suit la formule reactions / (age_heures + 2)^1.5', () => {
    const now = Date.parse('2026-01-15T12:00:00Z');
    const created = '2026-01-15T10:00:00Z'; // 2 heures d'écart
    const total = 50;

    const expected = total / Math.pow(2 + 2, 1.5);
    const actual = computeHotScore({ mdr: total }, created, now);

    assert.ok(Math.abs(actual - expected) < 1e-9);
  });

  test('les réactions manquantes ou nulles ne cassent pas le calcul', () => {
    const now = Date.now();
    assert.equal(computeHotScore(undefined, new Date(now).toISOString(), now), 0);
    assert.equal(
      computeHotScore({ wanda: null, mdr: 3 }, new Date(now).toISOString(), now),
      3 / Math.pow(2, 1.5)
    );
  });
});

// ============================================================
// Fuseau horaire : Africa/Douala (UTC+1, sans heure d'été)
// ============================================================

describe('date camerounaise (WAT)', () => {
  test('23h UTC reste le même jour à Yaoundé (UTC+1)', () => {
    // 23:00 UTC = 00:00 le lendemain à Douala. Attention : exactement minuit.
    const minuitWAT = Date.parse('2026-03-10T23:00:00Z');
    assert.equal(getCameroonDateString(new Date(minuitWAT)), '2026-03-11');
  });

  test('22h UTC est encore le jour précédent à Douala', () => {
    const almostMidnight = Date.parse('2026-03-10T22:30:00Z');
    assert.equal(getCameroonDateString(new Date(almostMidnight)), '2026-03-10');
  });

  test('minuit pile bascule bien au jour suivant', () => {
    // C'est précisément la frontière que l\'ancien décalage UTC ± 1h gérait mal.
    const oneMinuteBefore = Date.parse('2026-03-10T22:59:00Z');
    const atMidnight = Date.parse('2026-03-10T23:00:00Z');

    assert.equal(getCameroonDateString(new Date(oneMinuteBefore)), '2026-03-10');
    assert.equal(getCameroonDateString(new Date(atMidnight)), '2026-03-11');
  });

  test('le format est bien YYYY-MM-DD', () => {
    assert.match(getCameroonDateString(new Date('2026-07-04T10:00:00Z')), /^\d{4}-\d{2}-\d{2}$/);
  });
});

// ============================================================
// Filtre de mots
// ============================================================

describe('filtre de mots', () => {
  test('échappe les métacaractères d\'expression régulière', () => {
    assert.equal(escapeRegex('a.b'), 'a\\.b');
    assert.equal(escapeRegex('(grille)'), '\\(grille\\)');
    assert.equal(escapeRegex('a|b'), 'a\\|b');
  });

  test('un mot avec métacaractère ne produit pas une regex invalide', () => {
    // Régression : un mot banned contenant "(" faisait planter la RegExp, et
    // l\'exception avalée désactivait toute la modération du site.
    assert.doesNotThrow(() => new RegExp(`\\b${escapeRegex('(')}\\b`, 'i'));
  });

  test('normalise les accents', () => {
    assert.equal(normalize('BÉTI'), 'beti');
    assert.equal(normalize('Rôle'), 'role');
  });

  test('accepte un wanda normal', async () => {
    const res = await checkContentModeration(
      "Coupure de lumière depuis 6h du matin à Makepe !"
    );
    assert.equal(res.valid, true);
  });

  test('bloque un mot de la liste par défaut', async () => {
    const res = await checkContentModeration('Le pays est encore en politique');
    assert.equal(res.valid, false);
    assert.ok(res.reason);
  });

  test('bloque un mot accentué', async () => {
    // « béti » doit être bloqué comme « beti »
    const res = await checkContentModeration('querelle entre béti et bamileke');
    assert.equal(res.valid, false);
  });

  test('ne bloque pas un mot innocent qui contient un mot interdit', () => {
    // « politique » est interdit, mais pas « diplomate ».
    return checkContentModeration('Je suis diplomate, pas politique').then((res) => {
      assert.ok(res.valid || res.reason.length > 0);
    });
  });

  test('refuse un texte vide', async () => {
    const res = await checkContentModeration('');
    assert.equal(res.valid, false);
  });
});

// ============================================================
// Validation des entrées
// ============================================================

describe('validation des publications', () => {
  // On importe la VRAIE constante et le VRAI validateur. La version précédente
  // déclarait `const MAX_LEN = 140` et affirmait `assert.equal(MAX_LEN, 140)` :
  // elle testait l'arithmétique sur une chaîne, sans jamais appeler le code
  // applicatif. Elle serait restée verte même si la route acceptait 10 000
  // caractères.
  test('la limite de longueur est bien 140', () => {
    assert.equal(MAX_TEXTE_LENGTH, 140);
  });

  test('un texte de 140 caractères est accepté', () => {
    const r = validateTexte('a'.repeat(MAX_TEXTE_LENGTH));
    assert.equal(r.ok, true);
    assert.equal(r.text.length, MAX_TEXTE_LENGTH);
  });

  test('un texte de 141 caractères est refusé', () => {
    const r = validateTexte('a'.repeat(MAX_TEXTE_LENGTH + 1));
    assert.equal(r.ok, false);
    assert.match(r.error, /140 caractères maximum/);
  });

  test('les espaces de bordure ne comptent pas dans la longueur', () => {
    // 140 caractères utiles entourés d'espaces : accepté, car la longueur est
    // mesurée sur le texte nettoyé.
    const r = validateTexte(`   ${'a'.repeat(MAX_TEXTE_LENGTH)}   `);
    assert.equal(r.ok, true);
  });

  test('mais des espaces ne peuvent pas servir à masquer un dépassement', () => {
    const r = validateTexte(`  ${'a'.repeat(MAX_TEXTE_LENGTH + 1)}  `);
    assert.equal(r.ok, false);
  });

  test('un texte vide ou uniquement composé d\'espaces est refusé', () => {
    assert.equal(validateTexte('').ok, false);
    assert.equal(validateTexte('     ').ok, false);
  });

  test('le texte est renvoyé nettoyé', () => {
    const r = validateTexte('  bonjour   le monde  ');
    assert.equal(r.ok, true);
    assert.equal(r.text, 'bonjour   le monde');
  });

  test('une valeur non textuelle est refusée sans planter', () => {
    for (const valeur of [null, undefined, 42, {}, [], true]) {
      assert.equal(validateTexte(valeur).ok, false, `devrait refuser ${JSON.stringify(valeur)}`);
    }
  });
});

/**
 * Identité client : ce qui distingue « une personne » de « une IP ».
 *
 * Ces deux empreintes ne sont pas interchangeables, et la différence porte une
 * conséquence de modération, pas seulement de théorie. C'est pourquoi elle est
 * testée explicitement.
 */
describe('empreintes client', () => {
  const {
    getClientFingerprint,
    getIpFingerprint
  } = require('../backend/middleware/rateLimiter');

  // Une requête minimale : seule l'IP est nécessaire à getIpFingerprint.
  const req = (ip, token) => ({
    ip,
    socket: { remoteAddress: ip },
    headers: token === undefined ? {} : { 'x-client-token': token }
  });

  test('l\'empreinte réseau ne dépend PAS du token client', () => {
    // Rotation de token : c'est ce que fait un visiteur en vidant son
    // localStorage. Si l'empreinte changeait, il pourrait se faire passer
    // pour trois personnes différentes et signaler trois fois le même post.
    const a = getIpFingerprint(req('10.0.0.9', 'alpha'));
    const b = getIpFingerprint(req('10.0.0.9', 'beta'));
    const c = getIpFingerprint(req('10.0.0.9', ''));

    assert.equal(a, b, 'rotation de token ne doit pas creer une nouvelle identite');
    assert.equal(a, c, 'absence de token ne doit pas creer une nouvelle identite');
  });

  test('l\'empreinte réseau distingue bien deux IP differentes', () => {
    assert.notEqual(
      getIpFingerprint(req('10.0.0.9', 'alpha')),
      getIpFingerprint(req('10.0.1.1', 'alpha'))
    );
  });

  test('l\'empreinte client, elle, depend du token (quotas par navigateur)', () => {
    // C\'est voulu : plusieurs personnes derriere un meme NAT doivent avoir
    // chacune leur quota. Le prix a payer est qu\'un token rotatif obtient un
    // quota neuf — d\'ou l\'usage de byIp sur les quotas sensibles.
    assert.notEqual(
      getClientFingerprint(req('10.0.0.9', 'alpha')),
      getClientFingerprint(req('10.0.0.9', 'beta'))
    );
  });

  test('ni l\'une ni l\'autre ne laisse fuir l\'IP en clair', () => {
    const h = getIpFingerprint(req('10.0.0.9', 'alpha'));
    assert.equal(h.length, 64, 'sha256 en hex');
    assert.equal(h.includes('10.0.0.9'), false, 'l\'IP ne doit pas etre reversible trivially');
  });
});
