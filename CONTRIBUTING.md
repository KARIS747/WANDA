# Contribuer à WANDA

WANDA est un projet **open source** et contributif — au sens le plus simple :
personne n'a de compte, personne n'a de poids dans la modération, tout le monde
part avec le même droit de parole. Ça vaut aussi pour le code.

## Le principe à garder en tête

> *Tu n'es pas seul.*

Chaque modification devrait servir cet objectif. Si tu hesites entre deux
approches, demande-toi laquelle aide quelqu'un à se sentir moins seul
aujourd'hui.

## Règles d'or (issues de `PROMT.md`)

1. **L'humour avant tout.** WANDA est un site de galère, mais on en rit. Pas de
   haine, pas de violence, pas de politique.
2. **L'anonymat est sacré.** Aucune IP en clair, aucun compte, aucun traçage.
3. **La simplicité est une force.** Pas de fonctionnalité inutile.
4. **Peu de commentaires dans le code.** Les réactions d'emoji remplacent les
   commentaires d'une publication, et la même logique vaut pour le code : un
   nom explicite vaut mieux qu'un commentaire qui explique le nom. Ce qui est
   vraiment non évident (une contrainte de sécurité, un calcul) doit en revanche
   être documenté avec la raison, pas seulement le mécanisme.
5. **Peu de dépendances.** Le projet fait partie de ces PWA qui doivent rester
   utilisables en 3G. Ajouter une dépendance pour dix lignes de code est un
   mauvais échange.

## Démarrer

```bash
git clone https://github.com/karis/wanda.git
cd wanda
npm install
cp .env.example .env      # puis renseigne DATABASE_URL
npm run dev
```

Les tests tournent sans base de données :

```bash
npm test          # tests de logique + tests d'intégration (ignorés si pas de base)
npm run lint      # vérification syntaxique
npm run icons     # régénère les PNG depuis les SVG
```

Pour exécuter les tests d'intégration, il faut une base :

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/wanda_test npm test
```

## Avant d'ouvrir une pull request

- [ ] `npm test` passe
- [ ] `npm run lint` passe
- [ ] Si tu touches au schéma : tu **ajoutes** une migration dans
      `backend/migrations.js`, tu ne modifies jamais une migration déjà
      appliquée
- [ ] Si tu touches au schema SQL : tu le rends idempotent (`IF NOT EXISTS`)
- [ ] Si tu ajoutes une route : elle vérifie `res.ok` côté frontend et ne
      ment jamais sur un échec d'écriture
- [ ] Ton code ne journalise ni IP en clair, ni secret

## Conventions

- **Commentaires en français**, code et noms de variables en anglais (usage
  standard). C'est le choix du projet, sois cohérent avec le fichier que tu
  modifies.
- **SQL toujours paramétré** (`$1`, `$2`...). Jamais de concaténation.
- **Pas de `catch` vide.** Si une erreur est avalée, c'est délibéré et commenté.
  Le projet a précisément souffert d'un `catch` qui renvoyait un succès
  factice : l'utilisateur croyait avoir publié, son message avait disparu.
- **Toute nouvelle route qui écrit doit avoir un rate limit** et répondre 503
  en cas de panne, jamais 201.

## Modérer le code

On protège l'anonymat et la tonalité. En cas de désaccord sur une PR, c'est le
code qui tranche : si une modification rend le produit moins anonyme, moins
léger ou moins exclusion-safe, elle n'est pas retenue — quelle que soit sa
qualité technique.

## Signaler un problème de sécurité

Écris directement au mainteneur plutôt qu'en ouvrant une issue publique.
Pense notamment à toute façon de contourner le rate limiting, d'identifier
quelqu'un, ou de faire afficher un chiffre faux.

## Licence

En contribuant, tu acceptes que ton travail soit publié sous licence MIT.
