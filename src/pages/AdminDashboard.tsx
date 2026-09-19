import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { format, addMonths, subMonths } from "date-fns";
import { fr as dateFnsFr } from "date-fns/locale";
import { Loader2, Lock, ChevronLeft, ChevronRight, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { isAdminEmail } from "@/lib/adminAccess";
import { extractFunctionErrorMessage } from "@/lib/functionErrors";
import { PRODUCT_LABELS, designLabel } from "@/lib/orderLabels";
import { workshopSessions } from "@/data/workshopSessions";

type OrderState = "approved" | "pending" | "refused" | "cancelled";
type DayEntry = {
  orderId: string;
  orderNumber: string | null;
  orderSource: string | null;
  status: OrderState;
  total: number | null;
  paymentStatus: string | null;
  refundStatus: string | null;
  // Sum of order_manual_refunds for this order (repeated on every entry of
  // a multi-item order — see list-orders-by-date's own comment). Ad-hoc
  // refunds the admin records by hand, on top of refundStatus above.
  manualRefundTotal: number;
  // A partial workshop-seat refund (workshop_reservations.refunded_amount)
  // — per ITEM, never repeated across a multi-item order's other entries.
  workshopRefundedAmount: number;
  // Added for the top-products list below.
  product: string;
  design: string | null;
  workshopType: string | null;
  // Added for the workshop fill-rate card below.
  workshopSessionId: string | null;
  workshopParticipants: number | null;
};

const formatChf = (n: number) => n.toLocaleString("fr-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Same detection convention as AdminOrders.tsx's isManualOrder — order_number's
// "ORDM-" prefix is the PRIMARY, unambiguous signal (minted at creation by
// the Make scenario "Bento — Commandes manuelles instantanées" and never
// changed afterward); order_source is checked as a fallback only.
const isManualOrder = (e: Pick<DayEntry, "orderNumber" | "orderSource">): boolean =>
  !!e.orderNumber?.startsWith("ORDM-") || (!!e.orderSource && e.orderSource !== "website");

// Same "no meaningful design" set as AdminOrder.tsx/cartItemTitle — these
// products have no real design/style choice, so appending one would just
// repeat the product name (or show a raw internal id) for no new info.
const HAS_NO_MEANINGFUL_DESIGN = new Set(["diy_kit", "dot_cakes", "edible_printing", "candles"]);
const productLabel = (e: Pick<DayEntry, "product" | "design" | "workshopType">, t: (en: string, fr: string) => string): string => {
  if (e.product === "workshop") {
    return e.workshopType === "paint" ? t("Paint Workshop", "Atelier Peinture") : t("Signature Workshop", "Atelier Signature");
  }
  const base = PRODUCT_LABELS[e.product] ? t(PRODUCT_LABELS[e.product].en, PRODUCT_LABELS[e.product].fr) : e.product;
  if (HAS_NO_MEANINGFUL_DESIGN.has(e.product) || !e.design) return base;
  return `${base} — ${designLabel(e.design)}`;
};

const statusBadgeClass = (status: OrderState) =>
  status === "approved" ? "bg-emerald-100 text-emerald-800" :
  status === "pending" ? "bg-amber-100 text-amber-800" :
  status === "refused" ? "bg-red-100 text-red-800" :
  "bg-muted text-muted-foreground";

const AdminDashboard = () => {
  const { t, lang } = useLang();
  const { user, loading: authLoading } = useAuth();
  const isAdmin = isAdminEmail(user?.email);
  const dfLocale = lang === "fr" ? { locale: dateFnsFr } : undefined;

  const [monthCursor, setMonthCursor] = useState(() => new Date());
  const [days, setDays] = useState<Record<string, DayEntry[]>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Admin – Dashboard – Bento Cake Studio";
    return () => { document.title = "Bento Cake Studio Geneva"; };
  }, []);

  useEffect(() => {
    if (authLoading || !isAdmin) { setLoading(authLoading); return; }
    let cancelled = false;
    const fetchMonth = async () => {
      setLoading(true);
      setLoadError(null);
      // Reuses list-orders-by-date (already resolves each item's own
      // pickup/delivery date correctly for a multi-date order, and the
      // customer explicitly wants this dashboard scoped by pickup/delivery
      // date, not order-creation date) — no separate backend endpoint.
      const { data, error } = await supabase.functions.invoke("list-orders-by-date", {
        body: { year: monthCursor.getFullYear(), month: monthCursor.getMonth() + 1 },
      });
      if (cancelled) return;
      if (error) {
        const reason = await extractFunctionErrorMessage(error, "");
        console.error("list-orders-by-date failed:", reason || error);
        setLoadError(
          reason === "Admin sign-in required"
            ? t("Your admin session could not be verified. Please sign out and sign in again.", "Votre session administrateur n'a pas pu être vérifiée. Merci de vous déconnecter puis de vous reconnecter.")
            : t("Could not load the dashboard. Please try again.", "Impossible de charger le tableau de bord. Merci de réessayer.")
        );
      } else if (data?.error) {
        console.error("list-orders-by-date failed:", data.error);
        setLoadError(t("Could not load the dashboard. Please try again.", "Impossible de charger le tableau de bord. Merci de réessayer."));
      } else {
        setDays(data.days ?? {});
      }
      setLoading(false);
    };
    fetchMonth();
    return () => { cancelled = true; };
  }, [monthCursor, authLoading, isAdmin, t]);

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
            {t("Your account does not have access to this page.", "Votre compte n'a pas accès à cette page.")}
          </p>
        </main>
      </Layout>
    );
  }

  // Flatten to one row per ORDER (not per item) for counts/status — an
  // order with several items must only count once. Revenue itself sums
  // per-item (below), which is correct: each item's own value contributes
  // to whichever month its own pickup/delivery date falls in.
  const allEntries = Object.values(days).flat();
  const orderById = new Map<string, DayEntry>();
  for (const e of allEntries) orderById.set(e.orderId, e);
  const orders = Array.from(orderById.values());

  // "Real" revenue: money actually kept. paymentStatus==='paid' alone is
  // NOT enough — an already-paid order that was later cancelled keeps
  // payment_status='paid' (cancel-order only flips refund_status, never
  // payment_status, for the ordinary case), so refundStatus must also be
  // excluded whenever it's 'to_refund' or 'refunded'. On top of that, an
  // order can be ad-hoc manually refunded (in full or in part, for any
  // reason) without ever going through cancel-order at all — order_manual_
  // refunds (recorded on AdminOrder.tsx) tracks the REAL amount for that
  // case, subtracted here once per order (not per item — manualRefundTotal
  // is the same value on every entry of a multi-item order). A PARTIAL
  // workshop-seat refund is subtracted separately (workshopRefundedAmount,
  // workshop_reservations.refunded_amount) — per ITEM, not deduped by order,
  // since each workshop booking has its own reservation and its own
  // refunded amount, independent of any sibling cake item on the same order.
  const grossPaidRevenue = allEntries
    .filter((e) => e.paymentStatus === "paid" && e.refundStatus !== "to_refund" && e.refundStatus !== "refunded")
    .reduce((sum, e) => sum + (e.total ?? 0), 0);
  const manualRefundTotal = orders.reduce((sum, o) => sum + (o.manualRefundTotal || 0), 0);
  const workshopRefundedTotal = allEntries.reduce((sum, e) => sum + (e.workshopRefundedAmount || 0), 0);
  const revenue = grossPaidRevenue - manualRefundTotal - workshopRefundedTotal;
  const refundedAmount = allEntries
    .filter((e) => e.refundStatus === "to_refund" || e.refundStatus === "refunded")
    .reduce((sum, e) => sum + (e.total ?? 0), 0) + manualRefundTotal + workshopRefundedTotal;
  const pendingPaymentAmount = allEntries
    .filter((e) => e.paymentStatus === "pending")
    .reduce((sum, e) => sum + (e.total ?? 0), 0);

  const statusCounts: Record<OrderState, number> = { approved: 0, pending: 0, refused: 0, cancelled: 0 };
  for (const o of orders) statusCounts[o.status] = (statusCounts[o.status] ?? 0) + 1;

  // Manual vs website split — counts (deduped by order, same as statusCounts
  // above) and each side's share of gross paid revenue (before the manual-
  // refund deduction above, kept simple/consistent with how the split is
  // normally read: "how much did each channel bring in", not net of a later
  // refund that isn't tied to one channel more than the other).
  const manualOrders = orders.filter(isManualOrder);
  const websiteOrders = orders.filter((o) => !isManualOrder(o));
  const revenueBySource = (list: DayEntry[]) =>
    allEntries
      .filter((e) => list.some((o) => o.orderId === e.orderId) && e.paymentStatus === "paid" && e.refundStatus !== "to_refund" && e.refundStatus !== "refunded")
      .reduce((sum, e) => sum + (e.total ?? 0), 0);
  const manualRevenue = revenueBySource(manualOrders);
  const websiteRevenue = revenueBySource(websiteOrders);

  // Top products — counted per ITEM (not deduped by order): each cake or
  // workshop booking sold is one unit, so a 2-cake order counts as 2 here,
  // unlike the order-level counts above. Cancelled/refused items still
  // count as "sold" (this answers "what did we make", not "what stuck") —
  // matches how the revenue/status cards already separate those concerns.
  const productCounts = new Map<string, number>();
  for (const e of allEntries) {
    const label = productLabel(e, t);
    productCounts.set(label, (productCounts.get(label) ?? 0) + 1);
  }
  const topProducts = Array.from(productCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  // Workshop fill rate — sessions scheduled in the selected month, reserved
  // seats vs capacity (src/data/workshopSessions.ts — the same catalogue
  // the live booking flow uses). A cancelled/refused booking frees its
  // seat, so it's excluded from "reserved" here — this reads the session
  // catalogue's fixed capacity, not the live get_workshop_availability()
  // seat count a customer sees while booking (a separate, real-time RPC
  // this dashboard doesn't call).
  const reservedBySession = new Map<string, number>();
  for (const e of allEntries) {
    if (!e.workshopSessionId || e.status === "cancelled" || e.status === "refused") continue;
    reservedBySession.set(e.workshopSessionId, (reservedBySession.get(e.workshopSessionId) ?? 0) + (e.workshopParticipants ?? 0));
  }
  const cursorYear = monthCursor.getFullYear();
  const cursorMonth = monthCursor.getMonth() + 1;
  // Real wall-clock "today" (not monthCursor) — used to tag each session as
  // Past/Upcoming below, independent of which month is currently browsed.
  const now = new Date();
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const sessionsThisMonth = workshopSessions
    .filter((s) => {
      const [y, m] = s.date.split("-").map(Number);
      return y === cursorYear && m === cursorMonth;
    })
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

  const statusLabel = (s: OrderState) =>
    s === "approved" ? t("Approved", "Acceptées") :
    s === "pending" ? t("Pending", "En attente") :
    s === "refused" ? t("Refused", "Refusées") :
    t("Cancelled", "Annulées");

  return (
    <Layout>
      <main className="container mx-auto px-4 py-8 max-w-3xl">
        <div className="flex items-center justify-center gap-4 mb-4 text-[11px] uppercase tracking-[0.105em]">
          <Link to="/admin/orders" className="text-muted-foreground hover:text-foreground">{t("Orders", "Commandes")}</Link>
          <Link to="/admin/calendar" className="text-muted-foreground hover:text-foreground">{t("Calendar", "Calendrier")}</Link>
          <span className="text-foreground font-semibold">{t("Dashboard", "Tableau de bord")}</span>
        </div>
        <div className="flex items-center justify-between mb-6">
          <h1 className="font-sans uppercase tracking-[0.105em] text-2xl text-foreground flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-primary" strokeWidth={1.5} />
            {t("Dashboard", "Tableau de bord")}
          </h1>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" className="rounded-none h-8 w-8" onClick={() => setMonthCursor((d) => subMonths(d, 1))}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="font-sans text-sm uppercase tracking-[0.105em] text-foreground min-w-[120px] text-center">
              {format(monthCursor, "MMMM yyyy", dfLocale)}
            </span>
            <Button variant="outline" size="icon" className="rounded-none h-8 w-8" onClick={() => setMonthCursor((d) => addMonths(d, 1))}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-16">
            <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
          </div>
        ) : loadError ? (
          <p className="text-center text-muted-foreground py-16">{loadError}</p>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              {t(
                "Scoped by pickup/delivery date — an order counts in the month its cake or workshop actually happens, not the month it was placed.",
                "Basé sur la date de retrait/livraison — une commande compte dans le mois où le gâteau ou l'atelier a vraiment lieu, pas dans le mois où elle a été passée."
              )}
            </p>

            {/* Revenue card */}
            <div className="border border-border/60 bg-background p-6">
              <p className="font-sans text-[11px] tracking-[0.105em] uppercase text-muted-foreground mb-1">
                {t("Revenue this month", "Chiffre d'affaires du mois")}
              </p>
              <p className="font-sans text-3xl font-bold text-foreground">CHF {formatChf(revenue)}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {t(
                  "Paid orders only, minus anything refunded, to be refunded, manually recorded as refunded, or partially refunded on a workshop seat.",
                  "Commandes payées uniquement, hors remboursées, à rembourser, remboursées manuellement, ou partiellement remboursées sur une place d'atelier."
                )}
              </p>
              {(pendingPaymentAmount > 0 || refundedAmount > 0) && (
                <div className="flex gap-4 mt-3 pt-3 border-t border-border/60 text-xs text-muted-foreground">
                  {pendingPaymentAmount > 0 && <span>{t("Payment pending:", "Paiement en attente :")} CHF {formatChf(pendingPaymentAmount)}</span>}
                  {refundedAmount > 0 && <span>{t("Refunded / to refund:", "Remboursé / à rembourser :")} CHF {formatChf(refundedAmount)}</span>}
                </div>
              )}
            </div>

            {/* Status breakdown card */}
            <div className="border border-border/60 bg-background p-6">
              <p className="font-sans text-[11px] tracking-[0.105em] uppercase text-muted-foreground mb-3">
                {t("Orders by status", "Commandes par statut")} ({orders.length})
              </p>
              <div className="grid grid-cols-2 gap-3">
                {(Object.keys(statusCounts) as OrderState[]).map((s) => (
                  <div key={s} className="flex items-center justify-between px-3 py-2 bg-muted/30">
                    <span className={`text-[11px] uppercase tracking-[0.105em] px-2 py-0.5 shrink-0 ${statusBadgeClass(s)}`}>
                      {statusLabel(s)}
                    </span>
                    <span className="font-bold text-foreground">{statusCounts[s]}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Manual vs website split card */}
            <div className="border border-border/60 bg-background p-6">
              <p className="font-sans text-[11px] tracking-[0.105em] uppercase text-muted-foreground mb-3">
                {t("Manual vs website", "Manuel vs site")}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center justify-between px-3 py-2 bg-muted/30">
                  <div>
                    <span className="text-[11px] uppercase tracking-[0.105em] px-2 py-0.5 shrink-0 bg-secondary text-secondary-foreground">
                      {t("Website", "Site")}
                    </span>
                    <p className="text-xs text-muted-foreground mt-1">CHF {formatChf(websiteRevenue)}</p>
                  </div>
                  <span className="font-bold text-foreground">{websiteOrders.length}</span>
                </div>
                <div className="flex items-center justify-between px-3 py-2 bg-muted/30">
                  <div>
                    <span className="text-[11px] uppercase tracking-[0.105em] px-2 py-0.5 shrink-0 bg-blue-100 text-blue-800">
                      {t("Manual", "Manuel")}
                    </span>
                    <p className="text-xs text-muted-foreground mt-1">CHF {formatChf(manualRevenue)}</p>
                  </div>
                  <span className="font-bold text-foreground">{manualOrders.length}</span>
                </div>
              </div>
            </div>

            {/* Top products card */}
            {topProducts.length > 0 && (
              <div className="border border-border/60 bg-background p-6">
                <p className="font-sans text-[11px] tracking-[0.105em] uppercase text-muted-foreground mb-3">
                  {t("Top products", "Produits les plus vendus")}
                </p>
                <div className="space-y-1.5">
                  {topProducts.map(([label, count]) => (
                    <div key={label} className="flex items-center justify-between text-sm px-3 py-1.5 bg-muted/30">
                      <span className="text-foreground truncate">{label}</span>
                      <span className="font-bold text-foreground shrink-0 ml-3">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Workshop fill-rate card */}
            {sessionsThisMonth.length > 0 && (
              <div className="border border-border/60 bg-background p-6">
                <p className="font-sans text-[11px] tracking-[0.105em] uppercase text-muted-foreground mb-3">
                  {t("Workshop fill rate", "Taux de remplissage des ateliers")}
                </p>
                <div className="space-y-3">
                  {sessionsThisMonth.map((s) => {
                    const reserved = reservedBySession.get(s.id) ?? 0;
                    const available = Math.max(0, s.capacity - reserved);
                    const pct = Math.min(100, Math.round((reserved / s.capacity) * 100));
                    const sessionLabel = s.workshopType === "paint" ? t("Paint Workshop", "Atelier Peinture") : t("Signature Workshop", "Atelier Signature");
                    // Compared against TODAY (real wall-clock date, not
                    // monthCursor) — a session earlier in the currently
                    // viewed month can still be in the future, and vice
                    // versa, so this is checked per-session, not per-month.
                    const isPast = s.date < todayIso;
                    return (
                      <div key={s.id} className="text-sm">
                        <div className="flex items-center justify-between mb-1 gap-3">
                          <span className="text-foreground truncate flex items-center gap-2">
                            <span className={`text-[10px] uppercase tracking-[0.1em] px-1.5 py-0.5 shrink-0 ${isPast ? "bg-muted text-muted-foreground" : "bg-emerald-100 text-emerald-800"}`}>
                              {isPast ? t("Past", "Passé") : t("Upcoming", "À venir")}
                            </span>
                            <span className="truncate">
                              {sessionLabel} — {new Date(`${s.date}T00:00:00`).toLocaleDateString(lang === "fr" ? "fr-CH" : "en-CH")} {s.time}
                            </span>
                          </span>
                          <span className="font-bold text-foreground shrink-0">{reserved}/{s.capacity}</span>
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {t(`${reserved} taken, ${available} available`, `${reserved} prises, ${available} disponibles`)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </Layout>
  );
};

export default AdminDashboard;
