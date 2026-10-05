import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { comptaApi, type SalesMonth } from "@/lib/compta";
import { fetchFinanceMonth, type FinanceMonth } from "@/lib/finance";
import { monthSummary, type Ranked } from "@/lib/dashboardMoney";
import { PRODUCT_LABELS, designLabel, shapeLabel, sizeLabel } from "@/lib/orderLabels";

// Tableau de bord, administratrices seulement : synthèse d'un mois avec les
// MÊMES appels que la Compta (finance-month et manage-expenses « sales_month »),
// donc les mêmes chiffres pour le même mois. Les définitions sont écrites sous
// chaque montant. Aucun bénéfice ici : il est dans la Compta (onglet Mel / Eli),
// avec les dépenses et le salaire.

const zurichMonth = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
const chf = (v: number) => `CHF ${v.toLocaleString("fr-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const productName = (r: Ranked) => {
  if (r.product === "bento_cake" || r.product === "rectangle_cake" || r.product === "dot_cakes") {
    return [r.size ? sizeLabel(r.size, "fr") : PRODUCT_LABELS[r.product]?.fr, r.shape ? shapeLabel(r.shape, "fr") : null].filter(Boolean).join(" · ");
  }
  return PRODUCT_LABELS[r.product ?? ""]?.fr ?? r.product ?? "—";
};

function Figure({ label, value, explain, k }: { label: string; value: string; explain: string; k: string }) {
  return (
    <div className="border border-border/60 px-3 py-2" data-k={k}>
      <span className="block text-[11px] uppercase tracking-[0.08em] text-muted-foreground">{label}</span>
      <span className="block text-base font-semibold tabular-nums">{value}</span>
      <span className="block text-xs text-muted-foreground mt-0.5">{explain}</span>
    </div>
  );
}

export function DashboardMonthSummary() {
  const [month, setMonth] = useState(zurichMonth);
  const [finance, setFinance] = useState<FinanceMonth | null>(null);
  const [sales, setSales] = useState<SalesMonth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [f, s] = await Promise.allSettled([fetchFinanceMonth(month), comptaApi<SalesMonth>({ action: "sales_month", month })]);
    setFinance(f.status === "fulfilled" ? f.value : null);
    setSales(s.status === "fulfilled" ? s.value : null);
    if (f.status === "rejected" || s.status === "rejected") setError("Une partie des chiffres n'a pas pu être chargée. Réessayez, ou ouvrez la Compta.");
    setLoading(false);
  }, [month]);

  useEffect(() => { load(); }, [load]);

  const m = monthSummary(finance, sales);
  return (
    <section className="border border-border/60 bg-background" data-testid="dashboard-month">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-border/60">
        <h2 className="font-sans text-[12px] tracking-[0.105em] font-semibold uppercase mr-auto">Le mois en chiffres</h2>
        <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Mois"
          className="border border-input bg-background px-2 py-1 text-sm rounded-none" />
        <Link to={`/admin/compta?month=${month}`} className="text-xs underline text-muted-foreground hover:text-foreground">Ouvrir la Compta de ce mois</Link>
      </div>
      {loading && !finance && !sales ? (
        <div className="py-6 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" /></div>
      ) : (
        <div className="p-4 space-y-4">
          {error && <p className="text-sm border border-amber-300 bg-amber-50 text-amber-900 px-3 py-2">{error}</p>}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Figure k="collected" label="Encaissé" value={finance ? chf(m.collected) : "—"}
              explain="Argent reçu ce mois, à la date du paiement (même pour une commande réalisée un autre mois)." />
            <Figure k="refunded" label="Remboursements effectués" value={finance ? chf(m.refunded) : "—"}
              explain="Argent rendu aux clients ce mois, à la date du remboursement. Une annulation pas encore remboursée n'y est pas." />
            <Figure k="net" label="Encaissements nets" value={finance ? chf(m.netCollected) : "—"}
              explain="Encaissé − remboursements effectués. Ce n'est pas un bénéfice : dépenses et salaire sont dans la Compta." />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Figure k="orders" label="Commandes vendues" value={sales ? String(m.orders) : "—"}
              explain="Commandes réalisées ce mois (retrait, livraison, séance), annulées exclues. Une commande compte une fois, même avec plusieurs gâteaux." />
            <Figure k="items" label="Gâteaux et articles vendus" value={sales ? String(m.items) : "—"}
              explain="Unités réalisées ce mois (« × 2 » = 2), annulées exclues. Un geste commercial n'enlève aucun article." />
            <Figure k="seats" label="Places de workshop" value={sales ? String(m.workshopSeats) : "—"}
              explain={`Places des séances de ce mois, annulées exclues${m.workshopSeatsCancelled ? ` (${m.workshopSeatsCancelled} annulée(s))` : ""}.`} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground mb-1">Produits les plus vendus</h3>
              {m.topProducts.length === 0 ? <p className="text-muted-foreground">—</p> : (
                <ol className="space-y-0.5" data-testid="top-products">{m.topProducts.map((r) => <li key={r.key} className="flex gap-2"><span className="flex-1">{productName(r)}</span><b className="tabular-nums">{r.units}</b></li>)}</ol>
              )}
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground mb-1">Designs les plus vendus</h3>
              {m.topDesigns.length === 0 ? <p className="text-muted-foreground">—</p> : (
                <ol className="space-y-0.5" data-testid="top-designs">{m.topDesigns.map((r) => <li key={r.key} className="flex gap-2"><span className="flex-1">{designLabel(r.key)}</span><b className="tabular-nums">{r.units}</b></li>)}</ol>
              )}
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground mb-1">Workshops du mois</h3>
              {m.workshopsByType.length === 0 ? <p className="text-muted-foreground">Aucune place vendue.</p> : (
                <ul className="space-y-0.5">{m.workshopsByType.map((w) => <li key={w.type} className="flex gap-2"><span className="flex-1">{w.type === "paint" ? "Peinture" : w.type === "signature" ? "Signature" : w.type}</span><b className="tabular-nums">{w.seats} place(s)</b></li>)}</ul>
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Classements : par quantité vendue (pas par chiffre d'affaires), articles annulés exclus. Mêmes chiffres que la Compta du même mois :
            encaissements par date de paiement, ventes par mois de réalisation. Commandes de test exclues.
          </p>
        </div>
      )}
    </section>
  );
}
