import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { fr as frLocale } from "date-fns/locale";
import { AlertTriangle, Loader2, Lock, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/admin/AdminLayout";
import { ProductionCheck, isProductionDone } from "@/components/admin/ProductionCheck";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { isAdminEmail } from "@/lib/adminAccess";
import { extractFunctionErrorMessage } from "@/lib/functionErrors";
import { PRODUCT_LABELS, flavorLabel, shapeLabel, sizeLabel } from "@/lib/orderLabels";
import { formatChf } from "@/lib/manualOrders";
import { cn } from "@/lib/utils";

// Admin > Aujourd'hui — the Admin home. Every row opens the order page, where
// the actions already exist (accept / refuse, mark as paid); the only action
// here is the production tick box (update-production-status). Data comes from
// one call to get-today for a chosen period (default: today + the next two
// days, Europe/Zurich) — same inclusion rule as the Production tab; alerts
// from order_health_anomalies. Each item is listed under its own
// pickup/delivery date, even when it is prepared earlier.

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
};
type Alert = { orderId: string; orderNumber: string | null; issueType: string; detail: string | null; createdAt: string };
type TodayData = { today: string; tomorrow: string; from?: string; to?: string; toDecide: ListedOrder[]; toCollect: ListedOrder[]; days: Record<string, DayItem[]>; alerts: Alert[] };

type Filter = "all" | "todo" | "ready";

const MAX_RANGE_DAYS = 31; // same limit as get-today
const DEFAULT_EXTRA_DAYS = 2;
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
  const isAdmin = isAdminEmail(user?.email);

  const [data, setData] = useState<TodayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  // Period kept in the URL (?from=&to=) so a reload shows the same days.
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
  const setPeriod = (next: { from?: string; to?: string } | null) => {
    const p = new URLSearchParams(searchParams);
    if (!next) { p.delete("from"); p.delete("to"); } else {
      p.set("from", next.from ?? from);
      p.set("to", next.to ?? to);
    }
    setSearchParams(p, { replace: true });
  };

  // Local update after a tick (ProductionCheck saves it on the server).
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
      const { data: res, error: fnError } = await supabase.functions.invoke("get-today", { body: { from, to } });
      if (fnError || res?.error) {
        const status = (fnError as { context?: Response } | null)?.context?.status;
        const reason = fnError ? await extractFunctionErrorMessage(fnError, "") : String(res.error);
        console.error("get-today failed:", status, reason);
        setError(status === 404
          ? t("This screen will work as soon as the get-today function is deployed.", "Cet écran fonctionnera dès que la fonction get-today sera déployée.")
          : t("Could not load today's overview. Please try again.", "Impossible de charger l'aperçu du jour. Réessayez."));
        return;
      }
      setData(res as TodayData);
    } catch (e) {
      console.error("get-today threw:", e);
      setError(t("Could not load today's overview. Please try again.", "Impossible de charger l'aperçu du jour. Réessayez."));
    } finally {
      setLoading(false);
    }
  }, [t, from, to, rangeError]);

  useEffect(() => {
    if (!authLoading && isAdmin) load();
  }, [authLoading, isAdmin, load]);

  if (authLoading) {
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
  // How long an order has been waiting for Accept / Refuse.
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
    return parts.join(" · ");
  };
  const methodLabel = (it: DayItem) =>
    it.type === "workshop"
      ? t("Workshop", "Atelier")
      : it.deliveryMethod === "delivery"
        ? `${t("Delivery", "Livraison")}${it.deliveryCity ? ` ${it.deliveryCity}` : ""}`
        : t("Pickup", "Retrait");

  const today = data?.today ?? zToday;
  // get-today returns from/to once it supports periods; an older deployment
  // ignores them and only returns today + tomorrow.
  const periodSupported = !!data?.from;
  const periodDates = data ? Object.keys(data.days).sort() : [];
  const allItems = periodDates.flatMap((d) => data!.days[d]);
  const periodCakes = allItems.filter((i) => i.type === "cake");
  const readyCount = periodCakes.filter((i) => isProductionDone(i.productionStatus)).length;
  const counts: Record<Filter, number> = { all: periodCakes.length, todo: periodCakes.length - readyCount, ready: readyCount };
  const workshopDates = periodDates.filter((d) => data!.days[d].some((i) => i.type === "workshop"));

  const itemLink = (it: DayItem, done: boolean) => (
    <Link to={`/admin/order/${it.orderId}`} className={cn("flex-1 min-w-0 flex flex-wrap items-center gap-x-3 gap-y-1 pr-4 py-3 hover:bg-secondary/40", done && "opacity-60")}>
      <span className="w-28 shrink-0 text-sm tabular-nums text-muted-foreground">{it.slot || t("No time slot", "Sans créneau")}</span>
      <span className="flex-1 min-w-[180px]">
        <span className={cn("block text-sm font-medium text-foreground", done && "line-through")}>{itemTitle(it)}</span>
        <span className="block text-xs text-muted-foreground">
          {it.orderNumber} · {it.customerName} · {methodLabel(it)}
        </span>
      </span>
      <span className="flex flex-wrap gap-1.5">
        {it.badge === "to_accept" && <span className="px-2 py-0.5 text-[11px] bg-amber-100 text-amber-900">{t("To accept", "À accepter")}</span>}
        {it.badge === "awaiting_payment" && <span className="px-2 py-0.5 text-[11px] bg-amber-100 text-amber-900">{t("To collect", "À encaisser")}</span>}
        {done && <span className="px-2 py-0.5 text-[11px] bg-emerald-100 text-emerald-800">{t("Done", "Fait")}</span>}
      </span>
    </Link>
  );

  // One sub-list of a day ("À faire", "Prêts" or "Workshops"), items in slot
  // order (same order as get-today, kept when a tick moves an item across).
  const bySlot = (a: DayItem, b: DayItem) =>
    (a.slot ?? "99").localeCompare(b.slot ?? "99") || (a.orderNumber ?? "").localeCompare(b.orderNumber ?? "");
  const subList = (key: string, title: string, items: DayItem[], empty: string, withCheck: boolean) => (
    <div key={key} data-list={key}>
      <h3 className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {title} <span className="tabular-nums">({items.length})</span>
      </h3>
      {items.length === 0 ? (
        <p className="px-4 pb-3 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {[...items].sort(bySlot).map((it) => {
            const done = withCheck && isProductionDone(it.productionStatus);
            return (
              <li key={it.itemId} className={cn("flex items-center gap-3 pl-4", done && "bg-secondary/30")}>
                {withCheck && (
                  <ProductionCheck
                    itemId={it.itemId}
                    status={it.productionStatus}
                    disabledReason={it.badge === "to_accept" ? t("Accept the order first.", "Acceptez d'abord la commande.") : null}
                    onChange={(next) => setItemStatus(it.itemId, next)}
                  />
                )}
                {itemLink(it, done)}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  // One date of the period: its cakes, split into "À faire" (not ticked) and
  // "Prêts" (ticked "Fait") according to the filter. "Prêts" is about
  // preparation only — payment and delivery are untouched.
  const renderCakeDay = (date: string) => {
    const cakes = data!.days[date].filter((i) => i.type === "cake");
    const toDo = cakes.filter((i) => !isProductionDone(i.productionStatus));
    const ready = cakes.filter((i) => isProductionDone(i.productionStatus));
    return (
      <div key={date} data-day={date} className={box}>
        <div className={cn("flex flex-wrap items-baseline justify-between gap-x-3 px-4 py-2.5 bg-secondary/30", cakes.length > 0 && "border-b border-border/60")}>
          <span className="text-sm font-semibold first-letter:uppercase">
            {dayLabel(date)}
            {date === today && <span className="ml-2 text-xs font-medium text-primary">{t("Today", "Aujourd'hui")}</span>}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {cakes.length === 0 ? t("nothing scheduled", "rien de prévu") : `${ready.length} / ${cakes.length} ${t("ready", "prêts")}`}
          </span>
        </div>
        {cakes.length > 0 && (
          <div className="divide-y divide-border/60">
            {filter !== "ready" && subList("todo", t("To do", "À faire"), toDo,
              ready.length > 0 ? t("Everything is ready.", "Tout est prêt.") : t("Nothing to prepare.", "Rien à préparer."), true)}
            {filter !== "todo" && subList("ready", t("Ready", "Prêts"), ready, t("Nothing ready yet.", "Rien de prêt pour l'instant."), true)}
          </div>
        )}
      </div>
    );
  };

  const sectionTitle = "text-sm font-bold uppercase tracking-[0.1em] text-foreground mb-2";
  const box = "border border-border/60 bg-background";

  return (
    <AdminLayout>
      <main className="container mx-auto px-4 py-8 max-w-4xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-sans uppercase tracking-[0.105em] text-2xl md:text-3xl text-foreground font-semibold">{t("Today", "Aujourd'hui")}</h1>
            <p className="text-sm text-muted-foreground first-letter:uppercase">{dayLabel(today)}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={load} disabled={loading} className="rounded-none" aria-label={t("Refresh", "Actualiser")}>
              <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
            </Button>
            <Button asChild className="rounded-none bg-primary hover:bg-primary/90 text-primary-foreground">
              <Link to="/admin/manual-orders/new"><Plus className="w-4 h-4 mr-1" /> {t("New order", "Nouvelle commande")}</Link>
            </Button>
          </div>
        </div>

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
            {/* Orders waiting for Accept / Refuse — never let one wait unnoticed */}
            {data.toDecide.length > 0 && (() => {
              const oldest = data.toDecide.reduce<string | null>((m, o) => (o.receivedAt && (!m || o.receivedAt < m) ? o.receivedAt : m), null);
              const w = waitingFor(oldest);
              return (
                <a href="#a-faire" className="flex items-start gap-2 border border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-950" data-testid="pending-banner">
                  <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0" />
                  <span>
                    <b>{data.toDecide.length} {t(data.toDecide.length > 1 ? "orders waiting for validation" : "order waiting for validation", data.toDecide.length > 1 ? "commandes en attente de validation" : "commande en attente de validation")}</b>
                    {w && <> · {t("oldest", "la plus ancienne")} {w.text}</>}
                    <span className="block text-xs">{t("Accept or refuse them below.", "Acceptez-les ou refusez-les ci-dessous.")}</span>
                  </span>
                </a>
              );
            })()}

            {/* Counters */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: t("To decide", "À décider"), value: data.toDecide.length, warn: data.toDecide.length > 0, href: "#a-faire" },
                { label: t("To collect", "À encaisser"), value: data.toCollect.length, warn: false, href: "#a-faire" },
                { label: t("Cakes in the period", "Gâteaux sur la période"), value: counts.all, warn: false, href: "#production" },
                { label: t("Alerts", "Alertes"), value: data.alerts.length, danger: data.alerts.length > 0, href: "#alertes" },
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
                </a>
              ))}
            </div>

            {/* To do now */}
            <section id="a-faire">
              <h2 className={sectionTitle}>{t("To do now", "À faire maintenant")}</h2>
              <div className={box}>
                {data.toDecide.length === 0 && data.toCollect.length === 0 ? (
                  <p className="px-4 py-5 text-sm text-muted-foreground">{t("Nothing to decide or collect.", "Rien à décider ni à encaisser.")}</p>
                ) : (
                  <ul className="divide-y divide-border/60">
                    {data.toDecide.map((o) => (
                      <li key={`d-${o.orderId}`} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                        <span className="px-2 py-0.5 text-[11px] bg-amber-100 text-amber-900">{t("To decide", "À décider")}</span>
                        <span className="flex-1 min-w-[180px] text-sm">
                          <span className="font-medium">{o.orderNumber}</span> · {o.customerName} · {shortDate(o.date)} · {formatChf(o.total)}
                          {(() => { const w = waitingFor(o.receivedAt); return w ? <span className={cn("block text-xs", w.late ? "text-red-700 font-semibold" : "text-muted-foreground")}>{w.text}</span> : null; })()}
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
                )}
              </div>
            </section>

            {/* Production of the period, by pickup/delivery date */}
            <section id="production" className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className={cn(sectionTitle, "mb-0")}>{t("Production", "Production")}</h2>
                <div role="group" aria-label={t("Filter", "Filtre")} className="flex border border-border/60">
                  {([
                    ["all", t("All", "Tous")],
                    ["todo", t("To do", "À faire")],
                    ["ready", t("Ready", "Prêts")],
                  ] as [Filter, string][]).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={filter === key}
                      onClick={() => setFilter(key)}
                      className={cn(
                        "px-3 py-1.5 text-sm border-l border-border/60 first:border-l-0",
                        filter === key ? "bg-primary text-primary-foreground" : "bg-background hover:bg-secondary/40",
                      )}
                    >
                      {label} <span className="tabular-nums">({counts[key]})</span>
                    </button>
                  ))}
                </div>
              </div>
              {!periodSupported && (
                <p className="border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
                  {t("Only today and tomorrow are shown until the new get-today version is deployed.",
                    "Seuls aujourd'hui et demain sont affichés tant que la nouvelle version de get-today n'est pas déployée.")}
                </p>
              )}
              {periodDates.map(renderCakeDay)}
            </section>

            {/* Workshops of the period — no production box */}
            <section id="workshops">
              <h2 className={sectionTitle}>
                {t("Workshops", "Workshops")} ({allItems.filter((i) => i.type === "workshop").length})
              </h2>
              {workshopDates.length === 0 ? (
                <div className={box}><p className="px-4 py-5 text-sm text-muted-foreground">{t("No workshop in this period.", "Aucun workshop sur la période.")}</p></div>
              ) : (
                <div className="space-y-3">
                  {workshopDates.map((date) => (
                    <div key={date} data-workshop-day={date} className={box}>
                      <div className="px-4 py-2.5 bg-secondary/30 border-b border-border/60 text-sm font-semibold first-letter:uppercase">
                        {dayLabel(date)}
                        {date === today && <span className="ml-2 text-xs font-medium text-primary">{t("Today", "Aujourd'hui")}</span>}
                      </div>
                      <ul className="divide-y divide-border/60">
                        {data.days[date].filter((i) => i.type === "workshop").sort(bySlot).map((it) => (
                          <li key={it.itemId} className="flex items-center pl-4">{itemLink(it, false)}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Alerts */}
            <section id="alertes">
              <h2 className={sectionTitle}>{t("Alerts", "Alertes")}</h2>
              {data.alerts.length === 0 ? (
                <div className={box}><p className="px-4 py-5 text-sm text-muted-foreground">{t("No alerts.", "Aucune alerte.")}</p></div>
              ) : (
                <ul className="border border-red-200 bg-red-50 divide-y divide-red-200">
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
          </>
        )}
      </main>
    </AdminLayout>
  );
};

export default AdminToday;
