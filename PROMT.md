
# PROJET : WANDA (PWA)

## LA VISION

WANDA est un projet open-source camerounais. Ce n'est pas juste un site web. C'est un cri collectif.

Au Cameroun, "wanda" veut dire : *je suis choqué, étonné, abasourdi, dépassé*. C'est ce qu'on dit quand on est bloqué dans un embouteillage pendant 3 heures, quand il n'y a pas de courant depuis 8 heures, quand les prix ont doublé en une semaine, quand on se fait ghoster, quand l'administration te fait tourner en rond.

Le problème, c'est que chacun vit ça **seul**. Dans sa tête. Dans sa voiture. Dans sa chambre. Et on a l'impression d'être le seul à galérer.

WANDA existe pour briser cette solitude.

L'idée est simple : un site où les gens viennent cliquer sur un bouton pour dire "j'ai wanda aujourd'hui". Un compteur global montre combien de personnes sont dans le même cas. Un mur de publications anonymes permet de raconter son wanda en 140 caractères. Des réactions permettent de dire "je te comprends", "courage", "on est ensemble".

**Le message du projet :**

> *Tu n'es pas seul. Ce que tu vis, des milliers de personnes le vivent aussi. On est tous dans le même bateau. Et ensemble, on peut en rire.*

Ce n'est pas un site de plainte. C'est un site de **solidarité**. C'est un exutoire collectif. C'est un miroir qui montre à chaque Camerounais qu'il n'est pas seul.

**L'ambiance :**

Fun, légère, mais sincère. On rit de nos galères, mais on les reconnaît. On ne se moque pas. On compatit. On dit "wanda" ensemble.

---

## L'ANONYMAT EST UNE FONCTIONNALITÉ, PAS UNE CONTRAINTE

Personne n'a de compte. Personne n'a de pseudo. Personne ne peut se construire une image. Pas d'influenceurs. Pas de clout chasing. Pas de likes pour la gloire.

WANDA n'appartient à personne. Il appartient à tout le monde.

Les gens publient anonymement, réagissent anonymement, et repartent. C'est ce qui fait la beauté du projet : **ici, tout le monde est égal**.

On accepte la conséquence : pas de suivi personnel, pas de notifications individuelles, pas de badges. Mais on gagne : la liberté de s'exprimer sans jugement, sans peur, sans image à protéger.

---

## LA PSYCHOLOGIE DES COULEURS (GUIDE, PAS ORDRE)

Tu as la liberté créative sur l'UI. Mais réfléchis à ce que chaque couleur évoque, et choisis en fonction de l'émotion que tu veux transmettre.

Réfléchis à ces questions :

- Quelle couleur donne envie de cliquer sur un bouton ? (L'urgence, l'action, l'émotion forte.)
- Quelle couleur donne un sentiment de calme, de sécurité, de "on est ensemble" ? (Pour le fond, l'ambiance.)
- Quelle couleur met en valeur un chiffre important ? (Pour le compteur.)
- Quelle couleur donne un sentiment de chaleur, de communauté, d'africanité ? (Pour l'identité du site.)

Quelques pistes de réflexion :

- **Le rouge** évoque l'urgence, l'action, l'émotion forte. C'est la couleur du bouton "J'AI WANDA".
- **Le jaune** évoque l'énergie, l'optimisme, la chaleur. C'est la couleur du compteur.
- **Le noir** évoque la profondeur, le mystère, mais aussi la solidarité dans l'obscurité. C'est une bonne couleur de fond.
- **L'orange** évoque la chaleur, la convivialité, l'africanité.
- **Le vert** évoque l'espoir, la solidarité, la communauté.
- **Le violet** évoque la spiritualité, l'émotion, la connexion.

À toi de jouer. Choisis une palette qui **raconte une histoire**. L'UI doit être belle, fun, et donner envie de rester. Elle doit évoquer l'Afrique, la solidarité, et un peu de folie.

**Une seule règle : l'UI ne doit pas être triste.** WANDA est un site de galère, mais on en rit. C'est un site de solidarité, pas de déprime.

---

## L'EXPÉRIENCE UTILISATEUR (LE PARCOURS)

Voici ce que vit un utilisateur :

1. **Il arrive sur le site.** Il voit le compteur du jour. Il voit le gros bouton. Il voit les derniers wandas.
2. **Il clique sur le bouton.** Animation satisfaisante. Le compteur s'incrémente. Un message s'affiche : *"Tu es le 248e à wanda aujourd'hui. Tu n'es pas seul."*
3. **Il écrit son wanda.** 140 caractères max. Il choisit une ou plusieurs catégories (#UY1, #NEPA, #Prix, etc.). Il publie anonymement.
4. **Il voit son post apparaître sur le mur.** Il peut le partager sur WhatsApp.
5. **Il voit les posts des autres.** Il peut réagir avec 5 emojis : 🤯 WANDA, 💪 COURAGE, 😂 MDR, 🙏 PRIÈRE, 🔥 C'EST CHAUD.
6. **Quand il clique sur un emoji, l'emoji explose en grand sur son écran** avec une animation fun et rapide. C'est le moment dopamine. C'est ce qui donne envie de revenir.
7. **Il scrolle le mur.** Il peut filtrer par catégorie. Il voit que d'autres vivent la même chose.
8. **Il revient plus tard.** Le compteur a changé. De nouveaux posts sont là. Il clique encore.

---

## LES FONCTIONNALITÉS V1

1. **Gros bouton rouge** "J'AI WANDA AUJOURD'HUI" → incrémente le compteur global.
2. **Compteur global** en temps réel. Se réinitialise à minuit.
3. **Publication anonyme** (140 caractères max) avec catégories.
4. **Catégories** : #Cameroun, #Diaspora, #France, #Embouteillage, #NEPA, #Prix, #UY1, #Benskin, #Ghosting, #Administration, #Humour, #AutrePays.
5. **Réactions** : 🤯 WANDA, 💪 COURAGE, 😂 MDR, 🙏 PRIÈRE, 🔥 C'EST CHAUD.
6. **Animations dopamine** : quand on clique sur un emoji, il grossit jusqu'à 10x, tremble, explose en particules, avec son et vibration (mobile). Chaque réaction a sa propre personnalité.
7. **Mur des wandas** en temps réel. Les nouveaux posts apparaissent en haut.
8. **Filtres** par catégorie.
9. **Bouton "Partager sur WhatsApp"** sur chaque post.
10. **Bouton "Signaler"** sur chaque post (signalement anonyme).
11. **Filtre de mots** pour bloquer les obscénités et les insultes.
12. **Rate limiting** : 1 publication par IP toutes les 5 minutes.
13. **Lien "Soutenir WANDA"** discret en bas de page (dons).
14. **Réinitialisation quotidienne** du compteur à minuit (cron job).

---

## LA PWA (PROGRESSIVE WEB APP)

- `manifest.json` : nom, icônes (192x192 et 512x512), couleurs, mode standalone.
- `sw.js` : service worker pour le cache et le mode hors ligne partiel.
- Meta tags dans `index.html` pour l'installation sur mobile.
- Responsive design : l'app doit s'adapter à tous les écrans (mobile d'abord).
- L'app doit être installable sur l'écran d'accueil du téléphone.

---

## LA STACK TECHNIQUE

- **Frontend** : HTML, CSS, JavaScript (vanilla, pas de framework lourd).
- **Backend** : Node.js + Express.
- **Base de données** : SQLite (léger, facile, pas de serveur externe).
- **Hébergement** : Render (gratuit) pour le backend, Netlify ou Render pour le frontend.
- **Domaine** : à acheter plus tard (wanda.cm ou wanda237.com).

---

## LA STRUCTURE DU PROJET

```
wanda/
├── frontend/
│   ├── index.html
│   ├── style.css
│   ├── script.js
│   ├── manifest.json
│   ├── sw.js
│   └── icons/
│       ├── icon-192.png
│       └── icon-512.png
├── backend/
│   ├── server.js
│   ├── db.js
│   └── routes/
│       ├── posts.js
│       ├── reactions.js
│       └── counter.js
├── README.md
├── LICENSE (MIT)
├── CONTRIBUTING.md
└── .gitignore
```

---

## LE SCHÉMA DE LA BASE DE DONNÉES

**Table `posts` :**
- `id` (INTEGER PRIMARY KEY AUTOINCREMENT)
- `texte` (VARCHAR 140, NOT NULL)
- `categories` (TEXT, JSON array de hashtags)
- `created_at` (TIMESTAMP DEFAULT CURRENT_TIMESTAMP)
- `is_hidden` (BOOLEAN DEFAULT 0) — pour les posts signalés
- `report_count` (INTEGER DEFAULT 0)

**Table `reactions` :**
- `id` (INTEGER PRIMARY KEY AUTOINCREMENT)
- `post_id` (INTEGER, FOREIGN KEY)
- `type` (VARCHAR) — 'wanda', 'courage', 'mdr', 'priere', 'chaud'
- `created_at` (TIMESTAMP DEFAULT CURRENT_TIMESTAMP)
- `ip_hash` (VARCHAR) — hash de l'IP pour éviter les abus

**Table `counter` :**
- `date` (DATE PRIMARY KEY)
- `total` (INTEGER DEFAULT 0)

**Table `banned_words` :**
- `id` (INTEGER PRIMARY KEY AUTOINCREMENT)
- `word` (VARCHAR UNIQUE)

---

## LES RÈGLES D'OR DU PROJET

1. **L'humour avant tout.** WANDA est un site de galère, mais on en rit. Pas de haine, pas de violence, pas de politique.
2. **L'anonymat est sacré.** Pas de compte, pas de pseudo, pas de traçage. On ne stocke que l'IP hashée pour le rate limiting.
3. **La simplicité est une force.** Pas de fonctionnalités inutiles. Un bouton, un compteur, un mur, des réactions.
4. **La PWA est obligatoire.** L'app doit être installable sur mobile.
5. **Le code est open-source.** MIT. Tout le monde peut contribuer, modifier, vendre.
6. **Pas de commentaires.** Les réactions remplacent les commentaires. C'est un choix délibéré pour éviter la toxicité.
7. **La modération est minimale.** Filtre de mots + signalement + masquage automatique après 3 signalements.
8. **L'UI doit être belle et fun.** Elle doit donner envie de cliquer, de publier, de revenir.

---

## LES ÉTAPES DE DÉVELOPPEMENT

1. **Setup du projet** : structure des dossiers, Git, README, LICENSE.
2. **PWA de base** : manifest.json, sw.js, meta tags.
3. **Frontend** : HTML, CSS, JS pour la page d'accueil (bouton, compteur, formulaire, mur).
4. **Backend** : Express, SQLite, routes API (posts, réactions, compteur).
5. **Connexion** : frontend ↔ backend.
6. **Animations** : réactions avec explosion d'emoji, sons, vibrations.
7. **Modération** : filtre de mots, signalement, rate limiting.
8. **Déploiement** : Render, Netlify, domaine.

---

## COMMENCE PAR

1. Créer la structure du projet.
2. Créer le `README.md` avec la vision du projet.
3. Créer le `manifest.json` et le `sw.js`.
4. Créer le `index.html` avec les meta tags PWA.
5. Créer le `style.css` avec une UI belle, fun, et inspirée de la psychologie des couleurs.
6. Créer le `script.js` avec la logique du bouton, du compteur, et l'enregistrement du service worker.
7. Créer le backend Express + SQLite.
8. Connecter le frontend au backend.

**À chaque étape, demande-toi : est-ce que ça donne envie de cliquer ? Est-ce que ça donne envie de revenir ? Est-ce que ça donne le sentiment qu'on n'est pas seul ?**

C'est ça, WANDA.
```

