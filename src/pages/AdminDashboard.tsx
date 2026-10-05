import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { fr as frLocale } from "date-fns/locale";
import { AlertTriangle, Calculator, ChevronRight, LayoutDashboard, Loader2, Lock, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/admin/AdminLayout";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { isAdminEmail } from "@/lib/adminAccess";
import { useStaffRole } from "@/lib/staff";
import { extractFunctionErrorMessage } from "@/lib/functionErrors";
import { useWorkshopAvailability } from "@/hooks/useWorkshopAvailability";
import { cakeDays, handovers, nextSessions, toDecideFirst, type TodayItem, type ToDecideOrder } from "@/lib/dashboard";
import { cn } from "@/lib/utils";

// Admin > Tableau de bord — ce qu'il faut gérer, sans aucun chiffre financier
// (les chiffres sont dans la Compta). Quatre blocs, chacun mène à la commande
// ou à l'écran concerné : commandes à accepter ou refuser, gâteaux à préparer,
// retraits et livraisons à venir, prochains workshops. Données : get-today
// (même règle que Production et Aujourd'hui) sur aujourd'hui + 6 jours, et
// get_workshop_availability pour les places des sessions. L'employée (droit
// « today.view ») voit la même page sans le bloc de décision ni la Compta ;
// le serveur ne lui renvoie de toute façon aucun montant.

const HORIZON_DAYS = 7; // aujourd'hui + 6 jours (get-today accepte jusqu'à 31)

type TodayData = { today: string; from?: string; to?: string; toDecide: ToDecideOrder[]; days: Record<string, TodayItem[]> };

const zurichTodayISO = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dayLink = (date: string, anchor: string) => `/admin?from=${date}&to=${date}#${anchor}`;

const rowLink = "flex items-center gap-3 px-4 py-3 hover:bg-secondary/40";

const Block = ({ id, title, count, action, children }: { id: string; title: string; count?: number; action: { to: string; label: string }; children: ReactNode }) => (
  <section id={id} data-block={id} className="space-y-2">
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="text-sm font-bold uppercase tracking-[0.1em] text-foreground">
        {title}{count != null && <span className="tabular-nums"> ({count})</span>}
      </h2>
      <Link to={action.to} className="shrink-0 text-xs font-semibold text-primary underline-offset-2 hover:underline">{action.label}</Link>
    </div>
    <div className="border border-border/60 bg-background">{children}</div>
  </section>
);
const Empty = ({ children }: { children: ReactNode }) => <p className="px-4 py-4 text-sm text-muted-foreground">{children}</p>;
const Tag = ({ className, children }: { className: string; children: ReactNode }) => (
  <span className={cn("px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide shrink-0", className)}>{children}</span>
);

const AdminDashboard = () => {
  const { t, lang } = useLang();
  const l = lang === "en" ? "en" : "fr";
  const { user, loading: authLoading } = useAuth();
  const staff = useStaffRole();
  const admin = isAdminEmail(user?.email);
  const allowed = admin || staff.can("today.view");
  const { rows: sessionRows, error: sessionsError } = useWorkshopAvailability();

  const [data, setData] = useState<TodayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Admin – Tableau de bord – Bento Cake Studio";
    return () => { document.title = "Bento Cake Studio Geneva"; };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const from = zurichTodayISO();
    try {
      const { data: res, error: fnError } = await supabase.functions.invoke("get-today", { body: { from, to: addDays(from, HORIZON_DAYS - 1) } });
      if (fnError || res?.error) {
        const reason = fnError ? await extractFunctionErrorMessage(fnError, "") : String(res.error);
        console.error("get-today failed:", reason);
        setError(t("Could not load the dashboard. Please try again.", "Impossible de charger le tableau de bord. Réessayez."));
        return;
      }
      setData(res as TodayData);
    } catch (e) {
      console.error("get-today threw:", e);
      setError(t("Could not load the dashboard. Please try again.", "Impossible de charger le tableau de bord. Réessayez."));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!authLoading && !staff.loading && allowed) load();
  }, [authLoading, staff.loading, allowed, load]);

  if (authLoading || staff.loading) {
    return (
      <AdminLayout>
        <main className="container mx-auto px-4 py-16 text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
        </main>
      </AdminLayout>
    );
  }
  if (!user || !allowed) {
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

  const today = data?.today ?? zurichTodayISO();
  const fmt = (iso: string, pattern: { fr: string; en: string }) => {
    try { return format(parseISO(iso), pattern[l], l === "fr" ? { locale: frLocale } : undefined); } catch { return iso; }
  };
  const dayName = (iso: string) =>
    iso === today ? t("Today", "Aujourd'hui") : iso === addDays(today, 1) ? t("Tomorrow", "Demain") : fmt(iso, { fr: "EEEE d MMM", en: "EEEE, MMM d" });
  const shortDay = (iso: string | null) => (iso ? fmt(iso, { fr: "EEE d MMM", en: "EEE, MMM d" }) : t("no date", "sans date"));
  const workshopName = (type: string) => (type === "paint" ? t("Paint workshop", "Workshop Peinture") : t("Signature workshop", "Workshop Signature"));

  const decide = data ? toDecideFirst(data.toDecide) : { shown: [], more: 0 };
  const cakes = data ? cakeDays(data.days) : [];
  const passages = data ? handovers(data.days) : [];
  const sessions = nextSessions(sessionRows, today);
  const cakesTotal = cakes.reduce((s, d) => s + d.toPrepare, 0);
  const toAcceptTotal = cakes.reduce((s, d) => s + d.toAccept, 0);

  return (
    <AdminLayout>
      <main className="container mx-auto px-4 py-8 max-w-3xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-sans uppercase tracking-[0.105em] text-2xl text-foreground flex items-center gap-2">
            <LayoutDashboard className="w-5 h-5 text-primary" strokeWidth={1.5} />
            {t("Dashboard", "Tableau de bord")}
          </h1>
          <div className="flex gap-2">
            <Button variant="outline" onClick={load} disabled={loading} className="rounded-none" aria-label={t("Refresh", "Actualiser")}>
              <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
            </Button>
            {admin && (
              <Button asChild variant="outline" className="rounded-none">
                <Link to="/admin/compta" data-testid="open-compta"><Calculator className="w-4 h-4 mr-1" /> {t("Open Accounting", "Ouvrir la Compta")}</Link>
              </Button>
            )}
          </div>
        </div>

        {error && (
          <div className="border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
          </div>
        )}
        {loading && !data && !error && (
          <div className="py-16 text-center"><Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" /></div>
        )}

        {data && (
          <>
            {/* 1. À accepter ou refuser (administratrices) */}
            {admin && (
              <Block id="a-decider" title={t("To accept or refuse", "À accepter ou refuser")} count={data.toDecide.length}
                action={{ to: "/admin#a-faire", label: t("See all", "Tout voir") }}>
                {decide.shown.length === 0 ? <Empty>{t("No order waiting for a decision.", "Aucune commande en attente de décision.")}</Empty> : (
                  <ul className="divide-y divide-border/60">
                    {decide.shown.map((o) => (
                      <li key={o.orderId}>
                        <Link to={`/admin/order/${o.orderId}`} className={rowLink}>
                          <Tag className="bg-blue-600 text-white">{t("To decide", "À décider")}</Tag>
                          <span className="flex-1 min-w-0 text-sm">
                            <span className="font-medium">{o.orderNumber}</span> · {o.customerName}
                            {o.date && <span className="block text-xs text-muted-foreground first-letter:uppercase">{shortDay(o.date)}</span>}
                          </span>
                          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                        </Link>
                      </li>
                    ))}
                    {decide.more > 0 && (
                      <li><Link to="/admin#a-faire" className={cn(rowLink, "text-sm text-primary")}>{t(`+ ${decide.more} more`, `+ ${decide.more} autre(s)`)}</Link></li>
                    )}
                  </ul>
                )}
              </Block>
            )}

            {/* 2. Gâteaux à préparer, par jour */}
            <Block id="gateaux" title={t("Cakes to prepare", "Gâteaux à préparer")} count={cakesTotal}
              action={{ to: "/admin/production", label: t("Open Production", "Ouvrir la production") }}>
              <ul className="divide-y divide-border/60">
                {cakes.map((d) => (
                  <li key={d.date}>
                    <Link to={dayLink(d.date, "production")} data-day={d.date} className={cn(rowLink, d.toPrepare + d.ready + d.toAccept === 0 && "text-muted-foreground")}>
                      <span className={cn("flex-1 min-w-0 text-sm first-letter:uppercase", d.date === today && "font-semibold")}>{dayName(d.date)}</span>
                      <span className="text-sm tabular-nums text-right">
                        {d.toPrepare + d.ready === 0
                          ? (d.toAccept === 0 ? t("nothing", "rien") : "")
                          : <><b data-k="to-prepare">{d.toPrepare}</b> {t("to prepare", "à préparer")}{d.ready > 0 && <span className="text-muted-foreground"> · {d.ready} {t("ready", "prêt(s)")}</span>}</>}
                        {d.toAccept > 0 && <span className="block text-xs font-semibold text-blue-800">+ {d.toAccept} {t("to accept", "à accepter")}</span>}
                      </span>
                      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                    </Link>
                  </li>
                ))}
              </ul>
              {toAcceptTotal > 0 && (
                <p className="px-4 py-2 text-xs text-muted-foreground border-t border-border/60">
                  {t("Cakes to accept are not counted until the order is accepted.", "Les gâteaux à accepter ne comptent qu'une fois la commande acceptée.")}
                </p>
              )}
            </Block>

            {/* 3. Retraits et livraisons à venir */}
            <Block id="passages" title={t("Upcoming pickups & deliveries", "Retraits et livraisons à venir")} count={passages.length}
              action={{ to: "/admin/calendar", label: t("Open Planning", "Ouvrir le planning") }}>
              {passages.length === 0 ? <Empty>{t(`Nothing in the next ${HORIZON_DAYS} days.`, `Rien dans les ${HORIZON_DAYS} prochains jours.`)}</Empty> : (
                <ul className="divide-y divide-border/60">
                  {passages.map((p) => (
                    <li key={p.key}>
                      <Link to={`/admin/order/${p.orderId}`} data-passage={p.key} className={rowLink}>
                        <span className="w-24 shrink-0 text-xs leading-tight">
                          <span className={cn("block first-letter:uppercase", p.date === today && "font-semibold")}>{p.date === today || p.date === addDays(today, 1) ? dayName(p.date) : shortDay(p.date)}</span>
                          <span className="block tabular-nums text-muted-foreground">{p.slot || t("no slot", "sans créneau")}</span>
                        </span>
                        <span className="flex-1 min-w-0 text-sm">
                          <span className="block">
                            {p.method === "delivery" ? `${t("Delivery", "Livraison")}${p.city ? ` · ${p.city}` : ""}` : t("Pickup", "Retrait")}
                            {" · "}{p.cakes} {t(p.cakes > 1 ? "cakes" : "cake", p.cakes > 1 ? "gâteaux" : "gâteau")}
                          </span>
                          <span className="block text-xs text-muted-foreground truncate">{p.orderNumber} · {p.customerName}</span>
                          {(p.toAccept || p.ready === p.cakes || (admin && p.awaitingPayment)) && (
                            <span className="mt-1 flex flex-wrap gap-1">
                              {p.toAccept && <Tag className="bg-blue-600 text-white">{t("To accept", "À accepter")}</Tag>}
                              {!p.toAccept && p.ready === p.cakes && <Tag className="bg-emerald-100 text-emerald-800">{t("Ready", "Prêt")}</Tag>}
                              {admin && p.awaitingPayment && <Tag className="bg-amber-100 text-amber-900">{t("To collect", "À encaisser")}</Tag>}
                            </span>
                          )}
                        </span>
                        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Block>

            {/* 4. Prochains workshops */}
            <Block id="workshops" title={t("Next workshops", "Prochains workshops")}
              action={{ to: "/admin/calendar", label: t("Open Planning", "Ouvrir le planning") }}>
              {sessionsError && !sessionRows ? <Empty>{t("Sessions could not be loaded.", "Les sessions n'ont pas pu être chargées.")}</Empty>
                : !sessionRows ? <div className="py-4 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" /></div>
                : sessions.length === 0 ? <Empty>{t("No upcoming session.", "Aucune session à venir.")}</Empty> : (
                <ul className="divide-y divide-border/60">
                  {sessions.map((s) => (
                    <li key={s.id}>
                      <Link to={dayLink(s.date, "workshops")} data-session={s.id} className={rowLink}>
                        <span className="flex-1 min-w-0 text-sm">
                          <span className="block">{workshopName(s.type)}</span>
                          <span className="block text-xs text-muted-foreground first-letter:uppercase">
                            {shortDay(s.date)} · {s.time}
                            {!s.open && <Tag className="ml-2 bg-muted text-muted-foreground">{t("Closed", "Fermée")}</Tag>}
                          </span>
                        </span>
                        <span className="text-sm tabular-nums text-right">
                          <b data-k="seats">{s.reserved} / {s.capacity}</b>
                          <span className="block text-xs text-muted-foreground">{t("seats taken", "places prises")}</span>
                        </span>
                        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Block>
          </>
        )}
      </main>
    </AdminLayout>
  );
};

export default AdminDashboard;
