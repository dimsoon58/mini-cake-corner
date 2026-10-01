import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { format, addMonths, subMonths } from "date-fns";
import { fr as dateFnsFr } from "date-fns/locale";
import { AlertTriangle, Download, Loader2, Lock, ChevronLeft, ChevronRight, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/admin/AdminLayout";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { isAdminEmail } from "@/lib/adminAccess";
import { extractFunctionErrorMessage } from "@/lib/functionErrors";
import { PRODUCT_LABELS, designLabel } from "@/lib/orderLabels";
import { workshopSessions } from "@/data/workshopSessions";
import { fetchFinanceMonth, type FinanceMonth } from "@/lib/finance";

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
  // A manual refund tied to one specific order_item (order_manual_refunds.
  // order_item_id set) — never repeated/deduped, unlike manualRefundTotal
  // above: each item appears once, so this is simply summed directly.
  itemManualRefundTotal: number;
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
  // The REAL current seat count still reserved (workshop_reservations.
  // active_seats, occupying statuses only) — use this, never
  // workshopParticipants (original purchased count, never decremented by a
  // partial seat cancellation — using it could show more seats reserved
  // than a session's capacity).
  workshopActiveSeats: number;
  // Order-level amounts `total` never includes — delivery fee, express
  // surcharge, and welcome/partner/reward discounts all apply once per
  // ORDER, never per line. Repeated on every entry of a multi-item order
  // (same convention as manualRefundTotal) — dedupe by orderId before
  // adding/subtracting. Matches how orders.total_amount is actually built.
  orderExtras: number;
  orderDiscount: number;
};

const formatChf = (n: number) => n.toLocaleString("fr-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Same "no meaningful design" set as AdminOrder.tsx/cartItemTitle — these
// products have no real design/style choice, so appending one would just
// repeat the product name (or show a raw internal id) for no new info.
const HAS_NO_MEANINGFUL_DESIGN = new Set(["diy_kit", "dot_cakes", "edible_printing", "candles"]);
const productLabel = (e: Pick<DayEntry, "product" | "design" | "workshopType">, t: (en: string, fr: string) => string): string => {
  if (e.product === "workshop") {
    return e.workshopType === "paint" ? t("Paint Workshop", "Workshop Peinture") : t("Signature Workshop", "Workshop Signature");
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
  // Money figures (lot 3): by REAL date of collection / refund, from
  // finance-month — independent of the production stats below, which stay
  // scoped by pickup/delivery date.
  const [finance, setFinance] = useState<FinanceMonth | null>(null);
  const [financeError, setFinanceError] = useState<string | null>(null);
  const [financeLoading, setFinanceLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const monthKey = format(monthCursor, "yyyy-MM");

  useEffect(() => {
    if (authLoading || !isAdmin) return;
    let cancelled = false;
    setFinanceLoading(true);
    setFinanceError(null);
    fetchFinanceMonth(monthKey)
      .then((d) => { if (!cancelled) setFinance(d); })
      .catch((e) => { if (!cancelled) { setFinance(null); setFinanceError(e instanceof Error ? e.message : String(e)); } })
      .finally(() => { if (!cancelled) setFinanceLoading(false); });
    return () => { cancelled = true; };
  }, [monthKey, authLoading, isAdmin]);

  const downloadExcel = async () => {
    if (!finance || exporting) return;
    setExporting(true);
    try {
      const [{ default: ExcelJS }, { buildFinanceWorkbook, financeFileName }] = await Promise.all([
        import("exceljs"),
        import("@/lib/financeExport"),
      ]);
      const wb = buildFinanceWorkbook(ExcelJS, finance);
      const buffer = await wb.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = financeFileName(finance.month);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {
      console.error("Excel export failed:", e);
      setFinanceError(t("The Excel file could not be created. Please try again.", "Le fichier Excel n'a pas pu être créé. Réessayez."));
    } finally {
      setExporting(false);
    }
  };

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
            {t("Your account does not have access to this page.", "Votre compte n'a pas accès à cette page.")}
          </p>
        </main>
      </AdminLayout>
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

  const statusCounts: Record<OrderState, number> = { approved: 0, pending: 0, refused: 0, cancelled: 0 };
  for (const o of orders) statusCounts[o.status] = (statusCounts[o.status] ?? 0) + 1;

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
  // the live booking flow uses). Sums workshopActiveSeats — the REAL
  // current seat count (workshop_reservations.active_seats), not
  // workshopParticipants (the item's original purchased count, never
  // decremented by a partial seat cancellation). 2026-09-19 fix: summing
  // workshopParticipants for every non-cancelled/refused ORDER used to
  // silently ignore a partial cancellation within an otherwise-still-
  // approved order, which could show more seats reserved than a session's
  // actual capacity (e.g. "13/8"). workshopActiveSeats is already 0 for a
  // fully cancelled/rejected reservation, so no extra status filter is
  // needed here — this reads the session catalogue's fixed capacity, not
  // the live get_workshop_availability() seat count a customer sees while
  // booking (a separate, real-time RPC this dashboard doesn't call).
  const reservedBySession = new Map<string, number>();
  for (const e of allEntries) {
    if (!e.workshopSessionId) continue;
    reservedBySession.set(e.workshopSessionId, (reservedBySession.get(e.workshopSessionId) ?? 0) + e.workshopActiveSeats);
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
    <AdminLayout>
      <main className="container mx-auto px-4 py-8 max-w-3xl">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
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

        {/* Money (lot 3) — by REAL date of collection and of refund (Europe/
            Zurich), test orders excluded. Same numbers as the Excel file. */}
        <section className="space-y-3 mb-8" data-testid="finance">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="font-sans text-[12px] tracking-[0.105em] uppercase font-semibold text-foreground">{t("Money", "Argent")}</h2>
              <p className="text-xs text-muted-foreground">
                {t("By actual date of payment and of refund · test orders excluded.", "Par date réelle d'encaissement et de remboursement · commandes de test exclues.")}
              </p>
            </div>
            <Button variant="outline" className="rounded-none" onClick={downloadExcel} disabled={!finance || exporting || financeLoading}>
              {exporting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Download className="w-4 h-4 mr-1" />}
              {t("Download Excel", "Télécharger Excel")}
            </Button>
          </div>
          {financeLoading && !finance ? (
            <div className="py-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" /></div>
          ) : financeError && !finance ? (
            <p className="text-sm border border-amber-300 bg-amber-50 text-amber-900 px-4 py-3">{financeError}</p>
          ) : finance ? (
            <>
              {financeError && <p className="text-sm border border-amber-300 bg-amber-50 text-amber-900 px-4 py-3">{financeError}</p>}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {[
                  { k: "collected", label: t("Collected", "Encaissé"), v: finance.cards.collected, n: finance.cards.collectedCount, hint: t("orders paid this month", "commande(s) payée(s) ce mois") },
                  { k: "refunded", label: t("Refunded", "Remboursé"), v: finance.cards.refunded, n: finance.cards.refundedCount, hint: t("refunds made this month", "remboursement(s) fait(s) ce mois") },
                  { k: "net", label: t("Net", "Net"), v: finance.cards.net, strong: true, hint: t("collected − refunded", "encaissé − remboursé") },
                  { k: "toCollect", label: t("To collect", "À encaisser"), v: finance.cards.toCollect, n: finance.cards.toCollectCount, hint: t("today, all months", "aujourd'hui, tous mois") },
                  { k: "remaining", label: t("Left to refund", "Reste à rembourser"), v: finance.cards.remainingToRefund, n: finance.cards.remainingCount, hint: t("today, all months", "aujourd'hui, tous mois"), href: "/admin/refunds?tab=todo" },
                ].map((c) => {
                  const body = (
                    <>
                      <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{c.label}</span>
                      <span className={`block tabular-nums ${c.strong ? "text-2xl font-bold" : "text-xl font-semibold"}`}>CHF {formatChf(Number(c.v) || 0)}</span>
                      <span className="block text-[11px] text-muted-foreground">{c.n != null ? `${c.n} · ` : ""}{c.hint}</span>
                    </>
                  );
                  const cls = `block px-4 py-3 border ${c.strong ? "border-primary/40 bg-primary/5" : "border-border/60 bg-background"}`;
                  return c.href
                    ? <Link key={c.k} to={c.href} data-k={c.k} className={`${cls} hover:bg-secondary/40`}>{body}</Link>
                    : <div key={c.k} data-k={c.k} className={cls}>{body}</div>;
                })}
                <div className="px-4 py-3 border border-border/60 bg-background" data-k="origin">
                  <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("Collected by channel", "Encaissé par canal")}</span>
                  <span className="flex justify-between text-sm tabular-nums"><span>{t("Website", "Site")} ({finance.cards.byOrigin.website.count})</span><span>CHF {formatChf(Number(finance.cards.byOrigin.website.collected) || 0)}</span></span>
                  <span className="flex justify-between text-sm tabular-nums"><span>{t("Manual", "Manuel")} ({finance.cards.byOrigin.manual.count})</span><span>CHF {formatChf(Number(finance.cards.byOrigin.manual.collected) || 0)}</span></span>
                </div>
              </div>
              {(finance.cards.undatedCount > 0 || finance.cards.toReviewCount > 0) && (
                <div className="space-y-1.5">
                  {finance.cards.undatedCount > 0 && (
                    <Link to="/admin/refunds" className="flex gap-2 text-xs bg-amber-50 border border-amber-200 text-amber-900 px-3 py-2 hover:bg-amber-100">
                      <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                      {t(`${finance.cards.undatedCount} refund(s) without a date (CHF ${formatChf(Number(finance.cards.undated) || 0)}) — not included in any month until dated.`,
                        `${finance.cards.undatedCount} remboursement(s) à dater (CHF ${formatChf(Number(finance.cards.undated) || 0)}) — inclus dans aucun mois tant qu'ils ne sont pas datés.`)}
                    </Link>
                  )}
                  {finance.cards.toReviewCount > 0 && (
                    <Link to="/admin/refunds?tab=review" className="flex gap-2 text-xs bg-amber-50 border border-amber-200 text-amber-900 px-3 py-2 hover:bg-amber-100">
                      <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                      {t(`${finance.cards.toReviewCount} refund(s) to check (CHF ${formatChf(Number(finance.cards.toReview) || 0)}) — not counted.`,
                        `${finance.cards.toReviewCount} remboursement(s) à vérifier (CHF ${formatChf(Number(finance.cards.toReview) || 0)}) — non comptés.`)}
                    </Link>
                  )}
                </div>
              )}
            </>
          ) : null}
        </section>

        {loading ? (
          <div className="text-center py-16">
            <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
          </div>
        ) : loadError ? (
          <p className="text-center text-muted-foreground py-16">{loadError}</p>
        ) : (
          <div className="space-y-4">
            <div className="pt-2">
              <h2 className="font-sans text-[12px] tracking-[0.105em] uppercase font-semibold text-foreground">{t("Production", "Production")}</h2>
              <p className="text-xs text-muted-foreground">
                {t(
                  "By pickup/delivery date — an order counts in the month its cake or workshop actually happens.",
                  "Par date de retrait/livraison — une commande compte dans le mois où le gâteau ou l'atelier a vraiment lieu."
                )}
              </p>
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
                    const sessionLabel = s.workshopType === "paint" ? t("Paint Workshop", "Workshop Peinture") : t("Signature Workshop", "Workshop Signature");
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
    </AdminLayout>
  );
};

export default AdminDashboard;
