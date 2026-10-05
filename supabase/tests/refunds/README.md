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

## Étiquettes de production (NIIMBOT B1, 50 × 80 mm)

`test_labels.mjs` : vraie fonction `get-orders-for-labels` sur le schéma de production (F1–F14,
lecture seule via une petite traduction supabase-js → SQL), puis vrai code du site
(`src/lib/productionLabels.ts` : contenu et mise en page, sans navigateur).

```bash
cd supabase/tests/refunds
npm install --no-save @electric-sql/pglite esbuild
node test_labels.mjs
```

Résultat attendu : `81 PASS, 0 FAIL`.

Couvert : accès admin, période limitée ; règles de l'agenda (commande annulée, non payée, brouillon,
gâteau refusé, workshop, bougies, gâteau annulé exclus ; commande manuelle en attente incluse) ;
date propre à chaque gâteau (fulfillments) ; données client limitées (ni e-mail, ni téléphone, ni
prix, ni créneau, ni note) ; mode fiche commande avec la raison des exclusions ; aucune écriture.
Contenu : libellés du catalogue en français (couleurs, goûts, designs, photo choisie), texte exact,
champs vides masqués, informations essentielles manquantes signalées ; plusieurs gâteaux sans
mélange ; quantité 2 → « 1/2 », « 2/2 » ; tri ; texte long → étiquettes « Suite » avec date, client,
commande, intitulé repris, sans perte de mot ni police réduite ; marges respectées ; lignes Excel
pour l'app NIIMBOT. Inspirations : 82 fiches de référence (ordre de la galerie, noms du
catalogue), caractéristiques marquées « (réf.) » sans jamais remplacer les choix de la commande.
Alertes en bas de chaque étiquette, jamais coupées : « COMMENTAIRE CLIENT À LIRE » (commentaire du
gâteau ou de la commande, texte jamais renvoyé), « PHOTO DE RÉFÉRENCE À VOIR » (photos de la
cliente seulement, pas la photo du design choisi) ; « ATTENTION : » dans l'Excel. Le rendu réel (mesure du texte par le navigateur) est vérifié dans l'aperçu.

## Aujourd'hui — commandes en attente de validation

`test_today_pending.mjs` : vraie fonction `get-today` sur le schéma de production (F1–F14).
Résultat attendu : `13 PASS, 0 FAIL` (sur l'ancienne version : les commandes autorisées en capture
différée, paiement « pending », n'apparaissaient pas dans « À décider »).

Couvert : commande du site autorisée en attente (capture différée), workshop seul en attente,
ancienne commande payée en attente ; acceptée, refusée, annulée, en échec, manuelle, brouillon,
remboursée exclues ; date de réception renvoyée ; lecture seule ; bandeau de la page.

## Gâteaux « À accepter » dans la production, le planning et les étiquettes

`test_pending_production.mjs` : vraies fonctions `get-production`, `get-today`,
`list-orders-by-date`, `get-orders-for-labels` et `update-production-status`, puis vrai code des
étiquettes. Résultat attendu : `34 PASS, 0 FAIL`.

Couvert : définition unique `isAwaitingDecision` (commande du site autorisée en attente, ancienne
payée en attente) ; gâteaux visibles avec « À accepter », à leur propre date (plusieurs dates),
quantité 2 → 2 unités / 2 étiquettes ; non comptés (commandés, à faire, goûts, ingrédients),
comptés à part ; « Fait » refusé avant acceptation ; étiquettes non cochées par défaut, mention
encadrée sur chaque étiquette (suites comprises) et dans l'Excel ; après acceptation : badge
retiré, compté, « Fait » possible ; après refus / annulation : retirés.

## Commandes manuelles — quels gâteaux pour quelle date

`test_manual_schedule.mjs` : vraie fonction `list-manual-orders`. Résultat attendu : `8 PASS, 0 FAIL`.
Couvert : une date avec plusieurs gâteaux ; plusieurs gâteaux sur plusieurs dates (chaque gâteau
sous sa propre date, dates dans l'ordre) ; quantité, taille et forme ; champ `dates` et filtre par
date inchangés.

## Stock relié à la production (F15)

`test_stock_production.mjs` : migration F15 + vraies fonctions `get-production`,
`update-production-status` et `update-production-stock`. Résultat attendu : `42 PASS, 0 FAIL`.

Couvert : saisie manuelle inscrite au journal ; exemple 4 en stock / 2 nécessaires / 2 restantes ;
aperçu avant confirmation (quantité retirée) ; « Pris dans le stock » sans double retrait (double
clic, clics simultanés) ; « Préparé frais » ; stock insuffisant (jamais négatif, le reste frais) ;
Dot Cakes en pièces par base ; base inconnue (« Fait » sans retrait, tracé) ; décochage sans
restitution automatique, restitution au plus ce qui a été retiré et une seule fois ; aucun retrait
rétroactif ; annulation avant préparation (hors besoins, stock inchangé) ; préparé puis annulé
(réutilisable / perdu, une seule fois, trace conservée) ; « À accepter » sans stock ; ancienne page
sans « mode » (aucun retrait) ; droits ; journal cohérent ; relance de F15 sans effet.

## PIN admin une seule fois par session (F16)

`test_admin_pin.mjs` : migration F16 + vraies fonctions `admin-pin`, `manage-customers`,
`get-today`, `manage-order` et `get-order-detail` avec le vrai `_shared/admin-auth.ts`.
Résultat attendu : `58 PASS, 0 FAIL` (dont l'envoi réel du jeton avec le vrai supabase-js ; sur l'ancienne version de `manage-order` /
`get-order-detail`, qui lisaient la demande avant la vérification : 5 FAIL — jeton ignoré).

Couvert : comparaison du PIN en temps constant ; connexion et liste d'admins toujours exigées ;
mauvais PIN refusé avec essais restants ; autorisation (jeton + expiration 12 h) ; ni PIN ni jeton en
clair en base ; écriture protégée acceptée avec l'autorisation, refusée sans ; ancienne page (PIN
saisi) acceptée ; jeton refusé dans une autre session de connexion, pour un autre compte ou un
compte non admin ; une autorisation par session ; expiration ; verrouillage à la déconnexion ;
5 échecs = blocage 15 min (par compte) ; mode obligatoire (`ADMIN_PIN_SESSION_REQUIRED`) ; écran PIN
devant le dashboard, révocation à la déconnexion, seul le jeton gardé dans le navigateur, toutes
les fonctions du dashboard reçoivent l'autorisation, plus aucune comparaison directe du PIN,
champs PIN masqués, confirmations simples ; droits ; relance de F16 sans effet.
`manage-order` (remboursement manuel, marquer remboursé, accepter/refuser depuis l'admin) et
`get-order-detail` acceptent l'autorisation de session (corps de la demande lu une seule fois et
transmis à `requireAdmin`), en mode normal et obligatoire ; lien e-mail Accepter/Refuser inchangé ;
aucune fonction ne lit la demande avant `requireAdmin` sans lui transmettre ce corps ; écran PIN
non affiché tant que `admin-pin` n'est pas déployée (Supabase « NOT_FOUND »).

## Annulations depuis l'admin (commande entière, places de workshop)

`test_cancellations.mjs` : vraies fonctions `cancel-order`, `cancel-workshop-seats`,
`send-workshop-cancellation-email`, `admin-pin`, `get-production` et `get-orders-for-labels`
sur le schéma de production (F1–F16). Resend, Make et PostFinance simulés : aucun e-mail réel.
Résultat attendu : `49 PASS, 0 FAIL`.

Couvert : accès (connexion admin + session PIN sans ressaisie ; refus sans connexion, compte non
admin, sans PIN, mauvais secret Make) ; commande du site payée annulée (statut, « à rembourser »,
gâteaux hors production, un seul e-mail = modèle existant, aucun remboursement automatique) ;
nouvelle tentative et double clic simultané sans second e-mail ; refus pour une commande à
accepter (« Refuser »), un brouillon, une commande sans e-mail (avant toute modification) ;
commande manuelle non payée ; commande mixte annulée entièrement (places libérées et tracées,
un seul e-mail) ; places de workshop partielles puis totales (e-mail workshop existant, clé
anti-doublon, nouvelle tentative et double clic sans second e-mail, dépassement refusé, commande
à accepter refusée) ; Make (secret / PIN) inchangé ; gâteau annulé seul hors production et hors
étiquettes ; aucun e-mail à l'enregistrement d'un remboursement ; modèles d'e-mail identiques ;
bloc « Annulation » de la fiche commande ; config JWT.

## Annulation d'UN article depuis l'admin

`test_item_cancellation.mjs` : vraie fonction `cancel-order-item` (+ `admin-pin`, `get-production`,
`get-orders-for-labels`) et la fonction de **production** `cancel-order-item-make` (export du
2026-10-04, `fixtures/prod-cancel-order-item-make.ts`, exécutée sur une base simulée) pour comparer
l'e-mail. Resend et PostFinance simulés. Résultat attendu : `35 PASS, 0 FAIL`.

Couvert : accès (connexion admin + session PIN ; refus sans connexion, non admin, sans PIN) ;
article annulé, autres articles et commande inchangés, e-mail existant « Annulation partielle »
avec la clé Resend d'origine, aucun remboursement automatique ; nouvelle tentative et double clic
sans second e-mail ; article workshop, dernier article actif, commande à accepter, commande
annulée, commande sans e-mail refusés (avant toute modification) ; Resend en panne → article
annulé, e-mail non marqué, « Renvoyer » l'envoie une fois ; 409 Resend jamais pris pour un envoi
(sauf « en cours », non marqué) ; **e-mail identique octet pour octet à la production (FR et EN)**
et bloc du modèle repris mot pour mot ; production et étiquettes ; bloc « Annulation » du site.

## Compta F17 — ventes du mois de réalisation, page finale

`test_compta_sales.mjs` (F17 seule, base locale) : chaque article au mois de son retrait / sa
livraison, chaque workshop au mois de sa séance ; plusieurs dates sans dupliquer le total ; frais et
remises répartis au centime ; une ligne par gâteau ; annulations, refus et gestes commerciaux sans
double déduction ; décompte Mel / Eli sur les ventes ; trésorerie : paiements reçus pour des
commandes futures déduits du disponible, sommes dues par les clients en information.
Avec F18 : remboursements clients encore dus déduits du disponible (article annulé payé non
remboursé, décision de remboursement, sans double comptage avec une décision pour la même annulation
ni avec les paiements de commandes futures ; rien pour une commande non payée). Avec F19 : article
annulé sans décision + geste commercial sur la même commande = les deux réservés (59 + 20), geste
remboursé sans décision, décision « geste » visant l'article annulé, plafond à l'argent reçu.
Résultat attendu : `51 PASS, 0 FAIL`.

`test_compta_page.mjs` (vraie fonction `manage-expenses`, vrai export du site, vrai calcul du
décompte) : « Tableau du mois (Excel) » = écran (une ligne par gâteau, totaux en formules égaux aux
cartes, contrôles OK, même liste de manques) ; « résultat à partager » ≠ « disponible à verser ».
Résultat attendu : `24 PASS, 0 FAIL`. Les tests K1–K5 utilisent la nouvelle signature de l'export.

## Clients F20 — cagnotte, compte, newsletter, bienvenue, source

`test_customer_loyalty.mjs` (vraie fonction `manage-customers`, Supabase Auth SIMULÉ : aucun e-mail
réel) : historique de la cagnotte lu dans les registres existants (gain, utilisation, retrait après
remboursement partiel une seule fois, commande remboursée en entier), écart de solde signalé jamais
corrigé ; crédit manuel (motif obligatoire, plafond, double clic → un seul crédit, un seul envoi à Make) ;
droits (sans connexion, non admin, sans PIN, PIN faux) ; dates newsletter (jamais inventées) et lecture
Brevo ; état de l'offre de bienvenue ; invitation, renvoi d'activation, réinitialisation, garde 60 s
anti double e-mail, erreurs journalisées ; source de la première commande ; depuis F21, le changement
isolé de l'email de connexion est refusé (→ « Modifier l'adresse email »). Résultat attendu :
`53 PASS, 0 FAIL`.

## Clients F21 — « Modifier l'adresse email »

`test_customer_email_change.mjs` (schéma de production + F1–F21, vraie fonction `manage-customers`,
Supabase Auth ET Brevo SIMULÉS : aucun e-mail réel, aucun client réel) : aperçu en lecture seule
(email de contact, email de connexion, nouvelle adresse, conflits, état Brevo) ; droits (identité
non confirmée, sans PIN, non admin ; Eli autorisée) ; client avec compte → même compte, même fiche,
même cagnotte, Auth + profil + fiche + contact Brevo renommé (listes conservées), aucun e-mail ;
désinscrit / désinscrit de tout (blacklist) → jamais réinscrit ; sans compte → aucun compte créé,
aucun contact Brevo créé ; contact ≠ connexion ; conflits (autre fiche, autre compte, contact Brevo
existant, deux contacts Brevo, Brevo indisponible) → rien modifié, aucune fusion ; double clic et
deux onglets → une seule opération ; échecs partiels (Brevo refuse, Brevo tombe pendant l'étape,
Auth en échec, fiche concurrente) → message exact « fait / reste à faire », reprise sans doublon ;
champ email ordinaire et ancien changement isolé refusés ; commandes émises inchangées ;
historique (anciennes / nouvelle adresse, auteur, date, étapes) ; relance de F21.
Résultat attendu : `63 PASS, 0 FAIL`.

## Compta F22 — 3 espaces : commandes du mois, ajouts fiduciaires, dossier par période

`test_compta_fiduciary.mjs` (schéma de production + F1–F22, vraie fonction `manage-expenses`,
stockage simulé, vrai export du site) : commandes du mois avec leurs montants enregistrés (articles,
livraison, express, bienvenue, remise partenaire, cagnotte, ajustement, aucun écart), multi-dates sur
2 mois (« prorata »), quantité 2 (2 lignes, jamais 2 × le prix), payée en septembre et réalisée en
octobre (aucun 2e encaissement), annulations et remboursements, impayé du mois précédent (alerte
séparée) ; ajouts « fiduciaire uniquement » : doublon bloqué puis « Ce n'est pas un doublon »
confirmé et historisé, double clic, modification, justificatifs, suppression, droits ; **résultat,
trésorerie, réserve, parts, avances, dépenses, ventes et mouvements identiques avant / après** ;
export par période : feuilles, totaux = page, chaque justificatif ↔ sa ligne Excel, pièces manquantes,
fichier non récupéré signalé, rien d'envoyé. Résultat attendu : `63 PASS, 0 FAIL`.

## Accès employée F23 — Nahya, sans aucune donnée financière

`test_staff_employee.mjs` (schéma de production + F1–F23, vraies fonctions get-today, get-production,
update-production-status, list-orders, get-order-detail, list-orders-by-date, team-planning,
staff-access et 11 fonctions réservées aux administratrices ; Auth simulé, aucune invitation ni e-mail
réel) : sans accès → rien ; invitation (PIN, confirmation, compte existant sans e-mail, adresse
administratrice refusée, « brouillons de commandes manuelles » impossible à accorder) ; sections
autorisées SANS aucun montant, prix, frais, remise, cagnotte, facture, remboursement ni jeton (scan
complet des réponses) ; administratrices inchangées ; « Fait » / « À préparer » enregistrés avec
l'auteur ; stock manuel, Accepter / Refuser et toutes les fonctions administratrices refusés (même
avec le PIN dans la demande) ; commandes jamais modifiées ; congés : seulement les siens, aperçu et
solde par les règles existantes, en attente / approuvé / refusé / annulé, chevauchements, décision par
Eli ou Mel, historique, aucun solde inventé sans contrat ; désactivation ; accès lié au compte ;
relance de F23. Résultat attendu : `83 PASS, 0 FAIL`.

## Sortie de Notion / Make F24 — interrupteur, rapport quotidien, sessions workshop

`test_notion_exit.mjs` (schéma de production + F1–F24, vrai code partagé order-side-effects /
workshop-make / order-refunds et vraies fonctions daily-health-report, manage-workshop-sessions ;
Make, Resend et fonctions d'e-mail simulés) : synchronisation Notion ACTIVE par défaut et rapport
Supabase INACTIF par défaut ; alerte « SYNCHRO_NOTION » seulement quand Notion est actif ;
déclencheurs make_* coupés et rétablis ; commande du site terminée sans Make quand Notion est
désactivé, un seul e-mail admin et client, aucun appel Make, rien de renvoyé à la reprise ;
workshops et remboursements sans appel Make ; rapport : secret, désactivé, avant 8 h, un seul
e-mail le jour même (clé d'idempotence), rien après 10 h, aucun e-mail sans anomalie, reprise après
échec, aperçu admin ; sessions : liste avec places, création, doublon refusé, capacité sous les places
occupées refusée, type figé, date / heure avec confirmation, prix des réservations conservé,
fermeture, aucune suppression, historique, PIN, droits ; relance de F24. Résultat attendu :
`81 PASS, 0 FAIL` (dont : reprise des factures gâteau et CORS de confirm-workshop-refund identiques
à la production ; retour en arrière en trois cas : jamais envoyée → premier envoi, confirmée pendant
la coupure → aucun envoi, envoyée sans confirmation → étape 3a réparation seule si la fiche Notion
existe, étape 3b premier envoi unique si elle est absente, sur listes d'ID explicites).

`test_f24_shared_diffs.mjs` (esbuild seul, sans base) : écarts d'invoice-pdf.ts et d'email-darkmode.ts
pour postfinance-webhook, retry-order-side-effects et confirm-workshop-refund. Code réellement
embarqué (aucun gabarit ni style d'e-mail client, email-darkmode seulement pour les alertes admin,
postfinance-webhook et confirm-workshop-refund sans facture) ; adminDarkModeStyle et
DARKMODE_META_TAGS identiques à toutes les versions depuis le 16.09 (fixtures/email-darkmode-history) ;
facture identique à la version d'avant d0d6b83 (fixtures/invoice-pdf-before-d0d6b83.ts) pour toutes
les commandes du site, la ligne « Remise / Supplément » n'apparaissant qu'avec un ajustement admin.
Résultat attendu : `32 PASS, 0 FAIL`.


## Tableau de bord — ce qu'il faut gérer, sans chiffres financiers

`test_dashboard.mjs` (schéma de production + F1–F23, vraie fonction get-today sur aujourd'hui + 6
jours, vraie fonction SQL get_workshop_availability, vrai code de regroupement src/lib/dashboard.ts) :
commande à 3 gâteaux sur 2 dates (livraison puis retrait, ligne « × 2 », un gâteau prêt) ;
annulation partielle (gâteau annulé, gâteau annulé par remboursement) et totale ; refus, gâteau
refusé d'une commande mixte ; « à accepter » montré à part, jamais dans la production ; commande
manuelle à encaisser ; hors période ; workshops (places annulées, réservation annulée, session
fermée, sessions passées exclues) ; droits (sans connexion, client, employée sans montant ni
alerte, employée sans « today.view ») ; page sans aucun chiffre financier, lien Compta et bloc de
décision réservés aux administratrices, liens vers commande / production / planning / jour ;
encaissements par date de paiement toujours dans le détail replié de la Compta. Résultat
attendu : `36 PASS, 0 FAIL`.

## Page « Réserver » — sessions proposées (F24)

`test_workshop_sessions_site.mjs` (vrai code src/data/workshopSessions.ts, sans base) : seulement les
sessions de la base, à venir et ouvertes, triées, par type ; une session fermée dans Admin >
Workshops disparaît du site ; prix et heure lus dans la base ; pendant le chargement, aucune session
(jamais l'ancienne liste écrite dans le code). Résultat attendu : `8 PASS, 0 FAIL`.

## Commandes de test masquées par défaut (« Afficher les tests »)

`test_hide_tests.mjs` (schéma de production + F1–F14, vraies fonctions get-today, get-production et
list-orders-by-date) : chaque cas existe en vrai et en test (gâteau accepté, commande à accepter,
workshop manuel à encaisser, commande sans article qui déclenche une alerte). Par défaut, aucune
commande de test dans la journée, « à décider », « à encaisser », les alertes, la Production ni le
Planning ; avec `includeTests: true`, elles reviennent et les commandes réelles restent ; seul le
booléen `true` les affiche ; lecture seule (aucune écriture, seules les lectures du stock F15) ;
la case « Afficher les tests » (?tests=1) sur le Tableau de bord, Aujourd'hui, Production et Planning,
envoyée à la fonction et rechargée quand elle change. Résultat attendu : `31 PASS, 0 FAIL`.

## Samedi : un seul créneau (11:00 – 12:00)

`test_saturday_slot.mjs` (vrai code serveur `_shared/order-pricing.ts` et vrai code du site
`src/lib/orderDates.ts`, sans base ni réseau) : même créneau des deux côtés ; un samedi, 11:00 – 12:00
accepté, tout autre créneau refusé (`SATURDAY_SLOT`) en retrait comme en livraison ; la semaine
inchangée ; commandes manuelles libres (`allowAnySlot`) ; les 4 listes de la page de paiement filtrées,
pas celles de l'admin. Résultat attendu : `12 PASS, 0 FAIL`.
