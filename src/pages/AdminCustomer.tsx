import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, GitMerge, Loader2, Lock, Plus, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import AdminLayout from "@/components/admin/AdminLayout";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { isAdminEmail } from "@/lib/adminAccess";
import { PRODUCT_LABELS, sizeLabel } from "@/lib/orderLabels";
import { chf, formatDay } from "@/lib/refunds";
import {
  ALERT_LABELS, PAYMENT_LABELS, SOURCE_LABELS, VALIDATION_LABELS,
  customersApi, CustomersError, fullName, type CustomerDetail, type CustomerOrder,
} from "@/lib/customers";
import { cn } from "@/lib/utils";

// Admin > Clients > fiche (lot C). Contact details and notes are editable
// (admin PIN); editing never rewrites any order or invoice — each order keeps
// its own historical copy. Figures: lot 1–3 registers, test orders excluded.
// Reward balance and welcome offer are read from the existing account
// (profiles), never recomputed here. Merge is manual, with a side-by-side
// preview; nothing is deleted.

const box = "border border-border/60 bg-background p-4";
const h2 = "font-sans text-[12px] tracking-[0.105em] font-semibold uppercase text-foreground";

const AdminCustomer = () => {
  const { id } = useParams<{ id: string }>();
  const { t, lang } = useLang();
  const l = lang === "en" ? "en" : "fr";
  const { user, loading: authLoading } = useAuth();
  const isAdmin = isAdminEmail(user?.email);
  const navigate = useNavigate();
  const [data, setData] = useState<CustomerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [mergeWith, setMergeWith] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try { setData(await customersApi<CustomerDetail>({ action: "get", customerId: id })); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [id]);

  useEffect(() => { if (!authLoading && isAdmin) load(); }, [authLoading, isAdmin, load]);
  useEffect(() => {
    if (data) document.title = `Admin – ${fullName(data.customer)} – Bento Cake Studio`;
    return () => { document.title = "Bento Cake Studio Geneva"; };
  }, [data]);

  const write = async (body: Record<string, unknown>, ok: string) => {
    if (!pin.trim()) { setMsg({ ok: false, text: t("Enter the admin PIN first.", "Saisissez d'abord le code PIN administrateur.") }); return false; }
    try {
      await customersApi({ ...body, pin });
      setMsg({ ok: true, text: ok });
      await load();
      return true;
    } catch (e) {
      const ce = e as CustomersError;
      setMsg({ ok: false, text: ce.message });
      return false;
    }
  };

  if (authLoading) return <AdminLayout><main className="py-16 text-center"><Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" /></main></AdminLayout>;
  if (!user || !isAdmin) {
    return (
      <AdminLayout>
        <main className="max-w-md mx-auto px-6 py-24 text-center">
          <Lock className="w-8 h-8 mx-auto text-muted-foreground mb-4" />
          <h1 className="font-sans uppercase tracking-[0.105em] text-2xl mb-4">{!user ? t("Admin sign-in required", "Connexion administrateur requise") : t("Access denied", "Accès refusé")}</h1>
          {!user && <Button asChild className="rounded-none"><Link to={`/login?redirect=${encodeURIComponent(window.location.pathname)}`}>{t("Sign in", "Se connecter")}</Link></Button>}
        </main>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <main className="container mx-auto px-4 py-8 max-w-5xl space-y-5">
        <Link to="/admin/customers" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="w-4 h-4" /> {t("All customers", "Tous les clients")}</Link>
        {error && <p className="border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">{error}</p>}
        {!data && !error && <div className="py-16 text-center"><Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" /></div>}
        {data && (() => {
          const c = data.customer;
          const s = data.stats;
          return (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h1 className="font-sans uppercase tracking-[0.105em] text-2xl md:text-3xl font-semibold flex items-center gap-2">
                    <UserRound className="w-6 h-6 text-primary" strokeWidth={1.5} /> {fullName(c)}
                  </h1>
                  <p className="text-sm text-muted-foreground">
                    {data.account ? t("Has a customer account", "A un compte client") : t("No account (guest or manual orders)", "Sans compte (commandes invité ou manuelles)")}
                    {" · "}{t("record created", "fiche créée le")} {formatDay(c.createdAt, l)}
                  </p>
                </div>
                {!c.mergedInto && (
                  <Button asChild className="rounded-none">
                    <Link to={`/admin/manual-orders/new?customer=${c.id}`}><Plus className="w-4 h-4 mr-1" /> {t("New manual order", "Nouvelle commande manuelle")}</Link>
                  </Button>
                )}
              </div>

              {c.mergedInto && (
                <p className="border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  {t("This record was merged into another one.", "Cette fiche a été fusionnée dans une autre.")}{" "}
                  <Link to={`/admin/customers/${c.mergedInto}`} className="underline">{t("Open it", "L'ouvrir")}</Link>
                </p>
              )}

              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <Label htmlFor="cust-pin" className="text-xs text-muted-foreground">{t("Admin PIN (to edit)", "Code PIN administrateur (pour modifier)")}</Label>
                  <Input id="cust-pin" type="password" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} className="w-40 rounded-none" />
                </div>
                {msg && <p role="status" className={cn("text-sm px-3 py-2 border", msg.ok ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-red-50 border-red-200 text-red-800")}>{msg.text}</p>}
              </div>

              {/* Summary */}
              <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2" data-testid="customer-stats">
                {[
                  { k: "orders", label: t("Orders", "Commandes"), v: String(s.orders_count) },
                  { k: "paid", label: t("Paid orders", "Commandes payées"), v: String(s.paid_count) },
                  { k: "collected", label: t("Collected", "Encaissé"), v: chf(s.collected) },
                  { k: "refunded", label: t("Refunded", "Remboursé"), v: chf(s.refunded) },
                  { k: "net", label: t("Net paid", "Net payé"), v: chf(s.net), strong: true },
                  { k: "dates", label: t("First · last order", "Première · dernière"), v: s.first_order_at ? `${formatDay(s.first_order_at, l)} · ${formatDay(s.last_order_at, l)}` : "—" },
                ].map((x) => (
                  <div key={x.k} data-k={x.k} className={cn("px-3 py-2 border", x.strong ? "border-primary/40 bg-primary/5" : "border-border/60")}>
                    <span className="block text-[11px] uppercase tracking-[0.08em] text-muted-foreground">{x.label}</span>
                    <span className="block font-semibold tabular-nums text-sm sm:text-base">{x.v}</span>
                  </div>
                ))}
              </section>
              {s.test_orders > 0 && <p className="text-xs text-muted-foreground">{t(`${s.test_orders} test order(s) not counted.`, `${s.test_orders} commande(s) de test non comptée(s).`)}</p>}

              {/* Alerts */}
              {data.alerts.length > 0 && (
                <section className="space-y-2" data-testid="customer-alerts">
                  {data.alerts.map((a) => (
                    <div key={a.id} className="flex flex-wrap items-center gap-2 border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span className="flex-1 min-w-[200px]">{ALERT_LABELS[a.kind]?.[l] ?? a.kind}{a.detail ? ` — ${a.detail}` : ""}</span>
                      {a.otherCustomerId && <Link to={`/admin/customers/${a.otherCustomerId}`} className="underline text-xs">{t("Other record", "Autre fiche")}</Link>}
                      {a.otherCustomerId && !c.mergedInto && <Button size="sm" variant="outline" className="rounded-none h-8" onClick={() => setMergeWith(a.otherCustomerId)}>{t("Compare", "Comparer")}</Button>}
                      <Button size="sm" variant="ghost" className="rounded-none h-8" onClick={() => write({ action: "resolve_alert", alertId: a.id }, t("Alert closed.", "Alerte fermée."))}>{t("Mark as seen", "Marquer comme vue")}</Button>
                    </div>
                  ))}
                </section>
              )}

              {mergeWith && <MergePanel current={data} otherId={mergeWith} pin={pin}
                onClose={() => setMergeWith(null)}
                onMerged={(keepId) => { setMergeWith(null); setMsg({ ok: true, text: t("Records merged.", "Fiches fusionnées.") }); if (keepId !== c.id) navigate(`/admin/customers/${keepId}`); else load(); }} />}

              <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-4">
                <ContactForm detail={data} disabled={!!c.mergedInto}
                  onSave={(f) => write({ action: "save", customerId: c.id, ...f }, t("Customer saved. Past orders keep their own details.", "Fiche enregistrée. Les anciennes commandes gardent leurs propres coordonnées."))} />

                <div className="space-y-4">
                  <section className={box} data-testid="customer-account">
                    <h2 className={cn(h2, "mb-2")}>{t("Account & benefits", "Compte et avantages")}</h2>
                    {data.account ? (
                      <dl className="text-sm space-y-1">
                        <div className="flex justify-between"><dt className="text-muted-foreground">{t("Account email", "Email du compte")}</dt><dd className="truncate ml-2">{data.account.email}</dd></div>
                        <div className="flex justify-between"><dt className="text-muted-foreground">{t("Reward balance", "Cagnotte")}</dt><dd className="font-semibold tabular-nums">{chf(data.account.rewardBalance)}</dd></div>
                        <div className="flex justify-between"><dt className="text-muted-foreground">{t("Welcome offer", "Offre de bienvenue")}</dt>
                          <dd>{data.account.welcomeUsedAt ? `${t("used on", "utilisée le")} ${formatDay(data.account.welcomeUsedAt, l)}` : data.account.welcomeAvailable ? t("available", "disponible") : t("not available", "non disponible")}</dd></div>
                        <div className="flex justify-between"><dt className="text-muted-foreground">Newsletter</dt><dd>{data.account.newsletter ? t("yes", "oui") : t("no", "non")}</dd></div>
                        <p className="text-xs text-muted-foreground pt-1">{t("Read only — managed by the existing reward system.", "Lecture seule — géré par le système de cagnotte existant.")}</p>
                      </dl>
                    ) : <p className="text-sm text-muted-foreground">{t("No customer account: no reward balance.", "Pas de compte client : pas de cagnotte.")}</p>}
                  </section>

                  {data.possibleDuplicates.length > 0 && !c.mergedInto && (
                    <section className={box} data-testid="customer-duplicates">
                      <h2 className={cn(h2, "mb-2")}>{t("Possible duplicates", "Doublons possibles")}</h2>
                      <ul className="space-y-2">
                        {data.possibleDuplicates.map((d) => (
                          <li key={d.id} className="text-sm">
                            <Link to={`/admin/customers/${d.id}`} className="font-medium underline">{fullName(d)}</Link>
                            <span className="block text-xs text-muted-foreground">{[d.email, d.phone].filter(Boolean).join(" · ")}</span>
                            <span className="block text-xs text-muted-foreground">{t("Same", "Même")} {d.reasons.map((r) => r === "email" ? "email" : r === "phone" ? t("phone", "téléphone") : t("name", "nom")).join(", ")}</span>
                            <Button size="sm" variant="outline" className="rounded-none h-7 mt-1" onClick={() => setMergeWith(d.id)}><GitMerge className="w-3.5 h-3.5 mr-1" />{t("Compare and merge", "Comparer et fusionner")}</Button>
                          </li>
                        ))}
                      </ul>
                      <p className="text-xs text-muted-foreground mt-2">{t("Never merged automatically.", "Jamais fusionnés automatiquement.")}</p>
                    </section>
                  )}
                </div>
              </div>

              {/* Orders */}
              <section className="space-y-2">
                <h2 className={h2}>{t("Order history", "Historique des commandes")} ({data.orders.length})</h2>
                {data.orders.length === 0 ? <p className="text-sm text-muted-foreground">{t("No order yet.", "Aucune commande pour l'instant.")}</p> : (
                  <ul className="divide-y divide-border/60 border border-border/60" data-testid="customer-orders">
                    {data.orders.map((o) => <OrderRow key={o.id} o={o} currentName={fullName(c)} />)}
                  </ul>
                )}
              </section>

              {data.events.length > 0 && (
                <section className="space-y-1">
                  <h2 className={h2}>{t("Record history", "Historique de la fiche")}</h2>
                  <ul className="text-xs text-muted-foreground space-y-0.5">
                    {data.events.map((e, i) => (
                      <li key={i}>{formatDay(e.at, l)} · {eventLabel(e.kind, l)}{e.by ? ` · ${e.by}` : ""}</li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          );
        })()}
      </main>
    </AdminLayout>
  );
};

const eventLabel = (k: string, l: "fr" | "en") => ({
  created: { fr: "fiche créée", en: "record created" },
  updated: { fr: "coordonnées modifiées", en: "details edited" },
  absorbed: { fr: "une autre fiche a été fusionnée ici", en: "another record merged in" },
  merged_into: { fr: "fusionnée dans une autre fiche", en: "merged into another record" },
  order_relinked: { fr: "commande rattachée manuellement", en: "order relinked" },
}[k]?.[l] ?? k);

const OrderRow = ({ o, currentName }: { o: CustomerOrder; currentName: string }) => {
  const { t, lang } = useLang();
  const l = lang === "en" ? "en" : "fr";
  const products = o.items.map((it) => {
    if (it.product === "workshop") return `Workshop ${it.workshopType === "paint" ? "Peinture" : "Signature"}${it.participants ? ` ×${it.participants}` : ""}`;
    const name = PRODUCT_LABELS[it.product]?.[l] ?? it.product;
    const size = it.size && it.product !== "diy_kit" && it.product !== "edible_printing" ? ` ${sizeLabel(it.size, l)}` : "";
    return `${name}${size}${it.quantity && it.quantity > 1 ? ` ×${it.quantity}` : ""}`;
  });
  const orderName = [o.contact.firstName, o.contact.lastName].filter(Boolean).join(" ");
  return (
    <li className={cn("px-4 py-3 text-sm", o.isTest && "bg-secondary/30")} data-order={o.id}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Link to={`/admin/order/${o.id}`} className="font-bold text-base text-foreground underline underline-offset-2 tracking-wide">{o.orderNumber ?? o.id.slice(0, 8)}</Link>
        <span className="text-muted-foreground">{t("ordered", "commandée le")} {formatDay(o.createdAt, l)}</span>
        <span className="text-xs px-1.5 py-0.5 bg-secondary">{SOURCE_LABELS[o.source]?.[l] ?? o.source}</span>
        {o.isTest && <span className="text-[10px] px-1.5 py-0.5 bg-purple-100 text-purple-900">TEST</span>}
        {o.isDraft && <span className="text-[10px] px-1.5 py-0.5 bg-secondary">{t("Draft", "Brouillon")}</span>}
        <span className="ml-auto font-semibold tabular-nums">{chf(o.total)}</span>
      </div>
      <p className="text-xs text-muted-foreground mt-0.5">{products.join(", ")}</p>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs mt-0.5">
        {o.dates.length > 0 && <span>{t("Dates", "Dates")} : {o.dates.map((d) => formatDay(d, l)).join(", ")}</span>}
        <span>{VALIDATION_LABELS[o.validation]?.[l] ?? o.validation} · {PAYMENT_LABELS[o.payment]?.[l] ?? o.payment}</span>
        {Number(o.refunded) > 0 && <span className="text-amber-800">{t("Refunded", "Remboursé")} {chf(o.refunded)}</span>}
        {orderName && orderName !== currentName && <span className="text-muted-foreground">{t("Name on the order", "Nom sur la commande")} : {orderName}</span>}
      </div>
    </li>
  );
};

const ContactForm = ({ detail, disabled, onSave }: { detail: CustomerDetail; disabled: boolean; onSave: (f: Record<string, string>) => Promise<boolean> }) => {
  const { t } = useLang();
  const c = detail.customer;
  const initial = { firstName: c.firstName ?? "", lastName: c.lastName ?? "", email: c.email ?? "", phone: c.phone ?? "", company: c.company ?? "", address: c.address ?? "", notes: c.notes ?? "" };
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setF(initial); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [c.updatedAt]);
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  const field = (k: keyof typeof f, label: string, type = "text") => (
    <div className="space-y-1">
      <Label htmlFor={`cf-${k}`} className="text-xs text-muted-foreground">{label}</Label>
      <Input id={`cf-${k}`} type={type} value={f[k]} disabled={disabled} onChange={(e) => setF({ ...f, [k]: e.target.value })} className="rounded-none" />
    </div>
  );
  return (
    <form className={cn(box, "space-y-3")} data-testid="customer-contact"
      onSubmit={async (e) => { e.preventDefault(); if (!dirty || busy) return; setBusy(true); await onSave(f); setBusy(false); }}>
      <h2 className={h2}>{t("Contact details", "Coordonnées")}</h2>
      <div className="grid sm:grid-cols-2 gap-3">
        {field("firstName", t("First name", "Prénom"))}
        {field("lastName", t("Last name", "Nom"))}
        {field("email", "Email", "email")}
        {field("phone", t("Phone", "Téléphone"), "tel")}
        {field("company", t("Company", "Société"))}
        {field("address", t("Address", "Adresse"))}
      </div>
      <div className="space-y-1">
        <Label htmlFor="cf-notes" className="text-xs text-muted-foreground">{t("Internal notes", "Notes internes")}</Label>
        <Textarea id="cf-notes" value={f.notes} disabled={disabled} onChange={(e) => setF({ ...f, notes: e.target.value })} className="rounded-none min-h-[90px]" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" className="rounded-none" disabled={disabled || !dirty || busy}>{busy ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}{t("Save", "Enregistrer")}</Button>
        {dirty && <Button type="button" variant="ghost" className="rounded-none" onClick={() => setF(initial)}>{t("Undo changes", "Annuler les modifications")}</Button>}
      </div>
      <p className="text-xs text-muted-foreground">{t("Past orders and invoices keep the details they were issued with.", "Les commandes et factures déjà émises gardent les coordonnées de l'époque.")}</p>
    </form>
  );
};

// ── Manual merge with preview ────────────────────────────────────────────
const MergePanel = ({ current, otherId, pin, onClose, onMerged }: {
  current: CustomerDetail; otherId: string; pin: string; onClose: () => void; onMerged: (keepId: string) => void;
}) => {
  const { t, lang } = useLang();
  const l = lang === "en" ? "en" : "fr";
  const [other, setOther] = useState<CustomerDetail | null>(null);
  const [keep, setKeep] = useState(current.customer.id);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { customersApi<CustomerDetail>({ action: "get", customerId: otherId }).then(setOther).catch((e) => setErr(e.message)); }, [otherId]);
  const bothAccounts = !!current.account && !!other?.account;
  const card = (d: CustomerDetail) => (
    <label key={d.customer.id} className={cn("block border p-3 text-sm cursor-pointer space-y-0.5", keep === d.customer.id ? "border-primary bg-primary/5" : "border-border/60")}>
      <span className="flex items-center gap-2 font-semibold">
        <input type="radio" name="keep" checked={keep === d.customer.id} onChange={() => setKeep(d.customer.id)} /> {fullName(d.customer)}
      </span>
      <span className="block text-muted-foreground">{d.customer.email ?? "—"} · {d.customer.phone ?? "—"}</span>
      <span className="block">{d.account ? t("Has an account", "A un compte") : t("No account", "Sans compte")}</span>
      <span className="block">{d.stats.orders_count} {t("order(s)", "commande(s)")} · {t("net", "net")} {chf(d.stats.net)}</span>
      <span className="block text-xs text-muted-foreground">{t("created", "créée le")} {formatDay(d.customer.createdAt, l)}{d.customer.notes ? ` · ${t("has notes", "a des notes")}` : ""}</span>
    </label>
  );
  return (
    <section className="border-2 border-primary/40 p-4 space-y-3" data-testid="merge-panel">
      <h2 className={h2}>{t("Compare and merge", "Comparer et fusionner")}</h2>
      {!other && !err && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
      {err && <p className="text-sm text-red-800">{err}</p>}
      {other && (
        <>
          <p className="text-sm">{t("Choose the record to KEEP. All orders of the other one move to it; the other record stays, marked as merged. Order and invoice details are not changed.",
            "Choisissez la fiche à CONSERVER. Toutes les commandes de l'autre y sont rattachées ; l'autre fiche reste, marquée « fusionnée ». Les coordonnées des commandes et factures ne changent pas.")}</p>
          <div className="grid sm:grid-cols-2 gap-3">{card(current)}{card(other)}</div>
          {bothAccounts && <p className="text-sm bg-red-50 border border-red-200 text-red-800 px-3 py-2">{t("Both records have their own customer account: they cannot be merged.", "Les deux fiches ont chacune un compte client : fusion impossible.")}</p>}
          <div className="flex flex-wrap gap-2">
            <Button className="rounded-none" disabled={busy || bothAccounts || !pin.trim()} onClick={async () => {
              setBusy(true); setErr(null);
              const absorb = keep === current.customer.id ? other.customer.id : current.customer.id;
              try { await customersApi({ action: "merge", keepId: keep, absorbId: absorb, pin }); onMerged(keep); }
              catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
              finally { setBusy(false); }
            }}>{busy ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <GitMerge className="w-4 h-4 mr-1" />}{t("Merge", "Fusionner")}</Button>
            <Button variant="ghost" className="rounded-none" onClick={onClose}>{t("Cancel", "Annuler")}</Button>
          </div>
          {!pin.trim() && <p className="text-xs text-muted-foreground">{t("Enter the admin PIN above to merge.", "Saisissez le code PIN plus haut pour fusionner.")}</p>}
        </>
      )}
    </section>
  );
};

export default AdminCustomer;
