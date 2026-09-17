import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval,
  format, addMonths, subMonths, isSameMonth, isToday,
} from "date-fns";
import { fr as dateFnsFr } from "date-fns/locale";
import { Loader2, Lock, CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { isAdminEmail } from "@/lib/adminAccess";
import { extractFunctionErrorMessage } from "@/lib/functionErrors";
import { cn } from "@/lib/utils";

type OrderState = "approved" | "pending" | "refused" | "cancelled";
type DayEntry = {
  type: "cake" | "workshop";
  orderId: string;
  orderNumber: string | null;
  customerName: string;
  status: OrderState;
  detail: string;
  total: number | null;
};

const dateKey = (d: Date) => format(d, "yyyy-MM-dd");

const AdminCalendar = () => {
  const { t, lang } = useLang();
  const { user, loading: authLoading } = useAuth();
  const isAdmin = isAdminEmail(user?.email);

  const [monthCursor, setMonthCursor] = useState(() => new Date());
  const [days, setDays] = useState<Record<string, DayEntry[]>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Admin – Calendar – Bento Cake Studio";
    return () => { document.title = "Bento Cake Studio Geneva"; };
  }, []);

  useEffect(() => {
    if (authLoading || !isAdmin) { setLoading(authLoading); return; }
    let cancelled = false;
    const fetchMonth = async () => {
      setLoading(true);
      setLoadError(null);
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
            : t("Could not load the calendar. Please try again.", "Impossible de charger le calendrier. Merci de réessayer.")
        );
      } else if (data?.error) {
        console.error("list-orders-by-date failed:", data.error);
        setLoadError(t("Could not load the calendar. Please try again.", "Impossible de charger le calendrier. Merci de réessayer."));
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

  const monthStart = startOfMonth(monthCursor);
  const monthEnd = endOfMonth(monthCursor);
  const gridStart = startOfWeek(monthStart);
  const gridEnd = endOfWeek(monthEnd);
  const gridDays = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const weekDayLabels = lang === "fr"
    ? ["Di", "Lu", "Ma", "Me", "Je", "Ve", "Sa"]
    : ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

  const selectedEntries = selectedDate ? (days[selectedDate] ?? []) : [];

  return (
    <Layout>
      <main className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="flex items-center gap-3 mb-6">
          <CalendarDays className="w-6 h-6 text-primary" />
          <h1 className="text-xl font-serif text-foreground">{t("Order Calendar", "Calendrier des commandes")}</h1>
        </div>

        <div className="flex items-center justify-between mb-4">
          <Button variant="outline" size="icon" onClick={() => { setMonthCursor((d) => subMonths(d, 1)); setSelectedDate(null); }}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="font-medium text-foreground capitalize">{format(monthCursor, "MMMM yyyy", lang === "fr" ? { locale: dateFnsFr } : undefined)}</span>
          <Button variant="outline" size="icon" onClick={() => { setMonthCursor((d) => addMonths(d, 1)); setSelectedDate(null); }}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>

        {loadError ? (
          <p className="text-center text-muted-foreground py-16">{loadError}</p>
        ) : (
          <>
            <div className="grid grid-cols-7 gap-1 mb-1">
              {weekDayLabels.map((d) => (
                <div key={d} className="text-center text-xs font-medium text-muted-foreground py-1">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1 relative">
              {loading && (
                <div className="absolute inset-0 bg-background/60 flex items-center justify-center z-10">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              )}
              {gridDays.map((day) => {
                const key = dateKey(day);
                const entries = days[key] ?? [];
                const inMonth = isSameMonth(day, monthCursor);
                const hasCancelledOnly = entries.length > 0 && entries.every((e) => e.status === "cancelled");
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => entries.length > 0 && setSelectedDate(key)}
                    disabled={entries.length === 0}
                    className={cn(
                      "aspect-square rounded-lg border p-1.5 text-left flex flex-col transition-colors",
                      inMonth ? "border-border" : "border-transparent opacity-40",
                      isToday(day) && "ring-1 ring-primary",
                      selectedDate === key && "bg-primary/10 border-primary",
                      entries.length > 0 && !hasCancelledOnly && "hover:bg-muted/50 cursor-pointer",
                      entries.length === 0 && "cursor-default",
                    )}
                  >
                    <span className={cn("text-xs", inMonth ? "text-foreground" : "text-muted-foreground")}>
                      {format(day, "d")}
                    </span>
                    {entries.length > 0 && (
                      <span
                        className={cn(
                          "mt-auto text-[11px] font-medium rounded-full px-1.5 py-0.5 text-center self-start",
                          hasCancelledOnly ? "bg-muted text-muted-foreground" : "bg-primary/15 text-primary"
                        )}
                      >
                        {entries.length}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {selectedDate && (
              <div className="mt-6 space-y-2">
                <h2 className="font-medium text-foreground">
                  {format(new Date(`${selectedDate}T00:00:00`), "d MMMM yyyy", lang === "fr" ? { locale: dateFnsFr } : undefined)}
                </h2>
                {selectedEntries.map((e, i) => (
                  <Link
                    key={`${e.orderId}-${i}`}
                    to={`/admin/order/${e.orderId}`}
                    className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card hover:bg-muted/30 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground truncate">
                          {e.orderNumber || `#${e.orderId.slice(0, 8).toUpperCase()}`}
                        </span>
                        <span className={cn(
                          "text-xs font-medium px-2 py-0.5 rounded-full shrink-0",
                          e.status === "approved" ? "bg-emerald-100 text-emerald-800" :
                          e.status === "pending" ? "bg-amber-100 text-amber-800" :
                          "bg-red-100 text-red-800"
                        )}>
                          {e.type === "workshop" ? "ATELIER · " : ""}{e.status.toUpperCase()}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground truncate">
                        {e.customerName} · {e.detail}
                      </p>
                    </div>
                    {e.total != null && (
                      <span className="font-semibold text-primary shrink-0">CHF {e.total.toFixed(2)}</span>
                    )}
                  </Link>
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </Layout>
  );
};

export default AdminCalendar;
