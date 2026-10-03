import { Fragment, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { addDays, format, parseISO } from "date-fns";
import { AlertTriangle, CakeSlice, ChevronDown, ChevronRight, Loader2, Lock, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/admin/AdminLayout";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { isAdminEmail } from "@/lib/adminAccess";
import { extractFunctionErrorMessage } from "@/lib/functionErrors";
import { flavorDescMap } from "@/data/flavorDesc";
import { cn } from "@/lib/utils";
import { BASE_LABELS, CATEGORY_LABELS, CATEGORY_ORDER, genoiseLabel, type Category, type SpongeBase, type StockUnits } from "@/lib/production";

// Admin > Production — production sheet for a period, computed server-side
// by get-production (_shared/production-stats.ts holds every counting rule).
// Read-only except the manual stock (update-production-stock).

type Badge = "awaiting_payment" | "to_accept";

interface ProdLine {
  orderId: string;
  orderNumber: string | null;
  customerName: string;
  date: string;
  slot: string | null;
  product: string | null;
  size: string | null;
  shape: string | null;
  flavourRaw: string | null;
  flavourId: string | null;
  flavourLabel: string | null;
  units: number;
  source: "website" | "manual";
  channel: string | null;
  badge: Badge | null;
  done?: boolean;
  reason?: string;
}

interface ProdRow {
  category: Category;
  ordered: number;
  done?: number;      // F15: already « Fait »
  needed?: number;    // F15: still to prepare (ordered − done)
  remaining?: number; // F15: stock − needed
  stock: number;
  toMake: number;
  surplus: number;
  awaitingPayment: number;
  toAccept: number;
  lines: ProdLine[];
}

interface ProductionData {
  summary: { ordered: number; done?: number; needed?: number; remaining?: number; stock: number; toMake: number; surplus: number; awaitingPayment: number; toAccept: number; toConfirm: number };
  sections: { base: SpongeBase; rows: ProdRow[] }[];
  toConfirm: ProdLine[];
  flavours: { flavourId: string; label: string; units: number }[];
  ingredients: { ingredient: string; units: number }[];
  stockLinked?: boolean;
  pendingReuse?: PendingReuse[];
  movements?: Movement[];
}

// F15 : gâteau préparé puis annulé (« réutilisable ? ») et journal du stock.
interface PendingReuse {
  preparationId: string; orderItemId: string; orderId: string; orderNumber: string | null; customerName: string;
  product: string | null; size: string | null; shape: string | null; preparedAt: string; preparedBy: string | null;
  needs: StockUnits[]; taken: StockUnits[]; freshUnits: number; unknownUnits: number;
}
interface Movement {
  id: string; created_at: string; created_by: string | null; sponge_base: SpongeBase; product_category: Category;
  delta: number; quantity_after: number; kind: "order_use" | "return_uncheck" | "return_cancelled" | "inventory"; note: string | null; order_number: string | null;
}
const MOVEMENT_LABELS: Record<Movement["kind"], { en: string; fr: string }> = {
  order_use: { en: "Used for an order", fr: "Utilisée pour une commande" },
  return_uncheck: { en: "Put back (« Done » undone)", fr: "Remise en stock (« Fait » décoché)" },
  return_cancelled: { en: "Put back (cancelled, reusable)", fr: "Remise en stock (annulé, réutilisable)" },
  inventory: { en: "Stock entered by hand", fr: "Saisie manuelle du stock" },
};

const INGREDIENT_LABELS: Record<string, { en: string; fr: string }> = {
  raspberry: { en: "Raspberry", fr: "Framboise" },
  ganache: { en: "Chocolate ganache", fr: "Ganache chocolat" },
  salted_caramel: { en: "Salted butter caramel", fr: "Caramel beurre salé" },
  lemon: { en: "Lemon", fr: "Citron" },
  coffee: { en: "Coffee", fr: "Café" },
  praline: { en: "Praline", fr: "Praliné" },
  pistachio: { en: "Pistachio", fr: "Pistache" },
  passion_fruit: { en: "Passion fruit", fr: "Fruit de la passion" },
  orange_blossom: { en: "Orange blossom", fr: "Fleur d'oranger" },
  cream_cheese: { en: "Cream cheese", fr: "Cream cheese" },
};

const REASON_LABELS: Record<string, { en: string; fr: string }> = {
  unknown_category: { en: "Unknown size or shape", fr: "Taille ou forme inconnue" },
  unknown_flavour: { en: "Flavour not recognised", fr: "Goût non reconnu" },
  missing_flavour: { en: "No flavour", fr: "Goût manquant" },
  several_flavours: { en: "Several flavours", fr: "Plusieurs goûts" },
  dot_missing_flavours: { en: "Dot Cake: flavours missing", fr: "Dot Cake : goûts manquants" },
  dot_too_many_flavours: { en: "Dot Cake: more flavours than the pack", fr: "Dot Cake : plus de goûts que prévu" },
  dot_unknown_pack: { en: "Dot Cake: unknown pack", fr: "Dot Cake : pack inconnu" },
  workshop_sponge_unknown: { en: "Workshop: sponge not recorded", fr: "Workshop : génoise non enregistrée" },
  workshop_sponge_after_cancellation: { en: "Workshop: sponge unknown after a partial cancellation", fr: "Workshop : génoise inconnue après annulation partielle" },
};

const PRODUCT_NAMES: Record<string, { en: string; fr: string }> = {
  bento_cake: { en: "Bento cake", fr: "Bento cake" },
  rectangle_cake: { en: "Rectangle cake", fr: "Rectangle cake" },
  dot_cakes: { en: "Dot Cakes", fr: "Dot Cakes" },
  diy_kit: { en: "Bento Kit", fr: "Bento Kit" },
  workshop: { en: "Workshop", fr: "Workshop" },
};

type Tr = (l: { en: string; fr: string }) => string;
type T = (en: string, fr: string) => string;

// Module-level (not nested in the page) so a page refresh never remounts
// them and never loses a number being typed.
const StockCell = ({ base, category, value, saving, onSave, t }: {
  base: SpongeBase; category: Category; value: number; saving: boolean;
  onSave: (base: SpongeBase, category: Category, quantity: number) => void; t: T;
}) => {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const n = Number(draft);
    if (draft.trim() === "" || !Number.isInteger(n) || n < 0) { setDraft(String(value)); return; }
    if (n !== value) onSave(base, category, n);
  };
  return (
    <span className="inline-flex items-center gap-1 justify-end">
      {saving && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
      <input
        type="number"
        min={0}
        inputMode="numeric"
        value={draft}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        aria-label={t("Stock", "Stock")}
        className="w-14 border border-input bg-background px-1.5 py-0.5 text-right text-sm rounded-none focus:outline-none focus:ring-1 focus:ring-ring"
      />
    </span>
  );
};

const AddStock = ({ base, used, open, onOpen, onClose, onSave, t, tr }: {
  base: SpongeBase; used: Set<Category>; open: boolean; onOpen: () => void; onClose: () => void;
  onSave: (base: SpongeBase, category: Category, quantity: number) => Promise<void>; t: T; tr: Tr;
}) => {
  const available = CATEGORY_ORDER.filter((c) => !used.has(c));
  const [category, setCategory] = useState<Category>(available[0] ?? "bento_round");
  const [qty, setQty] = useState("1");
  useEffect(() => { if (available.length && !available.includes(category)) setCategory(available[0]); }, [available, category]);
  if (available.length === 0) return null;
  if (!open) {
    return (
      <button type="button" onClick={onOpen} className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline">
        <Plus className="w-3 h-3" /> {t("Add stock", "Ajouter du stock")}
      </button>
    );
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
      <select value={category} onChange={(e) => setCategory(e.target.value as Category)} className="border border-input bg-background px-2 py-1 rounded-none">
        {available.map((c) => <option key={c} value={c}>{tr(CATEGORY_LABELS[c])}</option>)}
      </select>
      <input type="number" min={0} value={qty} onChange={(e) => setQty(e.target.value)} className="w-16 border border-input bg-background px-2 py-1 rounded-none" />
      <Button
        size="sm"
        className="rounded-none h-7 text-xs"
        onClick={async () => {
          const n = Number(qty);
          if (qty.trim() === "" || !Number.isInteger(n) || n < 0) return;
          await onSave(base, category, n);
          onClose();
        }}
      >
        {t("Save", "Enregistrer")}
      </Button>
      <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">{t("Cancel", "Annuler")}</button>
    </div>
  );
};

const ISO = "yyyy-MM-dd";

const AdminProduction = () => {
  const { t, lang } = useLang();
  const { user, loading: authLoading } = useAuth();
  const isAdmin = isAdminEmail(user?.email);
  const tr = (l: { en: string; fr: string }) => t(l.en, l.fr);
  const [reuseUnits, setReuseUnits] = useState<Record<string, number>>({});
  const [decidingId, setDecidingId] = useState<string | null>(null);

  const [from, setFrom] = useState(() => format(new Date(), ISO));
  const [to, setTo] = useState(() => format(addDays(new Date(), 6), ISO));
  const [data, setData] = useState<ProductionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openRows, setOpenRows] = useState<Set<string>>(new Set());
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [stockError, setStockError] = useState<string | null>(null);
  const [addingIn, setAddingIn] = useState<SpongeBase | null>(null);

  useEffect(() => {
    document.title = "Admin – Production – Bento Cake Studio";
    return () => { document.title = "Bento Cake Studio Geneva"; };
  }, []);

  const load = useCallback(async () => {
    if (!from || !to || from > to) return;
    setLoading(true);
    setLoadError(null);
    const { data: res, error } = await supabase.functions.invoke("get-production", { body: { from, to } });
    if (error || res?.error) {
      const reason = error ? await extractFunctionErrorMessage(error, "") : String(res.error);
      console.error("get-production failed:", reason || error);
      setLoadError(
        reason === "Admin sign-in required"
          ? t("Your admin session could not be verified. Please sign out and sign in again.", "Votre session administrateur n'a pas pu être vérifiée. Merci de vous déconnecter puis de vous reconnecter.")
          : reason.startsWith("Period too long")
            ? t("Please choose a period of 3 months at most.", "Merci de choisir une période de 3 mois maximum.")
            : t("Could not load production. Please try again.", "Impossible de charger la production. Merci de réessayer.")
      );
    } else {
      setData(res as ProductionData);
    }
    setLoading(false);
  }, [from, to, t]);

  useEffect(() => {
    if (authLoading || !isAdmin) { setLoading(authLoading); return; }
    load();
  }, [authLoading, isAdmin, load]);

  const saveStock = async (base: SpongeBase, category: Category, quantity: number) => {
    const key = `${base}|${category}`;
    setSavingKey(key);
    setStockError(null);
    const { data: res, error } = await supabase.functions.invoke("update-production-stock", {
      body: { sponge_base: base, product_category: category, quantity },
    });
    if (error || res?.error) {
      console.error("update-production-stock failed:", error || res?.error);
      setStockError(t("The stock could not be saved. Please try again.", "Le stock n'a pas pu être enregistré. Merci de réessayer."));
      setSavingKey(null);
      return;
    }
    setSavingKey(null);
    await load();
  };

  // Gâteau préparé puis annulé : « réutilisable » (remise en stock, au plus
  // ce qui a été préparé) ou « perdu ». Jamais automatique, une seule fois.
  const decideReuse = async (p: PendingReuse, reusable: boolean) => {
    setDecidingId(p.preparationId);
    setStockError(null);
    const units = reusable ? p.needs.map((n) => ({ ...n, units: reuseUnits[`${p.preparationId}|${n.base}|${n.category}`] ?? 0 })).filter((n) => n.units > 0) : [];
    if (reusable && units.length === 0) {
      setStockError(t("Enter how many génoises can be reused.", "Indiquez combien de génoises sont réutilisables."));
      setDecidingId(null);
      return;
    }
    const { data: res, error } = await supabase.functions.invoke("update-production-stock", {
      body: { action: "reuse", preparationId: p.preparationId, reusable, units },
    });
    if (error || res?.error) {
      const reason = error ? await extractFunctionErrorMessage(error, "") : String(res.error);
      setStockError(reason || t("The decision could not be saved.", "La décision n'a pas pu être enregistrée."));
      setDecidingId(null);
      return;
    }
    setDecidingId(null);
    await load();
  };

  const toggleRow = (key: string) => setOpenRows((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

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

  const fmtDate = (d: string) => { try { return format(parseISO(d), "dd.MM"); } catch { return d; } };
  const productText = (l: ProdLine) => {
    const name = l.product ? (PRODUCT_NAMES[l.product] ? tr(PRODUCT_NAMES[l.product]) : l.product) : "—";
    const size = l.product === "bento_cake" && l.size ? ` ${l.size}` : l.product === "dot_cakes" && l.size ? ` ${l.size.replace("dot-cakes-", "×")}` : "";
    const shape = l.shape === "heart" ? t(" heart", " cœur") : l.shape === "round" ? t(" round", " rond") : "";
    return `${name}${size}${shape}`;
  };

  const LinesTable = ({ lines, showReason }: { lines: ProdLine[]; showReason?: boolean }) => (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-1.5 pr-3 font-medium">{t("Order", "Commande")}</th>
            <th className="py-1.5 pr-3 font-medium">{t("Customer", "Client")}</th>
            <th className="py-1.5 pr-3 font-medium">{t("Date", "Date")}</th>
            <th className="py-1.5 pr-3 font-medium">{t("Slot", "Créneau")}</th>
            <th className="py-1.5 pr-3 font-medium">{t("Product", "Produit")}</th>
            <th className="py-1.5 pr-3 font-medium">{t("Flavour", "Goût")}</th>
            <th className="py-1.5 pr-3 font-medium text-right">{t("Qty", "Qté")}</th>
            <th className="py-1.5 font-medium">{showReason ? t("To check", "À vérifier") : t("Source", "Source")}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={`${l.orderId}-${i}`} className="border-t border-border/50 align-top">
              <td className="py-1.5 pr-3 whitespace-nowrap">
                <Link to={`/admin/order/${l.orderId}`} className="text-primary hover:underline">{l.orderNumber || l.orderId.slice(0, 8)}</Link>
              </td>
              <td className="py-1.5 pr-3">{l.customerName || "—"}</td>
              <td className="py-1.5 pr-3 whitespace-nowrap">{fmtDate(l.date)}</td>
              <td className="py-1.5 pr-3 whitespace-nowrap">{l.slot || "—"}</td>
              <td className="py-1.5 pr-3">{productText(l)}</td>
              <td className="py-1.5 pr-3">
                {l.flavourLabel && l.flavourLabel !== l.flavourRaw ? (
                  <>{l.flavourLabel} <span className="text-muted-foreground">({l.flavourRaw})</span></>
                ) : (l.flavourRaw || "—")}
              </td>
              <td className="py-1.5 pr-3 text-right font-medium">{l.units}</td>
              <td className="py-1.5">
                {showReason && l.reason ? (
                  <span className="text-amber-800">{REASON_LABELS[l.reason] ? tr(REASON_LABELS[l.reason]) : l.reason}</span>
                ) : (
                  <span className="flex flex-wrap gap-1 items-center">
                    <span>{l.source === "manual" ? t("Manual", "Manuel") : t("Website", "Site")}{l.channel && l.source === "manual" ? ` · ${l.channel}` : ""}</span>
                    {l.done && <span className="bg-emerald-100 text-emerald-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">{t("Done", "Fait")}</span>}
                    {l.badge === "awaiting_payment" && <span className="bg-amber-100 text-amber-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">{t("Awaiting payment", "En attente de paiement")}</span>}
                    {l.badge === "to_accept" && <span className="bg-blue-600 text-white font-semibold px-1.5 py-0.5 text-[10px] uppercase tracking-wide">{t("To accept · not counted", "À accepter · non compté")}</span>}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const s = data?.summary;

  return (
    <AdminLayout>
      <main className="container mx-auto px-4 py-8 max-w-4xl">

        <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
          <h1 className="font-sans uppercase tracking-[0.105em] text-2xl text-foreground flex items-center gap-2">
            <CakeSlice className="w-5 h-5 text-primary" strokeWidth={1.5} />
            {t("Production", "Production")}
          </h1>
          <div className="flex items-center gap-2 text-sm">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label={t("Start date", "Date de début")}
              className="border border-input bg-background px-2 py-1 rounded-none" />
            <span className="text-muted-foreground">→</span>
            <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} aria-label={t("End date", "Date de fin")}
              className="border border-input bg-background px-2 py-1 rounded-none" />
          </div>
        </div>

        <p className="text-xs text-muted-foreground mb-4">
          {t(
            "Counted by each item's own pickup / delivery / workshop date. Needed = confirmed cakes not yet done. Stock = génoises ready; « Done » with « Taken from stock » removes them.",
            "Compté selon la date de retrait / livraison / workshop de chaque article. Nécessaires = gâteaux confirmés pas encore « Fait ». Stock = génoises prêtes ; « Fait » avec « Pris dans le stock » les retire."
          )}
        </p>

        {loading && !data ? (
          <div className="text-center py-16"><Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" /></div>
        ) : loadError ? (
          <p className="text-center text-muted-foreground py-16">{loadError}</p>
        ) : data && s ? (
          <div className={cn("space-y-6 transition-opacity", loading && "opacity-60")}>
            {stockError && <p className="text-sm text-destructive">{stockError}</p>}

            {/* Summary — besoins = gâteaux confirmés pas encore « Fait » */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="production-summary">
              <div className="border border-border/60 bg-background p-4">
                <p className="text-[11px] uppercase tracking-[0.105em] text-muted-foreground mb-1">{t("Needed", "Nécessaires")}</p>
                <p className="text-3xl font-bold text-foreground">{s.needed ?? s.ordered}</p>
                <p className="text-xs text-muted-foreground mt-1">{t("ordered", "commandés")} {s.ordered}{(s.done ?? 0) > 0 ? ` · ${t("done", "faits")} ${s.done}` : ""}</p>
                {s.awaitingPayment > 0 && (
                  <p className="text-xs text-muted-foreground">{t("of which", "dont")} {s.awaitingPayment} {t("awaiting payment", "en attente de paiement")}</p>
                )}
                {s.toAccept > 0 && (
                  <p className="text-xs font-semibold text-blue-800 mt-1">+ {s.toAccept} {t("to accept (not counted until accepted)", "à accepter (non comptés tant qu'ils ne sont pas acceptés)")}</p>
                )}
              </div>
              <div className="border border-border/60 bg-background p-4">
                <p className="text-[11px] uppercase tracking-[0.105em] text-muted-foreground mb-1">{t("In stock", "En stock")}</p>
                <p className="text-3xl font-bold text-foreground">{s.stock}</p>
              </div>
              <div className="border border-border/60 bg-background p-4">
                <p className="text-[11px] uppercase tracking-[0.105em] text-muted-foreground mb-1">{t("Left after preparation", "Restant après préparation")}</p>
                <p className="text-3xl font-bold text-foreground">{s.remaining ?? s.surplus}</p>
              </div>
              <div className="border border-primary/40 bg-background p-4">
                <p className="text-[11px] uppercase tracking-[0.105em] text-muted-foreground mb-1">{t("Missing — to make", "Manque — à préparer")}</p>
                <p className="text-3xl font-bold text-primary">{s.toMake}</p>
              </div>
            </div>

            {(data.pendingReuse ?? []).length > 0 && (
              <section className="border border-amber-400 bg-background" data-testid="pending-reuse">
                <h2 className="px-4 py-2.5 border-b border-amber-300 text-sm font-semibold uppercase tracking-[0.12em] text-amber-900 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" /> {t("Prepared then cancelled — reusable?", "Préparés puis annulés — réutilisables ?")}
                </h2>
                <ul className="divide-y divide-border/60">
                  {data.pendingReuse!.map((p) => (
                    <li key={p.preparationId} className="px-4 py-3 text-sm space-y-2">
                      <p>
                        <Link to={`/admin/order/${p.orderId}`} className="font-semibold text-primary hover:underline">{p.orderNumber || p.orderId.slice(0, 8)}</Link>
                        {" · "}{p.customerName || "—"} · {t("prepared on", "préparé le")} {fmtDate(p.preparedAt.slice(0, 10))}
                      </p>
                      {p.needs.length === 0 && <p className="text-xs text-muted-foreground">{t("Base unknown: nothing to put back.", "Base inconnue : rien à remettre en stock.")}</p>}
                      {p.needs.map((n) => {
                        const k = `${p.preparationId}|${n.base}|${n.category}`;
                        return (
                          <label key={k} className="flex items-center justify-between gap-3 max-w-md">
                            <span>{genoiseLabel(n, lang)} <span className="text-muted-foreground">({t("prepared", "préparées")} : {n.units})</span></span>
                            <input type="number" min={0} max={n.units} value={reuseUnits[k] ?? 0}
                              onChange={(e) => setReuseUnits((r) => ({ ...r, [k]: Math.max(0, Math.min(n.units, Math.floor(Number(e.target.value) || 0))) }))}
                              className="w-16 border border-input bg-background px-2 py-1 text-right" aria-label={t("Reusable", "Réutilisables")} />
                          </label>
                        );
                      })}
                      <div className="flex flex-wrap gap-2">
                        {p.needs.length > 0 && (
                          <Button size="sm" className="rounded-none" disabled={decidingId === p.preparationId} onClick={() => decideReuse(p, true)}>
                            {t("Reusable — put back in stock", "Réutilisable — remettre en stock")}
                          </Button>
                        )}
                        <Button size="sm" variant="outline" className="rounded-none" disabled={decidingId === p.preparationId} onClick={() => decideReuse(p, false)}>
                          {t("Lost — stock unchanged", "Perdu — stock inchangé")}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {s.toConfirm > 0 && (
              <div className="border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>
                  {t(`${s.toConfirm} cake(s) to confirm — not counted above.`, `${s.toConfirm} gâteau(x) à confirmer — non comptés ci-dessus.`)}{" "}
                  <a href="#to-confirm" className="underline">{t("See the list", "Voir la liste")}</a>
                </span>
              </div>
            )}

            {/* Sections by sponge base */}
            {data.sections.map(({ base, rows }) => {
              const used = new Set(rows.map((r) => r.category));
              return (
                <section key={base} className="border border-border/60 bg-background">
                  <h2 className="px-4 py-2.5 border-b border-border/60 text-sm font-semibold uppercase tracking-[0.12em] text-foreground">
                    {tr(BASE_LABELS[base])}
                  </h2>
                  <div className="px-4 py-3">
                    {rows.length === 0 ? (
                      <p className="text-xs text-muted-foreground">{t("Nothing ordered, no stock.", "Rien de commandé, pas de stock.")}</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                              <th className="py-1.5 pr-3 font-medium">{t("Product", "Produit")}</th>
                              <th className="py-1.5 px-2 font-medium text-right">{t("Ordered", "Commandés")}</th>
                              <th className="py-1.5 px-2 font-medium text-right">{t("Done", "Faits")}</th>
                              <th className="py-1.5 px-2 font-medium text-right">{t("Needed", "Nécessaires")}</th>
                              <th className="py-1.5 px-2 font-medium text-right">{t("Stock", "Stock")}</th>
                              <th className="py-1.5 px-2 font-medium text-right">{t("Left after", "Restant après")}</th>
                              <th className="py-1.5 pl-2 font-medium text-right">{t("Missing", "Manque")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((r) => {
                              const key = `${base}|${r.category}`;
                              const open = openRows.has(key);
                              return (
                                <Fragment key={key}>
                                  <tr
                                    className={cn("border-t border-border/50", r.lines.length > 0 && "cursor-pointer hover:bg-secondary/40")}
                                    onClick={() => r.lines.length > 0 && toggleRow(key)}
                                  >
                                    <td className="py-2 pr-3">
                                      <span className="inline-flex items-center gap-1">
                                        {r.lines.length > 0
                                          ? (open ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />)
                                          : <span className="w-3.5" />}
                                        {tr(CATEGORY_LABELS[r.category])}
                                      </span>
                                      {r.awaitingPayment > 0 && (
                                        <span className="block pl-[18px] text-[11px] text-muted-foreground">{`${t("of which", "dont")} ${r.awaitingPayment} ${t("awaiting payment", "en attente paiement")}`}</span>
                                      )}
                                      {r.toAccept > 0 && (
                                        <span className="block pl-[18px] text-[11px] font-semibold text-blue-800">{`+ ${r.toAccept} ${t("to accept, not counted", "à accepter, non comptés")}`}</span>
                                      )}
                                    </td>
                                    <td className="py-2 px-2 text-right text-muted-foreground">{r.ordered}</td>
                                    <td className="py-2 px-2 text-right text-muted-foreground">{r.done ?? 0}</td>
                                    <td className="py-2 px-2 text-right font-semibold">{r.needed ?? r.ordered}</td>
                                    <td className="py-2 px-2 text-right"><StockCell base={base} category={r.category} value={r.stock} saving={savingKey === `${base}|${r.category}`} onSave={saveStock} t={t} /></td>
                                    <td className="py-2 px-2 text-right">{r.remaining ?? r.surplus}</td>
                                    <td className={cn("py-2 pl-2 text-right font-semibold", r.toMake > 0 ? "text-primary" : "text-muted-foreground")}>{r.toMake}</td>
                                  </tr>
                                  {open && (
                                    <tr className="bg-secondary/20">
                                      <td colSpan={7} className="px-3 py-2"><LinesTable lines={r.lines} /></td>
                                    </tr>
                                  )}
                                </Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                    <AddStock base={base} used={used} open={addingIn === base} onOpen={() => setAddingIn(base)} onClose={() => setAddingIn(null)} onSave={saveStock} t={t} tr={tr} />
                  </div>
                </section>
              );
            })}

            {/* Stock journal (F15) */}
            {data.stockLinked && (
              <details className="border border-border/60 bg-background" data-testid="stock-journal">
                <summary className="px-4 py-2.5 text-sm font-semibold uppercase tracking-[0.12em] cursor-pointer">{t("Stock journal", "Journal du stock")} ({(data.movements ?? []).length})</summary>
                {(data.movements ?? []).length === 0 ? (
                  <p className="px-4 pb-3 text-xs text-muted-foreground">{t("No movement yet.", "Aucun mouvement pour l'instant.")}</p>
                ) : (
                  <div className="overflow-x-auto px-4 pb-3">
                    <table className="w-full text-xs">
                      <thead><tr className="text-left text-muted-foreground">
                        <th className="py-1.5 pr-3 font-medium">{t("When", "Quand")}</th><th className="py-1.5 pr-3 font-medium">{t("Génoise", "Génoise")}</th>
                        <th className="py-1.5 pr-3 font-medium text-right">{t("Change", "Mouvement")}</th><th className="py-1.5 pr-3 font-medium text-right">{t("Stock after", "Stock après")}</th>
                        <th className="py-1.5 pr-3 font-medium">{t("Why", "Pourquoi")}</th><th className="py-1.5 font-medium">{t("By", "Par")}</th>
                      </tr></thead>
                      <tbody>
                        {data.movements!.map((m) => (
                          <tr key={m.id} className="border-t border-border/50 align-top">
                            <td className="py-1.5 pr-3 whitespace-nowrap">{format(parseISO(m.created_at), "dd.MM HH:mm")}</td>
                            <td className="py-1.5 pr-3">{genoiseLabel({ base: m.sponge_base, category: m.product_category }, lang)}</td>
                            <td className={cn("py-1.5 pr-3 text-right font-semibold", m.delta < 0 ? "text-red-700" : "text-emerald-700")}>{m.delta > 0 ? `+${m.delta}` : m.delta}</td>
                            <td className="py-1.5 pr-3 text-right">{m.quantity_after}</td>
                            <td className="py-1.5 pr-3">{tr(MOVEMENT_LABELS[m.kind])}{m.order_number ? ` · ${m.order_number}` : ""}{m.note ? ` · ${m.note}` : ""}</td>
                            <td className="py-1.5 text-muted-foreground">{m.created_by ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </details>
            )}

            {/* To confirm */}
            {data.toConfirm.length > 0 && (
              <section id="to-confirm" className="border border-amber-300 bg-background">
                <h2 className="px-4 py-2.5 border-b border-amber-300 text-sm font-semibold uppercase tracking-[0.12em] text-amber-900 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" /> {t("To confirm / unclassified", "À confirmer / non classé")} ({s.toConfirm})
                </h2>
                <div className="px-4 py-3"><LinesTable lines={data.toConfirm} showReason /></div>
              </section>
            )}

            {/* Flavours / fillings */}
            <section className="border border-border/60 bg-background">
              <h2 className="px-4 py-2.5 border-b border-border/60 text-sm font-semibold uppercase tracking-[0.12em] text-foreground">
                {t("Flavours / fillings", "Goûts / fourrages")}
              </h2>
              <div className="px-4 py-3">
                {data.flavours.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t("No cakes in this period.", "Aucun gâteau sur cette période.")}</p>
                ) : (
                  <table className="w-full text-sm">
                    <tbody>
                      {data.flavours.map((f) => (
                        <tr key={f.flavourId} className="border-t border-border/50 first:border-t-0">
                          <td className="py-1.5 pr-3">
                            {f.label}
                            {flavorDescMap[f.flavourId] && (
                              <span className="block text-[11px] text-muted-foreground">{tr(flavorDescMap[f.flavourId])}</span>
                            )}
                          </td>
                          <td className="py-1.5 text-right font-semibold">{f.units}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>

            {/* Ingredients to watch */}
            <section className="border border-border/60 bg-background">
              <h2 className="px-4 py-2.5 border-b border-border/60 text-sm font-semibold uppercase tracking-[0.12em] text-foreground">
                {t("Ingredients to watch", "Ingrédients à surveiller")}
              </h2>
              <div className="px-4 py-3">
                {data.ingredients.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t("No filling in this period.", "Aucun fourrage sur cette période.")}</p>
                ) : (
                  <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
                    {data.ingredients.map((i) => (
                      <li key={i.ingredient} className="flex justify-between border-b border-border/40 py-1">
                        <span>{INGREDIENT_LABELS[i.ingredient] ? tr(INGREDIENT_LABELS[i.ingredient]) : i.ingredient}</span>
                        <span className="font-semibold">{i.units} {t(i.units > 1 ? "cakes" : "cake", i.units > 1 ? "gâteaux" : "gâteau")}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          </div>
        ) : null}
      </main>
    </AdminLayout>
  );
};

export default AdminProduction;
