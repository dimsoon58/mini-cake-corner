import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarDays, Check, Loader2, Plus, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLang } from "@/context/LanguageContext";
import { supabase } from "@/integrations/supabase/client";
import { newKey } from "@/lib/manualOrders";
import {
  ANOMALY_LABELS, DECISION_SOURCE_LABELS, METHOD_LABELS, SOURCE_LABELS, STATUS_LABELS,
  chf, describeMethod, formatDay, itemLabel, num, refundsApi, RefundsError, zurichToday,
  type OrderRefunds, type RefundDecision, type RefundEntry, type RefundMethod,
} from "@/lib/refunds";
import { cn } from "@/lib/utils";
import { useSessionPin } from "@/lib/adminSession";
import { PasswordInput } from "@/components/ui/password-input";

// Order page block (lot 2): what the customer paid, what is to be refunded
// (decided), what was actually refunded, the remaining amount, and the
// history. F25: « Remboursement terminé » as soon as the decided amount is
// fully refunded, even below what was paid; the difference is shown as
// « Montant non remboursé » with the reason typed in the decision (never
// assumed to be a payment fee). Two separate actions:
//   - « Décider un montant à rembourser » (a goodwill decision, no money moves);
//   - « Enregistrer un remboursement effectué » (money already returned by
//     hand, e.g. in PostFinance — only recorded here).
// Nothing here cancels an item, changes the payment or sends an e-mail.

type OrderItemOption = { id: string; label: string };

const box = "border border-border/60 bg-background";
const smallLabel = "text-xs text-muted-foreground";

const Badge = ({ className, children }: { className?: string; children: React.ReactNode }) => (
  <span className={cn("inline-block px-2 py-0.5 text-[11px] font-medium", className)}>{children}</span>
);

export const OrderRefundsPanel = ({ orderId, items }: { orderId: string; items: OrderItemOption[] }) => {
  const { t, lang } = useLang();
  const l = lang === "en" ? "en" : "fr";
  const [data, setData] = useState<OrderRefunds | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pin, setPin, pinBySession] = useSessionPin();
  const [open, setOpen] = useState<null | "refund" | "decision">(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  const [notDeployed, setNotDeployed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setData(await refundsApi<OrderRefunds>({ action: "get_order", orderId }));
      setNotDeployed(false);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
      setNotDeployed(e instanceof RefundsError && e.reason === "not_deployed");
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => { load(); }, [load]);

  // Runs one write action; on success reloads the block. Returns true on success.
  const run = async (tag: string, body: Record<string, unknown>, ok: string) => {
    if (!pin.trim()) {
      setMessage({ type: "error", text: t("Enter the admin PIN first.", "Saisissez d'abord le code PIN administrateur.") });
      return false;
    }
    // PIN de session (F16) : confirmation simple à la place de la ressaisie.
    if (pinBySession && !window.confirm(t("Confirm this refund action?", "Confirmer cette opération de remboursement ?"))) return false;
    setBusy(tag);
    setMessage(null);
    try {
      await refundsApi({ ...body, pin });
      setMessage({ type: "ok", text: ok });
      await load();
      return true;
    } catch (e) {
      const err = e as RefundsError;
      setMessage({ type: "error", text: err.message });
      return false;
    } finally {
      setBusy(null);
    }
  };

  if (loading && !data) {
    return <div className={cn(box, "p-4 text-sm text-muted-foreground flex items-center gap-2")}><Loader2 className="w-4 h-4 animate-spin" /> {t("Loading refunds…", "Chargement des remboursements…")}</div>;
  }
  if (loadError && !data) {
    return (
      <div className={cn(box, "p-4 space-y-3")}>
        <h3 className="font-sans text-[12px] tracking-[0.105em] font-semibold uppercase">{t("Refunds", "Remboursements")}</h3>
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 px-3 py-2">{loadError}</p>
        {notDeployed && <LegacyRefundForm orderId={orderId} />}
      </div>
    );
  }
  if (!data) return null;

  const s = data.summary;
  const collected = num(s.collected);
  const remaining = num(s.remaining);
  const decided = num(s.decided);
  const notRefunded = num(data.notRefunded ?? 0);
  const reasons = (data.notRefundedReasons ?? []).filter(Boolean);
  // Terminé = tout le montant décidé est remboursé, rien à vérifier — même s'il est inférieur au montant payé.
  const finished = decided > 0 && remaining <= 0 && num(s.refunded) > 0 && num(s.to_review_count) === 0;
  const stateBadge = finished
    ? <Badge className="bg-emerald-100 text-emerald-900">{t("Refund completed", "Remboursement terminé")}</Badge>
    : null;

  return (
    <div className={cn(box, "p-4 space-y-4")} data-testid="order-refunds">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-sans text-[12px] tracking-[0.105em] font-semibold uppercase text-foreground mr-auto">{t("Refunds", "Remboursements")}</h3>
        {data.isTest && <Badge className="bg-purple-100 text-purple-900">TEST</Badge>}
        {stateBadge}
        {remaining > 0 && <Badge className="bg-amber-100 text-amber-900">{t("Refund pending", "Remboursement en attente")}</Badge>}
      </div>

      {/* Summary */}
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2" data-testid="refund-summary">
        {[
          { k: "collected", label: t("Paid by the customer", "Payé par le client"), v: collected },
          { k: "decided", label: t("To refund", "À rembourser"), v: decided },
          { k: "refunded", label: t("Already refunded", "Déjà remboursé"), v: num(s.refunded) },
          { k: "remaining", label: t("Left to refund", "Reste à rembourser"), v: remaining, strong: remaining > 0 },
        ].map((c) => (
          <div key={c.k} data-k={c.k} className={cn("px-3 py-2 border", c.strong ? "border-amber-300 bg-amber-50" : "border-border/60 bg-secondary/20")}>
            <dt className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">{c.label}</dt>
            <dd className="text-base font-semibold tabular-nums">{chf(c.v)}</dd>
          </div>
        ))}
      </dl>
      {notRefunded > 0 && (
        <p className="text-sm px-3 py-2 border border-border/60 bg-secondary/20" data-testid="not-refunded">
          <span className="font-medium">{t("Amount not refunded", "Montant non remboursé")} : <span className="tabular-nums">{chf(notRefunded)}</span></span>
          {" — "}
          <span className="text-muted-foreground">
            {reasons.length > 0 ? `${t("reason", "motif")} : ${reasons.join(" · ")}` : t("no reason given", "motif non précisé")}
          </span>
        </p>
      )}

      {/* Things to look at */}
      <div className="space-y-1.5">
        {num(s.to_review_count) > 0 && (
          <p className="text-xs bg-amber-50 border border-amber-200 text-amber-900 px-3 py-2 flex gap-2"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            {t(`${s.to_review_count} refund(s) to check (${chf(s.to_review_amount)}) — not counted until checked.`,
              `${s.to_review_count} remboursement(s) à vérifier (${chf(s.to_review_amount)}) — non comptés tant qu'ils ne sont pas vérifiés.`)}
          </p>
        )}
        {num(s.undated_count) > 0 && (
          <p className="text-xs bg-secondary/40 border border-border/60 px-3 py-2 flex gap-2"><CalendarDays className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            {t(`${s.undated_count} refund(s) without a date (${chf(s.undated_amount)}) — counted here, but in no month until dated.`,
              `${s.undated_count} remboursement(s) à dater (${chf(s.undated_amount)}) — comptés ici, mais dans aucun mois tant qu'ils ne sont pas datés.`)}
          </p>
        )}
        {data.cashback.needsReview && (
          <p className="text-xs bg-amber-50 border border-amber-200 text-amber-900 px-3 py-2">
            {t("Cashback history unclear for this order: no cashback is given back automatically.", "Historique de cashback ambigu pour cette commande : aucun cashback n'est rendu automatiquement.")}
          </p>
        )}
        {data.anomalies.map((a) => (
          <p key={a.id} className="text-xs bg-amber-50 border border-amber-200 text-amber-900 px-3 py-2">
            {ANOMALY_LABELS[a.kind]?.[l] ?? a.kind}{a.requested != null ? ` — ${chf(a.requested)} → ${chf(a.recorded)}` : ""}{a.detail ? ` — ${a.detail}` : ""}
          </p>
        ))}
        {collected <= 0 && (
          <p className="text-xs text-muted-foreground">{t("Nothing collected yet: no refund can be recorded.", "Rien n'est encore encaissé : aucun remboursement ne peut être enregistré.")}</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-end gap-2">
        {!pinBySession && (
          <div className="space-y-1">
            <Label htmlFor="refund-panel-pin" className={smallLabel}>{t("Admin PIN", "Code PIN administrateur")}</Label>
            <PasswordInput id="refund-panel-pin" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} className="w-32 rounded-none" />
          </div>
        )}
        <Button variant="outline" className="rounded-none" disabled={collected <= 0} onClick={() => { setOpen(open === "refund" ? null : "refund"); setMessage(null); }}>
          <Plus className="w-4 h-4 mr-1" /> {t("Record a refund made", "Enregistrer un remboursement effectué")}
        </Button>
        <Button variant="outline" className="rounded-none" disabled={collected <= 0} onClick={() => { setOpen(open === "decision" ? null : "decision"); setMessage(null); }}>
          <Plus className="w-4 h-4 mr-1" /> {t("Decide an amount to refund", "Décider un montant à rembourser")}
        </Button>
      </div>

      {message && (
        <p role="status" className={cn("text-sm px-3 py-2 border", message.type === "ok" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-red-50 border-red-200 text-red-800")}>{message.text}</p>
      )}

      {open === "refund" && (
        <RefundForm
          key="refund"
          data={data}
          items={items}
          busy={busy === "record_refund"}
          onCancel={() => setOpen(null)}
          onSubmit={async (body) => {
            const ok = await run("record_refund", { action: "record_refund", orderId, ...body }, t("Refund recorded.", "Remboursement enregistré."));
            if (ok) setOpen(null);
            return ok;
          }}
        />
      )}
      {open === "decision" && (
        <DecisionForm
          key="decision"
          items={items}
          cancelledItemIds={data.cancelledItemIds ?? []}
          collected={collected}
          decided={decided}
          max={Math.max(collected - num(s.decided), 0)}
          busy={busy === "record_decision"}
          onCancel={() => setOpen(null)}
          onSubmit={async (body) => {
            const ok = await run("record_decision", { action: "record_decision", orderId, ...body }, t("Decision recorded.", "Décision enregistrée."));
            if (ok) setOpen(null);
            return ok;
          }}
        />
      )}

      {/* History */}
      <section className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("Refunds made", "Remboursements effectués")} ({data.refunds.length})</h4>
        {data.refunds.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("None yet.", "Aucun pour l'instant.")}</p>
        ) : (
          <ul className="divide-y divide-border/60 border border-border/60" data-testid="refund-history">
            {data.refunds.map((r) => (
              <RefundRow key={r.id} r={r} busy={busy} run={run} />
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("Decisions", "Décisions")} ({data.decisions.length})</h4>
        {data.decisions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("None.", "Aucune.")}</p>
        ) : (
          <ul className="divide-y divide-border/60 border border-border/60" data-testid="decision-history">
            {data.decisions.map((d) => (
              <DecisionRow key={d.id} d={d} busy={busy} run={run} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};

// ── One refund line ─────────────────────────────────────────────────────
const RefundRow = ({ r, busy, run }: {
  r: RefundEntry;
  busy: string | null;
  run: (tag: string, body: Record<string, unknown>, ok: string) => Promise<boolean>;
}) => {
  const { t, lang } = useLang();
  const l = lang === "en" ? "en" : "fr";
  const [mode, setMode] = useState<null | "date" | "void">(null);
  const [date, setDate] = useState(zurichToday());
  const [reason, setReason] = useState("");
  const off = r.status === "voided" || r.status === "duplicate" || r.status === "rejected";

  return (
    <li className={cn("px-3 py-2.5 text-sm space-y-1.5", off && "bg-secondary/20")} data-refund={r.id} data-status={r.status}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={cn("font-semibold tabular-nums", off && "line-through text-muted-foreground")}>{chf(r.amount)}</span>
        <span className={r.refundedAt ? "text-foreground" : "text-amber-800 font-medium"}>
          {r.refundedAt ? formatDay(r.refundedAt, l) : t("No date", "À dater")}
        </span>
        <span className="text-muted-foreground">{describeMethod(r.method, r.methodDetail, l)}</span>
        {r.reference && <span className="text-muted-foreground">{t("Ref.", "Réf.")} {r.reference}</span>}
        <span className="ml-auto flex gap-1">
          <Badge className="bg-secondary text-foreground/80">{SOURCE_LABELS[r.source]?.[l] ?? r.source}</Badge>
          {r.status !== "counted" && (
            <Badge className={r.status === "to_review" ? "bg-amber-100 text-amber-900" : "bg-slate-200 text-slate-700"}>{STATUS_LABELS[r.status]?.[l] ?? r.status}</Badge>
          )}
        </span>
      </div>
      {r.items.length > 0 && <p className="text-xs text-muted-foreground">{r.items.map((it) => itemLabel(it, l)).join(", ")}</p>}
      {r.note && <p className="text-xs text-muted-foreground">{r.note}</p>}
      {r.reviewReason && r.status !== "counted" && <p className="text-xs text-amber-800">{r.reviewReason}</p>}
      {r.status === "voided" && <p className="text-xs text-muted-foreground">{t("Corrected", "Corrigé")} : {r.voidReason}</p>}

      {!off && (
        <div className="flex flex-wrap gap-2 pt-0.5">
          {r.status === "to_review" && (
            <>
              <Button size="sm" variant="outline" className="rounded-none h-8" disabled={!!busy}
                onClick={() => run(`review-${r.id}`, { action: "review_refund", refundId: r.id, decision: "distinct" }, t("Counted as a separate refund.", "Compté comme un remboursement distinct."))}>
                <Check className="w-3.5 h-3.5 mr-1" /> {t("Separate refund — count it", "Remboursement distinct — le compter")}
              </Button>
              <Button size="sm" variant="outline" className="rounded-none h-8" disabled={!!busy}
                onClick={() => run(`review-${r.id}`, { action: "review_refund", refundId: r.id, decision: "duplicate" }, t("Marked as duplicate.", "Marqué comme doublon."))}>
                <X className="w-3.5 h-3.5 mr-1" /> {t("Duplicate", "Doublon")}
              </Button>
            </>
          )}
          {!r.refundedAt && (
            <Button size="sm" variant="outline" className="rounded-none h-8" onClick={() => setMode(mode === "date" ? null : "date")}>
              <CalendarDays className="w-3.5 h-3.5 mr-1" /> {t("Set date", "Dater")}
            </Button>
          )}
          <Button size="sm" variant="ghost" className="rounded-none h-8 text-red-700 hover:text-red-800" onClick={() => setMode(mode === "void" ? null : "void")}>
            <RotateCcw className="w-3.5 h-3.5 mr-1" /> {t("Correct (cancel this entry)", "Corriger (annuler cette saisie)")}
          </Button>
        </div>
      )}

      {mode === "date" && (
        <div className="flex flex-wrap items-end gap-2 pt-1">
          <div className="space-y-1">
            <Label className={smallLabel}>{t("Actual refund date", "Date réelle du remboursement")}</Label>
            <Input type="date" max={zurichToday()} value={date} onChange={(e) => setDate(e.target.value)} className="w-44 rounded-none" />
          </div>
          <Button size="sm" className="rounded-none h-9" disabled={!!busy || !date}
            onClick={async () => { if (await run(`date-${r.id}`, { action: "date_refund", refundId: r.id, refundedAt: date }, t("Date saved.", "Date enregistrée."))) setMode(null); }}>
            {busy === `date-${r.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t("Save date", "Enregistrer la date")}
          </Button>
        </div>
      )}
      {mode === "void" && (
        <div className="flex flex-wrap items-end gap-2 pt-1">
          <div className="space-y-1 flex-1 min-w-[200px]">
            <Label className={smallLabel}>{t("Reason (required)", "Motif (obligatoire)")}</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} className="rounded-none" placeholder={t("e.g. wrong amount", "ex. mauvais montant")} />
          </div>
          <Button size="sm" variant="destructive" className="rounded-none h-9" disabled={!!busy || !reason.trim()}
            onClick={async () => { if (await run(`void-${r.id}`, { action: "void_refund", refundId: r.id, reason }, t("Entry corrected: it no longer counts.", "Saisie corrigée : elle n'est plus comptée."))) setMode(null); }}>
            {busy === `void-${r.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t("Confirm correction", "Confirmer la correction")}
          </Button>
        </div>
      )}
    </li>
  );
};

// ── One decision line ───────────────────────────────────────────────────
const DecisionRow = ({ d, busy, run }: {
  d: RefundDecision;
  busy: string | null;
  run: (tag: string, body: Record<string, unknown>, ok: string) => Promise<boolean>;
}) => {
  const { t, lang } = useLang();
  const l = lang === "en" ? "en" : "fr";
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState("");
  const off = !!d.voidedAt;
  return (
    <li className={cn("px-3 py-2.5 text-sm space-y-1.5", off && "bg-secondary/20")} data-decision={d.id}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={cn("font-semibold tabular-nums", off && "line-through text-muted-foreground")}>{chf(d.amount)}</span>
        <span>{formatDay(d.decidedAt, l)}</span>
        <span className="text-muted-foreground">{DECISION_SOURCE_LABELS[d.source]?.[l] ?? d.source}</span>
        {off && <Badge className="ml-auto bg-slate-200 text-slate-700">{t("Cancelled", "Annulée")}</Badge>}
      </div>
      {d.reason && <p className="text-xs text-muted-foreground">{d.reason}</p>}
      {!off && d.source === "workshop_cancel" && (
        <p className="text-xs text-muted-foreground" data-testid="workshop-decision-hint">
          {t("Amount proposed automatically. To keep fees: cancel this decision, then decide the amount to refund.",
            "Montant proposé automatiquement. Pour garder des frais : annulez cette décision, puis décidez le montant à rembourser.")}
        </p>
      )}
      {d.items.length > 0 && <p className="text-xs text-muted-foreground">{d.items.map((it) => itemLabel(it, l)).join(", ")}</p>}
      {off && d.voidReason && <p className="text-xs text-muted-foreground">{d.voidReason}</p>}
      {!off && d.source !== "auto_from_refund" && (
        voiding ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1 flex-1 min-w-[200px]">
              <Label className={smallLabel}>{t("Reason (required)", "Motif (obligatoire)")}</Label>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} className="rounded-none" />
            </div>
            <Button size="sm" variant="destructive" className="rounded-none h-9" disabled={!!busy || !reason.trim()}
              onClick={async () => { if (await run(`vdec-${d.id}`, { action: "void_decision", decisionId: d.id, reason }, t("Decision cancelled.", "Décision annulée."))) setVoiding(false); }}>
              {t("Cancel this decision", "Annuler cette décision")}
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="ghost" className="rounded-none h-8 text-red-700" onClick={() => setVoiding(true)}>
            <RotateCcw className="w-3.5 h-3.5 mr-1" /> {t("Cancel this decision", "Annuler cette décision")}
          </Button>
        )
      )}
    </li>
  );
};

// ── Forms ───────────────────────────────────────────────────────────────
const ItemChoice = ({ items, value, onChange }: { items: OrderItemOption[]; value: string[]; onChange: (v: string[]) => void }) => {
  const { t } = useLang();
  if (items.length === 0) return null;
  return (
    <fieldset className="space-y-1">
      <legend className={smallLabel}>{t("Concerns (optional — whole order if none ticked)", "Concerne (facultatif — toute la commande si rien n'est coché)")}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {items.map((it) => (
          <label key={it.id} className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" className="w-4 h-4 accent-[hsl(var(--primary))]" checked={value.includes(it.id)}
              onChange={(e) => onChange(e.target.checked ? [...value, it.id] : value.filter((x) => x !== it.id))} />
            {it.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
};

const parseAmount = (v: string) => {
  const n = Number(v.replace(",", ".").trim());
  return Number.isFinite(n) ? n : NaN;
};

const RefundForm = ({ data, items, busy, onCancel, onSubmit }: {
  data: OrderRefunds;
  items: OrderItemOption[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (body: Record<string, unknown>) => Promise<boolean>;
}) => {
  const { t, lang } = useLang();
  const l = lang === "en" ? "en" : "fr";
  const remaining = num(data.summary.remaining);
  const [amount, setAmount] = useState(remaining > 0 ? remaining.toFixed(2) : "");
  const [date, setDate] = useState(zurichToday());
  const [method, setMethod] = useState<RefundMethod | "">("");
  const [detail, setDetail] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [itemIds, setItemIds] = useState<string[]>([]);
  const [gesture, setGesture] = useState(false);
  const [distinct, setDistinct] = useState(false);
  // One key per opening of the form: a double click or a resend never
  // records twice; a new key is made only after a success (form closes).
  const [idempotencyKey] = useState(newKey);

  const a = parseAmount(amount);
  const over = Number.isFinite(a) && a > remaining + 0.004;
  const similar = useMemo(
    () => data.refunds.filter((r) => (r.status === "counted" || r.status === "to_review") && Math.abs(num(r.amount) - a) < 0.005),
    [data.refunds, a],
  );
  const valid = Number.isFinite(a) && a > 0 && !!date && !!method && (!over || gesture) && (similar.length === 0 || distinct);

  return (
    <form
      className="border border-primary/30 bg-primary/5 p-3 space-y-3"
      data-testid="refund-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid || busy) return;
        await onSubmit({ amount: a, refundedAt: date, method, methodDetail: detail, reference, note, itemIds,
          allowGesture: over && gesture, confirmDistinct: similar.length > 0 && distinct, idempotencyKey });
      }}
    >
      <p className="text-sm font-medium">{t("Record a refund already made (e.g. in PostFinance)", "Enregistrer un remboursement déjà effectué (ex. dans PostFinance)")}</p>
      <div className="flex flex-wrap gap-3">
        <div className="space-y-1">
          <Label htmlFor="rf-amount" className={smallLabel}>{t("Amount (CHF)", "Montant (CHF)")}</Label>
          <Input id="rf-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-32 rounded-none" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="rf-date" className={smallLabel}>{t("Actual date", "Date réelle")}</Label>
          <Input id="rf-date" type="date" max={zurichToday()} value={date} onChange={(e) => setDate(e.target.value)} className="w-44 rounded-none" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="rf-method" className={smallLabel}>{t("Method", "Moyen")}</Label>
          <select id="rf-method" value={method} onChange={(e) => setMethod(e.target.value as RefundMethod)}
            className="h-10 border border-input bg-background px-3 text-sm w-44">
            <option value="">{t("Choose…", "Choisir…")}</option>
            {(Object.keys(METHOD_LABELS) as RefundMethod[]).map((m) => <option key={m} value={m}>{METHOD_LABELS[m][l]}</option>)}
          </select>
        </div>
        <div className="space-y-1 flex-1 min-w-[160px]">
          <Label htmlFor="rf-detail" className={smallLabel}>{t("Detail (optional)", "Précision (facultatif)")}</Label>
          <Input id="rf-detail" value={detail} onChange={(e) => setDetail(e.target.value)} className="rounded-none" placeholder={method === "other" ? t("e.g. voucher", "ex. bon d'achat") : ""} />
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <div className="space-y-1 flex-1 min-w-[160px]">
          <Label htmlFor="rf-ref" className={smallLabel}>{t("Reference (optional)", "Référence (facultatif)")}</Label>
          <Input id="rf-ref" value={reference} onChange={(e) => setReference(e.target.value)} className="rounded-none" />
        </div>
        <div className="space-y-1 flex-[2] min-w-[200px]">
          <Label htmlFor="rf-note" className={smallLabel}>{t("Comment (optional)", "Commentaire (facultatif)")}</Label>
          <Input id="rf-note" value={note} onChange={(e) => setNote(e.target.value)} className="rounded-none" />
        </div>
      </div>
      <ItemChoice items={items} value={itemIds} onChange={setItemIds} />

      {over && (
        <label className="flex items-start gap-2 text-sm bg-amber-50 border border-amber-200 px-3 py-2">
          <input type="checkbox" className="w-4 h-4 mt-0.5" checked={gesture} onChange={(e) => setGesture(e.target.checked)} />
          <span>{t(`This is more than the amount left to refund (${chf(remaining)}). Tick to record the difference as a goodwill gesture.`,
            `C'est plus que le reste à rembourser (${chf(remaining)}). Cochez pour enregistrer la différence comme geste commercial.`)}</span>
        </label>
      )}
      {similar.length > 0 && (
        <label className="flex items-start gap-2 text-sm bg-amber-50 border border-amber-200 px-3 py-2">
          <input type="checkbox" className="w-4 h-4 mt-0.5" checked={distinct} onChange={(e) => setDistinct(e.target.checked)} />
          <span>{t(`A refund of the same amount already exists (${similar.map((r) => r.refundedAt ? formatDay(r.refundedAt, l) : "à dater").join(", ")}). Tick to confirm this is another refund.`,
            `Un remboursement du même montant existe déjà (${similar.map((r) => r.refundedAt ? formatDay(r.refundedAt, l) : "à dater").join(", ")}). Cochez pour confirmer qu'il s'agit d'un autre remboursement.`)}</span>
        </label>
      )}

      <div className="flex gap-2">
        <Button type="submit" className="rounded-none" disabled={!valid || busy}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}{t("Record", "Enregistrer")}
        </Button>
        <Button type="button" variant="ghost" className="rounded-none" onClick={onCancel}>{t("Cancel", "Annuler")}</Button>
      </div>
      <p className="text-xs text-muted-foreground">{t("Recording does not move any money, cancel any item or send any e-mail.", "L'enregistrement ne déplace aucun argent, n'annule aucun article et n'envoie aucun e-mail.")}</p>
    </form>
  );
};

// Motif rapide (F25) : à choisir seulement quand c'est bien la raison de l'écart.
const FEE_KEPT_REASON = "Annulation — frais de paiement gardés";

const DecisionForm = ({ items, cancelledItemIds, collected, decided, max, busy, onCancel, onSubmit }: {
  items: OrderItemOption[];
  cancelledItemIds: string[];
  collected: number;
  decided: number;
  max: number;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (body: Record<string, unknown>) => Promise<boolean>;
}) => {
  const { t } = useLang();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [itemIds, setItemIds] = useState<string[]>([]);
  const [idempotencyKey] = useState(newKey);
  const a = parseAmount(amount);
  const valid = Number.isFinite(a) && a > 0 && a <= max + 0.004 && !!reason.trim();
  const cancelled = items.filter((it) => cancelledItemIds.includes(it.id)).map((it) => it.id);
  return (
    <form
      className="border border-primary/30 bg-primary/5 p-3 space-y-3"
      data-testid="decision-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid || busy) return;
        await onSubmit({ amount: a, reason, itemIds, idempotencyKey });
      }}
    >
      <p className="text-sm font-medium">{t("Decide an amount to refund (nothing is refunded yet)", "Décider un montant à rembourser (rien n'est encore remboursé)")}</p>
      <div className="flex flex-wrap gap-3">
        <div className="space-y-1">
          <Label htmlFor="dc-amount" className={smallLabel}>{t(`Amount (max ${chf(max)})`, `Montant (max ${chf(max)})`)}</Label>
          <Input id="dc-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-32 rounded-none" />
        </div>
        <div className="space-y-1 flex-1 min-w-[200px]">
          <Label htmlFor="dc-reason" className={smallLabel}>{t("Reason (required)", "Motif (obligatoire)")}</Label>
          <Input id="dc-reason" value={reason} onChange={(e) => setReason(e.target.value)} className="rounded-none" placeholder={t("e.g. goodwill gesture", "ex. geste commercial")} />
          <button type="button" className="text-xs underline text-muted-foreground hover:text-foreground" data-testid="fee-kept-reason"
            onClick={() => { setReason(FEE_KEPT_REASON); if (cancelled.length) setItemIds(cancelled); }}>
            {t("Reason: cancellation, payment fees kept", "Motif : annulation, frais de paiement gardés")}
          </button>
        </div>
      </div>
      {Number.isFinite(a) && a > 0 && (
        <p className="text-xs text-muted-foreground tabular-nums" data-testid="decision-recap">
          {t(`After this decision: ${chf(decided + a)} to refund out of ${chf(collected)} paid by the customer.`,
            `Après cette décision : ${chf(decided + a)} à rembourser sur ${chf(collected)} payés par le client.`)}
        </p>
      )}
      <ItemChoice items={items} value={itemIds} onChange={setItemIds} />
      {cancelled.length > 0 && itemIds.length === 0 && (
        <p className="text-xs text-amber-800" data-testid="tick-cancelled-hint">
          {t("To refund a cancelled item, tick it (the quick reason does it for you). Without a ticked item, the decision covers the whole order: a cancellation refund if everything is cancelled, otherwise a goodwill gesture.",
            "Pour rembourser un article annulé, cochez-le (le motif rapide le fait pour vous). Sans article coché, la décision vaut pour toute la commande : remboursement d'annulation si tout est annulé, sinon geste commercial.")}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" className="rounded-none" disabled={!valid || busy}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}{t("Save decision", "Enregistrer la décision")}
        </Button>
        <Button type="button" variant="ghost" className="rounded-none" onClick={onCancel}>{t("Cancel", "Annuler")}</Button>
      </div>
    </form>
  );
};

// ── Fallback while manage-refunds is not deployed yet ────────────────────
// Same call as the former form (manage-order « record_manual_refund »).
// Since lot 1 (F5), the database applies the full control to it anyway
// (cap, double click, unpaid order) and records it « à dater ». Shown only
// when manage-refunds answers 404; disappears by itself once deployed.
const LegacyRefundForm = ({ orderId }: { orderId: string }) => {
  const { t } = useLang();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [pin, setPin, pinBySession] = useSessionPin();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const a = parseAmount(amount);
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy || !(a > 0) || !pin.trim()) return;
        if (pinBySession && !window.confirm(t("Record this refund?", "Enregistrer ce remboursement ?"))) return;
        setBusy(true);
        setMsg(null);
        try {
          const { data, error } = await supabase.functions.invoke("manage-order", {
            body: { orderId, action: "record_manual_refund", pin, refundAmount: a, refundNote: note.trim() || undefined },
          });
          if (error || data?.error) {
            let text = data?.error as string | undefined;
            try { text = text ?? (await (error as { context?: Response })?.context?.json())?.error; } catch { /* ignore */ }
            setMsg({ ok: false, text: text || t("Not saved. Please try again.", "Non enregistré. Réessayez.") });
          } else {
            setMsg({ ok: true, text: t("Refund recorded (without a date — date it once the new block is available).", "Remboursement enregistré (à dater — datez-le quand le nouveau bloc sera disponible).") });
            setAmount("");
            setNote("");
          }
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="text-xs text-muted-foreground">{t("Temporary simple form:", "Formulaire simple provisoire :")}</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label className={smallLabel}>{t("Amount (CHF)", "Montant (CHF)")}</Label>
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-28 rounded-none" />
        </div>
        <div className="space-y-1 flex-1 min-w-[140px]">
          <Label className={smallLabel}>{t("Note (optional)", "Note (facultatif)")}</Label>
          <Input value={note} onChange={(e) => setNote(e.target.value)} className="rounded-none" />
        </div>
        {!pinBySession && (
          <div className="space-y-1">
            <Label className={smallLabel}>{t("Admin PIN", "Code PIN administrateur")}</Label>
            <PasswordInput autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} className="w-28 rounded-none" />
          </div>
        )}
        <Button type="submit" variant="outline" className="rounded-none" disabled={busy || !(a > 0) || !pin.trim()}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}{t("Record", "Enregistrer")}
        </Button>
      </div>
      {msg && <p className={cn("text-sm px-3 py-2 border", msg.ok ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-red-50 border-red-200 text-red-800")}>{msg.text}</p>}
    </form>
  );
};
