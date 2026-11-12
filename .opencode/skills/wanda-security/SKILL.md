---
name: wanda-security
description: Use when auditing WANDA security: anonymity, fingerprints, trust proxy, rate limiting, report deduplication, counter integrity, SQL injection, CSP, secrets, dual-database risks. Triggers: security audit, threat model, vulnerability, rate limit, CSP, fingerprint, SQL injection.
---

# Audit sécurité WANDA

## Modèle de menace

WANDA est anonyme et son compteur est une preuve sociale. Les actifs critiques sont : l'anonymat des visiteurs, l'intégrité du compteur, l'intégrité des réactions et signalements, la disponibilité, et l'absence de secrets dans le dépôt.

## Checklist

### Identité et anonymat
- `req.ip` avec `TRUST_PROXY` explicite ; jamais `X-Forwarded-For` brut.
- `SALT_SECRET` obligatoire en production ; aucune IP brute dans les logs, réponses ou rapports.
- Les empreintes client/IP sont salées, stables et non réversibles.

### Écritures et abus
- Toute route d'écriture a un rate limit et échoue en `503` si la base est indisponible.
- Aucun succès/`201` si l'écriture a échoué ; aucun `catch` vide non justifié.
- Compteur : unicité `(date, fingerprint)`, rang réel, total recalculé.
- Réactions : index unique `(post_id, type, ip_hash)`, toggle atomique.
- Signalements : unicité `(post_id, ip_hash)`, masquage après 3 IP distinctes.

### Entrées et SQL
- Requêtes paramétrées ; aucune concaténation de valeur utilisateur.
- Validation de `postId`, longueur du texte, type de réaction, limite de tags.
- Différences SQLite/PostgreSQL isolées dans `backend/sql.js` ; tester les deux moteurs.
- Migrations idempotentes et append-only.

### HTTP et navigateur
- CSP sans `unsafe-inline`, `script-src 'self'`, `frame-ancestors 'none'`.
- `Cache-Control: no-store` sur `/api`, limite JSON bornée, CORS inutile absent.
- HSTS en production, `trust proxy` non ouvert.
- Aucun secret, token ou identifiant réel dans le code, les logs ou la CI.

### Produit et vie privée
- Aucun compte, profil ou tracking ajouté.
- Les quotas ne doivent pas être contournables en régénérant le token client seul.
- Les parcours de test ne doivent pas vider une base réelle.

## Vérification active

Pour les tests destructifs, lance une instance isolée :

```bash
PORT=3101 SQLITE_PATH=/tmp/wanda-security.sqlite3 NODE_ENV=development \
  nohup npm start >/tmp/wanda-security.log 2>&1 & echo $!
```

Utilise `curl`, `npm test` et `TEST_DATABASE_URL` uniquement sur une base jetable. Ne vise jamais `data/wanda.sqlite3` ni une base de production.

## Format de retour

Pour chaque constat : sévérité, `fichier:ligne`, scénario d'exploitation, preuve, correctif recommandé, test de régression. Si tu n'as pas de preuve, classe-le comme hypothèse à vérifier.
