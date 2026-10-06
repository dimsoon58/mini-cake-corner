// Commandes de test (orders.is_test, F1 ; marquées par set_order_test_flag).
// Écrans de travail (Tableau de bord, Aujourd'hui, Production, Planning) :
// masquées par défaut, visibles avec la case « Afficher les tests »
// (corps { includeTests: true }), comme Compta, Clients et Remboursements.
// Lecture seule : ne change ni la commande ni ses e-mails.

export const isTestOrder = (o: unknown): boolean => (o as { is_test?: unknown } | null | undefined)?.is_test === true;

export const includeTestsFrom = (body: unknown): boolean => (body as { includeTests?: unknown } | null | undefined)?.includeTests === true;
