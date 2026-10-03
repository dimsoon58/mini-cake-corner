import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Copy, Info, Loader2, Lock, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import AdminLayout from "@/components/admin/AdminLayout";
import PartnerForm from "@/components/admin/partners/PartnerForm";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { isAdminEmail } from "@/lib/adminAccess";
import { money } from "@/lib/compta";
import { PRODUCT_LABELS, sizeLabel } from "@/lib/orderLabels";
import {
  ESTABLISHMENT_LABELS, MOTIF_LABELS, STATUS_LABELS, commissionDue, netForBento, partnerBalance, partnerLink, partnersApi, pctLabel,
  type PartnerDetail, type PartnerMetrics, type PartnerOrder, type RefundMotif,
} from "@/lib/partners";
import { cn } from "@/lib/utils";

// Admin > Partenaires > fiche (lot Partenaires V1). Commandes attribuées
// automatiquement par le lien du site (pas d'attribution manuelle).
// Commission due affichée directement ; un remboursement sans motif met la
// commande « À vérifier » ; les paiements au
// partenaire sont enregistrés à la main (aucun virement automatique).

const fmtDate = (s: string | null | undefined) => (s ? new Date(s.length === 10 ? `${s}T12:00:00` : s).toLocaleDateString("fr-CH", { timeZone: "Europe/Zurich" }) : "—");
const itemName = (product: string) => PRODUCT_LABELS[product]?.fr ?? product;
const zToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date());

const PinField = ({ pin, setPin }: { pin: string; setPin: (v: string) => void }) => (
  <div className="space-y-1">
    <Label className="text-xs">Code PIN administrateur</Label>
    <Input type="password" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} className="rounded-none h-9 w-40" />
  </div>
);

const Metric = ({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "warn" | "bad" }) => (
  <div className="border border-border/60 px-3 py-2 min-w-0">
    <p className="text-[11px] uppercase tracking-[0.06em] text-muted-foreground">{label}</p>
    <p className={cn("text-lg font-semibold tabular-nums", tone === "warn" && "text-amber-800", tone === "bad" && "text-red-700")}>{value}</p>
    {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
  </div>
);

const AdminPartner = () => {
  const { t } = useLang();
  const { id = "" } = useParams();
  const { user, loading: authLoading } = useAuth();
  const isAdmin = isAdminEmail(user?.email);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [d, setD] = useState<PartnerDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    document.title = "Admin – Partenaire – Bento Cake Studio";
    return () => { document.title = "Bento Cake Studio Geneva"; };
  }, []);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setD(await partnersApi<PartnerDetail>({ action: "get", id, from: from || null, to: to || null })); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [id, from, to]);
  useEffect(() => { if (!authLoading && isAdmin) load(); }, [authLoading, isAdmin, load]);

  /** Exécute une écriture (avec PIN) puis recharge la fiche. */
  const write = async (body: Record<string, unknown>, ok: string) => {
    if (!pin.trim()) throw new Error("Saisissez le code PIN administrateur.");
    await partnersApi({ ...body, pin });
    setNotice(ok);
    await load();
  };

  if (authLoading) return <AdminLayout><main className="py-16 text-center"><Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" /></main></AdminLayout>;
  if (!user || !isAdmin) {
    return (
      <AdminLayout>
        <main className="max-w-md mx-auto px-6 py-24 text-center">
          <Lock className="w-8 h-8 mx-auto text-muted-foreground mb-4" />
          <h1 className="font-sans uppercase tracking-[0.105em] text-2xl text-foreground mb-4">{!user ? t("Admin sign-in required", "Connexion administrateur requise") : t("Access denied", "Accès refusé")}</h1>
          {!user && <Button asChild className="rounded-none"><Link to={`/login?redirect=${encodeURIComponent(window.location.pathname)}`}>{t("Sign in", "Se connecter")}</Link></Button>}
        </main>
      </AdminLayout>
    );
  }

  const p = d?.partner;
  const url = d && p ? partnerLink(d.siteBaseUrl, p.referral_token) : "";
  const copy = async () => { try { await navigator.clipboard.writeText(url); setNotice("Lien copié."); } catch { setNotice(url); } };

  return (
    <AdminLayout>
      <main className="container mx-auto px-4 py-8 max-w-6xl space-y-6">
        <Link to="/admin/partners" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="w-4 h-4" /> Partenaires</Link>
        {error && <p className="border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="alert">{error}</p>}
        {!d && loading && <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />}
        {d && p && (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="font-sans uppercase tracking-[0.105em] text-2xl md:text-3xl text-foreground font-semibold break-words">{p.name}</h1>
                <p className="text-sm text-muted-foreground">
                  <span className={cn("mr-2 text-[11px] px-1.5 py-0.5 border", p.active ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-border")}>{p.active ? "Actif" : "Inactif"}</span>
                  {p.establishment_type ? `${ESTABLISHMENT_LABELS[p.establishment_type] ?? p.establishment_type} · ` : ""}identifiant {p.slug}
                  {p.start_date ? ` · depuis le ${fmtDate(p.start_date)}` : ""}
                </p>
              </div>
              <Button variant="outline" className="rounded-none" onClick={() => setEditing((v) => !v)}><Pencil className="w-4 h-4 mr-1" />Modifier</Button>
            </div>
            {notice && <p className="border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 break-all" role="status">{notice}</p>}
            {editing && <PartnerForm partner={p} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); setNotice("Partenaire enregistré."); load(); }} />}

            <section className="border border-border/60 p-4 space-y-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground">Lien partenaire :</span>
                <code className="break-all text-xs bg-secondary/40 px-2 py-1">{url}</code>
                <Button size="sm" variant="outline" className="rounded-none h-8" onClick={copy}><Copy className="w-3.5 h-3.5 mr-1" />Copier</Button>
              </div>
              <p>Remise client <b>{pctLabel(p.customer_discount_rate)}</b> · commission <b>{p.commission_configured ? pctLabel(p.commission_rate) : "À configurer"}</b>
                {p.promo_code_reference && <> · code Notion <b>{p.promo_code_reference}</b> <span className="text-muted-foreground">(référence, non utilisable au paiement)</span></>}</p>
              {(p.contact_first_name || p.contact_last_name || p.contact_email || p.contact_phone) && (
                <p className="text-muted-foreground">Contact : {[p.contact_first_name, p.contact_last_name].filter(Boolean).join(" ")}{p.contact_email ? ` · ${p.contact_email}` : ""}{p.contact_phone ? ` · ${p.contact_phone}` : ""}</p>
              )}
              {Number(p.customer_discount_rate) === 0 && (
                <p className="border border-sky-300 bg-sky-50 text-sky-900 px-3 py-2 flex gap-2"><Info className="w-4 h-4 mt-0.5 shrink-0" />
                  Remise 0 % (commission seule) : les commandes passées avec ce lien sont attribuées au partenaire ; le client garde sa remise de bienvenue s'il y a droit.</p>
              )}
              {!p.active && <p className="text-amber-800">Partenaire inactif : son lien n'est plus reconnu par le site. L'historique est conservé.</p>}
            </section>

            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1"><Label className="text-xs text-muted-foreground">Période du</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-none h-10 w-40" /></div>
              <div className="space-y-1"><Label className="text-xs text-muted-foreground">au</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-none h-10 w-40" /></div>
              {(from || to) && <Button variant="ghost" className="rounded-none" onClick={() => { setFrom(""); setTo(""); }}>Toute la période</Button>}
              {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground mb-3" />}
            </div>
            <Metrics label={from || to ? "Période sélectionnée" : "Depuis le début"} m={d.period} />
            {(from || to) && <Metrics label="Total depuis le début" m={d.total} />}

            <Orders orders={d.orders} pin={pin} setPin={setPin} write={write} />
            <Payouts d={d} pin={pin} setPin={setPin} write={write} />

            <section className="space-y-2">
              <h2 className="font-semibold uppercase tracking-[0.08em] text-sm">Historique des taux</h2>
              <div className="overflow-x-auto border border-border/60">
                <table className="w-full text-sm tabular-nums">
                  <thead className="bg-secondary/30 text-[11px] uppercase text-muted-foreground"><tr><th className="text-left px-2 py-1.5 font-normal">Depuis</th><th className="text-right px-2 font-normal">Remise</th><th className="text-right px-2 font-normal">Commission</th><th className="text-left px-2 font-normal">Note</th><th className="text-left px-2 font-normal">Par</th></tr></thead>
                  <tbody className="divide-y divide-border/60">
                    {d.rateHistory.map((r) => (
                      <tr key={r.id}><td className="px-2 py-1.5">{fmtDate(r.effective_from)}</td><td className="text-right px-2">{pctLabel(r.customer_discount_rate)}</td>
                        <td className="text-right px-2">{r.commission_configured ? pctLabel(r.commission_rate) : "À configurer"}</td><td className="px-2">{r.note ?? ""}</td><td className="px-2 text-xs text-muted-foreground">{r.created_by ?? ""}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-muted-foreground">Chaque commande garde le taux figé au moment du paiement ; un changement de taux ne recalcule pas les commandes passées.</p>
            </section>
          </>
        )}
      </main>
    </AdminLayout>
  );
};

type Write = (body: Record<string, unknown>, ok: string) => Promise<void>;

const useAction = () => {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    if (busy) return false;
    setBusy(true); setErr(null);
    try { await fn(); return true; } catch (e) { setErr(e instanceof Error ? e.message : String(e)); return false; } finally { setBusy(false); }
  };
  return { busy, err, run };
};
const ErrLine = ({ err }: { err: string | null }) => (err ? <p className="border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">{err}</p> : null);

function Metrics({ label, m }: { label: string; m: PartnerMetrics }) {
  const { balance, provisional, overpaid } = partnerBalance(m);
  return (
    <section className="space-y-2">
      <h2 className="text-xs uppercase tracking-[0.08em] text-muted-foreground">{label}</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Metric label="Commandes" value={String(m.ordersCount)} sub={`${m.paidOrdersCount} payée(s)${m.unpaidCount ? ` · ${m.unpaidCount} non encaissée(s)` : ""}`} />
        <Metric label="CA après remboursements" value={money(m.revenueNet)} sub={`encaissé ${money(m.collected)} · remboursé ${money(m.refunded)}`} />
        <Metric label="Commission due" value={money(commissionDue(m))} sub={`sur une base de ${money(m.commissionBase)} (prix de base des gâteaux)`} />
        <Metric label="Net pour Bento" value={money(netForBento(m))} sub={m.toCheckCount ? "CA − commission (provisoire : commandes à vérifier)" : "CA après remboursements − commission"} tone={m.toCheckCount ? "warn" : undefined} />
        <Metric label="À vérifier" value={String(m.toCheckCount)} sub={m.toCheckCount ? `commission initiale ${money(m.toCheckInitial)}` : "aucun remboursement sans motif"} tone={m.toCheckCount ? "warn" : undefined} />
        <Metric label="Déjà payé" value={money(m.payouts)} sub={`${m.payoutsCount} paiement(s)`} />
        <Metric label="Reste à payer" value={money(balance)} tone={overpaid ? "bad" : provisional ? "warn" : undefined}
          sub={overpaid ? "trop versé : à compenser sur un prochain paiement" : provisional ? "provisoire : commandes à vérifier non comptées" : "commission due − déjà payé"} />
      </div>
    </section>
  );
}

function Orders({ orders, pin, setPin, write }: { orders: PartnerOrder[]; pin: string; setPin: (v: string) => void; write: Write }) {
  return (
    <section className="space-y-2" data-testid="partner-orders">
      <h2 className="font-semibold uppercase tracking-[0.08em] text-sm">Commandes attribuées par le lien ({orders.length})</h2>
      {orders.length === 0 && <p className="text-sm text-muted-foreground">Aucune commande sur cette période.</p>}
      <div className="space-y-2">
        {orders.map((o) => <OrderCard key={o.id} o={o} pin={pin} setPin={setPin} write={write} />)}
      </div>
    </section>
  );
}

function OrderCard({ o, pin, setPin, write }: { o: PartnerOrder; pin: string; setPin: (v: string) => void; write: Write }) {
  const c = o.commission;
  const tone = c.status === "to_check" ? "border-amber-400 bg-amber-50/50" : "border-border/60";
  return (
    <div className={cn("border p-3 text-sm space-y-2", tone)}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Link to={`/admin/order/${o.id}`} className="font-bold underline underline-offset-2">{o.orderNumber ?? o.id.slice(0, 8)}</Link>
        <span className="text-muted-foreground">{fmtDate(o.paidAt ?? o.createdAt)} · {o.customer || "—"}</span>
        <span className="tabular-nums">total {money(o.total)}{o.partnerDiscount ? ` (remise partenaire −${money(o.partnerDiscount)})` : ""}</span>
        <span className="flex-1" />
        <span className={cn("text-[11px] px-1.5 py-0.5 border",
          c.status === "earned" && "border-emerald-300 bg-emerald-50 text-emerald-900",
          c.status === "to_check" && "border-amber-400 bg-amber-100 text-amber-900",
          (c.status === "unpaid" || c.status === "none") && "border-border text-muted-foreground")}>
          {c.status === "earned" ? "Due" : STATUS_LABELS[c.status]}
        </span>
      </div>
      <p className="text-xs text-muted-foreground tabular-nums">
        Commission initiale {money(c.initial)} ({pctLabel(c.rate)} de {money(c.base)})
        {c.cancelledCommission > 0 && <> · retirée (annulation client) −{money(c.cancelledCommission)}</>}
        {c.earned != null && <> · <b className="text-foreground">due {money(c.earned)}</b></>}
        {c.refunded > 0 && <> · encaissé {money(c.collected)}, remboursé {money(c.refunded)}</>}
      </p>
      {c.status === "to_check" && <p className="text-xs text-amber-900">À vérifier : {c.toCheckReasons.join(" ; ") || "remboursement sans motif"}. Aucune décision automatique.</p>}
      {c.refunds.length > 0 && (
        <ul className="space-y-2">
          {c.refunds.map((r) => <RefundRow key={r.id} r={r} items={o.items} pin={pin} setPin={setPin} write={write} />)}
        </ul>
      )}
    </div>
  );
}

function RefundRow({ r, items, pin, setPin, write }: { r: PartnerOrder["commission"]["refunds"][number]; items: PartnerOrder["items"]; pin: string; setPin: (v: string) => void; write: Write }) {
  const [open, setOpen] = useState(false);
  const [motif, setMotif] = useState<RefundMotif | "">(r.motif ?? "");
  const [sel, setSel] = useState<string[]>(r.cancelledItems ?? []);
  const [note, setNote] = useState(r.note ?? "");
  const a = useAction();
  const cakeItems = useMemo(() => items.filter((i) => i.commission > 0), [items]);
  const canSave = motif === "commercial" || (motif === "client_cancellation" && sel.length > 0) || (motif === "" && r.motif != null);
  return (
    <li className="border-t border-border/60 pt-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="tabular-nums">Remboursement {money(r.amount)} du {fmtDate(r.refundedAt)}</span>
        <span className={cn("text-xs", r.motif ? "text-muted-foreground" : "text-amber-900 font-semibold")}>
          {r.motif ? MOTIF_LABELS[r.motif] : "Motif manquant"}
          {r.motif === "client_cancellation" && r.cancelledItems.length > 0 && ` — ${r.cancelledItems.map((id) => itemName(items.find((i) => i.id === id)?.product ?? "article")).join(", ")}`}
          {r.note ? ` · ${r.note}` : ""}
        </span>
        <span className="flex-1" />
        <Button size="sm" variant="outline" className="rounded-none h-8" onClick={() => setOpen((v) => !v)}>{r.motif ? "Modifier le motif" : "Indiquer le motif"}</Button>
      </div>
      {open && (
        <div className="mt-2 space-y-2 bg-secondary/20 p-3">
          <div className="space-y-1">
            {(Object.keys(MOTIF_LABELS) as RefundMotif[]).map((k) => (
              <label key={k} className="flex items-center gap-2"><input type="radio" name={`motif-${r.id}`} checked={motif === k} onChange={() => setMotif(k)} />{MOTIF_LABELS[k]}</label>
            ))}
            {r.motif && <label className="flex items-center gap-2 text-muted-foreground"><input type="radio" name={`motif-${r.id}`} checked={motif === ""} onChange={() => setMotif("")} />Retirer le motif (repasse « À vérifier »)</label>}
          </div>
          {motif === "client_cancellation" && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Gâteaux annulés (seuls ceux-ci perdent leur commission) :</p>
              {cakeItems.length === 0 && <p className="text-xs text-amber-900">Aucun article avec commission dans cette commande.</p>}
              {cakeItems.map((i) => (
                <label key={i.id} className="flex items-center gap-2"><input type="checkbox" className="w-4 h-4" checked={sel.includes(i.id)} onChange={(e) => setSel((s) => (e.target.checked ? [...s, i.id] : s.filter((x) => x !== i.id)))} />
                  {itemName(i.product)}{i.size ? ` (${sizeLabel(i.size, "fr")})` : ""} — commission {money(i.commission)}</label>
              ))}
            </div>
          )}
          <div className="space-y-1"><Label className="text-xs">Note (facultatif)</Label><Input value={note} onChange={(e) => setNote(e.target.value)} className="rounded-none h-9" /></div>
          <ErrLine err={a.err} />
          <div className="flex flex-wrap items-end gap-2">
            <PinField pin={pin} setPin={setPin} />
            <Button className="rounded-none" disabled={!canSave || a.busy} onClick={async () => {
              if (await a.run(() => write({ action: "set_refund_motif", refundId: r.id, motif: motif || null, itemIds: motif === "client_cancellation" ? sel : [], note }, "Motif enregistré."))) setOpen(false);
            }}>{a.busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Enregistrer le motif</Button>
          </div>
        </div>
      )}
    </li>
  );
}

function Payouts({ d, pin, setPin, write }: { d: PartnerDetail; pin: string; setPin: (v: string) => void; write: Write }) {
  const blank = () => ({ paidOn: zToday(), amount: "", periodStart: "", periodEnd: "", reference: "", note: "", key: crypto.randomUUID() });
  const [f, setF] = useState(blank);
  const [open, setOpen] = useState(false);
  const [voiding, setVoiding] = useState<{ id: string; reason: string } | null>(null);
  const a = useAction();
  const { balance, provisional, overpaid } = partnerBalance(d.total);
  return (
    <section className="border border-border/60 p-4 space-y-3 text-sm" data-testid="partner-payouts">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold uppercase tracking-[0.08em] text-sm flex-1">Paiements au partenaire</h2>
        <Button variant="outline" className="rounded-none" onClick={() => setOpen((v) => !v)}>Enregistrer un paiement</Button>
      </div>
      <p className="text-xs text-muted-foreground">Enregistre un paiement déjà effectué hors du site (aucun virement automatique). Total dû {money(commissionDue(d.total))} · déjà payé {money(d.total.payouts)} · reste {money(balance)}{provisional ? " (provisoire)" : ""}.</p>
      {overpaid && <p className="border border-red-300 bg-red-50 text-red-900 px-3 py-2">Trop versé de {money(-balance)} (commission retirée après paiement) : ajustement à compenser sur un prochain paiement.</p>}
      {open && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 bg-secondary/20 p-3 [&>*]:min-w-0">
          <div className="space-y-1"><Label className="text-xs">Date du paiement</Label><Input type="date" value={f.paidOn} onChange={(e) => setF({ ...f, paidOn: e.target.value })} className="rounded-none h-9" /></div>
          <div className="space-y-1"><Label className="text-xs">Montant (CHF)</Label><Input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} className="rounded-none h-9" /></div>
          <div className="space-y-1"><Label className="text-xs">Référence (facultatif)</Label><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} className="rounded-none h-9" /></div>
          <div className="space-y-1"><Label className="text-xs">Période couverte — du</Label><Input type="date" value={f.periodStart} onChange={(e) => setF({ ...f, periodStart: e.target.value })} className="rounded-none h-9" /></div>
          <div className="space-y-1"><Label className="text-xs">au</Label><Input type="date" value={f.periodEnd} onChange={(e) => setF({ ...f, periodEnd: e.target.value })} className="rounded-none h-9" /></div>
          <div className="space-y-1"><Label className="text-xs">Note</Label><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} className="rounded-none h-9" /></div>
          <div className="sm:col-span-3"><ErrLine err={a.err} /></div>
          <div className="sm:col-span-3 flex flex-wrap items-end gap-2">
            <PinField pin={pin} setPin={setPin} />
            <Button className="rounded-none" disabled={!f.amount || a.busy} onClick={async () => {
              if (await a.run(() => write({ action: "payout_save", partnerId: d.partner.id, idempotencyKey: f.key, ...f }, "Paiement enregistré."))) { setF(blank()); setOpen(false); }
            }}>{a.busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Enregistrer</Button>
          </div>
        </div>
      )}
      {d.payouts.length === 0 ? <p className="text-muted-foreground">Aucun paiement enregistré.</p> : (
        <ul className="divide-y divide-border/60 border-t border-border/60">
          {d.payouts.map((x) => (
            <li key={x.id} className="py-2 flex flex-wrap items-center gap-2">
              <span className={cn("flex-1 min-w-[220px] tabular-nums", x.voided_at && "line-through text-muted-foreground")}>
                {fmtDate(x.paid_on)} · <b>{money(x.amount)}</b> · période {fmtDate(x.period_start)} – {fmtDate(x.period_end)}{x.reference ? ` · réf. ${x.reference}` : ""}{x.note ? ` · ${x.note}` : ""}
              </span>
              {x.voided_at ? <span className="text-xs text-muted-foreground">Annulé le {fmtDate(x.voided_at)} ({x.void_reason})</span>
                : voiding?.id === x.id ? (
                  <span className="flex flex-wrap items-end gap-2">
                    <Input value={voiding.reason} onChange={(e) => setVoiding({ id: x.id, reason: e.target.value })} placeholder="Raison de l'annulation" className="rounded-none h-9 w-52" />
                    <PinField pin={pin} setPin={setPin} />
                    <Button size="sm" variant="destructive" className="rounded-none" disabled={!voiding.reason.trim() || a.busy}
                      onClick={async () => { if (await a.run(() => write({ action: "payout_void", id: x.id, reason: voiding.reason }, "Paiement annulé."))) setVoiding(null); }}>Annuler ce paiement</Button>
                  </span>
                ) : <Button size="sm" variant="ghost" className="rounded-none" onClick={() => setVoiding({ id: x.id, reason: "" })}>Annuler…</Button>}
            </li>
          ))}
        </ul>
      )}
      {voiding && <ErrLine err={a.err} />}
    </section>
  );
}

export default AdminPartner;
