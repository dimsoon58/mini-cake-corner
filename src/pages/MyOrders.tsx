import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";

type CustomerOrder = {
  id: string;
  order_number: string | null;
  pickup_delivery_date: string | null;
  total_amount: number;
  order_validation: string;
  order_items: { design: string | null; size: string | null; flavors: string[] | null }[];
};

function formatDateCH(dateValue?: string | null): string {
  if (!dateValue) return "—";
  const [year, month, day] = dateValue.split("-");
  return year && month && day ? `${day}.${month}.${year}` : dateValue;
}

function itemsSummary(items: CustomerOrder["order_items"]): string {
  return items
    .map((item) => item.size ? `${item.size}${item.flavors?.length ? ` — ${item.flavors.join(", ")}` : ""}` : (item.design || ""))
    .filter(Boolean)
    .join(", ");
}

const MyOrders = () => {
  const { t } = useLang();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [orders, setOrders] = useState<CustomerOrder[] | null>(null);

  useEffect(() => {
    document.title = "My Orders – Bento Cake Studio";
    return () => { document.title = "Bento Cake Studio Geneva"; };
  }, []);

  useEffect(() => {
    if (!authLoading && !user) navigate("/login");
  }, [authLoading, user, navigate]);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("orders")
      .select("id, order_number, pickup_delivery_date, total_amount, order_validation, order_items(design, size, flavors)")
      .eq("customer_id", user.id)
      .order("pickup_delivery_date", { ascending: false })
      .then(({ data, error }) => {
        if (error) {
          console.error("Failed to load orders:", error);
          setOrders([]);
          return;
        }
        setOrders((data as unknown as CustomerOrder[]) ?? []);
      });
  }, [user]);

  const statusLabel = (validation: string) => ({
    pending: t("Pending confirmation", "En attente de confirmation"),
    approved: t("Confirmed", "Confirmée"),
    rejected: t("Declined", "Refusée"),
  }[validation] ?? validation);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const upcomingOrders = (orders ?? []).filter((o) => !o.pickup_delivery_date || new Date(o.pickup_delivery_date) >= today);
  const pastOrders = (orders ?? []).filter((o) => o.pickup_delivery_date && new Date(o.pickup_delivery_date) < today);

  const OrderCard = ({ order, past }: { order: CustomerOrder; past?: boolean }) => (
    <div className="border border-border/60 p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
      <div>
        <div className="flex items-center gap-3 mb-1.5">
          <span className="font-sans text-[13px] tracking-[0.105em] font-semibold uppercase text-foreground">
            {order.order_number || order.id.slice(0, 8).toUpperCase()}
          </span>
          <span className="text-[11px] uppercase tracking-[0.105em] bg-secondary text-foreground/80 px-2.5 py-1">
            {statusLabel(order.order_validation)}
          </span>
        </div>
        <p className="text-sm text-foreground/75">{itemsSummary(order.order_items) || "—"}</p>
        <p className="text-xs text-muted-foreground mt-1">
          {t("Date", "Date")}: {formatDateCH(order.pickup_delivery_date)} · CHF {order.total_amount}
        </p>
      </div>
      {past && (
        <Button
          asChild
          variant="outline"
          className="rounded-none border-primary text-primary hover:bg-primary/5 uppercase tracking-[0.105em] text-[12px] font-medium whitespace-nowrap"
        >
          <Link to="/catalog">{t("Order Again", "Commander à nouveau")}</Link>
        </Button>
      )}
    </div>
  );

  return (
    <Layout>
      <main className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="font-sans uppercase tracking-[0.105em] text-3xl md:text-4xl text-foreground mb-12 text-center">
          {t("My Orders", "Mes commandes")}
        </h1>

        {orders === null ? (
          <p className="text-sm text-muted-foreground text-center">{t("Loading...", "Chargement...")}</p>
        ) : (
          <>
            <section className="mb-12">
              <h2 className="font-sans uppercase tracking-[0.105em] text-sm font-semibold text-foreground mb-5">
                {t("Upcoming Orders", "Commandes à venir")}
              </h2>
              <div className="space-y-4">
                {upcomingOrders.length ? (
                  upcomingOrders.map((o) => <OrderCard key={o.id} order={o} />)
                ) : (
                  <p className="text-sm text-muted-foreground">{t("No upcoming orders.", "Aucune commande à venir.")}</p>
                )}
              </div>
            </section>

            <section>
              <h2 className="font-sans uppercase tracking-[0.105em] text-sm font-semibold text-foreground mb-5">
                {t("Past Orders", "Commandes passées")}
              </h2>
              <div className="space-y-4">
                {pastOrders.length ? (
                  pastOrders.map((o) => <OrderCard key={o.id} order={o} past />)
                ) : (
                  <p className="text-sm text-muted-foreground">{t("No past orders yet.", "Aucune commande passée.")}</p>
                )}
              </div>
            </section>
          </>
        )}
      </main>
    </Layout>
  );
};

export default MyOrders;
