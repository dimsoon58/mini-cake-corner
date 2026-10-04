import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import type { FinanceMonth } from "@/lib/finance";
import {
  SALES_REASON_LABELS, SALES_STATE_LABELS, frDate, money, monthTitle, orderComponentRows, salesLineLabel, salesLineNet,
  type SalesLine, type SalesMonth, type SalesOrder, type SalesOrdersMonth, type Treasury,
} from "@/lib/compta";
import { PAYMENT_LABELS, VALIDATION_LABELS } from "@/lib/customers";
import { cn } from "@/lib/utils";

// Compta du mois (F22) : les totaux du mois puis les commandes regroupées par
// numéro. Les lignes et les totaux sont ceux de F17 (une ligne par gâteau ou
// workshop, au mois de réalisation) ; rien n'est recalculé ici. Les frais et
// remises sont montrés au niveau de la commande tels qu'enregistrés ; quand
// une commande couvre plusieurs mois, la part de chaque mois est calculée au
// prorata des gâteaux (règle F17), et c'est écrit.

const WARN = "border-amber-400 bg-amber-50 text-amber-900";
const zurichDay = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date(iso)) : null);
const shortMonth = (m: string) => new Intl.DateTimeFormat("fr-CH", { month: "short", timeZone: "UTC" }).format(new Date(`${m}-01T12:00:00Z`));
const Badge = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <span className={cn("inline-block px-1.5 py-0.5 text-[11px] leading-tight border whitespace-nowrap", className ?? "border-border text-muted-foreground")}>{children}</span>
);

function Total({ label, value, explain, tone, strong, testId }: { label: string; value: string; explain: string; tone?: "warn"; strong?: boolean; testId?: string }) {
  return (
    <div className={cn("border px-3 py-2", tone === "warn" ? WARN : strong ? "border-primary/40 bg-primary/5" : "border-border/60")} data-testid={testId}>
      <span className="block text-[11px] uppercase tracking-[0.08em] text-muted-foreground">{label}</span>
      <span className="block text-base font-semibold tabular-nums">{value}</span>
      <span className="block text-xs text-muted-foreground mt-0.5">{explain}</span>
    </div>
  );
}

export function MonthTotals({ sales, finance, orders, treasury }: {
  sales: SalesMonth; finance: FinanceMonth | null; orders: SalesOrdersMonth | null; treasury: Treasury | null;
}) {
  const c = sales.cards;
  const f = finance?.cards;
  return (
    <section className="space-y-2" data-testid="month-totals">
      <h2 className="text-sm font-semibold uppercase tracking-[0.08em]">Totaux de {monthTitle(sales.month)}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        <Total testId="t-sales" strong label="Ventes nettes du mois" value={money(c.net)}
          explain="Gâteaux et workshops réalisés (retrait, livraison, séance) ce mois, après annulations et gestes commerciaux." />
        <Total testId="t-collected" label="Encaissements" value={f ? money(f.collected) : "—"}
          explain="Argent reçu ce mois, à la date du paiement — même pour une commande réalisée un autre mois." />
        <Total testId="t-refunded" label="Remboursements effectués" value={f ? money(f.refunded) : "—"} explain="Argent rendu aux clients ce mois, à la date du remboursement." />
        <Total testId="t-net-collected" label="Encaissements nets" value={f ? money(f.net) : "—"} explain="Encaissements − remboursements effectués du mois." />
        <Total testId="t-to-collect" label="Reste à encaisser" value={money(c.toCollect)} tone={c.toCollect ? "warn" : undefined}
          explain={`Ventes de ce mois pas encore payées (${c.toCollectOrders} commande(s)) — déjà comptées dans les ventes.`} />
        <Total testId="t-to-refund" label="Remboursements restant à effectuer" value={money(c.cancellationsToRefund)} tone={c.cancellationsToRefund ? "warn" : undefined}
          explain={`Articles annulés de ce mois, déjà payés, pas encore remboursés.${treasury?.customerRefundsOwed != null ? ` Toutes commandes au ${frDate(treasury.date)} : ${money(treasury.customerRefundsOwed)}.` : ""}`} />
      </div>
      {!!orders?.unpaidBefore.count && (
        <p className={cn("flex gap-2 border px-3 py-2 text-sm", WARN)} data-testid="unpaid-before">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>Impayés des mois précédents (hors de ce mois) : <strong>{money(orders.unpaidBefore.amount)}</strong> — {orders.unpaidBefore.orders.map((o) => `${o.orderNumber ?? o.orderId.slice(0, 8)} (${o.customer}, ${frDate(o.firstDate)})`).join(" · ")}</span>
        </p>
      )}
      <p className="text-sm tabular-nums" data-testid="sales-bridge">
        Ventes {money(c.gross)} − annulés {money(c.cancelled)} ({c.cancelledCount}) − gestes commerciaux {money(c.gestures)} = <strong>ventes nettes {money(c.net)}</strong>
      </p>
      <p className="text-xs text-muted-foreground">
        Ventes et encaissements sont deux lectures différentes, jamais additionnées : une commande réalisée en octobre et payée en septembre compte dans les ventes
        d'octobre et dans les encaissements de septembre — jamais un deuxième encaissement en octobre. Un article annulé est retiré des ventes une fois ; son
        remboursement n'est pas déduit en plus. Commandes de test exclues.
      </p>
    </section>
  );
}

const STATE_TONE: Record<string, string> = { cancelled: WARN, refused: WARN };

export function MonthOrders({ sales, orders }: { sales: SalesMonth; orders: SalesOrdersMonth | null }) {
  const groups = new Map<string, SalesLine[]>();
  for (const l of sales.lines) {
    const g = groups.get(l.orderId);
    if (g) g.push(l); else groups.set(l.orderId, [l]);
  }
  const info = new Map((orders?.orders ?? []).map((o) => [o.orderId, o]));
  const list = [...groups.entries()]
    .map(([id, lines]) => ({ id, lines: lines.sort((a, b) => a.serviceDate.localeCompare(b.serviceDate)), order: info.get(id) ?? null }))
    .sort((a, b) => a.lines[0].serviceDate.localeCompare(b.lines[0].serviceDate) || (a.lines[0].orderNumber ?? "").localeCompare(b.lines[0].orderNumber ?? ""));
  return (
    <section className="space-y-2" data-testid="month-orders">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-[0.08em]">Commandes du mois <span className="font-normal text-muted-foreground">({list.length})</span></h2>
        <span className="text-xs text-muted-foreground">site, manuelles, partenaires et workshops · annulées comprises</span>
      </div>
      {!orders && <p className="text-xs text-muted-foreground">Montants de la commande indisponibles (fonction pas encore mise à jour) : seules les lignes sont affichées.</p>}
      {list.length === 0 ? <p className="text-sm text-muted-foreground">Aucune commande réalisée ce mois.</p> : (
        <ul className="space-y-2">
          {list.map((g) => <OrderBlock key={g.id} lines={g.lines} order={g.order} month={sales.month} />)}
        </ul>
      )}
    </section>
  );
}

function OrderBlock({ lines, order, month }: { lines: SalesLine[]; order: SalesOrder | null; month: string }) {
  const l0 = lines[0];
  const cancelledOrder = (order?.orderValidation ?? l0.orderValidation) === "cancelled";
  const monthPart = Math.round(lines.reduce((s, l) => s + (l.state === "refused" ? 0 : Number(l.amount)), 0) * 100) / 100;
  const monthNet = Math.round(lines.reduce((s, l) => s + salesLineNet(l), 0) * 100) / 100;
  const paidDay = zurichDay(order?.paidAt ?? l0.paidAt);
  const payment = order?.paymentStatus ?? l0.paymentStatus;
  const validation = order?.orderValidation ?? l0.orderValidation;
  // « Au prorata » seulement s'il y a vraiment une répartition (plusieurs gâteaux ou plusieurs mois).
  const split = !!order?.spansMonths || lines.filter((l) => l.kind === "item").length > 1;
  const kind = order?.partnerName ? "Partenaire" : lines.every((l) => l.product === "workshop") ? "Workshop" : l0.origin === "manual" ? "Manuelle" : "Site";
  return (
    <li className={cn("border text-sm", cancelledOrder ? "border-amber-300" : "border-border/60")} data-order={l0.orderNumber ?? l0.orderId}>
      <div className="px-3 py-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 bg-secondary/30">
        <Link to={`/admin/order/${l0.orderId}`} className="font-semibold underline underline-offset-2">{l0.orderNumber ?? l0.orderId.slice(0, 8)}</Link>
        <span className="min-w-0 break-words">{l0.customer || "—"}</span>
        <Badge>{kind}{order?.partnerName ? ` · ${order.partnerName}` : ""}</Badge>
        <Badge className={cancelledOrder ? WARN : undefined}>{VALIDATION_LABELS[validation]?.fr ?? validation}</Badge>
        <Badge className={payment === "pending" ? "border-sky-300 bg-sky-50 text-sky-900" : undefined}>
          {PAYMENT_LABELS[payment]?.fr ?? payment}{paidDay && payment !== "pending" ? ` le ${frDate(paidDay)}` : ""}
        </Badge>
        {order && (
          <span className="ml-auto tabular-nums text-right text-xs sm:text-sm" data-testid="order-amounts">
            Montant {money(order.amount)}{Number(order.refunded) > 0 ? <> · remboursé <span className="text-amber-800">{money(order.refunded)}</span></> : null} · <strong>net {money(order.net)}</strong>
            {order.spansMonths && <span className="block text-xs text-muted-foreground">sur plusieurs mois : part de ce mois {money(monthNet)}</span>}
          </span>
        )}
      </div>
      <ul className="divide-y divide-border/60">
        {lines.map((l, i) => (
          <li key={`${l.itemId ?? l.kind}-${l.unitIndex}-${l.state}-${i}`} className="px-3 py-1.5 grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-3 gap-y-0.5" data-state={l.state}>
            <span className="tabular-nums text-muted-foreground whitespace-nowrap">{frDate(l.serviceDate).slice(0, 5)}</span>
            <span className="min-w-0 break-words">
              {salesLineLabel(l)}
              {l.state !== "kept" && <> <Badge className={STATE_TONE[l.state]}>{SALES_STATE_LABELS[l.state]}{l.reason ? ` · ${SALES_REASON_LABELS[l.reason] ?? l.reason}` : ""}</Badge></>}
              {Number(l.adjustment) !== 0 && <span className="block text-xs text-muted-foreground">prix {money(l.base)} {Number(l.adjustment) > 0 ? "+" : "−"} {split ? "part des" : ""} frais / remises de la commande {money(Math.abs(Number(l.adjustment)))}{split ? " (au prorata)" : ""}</span>}
              {Number(l.cancellationRefund) > 0 && <span className="block text-xs text-muted-foreground">remboursé {money(l.cancellationRefund)} (annulation)</span>}
            </span>
            <span className="text-right">
              <span className={cn("block tabular-nums", l.state !== "kept" && "line-through text-muted-foreground")}>{money(l.amount)}</span>
              {Number(l.gesture) > 0 && <span className="block text-xs tabular-nums text-amber-800">geste −{money(l.gesture)}</span>}
            </span>
          </li>
        ))}
      </ul>
      {order && (
        <details className="border-t border-border/60" data-testid="order-components">
          <summary className="cursor-pointer px-3 py-1.5 text-xs text-muted-foreground">
            Montants de la commande{order.spansMonths ? ` · sur plusieurs mois (${order.months.map(shortMonth).join(", ")}) : part de ce mois ${money(monthPart)}, répartie au prorata des gâteaux` : ""}
          </summary>
          <dl className="px-3 pb-2 text-xs space-y-0.5">
            {orderComponentRows(order.components).map((r) => (
              <div key={r.key} className="flex justify-between gap-3"><dt className="text-muted-foreground">{r.label}</dt><dd className="tabular-nums">{r.key === "items" ? money(r.amount) : `${r.amount > 0 ? "+" : "−"} ${money(Math.abs(r.amount))}`}</dd></div>
            ))}
            <div className="flex justify-between gap-3 font-semibold border-t border-border/60 pt-0.5"><dt>Montant de la commande</dt><dd className="tabular-nums">{money(order.amount)}</dd></div>
            {Number(order.refunded) > 0 && <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Remboursé (toutes dates){Number(order.refundedInMonth) > 0 ? ` · dont ce mois ${money(order.refundedInMonth)}` : ""}</dt><dd className="tabular-nums">− {money(order.refunded)}</dd></div>}
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Vente nette retenue dans {monthTitle(month)}</dt><dd className="tabular-nums">{money(monthNet)}</dd></div>
          </dl>
        </details>
      )}
    </li>
  );
}
