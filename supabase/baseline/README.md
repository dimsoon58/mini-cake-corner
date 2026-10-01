# Baseline de la base Supabase (production)

`2026-09-30_production_schema.sql` est une **photo** de la base Supabase de production
(projet `ekciarsrdyismyevgkqg`, PostgreSQL 17) au 30.09.2026, **après** la migration S1
(`supabase/migrations/20260930121354_s1_minimize_anon_authenticated_privileges.sql`).

## À quoi elle sert
- Remettre le dépôt en cohérence avec la production : beaucoup d'objets (tables
  `orders`, `order_items`, `profiles`, cashback, `pending_payments`, fonctions de
  comptabilité, triggers Make, vues d'alerte…) n'existent que dans Supabase et dans
  aucun fichier de `supabase/migrations/`.
- Servir de référence avant toute nouvelle fonctionnalité (refonte de l'Admin).
- Permettre de reconstruire une base de test identique si besoin.

## Ce qu'elle n'est PAS
- **Pas une migration.** Elle est volontairement hors de `supabase/migrations/`,
  pour que la CLI Supabase ne la voie jamais.
- **Ne jamais l'exécuter sur la production** : tout y existe déjà.
- **Ne jamais lancer `supabase db push`** sur ce projet : l'historique des migrations
  en ligne (150 versions) ne correspond pas aux noms des fichiers du dépôt.

## Contenu
1. Extensions · 2. Types enum · 3. Tables (21) · 4. Contraintes et index ·
5. Fonctions (56) · 6. Vues (3, `security_invoker = true`) · 7. Triggers (17, dont
`auth.users → handle_new_user`) · 8. RLS et règles d'accès (16, dont 2 sur le stockage) ·
9. Droits (état après S1) · 10. Buckets de stockage (3) · 11. Tâches cron (2, décrites
sans leurs commandes).

## Secrets
Le dépôt est **public**. La photo ne contient aucun secret :
- les URL des webhooks Make sont remplacées par `<MAKE_WEBHOOK_URL>` ;
- les commandes cron (qui contiennent un secret) ne sont pas reproduites.

## Source et vérification
Générée à partir d'exports **en lecture seule** faits dans le SQL Editor de Supabase
le 30.09.2026 (colonnes, contraintes et index, fonctions, vues/enums/cron, règles
d'accès, triggers, droits, extensions/propriétaires/buckets).

Vérifications faites :
- chaque export comparé aux autres (21 tables, 97 colonnes pour `orders`, 57 pour
  `order_items`, 56 fonctions identiques entre deux exports) ;
- analyse syntaxique complète avec l'analyseur officiel de PostgreSQL (445
  instructions, aucune erreur) ;
- recherche automatique de secrets : aucun.

Non vérifié : l'exécution sur une base vide (il faudrait une base Supabase de test,
avec ses schémas `auth` et `storage` et ses rôles `anon`, `authenticated`,
`service_role`).

## Mettre à jour la photo
Après chaque migration appliquée en production, soit on ajoute le changement à la
main dans ce fichier, soit on refait les mêmes exports en lecture seule et on
régénère le fichier. Dans les deux cas, on ne touche jamais à la production pour ça.
