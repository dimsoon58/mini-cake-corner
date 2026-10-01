# Tests SQL — registre des remboursements (lot 1)

Ces tests chargent la photo de la base de production
(`supabase/baseline/2026-09-30_production_schema.sql`) dans une base PostgreSQL locale
**en mémoire** (PGlite), appliquent les migrations F1–F5, puis vérifient le comportement.
Ils ne se connectent jamais à Supabase.

```bash
cd supabase/tests/refunds
npm install --no-save @electric-sql/pglite
node test_refunds.mjs
```

Résultat attendu : `106 PASS, 0 FAIL`.

Ce qui est couvert : situation « avant » (anciens mécanismes) puis bascule F5, décisions et reste
à rembourser, plafond (admin et Make), doublons (y compris réservation du plafond), double clic,
rejeu Make, cashback une seule fois (workshops compris), correction, commandes de test, absence
d'effet sur paiement/validation, rejeu complet des migrations.

## Lot 2 — fonction `manage-refunds` + lectures F6

`test_lot2.mjs` assemble le **vrai code** de `supabase/functions/manage-refunds/index.ts`
(esbuild) et exécute ses appels `supabase.rpc()` sur la même base locale (schéma de production
+ F1–F6).

```bash
cd supabase/tests/refunds
npm install --no-save @electric-sql/pglite esbuild
node test_lot2.mjs
```

Résultat attendu : `48 PASS, 0 FAIL` (accès admin / PIN, décisions, remboursements, double clic,
geste commercial, plafond, correction, datation, onglets Effectués / À effectuer / À vérifier,
bornes de mois Europe/Zurich, « à dater », commandes de test masquées, aucun effet sur paiement /
statut / production, aucun appel Make).
