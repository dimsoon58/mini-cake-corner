import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { fr as frLocale } from "date-fns/locale";
import { AlertTriangle, Cherry, Flame, Loader2, Lock, Plus, RefreshCw, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/admin/AdminLayout";
import { ShowTestsToggle, useShowTests } from "@/components/admin/ShowTestsToggle";
import { WorkshopSessionsPanel, type WorkshopSession } from "@/components/admin/WorkshopSessionsPanel";
import { ProductionCheck, isProductionDone } from "@/components/admin/ProductionCheck";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { isAdminEmail } from "@/lib/adminAccess";
import { useStaffRole } from "@/lib/staff";
import { extractFunctionErrorMessage } from "@/lib/functionErrors";
import { PRODUCT_LABELS, flavorLabel, shapeLabel, sizeLabel } from "@/lib/orderLabels";
import { formatChf } from "@/lib/manualOrders";
import { useScrollMemory } from "@/hooks/useScrollMemory";
import { cn } from "@/lib/utils";

type ListedOrder = { orderId: string; orderNumber: string | null; customerName: string; total: number; date: string | null; receivedAt?: string | null };
type DayItem = {
  type: "cake" | "workshop";
  orderId: string;
  itemId: string;
  orderNumber: string | null;
  customerName: string;
  product: string;
  size: string | null;
  shape: string | null;
  flavors: string[] | null;
  workshopType: string | null;
  participants: number | null;
  slot: string | null;
  deliveryMethod: string | null;
  deliveryCity: string | null;
  productionStatus: string | null;
  badge: "to_accept" | "awaiting_payment" | null;
  quantity?: number;
  // Sent by get-today once redeployed (absent before: no badge).
  candleName?: string | null;
  candleQuantity?: number | null;
  fruits?: boolean; // supplément fruits (commande manuelle)
};
type Alert = { orderId: string; orderNumber: string | null; issueType: string; detail: string | null; createdAt: string };
type TodayData = { today: string; tomorrow: string; from?: string; to?: string; toDecide: ListedOrder[]; toCollect: ListedOrder[]; days: Record<string, DayItem[]>; alerts: Alert[] };

const MAX_RANGE_DAYS = 31;
const DEFAULT_EXTRA_DAYS = 2;
// « Livraisons à venir » looks this many days ahead, whatever the period.
const DELIVERY_LOOKAHEAD_DAYS = 14;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const zurichTodayISO = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);

const ALERT_LABELS: Record<string, { en: string; fr: string }> = {
  PAIEMENT_SANS_REFERENCE: { en: "Paid without a PostFinance reference", fr: "Payée sans référence PostFinance" },
  SYNCHRO_NOTION: { en: "Notion sync late", fr: "Synchronisation Notion en retard" },
  COMMANDE_SANS_ARTICLE: { en: "Order without items", fr: "Commande sans article" },
  PAIEMENT_PENDING_RESIDUEL: { en: "Payment left pending", fr: "Paiement resté en attente" },
  EMAIL_MANUEL_EN_ERREUR: { en: "Confirmation email failed", fr: "E-mail de confirmation en erreur" },
  ECHEC_COMMANDE_NON_RESOLU: { en: "Unresolved order failure", fr: "Échec de commande non résolu" },
};

const AdminToday = () => {
  const { t, lang } = useLang();
  const l = lang === "en" ? "en" : "fr";
  const { user, loading: authLoading } = useAuth();
  const staff = useStaffRole();
  const employee = staff.isEmployee;
  const isAdmin = isAdminEmail(user?.email) || staff.can("today.view");

  const [data, setData] = useState<TodayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
<<<<<<< HEAD
=======
  // Upcoming deliveries (today → +14 days), to book the courier in time.
  const [upcoming, setUpcoming] = useState<Record<string, DayItem[]> | null>(null);
  // Commandes de test masquées sauf avec « Afficher les tests » (get-today).
>>>>>>> a42b08817d2cd14f870dc2782a564fe62fbabb5a
  const [includeTests, setIncludeTests] = useShowTests();
  const [ws, setWs] = useState<{ sessions: WorkshopSession[]; stockRows: { sponge_base: string; product_category: string; quantity: number }[] } | null>(null);

  const [searchParams, setSearchParams] = useSearchParams();
  const zToday = zurichTodayISO();
  const from = searchParams.get("from") ?? zToday;
  const to = searchParams.get("to") ?? addDays(zToday, DEFAULT_EXTRA_DAYS);
  const rangeError = !ISO_RE.test(from) || !ISO_RE.test(to) || Number.isNaN(daysBetween(from, to))
    ? t("Choose a start and an end date.", "Choisissez une date de début et une date de fin.")
    : to < from
      ? t("The end date must be on or after the start date.", "La date de fin doit être après la date de début.")
      : daysBetween(from, to) + 1 > MAX_RANGE_DAYS
        ? t(`The period is limited to ${MAX_RANGE_DAYS} days.`, `La période est limitée à ${MAX_RANGE_DAYS} jours.`)
        : null;
  // Filter kept in the URL too (?vue=), so « Retour » from an order comes back to it.
  const vue = searchParams.get("vue");
  const filter: Filter = vue === "todo" || vue === "ready" ? vue : "all";
  const setFilter = (next: Filter) => {
    const p = new URLSearchParams(searchParams);
    if (next === "all") p.delete("vue"); else p.set("vue", next);
    setSearchParams(p, { replace: true });
  };
  const setPeriod = (next: { from?: string; to?: string } | null) => {
    const p = new URLSearchParams(searchParams);
    if (!next) { p.delete("from"); p.delete("to"); } else {
      p.set("from", next.from ?? from);
      p.set("to", next.to ?? to);
    }
    setSearchParams(p, { replace: true });
  };

  const setItemStatus = (itemId: string, status: string) =>
    setData((d) => d && ({
      ...d,
      days: Object.fromEntries(Object.entries(d.days).map(([day, items]) => [
        day, items.map((it) => (it.itemId === itemId ? { ...it, productionStatus: status } : it)),
      ])),
    }));

  useEffect(() => {
    document.title = "Admin – Aujourd'hui – Bento Cake Studio";
    return () => { document.title = "Bento Cake Studio Geneva"; };
  }, []);

  const load = useCallback(async () => {
    if (rangeError) return;
    setLoading(true);
    setError(null);
    try {
      const { data: res, error: fnError } = await supabase.functions.invoke("get-today", { body: { from, to, includeTests } });
      if (fnError || res?.error) {
        const status = (fnError as { context?: Response } | null)?.context?.status;
        const reason = fnError ? await extractFunctionErrorMessage(fnError, "") : String(res.error);
        console.error("get-today failed:", status, reason);
        setError(status === 404
          ? t("This screen will work as soon as the get-today function is deployed.", "Cet écran fonctionnera dès que la fonction get-today sera déployée.")
          : t("Could not load today's overview. Please try again.", "Impossible de charger l'écran du jour. Réessayez."));
        return;
      }
      setData(res as TodayData);
<<<<<<< HEAD
=======
      // Livraisons à venir : same function, fixed 14-day window from today.
      try {
        const { data: up, error: uErr } = await supabase.functions.invoke("get-today", {
          body: { from: zToday, to: addDays(zToday, DELIVERY_LOOKAHEAD_DAYS - 1), includeTests },
        });
        setUpcoming(!uErr && !up?.error && up?.from ? (up as TodayData).days : null);
      } catch { setUpcoming(null); }
      // Sessions de workshop (get-production) : sans accès ou pas encore déployé → bloc absent.
>>>>>>> a42b08817d2cd14f870dc2782a564fe62fbabb5a
      try {
        const { data: prod, error: pErr } = await supabase.functions.invoke("get-production", { body: { from, to, includeTests } });
        setWs(!pErr && !prod?.error ? { sessions: prod?.workshopSessions ?? [], stockRows: prod?.stockRows ?? [] } : null);
      } catch { setWs(null); }
    } catch (e) {
      console.error("get-today threw:", e);
      setError(t("Could not load today's overview. Please try again.", "Impossible de charger l'écran du jour. Réessayez."));
    } finally {
      setLoading(false);
    }
  }, [t, from, to, includeTests, rangeError, zToday]);

  useEffect(() => {
    if (!authLoading && !staff.loading && isAdmin) load();
  }, [authLoading, staff.loading, isAdmin, load]);

  const { hash } = useLocation();
  const hasData = !!data;
  // « Retour » from an order: back at the same place in the list.
  useScrollMemory("today", hasData && !loading && !hash);
  useEffect(() => {
    if (!hasData || !hash) return;
    document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [hasData, hash]);

  if (authLoading || staff.loading) {
    return (
      <AdminLayout>
        <main className="container mx-auto px-4 py-16 text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
        </main>
      </AdminLayout>
    );
  }
  if (!user || !isAdmin) {
    return (
      <AdminLayout>
        <main className="max-w-md mx-auto px-6 py-24 text-center">
          <Lock className="w-8 h-8 mx-auto text-muted-foreground mb-4" />
          <h1 className="font-sans uppercase tracking-[0.105em] text-2xl text-foreground mb-4">
            {!user ? t("Admin sign-in required", "Connexion administrateur requise") : t("Access denied", "Accès refusé")}
          </h1>
          {!user && (
            <Button asChild className="rounded-none bg-primary hover:bg-primary/90 text-primary-foreground uppercase tracking-[0.105em] text-[13px] font-medium">
              <Link to={`/login?redirect=${encodeURIComponent(window.location.pathname)}`}>{t("Sign in", "Se connecter")}</Link>
            </Button>
          )}
        </main>
      </AdminLayout>
    );
  }

  const dayLabel = (iso: string) => {
    try {
      return format(parseISO(iso), l === "fr" ? "EEEE d MMMM" : "EEEE, MMMM d", l === "fr" ? { locale: frLocale } : undefined);
    } catch { return iso; }
  };
  const waitingFor = (iso: string | null | undefined) => {
    if (!iso) return null;
    const hours = Math.max(0, (Date.now() - new Date(iso).getTime()) / 3_600_000);
    if (hours < 1) return { text: t("received < 1 h ago", "reçue il y a moins d'1 h"), late: false };
    if (hours < 24) return { text: t(`received ${Math.floor(hours)} h ago`, `reçue il y a ${Math.floor(hours)} h`), late: false };
    const days = Math.floor(hours / 24);
    return { text: t(`waiting for ${days} day${days > 1 ? "s" : ""}`, `en attente depuis ${days} jour${days > 1 ? "s" : ""}`), late: true };
  };
  const shortDate = (iso: string | null) => {
    if (!iso) return t("no date", "sans date");
    try { return format(parseISO(iso), l === "fr" ? "EEE d MMM" : "EEE, MMM d", l === "fr" ? { locale: frLocale } : undefined); } catch { return iso; }
  };

  const itemTitle = (it: DayItem) => {
    if (it.type === "workshop") {
      const kind = it.workshopType === "paint" ? t("Paint workshop", "Workshop Peinture") : t("Signature workshop", "Workshop Signature");
      return `${kind} · ${it.participants ?? 0} ${t("seat(s)", "place(s)")}`; 
    }
    const product = t(PRODUCT_LABELS[it.product]?.en ?? it.product, PRODUCT_LABELS[it.product]?.fr ?? it.product);
    const parts = [product];
    if (it.size && it.product !== "diy_kit" && it.product !== "edible_printing") parts.push(sizeLabel(it.size, l));
    if (it.shape && it.shape !== "round") parts.push(shapeLabel(it.shape, l));
    if (it.flavors?.length) parts.push(flavorLabel(it.flavors.join(",")));
    return `${it.quantity && it.quantity > 1 ? `${it.quantity} × ` : ""}${parts.join(" · ")}`;
  };
  const methodLabel = (it: DayItem) =>
    it.type === "workshop"
      ? t("Workshop", "Atelier")
      : it.deliveryMethod === "delivery"
        ? `${t("Delivery", "Livraison")}${it.deliveryCity ? ` ${it.deliveryCity}` : ""}`
        : t("Pickup", "Retrait");

  const today = data?.today ?? zToday;
  const periodSupported = !!data?.from;
  const periodDates = data ? Object.keys(data.days).sort() : [];
  const allItems = periodDates.flatMap((d) => data!.days[d]);
  const qtyOf = (i: DayItem) => (i.quantity && i.quantity > 1 ? i.quantity : 1);
  const sumQty = (list: DayItem[]) => list.reduce((s, i) => s + qtyOf(i), 0);
  const periodCakes = allItems.filter((i) => i.type === "cake" && i.badge !== "to_accept");
  const totalCakes = sumQty(periodCakes);
  const workshopDates = periodDates.filter((d) => data!.days[d].some((i) => i.type === "workshop"));

<<<<<<< HEAD
=======
  // Badges that must never be missed: delivery (courier to book) and candles.
  const deliveryBadge = "inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide bg-sky-700 text-white";
  const candleBadge = "inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold bg-yellow-300 text-yellow-950 border border-yellow-500";
  const fruitBadge = "inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold bg-rose-200 text-rose-950 border border-rose-400";
  const candleText = (it: DayItem) => {
    if (it.product === "candles") return t("Candles", "Bougies");
    if (!it.candleName) return null;
    return `${t("Candles", "Bougies")} : ${it.candleName}${it.candleQuantity && it.candleQuantity > 1 && !/×\s*\d/.test(it.candleName) ? ` ×${it.candleQuantity}` : ""}`;
  };

  // Upcoming deliveries, one line per order and date (several cakes of the
  // same delivery are grouped).
  const upcomingDeliveries = upcoming
    ? Object.keys(upcoming).sort().flatMap((date) => {
        const seen = new Map<string, { date: string; it: DayItem; cakes: number }>();
        for (const it of upcoming[date]) {
          if (it.type !== "cake" || it.deliveryMethod !== "delivery") continue;
          const prev = seen.get(it.orderId);
          if (prev) prev.cakes += qtyOf(it); else seen.set(it.orderId, { date, it, cakes: qtyOf(it) });
        }
        return [...seen.values()].sort((a, b) => (a.it.slot ?? "99").localeCompare(b.it.slot ?? "99"));
      })
    : null;

  const itemLink = (it: DayItem, done: boolean) => (
    <Link to={`/admin/order/${it.orderId}`} className={cn("flex-1 min-w-0 flex flex-wrap items-center gap-x-3 gap-y-1 pr-4 py-3 hover:bg-secondary/40", done && "opacity-60")}>
      <span className="w-28 shrink-0 text-sm tabular-nums text-muted-foreground">{it.slot || t("No time slot", "Sans créneau")}</span>
      <span className="flex-1 min-w-[180px]">
        <span className={cn("block text-sm font-medium text-foreground", done && "line-through")}>{itemTitle(it)}</span>
        <span className="block text-xs text-muted-foreground">
          {it.orderNumber} · {it.customerName}{it.deliveryMethod === "delivery" ? "" : ` · ${methodLabel(it)}`}
        </span>
      </span>
      <span className="flex flex-wrap gap-1.5">
        {it.deliveryMethod === "delivery" && it.type === "cake" && (
          <span className={deliveryBadge}><Truck className="w-3.5 h-3.5" /> {t("Delivery", "Livraison")}{it.deliveryCity ? ` · ${it.deliveryCity}` : ""}</span>
        )}
        {candleText(it) && (
          <span className={candleBadge}><Flame className="w-3.5 h-3.5" /> {candleText(it)}</span>
        )}
        {it.fruits && <span className={fruitBadge}><Cherry className="w-3.5 h-3.5" /> Fruits</span>}
        {it.badge === "to_accept" && <span className="px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide bg-blue-600 text-white">{t("To accept", "À accepter")}</span>}
        {it.badge === "awaiting_payment" && <span className="px-2 py-0.5 text-[11px] bg-amber-100 text-amber-900">{t("To collect", "À encaisser")}</span>}
        {done && <span className="px-2 py-0.5 text-[11px] bg-emerald-100 text-emerald-800">{t("Done", "Fait")}</span>}
      </span>
    </Link>
  );

  // One sub-list of a day ("À faire", "Prêts" or "Workshops"), items in slot
  // order (same order as get-today, kept when a tick moves an item across).
>>>>>>> a42b08817d2cd14f870dc2782a564fe62fbabb5a
  const bySlot = (a: DayItem, b: DayItem) =>
    (a.slot ?? "99").localeCompare(b.slot ?? "99") || (a.orderNumber ?? "").localeCompare(b.orderNumber ?? "");

  // Alert banner — only when there is something to act on
  const hasAlert = !employee && data && (data.toDecide.length > 0 || data.toCollect.length > 0 || data.alerts.length > 0);
  const alertParts: string[] = [];
  if (data && data.toDecide.length > 0)
    alertParts.push(`${data.toDecide.length} ${t(data.toDecide.length > 1 ? "orders to decide" : "order to decide", data.toDecide.length > 1 ? "commandes à décider" : "commande à décider")}`);
  if (data && data.toCollect.length > 0)
    alertParts.push(`${data.toCollect.length} ${t(data.toCollect.length > 1 ? "to collect" : "to collect", data.toCollect.length > 1 ? "à encaisser" : "à encaisser")}`);
  if (data && data.alerts.length > 0)
    alertParts.push(`${data.alerts.length} ${t(data.alerts.length > 1 ? "alerts" : "alert", data.alerts.length > 1 ? "alertes" : "alerte")}`);
  const alertHref = data && data.toDecide.length > 0 ? "#a-faire" : data && data.toCollect.length > 0 ? "#a-faire" : "#alertes";

  // Production: single list per day, toDo first then ready at bottom
  const renderCakeDay = (date: string) => {
    const cakes = data!.days[date].filter((i) => i.type === "cake");
    const toDo = [...cakes.filter((i) => !isProductionDone(i.productionStatus))].sort(bySlot);
    const ready = [...cakes.filter((i) => isProductionDone(i.productionStatus))].sort(bySlot);
    const allCakes = [...toDo, ...ready];
    return (
      <div key={date} data-day={date} className={box}>
        <div className={cn("flex flex-wrap items-baseline justify-between gap-x-3 px-4 py-2.5", cakes.length > 0 && "border-b border-[#E3D7BE]")}>
          <span className="text-sm font-bold first-letter:uppercase">
            {dayLabel(date)}
            {date === today && (
              <span className="ml-2 px-1.5 py-0.5 text-[11px] font-semibold bg-primary/10 text-primary rounded-full">{t("Today", "Aujourd'hui")}</span>
            )}
          </span>
          <span className="text-xs text-[#6B5A4C] tabular-nums">
            {cakes.length === 0 ? t("nothing scheduled", "rien de prévu") : `${ready.length} / ${cakes.length} ${t("ready", "prêts")}`}
          </span>
        </div>
        {cakes.length === 0 ? (
          <p className="px-4 py-4 text-sm text-[#6B5A4C]">{t("Nothing scheduled.", "Rien de prévu.")}</p>
        ) : (
          <ul className="divide-y divide-[#F0E8D8]">
            {allCakes.map((it) => {
              const done = isProductionDone(it.productionStatus);
              const nameParts = it.customerName.split(" ");
              const shortName = nameParts[1] ? `${nameParts[0]} ${nameParts[1][0]}.` : nameParts[0];
              return (
                <li key={it.itemId} className={cn("flex items-center gap-3 pl-4 min-h-[44px]", done && "bg-[#F7F4EE]")}>
                  <ProductionCheck
                    itemId={it.itemId}
                    status={it.productionStatus}
                    disabledReason={it.badge === "to_accept" ? t("Accept the order first.", "Acceptez d'abord la commande.") : null}
                    onChange={(next) => setItemStatus(it.itemId, next)}
                  />
                  <Link
                    to={`/admin/order/${it.orderId}`}
                    className="flex-1 min-w-0 flex flex-wrap items-center gap-x-3 gap-y-1 pr-4 py-3 hover:bg-black/[0.02]"
                  >
                    <span className={cn("w-20 shrink-0 text-sm font-bold tabular-nums", done ? "text-[#8A7A6A]" : "text-foreground")}>
                      {it.slot || "—"}
                    </span>
                    <span className="flex-1 min-w-[160px]">
                      <span className={cn("block text-sm font-medium", done ? "line-through text-[#8A7A6A]" : "text-foreground")}>{itemTitle(it)}</span>
                      <span className={cn("block text-xs", done ? "text-[#8A7A6A]" : "text-[#6B5A4C]")}>
                        {shortName} · {methodLabel(it)} · {it.orderNumber}
                      </span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      {it.badge === "to_accept" && (
                        <span className="px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide bg-blue-600 text-white">{t("To accept", "À accepter")}</span>
                      )}
                      {it.badge === "awaiting_payment" && (
                        <span className="px-2 py-0.5 text-[11px] bg-amber-100 text-amber-900">{t("To collect", "À encaisser")}</span>
                      )}
                      {done && <span className="text-xs font-semibold text-[#2F6B3A]">Ready ✓</span>}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  };

  const sectionTitle = "text-sm font-bold uppercase tracking-[0.1em] text-foreground mb-2";
  const box = "border border-[#E3D7BE] bg-white rounded-[10px] shadow-sm overflow-hidden";

  return (
    <AdminLayout>
      <main className="container mx-auto px-4 py-8 max-w-4xl space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-sans uppercase tracking-[0.105em] text-2xl md:text-3xl text-foreground font-semibold">{t("Today", "Aujourd'hui")}</h1>
            <p className="text-sm text-[#6B5A4C] first-letter:uppercase">{dayLabel(today)}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={load} disabled={loading} className="rounded-none" aria-label={t("Refresh", "Actualiser")}>
              <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
            </Button>
            {!employee && (
              <Button asChild className="rounded-none bg-primary hover:bg-primary/90 text-primary-foreground">
                <Link to="/admin/manual-orders/new"><Plus className="w-4 h-4 mr-1" /> {t("New order", "Nouvelle commande")}</Link>
              </Button>
            )}
          </div>
        </div>

        {/* Period pickers */}
        <div className="flex flex-wrap items-end gap-3" aria-label={t("Period", "Période")}>
          <label className="flex-1 min-w-[140px] sm:flex-none text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {t("From", "Du")}
            <Input type="date" value={from} onChange={(e) => e.target.value && setPeriod({ from: e.target.value })} className="mt-1 rounded-none w-full sm:w-[170px] px-2 text-sm md:text-sm normal-case tracking-normal" />
          </label>
          <label className="flex-1 min-w-[140px] sm:flex-none text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {t("To", "Au")}
            <Input type="date" value={to} onChange={(e) => e.target.value && setPeriod({ to: e.target.value })} className="mt-1 rounded-none w-full sm:w-[170px] px-2 text-sm md:text-sm normal-case tracking-normal" />
          </label>
          <Button variant="outline" onClick={() => setPeriod(null)} className="rounded-none">
            {t("Today + 2 days", "Aujourd'hui + 2 jours")}
          </Button>
          <ShowTestsToggle checked={includeTests} onChange={setIncludeTests} className="pb-2" />
        </div>
        {rangeError && (
          <div className="border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {rangeError}
          </div>
        )}
        {error && (
          <div className="border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
          </div>
        )}
        {loading && !data && !error && (
          <div className="py-16 text-center"><Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" /></div>
        )}

        {data && !rangeError && (
          <>
            {/* Alert banner — only when there is something to act on */}
            {hasAlert && (
              <div className="flex items-center gap-3 px-4 py-3 rounded-[10px] border border-[#E2B9AC] bg-[#F7E3DC]">
                <span className="flex-none w-8 h-8 rounded-full bg-[#7A1C1C] flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-4 h-4 text-white" />
                </span>
                <span className="flex-1 text-sm font-bold text-[#7A1C1C]">
                  {alertParts.join(" · ")}
                </span>
                <Button asChild size="sm" className="rounded-none bg-[#7A1C1C] hover:bg-[#5C1515] text-white text-xs px-3 shrink-0">
                  <a href={alertHref}>{t("Review", "Voir")}</a>
                </Button>
              </div>
            )}

<<<<<<< HEAD
            {/* To do now — only when non-empty */}
            {!employee && (data.toDecide.length > 0 || data.toCollect.length > 0) && (
              <section id="a-faire">
                <h2 className={sectionTitle}>{t("To do now", "À faire maintenant")}</h2>
                <div className={box}>
                  <ul className="divide-y divide-[#F0E8D8]">
=======
            {/* Counters */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                ...(employee ? [] : [
                  { label: t("To decide", "À décider"), value: data.toDecide.length, warn: data.toDecide.length > 0, href: "#a-faire" },
                  { label: t("To collect", "À encaisser"), value: data.toCollect.length, warn: false, href: "#a-faire" },
                ]),
                { label: t("Cakes in the period", "Gâteaux sur la période"), value: counts.all, warn: false, href: "#production",
                  note: toAcceptCakes > 0 ? t(`+ ${toAcceptCakes} to accept`, `+ ${toAcceptCakes} à accepter`) : null },
                ...(employee ? [] : [{ label: t("Alerts", "Alertes"), value: data.alerts.length, danger: data.alerts.length > 0, href: "#alertes" }]),
              ].map((c) => (
                <a
                  key={c.label}
                  href={c.href}
                  className={cn(
                    "block px-4 py-3 border",
                    c.danger ? "border-red-200 bg-red-50 text-red-900" : c.warn ? "border-amber-200 bg-amber-50 text-amber-900" : "border-border/60 bg-secondary/30 text-foreground",
                  )}
                >
                  <span className="block text-xs font-semibold uppercase tracking-[0.08em] opacity-80">{c.label}</span>
                  <span className="block text-3xl font-semibold tabular-nums">{c.value}</span>
                  {"note" in c && c.note && <span className="block text-xs font-semibold text-blue-800">{c.note}</span>}
                </a>
              ))}
            </div>

            {/* Upcoming deliveries — the courier has to be booked ahead */}
            {upcomingDeliveries && (
              <section id="livraisons">
                <h2 className={cn(sectionTitle, "flex items-center gap-2")}>
                  <Truck className="w-4 h-4 text-sky-700" /> {t(`Upcoming deliveries (${DELIVERY_LOOKAHEAD_DAYS} days)`, `Livraisons à venir (${DELIVERY_LOOKAHEAD_DAYS} jours)`)} ({upcomingDeliveries.length})
                </h2>
                {upcomingDeliveries.length === 0 ? (
                  <div className={box}><p className="px-4 py-5 text-sm text-muted-foreground">{t("No delivery in the next 14 days.", "Aucune livraison dans les 14 prochains jours.")}</p></div>
                ) : (
                  <ul className="border-2 border-sky-700 bg-sky-50 divide-y divide-sky-200">
                    {upcomingDeliveries.map(({ date, it, cakes }) => (
                      <li key={`${it.orderId}-${date}`}>
                        <Link to={`/admin/order/${it.orderId}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm text-sky-950 hover:bg-sky-100">
                          <span className="w-36 shrink-0 font-semibold first-letter:uppercase">{shortDate(date)}{date === today && <span className="ml-1 text-xs text-primary">{t("today", "aujourd'hui")}</span>}</span>
                          <span className="w-28 shrink-0 tabular-nums">{it.slot || t("No time slot", "Sans créneau")}</span>
                          <span className="flex-1 min-w-[180px]">
                            <span className="font-medium">{it.deliveryCity || t("Address on the order", "Adresse dans la commande")}</span>
                            <span className="block text-xs text-sky-900/80">{it.orderNumber} · {it.customerName} · {cakes} {t(cakes > 1 ? "cakes" : "cake", cakes > 1 ? "gâteaux" : "gâteau")}</span>
                          </span>
                          {it.badge === "to_accept" && <span className="px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide bg-blue-600 text-white">{t("To accept", "À accepter")}</span>}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {/* To do now */}
            {!employee && (
            <section id="a-faire">
              <h2 className={sectionTitle}>{t("To do now", "À faire maintenant")}</h2>
              <div className={box}>
                {data.toDecide.length === 0 && data.toCollect.length === 0 ? (
                  <p className="px-4 py-5 text-sm text-muted-foreground">{t("Nothing to decide or collect.", "Rien à décider ni à encaisser.")}</p>
                ) : (
                  <ul className="divide-y divide-border/60">
>>>>>>> a42b08817d2cd14f870dc2782a564fe62fbabb5a
                    {data.toDecide.map((o) => (
                      <li key={`d-${o.orderId}`} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                        <span className="px-2 py-0.5 text-[11px] bg-amber-100 text-amber-900">{t("À décider", "À décider")}</span>
                        <span className="flex-1 min-w-[180px] text-sm">
                          <span className="font-medium">{o.orderNumber}</span> · {o.customerName} · {shortDate(o.date)} · {formatChf(o.total)}
                          {(() => { const w = waitingFor(o.receivedAt); return w ? <span className={cn("block text-xs", w.late ? "text-red-700 font-semibold" : "text-[#6B5A4C]")}>{w.text}</span> : null; })()}
                        </span>
                        <Button asChild variant="outline" size="sm" className="rounded-none">
                          <Link to={`/admin/order/${o.orderId}`}>{t("Accept or refuse", "Accepter ou refuser")}</Link>
                        </Button>
                      </li>
                    ))}
                    {data.toCollect.map((o) => (
                      <li key={`c-${o.orderId}`} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                        <span className="px-2 py-0.5 text-[11px] bg-secondary text-foreground/80">{t("To collect", "À encaisser")}</span>
                        <span className="flex-1 min-w-[180px] text-sm">
                          <span className="font-medium">{o.orderNumber}</span> · {o.customerName} · {shortDate(o.date)} · {formatChf(o.total)}
                        </span>
                        <Button asChild variant="outline" size="sm" className="rounded-none">
                          <Link to={`/admin/order/${o.orderId}`}>{t("Record the payment", "Enregistrer le paiement")}</Link>
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            )}

            {/* Production */}
            <section id="production" className="space-y-3">
              <h2 className={cn(sectionTitle, "mb-0 flex flex-wrap items-baseline gap-2")}>
                {t("Production", "Production")}
                {totalCakes > 0 && (
                  <span className="text-xs font-normal normal-case tracking-normal text-[#6B5A4C]">
                    — {totalCakes} {t(totalCakes > 1 ? "cakes in the period" : "cake in the period", totalCakes > 1 ? "gâteaux sur la période" : "gâteau sur la période")}
                  </span>
                )}
              </h2>
              {!periodSupported && (
                <p className="border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
                  {t("Only today and tomorrow are shown until the new get-today version is deployed.",
                    "Seuls aujourd'hui et demain sont affichés tant que la nouvelle version de get-today n'est pas déployée.")}
                </p>
              )}
              {periodDates.map(renderCakeDay)}
            </section>

            {/* Workshops */}
            <section id="workshops">
              <h2 className={sectionTitle}>
                {t("Workshops", "Workshops")} ({allItems.filter((i) => i.type === "workshop").length})
              </h2>
              {ws && ws.sessions.length > 0 && (
                <div className="mb-3">
                  <WorkshopSessionsPanel sessions={ws.sessions} stockRows={ws.stockRows} includeTests={includeTests} canDecideSurplus={!employee} onChanged={load} />
                </div>
              )}
              {workshopDates.length === 0 ? (
                <div className={box}><p className="px-4 py-5 text-sm text-[#6B5A4C]">{t("No workshop in this period.", "Aucun workshop sur la période.")}</p></div>
              ) : (
                <div className="space-y-3">
                  {workshopDates.map((date) => (
                    <div key={date} data-workshop-day={date} className={box}>
                      <div className="px-4 py-2.5 border-b border-[#E3D7BE] text-sm font-bold first-letter:uppercase">
                        {dayLabel(date)}
                        {date === today && <span className="ml-2 px-1.5 py-0.5 text-[11px] font-semibold bg-primary/10 text-primary rounded-full">{t("Today", "Aujourd'hui")}</span>}
                      </div>
                      <ul className="divide-y divide-[#F0E8D8]">
                        {data.days[date].filter((i) => i.type === "workshop").sort(bySlot).map((it) => (
                          <li key={it.itemId} className="flex items-center pl-4">
                            <Link to={`/admin/order/${it.orderId}`} className="flex-1 min-w-0 flex flex-wrap items-center gap-x-3 gap-y-1 pr-4 py-3 hover:bg-black/[0.02]">
                              <span className="w-20 shrink-0 text-sm font-bold tabular-nums text-foreground">{it.slot || "—"}</span>
                              <span className="flex-1 min-w-[160px]">
                                <span className="block text-sm font-medium text-foreground">{itemTitle(it)}</span>
                                <span className="block text-xs text-[#6B5A4C]">{it.customerName} · {it.orderNumber}</span>
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Alerts */}
            {!employee && (
              <section id="alertes">
                <h2 className={sectionTitle}>{t("Alerts", "Alertes")}</h2>
                {data.alerts.length === 0 ? (
                  <div className={box}><p className="px-4 py-5 text-sm text-[#6B5A4C]">{t("No alerts.", "Aucune alerte.")}</p></div>
                ) : (
                  <ul className="border border-red-200 bg-red-50 divide-y divide-red-200 rounded-[10px] overflow-hidden">
                    {data.alerts.map((a, i) => (
                      <li key={`${a.orderId}-${a.issueType}-${i}`}>
                        <Link to={`/admin/order/${a.orderId}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm text-red-900 hover:bg-red-100/60">
                          <AlertTriangle className="w-4 h-4 shrink-0" />
                          <span className="flex-1 min-w-[180px]">
                            <span className="font-medium">{a.orderNumber}</span> · {t(ALERT_LABELS[a.issueType]?.en ?? a.issueType, ALERT_LABELS[a.issueType]?.fr ?? a.issueType)}
                            {a.detail && <span className="block text-xs opacity-80">{a.detail}</span>}
                          </span>
                          <span className="text-xs underline">{t("Open", "Ouvrir")}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </>
        )}
      </main>
    </AdminLayout>
  );
};

export default AdminToday;
