import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { ClipboardList, Loader2, Lock, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/admin/AdminLayout";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { isAdminEmail } from "@/lib/adminAccess";
import { extractFunctionErrorMessage } from "@/lib/functionErrors";
import { cn } from "@/lib/utils";
import { CHANNEL_LABELS, formatChf, labelShape, labelSize, MANUAL_STATUS_LABELS, type ManualStatus } from "@/lib/manualOrders";
import { PRODUCT_LABELS, flavorLabel } from "@/lib/orderLabels";
import { allFlavors } from "@/data/customization";

// Admin > Manual orders — list (list-manual-orders). Orders created from the
// Admin editor can be edited while they are a draft or awaiting payment;
// legacy ORDM orders from the Notion/Make flow are shown read-only.

interface ScheduleItem { product: string; size: string | null; shape: string | null; flavors: string[]; quantity: number; participants: number | null }

interface ManualOrderRow {
  id: string;
  orderNumber: string | null;
  customerName: string;
  phone: string | null;
  email: string | null;
  company: string | null;
  channel: string | null;
  createdVia: string | null;
  editable: boolean;
  status: ManualStatus;
  paymentStatus: string | null;
  dates: string[];
  // Which cakes go with which date (absent with an older list-manual-orders).
  schedule?: { date: string | null; items: ScheduleItem[] }[];
  itemsCount: number;
  calculatedAmount: number | null;
  adjustmentAmount: number;
  finalAmount: number | null;
  paidAmount: number | null;
  confirmationSent: boolean;
  createdAt: string;
  lastEditedAt: string | null;
}

const STATUS_TABS: (ManualStatus | "all")[] = ["all", "draft", "awaiting_payment", "paid", "cancelled"];

const AdminManualOrders = () => {
  const { t, lang: l } = useLang();
  const { user, loading: authLoading } = useAuth();
  const isAdmin = isAdminEmail(user?.email);
  const tr = (l: { en: string; fr: string }) => t(l.en, l.fr);

  const [status, setStatus] = useState<ManualStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [orders, setOrders] = useState<ManualOrderRow[]>([]);
  const [counts, setCounts] = useState<Record<ManualStatus, number> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Admin – Commandes manuelles – Bento Cake Studio";
    return () => { document.title = "Bento Cake Studio Geneva"; };
  }, []);

  // Search is applied a moment after typing stops.
  useEffect(() => {
    const id = setTimeout(() => setAppliedSearch(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const { data, error } = await supabase.functions.invoke("list-manual-orders", {
      body: { status: status === "all" ? null : status, search: appliedSearch, from: from || null, to: to || null },
    });
    if (error || data?.error) {
      const reason = error ? await extractFunctionErrorMessage(error, "") : String(data.error);
      console.error("list-manual-orders failed:", reason || error);
      setLoadError(
        reason === "Admin sign-in required"
          ? t("Your admin session could not be verified. Please sign out and sign in again.", "Votre session administrateur n'a pas pu être vérifiée. Merci de vous déconnecter puis de vous reconnecter.")
          : t("Could not load manual orders. Please try again.", "Impossible de charger les commandes manuelles. Merci de réessayer.")
      );
    } else {
      setOrders(data.orders ?? []);
      setCounts(data.counts ?? null);
    }
    setLoading(false);
  }, [status, appliedSearch, from, to, t]);

  useEffect(() => {
    if (authLoading || !isAdmin) { setLoading(authLoading); return; }
    load();
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

  const fmtDate = (d: string) => { try { return format(parseISO(d), "dd.MM.yy"); } catch { return d; } };
  // Short line for one item under its date: « 2 × Bento · Cœur · Vanilla ».
  const itemLine = (it: ScheduleItem) => {
    if (it.product === "workshop") return `${t("Workshop", "Workshop")}${it.participants ? ` · ${it.participants} ${t("seat(s)", "place(s)")}` : ""}`;
    const product = PRODUCT_LABELS[it.product] ? t(PRODUCT_LABELS[it.product].en, PRODUCT_LABELS[it.product].fr) : it.product;
    const size = it.size ? labelSize(it.size, l) : "";
    // Bento : la taille suffit (« Medium ») ; Dot Cakes : « Dot Cakes 12 pièces ».
    const head = size && (it.product === "bento_cake" || size.toLowerCase().includes(product.toLowerCase())) ? size : [product, size].filter(Boolean).join(" ");
    const shape = it.shape && it.shape !== "round" ? labelShape(it.shape, l) : "";
    const flavours = it.flavors.map((f) => allFlavors.find((x) => x.id === f)?.name ?? flavorLabel(f)).filter(Boolean).join(", ");
    return `${it.quantity > 1 ? `${it.quantity} × ` : ""}${[head, shape, flavours].filter(Boolean).join(" · ")}`;
  };

  return (
    <AdminLayout>
      <main className="container mx-auto px-4 py-8 max-w-6xl">

        <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
          <h1 className="font-sans uppercase tracking-[0.105em] text-2xl text-foreground flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-primary" strokeWidth={1.5} />
            {t("Manual orders", "Commandes manuelles")}
          </h1>
          <Button asChild className="rounded-none bg-primary hover:bg-primary/90 text-primary-foreground uppercase tracking-[0.105em] text-[12px] font-medium">
            <Link to="/admin/manual-orders/new"><Plus className="w-4 h-4 mr-1" /> {t("New order", "Nouvelle commande")}</Link>
          </Button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {STATUS_TABS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={cn(
                "px-3 py-1.5 text-xs uppercase tracking-[0.08em] border transition-colors",
                status === s ? "bg-primary border-primary text-primary-foreground" : "bg-background border-border text-foreground hover:bg-secondary/50",
              )}
            >
              {s === "all" ? t("All", "Toutes") : tr(MANUAL_STATUS_LABELS[s])}
              {s !== "all" && counts && <span className="ml-1 opacity-70">({counts[s]})</span>}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3 mb-5 text-sm">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("Search: ORDM, name, phone, email", "Rechercher : ORDM, nom, téléphone, email")}
              className="w-full border border-input bg-background pl-8 pr-3 py-1.5 rounded-none"
            />
          </div>
          <span className="text-xs text-muted-foreground">{t("Pickup / delivery date", "Date de retrait / livraison")}</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border border-input bg-background px-2 py-1 rounded-none" aria-label={t("From", "Du")} />
          <span className="text-muted-foreground">→</span>
          <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="border border-input bg-background px-2 py-1 rounded-none" aria-label={t("To", "Au")} />
          {(from || to) && (
            <button type="button" onClick={() => { setFrom(""); setTo(""); }} className="text-xs text-muted-foreground hover:text-foreground underline">
              {t("Clear dates", "Effacer les dates")}
            </button>
          )}
        </div>

        {loading && orders.length === 0 ? (
          <div className="text-center py-16"><Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" /></div>
        ) : loadError ? (
          <p className="text-center text-muted-foreground py-16">{loadError}</p>
        ) : orders.length === 0 ? (
          <p className="text-center text-muted-foreground py-16">{t("No manual order matches.", "Aucune commande manuelle ne correspond.")}</p>
        ) : (
          <div className={cn("border border-border/60 bg-background overflow-x-auto transition-opacity", loading && "opacity-60")}>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[0.08em] text-muted-foreground border-b border-border/60">
                  <th className="py-2 px-3 font-medium">{t("Order", "Commande")}</th>
                  <th className="py-2 px-3 font-medium">{t("Customer", "Client")}</th>
                  <th className="py-2 px-3 font-medium">{t("Dates & items", "Dates et produits")}</th>
                  <th className="py-2 px-3 font-medium text-right">{t("Items", "Produits")}</th>
                  <th className="py-2 px-3 font-medium text-right">{t("Calculated", "Prix calculé")}</th>
                  <th className="py-2 px-3 font-medium text-right">{t("Adjustment", "Ajustement")}</th>
                  <th className="py-2 px-3 font-medium text-right">{t("Final price", "Prix final")}</th>
                  <th className="py-2 px-3 font-medium">{t("Status", "Statut")}</th>
                  <th className="py-2 px-3 font-medium">{t("Created", "Créée le")}</th>
                  <th className="py-2 px-3 font-medium" />
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="border-t border-border/50 align-top">
                    <td className="py-2 px-3 whitespace-nowrap">
                      <span className="font-medium">{o.orderNumber || "—"}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        {o.createdVia === "admin"
                          ? (o.channel && CHANNEL_LABELS[o.channel] ? tr(CHANNEL_LABELS[o.channel]) : t("Admin", "Admin"))
                          : t("Notion (legacy flow)", "Notion (ancien flux)")}
                      </span>
                    </td>
                    <td className="py-2 px-3 min-w-[180px]">
                      {o.customerName || "—"}
                      {o.company && <span className="block text-[11px] text-muted-foreground">{o.company}</span>}
                      {o.phone && <span className="block text-[11px] text-muted-foreground whitespace-nowrap">{o.phone}</span>}
                    </td>
                    <td className="py-2 px-3 min-w-[220px]" data-testid="manual-schedule">
                      {o.schedule && o.schedule.length > 0 ? (
                        <div className="space-y-1.5">
                          {o.schedule.map((g) => (
                            <div key={g.date ?? "none"}>
                              <span className="block font-medium whitespace-nowrap">{g.date ? fmtDate(g.date) : t("No date", "Sans date")}</span>
                              {g.items.map((it, k) => (
                                <span key={k} className="block text-[12px] text-muted-foreground leading-snug">{itemLine(it)}</span>
                              ))}
                            </div>
                          ))}
                        </div>
                      ) : o.dates.length === 0 ? "—" : o.dates.map((d) => <span key={d} className="block whitespace-nowrap">{fmtDate(d)}</span>)}
                    </td>
                    <td className="py-2 px-3 text-right">{o.itemsCount}</td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">{formatChf(o.calculatedAmount)}</td>
                    <td className={cn("py-2 px-3 text-right whitespace-nowrap", o.adjustmentAmount < 0 ? "text-emerald-700" : o.adjustmentAmount > 0 ? "text-amber-800" : "text-muted-foreground")}>
                      {o.adjustmentAmount === 0 ? "—" : `${o.adjustmentAmount > 0 ? "+" : "−"}${formatChf(Math.abs(o.adjustmentAmount)).replace("CHF ", "")}`}
                    </td>
                    <td className="py-2 px-3 text-right whitespace-nowrap font-semibold">{formatChf(o.finalAmount)}</td>
                    <td className="py-2 px-3">
                      <span className={cn("inline-block px-2 py-0.5 text-[10px] uppercase tracking-wide whitespace-nowrap", MANUAL_STATUS_LABELS[o.status].className)}>
                        {tr(MANUAL_STATUS_LABELS[o.status])}
                      </span>
                      {o.status === "paid" && o.confirmationSent && (
                        <span className="block text-[11px] text-muted-foreground mt-0.5">{t("Confirmation sent", "Confirmation envoyée")}</span>
                      )}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap text-muted-foreground">{fmtDate(o.createdAt.slice(0, 10))}</td>
                    <td className="py-2 px-3 whitespace-nowrap text-right">
                      <span className="inline-flex gap-3 text-xs">
                        {o.editable && (
                          <Link to={`/admin/manual-orders/${o.id}/edit`} className="text-primary hover:underline">{t("Edit", "Modifier")}</Link>
                        )}
                        <Link to={`/admin/order/${o.id}`} className="text-muted-foreground hover:text-foreground hover:underline">{t("View", "Voir")}</Link>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </AdminLayout>
  );
};

export default AdminManualOrders;
