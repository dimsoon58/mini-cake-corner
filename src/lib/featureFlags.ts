// Frontend feature flags. Small, explicit, no framework — one named constant
// per flag, imported directly where needed.

// Multi-date fulfillment (Sept 2026 project): a single order/payment may
// contain physical products for several different pickup/delivery dates,
// each becoming its own `order_fulfillments` row server-side. Backend
// (create-postfinance-payment / confirm-postfinance-payment), the customer-
// facing email/invoice templates, MyOrders.tsx/AdminOrder.tsx, and Make/
// Notion (adapted on the user's side to read fulfillment_id/order_fulfillments)
// are all ready — enabled 2026-09-12. While it was OFF, the cart refused a
// second pickup/delivery date (CartContext.addItem) and Checkout rendered the
// single-block delivery UI; that gate is now lifted.
export const MULTI_DATE_FULFILLMENT_ENABLED = true;

// Collection de Noël (page /noel, lien « Noël » du menu, bandeau et carte de
// l'accueil). false = visible seulement par les admins connectées (Mel, Eli)
// pour préparer la page ; passer à true le jour de la mise en ligne.
export const CHRISTMAS_PUBLIC = false;

// Bons cadeaux (F37, page /bon-cadeau, lien du menu « Nos produits » et
// bouton de la page Workshop). false = visible seulement par les admins
// connectées : l'achat marche, mais le bon ne s'utilise dans le panier
// qu'avec l'étape 2. Passer à true quand l'étape 2 est en ligne.
export const GIFT_CARDS_PUBLIC = false;
