# -*- coding: utf-8 -*-
import io, os, sys

ROOT = "/sessions/rcw-01d8yvniirrtjcjqoatid7yj/mnt/mini-cake-corner"

def read(p): return io.open(p, "r", encoding="utf-8").read()
def write(p, s):
    tmp = p + ".tmp"
    io.open(tmp, "w", encoding="utf-8").write(s)
    os.replace(tmp, p)

def rep(s, old, new, tag, n=1):
    c = s.count(old)
    if c != n:
        print("MISMATCH [%s] expected %d got %d: %r" % (tag, n, c, old[:100]))
        sys.exit(1)
    return s.replace(old, new)

# =========================================================== AdminOrder.tsx
P = os.path.join(ROOT, "src/pages/AdminOrder.tsx")
s = read(P); n0 = len(s)

s = rep(s,
    u'import Layout from "@/components/Layout";',
    u'import Layout from "@/components/Layout";\nimport { useLang } from "@/context/LanguageContext";',
    "ao-import")

s = rep(s,
    u'const AdminOrder = () => {\n  const { id } = useParams<{ id: string }>();',
    u'const AdminOrder = () => {\n  const { t } = useLang();\n  const { id } = useParams<{ id: string }>();',
    "ao-hook")

A = [
 (u'message: "Please enter the admin PIN"',
  u'message: t("Please enter the admin PIN", "Veuillez saisir le code PIN administrateur")'),
 (u'message: "Missing action token. Please use the link from the notification email."',
  u'message: t("Missing action token. Please use the link from the notification email.", "Jeton d\'action manquant. Veuillez utiliser le lien reçu dans l\'e-mail de notification.")'),
 (u'? "✅ Order approved! Payment has been captured."\n          : "❌ Order rejected. Payment has been canceled.",',
  u'? t("✅ Order approved! Payment has been captured.", "✅ Commande approuvée ! Le paiement a été capturé.")\n          : t("❌ Order rejected. Payment has been canceled.", "❌ Commande refusée. Le paiement a été annulé."),'),
 (u'message: err instanceof Error ? err.message : "Unknown error"',
  u'message: err instanceof Error ? err.message : t("Unknown error", "Erreur inconnue")'),
 (u'<p className="text-muted-foreground">Order not found.</p>',
  u'<p className="text-muted-foreground">{t("Order not found.", "Commande introuvable.")}</p>'),
 (u'`Order #${order.id.slice(0, 8).toUpperCase()}`',
  u'`${t("Order", "Commande")} #${order.id.slice(0, 8).toUpperCase()}`'),
 (u'<p className="font-medium">Secure token missing</p>',
  u'<p className="font-medium">{t("Secure token missing", "Jeton sécurisé manquant")}</p>'),
 (u'<p>Please use the link from the notification email to manage this order. Direct access without a token is not permitted.</p>',
  u'<p>{t("Please use the link from the notification email to manage this order. Direct access without a token is not permitted.", "Veuillez utiliser le lien reçu dans l\'e-mail de notification pour gérer cette commande. L\'accès direct sans jeton n\'est pas autorisé.")}</p>'),
 (u'>👤 Customer Information</h3>',
  u'>{t("👤 Customer Information", "👤 Informations client")}</h3>'),
 (u'<DetailRow label="Name" value={order.customer_name} />',
  u'<DetailRow label={t("Name", "Nom")} value={order.customer_name} />'),
 (u'<DetailRow label="Email" value={order.customer_email} />',
  u'<DetailRow label={t("Email", "E-mail")} value={order.customer_email} />'),
 (u'<DetailRow label="Phone" value={order.customer_phone} />',
  u'<DetailRow label={t("Phone", "Téléphone")} value={order.customer_phone} />'),
 (u'>📦 Pickup / Delivery</h3>',
  u'>{t("📦 Pickup / Delivery", "📦 Retrait / Livraison")}</h3>'),
 (u'<DetailRow label="Date" value={formatDateFromIso(order.order_date)} />',
  u'<DetailRow label={t("Date", "Date")} value={formatDateFromIso(order.order_date)} />'),
 (u'<DetailRow label="Time" value={details.pickupTime} />',
  u'<DetailRow label={t("Time", "Heure")} value={details.pickupTime} />'),
 (u'<DetailRow label="Option" value={order.delivery_option === "delivery" ? "Delivery" : "Pickup at store"} />',
  u'<DetailRow label={t("Option", "Option")} value={order.delivery_option === "delivery" ? t("Delivery", "Livraison") : t("Pickup at store", "Retrait en boutique")} />'),
 (u'<DetailRow label="Address" value={order.delivery_address} />',
  u'<DetailRow label={t("Address", "Adresse")} value={order.delivery_address} />'),
 (u'<DetailRow label="Delivery Notes" value={details.deliveryComment} />',
  u'<DetailRow label={t("Delivery Notes", "Notes de livraison")} value={details.deliveryComment} />'),
 (u'>🍰 Order Items ({items.length})</h3>',
  u'>{t("🍰 Order Items", "🍰 Articles de la commande")} ({items.length})</h3>'),
 (u'<span className="font-medium text-sm">Cake {i + 1}</span>',
  u'<span className="font-medium text-sm">{t("Cake", "Gâteau")} {i + 1}</span>'),
 (u'<DetailRow label="Size" value={item.sizeName} />',
  u'<DetailRow label={t("Size", "Taille")} value={item.sizeName} />'),
 (u'<DetailRow label="Shape" value={item.shapeName} />',
  u'<DetailRow label={t("Shape", "Forme")} value={item.shapeName} />'),
 (u'<DetailRow label="Flavor" value={item.flavorName} />',
  u'<DetailRow label={t("Flavour", "Parfum")} value={item.flavorName} />'),
 (u'<DetailRow label="Design / Style" value={item.styleName} />',
  u'<DetailRow label={t("Design / Style", "Design / Style")} value={item.styleName} />'),
 (u'<DetailRow label="Base Color" value={item.baseColorName} />',
  u'<DetailRow label={t("Base Colour", "Couleur de base")} value={item.baseColorName} />'),
 (u'<DetailRow label="Decoration Color" value={item.decorationColorName} />',
  u'<DetailRow label={t("Decoration Colour", "Couleur de décoration")} value={item.decorationColorName} />'),
 (u'label="Text on Cake"',
  u'label={t("Text on Cake", "Texte sur le gâteau")}'),
 (u'<DetailRow label="Extras" value={item.extrasNames.join(", ")} />',
  u'<DetailRow label={t("Extras", "Extras")} value={item.extrasNames.join(", ")} />'),
 (u'<DetailRow label="Ribbon Color" value={item.ribbonColorName} />',
  u'<DetailRow label={t("Ribbon Colour", "Couleur du ruban")} value={item.ribbonColorName} />'),
 (u'<DetailRow label="Butterfly Color" value={item.butterflyColorName} />',
  u'<DetailRow label={t("Butterfly Colour", "Couleur du papillon")} value={item.butterflyColorName} />'),
 (u'{candlesList && <DetailRow label="Candles" value={candlesList} />}',
  u'{candlesList && <DetailRow label={t("Candles", "Bougies")} value={candlesList} />}'),
 (u'<DetailRow label="Special Instructions" value={item.comment} />',
  u'<DetailRow label={t("Special Instructions", "Instructions particulières")} value={item.comment} />'),
 (u'>💳 Payment</h3>',
  u'>{t("💳 Payment", "💳 Paiement")}</h3>'),
 (u'<DetailRow label="Order №" value={order.order_number || order.id.slice(0, 8).toUpperCase()} />',
  u'<DetailRow label={t("Order №", "Commande n°")} value={order.order_number || order.id.slice(0, 8).toUpperCase()} />'),
 (u'<DetailRow label="Invoice №" value={order.invoice_number || "—"} />',
  u'<DetailRow label={t("Invoice №", "Facture n°")} value={order.invoice_number || "—"} />'),
 (u'<DetailRow label="Total" value={`CHF ${order.total_amount}`} />',
  u'<DetailRow label={t("Total", "Total")} value={`CHF ${order.total_amount}`} />'),
 (u'<DetailRow label="Status" value={\n              order.status === "pending" ? "⏳ Pending Approval (funds authorized)" :\n              order.status === "approved" ? "✅ Approved (payment captured)" :\n              "❌ Rejected (payment canceled)"\n            } />',
  u'<DetailRow label={t("Status", "Statut")} value={\n              order.status === "pending" ? t("⏳ Pending Approval (funds authorised)", "⏳ En attente d\'approbation (fonds autorisés)") :\n              order.status === "approved" ? t("✅ Approved (payment captured)", "✅ Approuvée (paiement capturé)") :\n              t("❌ Rejected (payment cancelled)", "❌ Refusée (paiement annulé)")\n            } />'),
 (u'<Label htmlFor="pin">Admin PIN</Label>',
  u'<Label htmlFor="pin">{t("Admin PIN", "Code PIN administrateur")}</Label>'),
 (u'placeholder="Enter your admin PIN"',
  u'placeholder={t("Enter your admin PIN", "Saisissez votre code PIN administrateur")}'),
 (u'                  Approve & Capture Payment\n',
  u'                  {t("Approve & Capture Payment", "Approuver et capturer le paiement")}\n'),
 (u'                  Reject & Cancel Payment\n',
  u'                  {t("Reject & Cancel Payment", "Refuser et annuler le paiement")}\n'),
 (u'{order.status === "approved" ? "✅ This order has been approved and payment captured." : "❌ This order has been rejected and payment canceled."}',
  u'{order.status === "approved" ? t("✅ This order has been approved and payment captured.", "✅ Cette commande a été approuvée et le paiement capturé.") : t("❌ This order has been rejected and payment cancelled.", "❌ Cette commande a été refusée et le paiement annulé.")}'),
]
for i, (o, n) in enumerate(A):
    s = rep(s, o, n, "AdminOrder#%d" % i)
write(P, s)
print("AdminOrder.tsx %d -> %d bytes" % (n0, len(s)))

# =========================================================== OrderAction.tsx
P = os.path.join(ROOT, "src/pages/OrderAction.tsx")
s = read(P); n0 = len(s)

s = rep(s,
    u'import { supabase } from "@/integrations/supabase/client";',
    u'import { supabase } from "@/integrations/supabase/client";\nimport { useLang } from "@/context/LanguageContext";',
    "oa-import")
s = rep(s,
    u'const OrderAction = () => {\n  const [searchParams] = useSearchParams();',
    u'const OrderAction = () => {\n  const { t } = useLang();\n  const [searchParams] = useSearchParams();',
    "oa-hook")

B = [
 (u'setMessage("Missing required parameters. Please use the link from the notification email.");',
  u'setMessage(t("Missing required parameters. Please use the link from the notification email.", "Paramètres requis manquants. Veuillez utiliser le lien reçu dans l\'e-mail de notification."));'),
 (u'setMessage("Invalid action. Must be \'approve\', \'reject\', or \'decline\'.");',
  u'setMessage(t("Invalid action. Must be \'approve\', \'reject\', or \'decline\'.", "Action invalide. Elle doit être « approve », « reject » ou « decline »."));'),
 (u'setMessage(error.message || "An error occurred.");',
  u'setMessage(error.message || t("An error occurred.", "Une erreur est survenue."));'),
 (u'? "Order declined. Payment has been refunded and the customer has been notified."\n            : "Order approved! Payment has been captured and a calendar event has been created."',
  u'? t("Order declined. Payment has been refunded and the customer has been notified.", "Commande refusée. Le paiement a été remboursé et le client a été informé.")\n            : t("Order approved! Payment has been captured and a calendar event has been created.", "Commande approuvée ! Le paiement a été capturé et un événement a été ajouté au calendrier.")'),
 (u'setMessage(err instanceof Error ? err.message : "Unknown error occurred.");',
  u'setMessage(err instanceof Error ? err.message : t("Unknown error occurred.", "Une erreur inconnue est survenue."));'),
 (u'{status === "loading" && "Processing..."}\n          {status === "success" && !isDecline && "Order Confirmed ✅"}\n          {status === "success" && isDecline && "Order Declined ❌"}\n          {status === "error" && "Action Failed"}',
  u'{status === "loading" && t("Processing...", "Traitement en cours...")}\n          {status === "success" && !isDecline && t("Order Confirmed ✅", "Commande confirmée ✅")}\n          {status === "success" && isDecline && t("Order Declined ❌", "Commande refusée ❌")}\n          {status === "error" && t("Action Failed", "Échec de l\'action")}'),
 (u'              Your order has been successfully placed and your payment has been processed.\n',
  u'              {t("Your order has been successfully placed and your payment has been processed.", "Votre commande a bien été enregistrée et votre paiement a été traité.")}\n'),
 (u'              We are now preparing your order.\n',
  u'              {t("We are now preparing your order.", "Nous préparons désormais votre commande.")}\n'),
 (u'              You may close this page.\n',
  u'              {t("You may close this page.", "Vous pouvez fermer cette page.")}\n'),
 (u'<p className="text-xs text-muted-foreground">You can close this page.</p>',
  u'<p className="text-xs text-muted-foreground">{t("You can close this page.", "Vous pouvez fermer cette page.")}</p>'),
 (u'<p className="text-xs text-muted-foreground">Bento Cake Studio · Order Management</p>',
  u'<p className="text-xs text-muted-foreground">Bento Cake Studio · {t("Order Management", "Gestion des commandes")}</p>'),
]
for i, (o, n) in enumerate(B):
    s = rep(s, o, n, "OrderAction#%d" % i)
write(P, s)
print("OrderAction.tsx %d -> %d bytes" % (n0, len(s)))
print("ALL DONE")
