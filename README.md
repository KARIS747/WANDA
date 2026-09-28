# 💥 WANDA — L'Exutoire Collectif Camerounais

> *"Tu n'es pas seul. Ce que tu vis, des milliers de personnes le vivent aussi. On est tous dans le même bateau. Et ensemble, on peut en rire."*

WANDA est une Progressive Web App (PWA) open-source camerounaise. Ce n'est pas un site de plainte : c'est un miroir de solidarité et d'humour face aux galères quotidiennes (coupures de courant, embouteillages interminables, hausse des prix, tracasseries administratives).

---

## 🌟 Principes Fondamentaux

1. **L'Anonymat Sacré** : Pas de compte, pas de profil, pas d'influenceurs, pas de clout. Tout le monde est égal.
2. **Zéro Politique & Zéro Haine** : La plateforme est dédiée au rire et à la solidarité. Aucun contenu politique, partisan, diffamatoire ou tribaliste n'est toléré.
3. **Design Anti "Vibe Coder"** :
   - ❌ Pas de dégradés violet/indigo néon.
   - ❌ Pas de glassmorphism flou.
   - ❌ Pas d'emojis parasites sur les boutons (icônes SVG vectorielles uniquement).
   - ✅ Palette chaude et vivante : Charbon `#141210`, Rouge Wanda `#E63946`, Ambre Solaire `#FFB703`.
4. **Ergonomie Mobile-First (TikTok style)** :
   - Arrivée directe sur le Compteur du jour.
   - Bouton central surélevé `➕` pour publier depuis n'importe où.
   - Barre de navigation fixe en bas d'écran.
5. **Dopamine & Audio Léger** : Synthèse sonore native via **Web Audio API** (0 Ko de data consommée) et explosion d'emojis de réactions.

---

## 🛠️ Stack Technique

- **Frontend** : Vanilla HTML5 / CSS3 / JavaScript (Ultra-léger, instantané sur réseaux 3G/4G).
- **Backend** : Node.js + Express.
- **Base de Données** : **SQLite par défaut** (zéro configuration) ou **PostgreSQL** (Neon, Railway, Supabase) — même code applicatif, deux moteurs.
- **Audio & Haptique** : Web Audio API + Vibration API.
- **PWA** : Service Worker (`sw.js`) + `manifest.json`.
- **Dépendances** : 4 (`express`, `pg`, `dotenv`, `helmet`). C'est un choix : tout ce qui grossit le bundle se paie en 3G. Le chemin SQLite utilise le module natif `node:sqlite`, sans dépendance supplémentaire.

---

## 🚀 Installation & Démarrage

### 1. Cloner le projet & installer les dépendances

```bash
git clone https://github.com/karis/wanda.git
cd wanda
npm install
```

### 2. Configurer les variables d'environnement

```bash
cp .env.example .env
```

**Il n'y a rien à installer par défaut.** Sans `DATABASE_URL`, l'application crée
seule `data/wanda.sqlite3` et joue sur les tables réelles : le compteur compte,
les réactions s'enregistrent, rien n'est factice.

Pour renseigner une base explicite :

```env
# Soit PostgreSQL (nécessaire seulement pour absorber des pics de trafic,
# ou si l'hébergement ne fournit que des bases externes) :
DATABASE_URL=postgresql://user:password@ep-cool-xyz.eu-central-1.aws.neon.tech/neondb?sslmode=require

# Soit un autre emplacement SQLite (par défaut : data/wanda.sqlite3) :
# SQLITE_PATH=data/wanda.sqlite3

# Obligatoire dans les deux cas en production :
SALT_SECRET=<un secret aléatoire, voir ci-dessous>
```

> ⚠️ Si une base est configurée mais injoignable, le serveur **refuse de démarrer**
> au lieu de servir de la fiction. Un compteur faux en production est pire qu'une
> panne visible. Pour un hébergement au système de fichiers éphémère, SQLite ne
> survivra pas au redéploiement : utilisez `DATABASE_URL`.

> **Générer un `SALT_SECRET` solide :**
> ```bash
> node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
> ```
> En production, l'application **refuse de démarrer** sans cette variable : avec un
> sel devinable, les empreintes client sont réversibles et l'anonymat tombe.

### 3. Lancer le serveur

```bash
npm start
# ou en mode dev avec rechargement automatique :
npm run dev
```

Ouvrez ensuite votre navigateur sur : **`http://localhost:3000`**

Le schéma de la base est créé et mis à jour automatiquement au démarrage : rien
à installer côté SQL.

---

## 🧪 Tests

```bash
npm test        # tests de logique + tests d'intégration, sur SQLite
npm run lint    # vérification syntaxique
npm run icons   # régénère les icônes PNG depuis les SVG
```

Les tests d'intégration vérifient ce qui ne peut pas être simulé : la
déduplication du compteur, le masquage sur trois signalements **distincts**, les
quotas de débit, les migrations et les requêtes du fil. Ils sont
automatiquement ignorés si aucune base n'est accessible.

Ils tournent sur **les deux moteurs**, et c'est nécessaire : une requête peut
être valide en SQLite et invalide en PostgreSQL — un alias de sortie utilisé dans
une expression `ORDER BY` en est un exemple, et cela cassait la vue par défaut.
Tester sur un seul moteur laisse passer ce genre de bug.

```bash
npm test                    # SQLite, base temporaire supprimée à la fin
npm run lint                # vérification syntaxique
npm run icons               # régénère les icônes PNG depuis les SVG
```

Pour exercer PostgreSQL en local, utilisez `TEST_DATABASE_URL` — et **jamais**
`DATABASE_URL` : ces tests font des `TRUNCATE`, et la suite refuse de démarrer
si la base visée ne porte pas un nom de base jetable (`..._test`) :

```bash
docker run --rm -d --name wanda-pg-test \
  -e POSTGRES_USER=wanda -e POSTGRES_PASSWORD=wanda -e POSTGRES_DB=wanda_test \
  -p 55432:5432 postgres:16-alpine

TEST_DATABASE_URL=postgresql://wanda:wanda@localhost:55432/wanda_test npm test
```

La CI exécute les deux suites (`SQLite` puis `PostgreSQL`) sur un Postgres
éphémère.

---

## 🔒 Comment WANDA protège son compteur

C'est le point le plus sensible du produit : le compteur est la preuve sociale
qui donne envie de cliquer. S'il peut être manipulé, tout le reste s'effondre.

- **Le compteur compte des personnes, pas des clics.** La table `counter_votes`
  a une clé primaire `(date, empreinte)`. Boucler sur l'endpoint n'incrémente
  rien : la personne ne compte qu'une fois par jour.
- **Le rang est réel.** « Tu es la 248e personne » correspond à ta position
  effective parmi les participants du jour, pas au nombre de clics.
- **Une route qui écrit ne confirme jamais un échec.** Si l'écriture échoue,
  l'API répond `503` et le frontend affiche une erreur. Le comportement
  inverse — un `201` factice alors que rien n'était enregistré — a été
  supprimé : c'était le bug le plus grave du projet.
- **Toutes les routes d'écriture ont un quota**, stocké en base (donc valable
  même avec plusieurs instances). En cas d'indisponibilité de la base, le
  contrôle **bloque** par défaut au lieu de laisser passer.
- **L'adresse IP n'est jamais stockée en clair**, seulement une empreinte
  salée. `x-forwarded-for` n'est plus lu en confiance aveugle : `req.ip` est
  utilisé, via un `TRUST_PROXY` explicite.
- **Les signalements sont dédupliqués** : un index unique `(post_id, empreinte)`
  impose qu'il faille trois personnes *différentes* pour masquer une
  publication.

### Mode démonstration

Quand la base est injoignable, l'API peut servir des données de mock pour
permettre de travailler sur l'interface :

```bash
ALLOW_MEMORY_FALLBACK=true npm start
```

Dans ce mode, les **écritures sont refusées en 503** et les lectures portent
`demo: true`, ce qui affiche un bandeau d'avertissement dans l'interface. Un
compteur fictif ne doit jamais pouvoir passer pour un vrai chiffre.

> ⚠️ Ne jamais activer ce mode en production.

---

## 📁 Structure du Projet

```
wanda/
├── frontend/
│   ├── index.html          # Structure HTML sémantique & PWA
│   ├── style.css           # Design System warm charcoal & neo-brutaliste
│   ├── script.js           # Logique de navigation, Web Audio, API & dopamine
│   ├── manifest.json       # Déclaration PWA
│   ├── sw.js               # Service Worker (cache-first sur le shell)
│   └── icons/              # Sources SVG + icônes PNG générées
├── backend/
│   ├── server.js           # Serveur Express, CSP, gestion d'erreurs
│   ├── db.js               # SQLite & PostgreSQL, transactions, fuseau Africa/Douala
│   ├── sql.js              # Adaptateurs SQL (placeholders, JSON, âge HOT)
│   ├── migrations.js       # Migrateur de schéma
│   ├── routes/
│   │   ├── counter.js      # Compteur : personnes distinctes
│   │   ├── posts.js        # Publications anonymes (140 car. max)
│   │   ├── reactions.js    # Réactions emojis
│   │   └── reports.js      # Signalements dédupliqués
│   └── middleware/
│       ├── rateLimiter.js  # Quotas en base + empreinte client
│       └── wordFilter.js   # Filtrage des mots interdits
├── test/                   # Tests node:test
├── scripts/                # Génération des icônes
├── PROMT.md                # Cahier des charges & directives
├── CONTRIBUTING.md         # Guide de contribution
└── package.json
```

---

## 🕐 Fuseau horaire

Tout le compteur est calé sur **Africa/Douala (UTC+1)**.

La date du jour est calculée **en JavaScript** et passée en paramètre, plutôt que
laissée à `CURRENT_DATE` : `CURRENT_DATE` s'interprète dans le fuseau du serveur
— l'UTC en SQLite, celui de l'hôte en PostgreSQL. Résultat, un visiteur à
Yaoundé voyait le « Top du jour » basculer une heure avant minuit, exactement
pendant la fenêtre où il change. Les horodatages suivent la même horloge, avec
une précision à la milliseconde : `CURRENT_TIMESTAMP` en SQLite n'en a qu'une à
la seconde, ce qui donnait le même rang à deux personnes ayant cliqué au même
instant.

---

## 📄 Licence

MIT — voir [LICENSE](./LICENSE). Les contributions sont les bienvenues, voir
[CONTRIBUTING.md](./CONTRIBUTING.md).
