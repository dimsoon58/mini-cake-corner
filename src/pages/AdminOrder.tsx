import { useState, useEffect } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { CheckCircle, XCircle, Loader2, AlertTriangle, Lock, User, Package, Cake, CreditCard, ArrowLeft, Printer, Copy } from "lucide-react";
import { paymentRefs } from "@/lib/paymentRefs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/admin/AdminLayout";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { isAdminEmail } from "@/lib/adminAccess";
import { useStaffRole } from "@/lib/staff";
import { extractFunctionErrorMessage } from "@/lib/functionErrors";
import { PRODUCT_LABELS, sizeLabel, shapeLabel, designLabel, splitComment } from "@/lib/orderLabels";
import { itemDisplayImage } from "@/lib/itemDisplayImage";
import { ManualOrderPanel } from "@/components/admin/manual-order/ManualOrderPanel";
import { ReferencePhotos } from "@/components/ReferencePhotos";
import { ProductionCheck } from "@/components/admin/ProductionCheck";
import { OrderRefundsPanel } from "@/components/admin/refunds/OrderRefundsPanel";
import { OrderCancellationPanel, type WorkshopReservation } from "@/components/admin/OrderCancellationPanel";
import { MANUAL_STATUS_LABELS, manualStatusOf } from "@/lib/manualOrders";
import { useSessionPin } from "@/lib/adminSession";
import { PasswordInput } from "@/components/ui/password-input";

// pending/approved/rejected/cancelled -> the French/English label actually
// shown for the header decision badge. Same lookup as AdminOrders.tsx's own
// copy (kept separate — see that file's comment on why decision-state logic
// itself is duplicated rather than shared).
const DECISION_STATE_LABEL: Record<string, [string, string]> = {
  pending: ["PENDING", "EN ATTENTE"],
  approved: ["APPROVED", "ACCEPTÉE"],
  rejected: ["REJECTED", "REFUSÉE"],
  cancelled: ["CANCELLED", "ANNULÉE"],
};
const decisionStateLabel = (state: string, t: (en: string, fr: string) => string): string => {
  const pair = DECISION_STATE_LABEL[state];
  return pair ? t(pair[0], pair[1]) : state.toUpperCase();
};

// Référence copiable (un clic sur le bouton la copie ; le texte se sélectionne aussi d'un clic).
const CopyRow = ({ label, value, copyLabel, testId }: { label: string; value: string; copyLabel: string; testId: string }) => (
  <div className="flex gap-2 text-sm items-center" data-testid={testId}>
    <span className="text-muted-foreground min-w-[96px] sm:min-w-[140px] shrink-0">{label}:</span>
    <span className="text-foreground font-mono select-all break-all">{value}</span>
    <button type="button" aria-label={copyLabel} title={copyLabel} className="text-muted-foreground hover:text-foreground shrink-0"
      onClick={() => { navigator.clipboard?.writeText(value).catch(() => { /* copie refusée : le texte reste sélectionnable */ }); }}>
      <Copy className="w-3.5 h-3.5" />
    </button>
  </div>
);

const DetailRow = ({ label, value }: { label: string; value?: string | null }) => {
  if (!value) return null;
  return (
    <div className="flex gap-2 text-sm">
      <span className="text-muted-foreground min-w-[96px] sm:min-w-[140px] shrink-0">{label}:</span>
      <span className="text-foreground min-w-0 break-words">{value}</span>
    </div>
  );
};

const formatDateFromIso = (dateValue?: string | null) => {
  if (!dateValue) return dateValue;
  const [year, month, day] = dateValue.split("-");
  return year && month && day ? `${day}.${month}.${year}` : dateValue;
};


const AdminOrder = () => {
  const { t, lang } = useLang();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const { user, loading: authLoading } = useAuth();
  // F23 : l'employée consulte en lecture seule, sans aucun montant (le serveur ne les envoie pas).
  const staff = useStaffRole();
  const employee = staff.isEmployee;
  const isAdmin = isAdminEmail(user?.email) || staff.can("orders.view");

  const [order, setOrder] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [fulfillments, setFulfillments] = useState<any[]>([]);
  const [reservations, setReservations] = useState<WorkshopReservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Filled from get-order-detail's response when the URL had no token (the
  // /admin/orders dashboard flow) — see the comment on `actionToken` in
  // get-order-detail/index.ts. Falls back to the URL token when present so
  // an e-mail-link visit always uses exactly the token it arrived with.
  const [fetchedToken, setFetchedToken] = useState<string | null>(null);
  const effectiveToken = token || fetchedToken;
  // Signed download URL for order.invoice_path, minted server-side by
  // get-order-detail (service_role — see its own comment on why the
  // customer-facing MyOrders.tsx client-side createSignedUrl pattern can't
  // be reused for an admin). Stays null when invoice_path isn't set yet,
  // even if invoice_number already is — used below to show "facture
  // manquante" instead of a broken link.
  const [invoiceUrl, setInvoiceUrl] = useState<string | null>(null);
  // Diagnostic only (2026-09-20) — the exact createSignedUrl error when
  // invoice_path is set but minting the link still failed, so the reason is
  // visible on this page instead of only in Edge Function logs. Null in
  // every other case (invoiceUrl present, or invoice_path never set at all).
  const [invoiceUrlError, setInvoiceUrlError] = useState<string | null>(null);
  const [pin, setPin, pinBySession] = useSessionPin();
  // Bumped after a manual-order action (mark as paid, send confirmation) to reload the order.
  const [reloadKey, setReloadKey] = useState(0);
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
    if (authLoading || staff.loading || !isAdmin) { setLoading(authLoading || staff.loading); return; }
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
        // F28 : génoises choisies par participant, pour l'annulation de places.
        setReservations((data.workshopReservations || []).map((r: WorkshopReservation) => ({
          ...r, spongeChoices: (data.items || []).find((i: { id: string }) => i.id === r.order_item_id)?.workshop_sponge_choices ?? null,
        })));
        if (data.actionToken) setFetchedToken(data.actionToken);
        setInvoiceUrl(data.invoiceUrl ?? null);
        setInvoiceUrlError(data.invoiceUrlError ?? null);
      }
      setLoading(false);
    };
    fetchOrder();
  }, [id, token, t, authLoading, isAdmin, reloadKey, staff.loading]);

  const handleAction = async (action: "approve" | "reject") => {
    if (!pin.trim()) {
      setResult({ type: "error", message: t("Please enter the admin PIN", "Veuillez saisir le code PIN administrateur") });
      return;
    }
    // PIN de session (F16) : confirmation simple à la place de la ressaisie.
    if (pinBySession && !window.confirm(action === "approve"
      ? t("Accept this order? The payment will be captured.", "Accepter cette commande ? Le paiement sera encaissé.")
      : t("Refuse this order? The payment will be released or refunded.", "Refuser cette commande ? Le paiement sera libéré ou remboursé."))) return;
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
              ? t("Order approved. Payment captured — cake and workshop are both confirmed.", "Commande validée. Paiement encaissé — gâteau et workshop sont tous deux confirmés.")
              : t("Order approved. Payment captured.", "Commande validée. Paiement encaissé."))
          : t("Order refused. The authorization was voided — nothing was charged, no refund needed.", "Commande refusée. L'autorisation a été annulée — aucun montant prélevé, aucun remboursement nécessaire."),
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

  // Real auth guard (2026-09-17): the order-detail lookup itself now
  // requires a verified admin session server-side (get-order-detail) — this
  // is the matching frontend gate, so a signed-out visitor or a non-admin
  // account never even sees the order fetch attempted, just a clear sign-in
  // prompt or an access-denied message.
  if (authLoading || staff.loading) {
    return (
      <AdminLayout>
        <main className="container mx-auto px-4 py-16 text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
        </main>
      </AdminLayout>
    );
  }

  if (!user) {
    return (
      <AdminLayout>
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
      </AdminLayout>
    );
  }

  if (!isAdmin) {
    return (
      <AdminLayout>
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
      </AdminLayout>
    );
  }

  if (loading) {
    return (
      <AdminLayout>
        <main className="container mx-auto px-4 py-16 text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
        </main>
      </AdminLayout>
    );
  }

  if (!order) {
    return (
      <AdminLayout>
        <main className="container mx-auto px-4 py-16 text-center">
          <p className="text-muted-foreground">
            {loadError || t("Order not found.", "Commande introuvable.")}
          </p>
        </main>
      </AdminLayout>
    );
  }

  const hasWorkshop = items.some((it: any) => it.product === "workshop");
  const hasPhysical = items.some((it: any) => it.product !== "workshop");
  const fulfillmentType: string = order.fulfillment_type ||
    (hasWorkshop ? (hasPhysical ? "mixed" : "workshop_only") : "cake_only");
  const isMixed = fulfillmentType === "mixed";
  const isWorkshopOnly = fulfillmentType === "workshop_only";
  // order_number's "ORDM-" prefix (vs "ORD-") is the PRIMARY, unambiguous
  // signal for a manual order — minted at creation by the Make scenario
  // "Bento — Commandes manuelles instantanées" (7425367) and never changed
  // afterward. order_source (the real "Instagram"/"WhatsApp"/"manual order"
  // value that same Make scenario also sends) is checked as a fallback only,
  // and shown as-is in Customer Information below when present — the coarse
  // MANUEL badge never depends on which specific channel it came from.
  const isManual = !!order.order_number?.startsWith("ORDM-") || (!!order.order_source && order.order_source !== "website");
  // Terminal / abnormal: a capacity abort persisted order_validation='cancelled'
  // + order_failure_reason. Handle it before any decision UI.
  const isCancelled = order.order_validation === "cancelled" || !!order.order_failure_reason;
  // 2026-09-15 (deferred capture restored): every fulfilment type now goes
  // through the SAME Accept/Refuse admin decision, workshop_only included —
  // physical_validation carries it for cake_only/mixed ('not_applicable'
  // only for workshop_only, which never changes); workshop_only's own
  // decision lives on order_validation directly instead (mirrors
  // decide_order_physical / manage-order/index.ts exactly).
  // 2026-09-19: a manual order is considered accepted the moment it's
  // created — there is no separate Accept/Refuse review step for it — so
  // its status is read from order_validation too, never physical_validation.
  // physical_validation is only ever written by the decide_order_physical
  // RPC (manage-order's Accept/Refuse flow), which a manually-inserted order
  // never goes through, so plenty of older manual orders sit at
  // order_validation='approved' with physical_validation still stuck at its
  // column default 'pending' — reading physical_validation for them would
  // incorrectly re-offer the Accept/Refuse decision UI on an already-decided
  // order (see isResolved below).
  const decisionState: string = (isWorkshopOnly || isManual)
    ? (order.order_validation ?? "pending")
    : (order.physical_validation ?? "pending");
  // Decision UI shows for any order that is not cancelled and still pending
  // — no more "workshop_only is auto-confirmed" exception, no more waiting
  // for an independent workshop confirmation before a mixed order can be
  // decided (Accept/Refuse decides everything together now).
  const isResolved = isCancelled || decisionState !== "pending";
  // Admin-created manual order: payment is recorded by hand (ManualOrderPanel),
  // never "authorized then captured" like a website order.
  const isAdminManual = order.created_via === "admin";
  const adminUnpaid = isAdminManual && order.payment_status !== "paid";
  const customerName = `${order.first_name || ""} ${order.last_name || ""}`.trim();
  // "À préparer / Fait" box on each cake: shown, but not tickable, while the
  // order can't be produced (same rules as update-production-status).
  const productionBlockedReason: string | null =
    isCancelled || decisionState === "rejected" || decisionState === "cancelled"
      ? t("This order is cancelled or refused.", "Cette commande est annulée ou refusée.")
      : order.is_draft
        ? t("Draft: confirm the order first.", "Brouillon : confirmez d'abord la commande.")
        : !isManual && decisionState === "pending"
          ? t("Accept the order first.", "Acceptez d'abord la commande.")
          : !isManual && order.payment_status !== "paid"
            ? t("This order is not paid.", "Cette commande n'est pas payée.")
            : null;
  // Multi-date fulfillment: order_fulfillments has one row per distinct
  // pickup/delivery date (get-order-detail now returns it, service_role,
  // no RLS concern). ≤1 row is today's ordinary case — same single block
  // as before. 2+ rows means this order genuinely spans multiple dates, so
  // the single "Pickup / Delivery" block is replaced by one per date.
  const isMultiDate = fulfillments.length > 1;
  const fulfillmentById = (fulfillmentId: string | null | undefined) =>
    fulfillmentId ? fulfillments.find((f) => f.id === fulfillmentId) : null;

  return (
    <AdminLayout>
      <main className="container mx-auto px-4 py-8 max-w-2xl">
        <Link to="/admin/orders" className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="h-3 w-3 mr-1" />
          {t("Back to all orders", "Retour à toutes les commandes")}
        </Link>
        <div className="border border-border/60 bg-background p-6 space-y-6">
          {/* Header */}
          <div className="border-b border-border/60 pb-4">
            <p className="font-sans text-[11px] tracking-[0.105em] uppercase text-muted-foreground mb-1">
              {t("Order", "Commande")}
            </p>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="font-sans text-xl md:text-2xl tracking-[0.105em] font-semibold uppercase text-foreground">
                {order.order_number || `#${order.id.slice(0, 8).toUpperCase()}`}
              </h1>
              <span className={`text-[11px] uppercase tracking-[0.105em] px-2 py-0.5 ${
                hasWorkshop ? "bg-purple-100 text-purple-800" :
                isManual ? "bg-blue-100 text-blue-800" :
                "bg-secondary text-secondary-foreground"
              }`}>
                {hasWorkshop ? t("Workshop", "Workshop")
                  : isManual ? t("Manual", "Manuel")
                  : t("Website", "Site")}
              </span>
              {order.created_via === "admin" ? (
                // Admin-created manual order: draft / awaiting payment / paid /
                // cancelled (its order_validation is 'approved' from creation,
                // so the Accept/Refuse badge below would read "accepted").
                <span className={`text-[11px] uppercase tracking-[0.105em] px-2 py-0.5 ${MANUAL_STATUS_LABELS[manualStatusOf(order)].className}`}>
                  {t(MANUAL_STATUS_LABELS[manualStatusOf(order)].en, MANUAL_STATUS_LABELS[manualStatusOf(order)].fr)}
                </span>
              ) : (
              <span className={`text-[11px] uppercase tracking-[0.105em] px-2 py-0.5 ${
                isCancelled ? "bg-red-100 text-red-800" :
                decisionState === "approved" ? "bg-emerald-100 text-emerald-800" :
                decisionState === "pending" ? "bg-amber-100 text-amber-800" :
                "bg-red-100 text-red-800"
              }`}>
                {isCancelled ? decisionStateLabel("cancelled", t)
                  : isWorkshopOnly ? `WORKSHOP · ${decisionStateLabel(decisionState, t)}`
                  : isMixed ? `WS+CAKE · ${decisionStateLabel(decisionState, t)}`
                  : decisionStateLabel(decisionState, t)}
              </span>
              )}
            </div>
          </div>

          {order.created_via === "admin" && !employee && (
            <ManualOrderPanel order={order} items={items} invoiceUrl={invoiceUrl} onChanged={() => setReloadKey((k) => k + 1)} />
          )}

          {/* Missing token warning — rare: only when this order genuinely has
              no order_action_tokens row at all (neither the URL nor
              get-order-detail's own lookup found one), so Accept/Refuse has
              nothing to authorise itself with. Viewing is unaffected. */}
          {!employee && !effectiveToken && !isResolved && (
            <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200">
              <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
              <div className="text-sm text-amber-800">
                <p className="font-medium">{t("No action token for this order", "Aucun jeton d'action pour cette commande")}</p>
                <p>{t("This order has no available action token, so it cannot be accepted or refused from here.", "Cette commande n'a aucun jeton d'action disponible, elle ne peut donc pas être acceptée ou refusée depuis cette page.")}</p>
              </div>
            </div>
          )}

          {/* Customer Info */}
          <div className="border border-border/60 bg-background p-4 space-y-1">
            <h3 className="font-sans text-[12px] tracking-[0.105em] font-semibold uppercase text-foreground mb-3 flex items-center gap-2">
              <User className="w-3.5 h-3.5 text-primary" strokeWidth={1.5} />
              {t("Customer Information", "Informations client")}
            </h3>
            <DetailRow label={t("Name", "Nom")} value={customerName} />
            <DetailRow label={t("Email", "E-mail")} value={order.email} />
            <DetailRow label={t("Phone", "Téléphone")} value={order.phone} />
            {/* The real channel (Instagram, WhatsApp, "manual order", ...)
                behind the coarse MANUEL badge above — shown only when it's
                actually set and isn't just the generic "website" value.
                DetailRow itself already hides when value is falsy. */}
            {order.order_source && order.order_source !== "website" && (
              <DetailRow label={t("Source", "Source")} value={order.order_source} />
            )}
          </div>

          {/* Pickup / Delivery — physical products only */}
          {isMultiDate ? (
            <div className="space-y-3">
              {fulfillments.map((f, idx) => (
                <div key={f.id} className="border border-border/60 bg-background p-4 space-y-1">
                  <h3 className="font-sans text-[12px] tracking-[0.105em] font-semibold uppercase text-foreground mb-3 flex items-center gap-2">
                    <Package className="w-3.5 h-3.5 text-primary" strokeWidth={1.5} />
                    {t("Pickup / Delivery", "Retrait / Livraison")} — {t("date", "date")} {idx + 1}
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
                <div className="border border-border/60 bg-background p-4 space-y-1">
                  <DetailRow label={t("Delivery Notes", "Notes de livraison")} value={order.order_comment} />
                </div>
              )}
            </div>
          ) : order.delivery_method && (
          <div className="border border-border/60 bg-background p-4 space-y-1">
            <h3 className="font-sans text-[12px] tracking-[0.105em] font-semibold uppercase text-foreground mb-3 flex items-center gap-2">
              <Package className="w-3.5 h-3.5 text-primary" strokeWidth={1.5} />
              {t("Pickup / Delivery", "Retrait / Livraison")}
            </h3>
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
              <h3 className="font-sans text-[12px] tracking-[0.105em] font-semibold uppercase text-foreground flex items-center gap-2">
                <Cake className="w-3.5 h-3.5 text-primary" strokeWidth={1.5} />
                {t("Order Items", "Articles de la commande")} ({items.length})
              </h3>
              {items.map((item: any, i: number) => {
                const candlesList = item.candle_name
                  ? `${item.candle_name}${item.candle_quantity ? ` ×${item.candle_quantity}` : ""}`
                  : "";

                if (item.product === "workshop") {
                  return (
                    <div key={item.id || i} className="border border-border/60 bg-background p-4 space-y-1">
                      <div className="flex justify-between mb-2">
                        <span className="font-medium text-sm">
                          {item.workshop_type === "paint" ? t("Paint Workshop", "Workshop Peinture") : t("Signature Workshop", "Workshop Signature")}
                        </span>
                        {!employee && <span className="font-semibold text-sm text-primary">CHF {item.total}</span>}
                      </div>
                      <DetailRow label={t("Date", "Date")} value={formatDateFromIso(item.workshop_date)} />
                      <DetailRow label={t("Time", "Heure")} value={item.workshop_time} />
                      <DetailRow label={t("Participants", "Participants")} value={item.workshop_participants != null ? String(item.workshop_participants) : null} />
                      {!employee && <DetailRow label={t("Unit price", "Prix unitaire")} value={item.workshop_unit_price != null ? `CHF ${item.workshop_unit_price}` : null} />}
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
                const displayImage = itemDisplayImage({
                  product: item.product,
                  designImageUrl: item.design_image_url,
                  referenceImages: item.reference_images,
                  candleName: item.candle_name,
                });

                return (
                  <div key={item.id || i} className="border border-border/60 bg-background p-4">
                    <div className="flex gap-4">
                      <div className="w-16 h-16 flex-shrink-0 bg-secondary/40 overflow-hidden">
                        {displayImage && (
                          <img src={displayImage} alt={productLabel} className="w-full h-full object-cover" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex justify-between items-center gap-3 mb-1">
                          <span className="flex items-center gap-2.5">
                            {item.production_status === "cancelled" ? (
                              <span className="px-2 py-0.5 text-[11px] bg-red-100 text-red-800">{t("Cancelled", "Annulé")}</span>
                            ) : (
                              <ProductionCheck
                                itemId={item.id}
                                status={item.production_status}
                                disabledReason={productionBlockedReason}
                                onChange={(next) => setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, production_status: next } : x)))}
                              />
                            )}
                            <span className="font-medium text-sm">{productLabel} {i + 1}</span>
                          </span>
                          {!employee && <span className="font-semibold text-sm text-primary">CHF {item.total}</span>}
                        </div>
                        {isMultiDate && (
                          <DetailRow label={t("Date", "Date")} value={formatDateFromIso(fulfillmentById(item.fulfillment_id)?.pickup_delivery_date)} />
                        )}
                        {item.size && <DetailRow label={t("Size", "Taille")} value={sizeLabel(item.size)} />}
                        {item.shape && <DetailRow label={t("Shape", "Forme")} value={shapeLabel(item.shape, "en", item.size)} />}
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
                        <DetailRow label={t("Special Instructions", "Instructions particulières")} value={comment} />
                        {!employee && (
                        <div className="pt-2">
                          <Link to={`/admin/labels?order=${order?.id ?? ""}&item=${item.id}`} className="text-[11px] text-primary hover:underline flex items-center gap-1">
                            <Printer className="w-3 h-3" />
                            {t("Production label", "Étiquette de production")}
                          </Link>
                        </div>
                        )}
                        <ReferencePhotos urls={item.reference_images} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Employée (F23) : seulement « payé / non payé » et le statut, sans montant ni facture. */}
          {employee && (
            <div className="border border-border/60 bg-background p-4 space-y-1" data-testid="employee-payment">
              <h3 className="font-sans text-[12px] tracking-[0.105em] font-semibold uppercase text-foreground mb-3 flex items-center gap-2">
                <CreditCard className="w-3.5 h-3.5 text-primary" strokeWidth={1.5} />
                {t("Status", "Statut")}
              </h3>
              <DetailRow label={t("Payment", "Paiement")} value={order.payment_status === "paid" ? t("Paid", "Payé") : t("Not paid", "Non payé")} />
              <DetailRow label={t("Order", "Commande")} value={
                isCancelled ? t("Cancelled", "Annulée") :
                decisionState === "pending" ? t("To accept", "À accepter") :
                decisionState === "approved" ? t("Accepted", "Acceptée") :
                decisionState === "rejected" ? t("Refused", "Refusée") : decisionState
              } />
              <p className="text-xs text-muted-foreground pt-1">{t("Read only.", "Consultation seulement.")}</p>
            </div>
          )}

          {/* Payment Summary */}
          {!employee && (<>
          <div className="border border-border/60 bg-background p-4 space-y-1">
            <h3 className="font-sans text-[12px] tracking-[0.105em] font-semibold uppercase text-foreground mb-3 flex items-center gap-2">
              <CreditCard className="w-3.5 h-3.5 text-primary" strokeWidth={1.5} />
              {t("Payment", "Paiement")}
            </h3>
             <DetailRow label={t("Order №", "Commande n°")} value={order.order_number || order.id.slice(0, 8).toUpperCase()} />
             <DetailRow label={t("Invoice №", "Facture n°")} value={order.invoice_number || "—"} />
            {invoiceUrl ? (
              <div className="flex gap-2 text-sm">
                <span className="text-muted-foreground min-w-[140px]">{t("Invoice", "Facture")}:</span>
                <div className="flex gap-3">
                  <a href={invoiceUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                    {t("View", "Voir")}
                  </a>
                  <a href={`${invoiceUrl}${invoiceUrl.includes("?") ? "&" : "?"}download=`} className="text-primary underline">
                    {t("Download", "Télécharger")}
                  </a>
                </div>
              </div>
            ) : isAdminManual ? (
              <DetailRow label={t("Invoice", "Facture")} value={t("Created when the confirmation is sent", "Créée à l'envoi de la confirmation")} />
            ) : order.invoice_number ? (
              <div className="flex gap-2 text-sm">
                <span className="text-muted-foreground min-w-[140px]">{t("Invoice", "Facture")}:</span>
                <div>
                  <span className="text-amber-700">{t("Missing — needs to be regenerated", "Manquante — à régénérer")}</span>
                  {invoiceUrlError && (
                    <p className="text-xs text-destructive mt-1 break-all">{invoiceUrlError}</p>
                  )}
                </div>
              </div>
            ) : null}
            {order.customer_ref_id && (
              <div className="flex gap-2 text-sm">
                <span className="text-muted-foreground min-w-[96px] sm:min-w-[140px] shrink-0">{t("Customer", "Client")}:</span>
                <Link to={`/admin/customers/${order.customer_ref_id}`} className="underline underline-offset-2">{t("Open the customer record", "Ouvrir la fiche client")}</Link>
              </div>
            )}
            <DetailRow label={t("Total", "Total")} value={`CHF ${order.total_amount}`} />
            <DetailRow label={t("Payment", "Paiement")} value={
              order.payment_status === "paid"
                ? t("Captured", "Encaissé")
                : adminUnpaid
                  ? t("Awaiting payment", "En attente de paiement")
                : order.payment_status === "cancelled"
                  ? t("Authorization voided — nothing charged", "Autorisation annulée — rien prélevé")
                  : t("Authorized, not yet captured", "Autorisé, pas encore encaissé")
            } />
            {(() => {
              const refs = paymentRefs(order);
              return (
                <>
                  {refs.reference && <CopyRow testId="payment-reference" label={t("Payment reference", "Référence de paiement")} value={refs.reference} copyLabel={t("Copy", "Copier")} />}
                  {refs.transactionId && <CopyRow testId="postfinance-transaction" label={t("PostFinance transaction", "Transaction PostFinance")} value={refs.transactionId} copyLabel={t("Copy", "Copier")} />}
                  {refs.rewardOnly && <DetailRow label={t("PostFinance transaction", "Transaction PostFinance")} value={t("None — paid entirely with the reward balance", "Aucune — payée entièrement avec la cagnotte")} />}
                </>
              );
            })()}
            <DetailRow label={t("Status", "Statut")} value={
              isAdminManual ? t(MANUAL_STATUS_LABELS[manualStatusOf(order)].en, MANUAL_STATUS_LABELS[manualStatusOf(order)].fr) :
              decisionState === "pending" ? t("Pending your decision", "En attente de votre décision") :
              decisionState === "approved" ? t("Approved", "Validée") :
              decisionState === "rejected" ? t("Refused", "Refusée") :
              decisionState
            } />
          </div>

          {/* Refunds (lot 2): collected / decided / refunded / left to refund,
              recording of refunds made by hand, decisions, correction and
              dating — every rule enforced server-side (manage-refunds). The
              former « manual refund » form and the « mark as refunded »
              button are replaced by this block. */}
          <OrderRefundsPanel
            orderId={order.id}
            items={items.map((item: any, idx: number) => {
              const productName = t(PRODUCT_LABELS[item.product]?.en, PRODUCT_LABELS[item.product]?.fr) || item.product;
              const date = item.product === "workshop"
                ? formatDateFromIso(item.workshop_date)
                : isMultiDate ? formatDateFromIso(fulfillmentById(item.fulfillment_id)?.pickup_delivery_date) : null;
              return { id: item.id, label: date ? `${productName} ${idx + 1} — ${date}` : `${productName} ${idx + 1}` };
            })}
          />

          {/* Annulation (2026-10-04) : commande entière ou places de workshop,
              avec les e-mails existants — remplace les actions Notion. Une
              commande du site encore à accepter se refuse (bloc ci-dessous). */}
          <OrderCancellationPanel
            order={order}
            reservations={isCancelled ? [] : reservations}
            items={items.map((it: any, idx: number) => ({
              id: it.id,
              product: it.product,
              production_status: it.production_status ?? null,
              cancellation_email_sent_at: it.cancellation_email_sent_at ?? null,
              label: `${t(PRODUCT_LABELS[it.product]?.en, PRODUCT_LABELS[it.product]?.fr) || it.product} ${idx + 1}${
                it.product === "workshop" ? ` — ${formatDateFromIso(it.workshop_date)}`
                : isMultiDate ? ` — ${formatDateFromIso(fulfillmentById(it.fulfillment_id)?.pickup_delivery_date)}` : ""}${
                it.product !== "workshop" && it.flavors?.length ? ` (${it.flavors.join(", ")})` : ""}`,
            }))}
            canCancelOrder={!isCancelled && !order.is_draft && decisionState !== "rejected" && (isManual || decisionState === "approved")}
            labelFor={(itemId) => {
              const idx = items.findIndex((it: any) => it.id === itemId);
              const it = idx >= 0 ? items[idx] : null;
              return it ? `${t(PRODUCT_LABELS[it.product]?.en, PRODUCT_LABELS[it.product]?.fr) || it.product} ${idx + 1} — ${formatDateFromIso(it.workshop_date)}` : t("Workshop", "Workshop");
            }}
            onChanged={() => setReloadKey((k) => k + 1)}
          />
          </>)}

          {/* Admin Actions */}
          {employee ? null : !isResolved ? (
            <div className="border-t border-border pt-6 space-y-4">
              {!pinBySession && (
                <div className="space-y-2">
                  <Label htmlFor="pin">{t("Admin PIN", "Code PIN administrateur")}</Label>
                  <PasswordInput
                    id="pin"
                   
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    placeholder={t("Enter your admin PIN", "Saisissez votre code PIN administrateur")}
                    className="max-w-xs"
                  />
                </div>
              )}

              {result && (
                <div className={`p-3 text-sm border ${
                  result.type === "success" ? "bg-emerald-50 text-emerald-800 border-emerald-200" :
                  "bg-destructive/10 text-destructive border-destructive/20"
                }`}>
                  {result.message}
                </div>
              )}

              <p className="text-sm text-muted-foreground">
                {t(
                  "The payment is only authorized, not yet captured. Approve captures it and confirms the order (cake and workshop together, if both are present). Refuse voids the authorization instead — nothing is charged, and any workshop seat is released immediately.",
                  "Le paiement n'est qu'autorisé, pas encore encaissé. Valider encaisse le paiement et confirme la commande (gâteau et workshop ensemble, le cas échéant). Refuser annule l'autorisation à la place — rien n'est prélevé, et toute place de workshop est libérée immédiatement.",
                )}
              </p>
              <div className="flex flex-wrap gap-3">
                <Button onClick={() => handleAction("approve")} disabled={!!actionLoading || !effectiveToken} className="flex-1 min-w-[150px]">
                  {actionLoading === "approve" ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle className="w-4 h-4 mr-2" />}
                  {t("Approve order", "Valider la commande")}
                </Button>
                <Button variant="destructive" onClick={() => handleAction("reject")} disabled={!!actionLoading || !effectiveToken} className="flex-1 min-w-[150px]">
                  {actionLoading === "reject" ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <XCircle className="w-4 h-4 mr-2" />}
                  {t("Refuse order", "Refuser la commande")}
                </Button>
              </div>
            </div>
          ) : isCancelled ? (
            <div className="p-4 text-center bg-red-50 text-red-800 border border-red-200">
              <p className="font-medium flex items-center justify-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                {order.order_failure_reason === "workshop_capacity_unavailable"
                  ? t("Workshop sold out after authorization — the whole order was cancelled and the authorization voided. If it was somehow already captured, refund it by hand.", "Workshop complet après autorisation — toute la commande a été annulée et l'autorisation annulée. Si le paiement a malgré tout été encaissé, à rembourser à la main.")
                  : t("This order was cancelled. If a payment was somehow already captured, refund it by hand.", "Cette commande a été annulée. Si un paiement a malgré tout été encaissé, à rembourser à la main.")}
              </p>
            </div>
          ) : isAdminManual ? null : (
            <div className={`p-4 text-center border ${
              decisionState === "approved" ? "bg-emerald-50 text-emerald-800 border-emerald-200" : "bg-red-50 text-red-800 border-red-200"
            }`}>
              <p className="font-medium flex items-center justify-center gap-2">
                {decisionState === "approved" ? <CheckCircle className="w-4 h-4 shrink-0" /> : <XCircle className="w-4 h-4 shrink-0" />}
                {decisionState === "approved"
                  ? t("This order has been approved and the payment captured.", "Cette commande a été validée et le paiement encaissé.")
                  : t("This order has been refused. The authorization was voided — nothing was charged.", "Cette commande a été refusée. L'autorisation a été annulée — rien n'a été prélevé.")}
              </p>
            </div>
          )}
        </div>
      </main>
    </AdminLayout>
  );
};

export default AdminOrder;
