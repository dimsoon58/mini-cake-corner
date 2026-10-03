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

## Lot E — Planning équipe (F9 + fonction `team-planning`)

`test_team.mjs` applique F1–F9 au schéma de production, assemble la **vraie** fonction
`supabase/functions/team-planning/index.ts` et le module de calcul `_shared/team-hours.ts`, puis
simule la date du jour (`TEAM_PLANNING_TEST_TODAY`, variable réservée aux tests).

```bash
cd supabase/tests/refunds
npm install --no-save @electric-sql/pglite esbuild
node test_team.mjs
```

Résultat attendu : `91 PASS, 0 FAIL`.

Couvert : semaine normale de 21 h ; 23 h puis 19 h (solde cumulé 0) ; jour non renseigné
(« À compléter », solde provisoire) ; pause non payée ; semaine complète de vacances (21 h
décomptées, aucun déficit) ; un jour et une demi-journée (4 h 12 / 2 h 06, crédit distinct) ;
samedi qui remplace le lundi ; période avec repos et jour férié ; maladie et réduction employeur
séparées ; modification, suppression, doublon et chevauchement refusés ; semaines partielles de
début et de fin ; copie de semaine (prévu uniquement, confirmation de remplacement) ; dates hors
contrat ; prolongation avec son propre droit ; historique ; accès ; relance de F9 sans effet.

## Compta, lot K1 — Dépenses (F10 + fonction `manage-expenses`)

`test_compta_k1.mjs` applique F1–F10, assemble les **vraies** fonctions `manage-expenses` et
`finance-month`, et le **vrai** code d'export du site (`src/lib/comptaExport.ts` : Excel et ZIP
des justificatifs). Le stockage des fichiers est simulé (aucun accès réseau).

```bash
cd supabase/tests/refunds
npm install --no-save @electric-sql/pglite esbuild
node test_compta_k1.mjs
```

Résultat attendu : `67 PASS, 0 FAIL`.

Couvert : dépense Bento et avance personnelle (jamais « payée par le compte Bento ») ; achat en
EUR avec le montant réellement débité en CHF ; montant CHF inconnu (jamais 0, hors totaux, compté
à part) et justificatif manquant ; saisie très incomplète ; achat de septembre payé en octobre
(deux lectures) ; reste à payer ; double clic ; doublons possibles signalés sans blocage ;
correction et historique ; suppression logique ; catégories désactivées / renommées ; permissions
des justificatifs (bucket privé, formats, taille, liens signés courts, aucun lien stocké) ;
cohérence revenus tableau de bord / Excel ; commandes de test exclues ; noms identiques Excel /
ZIP ; aucune commande modifiée ; relance de F10 sans effet.

## Compta, lot K2 — Salaire mensuel de Nahya (F11 + actions `salary_*` de `manage-expenses`)

`test_compta_k2.mjs` applique F1–F11 (`20261002160000_f11_compta_salary.sql`), assemble la vraie
fonction `manage-expenses` et le vrai code d'export du site.

```bash
cd supabase/tests/refunds
npm install --no-save @electric-sql/pglite esbuild
node test_compta_k2.mjs
```

Résultat attendu : `58 PASS, 0 FAIL`.

Couvert : mois du contrat (septembre compris) créés sans montant (« à saisir », jamais 0) ; net
prévu récurrent et nouveau montant à partir d'un mois sans toucher les précédents ; aucun
prorata ; net confirmé séparé du prévu ; plusieurs versements datés, total versé et reste,
dépassement refusé, double clic ; aucun « payé » automatique ; versements comptés à leur date,
jamais dans les dépenses ; charges sociales = dépenses normales ; ancienne dépense « Salaires »
comptée tant qu'elle n'est pas rapprochée, puis comptée une seule fois (versement créé ou
existant), annulation du rapprochement ; prolongation proposée puis ajoutée à la main ; décompte
facultatif (« justificatif manquant »), bucket privé, lien court ; historique ; Excel (feuille
Salaire, colonnes séparées, formules) et ZIP ; compatibilité K1 ; relance de F11 sans effet.

## Compta, lot K3 — Remboursement des avances (F12 + actions `advance_*` de `manage-expenses`)

`test_compta_k3.mjs` applique F1–F12, assemble la vraie fonction `manage-expenses` et le vrai
code d'export du site.

```bash
cd supabase/tests/refunds
npm install --no-save @electric-sql/pglite esbuild
node test_compta_k3.mjs
```

Résultat attendu : `46 PASS, 0 FAIL`.

Couvert : avances comptées une fois en dépense ; remboursement partiel puis report sur le mois
suivant sans nouvelle déduction ; remboursement jamais compté comme dépense ; dépassement du reste
et avance soldée refusés ; double clic ; un virement pour plusieurs avances ; montant inconnu,
fournisseur pas encore payé, autre personne, compte Bento et doublon refusés ; avance « À payer »
hors du reste à rembourser ; Nahya remboursée ; garde-fous sur une avance déjà remboursée
(suppression, personne, case avance, montant effacé) ; correction à la baisse → trop-remboursé
signalé ; annulation tracée puis nouveau remboursement ; historique ; Excel (feuille Avances et
remboursements, formules, contrôle) ; compatibilité K1/K2 ; relance de F12 sans effet.

## Compta, lot K4 — Décompte Mel / Eli (F13 + actions `settlement_*` de `manage-expenses`)

`test_compta_k4.mjs` applique F1–F13, assemble la vraie fonction `manage-expenses`, le module de
calcul `_shared/settlement.ts` et le vrai code d'export du site. Le scénario va d'octobre 2026 à
mai 2027 ; les soldes bancaires futurs sont insérés directement (la page refuse une date future).

```bash
cd supabase/tests/refunds
npm install --no-save @electric-sql/pglite esbuild
node test_compta_k4.mjs
```

Résultat attendu : `82 PASS, 0 FAIL`.

Couvert : règles confirmées (dès 10.2026, base 4'000, +300, 60 %) ; blocages (salaire à confirmer,
montant inconnu, mois précédent non validé) ; résultat logique B, avance comptée une fois et
remboursée hors partage avant la base ; ajustement explicite après validation, appliqué une fois ;
base comptable atteinte mais non prouvée par la banque (tout conservé) ; base confirmée par le
solde de fin de mois, 300 dès ce mois, 60/40 ; bénéfice conservé ≠ base + épargne ; conserver en
plus ; libération motivée et plafonnée ; versements réels avec solde récent et dettes du même
jour, part partiellement payée qui reste à verser ; perte reportée compensée une seule fois ; base
entamée et trésorerie insuffisante à confirmer ; versement groupé part + avance (registre K3),
annulation ; arrondi (Mel au centime, Eli le reste) ; Excel (8 feuilles, formules, INCOMPLET puis
COMPLET) ; décompte figé ; PIN admin exigé par le serveur pour valider, verser, annuler un
versement, créer ou annuler un ajustement (absent ou incorrect → 403, aucune écriture ; correct →
accepté) ; relance de F13 sans effet.

## Compta, lot K5 — Finalisation des exports (aucune migration, aucune fonction)

`test_compta_k5.mjs` (F1–F13, vraie fonction `manage-expenses`, vrai code d'export du site).

```bash
cd supabase/tests/refunds
npm install --no-save @electric-sql/pglite esbuild
node test_compta_k5.mjs
```

Résultat attendu : `15 PASS, 0 FAIL`.

Couvert : une seule liste des manques, identique dans l'Excel et sur la page ; contrôles croisés
décompte ↔ feuilles sources (Synthèse, Dépenses, Salaire) en formules, OK puis ÉCART quand un mois
validé est modifié (décompte figé, ajustement demandé) ; passage à COMPLET quand rien ne manque et
que le décompte est validé ; dossier complet en un ZIP (Excel, justificatifs nommés avec les ID de
l'Excel, index, LISEZMOI), pièce non récupérable marquée MANQUANT ; rien n'est supprimé.

## Partenaires V1 — migration F14 et fonction `manage-partners`

`test_partners.mjs` applique F1–F14, assemble la vraie fonction `manage-partners` et simule des
commandes du site telles que le paiement les enregistre (partenaire, remise et commission figés).

```bash
cd supabase/tests/refunds
npm install --no-save @electric-sql/pglite esbuild
node test_partners.mjs
```

Résultat attendu : `53 PASS, 0 FAIL`.

Couvert : accès admin et PIN pour toute écriture ; création, identifiant en double ou modifié
refusé ; lien `?ref=` avec le jeton existant ; code Notion gardé comme simple référence ; remise
0 % et commission « À configurer » ; règles P5 (annulation client d'un ou deux gâteaux, même gâteau
annulé deux fois, geste commercial partiel ou total, motif retiré) ; remboursement sans motif →
« À vérifier » avec la commission initiale visible ; commission « calculée » tant que les
conditions ne sont pas confirmées, « due » ensuite, révocation ; paiements au partenaire
(idempotence, trop-versé après annulation, annulation d'un paiement) ; changement de taux sans
recalcul des commandes passées ; filtre de période, désactivation, recherche ; commandes de test
et brouillons exclus ; aucune attribution manuelle (une commande manuelle n'apparaît jamais) ;
journal d'audit ; aucun appel externe ; relance de F14 sans effet.

## Partenaire sans remise (0 %) — paiement

`test_partner_checkout.mjs` assemble le **vrai** code du paiement (`create-postfinance-payment` et
`_shared/partner-referral.ts`) avec une base simulée en mémoire et un PostFinance simulé (aucun
appel réseau, aucune base PGlite nécessaire).

```bash
cd supabase/tests/refunds
npm install --no-save esbuild
node test_partner_checkout.mjs
```

Résultat attendu : `33 PASS, 0 FAIL` (sur l'ancien code : 14 échecs, tous sur les cas 0 %).

Couvert : lien d'un partenaire à 0 % reconnu, remise négative / 100 % / partenaire inactif refusés ;
commande attribuée avec la commission configurée (sur le prix de base), aucune remise partenaire ;
remise de bienvenue réservée et appliquée si le client y a droit, prix plein sinon (bienvenue déjà
utilisée, invité, non demandée) ; deux gâteaux (bienvenue sur un seul, commission sur les deux) ;
lignes PostFinance = total. Comportement inchangé sans partenaire et pour un partenaire à 10 %
(remise appliquée, bienvenue jamais réservée, jamais -20 %). Site : l'offre de bienvenue n'est
masquée que par un partenaire avec remise, le jeton est toujours envoyé, aucun message « 0 % ».
