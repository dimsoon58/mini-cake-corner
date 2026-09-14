# CI — ce qui tourne automatiquement

Ajouté le 2026-09-14, suite à l'incident de page blanche sur `/catalog` et
`/candles` (deux bugs qu'aucune vérification automatique n'aurait empêché
d'atteindre la production).

## Un seul workflow : `.github/workflows/deploy-pages.yml`

Deux jobs, `checks` puis `deploy` (`deploy` a `needs: checks` — il ne
démarre que si `checks` réussit intégralement, jamais en parallèle).

**`checks`** — sur chaque push (toutes branches) et chaque Pull Request
vers `main` :
1. `npm run lint` — ESLint (voir plus bas pour le détail des règles).
2. `npm run typecheck` (`tsc -b`) — 0 erreur actuellement.
3. `npx vite build --base=/mini-cake-corner/` — la vraie build de
   production, avec le vrai chemin de base GitHub Pages.
4. Préparation du déploiement (noindex, fallback SPA `404.html`) puis
   `upload-pages-artifact` — **cet artefact est celui qui sera
   effectivement publié**, jamais reconstruit une seconde fois.
5. `npm run test:smoke` (Playwright) contre **ce même `dist/`**, servi avec
   le même chemin de base (`SMOKE_BASE_PATH=/mini-cake-corner`) — donc
   littéralement l'artefact qui serait mis en ligne. Un seul build, réutilisé
   pour les tests et pour le déploiement, jamais deux builds identiques.
   9 routes : `/`, `/catalog`, `/candles`, `/dot-cakes`, `/kit-bento-cake`,
   `/cart`, `/checkout`, `/printing`, `/inspiration`. Vérifie uniquement :
   la page répond, affiche du contenu visible, et aucune erreur JavaScript
   n'est survenue (à l'exception connue des échecs de chargement de
   Cookiebot/Google Tag Manager, des scripts tiers qui échouent normalement
   sans accès réseau à ces domaines précis). Aucune assertion sur le
   contenu métier, les prix ou le texte.

**`deploy`** — uniquement sur un vrai push sur `main` (jamais sur une PR),
et uniquement si `checks` a réussi. Publie l'artefact déjà construit — pas
de nouveau build.

## Ce que ça change concrètement

- **Le push sur `main` continue de fonctionner exactement comme avant** —
  aucune protection de branche, aucun blocage du push lui-même.
- **Ce qui change** : si `checks` échoue (lint cassé, erreur de type, build
  cassée, ou une des 9 pages plante), le job `deploy` ne se déclenche
  simplement pas — la version cassée n'atteint jamais GitHub Pages. Le
  commit reste sur `main`, seule la mise en ligne est empêchée.
- Le déploiement ne peut jamais démarrer avant la fin des vérifications
  (`needs: checks`, une dépendance native GitHub Actions — pas une
  convention, une garantie du planificateur).

## Étape suivante possible (pas faite, à valider)

Pour bloquer aussi le push lui-même (jamais rien de cassé, même
temporairement, sur `main`) : GitHub → Settings → Branches → règle sur
`main` → "Require status checks to pass before merging", sur le job
`checks`. **Sans** exiger de review humaine — dès que le CI est vert, une PR
reste mergeable immédiatement. Ça implique un changement de méthode de
travail : plus de push direct sur `main`, il faudrait systématiquement une
branche + une PR (bot d'auto-sync inclus).

## Règles ESLint passées de `error` à `warn` (2026-09-14)

Toutes pré-existantes, jamais introduites par un changement normal — voir
`eslint.config.js` pour le commentaire complet :

| Règle | Occurrences (tout le repo) | Où |
|---|---|---|
| `@typescript-eslint/no-explicit-any` | 202 | surtout `supabase/functions/**` (Deno, appels RPC non typés — pattern déjà établi partout) + une quarantaine dans `src/` |
| `prefer-const` | 4 | `src/pages/Cart.tsx`, `Catalog.tsx`, `PaymentSuccess.tsx` |
| `@typescript-eslint/no-empty-object-type` | 2 | `src/components/ui/command.tsx`, `textarea.tsx` (boilerplate shadcn/ui) |
| `@typescript-eslint/ban-ts-comment` | 2 | idem, boilerplate shadcn/ui |
| `no-empty` | 1 | `src/pages/KitBentoCake.tsx` |
| `@typescript-eslint/no-require-imports` | 1 | `tailwind.config.ts` |

**Ce qui n'a PAS été touché, et reste en erreur bloquante** : toutes les
règles `eslint:recommended` et `typescript-eslint/recommended` de base
(variables non définies, etc.), toutes les règles `react-hooks/recommended`
(règles des Hooks — `rules-of-hooks`, `exhaustive-deps` reste en warning
comme avant), et `react-refresh/only-export-components` (déjà en warn avant
ce changement). Rien de ce qui détecte un vrai bug de logique n'a été
affaibli — uniquement des règles de style/typage strict, déjà massivement
présentes avant ce rollout.

## Fichiers concernés

- `.github/workflows/deploy-pages.yml` — le workflow (checks + deploy).
- `playwright.config.ts`, `tests/smoke.spec.ts` — les smoke tests.
- `src/components/ErrorBoundary.tsx` (monté dans `src/main.tsx`) — filet de
  sécurité côté client : si un bug passe quand même à travers, le client
  voit un message clair au lieu d'une page blanche.
