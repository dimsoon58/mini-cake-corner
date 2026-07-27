import { useEffect } from "react";
import { Link } from "react-router-dom";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { useLang } from "@/context/LanguageContext";

/* UI-only page. Sample data below is placeholder for design preview;
   real orders will be loaded once accounts are connected to the backend. */
type SampleOrder = {
  number: string;
  date: string;
  items: string;
  total: number;
  status: "confirmed" | "preparing" | "ready" | "completed";
};

const upcomingOrders: SampleOrder[] = [
  { number: "BCS-1042", date: "12.08.2026", items: "Heart Bomb (Medium), Strawberry", total: 65, status: "confirmed" },
  { number: "BCS-1039", date: "05.08.2026", items: "Pearl Border × Retro (Large)", total: 90, status: "preparing" },
];

const pastOrders: SampleOrder[] = [
  { number: "BCS-0987", date: "20.06.2026", items: "Roses Please (Bento), Pistachio", total: 48, status: "completed" },
  { number: "BCS-0921", date: "02.05.2026", items: "Rainbow Cake (Medium)", total: 58, status: "completed" },
];

const MyOrders = () => {
  const { t } = useLang();

  useEffect(() => {
    document.title = "My Orders – Bento Cake Studio";
    return () => { document.title = "Bento Cake Studio Geneva"; };
  }, []);

  const statusLabel = (s: SampleOrder["status"]) => ({
    confirmed: t("Confirmed", "Confirmée"),
    preparing: t("In preparation", "En préparation"),
    ready: t("Ready for pickup", "Prête au retrait"),
    completed: t("Completed", "Terminée"),
  }[s]);

  const OrderCard = ({ order, past }: { order: SampleOrder; past?: boolean }) => (
    <div className="border border-border/60 p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
      <div>
        <div className="flex items-center gap-3 mb-1.5">
          <span className="font-sans text-[13px] tracking-[0.105em] font-semibold uppercase text-foreground">
            {order.number}
          </span>
          <span className="text-[11px] uppercase tracking-[0.105em] bg-secondary text-foreground/80 px-2.5 py-1">
            {statusLabel(order.status)}
          </span>
        </div>
        <p className="text-sm text-foreground/75">{order.items}</p>
        <p className="text-xs text-muted-foreground mt-1">
          {t("Date", "Date")}: {order.date} · CHF {order.total}
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

        <section className="mb-12">
          <h2 className="font-sans uppercase tracking-[0.105em] text-sm font-semibold text-foreground mb-5">
            {t("Upcoming Orders", "Commandes à venir")}
          </h2>
          <div className="space-y-4">
            {upcomingOrders.length ? (
              upcomingOrders.map((o) => <OrderCard key={o.number} order={o} />)
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
              pastOrders.map((o) => <OrderCard key={o.number} order={o} past />)
            ) : (
              <p className="text-sm text-muted-foreground">{t("No past orders yet.", "Aucune commande passée.")}</p>
            )}
          </div>
        </section>
      </main>
    </Layout>
  );
};

export default MyOrders;
