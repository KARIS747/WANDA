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
- **Base de Données** : **PostgreSQL sur Neon** (Serverless, persistant, zéro maintenance).
- **Audio & Haptique** : Web Audio API + Vibration API.
- **PWA** : Service Worker (`sw.js`) + `manifest.json`.

---

## 🚀 Installation & Démarrage

### 1. Cloner le projet & installer les dépendances

```bash
git clone https://github.com/karis/wanda.git
cd wanda
npm install
```

### 2. Configurer les variables d'environnement

Créer un fichier `.env` à la racine (ou copier `.env.example`) :

```env
PORT=3000
NODE_ENV=development
DATABASE_URL=postgresql://user:password@ep-cool-project-123456.eu-central-1.aws.neon.tech/neondb?sslmode=require
SALT_SECRET=wanda_secret_salt_237
RATE_LIMIT_MINUTES=5
```

> **Note :** Si `DATABASE_URL` n'est pas encore renseigné, le serveur bascule automatiquement sur un mode mémoire simulé pour vous permettre de tester immédiatement l'interface !

### 3. Lancer le serveur

```bash
npm start
# ou en mode dev avec rechargement automatique :
npm run dev
```

Ouvrez ensuite votre navigateur sur : **`http://localhost:3000`**

---

## 📱 Structure du Projet

```
wanda/
├── frontend/
│   ├── index.html       # Structure HTML sémantique & PWA
│   ├── style.css        # Design System warm charcoal & neo-brutaliste
│   ├── script.js        # Logique de navigation, Web Audio, API & dopamine
│   ├── manifest.json    # Déclaration PWA
│   ├── sw.js            # Service Worker de mise en cache
│   └── icons/           # Icônes SVG haute résolution (192 & 512)
├── backend/
│   ├── server.js        # Serveur Express & service de l'application
│   ├── db.js            # Connexion PostgreSQL Neon & initialisation automatique
│   ├── routes/
│   │   ├── counter.js   # API Compteur en temps réel (fuseau WAT/GMT+1)
│   │   ├── posts.js     # API Publications anonymes (140 car. max)
│   │   ├── reactions.js # API 5 Réactions emojis
│   │   └── reports.js   # API Modération & signalement communautaire
│   └── middleware/
│       ├── rateLimiter.js # Protection anti-spam combinée IP + Token
│       └── wordFilter.js  # Filtrage des mots interdits (politique/haine)
├── PROMT.md             # Cahier des charges & directives
├── package.json
└── README.md
```

---

## ⚖️ Licence

Distribué sous licence **MIT**. Libre de contribution, modification et déploiement.
