import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, Loader2, Lock, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import AdminLayout from "@/components/admin/AdminLayout";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { isAdminEmail } from "@/lib/adminAccess";
import {
  ANOMALY_LABELS, SOURCE_LABELS, chf, describeMethod, formatDay, itemLabel, num, refundsApi, zurichToday,
  type RefundAnomaly, type RefundItem, type RefundMethod,
} from "@/lib/refunds";
import { cn } from "@/lib/utils";
import { useSessionPin } from "@/lib/adminSession";
import { PasswordInput } from "@/components/ui/password-input";

// Admin > Remboursements (lot 2). Three tabs:
//   Effectués   — refunds actually made in the chosen period (by their real
//                 date, Europe/Zurich), with the period total; refunds
//                 without a known date are listed apart, never in a period;
//   À effectuer — orders with an amount decided but not yet refunded;
//   À vérifier  — possible duplicates / over the amount collected (never
//                 counted until checked on the order page) and anomalies.
// Test orders are hidden unless « Afficher les tests » is ticked.

type Tab = "done" | "todo" | "review";
type Origin = "website" | "manual";
interface DoneRow { id: string; orderId: string; orderNumber: string | null; customerName: string; origin: Origin; isTest: boolean; orderPaidAt?: string | null; amount: number; refundedAt: string | null; createdAt: string; method: RefundMethod | null; methodDetail: string | null; reference: string | null; note: string | null; source: string; items: RefundItem[] }
interface DoneData { rows: DoneRow[]; total: number; count: number; undated: DoneRow[]; undatedTotal: number; undatedCount: number }
interface TodoRow { orderId: string; orderNumber: string | null; customerName: string; origin: Origin; isTest: boolean; collected: number; decided: number; refunded: number; remaining: number; toReviewCount: number; lastDecisionAt: string | null; reasons: string[] }
interface TodoData { rows: TodoRow[]; total: number; count: number }
interface ReviewRow { id: string; orderId: string; orderNumber: string | null; customerName: string; origin: Origin; isTest: boolean; amount: number; refundedAt: string | null; createdAt: string; source: string; reference: string | null; reviewReason: string | null; duplicateOf: { id: string; amount: number; source: string; refundedAt: string | null; createdAt: string } | null }
interface ReviewData { rows: ReviewRow[]; amount: number; count: number; anomalies: RefundAnomaly[] }

const monthBounds = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, "0")}` };
};

const AdminRefunds = () => {
  const { t, lang } = useLang();
  const l = lang === "en" ? "en" : "fr";
  const { user, loading: authLoading } = useAuth();
  const isAdmin = isAdminEmail(user?.email);
  const [params, setParams] = useSearchParams();

  const tab = (["done", "todo", "review"].includes(params.get("tab") ?? "") ? params.get("tab") : "done") as Tab;
  const thisMonth = zurichToday().slice(0, 7);
  const from = params.get("from") ?? monthBounds(thisMonth).from;
  const to = params.get("to") ?? monthBounds(thisMonth).to;
  const includeTests = params.get("tests") === "1";
  const setParam = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v == null) p.delete(k);
      else p.set(k, v);
    }
    setParams(p, { replace: true });
  };

  const [done, setDone] = useState<DoneData | null>(null);
  const [todo, setTodo] = useState<TodoData | null>(null);
  const [review, setReview] = useState<ReviewData | null>(null);
  const [counts, setCounts] = useState<{ todo: number | null; review: number | null }>({ todo: null, review: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pin, setPin, pinBySession] = useSessionPin();
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    document.title = "Admin – Remboursements – Bento Cake Studio";
    return () => { document.title = "Bento Cake Studio Geneva"; };
  }, []);

  const periodError = !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from
    ? t("Choose a valid period.", "Choisissez une période valide.") : null;

  const load = useCallback(async () => {
    if (tab === "done" && periodError) return;
    setLoading(true);
    setError(null);
    try {
      if (tab === "done") setDone(await refundsApi<DoneData>({ action: "list", tab, from, to, includeTests }));
      if (tab === "todo") setTodo(await refundsApi<TodoData>({ action: "list", tab, includeTests }));
      if (tab === "review") setReview(await refundsApi<ReviewData>({ action: "list", tab, includeTests }));
      // Tab counters (light: two small calls).
      const [tt, rv] = await Promise.all([
        refundsApi<TodoData>({ action: "list", tab: "todo", includeTests }),
        refundsApi<ReviewData>({ action: "list", tab: "review", includeTests }),
      ]);
      setCounts({ todo: tt.count, review: num(rv.count) + rv.anomalies.length });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [tab, from, to, includeTests, periodError]);

  useEffect(() => { if (!authLoading && isAdmin) load(); }, [authLoading, isAdmin, load]);

  if (authLoading) return <AdminLayout><main className="py-16 text-center"><Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" /></main></AdminLayout>;
  if (!user || !isAdmin) {
    return (
      <AdminLayout>
        <main className="max-w-md mx-auto px-6 py-24 text-center">
          <Lock className="w-8 h-8 mx-auto text-muted-foreground mb-4" />
          <h1 className="font-sans uppercase tracking-[0.105em] text-2xl text-foreground mb-4">
            {!user ? t("Admin sign-in required", "Connexion administrateur requise") : t("Access denied", "Accès refusé")}
          </h1>
          {!user && (
            <Button asChild className="rounded-none"><Link to={`/login?redirect=${encodeURIComponent(window.location.pathname)}`}>{t("Sign in", "Se connecter")}</Link></Button>
          )}
        </main>
      </AdminLayout>
    );
  }

  const OrderLink = ({ id, number, isTest }: { id: string; number: string | null; isTest: boolean }) => (
    <span className="inline-flex items-center gap-1.5">
      <Link to={`/admin/order/${id}`} className="font-medium underline underline-offset-2 hover:text-primary">{number ?? id.slice(0, 8)}</Link>
      {isTest && <span className="px-1.5 py-0.5 text-[10px] font-medium bg-purple-100 text-purple-900">TEST</span>}
    </span>
  );
  const originLabel = (o: Origin) => (o === "manual" ? t("Manual", "Manuelle") : t("Website", "Site"));

  const resolveAnomaly = async (id: number) => {
    if (!pin.trim()) { setError(t("Enter the admin PIN first.", "Saisissez d'abord le code PIN administrateur.")); return; }
    setBusy(id);
    try { await refundsApi({ action: "resolve_anomaly", anomalyId: id, pin }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  const tabs: { key: Tab; label: string; count?: number | null }[] = [
    { key: "done", label: t("Made", "Effectués") },
    { key: "todo", label: t("To make", "À effectuer"), count: counts.todo },
    { key: "review", label: t("To check", "À vérifier"), count: counts.review },
  ];

  const doneRow = (r: DoneRow, undated = false) => (
    <li key={r.id} className="px-4 py-3 text-sm flex flex-wrap gap-x-4 gap-y-1 items-baseline" data-row={r.id}>
      <span className="w-24 shrink-0 tabular-nums text-muted-foreground">{undated ? t("No date", "À dater") : formatDay(r.refundedAt, l)}</span>
      <span className="min-w-[160px] flex-1">
        <OrderLink id={r.orderId} number={r.orderNumber} isTest={r.isTest} /> · {r.customerName} · <span className="text-muted-foreground">{originLabel(r.origin)}</span>
        {r.items.length > 0 && <span className="block text-xs text-muted-foreground">{r.items.map((it) => itemLabel(it, l)).join(", ")}</span>}
        {r.orderPaidAt && <span className="block text-xs text-muted-foreground">{t("Order paid", "Commande encaissée le")} {formatDay(r.orderPaidAt, l)}</span>}
      </span>
      <span className="text-muted-foreground">{describeMethod(r.method, r.methodDetail, l)}{r.reference ? ` · ${t("Ref.", "Réf.")} ${r.reference}` : ""}</span>
      <span className="text-xs px-1.5 py-0.5 bg-secondary">{SOURCE_LABELS[r.source]?.[l] ?? r.source}</span>
      <span className="ml-auto font-semibold tabular-nums">{chf(r.amount)}</span>
    </li>
  );

  return (
    <AdminLayout>
      <main className="container mx-auto px-4 py-8 max-w-5xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-sans uppercase tracking-[0.105em] text-2xl md:text-3xl text-foreground font-semibold">{t("Refunds", "Remboursements")}</h1>
          <Button variant="outline" onClick={load} disabled={loading} className="rounded-none" aria-label={t("Refresh", "Actualiser")}>
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
          </Button>
        </div>

        <div role="tablist" className="grid grid-cols-3 sm:flex border-b border-border/60">
          {tabs.map((tb) => (
            <button key={tb.key} role="tab" aria-selected={tab === tb.key} type="button"
              onClick={() => setParam({ tab: tb.key === "done" ? null : tb.key })}
              className={cn("px-2 sm:px-4 py-2 text-sm text-center border-b-2 -mb-px", tab === tb.key ? "border-primary text-primary font-semibold" : "border-transparent text-foreground/80 hover:text-foreground")}>
              {tb.label}{tb.count != null ? ` (${tb.count})` : ""}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          {tab === "done" && (
            <>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{t("Month", "Mois")}</Label>
                <Input type="month" value={from.slice(0, 7) === to.slice(0, 7) ? from.slice(0, 7) : ""} onChange={(e) => e.target.value && setParam(monthBounds(e.target.value))} className="w-44 rounded-none" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{t("From", "Du")}</Label>
                <Input type="date" value={from} onChange={(e) => e.target.value && setParam({ from: e.target.value })} className="w-40 rounded-none px-2 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{t("To", "Au")}</Label>
                <Input type="date" value={to} onChange={(e) => e.target.value && setParam({ to: e.target.value })} className="w-40 rounded-none px-2 text-sm" />
              </div>
            </>
          )}
          <label className="flex items-center gap-2 text-sm pb-2">
            <input type="checkbox" className="w-4 h-4" checked={includeTests} onChange={(e) => setParam({ tests: e.target.checked ? "1" : null })} />
            {t("Show tests", "Afficher les tests")}
          </label>
          {tab === "review" && !pinBySession && (
            <div className="space-y-1 ml-auto">
              <Label className="text-xs text-muted-foreground">{t("Admin PIN", "Code PIN administrateur")}</Label>
              <PasswordInput autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} className="w-32 rounded-none" />
            </div>
          )}
        </div>

        {(error || (tab === "done" && periodError)) && (
          <div className="border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {error ?? periodError}
          </div>
        )}

        {/* Effectués */}
        {tab === "done" && done && !periodError && (
          <section className="space-y-4" data-tab="done">
            <div className="border border-border/60">
              <div className="flex justify-between px-4 py-2.5 bg-secondary/30 border-b border-border/60 text-sm font-semibold">
                <span>{formatDay(from, l)} – {formatDay(to, l)} · {done.count} {t("refund(s)", "remboursement(s)")}</span>
                <span className="tabular-nums" data-total>{chf(done.total)}</span>
              </div>
              {done.rows.length === 0
                ? <p className="px-4 py-5 text-sm text-muted-foreground">{t("No refund made in this period.", "Aucun remboursement effectué sur cette période.")}</p>
                : <ul className="divide-y divide-border/60">{done.rows.map((r) => doneRow(r))}</ul>}
            </div>
            {done.undatedCount > 0 && (
              <div className="border border-amber-200" data-undated>
                <div className="flex justify-between px-4 py-2.5 bg-amber-50 border-b border-amber-200 text-sm font-semibold text-amber-900">
                  <span>{t("Without a date (in no period) — date them from the order page", "À dater (hors période) — à dater depuis la fiche commande")} · {done.undatedCount}</span>
                  <span className="tabular-nums">{chf(done.undatedTotal)}</span>
                </div>
                <ul className="divide-y divide-border/60">{done.undated.map((r) => doneRow(r, true))}</ul>
              </div>
            )}
          </section>
        )}

        {/* À effectuer */}
        {tab === "todo" && todo && (
          <section className="border border-border/60" data-tab="todo">
            <div className="flex justify-between px-4 py-2.5 bg-secondary/30 border-b border-border/60 text-sm font-semibold">
              <span>{todo.count} {t("order(s)", "commande(s)")}</span>
              <span className="tabular-nums">{t("Left to refund", "Reste à rembourser")} : {chf(todo.total)}</span>
            </div>
            {todo.rows.length === 0 ? <p className="px-4 py-5 text-sm text-muted-foreground">{t("Nothing left to refund.", "Rien à rembourser.")}</p> : (
              <ul className="divide-y divide-border/60">
                {todo.rows.map((r) => (
                  <li key={r.orderId} className="px-4 py-3 text-sm flex flex-wrap gap-x-4 gap-y-1 items-baseline" data-row={r.orderId}>
                    <span className="min-w-[160px] flex-1">
                      <OrderLink id={r.orderId} number={r.orderNumber} isTest={r.isTest} /> · {r.customerName} · <span className="text-muted-foreground">{originLabel(r.origin)}</span>
                      {r.reasons.length > 0 && <span className="block text-xs text-muted-foreground">{r.reasons.join(" · ")}</span>}
                      {r.toReviewCount > 0 && <span className="block text-xs text-amber-800">{r.toReviewCount} {t("to check", "à vérifier")}</span>}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {t("Paid by the customer", "Payé par le client")} {chf(r.collected)} · {t("Total amount decided", "Montant total décidé")} {chf(r.decided)} · {t("Already refunded", "Déjà remboursé")} {chf(r.refunded)}
                    </span>
                    <span className="ml-auto font-semibold tabular-nums text-amber-900">{chf(r.remaining)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* À vérifier */}
        {tab === "review" && review && (
          <section className="space-y-4" data-tab="review">
            <div className="border border-border/60">
              <div className="flex justify-between px-4 py-2.5 bg-secondary/30 border-b border-border/60 text-sm font-semibold">
                <span>{review.count} {t("refund(s) to check — not counted", "remboursement(s) à vérifier — non comptés")}</span>
                <span className="tabular-nums">{chf(review.amount)}</span>
              </div>
              {review.rows.length === 0 ? <p className="px-4 py-5 text-sm text-muted-foreground">{t("Nothing to check.", "Rien à vérifier.")}</p> : (
                <ul className="divide-y divide-border/60">
                  {review.rows.map((r) => (
                    <li key={r.id} className="px-4 py-3 text-sm space-y-1" data-row={r.id}>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 items-baseline">
                        <span className="min-w-[160px] flex-1"><OrderLink id={r.orderId} number={r.orderNumber} isTest={r.isTest} /> · {r.customerName} · <span className="text-muted-foreground">{originLabel(r.origin)}</span></span>
                        <span className="text-xs px-1.5 py-0.5 bg-secondary">{SOURCE_LABELS[r.source]?.[l] ?? r.source}</span>
                        <span className="font-semibold tabular-nums">{chf(r.amount)}</span>
                      </div>
                      <p className="text-xs text-amber-800">{r.reviewReason}</p>
                      {r.duplicateOf && (
                        <p className="text-xs text-muted-foreground">
                          {t("Possibly the same as", "Peut-être le même que")} : {chf(r.duplicateOf.amount)} · {SOURCE_LABELS[r.duplicateOf.source]?.[l] ?? r.duplicateOf.source} · {r.duplicateOf.refundedAt ? formatDay(r.duplicateOf.refundedAt, l) : t("no date", "à dater")}
                        </p>
                      )}
                      <Link to={`/admin/order/${r.orderId}`} className="text-xs underline">{t("Check on the order page", "Vérifier sur la fiche commande")}</Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="border border-border/60">
              <div className="px-4 py-2.5 bg-secondary/30 border-b border-border/60 text-sm font-semibold">{t("Anomalies", "Anomalies")} ({review.anomalies.length})</div>
              {review.anomalies.length === 0 ? <p className="px-4 py-5 text-sm text-muted-foreground">{t("No anomaly.", "Aucune anomalie.")}</p> : (
                <ul className="divide-y divide-border/60">
                  {review.anomalies.map((a) => (
                    <li key={a.id} className="px-4 py-3 text-sm flex flex-wrap gap-x-4 gap-y-1 items-baseline" data-anomaly={a.id}>
                      <span className="min-w-[160px] flex-1">
                        {a.orderId && <OrderLink id={a.orderId} number={a.orderNumber ?? null} isTest={!!a.isTest} />} · {ANOMALY_LABELS[a.kind]?.[l] ?? a.kind}
                        {a.requested != null && <span className="text-muted-foreground"> — {chf(a.requested)} → {chf(a.recorded)}</span>}
                        {a.detail && <span className="block text-xs text-muted-foreground">{a.detail}</span>}
                      </span>
                      <Button size="sm" variant="outline" className="rounded-none h-8" disabled={busy === a.id} onClick={() => resolveAnomaly(a.id)}>
                        {busy === a.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t("Mark as seen", "Marquer comme vue")}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        {loading && !done && !todo && !review && <div className="py-12 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" /></div>}
      </main>
    </AdminLayout>
  );
};

export default AdminRefunds;
