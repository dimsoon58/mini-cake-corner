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

## Lot 3 — chiffres du mois (F7, `finance-month`) et export Excel

`test_lot3.mjs` exécute la vraie fonction `finance-month` sur la base locale (schéma de production
+ F1–F7), puis génère le fichier Excel avec le vrai code du site (`src/lib/financeExport.ts`) et le
relit avec `exceljs` (dépendance du projet : lancer `npm ci` à la racine d'abord).

```bash
cd supabase/tests/refunds
npm install --no-save @electric-sql/pglite esbuild
node test_lot3.mjs
```

Résultat attendu : `36 PASS, 0 FAIL` (dates réelles d'encaissement et de remboursement, bornes de
mois Europe/Zurich, commande multi-dates encaissée une fois, commande manuelle avec ajustement,
« à dater » et « à vérifier » à part, à encaisser, reste à rembourser, tests exclus ; Excel : 4
onglets, formules SUM, contrôles « OK », un gâteau par ligne, somme des lignes = encaissé).

## Lot C — Clients (F8, `manage-customers`)

`test_lot_c.mjs` applique F1–F7, crée un historique (compte + commandes invitées, panier
abandonné, commande manuelle), applique **F8** (reprise), puis exécute la vraie fonction
`manage-customers`.

```bash
cd supabase/tests/refunds
npm install --no-save @electric-sql/pglite esbuild
node test_lot_c.mjs
```

Résultat attendu : `57 PASS, 0 FAIL` (reprise, nouveau client, client qui recommande, commande
manuelle pour un client existant, plusieurs gâteaux et dates, workshop, annulation et
remboursement partiel, homonymes, contradiction d'email, téléphone partagé, modification sans
toucher aux commandes, ajout de client, rattachement manuel, fusion avec garde-fous, cagnotte et
bienvenue en lecture seule, alerte de compte modifié, fiche vide complétée sans écrasement,
tests exclus, recherche, tri, pagination, aucun appel Make ni e-mail, relance de F8 sans effet).
