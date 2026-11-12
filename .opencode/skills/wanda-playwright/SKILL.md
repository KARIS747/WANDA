---
name: wanda-playwright
description: Use when testing the WANDA PWA in a browser with Playwright: validate counter, wall, search, hashtags, posting, reactions, themes, animations, mobile and desktop. Triggers: Playwright, browser test, UI test, visual check, screenshot, WANDA UI.
---

# Tests navigateur WANDA

## Préparation

- Vérifie `curl -fsS http://localhost:3000/api/health`.
- Si le serveur ne tourne pas, démarre-le sans tuer un processus existant :
  `nohup npm start >/tmp/wanda-test-server.log 2>&1 & echo $!`
- Pour les parcours qui écrivent (publier, réagir, signaler), préfère une instance isolée :
  `PORT=3101 SQLITE_PATH=/tmp/wanda-playwright.sqlite3 nohup npm start >/tmp/wanda-test-3101.log 2>&1 & echo $!`
  puis teste `http://localhost:3101`.
- Utilise d'abord les outils MCP Playwright (`playwright_*`). En secours seulement, utilise `playwright-core` avec `/usr/bin/chromium` et bloque le service worker :
  `browser.newContext({ serviceWorkers: 'block' })`.

## Parcours minimum

1. **Compteur** : accueil, valeur lisible, clic, rang, absence d'erreur console.
2. **Mur** : chargement, tri Hot/Récents/Top, filtre catégorie, état vide.
3. **Recherche** : ouverture par icône, focus, `Échap`, requête < 2 caractères, résultats, effacement.
4. **Hashtags** : préfixe, compteur `0/5`, suggestions, ajout/retrait, limite de 5.
5. **Publication** : validation 140 caractères, erreur réseau, succès, rafraîchissement du Mur.
6. **Réactions** : toggle, compteurs, animation emoji, pas de double comptage visuel incohérent.
7. **Réglages** : 8 thèmes, 10 animations, test d'animation, sons/vibrations.
8. **Responsive** : `390x844` et `1440x900`, pas de débordement horizontal, nav fixe et bouton central visibles.

## Preuves

- Capture mobile et desktop dans `/tmp/opencode/wanda-agents/`.
- Note les erreurs console, les requêtes `/api` en échec et les erreurs CSP.
- Si le CSS ou le JS semble périmé, recharge sans cache et vérifie `CACHE_VERSION` dans `frontend/sw.js` ; ne conclus pas à une régression visuelle avant d'avoir écarté le service worker.
- N'envoie pas trois signalements sur un même post : à trois IP distinctes, il est masqué.

Rapporte au chef : commandes, matrice, résultats, captures, bugs reproductibles et zones non testées.
