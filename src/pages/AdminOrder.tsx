import { useState, useEffect } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { CheckCircle, XCircle, Loader2, ShieldCheck, AlertTriangle, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { isAdminEmail } from "@/lib/adminAccess";
import { extractFunctionErrorMessage } from "@/lib/functionErrors";
import { PRODUCT_LABELS, sizeLabel, shapeLabel, designLabel, splitComment } from "@/lib/orderLabels";

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
  const { user, loading: authLoading } = useAuth();
  const isAdmin = isAdminEmail(user?.email);

  const [order, setOrder] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [fulfillments, setFulfillments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Filled from get-order-detail's response when the URL had no token (the
  // /admin/orders dashboard flow) — see the comment on `actionToken` in
  // get-order-detail/index.ts. Falls back to the URL token when present so
  // an e-mail-link visit always uses exactly the token it arrived with.
  const [fetchedToken, setFetchedToken] = useState<string | null>(null);
  const effectiveToken = token || fetchedToken;
  const [pin, setPin] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [result, setResult] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Fetches through get-order-detail (service_role, gated by the SAME
  // order_action_tokens row the Accept/Refuse links use) instead of reading
  // `orders`/`order_items` directly from the browser. A direct client-side
  // read is subject to RLS — orders is scoped to the signed-in customer's
  // own rows, and the admin opening this link is never signed in as that
  // customer, so the query always returned zero rows (no error, just
  // empty), which is exactly why this page used to show "Order not found"
  // even for a perfectly valid id/token. Accept/Refuse never hit this,
  // because they live on a separate page (OrderAction.tsx) that only calls
  // manage-order (also service_role) and never reads `orders` client-side.
  // get-order-detail deliberately ignores order_action_tokens.used — this
  // view must stay available after Accept/Refuse has consumed the token,
  // exactly like manage-order's own tolerant re-check of a used token.
  useEffect(() => {
    // Wait for auth to resolve, and never even attempt the lookup for a
    // non-admin — the real enforcement is server-side (get-order-detail now
    // requires a verified admin session), this just avoids a doomed request.
    if (authLoading || !isAdmin) { setLoading(authLoading); return; }
    const fetchOrder = async () => {
      if (!id) { setLoading(false); return; }
      // A token is no longer required to load — a verified admin session
      // (already established above) is enough on its own (the new /admin/
      // orders dashboard opens this page with no token at all). When present
      // (the notification e-mail's own link), it's still sent and validated
      // server-side as an extra layer.
      const { data, error } = await supabase.functions.invoke("get-order-detail", {
        body: { orderId: id, token },
      });
      if (error) {
        const reason = await extractFunctionErrorMessage(error, "");
        console.error("get-order-detail invocation failed:", reason || error);
        setLoadError(
          reason === "Admin sign-in required"
            ? t("Your admin session could not be verified. Please sign out and sign in again.", "Votre session administrateur n'a pas pu être vérifiée. Merci de vous déconnecter puis de vous reconnecter.")
            : t("Could not load this order. Please try the link again.", "Impossible de charger cette commande. Merci de réessayer le lien.")
        );
      } else if (data?.error) {
        console.error("get-order-detail error:", data.error);
        setLoadError(
          data.error === "This link has expired"
            ? t("This link has expired. Please ask for the order to be looked up directly.", "Ce lien a expiré. Merci de demander à consulter la commande directement.")
            : data.error === "Invalid or unknown action token"
              ? t("This link is not valid for this order.", "Ce lien n'est pas valide pour cette commande.")
              : t("Order not found.", "Commande introuvable.")
        );
      } else {
        setOrder(data.order);
        setItems(data.items || []);
        setFulfillments(data.fulfillments || []);
        if (data.actionToken) setFetchedToken(data.actionToken);
      }
      setLoading(false);
    };
    fetchOrder();
  }, [id, token, t, authLoading, isAdmin]);

  const handleAction = async (action: "approve" | "reject") => {
    if (!pin.trim()) {
      setResult({ type: "error", message: t("Please enter the admin PIN", "Veuillez saisir le code PIN administrateur") });
      return;
    }
    if (!effectiveToken) {
      setResult({ type: "error", message: t("No action token available for this order yet. Please reload the page.", "Aucun jeton d'action disponible pour cette commande pour le moment. Merci de recharger la page.") });
      return;
    }
    setActionLoading(action);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("manage-order", {
        body: { orderId: id, action, pin, token: effectiveToken },
      });
      if (error) {
        const message = await extractFunctionErrorMessage(error, t("Unknown error", "Erreur inconnue"));
        setResult({ type: "error", message });
        return;
      }
      if (data?.error) { setResult({ type: "error", message: data.error }); return; }
      const mixed = data?.fulfillmentType === "mixed";
      // 2026-09-15 (deferred capture restored): Approve now really captures
      // the authorized PostFinance transaction here (manage-order); Refuse
      // voids it — nothing was ever charged, so nothing is ever refunded on
      // a normal Refuse any more. Accept/Refuse is one whole-order decision
      // now (Option A) — a mixed order's workshop is captured/confirmed on
      // Accept and released together with the cake part on Refuse, never
      // independently.
      setResult({
        type: "success",
        message: action === "approve"
          ? (mixed
              ? t("✅ Order approved. Payment captured — cake and workshop are both confirmed.", "✅ Commande validée. Paiement encaissé — gâteau et atelier sont tous deux confirmés.")
              : t("✅ Order approved. Payment captured.", "✅ Commande validée. Paiement encaissé."))
          : t("❌ Order refused. The authorization was voided — nothing was charged, no refund needed.", "❌ Commande refusée. L'autorisation a été annulée — aucun montant prélevé, aucun remboursement nécessaire."),
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
      if (error) {
        const message = await extractFunctionErrorMessage(error, t("Unknown error", "Erreur inconnue"));
        setResult({ type: "error", message });
        return;
      }
      if (data?.error) { setResult({ type: "error", message: data.error }); return; }
      setResult({ type: "success", message: t("✅ Marked as refunded.", "✅ Marqué comme remboursé.") });
      setOrder({ ...order, refund_status: "refunded" });
    } catch (err) {
      setResult({ type: "error", message: err instanceof Error ? err.message : t("Unknown error", "Erreur inconnue") });
    } finally {
      setActionLoading(null);
    }
  };

  // Real auth guard (2026-09-17): the order-detail lookup itself now
  // requires a verified admin session server-side (get-order-detail) — this
  // is the matching frontend gate, so a signed-out visitor or a non-admin
  // account never even sees the order fetch attempted, just a clear sign-in
  // prompt or an access-denied message.
  if (authLoading) {
    return (
      <Layout>
        <main className="container mx-auto px-4 py-16 text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
        </main>
      </Layout>
    );
  }

  if (!user) {
    return (
      <Layout>
        <main className="max-w-md mx-auto px-6 py-24 text-center">
          <Lock className="w-8 h-8 mx-auto text-muted-foreground mb-4" />
          <h1 className="font-sans uppercase tracking-[0.105em] text-2xl text-foreground mb-4">
            {t("Admin sign-in required", "Connexion administrateur requise")}
          </h1>
          <p className="text-sm text-foreground/75 leading-relaxed mb-6">
            {t(
              "This page is restricted to Bento Cake Studio administrators. Please sign in to continue.",
              "Cette page est réservée aux administrateurs de Bento Cake Studio. Merci de vous connecter pour continuer."
            )}
          </p>
          <Button
            asChild
            className="rounded-none bg-primary hover:bg-primary/90 text-primary-foreground uppercase tracking-[0.105em] text-[13px] font-medium"
          >
            <Link to={`/login?redirect=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`}>
              {t("Sign in", "Se connecter")}
            </Link>
          </Button>
        </main>
      </Layout>
    );
  }

  if (!isAdmin) {
    return (
      <Layout>
        <main className="max-w-md mx-auto px-6 py-24 text-center">
          <Lock className="w-8 h-8 mx-auto text-muted-foreground mb-4" />
          <h1 className="font-sans uppercase tracking-[0.105em] text-2xl text-foreground mb-4">
            {t("Access denied", "Accès refusé")}
          </h1>
          <p className="text-sm text-foreground/75 leading-relaxed">
            {t(
              "Your account does not have access to this page.",
              "Votre compte n'a pas accès à cette page."
            )}
          </p>
        </main>
      </Layout>
    );
  }

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
          <p className="text-muted-foreground">
            {loadError || t("Order not found.", "Commande introuvable.")}
          </p>
        </main>
      </Layout>
    );
  }

  const hasWorkshop = items.some((it: any) => it.product === "workshop");
  const hasPhysical = items.some((it: any) => it.product !== "workshop");
  const fulfillmentType: string = order.fulfillment_type ||
    (hasWorkshop ? (hasPhysical ? "mixed" : "workshop_only") : "cake_only");
  const isMixed = fulfillmentType === "mixed";
  const isWorkshopOnly = fulfillmentType === "workshop_only";
  // Terminal / abnormal: a capacity abort persisted order_validation='cancelled'
  // + order_failure_reason. Handle it before any decision UI.
  const isCancelled = order.order_validation === "cancelled" || !!order.order_failure_reason;
  // 2026-09-15 (deferred capture restored): every fulfilment type now goes
  // through the SAME Accept/Refuse admin decision, workshop_only included —
  // physical_validation carries it for cake_only/mixed ('not_applicable'
  // only for workshop_only, which never changes); workshop_only's own
  // decision lives on order_validation directly instead (mirrors
  // decide_order_physical / manage-order/index.ts exactly).
  const decisionState: string = isWorkshopOnly
    ? (order.order_validation ?? "pending")
    : (order.physical_validation ?? "pending");
  // Decision UI shows for any order that is not cancelled and still pending
  // — no more "workshop_only is auto-confirmed" exception, no more waiting
  // for an independent workshop confirmation before a mixed order can be
  // decided (Accept/Refuse decides everything together now).
  const isResolved = isCancelled || decisionState !== "pending";
  const refundToDo = order.refund_status === "to_refund";
  const customerName = `${order.first_name || ""} ${order.last_name || ""}`.trim();
  // Multi-date fulfillment: order_fulfillments has one row per distinct
  // pickup/delivery date (get-order-detail now returns it, service_role,
  // no RLS concern). ≤1 row is today's ordinary case — same single block
  // as before. 2+ rows means this order genuinely spans multiple dates, so
  // the single "Pickup / Delivery" block is replaced by one per date.
  const isMultiDate = fulfillments.length > 1;
  const fulfillmentById = (fulfillmentId: string | null | undefined) =>
    fulfillmentId ? fulfillments.find((f) => f.id === fulfillmentId) : null;

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
              decisionState === "approved" ? "bg-emerald-100 text-emerald-800" :
              decisionState === "pending" ? "bg-amber-100 text-amber-800" :
              "bg-red-100 text-red-800"
            }`}>
              {isCancelled ? "CANCELLED"
                : isWorkshopOnly ? `WORKSHOP · ${String(decisionState).toUpperCase()}`
                : isMixed ? `WS+CAKE · ${String(decisionState).toUpperCase()}`
                : String(decisionState).toUpperCase()}
            </span>
          </div>

          {/* Missing token warning — rare: only when this order genuinely has
              no order_action_tokens row at all (neither the URL nor
              get-order-detail's own lookup found one), so Accept/Refuse has
              nothing to authorise itself with. Viewing is unaffected. */}
          {!effectiveToken && !isResolved && (
            <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-50 border border-amber-200">
              <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
              <div className="text-sm text-amber-800">
                <p className="font-medium">{t("No action token for this order", "Aucun jeton d'action pour cette commande")}</p>
                <p>{t("This order has no available action token, so it cannot be accepted or refused from here.", "Cette commande n'a aucun jeton d'action disponible, elle ne peut donc pas être acceptée ou refusée depuis cette page.")}</p>
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
          {isMultiDate ? (
            <div className="space-y-3">
              {fulfillments.map((f, idx) => (
                <div key={f.id} className="bg-muted/30 rounded-lg p-4 space-y-1">
                  <h3 className="font-medium text-foreground mb-2">
                    {t("📦 Pickup / Delivery", "📦 Retrait / Livraison")} — {t("date", "date")} {idx + 1}
                  </h3>
                  <DetailRow label={t("Date", "Date")} value={formatDateFromIso(f.pickup_delivery_date)} />
                  <DetailRow label={t("Time", "Heure")} value={f.pickup_delivery_slot} />
                  <DetailRow label={t("Option", "Option")} value={f.delivery_method === "delivery" ? t("Delivery", "Livraison") : t("Pickup at store", "Retrait en boutique")} />
                  {f.delivery_method === "delivery" && (
                    <DetailRow label={t("Address", "Adresse")} value={f.delivery_address} />
                  )}
                </div>
              ))}
              {order.order_comment && (
                <div className="bg-muted/30 rounded-lg p-4 space-y-1">
                  <DetailRow label={t("Delivery Notes", "Notes de livraison")} value={order.order_comment} />
                </div>
              )}
            </div>
          ) : order.delivery_method && (
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

                // Readable labels only — never the raw stored id when a real
                // catalogue name exists for it (same resolution MyOrders.tsx
                // uses for the customer-facing order history: sizeLabel/
                // shapeLabel/designLabel against @/data/customization, with
                // the [Preferred design: Option N] tag split out of the
                // comment and folded into the Design line instead).
                const productLabel = t(PRODUCT_LABELS[item.product]?.en, PRODUCT_LABELS[item.product]?.fr) || item.product;
                const { designPhoto, comment } = splitComment(item.item_comment);
                const referenceImage: string | null = item.design_image_url || (item.reference_images?.[0] ?? null);

                return (
                  <div key={item.id || i} className="rounded-lg border border-border p-4 space-y-1">
                    <div className="flex justify-between mb-2">
                      <span className="font-medium text-sm">{productLabel} {i + 1}</span>
                      <span className="font-semibold text-sm text-primary">CHF {item.total}</span>
                    </div>
                    {isMultiDate && (
                      <DetailRow label={t("Date", "Date")} value={formatDateFromIso(fulfillmentById(item.fulfillment_id)?.pickup_delivery_date)} />
                    )}
                    {item.size && <DetailRow label={t("Size", "Taille")} value={sizeLabel(item.size)} />}
                    {item.shape && <DetailRow label={t("Shape", "Forme")} value={shapeLabel(item.shape)} />}
                    <DetailRow label={t("Flavour", "Parfum")} value={(item.flavors || []).join(", ")} />
                    {item.design && (
                      <DetailRow
                        label={t("Design / Style", "Design / Style")}
                        value={`${designLabel(item.design)}${designPhoto ? ` — ${t("Photo", "Photo")} ${designPhoto}` : ""}`}
                      />
                    )}
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
                    {referenceImage && (
                      <div className="flex gap-2 text-sm">
                        <span className="text-muted-foreground min-w-[140px]">{t("Reference image", "Image de référence")}:</span>
                        <a href={referenceImage} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                          {t("View image", "Voir l'image")} →
                        </a>
                      </div>
                    )}
                    <DetailRow label={t("Special Instructions", "Instructions particulières")} value={comment} />
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
                ? t("✅ Captured", "✅ Encaissé")
                : order.payment_status === "cancelled"
                  ? t("Authorization voided — nothing charged", "Autorisation annulée — rien prélevé")
                  : t("⏳ Authorized, not yet captured", "⏳ Autorisé, pas encore encaissé")
            } />
            <DetailRow label={t("Status", "Statut")} value={
              decisionState === "pending" ? t("⏳ Pending your decision", "⏳ En attente de votre décision") :
              decisionState === "approved" ? t("✅ Approved", "✅ Validée") :
              decisionState === "rejected" ? t("❌ Refused", "❌ Refusée") :
              decisionState
            } />
          </div>

          {/* refundToDo / mark_refunded below only ever applies to the rare
              defensive case where a transaction was somehow already captured
              before a Refuse reached it — see manage-order/index.ts. Under
              the normal flow (Refuse before any capture), nothing is ever
              flagged here any more. */}
          {refundToDo && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 space-y-3">
              <p className="font-medium text-red-800">
                {t(
                  `⚠️ Manual refund to do: CHF ${Number(order.refund_due_amount || 0).toFixed(2)} in PostFinance`,
                  `⚠️ Remboursement manuel à faire : CHF ${Number(order.refund_due_amount || 0).toFixed(2)} dans PostFinance`,
                )}
              </p>
              <p className="text-sm text-red-700">
                {t(
                  "This order's payment was unexpectedly already captured before it was refused. Refund the full amount in the PostFinance back office, then mark it done below.",
                  "Le paiement de cette commande avait été encaissé de façon inattendue avant son refus. Remboursez le montant total dans le back-office PostFinance, puis marquez-le comme fait ci-dessous.",
                )}
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

              <p className="text-sm text-muted-foreground">
                {t(
                  "The payment is only authorized, not yet captured. Approve captures it and confirms the order (cake and workshop together, if both are present). Refuse voids the authorization instead — nothing is charged, and any workshop seat is released immediately.",
                  "Le paiement n'est qu'autorisé, pas encore encaissé. Valider encaisse le paiement et confirme la commande (gâteau et atelier ensemble, le cas échéant). Refuser annule l'autorisation à la place — rien n'est prélevé, et toute place d'atelier est libérée immédiatement.",
                )}
              </p>
              <div className="flex gap-3">
                <Button onClick={() => handleAction("approve")} disabled={!!actionLoading || !effectiveToken} className="flex-1">
                  {actionLoading === "approve" ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle className="w-4 h-4 mr-2" />}
                  {t("Approve order", "Valider la commande")}
                </Button>
                <Button variant="destructive" onClick={() => handleAction("reject")} disabled={!!actionLoading || !effectiveToken} className="flex-1">
                  {actionLoading === "reject" ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <XCircle className="w-4 h-4 mr-2" />}
                  {t("Refuse order", "Refuser la commande")}
                </Button>
              </div>
            </div>
          ) : isCancelled ? (
            <div className="p-4 rounded-lg text-center bg-red-50 text-red-800">
              <p className="font-medium">
                {order.order_failure_reason === "workshop_capacity_unavailable"
                  ? t("⚠️ Workshop sold out after authorization — the whole order was cancelled and the authorization voided. If it was somehow already captured, refund it by hand.", "⚠️ Atelier complet après autorisation — toute la commande a été annulée et l'autorisation annulée. Si le paiement a malgré tout été encaissé, à rembourser à la main.")
                  : t("⚠️ This order was cancelled. If a payment was somehow already captured, refund it by hand.", "⚠️ Cette commande a été annulée. Si un paiement a malgré tout été encaissé, à rembourser à la main.")}
              </p>
            </div>
          ) : (
            <div className={`p-4 rounded-lg text-center ${
              decisionState === "approved" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"
            }`}>
              <p className="font-medium">
                {decisionState === "approved"
                  ? t("✅ This order has been approved and the payment captured.", "✅ Cette commande a été validée et le paiement encaissé.")
                  : t("❌ This order has been refused. The authorization was voided — nothing was charged.", "❌ Cette commande a été refusée. L'autorisation a été annulée — rien n'a été prélevé.")}
              </p>
            </div>
          )}
        </div>
      </main>
    </Layout>
  );
};

export default AdminOrder;
