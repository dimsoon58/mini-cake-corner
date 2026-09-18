import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronDown, ChevronUp, FileText, Loader2 } from "lucide-react";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { PRODUCT_LABELS, formatDateCH, sizeLabel, shapeLabel, designLabel, flavorLabel, splitComment } from "@/lib/orderLabels";
import { formatChf } from "@/lib/money";
import { candleImageFromName, candlesFallback } from "@/lib/itemDisplayImage";
// Real product-line photos for the "no exact design captured" fallback
// below — never the generic cake emoji. Same source photos already used as
// each product's own hero/representative image on its page (DotCakes.tsx,
// KitBentoCake.tsx, Workshop.tsx, Catalog.tsx's bento/rectangle galleries),
// reused here rather than inventing new imagery.
import dotCakesFallback from "@/assets/dot-gallery-1.jpg";
import diyKitFallback from "@/assets/diy-kit-box.jpg";
import bentoCakeFallback from "@/assets/bento-gallery-1.jpg";
import rectangleCakeFallback from "@/assets/rectangle-signature.jpg";
import workshopSignatureFallback from "@/assets/workshop-signature.jpg";
import workshopPaintFallback from "@/assets/workshop-paint.png";
import printingFallback from "@/assets/printing-gallery-1.jpg";

// Products whose stored `design` is a fixed internal id (never a real
// customer choice — Dot Cakes/DIY Kit/Printing/Candles don't have a
// "design" step), so showing it ("Design: Dot Cakes") would just repeat
// the product name with zero new information. Only bento_cake and
// rectangle_cake have a genuine design pick worth a row of its own.
const PRODUCTS_WITHOUT_MEANINGFUL_DESIGN = new Set(["dot_cakes", "diy_kit", "edible_printing", "candles"]);

type CustomerOrderItem = {
  id: string;
  product: string;
  size: string | null;
  shape: string | null;
  flavors: string[] | null;
  design: string | null;
  design_image_url: string | null;
  // The client's own uploaded photos — for Printing this IS the exact image
  // to be printed, so it's the right fallback when design_image_url hasn't
  // been captured (older orders, placed before this was persisted here too).
  reference_images: string[] | null;
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
  // Links this physical item to the order_fulfillments row it's picked up/
  // delivered with — null for a workshop line (workshops carry their own
  // workshop_date, never a fulfillment) or for an item added before
  // multi-date fulfillment existed (falls back to the order-level date,
  // same convention as every backend email/invoice already uses).
  fulfillment_id: string | null;
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

// A group of physical items that share one pickup/delivery date — the
// "date first, then its products" layout. `fulfillment` is null only when
// no order_fulfillments row could be matched at all (an order placed
// before multi-date fulfillment existed AND with no fulfillments rows —
// falls back to the order-level pickup_delivery_date/slot/method,
// resolved by the caller, same as every backend email/invoice already
// does for this exact gap).
type FulfillmentGroup = { fulfillment: CustomerOrderFulfillment | null; items: CustomerOrderItem[] };

function groupItemsByFulfillment(order: CustomerOrder): FulfillmentGroup[] {
  const physicalItems = order.order_items.filter((i) => i.product !== "workshop");
  if (!physicalItems.length) return [];

  const fulfillmentById = new Map(order.order_fulfillments.map((f) => [f.id, f]));
  const sortedFulfillments = [...order.order_fulfillments].sort(
    (a, b) => (a.pickup_delivery_date || "").localeCompare(b.pickup_delivery_date || "")
  );

  // Single (or no) fulfillment row: every physical item is one group —
  // never split, regardless of fulfillment_id (this is the ≤1-date case,
  // covers both today's normal orders and any legacy row with none).
  if (sortedFulfillments.length <= 1) {
    return [{ fulfillment: sortedFulfillments[0] ?? null, items: physicalItems }];
  }

  // Genuinely multi-date: group strictly by fulfillment_id. An item with no
  // fulfillment_id (or one that doesn't match any known fulfillment row —
  // shouldn't happen, defensive) falls into its own "date unknown" group
  // rather than being silently dropped or misattributed to the wrong date.
  const groups = new Map<string, CustomerOrderItem[]>();
  const unassigned: CustomerOrderItem[] = [];
  for (const item of physicalItems) {
    if (item.fulfillment_id && fulfillmentById.has(item.fulfillment_id)) {
      const arr = groups.get(item.fulfillment_id) ?? [];
      arr.push(item);
      groups.set(item.fulfillment_id, arr);
    } else {
      unassigned.push(item);
    }
  }
  const result: FulfillmentGroup[] = sortedFulfillments
    .map((f) => ({ fulfillment: f, items: groups.get(f.id) ?? [] }))
    .filter((g) => g.items.length > 0);
  if (unassigned.length) result.push({ fulfillment: null, items: unassigned });
  return result;
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

function itemsSummary(items: CustomerOrder["order_items"], lang: "en" | "fr"): string {
  return items
    .map((item) =>
      item.product === "workshop"
        ? `${item.workshop_type === "paint" ? (lang === "fr" ? "Atelier Peinture" : "Paint Workshop") : (lang === "fr" ? "Atelier Signature" : "Signature Workshop")}${item.workshop_date ? ` (${formatDateCH(item.workshop_date)})` : ""}`
        : item.size
          ? `${sizeLabel(item.size, lang)}${item.flavors?.length ? ` — ${flavorLabel(item.flavors.join(","))}` : ""}`
          : (item.design ? designLabel(item.design) : ""))
    .filter(Boolean)
    .join(", ");
}

const MyOrders = () => {
  const { t, lang } = useLang();
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
          "order_items(id, product, size, shape, flavors, design, design_image_url, reference_images, extra, extras_price, candle_name, candle_quantity, candles_price, item_comment, total, workshop_type, workshop_date, workshop_time, workshop_participants, fulfillment_id), " +
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
    // any await — some browsers (Safari in particular, also on iOS) stop
    // treating a window.open() call as user-initiated once it happens
    // after an awaited network call, and silently block it with no
    // visible error. Opening the tab now and redirecting it once the
    // signed URL resolves keeps this a genuine, unblocked user gesture
    // end to end.
    //
    // The actual bug (found by tracing this precisely): the "noopener"
    // feature was passed to THIS FIRST call. Per spec, window.open()
    // ALWAYS returns null when "noopener" (or "noreferrer", which implies
    // it) is set — there is no way to both keep a handle to the new tab
    // AND deny it window.opener. That made `invoiceTab` null on every
    // single call, in every browser, all the time — not just Safari —
    // so this code always silently fell through to the `else` branch
    // below: a SECOND window.open(), called only after the await, which
    // Safari (and strict popup blockers generally) then blocked as an
    // untrusted popup. createSignedUrl() itself was never the problem.
    // Fix: don't pass "noopener"/"noreferrer" on this first call, so we
    // actually get the tab reference back and can navigate it once the
    // signed URL is ready — the content it ends up showing is always our
    // own Supabase storage response (a PDF), never third-party/untrusted,
    // so there's nothing meaningful for that tab to do with window.opener
    // even if it wanted to.
    const invoiceTab = window.open("", "_blank");
    if (invoiceTab) {
      // Defense in depth: we already don't pass "noopener" (that's what
      // lets us keep this handle), but explicitly clearing .opener has the
      // same practical effect — the new tab can't reach back into this
      // page via window.opener — without sacrificing the reference we need
      // to navigate it below.
      invoiceTab.opener = null;
    }
    try {
      const { data, error } = await supabase.storage
        .from("invoice")
        .createSignedUrl(order.invoice_path, 60 * 5);
      if (error || !data?.signedUrl) {
        console.error("Failed to get invoice signed URL:", order.id, order.invoice_path, error);
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
        // The pre-opened tab itself got blocked — a genuine, strict popup
        // blocker this time (invoiceTab is a real handle now, so this is
        // no longer the noopener self-inflicted case above). Fall back to
        // a direct open now; this one at least carries a real URL, which
        // some blockers still allow through even when called late.
        window.open(data.signedUrl, "_blank", "noopener,noreferrer");
      }
    } catch (err) {
      console.error("Invoice fetch threw:", order.id, order.invoice_path, err);
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

  // A pending order simply hasn't reached the confirmation step yet — an
  // invoice will exist once it does. A rejected/cancelled order never will,
  // so the two must never share the same "not yet" wording (which implies
  // "later" for a case where there's no "later" coming).
  const isRejectedOrCancelled = (order: CustomerOrder) =>
    order.order_validation === "rejected" || order.order_validation === "cancelled" || !!order.order_failure_reason;

  // Resolves the photo shown on one item's card, in priority order:
  //   1. design_image_url — the exact design/product photo the customer
  //      picked, when the site captured one (every product now sets this
  //      the same way Bento Cake always has — see Cart.tsx/Checkout.tsx).
  //   2. For Printing specifically: the first of the client's own uploaded
  //      reference_images — for this one product, that upload IS the exact
  //      design (the photo to be printed), so it's a real, non-generic
  //      choice too, not a placeholder. Only used as a fallback here since
  //      Checkout.tsx already persists it as design_image_url on any new
  //      order — this only still matters for older orders.
  //   3. A real, representative photo for that product line — never the
  //      cake emoji, which showed for every product with neither of the
  //      above (mainly older orders placed before design_image_url existed
  //      for that product).
  // Always a real photo, or null for a genuinely unknown/unmapped product —
  // never an emoji standing in for a missing image.
  const itemDisplayImage = (item: CustomerOrderItem): string | null => {
    if (item.design_image_url) return item.design_image_url;
    if (item.product === "edible_printing" && item.reference_images?.length) {
      return item.reference_images[0];
    }
    switch (item.product) {
      case "dot_cakes": return dotCakesFallback;
      case "diy_kit": return diyKitFallback;
      case "candles": return candleImageFromName(item.candle_name) ?? candlesFallback;
      case "bento_cake": return bentoCakeFallback;
      case "rectangle_cake": return rectangleCakeFallback;
      case "edible_printing": return printingFallback;
      case "workshop": return item.workshop_type === "paint" ? workshopPaintFallback : workshopSignatureFallback;
      default: return null;
    }
  };

  // One product card — image (see itemDisplayImage above) on the left,
  // name/price/details on the right. Labels (Design/Flavour/Extras/Candles/
  // Comment) are bold, values are not — a real visual hierarchy instead of
  // one flat wall of same-weight text.
  const ItemCard = ({ item }: { item: CustomerOrderItem }) => {
    const { designPhoto, comment } = splitComment(item.item_comment);
    const displayImage = itemDisplayImage(item);
    const title = item.product === "workshop"
      ? (item.workshop_type === "paint" ? t("Paint Workshop", "Atelier Peinture") : t("Signature Workshop", "Atelier Signature"))
      : (t(PRODUCT_LABELS[item.product]?.en, PRODUCT_LABELS[item.product]?.fr) || item.product);
    // diy_kit's size is always the same fixed "kit-bento" id — never a real
    // choice, and resolving it here would just repeat the product name
    // ("DIY Kit — DIY Kit" in English). Dot Cakes' size IS meaningful (the
    // pack count), kept.
    const sizeSuffix = item.product !== "workshop" && item.product !== "diy_kit" && item.size ? ` — ${sizeLabel(item.size, lang)}` : "";
    const shapeSuffix = item.product !== "workshop" && item.shape && item.shape !== "round" ? ` (${shapeLabel(item.shape, lang)})` : "";
    return (
      <div className="flex gap-3 p-3 border border-border/50 bg-background">
        <div className="w-16 h-16 flex-shrink-0 bg-secondary/40 flex items-center justify-center overflow-hidden">
          {displayImage && (
            <img src={displayImage} alt="" className="w-full h-full object-cover" />
          )}
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-semibold text-foreground">{title}{sizeSuffix}{shapeSuffix}</p>
            <p className="text-sm font-bold text-foreground whitespace-nowrap">CHF {formatChf(item.total)}</p>
          </div>
          <div className="text-xs text-muted-foreground space-y-0.5">
            {item.product === "workshop" && (
              <>
                {item.workshop_date && <p><strong className="font-semibold text-foreground/80">{t("Date:", "Date :")}</strong> {formatDateCH(item.workshop_date)}{item.workshop_time ? ` · ${item.workshop_time}` : ""}</p>}
                {item.workshop_participants != null && <p><strong className="font-semibold text-foreground/80">{t("Participants:", "Participants :")}</strong> {item.workshop_participants}</p>}
              </>
            )}
            {/* Dot Cakes/DIY Kit/Printing/Candles: "design" is a fixed
                internal id, never a real customer choice — showing it
                would just repeat the product name for no new info. */}
            {item.design && !PRODUCTS_WITHOUT_MEANINGFUL_DESIGN.has(item.product) && (
              <p>
                <strong className="font-semibold text-foreground/80">{t("Design:", "Design :")}</strong> {designLabel(item.design)}
                {designPhoto ? ` — ${t("Photo", "Photo")} ${designPhoto}` : ""}
              </p>
            )}
            {item.flavors?.length ? <p><strong className="font-semibold text-foreground/80">{t("Flavour:", "Parfum :")}</strong> {flavorLabel(item.flavors.join(","))}</p> : null}
            {item.extra && <p><strong className="font-semibold text-foreground/80">{t("Extras:", "Extras :")}</strong> {item.extra} (+CHF {formatChf(item.extras_price)})</p>}
            {item.candle_name && (
              <p>
                <strong className="font-semibold text-foreground/80">{t("Candles:", "Bougies :")}</strong> {item.candle_name}
                {item.candle_quantity ? ` ×${item.candle_quantity}` : ""} (+CHF {formatChf(item.candles_price)})
              </p>
            )}
            {comment && <p><strong className="font-semibold text-foreground/80">{t("Comment:", "Commentaire :")}</strong> {comment}</p>}
          </div>
        </div>
      </div>
    );
  };

  // Group header — the date/method a group of product cards is attached
  // to, shown ABOVE those cards (never a date list disconnected from the
  // items at the bottom). `fulfillment: null` only for the legacy/no-
  // fulfillment-row fallback, resolved from the order-level columns —
  // same single group either way, single-date or multi-date orders share
  // this exact rendering.
  const FulfillmentHeader = ({ group, order }: { group: FulfillmentGroup; order: CustomerOrder }) => {
    const date = group.fulfillment?.pickup_delivery_date ?? order.pickup_delivery_date;
    const slot = group.fulfillment?.pickup_delivery_slot ?? order.pickup_delivery_slot;
    const method = group.fulfillment?.delivery_method ?? order.delivery_method;
    const address = group.fulfillment?.delivery_address ?? order.delivery_address;
    const zone = group.fulfillment?.delivery_zone ?? order.delivery_zone;
    if (!date && !method) {
      return (
        <p className="text-sm font-bold uppercase tracking-wide text-foreground">
          {t("Date to be confirmed", "Date à confirmer")}
        </p>
      );
    }
    return (
      <div>
        <p className="text-sm font-bold uppercase tracking-wide text-foreground">
          {deliveryMethodLabel(method) || t("Pickup", "Retrait")}
          {" — "}{formatDateCH(date)}{slot ? ` · ${slot}` : ""}
          {method === "delivery" && zone ? ` (${zone})` : ""}
        </p>
        {method === "delivery" && address && (
          <p className="text-xs text-muted-foreground mt-0.5">{address}</p>
        )}
      </div>
    );
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
            <p className="text-sm text-foreground/75">{itemsSummary(order.order_items, lang) || "—"}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {t("Date", "Date")}: {summaryDateLabel(order, t)} · CHF {formatChf(order.total_amount)}
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
          <div className="border-t border-border/60 p-5 space-y-6 bg-secondary/10">
            {order.order_items.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">
                {t("Item details aren't available for this order.", "Le détail des articles n'est pas disponible pour cette commande.")}
              </p>
            ) : (
              <div className="space-y-6">
                {/* Physical products — the date they're attached to shown
                    ABOVE that date's products, resolved from
                    order_fulfillments + order_items.fulfillment_id (never a
                    date list disconnected from the items at the bottom).
                    Single-date orders get the exact same layout — one
                    group, one header. */}
                {groupItemsByFulfillment(order).map((group, gi) => (
                  <div key={group.fulfillment?.id ?? `group-${gi}`} className="space-y-3">
                    <FulfillmentHeader group={group} order={order} />
                    <div className="space-y-3">
                      {group.items.map((item) => <ItemCard key={item.id} item={item} />)}
                    </div>
                  </div>
                ))}
                {/* Workshops carry their own date (workshop_date), never a
                    fulfillment — kept separate from the pickup/delivery
                    groups above, each card still states its own date. */}
                {order.order_items.filter((i) => i.product === "workshop").length > 0 && (
                  <div className="space-y-3">
                    {order.order_items.filter((i) => i.product === "workshop").map((item) => (
                      <ItemCard key={item.id} item={item} />
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="border-t border-border/60 pt-4 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("Status", "Statut")}</span>
                <span className="text-foreground">{statusLabel(order)}</span>
              </div>
              <div className="flex justify-between font-semibold pt-1">
                <span className="text-foreground">{t("Total", "Total")}</span>
                <span className="text-foreground">CHF {formatChf(order.total_amount)}</span>
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
            ) : isRejectedOrCancelled(order) ? null : (
              <p className="text-xs text-muted-foreground italic">
                {t("Invoice available after order confirmation.", "Facture disponible après confirmation de la commande.")}
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
