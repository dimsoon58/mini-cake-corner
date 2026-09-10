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

const formatDateFromIso = (dateValue?: string | null) => {
  if (!dateValue) return dateValue;
  const [year, month, day] = dateValue.split("-");
  return year && month && day ? `${day}.${month}.${year}` : dateValue;
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
      const { data, error } = await supabase
        .from("orders").select("*").eq("id", id).single();
      if (error) console.error("Error fetching order:", error);
      setOrder(data);

      const { data: itemsData, error: itemsError } = await supabase
        .from("order_items").select("*").eq("order_id", id).order("created_at", { ascending: true });
      if (itemsError) console.error("Error fetching order_items:", itemsError);
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
      const mixed = data?.fulfillmentType === "mixed";
      setResult({
        type: "success",
        message: action === "approve"
          ? (mixed
              ? t("✅ Cake part approved. The payment was already taken at checkout — nothing to capture.", "✅ Partie gâteau validée. Le paiement a déjà été encaissé au checkout — rien à capturer.")
              : t("✅ Order approved. The payment was already taken at checkout.", "✅ Commande validée. Le paiement a déjà été encaissé au checkout."))
          : (mixed
              ? t(`❌ Cake part refused. Refund CHF ${Number(data?.refundDueAmount || 0).toFixed(2)} BY HAND in PostFinance — the workshop stays confirmed.`, `❌ Partie gâteau refusée. Remboursez CHF ${Number(data?.refundDueAmount || 0).toFixed(2)} À LA MAIN dans PostFinance — l'atelier reste confirmé.`)
              : t(`❌ Order refused. Refund CHF ${Number(data?.refundDueAmount || 0).toFixed(2)} BY HAND in PostFinance.`, `❌ Commande refusée. Remboursez CHF ${Number(data?.refundDueAmount || 0).toFixed(2)} À LA MAIN dans PostFinance.`)),
      });
      setOrder({
        ...order,
        order_validation: data.status,
        physical_validation: data?.physicalValidation ?? order.physical_validation,
        refund_status: data?.refundStatus ?? order.refund_status,
        refund_due_amount: data?.refundDueAmount ?? order.refund_due_amount,
      });
    } catch (err) {
      setResult({ type: "error", message: err instanceof Error ? err.message : t("Unknown error", "Erreur inconnue") });
    } finally {
      setActionLoading(null);
    }
  };

  const handleMarkRefunded = async () => {
    if (!pin.trim()) {
      setResult({ type: "error", message: t("Please enter the admin PIN", "Veuillez saisir le code PIN administrateur") });
      return;
    }
    setActionLoading("mark_refunded");
    setResult(null);
    try {
      const ref = window.prompt(t("PostFinance refund reference (optional):", "Référence du remboursement PostFinance (facultatif) :")) || "";
      const { data, error } = await supabase.functions.invoke("manage-order", {
        body: { orderId: id, action: "mark_refunded", pin, refundReference: ref },
      });
      if (error) { setResult({ type: "error", message: error.message }); return; }
      if (data?.error) { setResult({ type: "error", message: data.error }); return; }
      setResult({ type: "success", message: t("✅ Marked as refunded.", "✅ Marqué comme remboursé.") });
      setOrder({ ...order, refund_status: "refunded" });
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

  const hasWorkshop = items.some((it: any) => it.product === "workshop");
  const hasPhysical = items.some((it: any) => it.product !== "workshop");
  const fulfillmentType: string = order.fulfillment_type ||
    (hasWorkshop ? (hasPhysical ? "mixed" : "workshop_only") : "cake_only");
  const isMixed = fulfillmentType === "mixed";
  const workshopConfirmed = !!order.workshop_confirmed_at;
  // Terminal / abnormal: a capacity abort persisted order_validation='cancelled'
  // + order_failure_reason. Handle it before any decision UI.
  const isCancelled = order.order_validation === "cancelled" || !!order.order_failure_reason;
  // The physical part is the only admin decision — physical_validation carries
  // it for every order with a physical part ('not_applicable' only for a
  // workshop-only order).
  const physicalState: string = order.physical_validation
    ?? (fulfillmentType === "workshop_only" ? "not_applicable" : "pending");
  // Decision UI shows only for: has a physical part, workshop part already
  // confirmed (mixed), not cancelled, still pending.
  const isResolved = isCancelled
    || fulfillmentType === "workshop_only"
    || physicalState !== "pending"
    || (isMixed && !workshopConfirmed);
  const refundToDo = order.refund_status === "to_refund";
  const customerName = `${order.first_name || ""} ${order.last_name || ""}`.trim();

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
              isCancelled ? "bg-red-100 text-red-800" :
              fulfillmentType === "workshop_only" ? (workshopConfirmed ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800") :
              physicalState === "approved" ? "bg-emerald-100 text-emerald-800" :
              physicalState === "pending" ? "bg-amber-100 text-amber-800" :
              "bg-red-100 text-red-800"
            }`}>
              {isCancelled ? "CANCELLED"
                : fulfillmentType === "workshop_only" ? (workshopConfirmed ? "WORKSHOP ✓" : "WORKSHOP …")
                : isMixed ? `${workshopConfirmed ? "WS ✓" : "WS …"} · ${String(physicalState).toUpperCase()}`
                : String(physicalState).toUpperCase()}
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
            <DetailRow label={t("Name", "Nom")} value={customerName} />
            <DetailRow label={t("Email", "E-mail")} value={order.email} />
            <DetailRow label={t("Phone", "Téléphone")} value={order.phone} />
          </div>

          {/* Pickup / Delivery — physical products only */}
          {order.delivery_method && (
          <div className="bg-muted/30 rounded-lg p-4 space-y-1">
            <h3 className="font-medium text-foreground mb-2">{t("📦 Pickup / Delivery", "📦 Retrait / Livraison")}</h3>
            <DetailRow label={t("Date", "Date")} value={formatDateFromIso(order.pickup_delivery_date)} />
            <DetailRow label={t("Time", "Heure")} value={order.pickup_delivery_slot} />
            <DetailRow label={t("Option", "Option")} value={order.delivery_method === "delivery" ? t("Delivery", "Livraison") : t("Pickup at store", "Retrait en boutique")} />
            {order.delivery_method === "delivery" && (
              <DetailRow label={t("Address", "Adresse")} value={order.delivery_address} />
            )}
            <DetailRow label={t("Delivery Notes", "Notes de livraison")} value={order.order_comment} />
          </div>
          )}

          {/* Cake Items */}
          {items.length > 0 && (
            <div className="space-y-3">
              <h3 className="font-medium text-foreground">{t("🍰 Order Items", "🍰 Articles de la commande")} ({items.length})</h3>
              {items.map((item: any, i: number) => {
                const candlesList = item.candle_name
                  ? `${item.candle_name}${item.candle_quantity ? ` ×${item.candle_quantity}` : ""}`
                  : "";

                if (item.product === "workshop") {
                  return (
                    <div key={item.id || i} className="rounded-lg border border-border p-4 space-y-1">
                      <div className="flex justify-between mb-2">
                        <span className="font-medium text-sm">
                          {item.workshop_type === "paint" ? t("Paint Workshop", "Atelier Peinture") : t("Signature Workshop", "Atelier Signature")}
                        </span>
                        <span className="font-semibold text-sm text-primary">CHF {item.total}</span>
                      </div>
                      <DetailRow label={t("Date", "Date")} value={formatDateFromIso(item.workshop_date)} />
                      <DetailRow label={t("Time", "Heure")} value={item.workshop_time} />
                      <DetailRow label={t("Participants", "Participants")} value={item.workshop_participants != null ? String(item.workshop_participants) : null} />
                      <DetailRow label={t("Unit price", "Prix unitaire")} value={item.workshop_unit_price != null ? `CHF ${item.workshop_unit_price}` : null} />
                      <DetailRow label={t("Notes", "Notes")} value={item.item_comment} />
                    </div>
                  );
                }

                return (
                  <div key={item.id || i} className="rounded-lg border border-border p-4 space-y-1">
                    <div className="flex justify-between mb-2">
                      <span className="font-medium text-sm">{t("Cake", "Gâteau")} {i + 1}</span>
                      <span className="font-semibold text-sm text-primary">CHF {item.total}</span>
                    </div>
                    <DetailRow label={t("Size", "Taille")} value={item.size} />
                    <DetailRow label={t("Shape", "Forme")} value={item.shape} />
                    <DetailRow label={t("Flavour", "Parfum")} value={(item.flavors || []).join(", ")} />
                    <DetailRow label={t("Design / Style", "Design / Style")} value={item.design} />
                    <DetailRow label={t("Base Colour", "Couleur de base")} value={item.base_color} />
                    <DetailRow label={t("Decoration Colour", "Couleur de décoration")} value={item.decoration_color} />
                    {item.cake_text && (
                      <DetailRow
                        label={t("Text on Cake", "Texte sur le gâteau")}
                        value={`"${item.cake_text}" (${item.text_style || "normal"}, ${item.text_color || "default"})`}
                      />
                    )}
                    {item.extra && (
                      <DetailRow label={t("Extras", "Extras")} value={item.extra} />
                    )}
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
            <DetailRow label={t("Payment", "Paiement")} value={
              order.payment_status === "paid"
                ? t("✅ Taken at checkout", "✅ Encaissé au checkout")
                : order.payment_status
            } />
            {isMixed && (
              <DetailRow label={t("Workshop", "Atelier")} value={
                order.workshop_confirmed_at ? t("✅ Confirmed & paid", "✅ Confirmé & payé") : t("⏳ Confirming…", "⏳ En cours de confirmation…")
              } />
            )}
            <DetailRow label={isMixed ? t("Cake part", "Partie gâteau") : t("Status", "Statut")} value={
              physicalState === "pending" ? t("⏳ Pending your decision", "⏳ En attente de votre décision") :
              physicalState === "approved" ? t("✅ Approved", "✅ Validée") :
              physicalState === "rejected" ? t("❌ Refused", "❌ Refusée") :
              physicalState
            } />
          </div>

          {refundToDo && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 space-y-3">
              <p className="font-medium text-red-800">
                {t(
                  `⚠️ Manual refund to do: CHF ${Number(order.refund_due_amount || 0).toFixed(2)} in PostFinance`,
                  `⚠️ Remboursement manuel à faire : CHF ${Number(order.refund_due_amount || 0).toFixed(2)} dans PostFinance`,
                )}
              </p>
              <p className="text-sm text-red-700">
                {isMixed
                  ? t("Refund only this amount (the cake part). The workshop stays paid & confirmed — do NOT cancel the seats.", "Ne remboursez que ce montant (la partie gâteau). L'atelier reste payé & confirmé — n'annulez PAS les places.")
                  : t("Refund the full amount in the PostFinance back office, then mark it done below.", "Remboursez le montant total dans le back-office PostFinance, puis marquez-le comme fait ci-dessous.")}
              </p>
              <div className="space-y-2">
                <Label htmlFor="pin-refund" className="text-red-800">{t("Admin PIN", "Code PIN administrateur")}</Label>
                <Input id="pin-refund" type="password" value={pin} onChange={(e) => setPin(e.target.value)} className="max-w-xs" />
              </div>
              <Button variant="destructive" onClick={handleMarkRefunded} disabled={!!actionLoading}>
                {actionLoading === "mark_refunded" ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                {t("I have refunded it — mark as done", "Je l'ai remboursé — marquer comme fait")}
              </Button>
            </div>
          )}
          {order.refund_status === "refunded" && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-800">
              {t("✅ Manual refund recorded.", "✅ Remboursement manuel enregistré.")}
              {order.refund_reference ? ` (${order.refund_reference})` : ""}
            </div>
          )}

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

              {isMixed && (
                <p className="text-sm text-muted-foreground">
                  {t(
                    "The payment is already taken and the workshop is confirmed. Your decision only concerns the cake / products part. Refusing does NOT refund automatically — you refund by hand in PostFinance.",
                    "Le paiement est déjà encaissé et l'atelier confirmé. Votre décision ne concerne que la partie gâteau / produits. Refuser ne rembourse PAS automatiquement — vous remboursez à la main dans PostFinance.",
                  )}
                </p>
              )}
              <div className="flex gap-3">
                <Button onClick={() => handleAction("approve")} disabled={!!actionLoading || !token} className="flex-1">
                  {actionLoading === "approve" ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle className="w-4 h-4 mr-2" />}
                  {isMixed ? t("Approve cake part", "Valider le gâteau") : t("Approve order", "Valider la commande")}
                </Button>
                <Button variant="destructive" onClick={() => handleAction("reject")} disabled={!!actionLoading || !token} className="flex-1">
                  {actionLoading === "reject" ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <XCircle className="w-4 h-4 mr-2" />}
                  {isMixed ? t("Refuse cake part", "Refuser le gâteau") : t("Refuse order", "Refuser la commande")}
                </Button>
              </div>
            </div>
          ) : isCancelled ? (
            <div className="p-4 rounded-lg text-center bg-red-50 text-red-800">
              <p className="font-medium">
                {order.order_failure_reason === "workshop_capacity_unavailable"
                  ? t("⚠️ Workshop sold out after payment — the whole order was cancelled. The payment was taken; refund it by hand.", "⚠️ Atelier complet après paiement — toute la commande a été annulée. Le paiement a été encaissé ; à rembourser à la main.")
                  : t("⚠️ This order was cancelled. If a payment was taken, refund it by hand.", "⚠️ Cette commande a été annulée. Si un paiement a été encaissé, à rembourser à la main.")}
              </p>
            </div>
          ) : isMixed && !workshopConfirmed ? (
            <div className="p-4 rounded-lg text-center bg-amber-50 text-amber-800">
              <p className="font-medium">{t("⏳ The workshop part is still confirming — reload in a moment to decide the cake part.", "⏳ La partie atelier est en cours de confirmation — rechargez dans un instant pour décider de la partie gâteau.")}</p>
            </div>
          ) : (
            <div className={`p-4 rounded-lg text-center ${
              physicalState === "approved" || fulfillmentType === "workshop_only" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"
            }`}>
              <p className="font-medium">
                {fulfillmentType === "workshop_only"
                  ? t("✅ Workshop order — auto-confirmed, no decision needed.", "✅ Commande atelier — confirmée automatiquement, aucune décision requise.")
                  : physicalState === "approved"
                    ? (isMixed ? t("✅ Cake part approved. Workshop confirmed.", "✅ Partie gâteau validée. Atelier confirmé.") : t("✅ This order has been approved.", "✅ Cette commande a été validée."))
                    : (isMixed ? t("❌ Cake part refused. Workshop stays confirmed.", "❌ Partie gâteau refusée. L'atelier reste confirmé.") : t("❌ This order has been refused.", "❌ Cette commande a été refusée."))}
              </p>
            </div>
          )}
        </div>
      </main>
    </Layout>
  );
};

export default AdminOrder;
