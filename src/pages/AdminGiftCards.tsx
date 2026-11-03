import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarClock, Copy, FileDown, Loader2, Lock, Mail, Plus, Power, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import AdminLayout from "@/components/admin/AdminLayout";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { isAdminEmail } from "@/lib/adminAccess";
import { useSessionPin } from "@/lib/adminSession";
import { money } from "@/lib/compta";
import { formatDateCH } from "@/lib/orderLabels";
import {
  downloadBase64Pdf, giftCardState, giftCardsApi,
  type AdminGiftCard, type GiftCardSummary,
} from "@/lib/giftCards";
import { cn } from "@/lib/utils";

// Admin › Bons cadeaux (F39, 03.11.2026). Every voucher (bought online or
// made by hand), its balance and the orders it paid; a voucher made by hand
// (studio sale, giveaway, goodwill gesture); deactivate, change the expiry,
// resend the email, download the PDF. A voucher is never refunded in cash.

type CreateForm = {
  amount: string; buyerName: string; buyerEmail: string; recipientName: string; message: string;
  months: string; lang: "fr" | "en"; note: string; sendEmail: boolean;
};
const emptyCreate = (): CreateForm => ({
  amount: "", buyerName: "", buyerEmail: "", recipientName: "", message: "", months: "12", lang: "fr", note: "", sendEmail: true,
});
type Editing = { id: string; kind: "expiry" | "email"; value: string } | null;

const zurichToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date());
const monthRange = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, "0")}` };
};
const dateOf = (iso: string | null) => (iso ? formatDateCH(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date(iso))) : "—");
const EVENT_LABELS: Record<string, string> = {
  create_manual: "Créé à la main", disable: "Désactivé", enable: "Réactivé", expiry: "Date changée",
  recredit: "Remis sur le bon", email_resent: "Email renvoyé",
};

const AdminGiftCards = () => {
  const { t } = useLang();
  const { user, loading: authLoading } = useAuth();
  const isAdmin = isAdminEmail(user?.email);
  const [cards, setCards] = useState<AdminGiftCard[] | null>(null);
  const [summary, setSummary] = useState<GiftCardSummary | null>(null);
  const [month, setMonth] = useState(() => zurichToday().slice(0, 7));
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [create, setCreate] = useState<CreateForm | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pin, setPin, pinBySession] = useSessionPin();

  useEffect(() => {
    document.title = "Admin – Bons cadeaux – Bento Cake Studio";
    return () => { document.title = "Bento Cake Studio Geneva"; };
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const range = monthRange(month);
      const [list, sum] = await Promise.all([
        giftCardsApi<AdminGiftCard[]>({ action: "list", search, status }),
        giftCardsApi<GiftCardSummary>({ action: "summary", ...range }),
      ]);
      setCards(list ?? []);
      setSummary(sum);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [month, search, status]);
  useEffect(() => {
    if (authLoading || !isAdmin) return;
    void load();
    // search is applied with the button / Enter, not on every key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, isAdmin, month, status]);

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

  const needPin = () => {
    if (!pinBySession && !pin.trim()) { setError("Saisissez le code PIN administrateur (en haut de la page)."); return true; }
    return false;
  };
  const run = async (key: string, fn: () => Promise<string | void>) => {
    setBusy(key); setError(null); setNotice(null);
    try {
      const msg = await fn();
      if (msg) setNotice(msg);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const copy = async (code: string) => {
    try { await navigator.clipboard.writeText(code); setNotice(`Code copié : ${code}`); } catch { setNotice(code); }
  };
  const submitCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!create || needPin()) return;
    void run("create", async () => {
      const res = await giftCardsApi<{ card: { code: string }; emailSent: boolean }>({ action: "create", pin, ...create, months: Number(create.months) });
      setCreate(null);
      await load();
      return `Bon ${res.card.code} créé${res.emailSent ? ", email envoyé" : ""}.`;
    });
  };
  const setStatusOf = (c: AdminGiftCard, active: boolean) => {
    if (needPin()) return;
    if (!active && !window.confirm(`Désactiver le bon ${c.code} ? Il ne pourra plus être utilisé (vous pourrez le réactiver).`)) return;
    void run(c.id, async () => {
      await giftCardsApi({ action: "set_status", pin, id: c.id, active });
      await load();
      return active ? `Bon ${c.code} réactivé.` : `Bon ${c.code} désactivé.`;
    });
  };
  const saveEditing = () => {
    if (!editing || needPin()) return;
    const c = cards?.find((x) => x.id === editing.id);
    if (!c) return;
    void run(c.id, async () => {
      if (editing.kind === "expiry") {
        await giftCardsApi({ action: "set_expiry", pin, id: c.id, expires: editing.value });
        setEditing(null);
        await load();
        return `Bon ${c.code} valable jusqu'au ${formatDateCH(editing.value)}.`;
      }
      const res = await giftCardsApi<{ sentTo: string }>({ action: "resend_email", pin, id: c.id, email: editing.value });
      setEditing(null);
      await load();
      return `Email du bon ${c.code} envoyé à ${res.sentTo}.`;
    });
  };
  const pdf = (c: AdminGiftCard) => void run(c.id, async () => {
    const res = await giftCardsApi<{ filename: string; base64: string }>({ action: "pdf", id: c.id });
    downloadBase64Pdf(res.filename, res.base64);
  });
  const setC = (patch: Partial<CreateForm>) => setCreate((f) => (f ? { ...f, ...patch } : f));

  const stat = (label: string, value: string, hint?: string) => (
    <div className="border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );

  return (
    <AdminLayout>
      <main className="container mx-auto px-4 py-8 max-w-5xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-sans uppercase tracking-[0.105em] text-2xl md:text-3xl text-foreground font-semibold">Bons cadeaux</h1>
          {!create && <Button className="rounded-none" onClick={() => { setError(null); setCreate(emptyCreate()); }}><Plus className="w-4 h-4 mr-1" /> Créer un bon</Button>}
        </div>
        <p className="text-sm text-muted-foreground">
          Valables 12 mois, sur tout le site, à taper dans le champ « Code promo » du panier. Un bon n'est jamais remboursé en argent.
          Quand une commande payée avec un bon est annulée en entier ou refusée, le montant revient tout seul sur le bon. Pour une annulation partielle,
          remettez le montant depuis la page de la commande.
        </p>

        {!pinBySession && (
          <div className="flex items-center gap-2">
            <Label className="text-xs">Code PIN administrateur (pour créer ou modifier)</Label>
            <PasswordInput autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} className="rounded-none h-9 w-36" />
          </div>
        )}
        {error && <p className="border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="alert">{error}</p>}
        {notice && <p className="border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 break-all" role="status">{notice}</p>}

        {/* Chiffres */}
        <section className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">Chiffres du mois</h2>
            <Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="rounded-none h-9 w-44" />
          </div>
          {summary && (
            <div className="grid gap-2 grid-cols-2 md:grid-cols-5">
              {stat("Vendus en ligne", money(summary.sold.amount), `${summary.sold.count} bon${summary.sold.count > 1 ? "s" : ""}, encaissés par PostFinance`)}
              {stat("Créés à la main", money(summary.manual.amount), `${summary.manual.count} bon${summary.manual.count > 1 ? "s" : ""}`)}
              {stat("Utilisés sur des commandes", money(summary.used), "commandes acceptées ce mois")}
              {stat("Expirés non utilisés", money(summary.expiredUnused))}
              {stat("En circulation aujourd'hui", money(summary.outstanding), `${summary.outstandingCount} bon${summary.outstandingCount > 1 ? "s" : ""} avec un solde`)}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            « En circulation » = ce que vous devez encore aux clients (soldes des bons valables). Les commandes payées avec un bon apparaissent avec la ligne
            « Payé par bon cadeau » ; l'encaissé du tableau de bord ne compte que l'argent payé par carte.
          </p>
        </section>

        {create && (
          <form onSubmit={submitCreate} className="border border-border p-4 space-y-4 bg-secondary/10">
            <h2 className="font-semibold">Nouveau bon (fait à la main)</h2>
            <p className="text-xs text-muted-foreground">Vente au studio, concours, geste commercial… Aucun paiement ne passe par le site.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Montant (CHF)</Label>
                <Input value={create.amount} onChange={(e) => setC({ amount: e.target.value.replace(/[^0-9.,]/g, "") })} inputMode="decimal" className="rounded-none w-32" required />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Valable (mois)</Label>
                <Input value={create.months} onChange={(e) => setC({ months: e.target.value.replace(/[^0-9]/g, "") })} inputMode="numeric" className="rounded-none w-24" required />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Nom de l'acheteur ou du client</Label>
                <Input value={create.buyerName} onChange={(e) => setC({ buyerName: e.target.value })} className="rounded-none" required />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Email (facultatif)</Label>
                <Input type="email" value={create.buyerEmail} onChange={(e) => setC({ buyerEmail: e.target.value })} className="rounded-none" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Pour (prénom, facultatif)</Label>
                <Input value={create.recipientName} onChange={(e) => setC({ recipientName: e.target.value })} maxLength={80} className="rounded-none" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Langue du bon</Label>
                <select value={create.lang} onChange={(e) => setC({ lang: e.target.value as "fr" | "en" })} className="h-10 w-32 border border-input bg-background px-2 text-sm">
                  <option value="fr">Français</option>
                  <option value="en">English</option>
                </select>
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs">Petit mot sur le bon (facultatif)</Label>
                <Input value={create.message} onChange={(e) => setC({ message: e.target.value })} maxLength={200} className="rounded-none" />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs">Note interne (jamais sur le bon)</Label>
                <Input value={create.note} onChange={(e) => setC({ note: e.target.value })} maxLength={500} placeholder="Payé en espèces au studio, gagnant du concours Instagram…" className="rounded-none" />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="w-4 h-4" checked={create.sendEmail} onChange={(e) => setC({ sendEmail: e.target.checked })} disabled={!create.buyerEmail.trim()} />
              Envoyer le bon (PDF) par email {!create.buyerEmail.trim() && <span className="text-muted-foreground">(indiquez un email)</span>}
            </label>
            <div className="flex gap-2">
              <Button type="submit" className="rounded-none" disabled={busy === "create"}>{busy === "create" && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Créer le bon</Button>
              <Button type="button" variant="outline" className="rounded-none" onClick={() => setCreate(null)}>Annuler</Button>
            </div>
          </form>
        )}

        {/* Liste */}
        <section className="space-y-3">
          <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); void load(); }}>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Code, nom ou email" className="rounded-none h-9 w-64" />
            <Button type="submit" variant="outline" size="sm" className="rounded-none h-9"><Search className="w-4 h-4 mr-1" />Chercher</Button>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 border border-input bg-background px-2 text-sm">
              <option value="all">Tous</option>
              <option value="active">Actifs (avec un solde)</option>
              <option value="used">Utilisés</option>
              <option value="expired">Expirés</option>
              <option value="disabled">Désactivés</option>
            </select>
          </form>

          {loading && !cards && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
          {cards && cards.length === 0 && (
            <p className="text-sm text-muted-foreground border border-dashed border-border px-4 py-6 text-center">Aucun bon cadeau.</p>
          )}
          <ul className="space-y-3">
            {cards?.map((c) => {
              const st = giftCardState(c);
              const edit = editing?.id === c.id ? editing : null;
              return (
                <li key={c.id} className={cn("border border-border p-4 space-y-2", c.status === "disabled" && "opacity-70")}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-lg font-semibold tracking-wider">{c.code}</span>
                    <span className={cn("text-xs px-1.5 py-0.5 border", st.cls)}>{st.label}</span>
                    {c.source === "manual" && <span className="text-xs px-1.5 py-0.5 border border-border text-muted-foreground">Fait à la main</span>}
                    <span className="text-sm tabular-nums"><strong>{money(c.balance)}</strong> restant sur {money(c.initialAmount)}</span>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {c.buyerName}{c.buyerEmail ? ` · ${c.buyerEmail}` : " · pas d'email"}
                    {c.recipientName ? ` · pour ${c.recipientName}` : ""}
                    {" · "}{c.source === "online" ? "acheté" : "créé"} le {dateOf(c.paidAt ?? c.createdAt)}
                    {" · "}valable jusqu'au {dateOf(c.expiresAt)}
                  </div>
                  {c.note && <p className="text-xs text-muted-foreground">Note : {c.note}</p>}
                  {c.uses.length > 0 && (
                    <ul className="text-sm space-y-0.5">
                      {c.uses.map((u) => (
                        <li key={u.orderId} className="tabular-nums">
                          <Link to={`/admin/order/${u.orderId}`} className="text-primary hover:underline">{u.orderNumber ?? "Commande"}</Link>
                          {u.customer ? ` · ${u.customer}` : ""}{" · "}{money(u.amount)}
                          {u.status === "reserved" && " · en attente d'acceptation"}
                          {u.recredited > 0 && ` · ${money(u.recredited)} remis sur le bon`}
                        </li>
                      ))}
                    </ul>
                  )}
                  {c.events.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {c.events.map((e) => `${EVENT_LABELS[e.action] ?? e.action}${e.amount ? ` ${money(e.amount)}` : ""} le ${dateOf(e.at)}`).join(" · ")}
                    </p>
                  )}

                  {edit && (
                    <div className="flex flex-wrap items-center gap-2">
                      {edit.kind === "expiry"
                        ? <Input type="date" value={edit.value} onChange={(e) => setEditing({ ...edit, value: e.target.value })} className="rounded-none h-9 w-44" />
                        : <Input type="email" value={edit.value} onChange={(e) => setEditing({ ...edit, value: e.target.value })} placeholder="Adresse email" className="rounded-none h-9 w-64" />}
                      <Button size="sm" className="rounded-none h-9" disabled={busy === c.id || !edit.value} onClick={saveEditing}>
                        {busy === c.id && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}{edit.kind === "expiry" ? "Enregistrer la date" : "Envoyer"}
                      </Button>
                      <Button size="sm" variant="outline" className="rounded-none h-9" onClick={() => setEditing(null)}>Annuler</Button>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" className="rounded-none h-8" onClick={() => copy(c.code)}><Copy className="w-3.5 h-3.5 mr-1" />Copier le code</Button>
                    <Button size="sm" variant="outline" className="rounded-none h-8" disabled={busy === c.id} onClick={() => pdf(c)}><FileDown className="w-3.5 h-3.5 mr-1" />PDF</Button>
                    <Button size="sm" variant="outline" className="rounded-none h-8" onClick={() => setEditing({ id: c.id, kind: "email", value: c.buyerEmail ?? "" })}><Mail className="w-3.5 h-3.5 mr-1" />Renvoyer l'email</Button>
                    <Button size="sm" variant="outline" className="rounded-none h-8" onClick={() => setEditing({ id: c.id, kind: "expiry", value: new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date(c.expiresAt)) })}><CalendarClock className="w-3.5 h-3.5 mr-1" />Changer la date</Button>
                    <Button size="sm" variant="ghost" className="rounded-none h-8" disabled={busy === c.id} onClick={() => setStatusOf(c, c.status !== "active")}>
                      <Power className="w-3.5 h-3.5 mr-1" />{c.status === "active" ? "Désactiver" : "Réactiver"}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </main>
    </AdminLayout>
  );
};

export default AdminGiftCards;
