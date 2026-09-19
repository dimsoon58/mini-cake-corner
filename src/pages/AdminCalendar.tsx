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
import { itemDisplayImage } from "@/lib/itemDisplayImage";
import { PRODUCT_LABELS, sizeLabel, shapeLabel, flavorLabel } from "@/lib/orderLabels";
import { cn } from "@/lib/utils";

type OrderState = "approved" | "pending" | "refused" | "cancelled";
type DayEntry = {
  type: "cake" | "workshop";
  orderId: string;
  itemId: string;
  orderNumber: string | null;
  customerName: string;
  status: OrderState;
  product: string;
  size: string | null;
  shape: string | null;
  flavors: string[] | null;
  designImageUrl: string | null;
  referenceImages: string[] | null;
  workshopType: string | null;
  workshopTime: string | null;
  workshopParticipants: number | null;
  pickupDeliverySlot: string | null;
  deliveryMethod: string | null;
  total: number | null;
};

const dateKey = (d: Date) => format(d, "yyyy-MM-dd");

const statusBadgeClass = (status: OrderState) =>
  status === "approved" ? "bg-emerald-100 text-emerald-800" :
  status === "pending" ? "bg-amber-100 text-amber-800" :
  status === "refused" ? "bg-red-100 text-red-800" :
  "bg-muted text-muted-foreground";

const AdminCalendar = () => {
  const { t, lang } = useLang();
  const { user, loading: authLoading } = useAuth();
  const isAdmin = isAdminEmail(user?.email);
  const dfLocale = lang === "fr" ? { locale: dateFnsFr } : undefined;

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
        // A newly selected date from a previous month wouldn't exist in
        // this month's data — clear it rather than showing a stale list.
        setSelectedDate(null);
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
    ? ["D", "L", "M", "M", "J", "V", "S"]
    : ["S", "M", "T", "W", "T", "F", "S"];

  const selectedEntries = selectedDate ? (days[selectedDate] ?? []) : [];

  const itemTitle = (e: DayEntry): string => {
    if (e.type === "workshop") {
      return e.workshopType === "paint" ? t("Paint Workshop", "Atelier Peinture") : t("Signature Workshop", "Atelier Signature");
    }
    const label = PRODUCT_LABELS[e.product];
    return label ? t(label.en, label.fr) : e.product;
  };

  const itemDetail = (e: DayEntry): string => {
    if (e.type === "workshop") {
      return [
        e.workshopTime,
        e.workshopParticipants != null ? `×${e.workshopParticipants}` : null,
      ].filter(Boolean).join(" · ");
    }
    const sizePart = e.size && e.product !== "diy_kit" ? sizeLabel(e.size, lang) : "";
    const shapePart = e.shape && e.shape !== "round" ? ` (${shapeLabel(e.shape, lang)})` : "";
    const flavorPart = e.flavors?.length ? ` — ${flavorLabel(e.flavors.join(","))}` : "";
    const slotPart = [e.pickupDeliverySlot, e.deliveryMethod === "delivery" ? t("Delivery", "Livraison") : t("Pickup", "Retrait")].filter(Boolean).join(" · ");
    return [`${sizePart}${shapePart}${flavorPart}`.trim(), slotPart].filter(Boolean).join(" · ");
  };

  return (
    <Layout>
      <main className="container mx-auto px-4 py-8 max-w-5xl">
        <div className="flex items-center justify-center gap-4 mb-4 text-[11px] uppercase tracking-[0.105em]">
          <Link to="/admin/orders" className="text-muted-foreground hover:text-foreground">{t("Orders", "Commandes")}</Link>
          <span className="text-foreground font-semibold">{t("Calendar", "Calendrier")}</span>
          <Link to="/admin/dashboard" className="text-muted-foreground hover:text-foreground">{t("Dashboard", "Tableau de bord")}</Link>
        </div>
        <h1 className="font-sans uppercase tracking-[0.105em] text-2xl md:text-3xl text-foreground mb-8 text-center font-semibold flex items-center justify-center gap-3">
          <CalendarDays className="w-6 h-6 text-primary" strokeWidth={1.5} />
          {t("Order Calendar", "Calendrier des commandes")}
        </h1>

        {/* Month navigation is always available, even after a failed load —
            a stuck error state with no way to try a different month (or
            retry the same one) would be a dead end. */}
        <div className="flex items-center justify-between mb-3 max-w-[300px] mx-auto md:mx-0">
          <Button variant="outline" size="icon" className="rounded-none h-8 w-8" onClick={() => setMonthCursor((d) => subMonths(d, 1))}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="font-sans text-[13px] tracking-[0.105em] font-semibold uppercase text-foreground">
            {format(monthCursor, "MMMM yyyy", dfLocale)}
          </span>
          <Button variant="outline" size="icon" className="rounded-none h-8 w-8" onClick={() => setMonthCursor((d) => addMonths(d, 1))}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>

        {loadError ? (
          <p className="text-center text-muted-foreground py-16">{loadError}</p>
        ) : (
          <div className="flex flex-col md:flex-row gap-6 items-start">
            {/* Compact calendar — single date selected at a time. */}
            <div className="w-full md:w-[300px] shrink-0">
              <div className="grid grid-cols-7 gap-0.5 mb-0.5">
                {weekDayLabels.map((d, i) => (
                  <div key={i} className="text-center text-[10px] font-medium text-muted-foreground py-1">{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-0.5 relative">
                {loading && (
                  <div className="absolute inset-0 bg-background/60 flex items-center justify-center z-10">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                )}
                {gridDays.map((day) => {
                  const key = dateKey(day);
                  const entries = days[key] ?? [];
                  const inMonth = isSameMonth(day, monthCursor);
                  const hasCancelledOnly = entries.length > 0 && entries.every((e) => e.status === "cancelled");
                  const isSelected = selectedDate === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => entries.length > 0 && setSelectedDate(isSelected ? null : key)}
                      disabled={entries.length === 0}
                      className={cn(
                        "h-9 text-xs flex flex-col items-center justify-center relative transition-colors",
                        inMonth ? "text-foreground" : "text-muted-foreground/40",
                        entries.length > 0 && !hasCancelledOnly && "cursor-pointer hover:bg-muted/60",
                        entries.length === 0 && "cursor-default",
                        isSelected && "bg-primary text-primary-foreground hover:bg-primary",
                        isToday(day) && !isSelected && "font-bold text-primary",
                      )}
                    >
                      {format(day, "d")}
                      {entries.length > 0 && (
                        <span className={cn(
                          "absolute bottom-0.5 w-1 h-1 rounded-full",
                          isSelected ? "bg-primary-foreground" : hasCancelledOnly ? "bg-muted-foreground" : "bg-primary"
                        )} />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Day list — compact, scrollable, image-first. */}
            <div className="flex-1 min-w-0 w-full">
              {!selectedDate ? (
                <p className="text-sm text-muted-foreground py-8 text-center md:text-left">
                  {t("Select a date with a marker to see that day's orders.", "Sélectionnez une date marquée pour voir les commandes de ce jour.")}
                </p>
              ) : (
                <>
                  <h2 className="font-sans text-[13px] tracking-[0.105em] font-semibold uppercase text-foreground mb-3">
                    {format(new Date(`${selectedDate}T00:00:00`), "d MMMM yyyy", dfLocale)}
                    <span className="text-muted-foreground font-normal normal-case tracking-normal ml-2">
                      ({selectedEntries.length})
                    </span>
                  </h2>
                  <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                    {selectedEntries.map((e) => (
                      <Link
                        key={e.itemId}
                        to={`/admin/order/${e.orderId}`}
                        className="flex gap-3 p-2 border border-border/60 bg-background hover:bg-secondary/30 transition-colors"
                      >
                        <div className="w-14 h-14 flex-shrink-0 bg-secondary/40 overflow-hidden">
                          {itemDisplayImage({ product: e.product, designImageUrl: e.designImageUrl, referenceImages: e.referenceImages, workshopType: e.workshopType }) && (
                            <img
                              src={itemDisplayImage({ product: e.product, designImageUrl: e.designImageUrl, referenceImages: e.referenceImages, workshopType: e.workshopType })!}
                              alt=""
                              className="w-full h-full object-cover"
                            />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-semibold text-foreground truncate">{itemTitle(e)}</p>
                            {e.total != null && <span className="text-sm font-bold text-foreground whitespace-nowrap">CHF {e.total.toFixed(2)}</span>}
                          </div>
                          <p className="text-xs text-muted-foreground truncate">{e.customerName} · {itemDetail(e)}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] font-sans tracking-[0.105em] font-medium uppercase text-foreground/70">
                              {e.orderNumber || `#${e.orderId.slice(0, 8).toUpperCase()}`}
                            </span>
                            <span className={cn("text-[10px] uppercase tracking-[0.105em] px-1.5 py-0.5", statusBadgeClass(e.status))}>
                              {e.type === "workshop" ? "ATELIER · " : ""}{e.status}
                            </span>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </main>
    </Layout>
  );
};

export default AdminCalendar;
