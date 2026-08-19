import { useState, useEffect } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { CheckCircle, XCircle, Loader2, ShieldCheck, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { useLang } from "@/context/LanguageContext";

const DetailRow = ({ label, value }: { label: string; value?: string | null }) => {
  if (!value) return null;
  return (
    <div className="flex gap-2 text-sm">
      <span className="text-muted-foreground min-w-[140px]">{label}:</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
};

// Splits pickup_delivery_datetime into separate date/time display strings
const formatPickupDeliveryDate = (isoValue?: string | null) => {
  if (!isoValue) return isoValue;
  const d = new Date(isoValue);
  if (isNaN(d.getTime())) return isoValue;
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
};

const formatPickupDeliveryTime = (isoValue?: string | null) => {
  if (!isoValue) return isoValue;
  const d = new Date(isoValue);
  if (isNaN(d.getTime())) return isoValue;
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

const AdminOrder = () => {
  const { t } = useLang();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  const [order, setOrder] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [pin, setPin] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [result, setResult] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    const fetchOrder = async () => {
      if (!id) return;
      const { data: orderData, error: orderError } = await supabase
        .from("orders").select("*").eq("id", id).single();
      if (orderError) console.error("Error fetching order:", orderError);
      setOrder(orderData);

      const { data: itemsData, error: itemsError } = await supabase
        .from("order_items").select("*").eq("order_id", id).order("created_at", { ascending: true });
      if (itemsError) console.error("Error fetching order items:", itemsError);
      setItems(itemsData || []);

      setLoading(false);
    };
    fetchOrder();
  }, [id]);

  const handleAction = async (action: "approve" | "reject") => {
    if (!pin.trim()) {
      setResult({ type: "error", message: t("Please enter the admin PIN", "Veuillez saisir le code PIN administrateur") });
      return;
    }
    if (!token) {
      setResult({ type: "error", message: t("Missing action token. Please use the link from the notification email.", "Jeton d'action manquant. Veuillez utiliser le lien reçu dans l'e-mail de notification.") });
      return;
    }
    setActionLoading(action);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("manage-order", {
        body: { orderId: id, action, pin, token },
      });
      if (error) { setResult({ type: "error", message: error.message }); return; }
      if (data?.error) { setResult({ type: "error", message: data.error }); return; }
      setResult({
        type: "success",
        message: action === "approve"
          ? t("✅ Order approved! Payment has been captured.", "✅ Commande approuvée ! Le paiement a été capturé.")
          : t("❌ Order rejected. Payment has been canceled.", "❌ Commande refusée. Le paiement a été annulé."),
      });
      // manage-order's response field is still called "status" — it maps
      // 1:1 onto our order_validation values (pending/approved/rejected).
      setOrder({ ...order, order_validation: data.status });
    } catch (err) {
      setResult({ type: "error", message: err instanceof Error ? err.message : t("Unknown error", "Erreur inconnue") });
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <Layout>
        <main className="container mx-auto px-4 py-16 text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
        </main>
      </Layout>
    );
  }

  if (!order) {
    return (
      <Layout>
        <main className="container mx-auto px-4 py-16 text-center">
          <p className="text-muted-foreground">{t("Order not found.", "Commande introuvable.")}</p>
        </main>
      </Layout>
    );
  }

  const isResolved = order.order_validation !== "pending";

  return (
    <Layout>
      <main className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="bg-card rounded-lg shadow-md p-6 space-y-6">
          {/* Header */}
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-6 h-6 text-primary" />
            <h1 className="text-xl font-serif text-foreground">
              {order.order_number || `${t("Order", "Commande")} #${order.id.slice(0, 8).toUpperCase()}`}
            </h1>
            <span className={`ml-auto text-xs font-medium px-3 py-1 rounded-full ${
              order.order_validation === "pending" ? "bg-amber-100 text-amber-800" :
              order.order_validation === "approved" ? "bg-emerald-100 text-emerald-800" :
              "bg-red-100 text-red-800"
            }`}>
              {order.order_validation.toUpperCase()}
            </span>
          </div>

          {/* Missing token warning */}
          {!token && !isResolved && (
            <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-50 border border-amber-200">
              <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
              <div className="text-sm text-amber-800">
                <p className="font-medium">{t("Secure token missing", "Jeton sécurisé manquant")}</p>
                <p>{t("Please use the link from the notification email to manage this order. Direct access without a token is not permitted.", "Veuillez utiliser le lien reçu dans l'e-mail de notification pour gérer cette commande. L'accès direct sans jeton n'est pas autorisé.")}</p>
              </div>
            </div>
          )}

          {/* Customer Info */}
          <div className="bg-muted/30 rounded-lg p-4 space-y-1">
            <h3 className="font-medium text-foreground mb-2">{t("👤 Customer Information", "👤 Informations client")}</h3>
            <DetailRow label={t("Name", "Nom")} value={`${order.first_name} ${order.last_name}`} />
            <DetailRow label={t("Email", "E-mail")} value={order.email} />
            <DetailRow label={t("Phone", "Téléphone")} value={order.phone} />
          </div>

          {/* Pickup / Delivery */}
          <div className="bg-muted/30 rounded-lg p-4 space-y-1">
            <h3 className="font-medium text-foreground mb-2">{t("📦 Pickup / Delivery", "📦 Retrait / Livraison")}</h3>
            <DetailRow label={t("Date", "Date")} value={formatPickupDeliveryDate(order.pickup_delivery_datetime)} />
            <DetailRow label={t("Time", "Heure")} value={formatPickupDeliveryTime(order.pickup_delivery_datetime)} />
            <DetailRow label={t("Option", "Option")} value={order.delivery_method === "delivery" ? t("Delivery", "Livraison") : t("Pickup at store", "Retrait en boutique")} />
            {order.delivery_method === "delivery" && (
              <>
                <DetailRow label={t("Address", "Adresse")} value={order.delivery_address} />
                <DetailRow label={t("Zone", "Zone")} value={order.delivery_zone} />
              </>
            )}
            <DetailRow label={t("Order Notes", "Notes de commande")} value={order.order_comment} />
          </div>

          {/* Cake Items */}
          {items.length > 0 && (
            <div className="space-y-3">
              <h3 className="font-medium text-foreground">{t("🍰 Order Items", "🍰 Articles de la commande")} ({items.length})</h3>
              {items.map((item: any, i: number) => {
                const candlesList = (item.candles || [])
                  .filter((c: any) => c.quantity > 0)
                  .map((c: any) => `${c.name}${c.has_pack ? " (pack)" : ""} ×${c.quantity}`)
                  .join(", ");

                return (
                  <div key={item.id ?? i} className="rounded-lg border border-border p-4 space-y-1">
                    <div className="flex justify-between mb-2">
                      <span className="font-medium text-sm">{t("Cake", "Gâteau")} {i + 1}</span>
                      <span className="font-semibold text-sm text-primary">CHF {item.total}</span>
                    </div>
                    <DetailRow label={t("Size", "Taille")} value={item.size} />
                    <DetailRow label={t("Shape", "Forme")} value={item.shape} />
                    <DetailRow label={t("Flavour", "Parfum")} value={item.flavors?.join(", ")} />
                    <DetailRow label={t("Design / Style", "Design / Style")} value={item.design} />
                    <DetailRow label={t("Base Colour", "Couleur de base")} value={item.base_color} />
                    <DetailRow label={t("Decoration Colour", "Couleur de décoration")} value={item.decoration_color} />
                    {item.cake_text && (
                      <DetailRow
                        label={t("Text on Cake", "Texte sur le gâteau")}
                        value={`"${item.cake_text}" (${item.text_style || "normal"}, ${item.text_color || "default"})`}
                      />
                    )}
                    {item.extras?.length > 0 && (
                      <DetailRow label={t("Extras", "Extras")} value={item.extras.join(", ")} />
                    )}
                    <DetailRow label={t("Ribbon Colour", "Couleur du ruban")} value={item.ribbon_color} />
                    <DetailRow label={t("Butterfly Colour", "Couleur du papillon")} value={item.butterfly_color} />
                    {candlesList && <DetailRow label={t("Candles", "Bougies")} value={candlesList} />}
                    <DetailRow label={t("Special Instructions", "Instructions particulières")} value={item.item_comment} />
                  </div>
                );
              })}
            </div>
          )}

          {/* Payment Summary */}
          <div className="bg-amber-50 rounded-lg p-4 space-y-1">
            <h3 className="font-medium text-foreground mb-2">{t("💳 Payment", "💳 Paiement")}</h3>
             <DetailRow label={t("Order №", "Commande n°")} value={order.order_number || order.id.slice(0, 8).toUpperCase()} />
             <DetailRow label={t("Invoice №", "Facture n°")} value={order.invoice_number || "—"} />
            <DetailRow label={t("Total", "Total")} value={`CHF ${order.total_amount}`} />
            <DetailRow label={t("Status", "Statut")} value={
              order.order_validation === "pending" ? t("⏳ Pending Approval (funds authorised)", "⏳ En attente d'approbation (fonds autorisés)") :
              order.order_validation === "approved" ? t("✅ Approved (payment captured)", "✅ Approuvée (paiement capturé)") :
              t("❌ Rejected (payment cancelled)", "❌ Refusée (paiement annulé)")
            } />
          </div>

          {/* Admin Actions */}
          {!isResolved ? (
            <div className="border-t border-border pt-6 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="pin">{t("Admin PIN", "Code PIN administrateur")}</Label>
                <Input
                  id="pin"
                  type="password"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder={t("Enter your admin PIN", "Saisissez votre code PIN administrateur")}
                  className="max-w-xs"
                />
              </div>

              {result && (
                <div className={`p-3 rounded-lg text-sm ${
                  result.type === "success" ? "bg-emerald-50 text-emerald-800 border border-emerald-200" :
                  "bg-destructive/10 text-destructive border border-destructive/20"
                }`}>
                  {result.message}
                </div>
              )}

              <div className="flex gap-3">
                <Button onClick={() => handleAction("approve")} disabled={!!actionLoading || !token} className="flex-1">
                  {actionLoading === "approve" ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle className="w-4 h-4 mr-2" />}
                  {t("Approve & Capture Payment", "Approuver et capturer le paiement")}
                </Button>
                <Button variant="destructive" onClick={() => handleAction("reject")} disabled={!!actionLoading || !token} className="flex-1">
                  {actionLoading === "reject" ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <XCircle className="w-4 h-4 mr-2" />}
                  {t("Reject & Cancel Payment", "Refuser et annuler le paiement")}
                </Button>
              </div>
            </div>
          ) : (
            <div className={`p-4 rounded-lg text-center ${
              order.order_validation === "approved" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"
            }`}>
              <p className="font-medium">
                {order.order_validation === "approved" ? t("✅ This order has been approved and payment captured.", "✅ Cette commande a été approuvée et le paiement capturé.") : t("❌ This order has been rejected and payment cancelled.", "❌ Cette commande a été refusée et le paiement annulé.")}
              </p>
            </div>
          )}
        </div>
      </main>
    </Layout>
  );
};

export default AdminOrder;
