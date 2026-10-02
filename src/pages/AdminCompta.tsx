import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, ChevronLeft, ChevronRight, Copy, Download, FileText, History, Loader2, Lock, Paperclip, Plus, Search, Settings, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import AdminLayout from "@/components/admin/AdminLayout";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { isAdminEmail } from "@/lib/adminAccess";
import { fetchFinanceMonth, type FinanceMonth } from "@/lib/finance";
import {
  CURRENCIES, MISSING_LABELS, PAYER_KIND_LABELS, STATUS_LABELS, comptaApi, frDate, inRange, money, monthBounds, monthTitle,
  shiftMonth, uploadReceipt,
  type ComptaSettings, type Expense, type ExpenseCategory, type ExpensePayer, type ExpensePeriod, type ExpenseStatus,
  type HistoryEntry, type PayerKind, type ReceiptFile,
} from "@/lib/compta";
import { PAYROLL_MISSING_LABELS, type PayrollMonth } from "@/lib/compta";
import SalaryTab from "@/components/admin/compta/SalaryTab";
import { cn } from "@/lib/utils";

// Admin > Compta (lots K1, K2). Mois + onglets : Résumé, Revenus, Dépenses,
// Salaire, Décompte Mel / Eli. Les revenus viennent de finance-month (lot 3,
// mêmes chiffres que le tableau de bord) ; les dépenses et la paie de
// manage-expenses. Aucun total ne mélange la date d'achat et la date de
// paiement ; le salaire (décompte de la fiduciaire) n'est jamais ajouté aux
// dépenses. Avances et décompte : lots K3 et K4.

type Tab = "summary" | "revenue" | "expenses" | "salary" | "settlement";
const TABS: { key: Tab; label: string }[] = [
  { key: "summary", label: "Résumé" },
  { key: "revenue", label: "Revenus" },
  { key: "expenses", label: "Dépenses" },
  { key: "salary", label: "Salaire" },
  { key: "settlement", label: "Décompte Mel / Eli" },
];
const zurichMonth = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
const zurichToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date());

const Badge = ({ children, className, title }: { children: React.ReactNode; className?: string; title?: string }) => (
  <span title={title} className={cn("inline-block px-1.5 py-0.5 text-[11px] leading-tight border whitespace-nowrap", className)}>{children}</span>
);
const WARN = "border-amber-400 bg-amber-50 text-amber-900";

function Stat({ label, value, hint, tone, strong }: { label: string; value: string; hint?: string; tone?: "warn"; strong?: boolean }) {
  return (
    <div className={cn("border px-3 py-2 min-w-0", strong ? "border-primary/40 bg-primary/5" : "border-border/60")}>
      <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
      <p className={cn("tabular-nums", strong ? "text-xl font-bold" : "text-lg font-semibold", tone === "warn" && "text-amber-700")}>{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground leading-snug">{hint}</p>}
    </div>
  );
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const AdminCompta = () => {
  const { t } = useLang();
  const { user, loading: authLoading } = useAuth();
  const isAdmin = isAdminEmail(user?.email);
  const [params, setParams] = useSearchParams();
  const month = /^\d{4}-\d{2}$/.test(params.get("month") ?? "") ? params.get("month")! : zurichMonth();
  const tab = (TABS.some((x) => x.key === params.get("tab")) ? params.get("tab") : "summary") as Tab;
  const setParam = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (v == null) p.delete(k); else p.set(k, v); }
    setParams(p, { replace: true });
  };
  const { from, to } = monthBounds(month);

  const [finance, setFinance] = useState<FinanceMonth | null>(null);
  const [financeError, setFinanceError] = useState<string | null>(null);
  const [period, setPeriod] = useState<ExpensePeriod | null>(null);
  const [settings, setSettings] = useState<ComptaSettings | null>(null);
  const [payroll, setPayroll] = useState<PayrollMonth | null>(null);
  const [payrollError, setPayrollError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Expense | "new" | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [busyExport, setBusyExport] = useState<"xlsx" | "zip" | null>(null);

  useEffect(() => {
    document.title = "Admin – Compta – Bento Cake Studio";
    return () => { document.title = "Bento Cake Studio Geneva"; };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setFinanceError(null);
    const [f, p, s, pr] = await Promise.allSettled([
      fetchFinanceMonth(month),
      comptaApi<ExpensePeriod>({ action: "period", from, to }),
      comptaApi<ComptaSettings>({ action: "settings" }),
      comptaApi<PayrollMonth>({ action: "payroll_month", month }),
    ]);
    if (pr.status === "fulfilled") { setPayroll(pr.value); setPayrollError(null); }
    else { setPayroll(null); setPayrollError(pr.reason instanceof Error ? pr.reason.message : String(pr.reason)); }
    if (f.status === "fulfilled") setFinance(f.value); else { setFinance(null); setFinanceError(f.reason instanceof Error ? f.reason.message : String(f.reason)); }
    if (p.status === "fulfilled") setPeriod(p.value); else { setPeriod(null); setError(p.reason instanceof Error ? p.reason.message : String(p.reason)); }
    if (s.status === "fulfilled") setSettings(s.value);
    setLoading(false);
  }, [month, from, to]);
  useEffect(() => { if (!authLoading && isAdmin) load(); }, [authLoading, isAdmin, load]);

  const downloadExcel = async () => {
    if (!finance || !period || busyExport) return;
    setBusyExport("xlsx");
    try {
      const [{ default: ExcelJS }, { buildComptaWorkbook, comptaFileName }] = await Promise.all([import("exceljs"), import("@/lib/comptaExport")]);
      const wb = buildComptaWorkbook(ExcelJS, finance, period, payroll);
      download(new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), comptaFileName(month));
    } catch (e) {
      console.error("Compta export failed:", e);
      setError("Le fichier Excel n'a pas pu être créé. Réessayez.");
    } finally {
      setBusyExport(null);
    }
  };
  const downloadReceipts = async () => {
    if (busyExport) return;
    setBusyExport("zip");
    setNotice(null);
    try {
      const files = await comptaApi<ReceiptFile[]>({ action: "receipts_period", from, to });
      if (!files.length) { setNotice("Aucun justificatif pour ce mois."); return; }
      const { buildReceiptsZip, receiptsZipName } = await import("@/lib/comptaExport");
      const { blob, failed } = await buildReceiptsZip(files, month, async (url) => {
        const r = await fetch(url);
        if (!r.ok) throw new Error(String(r.status));
        return r.blob();
      });
      download(blob, receiptsZipName(month));
      setNotice(failed.length ? `ZIP créé, mais ${failed.length} fichier(s) n'ont pas pu être récupérés : ${failed.join(", ")}` : `${files.length} justificatif(s) téléchargé(s).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyExport(null);
    }
  };

  if (authLoading) return <AdminLayout><main className="py-16 text-center"><Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" /></main></AdminLayout>;
  if (!user || !isAdmin) {
    return (
      <AdminLayout>
        <main className="max-w-md mx-auto px-6 py-24 text-center">
          <Lock className="w-8 h-8 mx-auto text-muted-foreground mb-4" />
          <h1 className="font-sans uppercase tracking-[0.105em] text-2xl text-foreground mb-4">
            {!user ? t("Admin sign-in required", "Connexion administrateur requise") : t("Access denied", "Accès refusé")}
          </h1>
          {!user && <Button asChild className="rounded-none"><Link to={`/login?redirect=${encodeURIComponent(window.location.pathname)}`}>{t("Sign in", "Se connecter")}</Link></Button>}
        </main>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <main className="container mx-auto px-4 py-8 max-w-6xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-sans uppercase tracking-[0.105em] text-2xl md:text-3xl text-foreground font-semibold">Compta</h1>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" className="rounded-none h-9 w-9" onClick={() => setParam({ month: shiftMonth(month, -1) })} aria-label="Mois précédent"><ChevronLeft className="w-4 h-4" /></Button>
            <span className="text-sm uppercase tracking-[0.105em] min-w-[130px] text-center" data-testid="month-label">{monthTitle(month)}</span>
            <Button variant="outline" size="icon" className="rounded-none h-9 w-9" onClick={() => setParam({ month: shiftMonth(month, 1) })} aria-label="Mois suivant"><ChevronRight className="w-4 h-4" /></Button>
            {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button className="rounded-none" onClick={() => setEditing("new")} disabled={!settings}><Plus className="w-4 h-4 mr-1" /> Ajouter une dépense</Button>
          <Button variant="outline" className="rounded-none" onClick={downloadExcel} disabled={!finance || !period || !!busyExport}>
            {busyExport === "xlsx" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Download className="w-4 h-4 mr-1" />} Télécharger Excel
          </Button>
          <Button variant="outline" className="rounded-none" onClick={downloadReceipts} disabled={!period || !!busyExport}>
            {busyExport === "zip" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Paperclip className="w-4 h-4 mr-1" />} Télécharger les justificatifs
          </Button>
        </div>

        {error && <p className="border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="alert">{error}</p>}
        {notice && <p className="border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900" role="status">{notice}</p>}

        <div className="flex overflow-x-auto border-b border-border [scrollbar-width:none]" role="tablist">
          {TABS.map((x) => (
            <button key={x.key} type="button" role="tab" aria-selected={tab === x.key} onClick={() => setParam({ tab: x.key === "summary" ? null : x.key })}
              className={cn("px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px", tab === x.key ? "border-primary text-primary font-semibold" : "border-transparent text-muted-foreground")}>
              {x.label}
            </button>
          ))}
        </div>

        {tab === "summary" && <SummaryTab finance={finance} financeError={financeError} period={period} payroll={payroll} onTab={(k) => setParam({ tab: k })} />}
        {tab === "revenue" && <RevenueTab finance={finance} financeError={financeError} />}
        {tab === "expenses" && period && settings && (
          <ExpensesTab period={period} settings={settings} from={from} to={to} onEdit={setEditing} onSettings={() => setSettingsOpen(true)} />
        )}
        {tab === "salary" && (payroll
          ? <SalaryTab payroll={payroll} month={month} onChanged={load} onNotice={setNotice} onEditExpense={setEditing} />
          : <p className="text-sm text-amber-800">{payrollError ?? "Chargement…"}</p>)}
        {tab === "settlement" && <SettlementTab period={period} />}

        {editing && settings && (
          <ExpenseDialog
            expense={editing === "new" ? null : editing}
            settings={settings}
            defaultDate={month === zurichMonth() ? zurichToday() : from}
            onClose={() => setEditing(null)}
            onSaved={(msg) => { setEditing(null); setNotice(msg); load(); }}
          />
        )}
        {settingsOpen && settings && <SettingsDialog settings={settings} onClose={() => setSettingsOpen(false)} onChanged={load} />}
      </main>
    </AdminLayout>
  );
};

// ── Résumé ───────────────────────────────────────────────────────────────
function SummaryTab({ finance, financeError, period, payroll, onTab }: { finance: FinanceMonth | null; financeError: string | null; period: ExpensePeriod | null; payroll: PayrollMonth | null; onTab: (t: Tab) => void }) {
  const c = finance?.cards;
  const tt = period?.totals;
  const issues: { text: string; tab?: Tab; href?: string }[] = [];
  if (tt?.incompleteCount) issues.push({ text: `${tt.incompleteCount} dépense(s) « À compléter »`, tab: "expenses" });
  if (tt?.engaged.unknownCount) issues.push({ text: `${tt.engaged.unknownCount} achat(s) du mois au montant CHF inconnu — non comptés`, tab: "expenses" });
  if (tt?.missingReceiptCount) issues.push({ text: `${tt.missingReceiptCount} justificatif(s) manquant(s)`, tab: "expenses" });
  if (tt?.undatedCount) issues.push({ text: `${tt.undatedCount} dépense(s) sans date d'achat`, tab: "expenses" });
  if (tt?.duplicateCount) issues.push({ text: `${tt.duplicateCount} doublon(s) possible(s) à vérifier`, tab: "expenses" });
  if (tt?.payroll?.toLinkCount) issues.push({ text: `${tt.payroll.toLinkCount} dépense(s) « Salaires » / « Charges sociales » à rattacher à une fiche de paie`, tab: "salary" });
  if (payroll && payroll.slips.length === 0) issues.push({ text: "Fiche de paie du mois non saisie", tab: "salary" });
  payroll?.slips.filter((x) => x.missing.length).forEach((x) => issues.push({ text: `${x.code} à compléter : ${x.missing.map((k) => PAYROLL_MISSING_LABELS[k]).join(", ")}`, tab: "salary" }));
  if (c?.undatedCount) issues.push({ text: `${c.undatedCount} remboursement(s) client à dater (${money(c.undated)})`, href: "/admin/refunds" });
  if (c?.toReviewCount) issues.push({ text: `${c.toReviewCount} remboursement(s) client à vérifier (${money(c.toReview)}) — non comptés`, href: "/admin/refunds?tab=review" });
  return (
    <div className="space-y-6" data-testid="summary">
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-[0.08em]">Revenus</h2>
        <p className="text-xs text-muted-foreground">Par date réelle d'encaissement et de remboursement · commandes de test exclues · mêmes chiffres que le tableau de bord.</p>
        {financeError && <p className="text-sm text-amber-800">{financeError}</p>}
        {c && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            <Stat label="Encaissé" value={money(c.collected)} hint={`${c.collectedCount} commande(s)`} />
            <Stat label="Remboursements clients" value={money(c.refunded)} hint={`${c.refundedCount} remboursement(s)`} />
            <Stat label="Revenus nets" value={money(c.net)} hint="encaissé − remboursements" strong />
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-[0.08em]">Dépenses</h2>
        <p className="text-xs text-muted-foreground">
          Deux lectures séparées, jamais additionnées entre elles : <strong>engagé</strong> = date d'achat dans le mois ; <strong>payé</strong> = date de paiement dans le mois.
          Seuls les montants CHF connus sont additionnés.
        </p>
        {tt && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Stat label="Engagé (date d'achat)" value={money(tt.engaged.known)} tone={tt.engaged.unknownCount ? "warn" : undefined}
              hint={`${tt.engaged.count} dépense(s)${tt.engaged.unknownCount ? ` · ${tt.engaged.unknownCount} montant(s) inconnu(s) non compté(s)` : ""}`} />
            <Stat label="Payé (date de paiement)" value={money(tt.paid.known)} hint={`${tt.paid.count} paiement(s)${tt.paid.unknownCount ? ` · ${tt.paid.unknownCount} inconnu(s)` : ""}`} />
            <Stat label="Avances personnelles" value={money(tt.engaged.advances)} hint={`${tt.engaged.advancesCount} achat(s) du mois payés par une personne${tt.engaged.advancesUnknownCount ? ` · ${tt.engaged.advancesUnknownCount} montant(s) inconnu(s) non compté(s)` : ""}`} tone={tt.engaged.advancesUnknownCount ? "warn" : undefined} />
            <Stat label="Reste à payer (tous mois)" value={money(tt.toPayBalance.known)} hint={`Solde à ce jour · ${tt.toPayBalance.count} dépense(s)${tt.toPayBalance.unknownCount ? ` · ${tt.toPayBalance.unknownCount} inconnue(s)` : ""}`} />
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {payroll ? (
            <button type="button" onClick={() => onTab("salary")} className="text-left">
              <Stat label="Salaire et charges (mois de salaire)" value={money(payroll.totals.cost)}
                tone={payroll.totals.costUnknownCount || payroll.slips.length === 0 ? "warn" : undefined}
                hint={payroll.slips.length === 0 ? "Fiche de paie du mois non saisie" : `Brut + charges employeur, décompte de la fiduciaire · jamais ajouté aux dépenses · net versé ce mois ${money(payroll.totals.netPaidInMonth)}`} />
            </button>
          ) : (
            <div className="border border-border/60 px-3 py-2 text-sm">
              <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Salaire et charges employeur</p>
              <p className="text-muted-foreground">Données de paie indisponibles.</p>
            </div>
          )}
          <div className="border border-border/60 px-3 py-2 text-sm">
            <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Résultat du mois</p>
            <p className="text-muted-foreground">Non calculé : la règle (date d'achat ou de paiement, traitement du salaire) doit d'abord être validée. Ce n'est jamais le solde bancaire.</p>
          </div>
        </div>
      </section>

      {tt && tt.engaged.byCategory.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-[0.08em]">Engagé par catégorie</h2>
          <ul className="border border-border/60 divide-y divide-border/60 text-sm">
            {tt.engaged.byCategory.map((x) => (
              <li key={x.category} className="flex justify-between gap-2 px-3 py-1.5">
                <span>{x.category} <span className="text-muted-foreground">({x.count})</span></span>
                <span className="tabular-nums">{money(x.known)}{x.unknownCount ? <span className="text-amber-700"> + {x.unknownCount} inconnu(s)</span> : null}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-[0.08em]">Informations manquantes</h2>
        {issues.length === 0 ? <p className="text-sm text-muted-foreground">Rien à signaler pour les dépenses et les revenus du mois.</p> : (
          <ul className="space-y-1">
            {issues.map((x) => (
              <li key={x.text}>
                {x.href
                  ? <Link to={x.href} className={cn("flex gap-2 text-sm border px-3 py-2", WARN)}><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />{x.text}</Link>
                  : <button type="button" onClick={() => x.tab && onTab(x.tab)} className={cn("w-full text-left flex gap-2 text-sm border px-3 py-2", WARN)}><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />{x.text}</button>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ── Revenus ──────────────────────────────────────────────────────────────
function RevenueTab({ finance, financeError }: { finance: FinanceMonth | null; financeError: string | null }) {
  if (financeError) return <p className="text-sm text-amber-800">{financeError}</p>;
  if (!finance) return <div className="py-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" /></div>;
  const c = finance.cards;
  const table = (title: string, rows: { key: string; date: string | null; order: string; who: string; amount: number; extra?: string }[], empty: string) => (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-[0.08em]">{title}</h2>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">{empty}</p> : (
        <ul className="border border-border/60 divide-y divide-border/60 text-sm">
          {rows.map((r) => (
            <li key={r.key} className="grid grid-cols-[80px_minmax(0,1fr)_auto] gap-2 px-3 py-1.5">
              <span className="tabular-nums">{r.date ? frDate(r.date.slice(0, 10)) : "À dater"}</span>
              <span className="min-w-0 truncate">{r.order} · {r.who}{r.extra ? <span className="text-muted-foreground"> · {r.extra}</span> : null}</span>
              <span className="tabular-nums">{money(r.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
  const zurich = (iso: string | null | undefined) => (iso ? new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date(iso)) : null);
  return (
    <div className="space-y-6" data-testid="revenue">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        <Stat label="Encaissé" value={money(c.collected)} hint={`Site ${money(c.byOrigin.website.collected)} · manuel ${money(c.byOrigin.manual.collected)}`} />
        <Stat label="Remboursements clients" value={money(c.refunded)} hint="à leur date réelle" />
        <Stat label="Revenus nets" value={money(c.net)} strong />
        <Stat label="À encaisser (tous mois)" value={money(c.toCollect)} hint={`${c.toCollectCount} commande(s) confirmée(s) non payée(s)`} />
        <Stat label="Reste à rembourser (tous mois)" value={money(c.remainingToRefund)} hint={`${c.remainingCount} commande(s)`} />
        <Stat label="À vérifier (non comptés)" value={money(c.toReview)} hint={`${c.toReviewCount} remboursement(s)`} tone={c.toReviewCount ? "warn" : undefined} />
      </div>
      {table("Encaissements du mois", finance.collections.map((x) => ({ key: x.orderId, date: zurich(x.paidAt), order: x.orderNumber ?? x.orderId.slice(0, 8), who: x.customer, amount: Number(x.amount) || 0, extra: x.origin === "manual" ? "manuelle" : "site" })), "Aucun encaissement ce mois.")}
      {table("Remboursements clients du mois", finance.refunds.map((x) => ({ key: x.id, date: zurich(x.refundedAt), order: x.orderNumber ?? x.orderId.slice(0, 8), who: x.customer, amount: Number(x.amount) || 0 })), "Aucun remboursement ce mois.")}
      {finance.undatedRefunds.length > 0 && table("À dater — hors de tout mois", finance.undatedRefunds.map((x) => ({ key: x.id, date: null, order: x.orderNumber ?? x.orderId.slice(0, 8), who: x.customer, amount: Number(x.amount) || 0 })), "")}
      <p className="text-xs text-muted-foreground">Source unique : finance-month (lot 3). Les remboursements à vérifier ne sont pas comptés ; les remboursements à dater sont hors de tout mois.</p>
    </div>
  );
}

// ── Dépenses ─────────────────────────────────────────────────────────────
type Reading = "all" | "engaged" | "paid";
function ExpensesTab({ period, settings, from, to, onEdit, onSettings }: {
  period: ExpensePeriod; settings: ComptaSettings; from: string; to: string; onEdit: (e: Expense) => void; onSettings: () => void;
}) {
  const [q, setQ] = useState("");
  const [allMonths, setAllMonths] = useState(false);
  const [searchRows, setSearchRows] = useState<Expense[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [cat, setCat] = useState("");
  const [payer, setPayer] = useState("");
  const [status, setStatus] = useState("");
  const [reading, setReading] = useState<Reading>("all");

  useEffect(() => {
    if (!allMonths) { setSearchRows(null); return; }
    let cancelled = false;
    setSearching(true);
    const id = setTimeout(() => {
      comptaApi<Expense[]>({ action: "search", q }).then((r) => { if (!cancelled) setSearchRows(r); }).catch(() => { if (!cancelled) setSearchRows([]); }).finally(() => { if (!cancelled) setSearching(false); });
    }, 300);
    return () => { cancelled = true; clearTimeout(id); };
  }, [allMonths, q]);

  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const rows = (searchRows ?? period.expenses).filter((e) => {
    if (!allMonths && q && !norm([e.code, e.supplier, e.description, e.notes, e.category_name].filter(Boolean).join(" ")).includes(norm(q))) return false;
    if (cat && e.category_id !== cat) return false;
    if (payer && e.payer_id !== payer) return false;
    if (status === "to_pay" && e.status !== "to_pay") return false;
    if (status === "paid" && e.status !== "paid") return false;
    if (status === "incomplete" && e.missing.length === 0) return false;
    if (status === "advance" && !e.personal_advance) return false;
    if (status === "duplicate" && e.duplicates.length === 0) return false;
    if (!allMonths && reading === "engaged" && !inRange(e.purchase_date, from, to)) return false;
    if (!allMonths && reading === "paid" && !(e.status === "paid" && inRange(e.paid_at, from, to))) return false;
    return true;
  });
  const select = "h-9 border border-input bg-background px-2 text-sm min-w-0";

  return (
    <div className="space-y-3" data-testid="expenses">
      <div className="flex flex-wrap items-end gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Fournisseur, description, n° DEP…" className="pl-9 rounded-none h-9" aria-label="Rechercher" />
        </div>
        <label className="flex items-center gap-2 text-sm h-9"><input type="checkbox" className="w-4 h-4" checked={allMonths} onChange={(e) => setAllMonths(e.target.checked)} />Tous les mois</label>
        <Button variant="outline" className="rounded-none h-9" onClick={onSettings}><Settings className="w-4 h-4 mr-1" /> Catégories et payeurs</Button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <select className={select} value={reading} onChange={(e) => setReading(e.target.value as Reading)} disabled={allMonths} aria-label="Lecture">
          <option value="all">Achetées ou payées ce mois</option>
          <option value="engaged">Achetées ce mois (date d'achat)</option>
          <option value="paid">Payées ce mois (date de paiement)</option>
        </select>
        <select className={select} value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Catégorie">
          <option value="">Toutes les catégories</option>
          {settings.categories.map((c) => <option key={c.id} value={c.id}>{c.name}{c.active ? "" : " (désactivée)"}</option>)}
        </select>
        <select className={select} value={payer} onChange={(e) => setPayer(e.target.value)} aria-label="Payé par">
          <option value="">Tous les payeurs</option>
          {settings.payers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select className={select} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Statut">
          <option value="">Tous les statuts</option>
          <option value="paid">Payées</option>
          <option value="to_pay">À payer</option>
          <option value="incomplete">À compléter</option>
          <option value="advance">Avances personnelles</option>
          <option value="duplicate">Doublons possibles</option>
        </select>
      </div>

      <p className="text-xs text-muted-foreground">
        {searching ? "Recherche…" : `${rows.length} dépense(s)`}
        {!allMonths && " · les dépenses sans date d'achat apparaissent dans chaque mois tant qu'elles ne sont pas complétées"}
      </p>
      <ul className="border border-border/60 divide-y divide-border/60" data-testid="expense-list">
        {rows.length === 0 && <li className="px-3 py-6 text-sm text-muted-foreground">Aucune dépense.</li>}
        {rows.map((e) => (
          <li key={e.id}>
            <button type="button" onClick={() => onEdit(e)} data-code={e.code} className="w-full text-left px-3 py-2 hover:bg-secondary/40 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1">
              <span className="min-w-0">
                <span className="block text-sm font-medium truncate">{e.supplier ?? <span className="text-muted-foreground">Fournisseur ?</span>}{e.description ? <span className="font-normal text-muted-foreground"> · {e.description}</span> : null}</span>
                <span className="block text-xs text-muted-foreground truncate">
                  {e.code} · achat {frDate(e.purchase_date)}{e.status === "paid" ? ` · payée ${frDate(e.paid_at)}` : ""} · {e.category_name ?? "sans catégorie"} · {e.payer_name ?? "payé par ?"}
                </span>
              </span>
              <span className="text-right">
                <span className="block text-sm font-semibold tabular-nums">{e.chf_amount != null ? money(e.chf_amount) : <span className="text-amber-700">CHF inconnu</span>}</span>
                {e.original_currency !== "CHF" && <span className="block text-xs text-muted-foreground tabular-nums">{money(e.original_amount, e.original_currency)}</span>}
              </span>
              <span className="col-span-2 flex flex-wrap gap-1">
                <Badge className={e.status === "paid" ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-sky-300 bg-sky-50 text-sky-900"}>{STATUS_LABELS[e.status]}</Badge>
                {e.personal_advance && <Badge className="border-violet-300 bg-violet-50 text-violet-900">Avance {e.payer_name ?? ""}</Badge>}
                {e.missing.length > 0 && <Badge className={WARN} title={e.missing.map((m) => MISSING_LABELS[m]).join(", ")}>À compléter : {e.missing.map((m) => MISSING_LABELS[m]).join(", ")}</Badge>}
                {e.duplicates.length > 0 && <Badge className="border-red-300 bg-red-50 text-red-900">Doublon possible ({e.duplicates.map((d) => d.code).join(", ")})</Badge>}
                {e.payroll_covered && <Badge className="border-slate-300 bg-slate-50 text-slate-700">Couverte par la paie{e.payroll_slip_code ? ` (${e.payroll_slip_code})` : ""} — hors dépenses</Badge>}
                {e.counted === false && !e.payroll_covered && <Badge className={WARN}>Paie — hors dépenses, à rattacher</Badge>}
                {e.attachments.length > 0 && <Badge className="border-border text-muted-foreground"><Paperclip className="inline w-3 h-3 mr-0.5" />{e.attachments.length}</Badge>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Décompte Mel / Eli ──────────────────────────────────────────────────
function SettlementTab({ period }: { period: ExpensePeriod | null }) {
  const advances = (period?.expenses ?? []).filter((e) => e.personal_advance);
  const byPerson = new Map<string, { known: number; unknown: number; n: number }>();
  for (const e of advances) {
    const k = e.payer_name ?? "—";
    const v = byPerson.get(k) ?? { known: 0, unknown: 0, n: 0 };
    v.n += 1;
    if (e.chf_amount == null) v.unknown += 1; else v.known += Number(e.chf_amount);
    byPerson.set(k, v);
  }
  return (
    <div className="space-y-4" data-testid="settlement">
      <div className={cn("border px-4 py-3 text-sm space-y-1", WARN)}>
        <p className="font-semibold">Répartition à configurer</p>
        <p>Le décompte Mel / Eli (avances à rembourser + part validée = total à verser, déjà versé, reste à verser) arrive avec les lots K3 et K4.
          Il sera un brouillon à valider manuellement ; aucun virement n'est déclenché.</p>
        <p>Aucune répartition n'est présumée : elle sera réglable et datée, avec une réserve pour Bento. Un résultat négatif ne sera jamais réparti.</p>
      </div>
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-[0.08em]">Avances personnelles saisies (achats de la période affichée)</h2>
        <p className="text-xs text-muted-foreground">Information seulement : le suivi des remboursements d'avances (partiels, reportés) arrive avec le lot K3. Chaque avance ne compte qu'une fois comme dépense.</p>
        {byPerson.size === 0 ? <p className="text-sm text-muted-foreground">Aucune avance personnelle.</p> : (
          <ul className="border border-border/60 divide-y divide-border/60 text-sm">
            {[...byPerson.entries()].map(([name, v]) => (
              <li key={name} className="flex justify-between px-3 py-1.5">
                <span>{name} <span className="text-muted-foreground">({v.n})</span></span>
                <span className="tabular-nums">{money(v.known)}{v.unknown ? <span className="text-amber-700"> + {v.unknown} montant(s) inconnu(s)</span> : null}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ── Saisie d'une dépense ─────────────────────────────────────────────────
interface Form {
  purchaseDate: string; supplier: string; description: string; categoryId: string; currency: string; customCurrency: string;
  originalAmount: string; chfAmount: string; status: ExpenseStatus; paidAt: string; payerId: string; personalAdvance: boolean;
  noReceipt: boolean; receiptMissingReason: string; notes: string;
}
const amountStr = (v: number | null | undefined) => (v == null ? "" : String(v));

function ExpenseDialog({ expense, settings, defaultDate, onClose, onSaved }: {
  expense: Expense | null; settings: ComptaSettings; defaultDate: string; onClose: () => void; onSaved: (msg: string) => void;
}) {
  const bento = settings.payers.find((p) => p.kind === "company");
  const [key] = useState(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`));
  const known = CURRENCIES.includes(expense?.original_currency ?? "CHF");
  const [f, setF] = useState<Form>(() => ({
    purchaseDate: expense ? expense.purchase_date ?? "" : defaultDate,
    supplier: expense?.supplier ?? "",
    description: expense?.description ?? "",
    categoryId: expense?.category_id ?? "",
    currency: known ? expense?.original_currency ?? "CHF" : "OTHER",
    customCurrency: known ? "" : expense?.original_currency ?? "",
    originalAmount: amountStr(expense?.original_amount),
    chfAmount: amountStr(expense?.chf_amount),
    status: expense?.status ?? "paid",
    paidAt: expense ? expense.paid_at ?? "" : defaultDate,
    payerId: expense?.payer_id ?? bento?.id ?? "",
    personalAdvance: expense?.personal_advance ?? false,
    noReceipt: !!expense?.receipt_missing_reason,
    receiptMissingReason: expense?.receipt_missing_reason ?? "",
    notes: expense?.notes ?? "",
  }));
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  // Garde contre le double clic (l'état React n'est pas encore à jour au 2e clic)
  // et identifiant de la dépense déjà créée si l'envoi d'un fichier a échoué :
  // le clic suivant met alors à jour cette dépense au lieu d'en créer une autre.
  const inFlight = useRef(false);
  const [savedId, setSavedId] = useState<string | null>(expense?.id ?? null);
  const [err, setErr] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [preview, setPreview] = useState<{ id: string; url: string; mime: string } | null>(null);
  const [attachments, setAttachments] = useState(expense?.attachments ?? []);
  const [acked, setAcked] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const payer = settings.payers.find((p) => p.id === f.payerId);
  const currency = f.currency === "OTHER" ? f.customCurrency.toUpperCase() : f.currency;
  const isChf = currency === "CHF";
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  // Lot K2 : la paie se saisit dans l'onglet Salaire ; les catégories de paie
  // ne sont plus proposées (sauf pour une dépense qui l'a déjà).
  const categories = settings.categories.filter((c) => (c.active && c.kind !== "payroll") || c.id === f.categoryId);
  const payers = settings.payers.filter((p) => p.active || p.id === f.payerId);
  const pendingPreviews = useMemo(() => files.map((file) => ({ file, url: file.type.startsWith("image/") ? URL.createObjectURL(file) : null })), [files]);
  useEffect(() => () => pendingPreviews.forEach((p) => p.url && URL.revokeObjectURL(p.url)), [pendingPreviews]);

  const choosePayer = (id: string) => {
    const p = settings.payers.find((x) => x.id === id);
    setF((x) => ({ ...x, payerId: id, personalAdvance: p ? p.kind !== "company" : false }));
  };

  const save = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setErr(null);
    try {
      const r = await comptaApi<{ id: string; code: string; replayed: boolean }>({
        action: "save", id: savedId, idempotencyKey: key,
        purchaseDate: f.purchaseDate || null, supplier: f.supplier, description: f.description, categoryId: f.categoryId || null,
        currency, originalAmount: f.originalAmount, chfAmount: isChf ? f.originalAmount : f.chfAmount,
        status: f.status, paidAt: f.status === "paid" ? f.paidAt || null : null, payerId: f.payerId || null,
        personalAdvance: f.personalAdvance, receiptMissingReason: f.noReceipt ? f.receiptMissingReason || "Pas de justificatif" : null, notes: f.notes,
      });
      setSavedId(r.id);
      const failed: string[] = [];
      for (const file of files) {
        try { await uploadReceipt(r.id, file); } catch { failed.push(file.name); }
      }
      if (failed.length) {
        setFiles(files.filter((x) => failed.includes(x.name)));
        setErr(`Dépense ${r.code} enregistrée, mais ces fichiers n'ont pas pu être envoyés : ${failed.join(", ")}. Cliquez à nouveau sur « Enregistrer » pour réessayer.`);
        return;
      }
      onSaved(`${r.code} ${expense ? "modifiée" : "enregistrée"}.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!expense) return;
    const reason = window.prompt("Raison de la suppression (obligatoire) :");
    if (!reason?.trim()) return;
    setBusy(true);
    try { await comptaApi({ action: "delete", id: expense.id, reason }); onSaved(`${expense.code} supprimée (conservée dans l'historique).`); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const view = async (id: string, mime: string) => {
    if (!expense) return;
    try { const r = await comptaApi<{ url: string }>({ action: "view_attachment", expenseId: expense.id, id }); setPreview({ id, url: r.url, mime }); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  const removeAttachment = async (id: string) => {
    if (!window.confirm("Retirer ce justificatif ? Il reste conservé dans l'historique.")) return;
    try { await comptaApi({ action: "delete_attachment", id }); setAttachments((a) => a.filter((x) => x.id !== id)); if (preview?.id === id) setPreview(null); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  const field = "rounded-none h-11 sm:h-9";
  const select = "h-11 sm:h-9 w-full border border-input bg-background px-2 text-sm";

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      {/* Pleine page sur tous les écrans : tout le formulaire visible d'un coup,
          justificatifs à gauche et champs à droite sur grand écran,
          boutons toujours visibles en bas. */}
      <DialogContent className="left-0 top-0 translate-x-0 translate-y-0 w-screen max-w-none h-[100dvh] rounded-none sm:rounded-none border-0 p-0 gap-0 flex flex-col overflow-hidden !animate-none">
        <DialogHeader className="shrink-0 border-b border-border px-4 py-3 pr-12 text-left sm:text-left">
          <div className="w-full max-w-6xl mx-auto space-y-1">
            <DialogTitle>{expense ? `Dépense ${expense.code}` : "Ajouter une dépense"}</DialogTitle>
            <DialogDescription>Les champs peuvent rester vides : la dépense sera marquée « À compléter ». Aucun taux de change n'est appliqué.</DialogDescription>
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="w-full max-w-6xl mx-auto px-4 py-4 space-y-4">
            {expense && expense.duplicates.filter((d) => !acked.includes(d.id)).length > 0 && (
              <div className={cn("border px-3 py-2 text-sm space-y-1", "border-red-300 bg-red-50 text-red-900")}>
                <p className="font-semibold flex gap-1.5"><Copy className="w-4 h-4 mt-0.5" />Doublon possible</p>
                {expense.duplicates.filter((d) => !acked.includes(d.id)).map((d) => (
                  <div key={d.id} className="flex flex-wrap items-center gap-2">
                    <span className="flex-1">{d.code} · {frDate(d.purchase_date)} · {d.supplier ?? "—"} · {money(d.chf_amount)}</span>
                    <Button size="sm" variant="outline" className="rounded-none h-7" onClick={async () => { await comptaApi({ action: "ack_duplicate", a: expense.id, b: d.id }); setAcked((a) => [...a, d.id]); }}>Ce n'est pas un doublon</Button>
                  </div>
                ))}
              </div>
            )}
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-6">
            {/* Justificatifs : en premier sur téléphone, colonne de gauche sur grand écran */}
            <section className="space-y-2 min-w-0">
              <Label className="text-xs">Justificatifs (photo ou PDF, plusieurs possibles)</Label>
              <input ref={fileInput} type="file" accept="image/*,application/pdf" multiple className="hidden"
                onChange={(e) => { const list = Array.from(e.target.files ?? []); setFiles((x) => [...x, ...list]); e.target.value = ""; }} data-testid="file-input" />
              <Button type="button" variant="outline" className="rounded-none w-full h-11 sm:h-9" onClick={() => fileInput.current?.click()} disabled={f.noReceipt}>
                <Paperclip className="w-4 h-4 mr-1" /> Ajouter une photo ou un PDF
              </Button>
              {(attachments.length > 0 || files.length > 0) && (
                <ul className="space-y-1 text-sm">
                  {attachments.map((a, i) => (
                    <li key={a.id} className="flex items-center gap-2">
                      <FileText className="w-4 h-4 shrink-0 text-muted-foreground" />
                      <button type="button" className="flex-1 min-w-0 break-all text-left underline-offset-2 hover:underline" onClick={() => view(a.id, a.mime_type)}>{expense?.code}_{i + 1} · {a.file_name}</button>
                      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => removeAttachment(a.id)} aria-label="Retirer"><Trash2 className="w-3.5 h-3.5" /></Button>
                    </li>
                  ))}
                  {pendingPreviews.map(({ file, url }, i) => (
                    <li key={`${file.name}-${i}`} className="flex items-center gap-2">
                      {url ? <img src={url} alt="" className="w-10 h-10 object-cover border" /> : <FileText className="w-4 h-4 shrink-0 text-muted-foreground" />}
                      <span className="flex-1 min-w-0 break-all">{file.name} <span className="text-muted-foreground">(envoyé à l'enregistrement)</span></span>
                      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setFiles((x) => x.filter((_, j) => j !== i))} aria-label="Retirer"><Trash2 className="w-3.5 h-3.5" /></Button>
                    </li>
                  ))}
                </ul>
              )}
              {preview && (
                <div className="border border-border/60 p-2 space-y-1 min-w-0">
                  {preview.mime.startsWith("image/")
                    ? <img src={preview.url} alt="Justificatif" className="max-h-[60vh] max-w-full mx-auto object-contain" />
                    : <a href={preview.url} target="_blank" rel="noreferrer" className="text-sm underline">Ouvrir le PDF (lien valable 5 minutes)</a>}
                </div>
              )}
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="w-4 h-4 mt-0.5" checked={f.noReceipt} onChange={(e) => set("noReceipt", e.target.checked)} />
                <span>Pas de justificatif disponible</span>
              </label>
              {f.noReceipt && <Input value={f.receiptMissingReason} onChange={(e) => set("receiptMissingReason", e.target.value)} placeholder="Pourquoi ? (ex. ticket perdu)" className={field} />}
            </section>

            <section className="grid grid-cols-2 gap-3 content-start min-w-0 [&>*]:min-w-0">
              <div className="space-y-1 col-span-2 sm:col-span-1">
                <Label className="text-xs">Devise d'origine</Label>
                <select className={select} value={f.currency} onChange={(e) => set("currency", e.target.value)}>
                  {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  <option value="OTHER">Autre…</option>
                </select>
                {f.currency === "OTHER" && <Input value={f.customCurrency} maxLength={3} onChange={(e) => set("customCurrency", e.target.value.toUpperCase())} placeholder="Code (ex. JPY)" className={field} />}
              </div>
              <div className="space-y-1 col-span-2 sm:col-span-1">
                <Label className="text-xs">{isChf ? "Montant payé (CHF)" : `Montant d'origine (${currency || "?"})`}</Label>
                <Input inputMode="decimal" value={f.originalAmount} onChange={(e) => set("originalAmount", e.target.value)} placeholder="ex. 24.90" className={field} data-testid="amount" />
              </div>
              {!isChf && (
                <div className="space-y-1 col-span-2">
                  <Label className="text-xs">Montant réellement débité en CHF</Label>
                  <Input inputMode="decimal" value={f.chfAmount} onChange={(e) => set("chfAmount", e.target.value)} placeholder="Tel qu'il apparaît sur le relevé — vide si inconnu" className={field} data-testid="chf-amount" />
                  <p className="text-[11px] text-muted-foreground">Laissez vide si vous ne le connaissez pas encore : la dépense reste « À compléter » et n'entre dans aucun total. Aucune conversion n'est estimée.</p>
                </div>
              )}
              <div className="space-y-1 col-span-2 sm:col-span-1">
                <Label className="text-xs">Date d'achat</Label>
                <Input type="date" value={f.purchaseDate} onChange={(e) => set("purchaseDate", e.target.value)} className={field} />
              </div>
              <div className="space-y-1 col-span-2 sm:col-span-1">
                <Label className="text-xs">Fournisseur ou magasin</Label>
                <Input value={f.supplier} onChange={(e) => set("supplier", e.target.value)} className={field} data-testid="supplier" />
              </div>
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Description</Label>
                <Input value={f.description} onChange={(e) => set("description", e.target.value)} className={field} />
              </div>
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Catégorie</Label>
                <select className={select} value={f.categoryId} onChange={(e) => set("categoryId", e.target.value)} data-testid="category">
                  <option value="">— à choisir —</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}{c.active ? "" : " (désactivée)"}</option>)}
                </select>
              </div>
              <div className="space-y-1 col-span-2 sm:col-span-1">
                <Label className="text-xs">Payé par</Label>
                <select className={select} value={f.payerId} onChange={(e) => choosePayer(e.target.value)} data-testid="payer">
                  <option value="">— à choisir —</option>
                  {payers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <label className="col-span-2 sm:col-span-1 flex items-start gap-2 text-sm sm:pt-6">
                <input type="checkbox" className="w-4 h-4 mt-0.5" checked={f.personalAdvance} disabled={!payer || payer.kind === "company"} onChange={(e) => set("personalAdvance", e.target.checked)} data-testid="advance" />
                <span>Avance personnelle à rembourser par Bento</span>
              </label>
              <div className="space-y-1 col-span-2 sm:col-span-1">
                <Label className="text-xs">Statut</Label>
                <div className="flex border border-input">
                  {(["paid", "to_pay"] as ExpenseStatus[]).map((s) => (
                    <button key={s} type="button" onClick={() => set("status", s)} className={cn("flex-1 h-11 sm:h-9 text-sm", f.status === s ? "bg-primary text-primary-foreground" : "bg-background")}>{STATUS_LABELS[s]}</button>
                  ))}
                </div>
              </div>
              {f.status === "paid" && (
                <div className="space-y-1 col-span-2 sm:col-span-1">
                  <Label className="text-xs">Date de paiement</Label>
                  <Input type="date" value={f.paidAt} onChange={(e) => set("paidAt", e.target.value)} className={field} />
                </div>
              )}
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Notes (facultatif)</Label>
                <Input value={f.notes} onChange={(e) => set("notes", e.target.value)} className={field} />
              </div>
            </section>
            </div>
            {history && <HistoryList entries={history} />}
          </div>
        </div>

        <div className="shrink-0 border-t border-border bg-background px-4 py-3" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
          <div className="w-full max-w-6xl mx-auto space-y-2">
            {err && <p className="border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">{err}</p>}
            <div className="flex flex-wrap items-center gap-2">
              {expense && <Button variant="ghost" size="sm" className="text-red-700" onClick={remove} disabled={busy}><Trash2 className="w-4 h-4 mr-1" /> Supprimer</Button>}
              {expense && <Button variant="ghost" size="sm" onClick={async () => setHistory(await comptaApi<HistoryEntry[]>({ action: "history", table: "expenses", id: expense.id }))}><History className="w-4 h-4 mr-1" /> Historique</Button>}
              <span className="flex-1" />
              <Button variant="outline" className="rounded-none" onClick={onClose} disabled={busy}>Annuler</Button>
              <Button className="rounded-none" onClick={save} disabled={busy} data-testid="save">{busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}Enregistrer</Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function HistoryList({ entries }: { entries: HistoryEntry[] }) {
  const ACTION: Record<string, string> = { insert: "Création", update: "Modification", delete: "Suppression" };
  const FIELDS: Record<string, string> = {
    purchase_date: "date d'achat", supplier: "fournisseur", description: "description", category_id: "catégorie", original_currency: "devise",
    original_amount: "montant d'origine", chf_amount: "montant CHF", status: "statut", paid_at: "date de paiement", payer_id: "payé par",
    personal_advance: "avance", receipt_missing_reason: "justificatif", notes: "notes",
  };
  const diff = (e: HistoryEntry) => {
    if (e.action !== "update" || !e.before || !e.after) return "";
    return Object.keys(FIELDS).filter((k) => JSON.stringify(e.before![k]) !== JSON.stringify(e.after![k]))
      .map((k) => `${FIELDS[k]} : ${String(e.before![k] ?? "—")} → ${String(e.after![k] ?? "—")}`).join(" · ");
  };
  return (
    <ul className="text-xs space-y-1 border-t border-border/60 pt-2">
      {entries.map((e, i) => (
        <li key={i}>
          <strong>{ACTION[e.action] ?? e.action}</strong> · {new Date(e.at).toLocaleString("fr-CH", { timeZone: "Europe/Zurich" })} · {e.actor ?? "—"}
          {diff(e) && <span className="text-muted-foreground"> · {diff(e)}</span>}
          {e.action === "delete" && e.after?.delete_reason ? <span className="text-muted-foreground"> · {String(e.after.delete_reason)}</span> : null}
        </li>
      ))}
    </ul>
  );
}

// ── Catégories et payeurs ────────────────────────────────────────────────
function SettingsDialog({ settings, onClose, onChanged }: { settings: ComptaSettings; onClose: () => void; onChanged: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newCat, setNewCat] = useState("");
  const [newPayer, setNewPayer] = useState("");
  const [newKind, setNewKind] = useState<PayerKind>("other");
  const run = async (body: Record<string, unknown>) => {
    setBusy(true);
    setErr(null);
    try { await comptaApi(body); onChanged(); return true; } catch (e) { setErr(e instanceof Error ? e.message : String(e)); return false; } finally { setBusy(false); }
  };
  const rename = (kind: "category" | "payer", item: ExpenseCategory | ExpensePayer) => {
    const name = window.prompt("Nouveau nom :", item.name);
    if (!name?.trim() || name.trim() === item.name) return;
    run(kind === "category"
      ? { action: "save_category", id: item.id, name, kind: (item as ExpenseCategory).kind, active: item.active }
      : { action: "save_payer", id: item.id, name, kind: (item as ExpensePayer).kind, active: item.active });
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto rounded-none">
        <DialogHeader>
          <DialogTitle>Catégories et payeurs</DialogTitle>
          <DialogDescription>Une catégorie désactivée n'est plus proposée, mais les dépenses existantes la gardent.</DialogDescription>
        </DialogHeader>
        {err && <p className="border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">{err}</p>}
        <section className="space-y-1">
          <h3 className="text-sm font-semibold">Catégories</h3>
          {settings.categories.map((c) => (
            <div key={c.id} className="flex items-center gap-2 text-sm">
              <span className={cn("flex-1", !c.active && "text-muted-foreground line-through")}>{c.name}{c.kind === "payroll" ? <span className="text-xs text-muted-foreground"> · paie</span> : null}</span>
              <Button size="sm" variant="ghost" className="h-7 px-2" disabled={busy} onClick={() => rename("category", c)}>Renommer</Button>
              <Button size="sm" variant="ghost" className="h-7 px-2" disabled={busy} onClick={() => run({ action: "save_category", id: c.id, name: c.name, kind: c.kind, active: !c.active })}>{c.active ? "Désactiver" : "Réactiver"}</Button>
            </div>
          ))}
          <div className="flex gap-2 pt-1">
            <Input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="Nouvelle catégorie" className="rounded-none h-9" />
            <Button size="sm" className="rounded-none h-9" disabled={busy || !newCat.trim()} onClick={async () => { if (await run({ action: "save_category", name: newCat })) setNewCat(""); }}>Ajouter</Button>
          </div>
        </section>
        <section className="space-y-1 border-t border-border/60 pt-3">
          <h3 className="text-sm font-semibold">Payé par</h3>
          {settings.payers.map((p) => (
            <div key={p.id} className="flex items-center gap-2 text-sm">
              <span className={cn("flex-1", !p.active && "text-muted-foreground line-through")}>{p.name} <span className="text-xs text-muted-foreground">· {PAYER_KIND_LABELS[p.kind]}</span></span>
              <Button size="sm" variant="ghost" className="h-7 px-2" disabled={busy} onClick={() => rename("payer", p)}>Renommer</Button>
              {p.kind !== "company" && <Button size="sm" variant="ghost" className="h-7 px-2" disabled={busy} onClick={() => run({ action: "save_payer", id: p.id, name: p.name, kind: p.kind, active: !p.active })}>{p.active ? "Désactiver" : "Réactiver"}</Button>}
            </div>
          ))}
          <div className="flex flex-wrap gap-2 pt-1">
            <Input value={newPayer} onChange={(e) => setNewPayer(e.target.value)} placeholder="Nom" className="rounded-none h-9 flex-1 min-w-[120px]" />
            <select value={newKind} onChange={(e) => setNewKind(e.target.value as PayerKind)} className="h-9 border border-input bg-background px-2 text-sm">
              {(["other", "employee", "partner"] as PayerKind[]).map((k) => <option key={k} value={k}>{PAYER_KIND_LABELS[k]}</option>)}
            </select>
            <Button size="sm" className="rounded-none h-9" disabled={busy || !newPayer.trim()} onClick={async () => { if (await run({ action: "save_payer", name: newPayer, kind: newKind })) setNewPayer(""); }}>Ajouter</Button>
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}

export default AdminCompta;
