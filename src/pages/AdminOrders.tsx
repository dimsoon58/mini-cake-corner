import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Loader2, Lock, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { isAdminEmail } from "@/lib/adminAccess";
import { extractFunctionErrorMessage } from "@/lib/functionErrors";

type OrderSummary = {
  id: string;
  order_number: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  total_amount: number | null;
  payment_status: string | null;
  order_validation: string | null;
  physical_validation: string | null;
  fulfillment_type: string | null;
  order_failure_reason: string | null;
  pickup_delivery_date: string | null;
  delivery_method: string | null;
  created_at: string;
};

const formatDateTime = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

// Same decision-state logic as AdminOrder.tsx (kept as its own copy — a
// summary row here doesn't have the full item list to derive isWorkshopOnly
// from, so it reads fulfillment_type/order_failure_reason directly instead).
const decisionBadge = (o: OrderSummary): { label: string; className: string } => {
  const isCancelled = o.order_validation === "cancelled" || !!o.order_failure_reason;
  if (isCancelled) return { label: "CANCELLED", className: "bg-red-100 text-red-800" };
  const isWorkshopOnly = o.fulfillment_type === "workshop_only";
  const state = (isWorkshopOnly ? o.order_validation : o.physical_validation) ?? "pending";
  const className =
    state === "approved" ? "bg-emerald-100 text-emerald-800" :
    state === "pending" ? "bg-amber-100 text-amber-800" :
    "bg-red-100 text-red-800";
  const prefix = o.fulfillment_type === "mixed" ? "WS+CAKE · " : isWorkshopOnly ? "WORKSHOP · " : "";
  return { label: `${prefix}${state.toUpperCase()}`, className };
};

const AdminOrders = () => {
  const { t } = useLang();
  const { user, loading: authLoading } = useAuth();
  const isAdmin = isAdminEmail(user?.email);

  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Admin – Orders – Bento Cake Studio";
    return () => { document.title = "Bento Cake Studio Geneva"; };
  }, []);

  useEffect(() => {
    if (authLoading || !isAdmin) { setLoading(authLoading); return; }
    let cancelled = false;
    const fetchOrders = async () => {
      setLoading(true);
      setLoadError(null);
      const { data, error } = await supabase.functions.invoke("list-orders", { body: { page } });
      if (cancelled) return;
      if (error) {
        const reason = await extractFunctionErrorMessage(error, "");
        console.error("list-orders failed:", reason || error);
        setLoadError(
          reason === "Admin sign-in required"
            ? t("Your admin session could not be verified. Please sign out and sign in again.", "Votre session administrateur n'a pas pu être vérifiée. Merci de vous déconnecter puis de vous reconnecter.")
            : t("Could not load orders. Please try again.", "Impossible de charger les commandes. Merci de réessayer.")
        );
      } else if (data?.error) {
        console.error("list-orders failed:", data.error);
        setLoadError(t("Could not load orders. Please try again.", "Impossible de charger les commandes. Merci de réessayer."));
      } else {
        setOrders(data.orders ?? []);
        setHasMore(!!data.hasMore);
      }
      setLoading(false);
    };
    fetchOrders();
    return () => { cancelled = true; };
  }, [page, authLoading, isAdmin, t]);

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

  return (
    <Layout>
      <main className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="flex items-center gap-3 mb-6">
          <ClipboardList className="w-6 h-6 text-primary" />
          <h1 className="text-xl font-serif text-foreground">{t("All Orders", "Toutes les commandes")}</h1>
          {/* No grand total shown — computing it would need the same
              expensive COUNT(*) that was just removed for speed. Just the
              page number, which costs nothing extra. */}
          {orders.length > 0 && <span className="ml-auto text-sm text-muted-foreground">{t("Page", "Page")} {page + 1}</span>}
        </div>

        {loading ? (
          <div className="text-center py-16">
            <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
          </div>
        ) : loadError ? (
          <p className="text-center text-muted-foreground py-16">{loadError}</p>
        ) : orders.length === 0 ? (
          <p className="text-center text-muted-foreground py-16">{t("No orders yet.", "Aucune commande pour le moment.")}</p>
        ) : (
          <>
            <div className="space-y-2">
              {orders.map((o) => {
                const badge = decisionBadge(o);
                const customerName = `${o.first_name || ""} ${o.last_name || ""}`.trim();
                return (
                  <Link
                    key={o.id}
                    to={`/admin/order/${o.id}`}
                    className="flex items-center gap-3 p-4 rounded-lg border border-border bg-card hover:bg-muted/30 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground truncate">
                          {o.order_number || `#${o.id.slice(0, 8).toUpperCase()}`}
                        </span>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${badge.className}`}>
                          {badge.label}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground truncate">
                        {customerName || o.email} · {formatDateTime(o.created_at)}
                      </p>
                    </div>
                    <span className="font-semibold text-primary shrink-0">
                      CHF {o.total_amount != null ? Number(o.total_amount).toFixed(2) : "—"}
                    </span>
                  </Link>
                );
              })}
            </div>

            <div className="flex items-center justify-between mt-6">
              <Button
                variant="outline"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                {t("Previous", "Précédent")}
              </Button>
              <Button
                variant="outline"
                disabled={!hasMore}
                onClick={() => setPage((p) => p + 1)}
              >
                {t("Next", "Suivant")}
              </Button>
            </div>
          </>
        )}
      </main>
    </Layout>
  );
};

export default AdminOrders;
