import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronDown, ChevronUp, FileText, Loader2 } from "lucide-react";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { PRODUCT_LABELS, formatDateCH, sizeLabel, shapeLabel, designLabel, splitComment } from "@/lib/orderLabels";

type CustomerOrderItem = {
  id: string;
  product: string;
  size: string | null;
  shape: string | null;
  flavors: string[] | null;
  design: string | null;
  extra: string | null;
  extras_price: number;
  candle_name: string | null;
  candle_quantity: number | null;
  candles_price: number;
  item_comment: string | null;
  total: number;
  workshop_type: string | null;
  workshop_date: string | null;
  workshop_time: string | null;
  workshop_participants: number | null;
};

type CustomerOrderFulfillment = {
  id: string;
  pickup_delivery_date: string | null;
  pickup_delivery_slot: string | null;
  delivery_method: string | null;
  delivery_address: string | null;
  delivery_zone: string | null;
};

type CustomerOrder = {
  id: string;
  order_number: string | null;
  pickup_delivery_date: string | null;
  pickup_delivery_slot: string | null;
  delivery_method: string | null;
  delivery_address: string | null;
  delivery_zone: string | null;
  delivery_fee: number;
  total_amount: number;
  order_validation: string;
  payment_status: string;
  invoice_path: string | null;
  fulfillment_type: string | null;
  physical_validation: string | null;
  refund_status: string | null;
  workshop_confirmed_at: string | null;
  order_failure_reason: string | null;
  order_items: CustomerOrderItem[];
  order_fulfillments: CustomerOrderFulfillment[];
};

// Multi-date fulfillment: every physical order has AT LEAST one
// order_fulfillments row (create-postfinance-payment normalises even the
// legacy single-date path into one), so this is the one place that decides
// whether an order genuinely spans 2+ dates or not — everything else
// (classification, display) branches off THIS, never off order_fulfillments
// .length directly, so an older order created before this feature existed
// (0 fulfillment rows) still falls back correctly to the single legacy
// orders.pickup_delivery_date column.
function fulfillmentDates(order: CustomerOrder): string[] {
  if (order.order_fulfillments?.length) {
    return order.order_fulfillments.map((f) => f.pickup_delivery_date).filter((d): d is string => !!d);
  }
  return order.pickup_delivery_date ? [order.pickup_delivery_date] : [];
}
function isMultiDateOrder(order: CustomerOrder): boolean {
  return (order.order_fulfillments?.length ?? 0) > 1;
}

// Collapsed-card summary date: identical to today's rendering for the
// ≤1-fulfillment case (just the one date). For a genuine multi-date order,
// shows the earliest date plus a count of the others so the card stays
// scannable without pre-expanding it.
function summaryDateLabel(order: CustomerOrder, t: (en: string, fr: string) => string): string {
  if (!isMultiDateOrder(order)) return formatDateCH(order.pickup_delivery_date);
  const dates = [...fulfillmentDates(order)].sort();
  if (!dates.length) return formatDateCH(order.pickup_delivery_date);
  const rest = dates.length - 1;
  return `${formatDateCH(dates[0])} (+${rest} ${t(rest > 1 ? "other dates" : "other date", rest > 1 ? "autres dates" : "autre date")})`;
}

function itemsSummary(items: CustomerOrder["order_items"]): string {
  return items
    .map((item) =>
      item.product === "workshop"
        ? `${item.workshop_type === "paint" ? "Atelier Peinture" : "Atelier Signature"}${item.workshop_date ? ` (${formatDateCH(item.workshop_date)})` : ""}`
        : item.size ? `${item.size}${item.flavors?.length ? ` — ${item.flavors.join(", ")}` : ""}` : (item.design || ""))
    .filter(Boolean)
    .join(", ");
}

const MyOrders = () => {
  const { t } = useLang();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, loading: authLoading } = useAuth();
  const [orders, setOrders] = useState<CustomerOrder[] | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [invoiceLoadingId, setInvoiceLoadingId] = useState<string | null>(null);

  useEffect(() => {
    document.title = "My Orders – Bento Cake Studio";
    return () => { document.title = "Bento Cake Studio Geneva"; };
  }, []);

  useEffect(() => {
    if (!authLoading && !user) navigate("/login");
  }, [authLoading, user, navigate]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      // Best-effort, self-service claim of any order placed as a guest
      // (before this account existed, or from a device where the customer
      // wasn't logged in) with the same verified e-mail — see
      // claim_guest_orders_for_current_user() (SECURITY DEFINER, matches
      // only on the caller's OWN auth.jwt() e-mail, never a client-supplied
      // value, and only ever touches an order whose customer_id is still
      // NULL). Awaited first so a freshly-claimed order appears in the very
      // same load. `as any`: this RPC isn't in the generated Supabase types
      // yet (migration not applied at generation time) — drop the cast once
      // types are regenerated after the migration runs. A failure here
      // (e.g. not deployed yet) is logged and never blocks the customer's
      // already-linked orders from loading normally.
      const { error: claimError } = await (supabase.rpc as any)("claim_guest_orders_for_current_user");
      if (claimError) console.error("claim_guest_orders_for_current_user failed (non-blocking):", claimError);
      if (cancelled) return;

      const { data, error } = await supabase
        .from("orders")
        .select(
          "id, order_number, pickup_delivery_date, pickup_delivery_slot, delivery_method, delivery_address, delivery_zone, delivery_fee, total_amount, order_validation, payment_status, invoice_path, fulfillment_type, physical_validation, refund_status, workshop_confirmed_at, order_failure_reason, " +
          "order_items(id, product, size, shape, flavors, design, extra, extras_price, candle_name, candle_quantity, candles_price, item_comment, total, workshop_type, workshop_date, workshop_time, workshop_participants), " +
          "order_fulfillments(id, pickup_delivery_date, pickup_delivery_slot, delivery_method, delivery_address, delivery_zone)"
        )
        .eq("customer_id", user.id)
        .order("pickup_delivery_date", { ascending: false });
      if (cancelled) return;
      if (error) {
        console.error("Failed to load orders:", error);
        setOrders([]);
        return;
      }
      setOrders((data as unknown as CustomerOrder[]) ?? []);
    })();
    return () => { cancelled = true; };
  }, [user]);

  const statusLabel = (order: CustomerOrder) => {
    const ft = order.fulfillment_type
      || (order.order_items?.some((i) => i.product === "workshop")
            ? (order.order_items?.some((i) => i.product !== "workshop") ? "mixed" : "workshop_only")
            : "cake_only");
    const workshopConfirmed = !!order.workshop_confirmed_at;

    // Terminal / abnormal states first — never fall through to a normal label.
    if (order.order_validation === "cancelled" || order.order_failure_reason) {
      return t("Cancelled — refund being processed", "Annulée — remboursement en cours");
    }
    if (order.order_validation === "rejected") {
      return t("Declined", "Refusée");
    }

    if (ft === "workshop_only") {
      return workshopConfirmed
        ? t("Workshop confirmed", "Atelier confirmé")
        : t("Confirming your workshop…", "Confirmation de votre atelier…");
    }

    if (ft === "mixed") {
      if (!workshopConfirmed) return t("Confirming your workshop…", "Confirmation de votre atelier…");
      const phys = order.physical_validation ?? "pending";
      if (phys === "approved") return t("Confirmed", "Confirmée");
      if (phys === "rejected") {
        return order.refund_status === "refunded"
          ? t("Workshop confirmed · cake refunded", "Atelier confirmé · gâteau remboursé")
          : t("Workshop confirmed · cake refund being processed", "Atelier confirmé · remboursement gâteau en cours");
      }
      return t("Workshop confirmed · cake pending", "Atelier confirmé · gâteau en attente");
    }

    // cake_only
    return ({
      pending: t("Pending confirmation", "En attente de confirmation"),
      approved: t("Confirmed", "Confirmée"),
    }[order.physical_validation ?? order.order_validation] ?? t("Pending confirmation", "En attente de confirmation"));
  };

  const deliveryMethodLabel = (method: string | null) =>
    !method ? "" : method === "delivery" ? t("Delivery", "Livraison") : t("Pickup", "Retrait");

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Multi-date aware: an order is "upcoming" as long as at least one of its
  // fulfillment dates hasn't passed yet; it only moves to "past" once every
  // date has passed. An order with no resolvable date at all (shouldn't
  // happen once order_fulfillments is populated, but kept as a safety net)
  // stays "upcoming" — same behaviour as before this change.
  const isUpcoming = (o: CustomerOrder) => {
    const dates = fulfillmentDates(o);
    if (!dates.length) return true;
    return dates.some((d) => new Date(d) >= today);
  };
  const upcomingOrders = (orders ?? []).filter(isUpcoming);
  const pastOrders = (orders ?? []).filter((o) => !isUpcoming(o));

  const handleViewInvoice = async (order: CustomerOrder) => {
    if (!order.invoice_path) return;
    setInvoiceLoadingId(order.id);
    // Open a blank tab SYNCHRONOUSLY, still inside the click handler, before
    // any await — some browsers (Safari in particular) stop treating a
    // window.open() call as user-initiated once it happens after an awaited
    // network call, and silently block it with no visible error. Opening
    // the tab now and redirecting it once the signed URL resolves keeps
    // this a genuine, unblocked user gesture end to end.
    const invoiceTab = window.open("", "_blank", "noopener,noreferrer");
    try {
      const { data, error } = await supabase.storage
        .from("invoice")
        .createSignedUrl(order.invoice_path, 60 * 5);
      if (error || !data?.signedUrl) {
        console.error("Failed to get invoice URL:", error);
        invoiceTab?.close();
        toast({
          title: t("Could not open the invoice", "Impossible d'ouvrir la facture"),
          description: t(
            "Please try again in a moment, or contact us if this keeps happening.",
            "Merci de réessayer dans un instant, ou de nous contacter si le problème persiste."
          ),
          variant: "destructive",
        });
        return;
      }
      if (invoiceTab) {
        invoiceTab.location.href = data.signedUrl;
      } else {
        // The pre-opened tab itself got blocked (very strict blocker) —
        // fall back to a direct open now; this one at least carries a real
        // URL, which some blockers still allow through.
        window.open(data.signedUrl, "_blank", "noopener,noreferrer");
      }
    } catch (err) {
      console.error("Invoice fetch threw:", err);
      invoiceTab?.close();
      toast({
        title: t("Could not open the invoice", "Impossible d'ouvrir la facture"),
        description: t(
          "Please try again in a moment, or contact us if this keeps happening.",
          "Merci de réessayer dans un instant, ou de nous contacter si le problème persiste."
        ),
        variant: "destructive",
      });
    } finally {
      setInvoiceLoadingId(null);
    }
  };

  const OrderCard = ({ order, past }: { order: CustomerOrder; past?: boolean }) => {
    const isExpanded = expandedId === order.id;

    return (
      <div className="border border-border/60">
        <button
          type="button"
          onClick={() => setExpandedId(isExpanded ? null : order.id)}
          className="w-full text-left p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 hover:bg-secondary/30 transition-colors"
        >
          <div>
            <div className="flex items-center gap-3 mb-1.5">
              <span className="font-sans text-[13px] tracking-[0.105em] font-semibold uppercase text-foreground">
                {order.order_number || order.id.slice(0, 8).toUpperCase()}
              </span>
              <span className="text-[11px] uppercase tracking-[0.105em] bg-secondary text-foreground/80 px-2.5 py-1">
                {statusLabel(order)}
              </span>
            </div>
            <p className="text-sm text-foreground/75">{itemsSummary(order.order_items) || "—"}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {t("Date", "Date")}: {summaryDateLabel(order, t)} · CHF {order.total_amount}
            </p>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            {past && (
              <Button
                asChild
                variant="outline"
                onClick={(e) => e.stopPropagation()}
                className="rounded-none border-primary text-primary hover:bg-primary/5 uppercase tracking-[0.105em] text-[12px] font-medium whitespace-nowrap"
              >
                <Link to="/catalog">{t("Order Again", "Commander à nouveau")}</Link>
              </Button>
            )}
            {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </div>
        </button>

        {isExpanded && (
          <div className="border-t border-border/60 p-5 space-y-5 bg-secondary/10">
            <div className="space-y-4">
              {order.order_items.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">
                  {t("Item details aren't available for this order.", "Le détail des articles n'est pas disponible pour cette commande.")}
                </p>
              ) : (
                order.order_items.map((item) => {
                  const { designPhoto, comment } = splitComment(item.item_comment);
                  return (
                    <div key={item.id} className="text-sm space-y-1">
                      <p className="font-medium text-foreground">
                        {item.product === "workshop"
                          ? (item.workshop_type === "paint" ? t("Paint Workshop", "Atelier Peinture") : t("Signature Workshop", "Atelier Signature"))
                          : (t(PRODUCT_LABELS[item.product]?.en, PRODUCT_LABELS[item.product]?.fr) || item.product)}
                        {item.product !== "workshop" && item.size && ` — ${sizeLabel(item.size)}`}
                        {item.product !== "workshop" && item.shape && item.shape !== "round" && ` (${shapeLabel(item.shape)})`}
                      </p>
                      <div className="text-muted-foreground space-y-0.5 pl-0.5">
                        {item.product === "workshop" && (
                          <>
                            {item.workshop_date && <p>{t("Date:", "Date :")} {formatDateCH(item.workshop_date)}{item.workshop_time ? ` · ${item.workshop_time}` : ""}</p>}
                            {item.workshop_participants != null && <p>{t("Participants:", "Participants :")} {item.workshop_participants}</p>}
                          </>
                        )}
                        {item.design && (
                          <p>
                            {t("Design:", "Design :")} {designLabel(item.design)}
                            {designPhoto ? ` — ${t("Photo", "Photo")} ${designPhoto}` : ""}
                          </p>
                        )}
                        {item.flavors?.length ? <p>{t("Flavour:", "Parfum :")} {item.flavors.join(", ")}</p> : null}
                        {item.extra && <p>{t("Extras:", "Extras :")} {item.extra} (+CHF {item.extras_price})</p>}
                        {item.candle_name && (
                          <p>
                            🕯️ {item.candle_name}
                            {item.candle_quantity ? ` ×${item.candle_quantity}` : ""} (+CHF {item.candles_price})
                          </p>
                        )}
                        {comment && <p>{t("Comment:", "Commentaire :")} {comment}</p>}
                      </div>
                      <p className="text-foreground font-medium">CHF {item.total}</p>
                    </div>
                  );
                })
              )}
            </div>

            <div className="border-t border-border/60 pt-4 text-sm space-y-1">
              {isMultiDateOrder(order) ? (
                <div className="space-y-3 pb-2">
                  {[...order.order_fulfillments]
                    .sort((a, b) => (a.pickup_delivery_date || "").localeCompare(b.pickup_delivery_date || ""))
                    .map((f) => (
                    <div key={f.id} className="space-y-0.5">
                      <p className="text-foreground font-medium">
                        {formatDateCH(f.pickup_delivery_date)}{f.pickup_delivery_slot ? ` · ${f.pickup_delivery_slot}` : ""}
                        {f.delivery_method ? ` — ${deliveryMethodLabel(f.delivery_method)}` : ""}
                        {f.delivery_method === "delivery" && f.delivery_zone ? ` (${f.delivery_zone})` : ""}
                      </p>
                      {f.delivery_method === "delivery" && f.delivery_address && (
                        <p className="text-muted-foreground text-xs">{f.delivery_address}</p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  {order.delivery_method && (
                    <>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("Pickup / Delivery date", "Date de retrait / livraison")}</span>
                    <span className="text-foreground">{formatDateCH(order.pickup_delivery_date)}{order.pickup_delivery_slot ? ` · ${order.pickup_delivery_slot}` : ""}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("Method", "Mode")}</span>
                    <span className="text-foreground">
                      {deliveryMethodLabel(order.delivery_method)}
                      {order.delivery_method === "delivery" && order.delivery_zone ? ` — ${order.delivery_zone}` : ""}
                    </span>
                  </div>
                    </>
                  )}
                  {order.delivery_method === "delivery" && order.delivery_address && (
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground flex-shrink-0">{t("Address", "Adresse")}</span>
                      <span className="text-foreground text-right">{order.delivery_address}</span>
                    </div>
                  )}
                </>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("Status", "Statut")}</span>
                <span className="text-foreground">{statusLabel(order)}</span>
              </div>
              <div className="flex justify-between font-semibold pt-1">
                <span className="text-foreground">{t("Total", "Total")}</span>
                <span className="text-foreground">CHF {order.total_amount}</span>
              </div>
            </div>

            {order.invoice_path ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={invoiceLoadingId === order.id}
                onClick={() => handleViewInvoice(order)}
                className="rounded-none border-primary text-primary hover:bg-primary/5 uppercase tracking-[0.105em] text-[12px] font-medium"
              >
                {invoiceLoadingId === order.id
                  ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                  : <FileText className="h-3.5 w-3.5 mr-2" />}
                {t("View Invoice", "Voir la facture")}
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground italic">
                {t("Invoice not available yet.", "Facture pas encore disponible.")}
              </p>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <Layout>
      <main className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="font-sans uppercase tracking-[0.105em] text-3xl md:text-4xl text-foreground mb-12 text-center font-semibold">
          {t("My Orders", "Mes commandes")}
        </h1>

        {orders === null ? (
          <p className="text-sm text-muted-foreground text-center">{t("Loading...", "Chargement...")}</p>
        ) : (
          <>
            <section className="mb-12">
              <h2 className="font-sans uppercase tracking-[0.105em] text-sm font-semibold text-foreground mb-5">
                {t("Upcoming Orders", "Commandes à venir")}
              </h2>
              <div className="space-y-4">
                {upcomingOrders.length ? (
                  upcomingOrders.map((o) => <OrderCard key={o.id} order={o} />)
                ) : (
                  <p className="text-sm text-muted-foreground">{t("No upcoming orders.", "Aucune commande à venir.")}</p>
                )}
              </div>
            </section>

            <section>
              <h2 className="font-sans uppercase tracking-[0.105em] text-sm font-semibold text-foreground mb-5">
                {t("Past Orders", "Commandes passées")}
              </h2>
              <div className="space-y-4">
                {pastOrders.length ? (
                  pastOrders.map((o) => <OrderCard key={o.id} order={o} past />)
                ) : (
                  <p className="text-sm text-muted-foreground">{t("No past orders yet.", "Aucune commande passée.")}</p>
                )}
              </div>
            </section>
          </>
        )}
      </main>
    </Layout>
  );
};

export default MyOrders;
