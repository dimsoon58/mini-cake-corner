import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Copy, Loader2, Lock, Pencil, Plus } from "lucide-react";
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
import { partnerLink, partnersApi, pctLabel } from "@/lib/partners";
import { cn } from "@/lib/utils";

// Admin > Influenceurs (F35, 03.11.2026). Un code promo par influenceur, à
// taper dans le panier : remise client sur le prix de base des produits
// (gâteaux, Dot Cakes, kits, impression ; jamais bougies ni workshops), sans
// commission, valable du … au …. Les commandes sont comptées comme pour les
// partenaires (orders.partner_id), tests exclus.

type Influencer = {
  id: string; name: string; slug: string; code: string | null; active: boolean; referralToken: string;
  discountRate: number; validFrom: string | null; validUntil: string | null; notes: string | null; createdAt: string;
  stats: { paidOrders: number; revenueNet: number; discountGiven: number };
};
type FormState = { id: string | null; name: string; code: string; discountPct: string; validFrom: string; validUntil: string; active: boolean; notes: string };

const todayISO = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date());
const plusMonths = (iso: string, n: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + n, d));
  return dt.toISOString().slice(0, 10);
};
const emptyForm = (): FormState => {
  const from = todayISO();
  return { id: null, name: "", code: "", discountPct: "15", validFrom: from, validUntil: plusMonths(from, 2), active: true, notes: "" };
};

function statusOf(i: Influencer, today: string): { label: string; cls: string } {
  if (!i.active) return { label: "Désactivé", cls: "border-border text-muted-foreground" };
  if (i.validFrom && today < i.validFrom) return { label: "À venir", cls: "border-sky-300 bg-sky-50 text-sky-900" };
  if (i.validUntil && today > i.validUntil) return { label: "Expiré", cls: "border-amber-300 bg-amber-50 text-amber-900" };
  return { label: "Actif", cls: "border-emerald-300 bg-emerald-50 text-emerald-900" };
}

const AdminInfluencers = () => {
  const { t } = useLang();
  const { user, loading: authLoading } = useAuth();
  const isAdmin = isAdminEmail(user?.email);
  const [data, setData] = useState<{ siteBaseUrl: string; influencers: Influencer[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pin, setPin, pinBySession] = useSessionPin();

  useEffect(() => {
    document.title = "Admin – Influenceurs – Bento Cake Studio";
    return () => { document.title = "Bento Cake Studio Geneva"; };
  }, []);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await partnersApi({ action: "influencer_list" })); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    if (authLoading || !isAdmin) return;
    void load();
  }, [authLoading, isAdmin, load]);

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

  const today = todayISO();
  const copy = async (value: string, what: string) => {
    try { await navigator.clipboard.writeText(value); setNotice(`${what} copié : ${value}`); } catch { setNotice(value); }
  };
  const edit = (i: Influencer) => {
    setFormError(null);
    setForm({
      id: i.id, name: i.name, code: i.code ?? "", discountPct: String(Math.round(i.discountRate * 10000) / 100),
      validFrom: i.validFrom ?? today, validUntil: i.validUntil ?? plusMonths(today, 2), active: i.active, notes: i.notes ?? "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    if (!pin.trim()) { setFormError("Saisissez le code PIN administrateur."); return; }
    setBusy(true); setFormError(null);
    try {
      await partnersApi({ action: "influencer_save", pin, ...form, code: form.code.trim().toUpperCase() });
      setNotice(form.id ? "Influenceur enregistré." : `Code ${form.code.trim().toUpperCase()} créé.`);
      setForm(null);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const set = (patch: Partial<FormState>) => setForm((f) => (f ? { ...f, ...patch } : f));

  return (
    <AdminLayout>
      <main className="container mx-auto px-4 py-8 max-w-5xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-sans uppercase tracking-[0.105em] text-2xl md:text-3xl text-foreground font-semibold">Influenceurs</h1>
          {!form && <Button className="rounded-none" onClick={() => { setFormError(null); setForm(emptyForm()); }}><Plus className="w-4 h-4 mr-1" /> Nouveau code</Button>}
        </div>
        <p className="text-sm text-muted-foreground">
          Un code par influenceur, à taper dans le panier. Remise sur le <strong>prix de base</strong> des gâteaux, Dot Cakes, kits et impressions
          (jamais sur les suppléments, décos, bougies, workshops ni la livraison). Non cumulable avec le rabais de bienvenue. L'influenceur ne touche rien.
          Changer le % ou les dates ne vaut que pour les nouvelles commandes.
        </p>
        {error && <p className="border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="alert">{error}</p>}
        {notice && <p className="border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 break-all" role="status">{notice}</p>}

        {form && (
          <form onSubmit={save} className="border border-border p-4 space-y-4 bg-secondary/10">
            <h2 className="font-semibold">{form.id ? "Modifier le code" : "Nouveau code influenceur"}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Nom de l'influenceur</Label>
                <Input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Léa (@lea.geneve)" className="rounded-none" required />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Code promo (lettres et chiffres)</Label>
                <Input value={form.code} onChange={(e) => set({ code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} placeholder="LEA15" maxLength={20} className="rounded-none uppercase" required />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Remise (%)</Label>
                <Input value={form.discountPct} onChange={(e) => set({ discountPct: e.target.value })} inputMode="decimal" className="rounded-none w-28" required />
              </div>
              <label className="flex items-center gap-2 text-sm self-end pb-2">
                <input type="checkbox" className="w-4 h-4" checked={form.active} onChange={(e) => set({ active: e.target.checked })} />
                Code actif
              </label>
              <div className="space-y-1">
                <Label className="text-xs">Valable du</Label>
                <Input type="date" value={form.validFrom} onChange={(e) => set({ validFrom: e.target.value })} className="rounded-none w-44" required />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">au (inclus)</Label>
                <Input type="date" value={form.validUntil} onChange={(e) => set({ validUntil: e.target.value })} className="rounded-none w-44" required />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs">Notes (interne)</Label>
                <Input value={form.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Instagram, accord, contact…" className="rounded-none" />
              </div>
            </div>
            {!pinBySession && (
              <div className="space-y-1">
                <Label className="text-xs">Code PIN administrateur</Label>
                <PasswordInput autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} className="rounded-none h-9 w-40" />
              </div>
            )}
            {formError && <p className="text-sm text-red-700" role="alert">{formError}</p>}
            <div className="flex gap-2">
              <Button type="submit" className="rounded-none" disabled={busy}>{busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Enregistrer</Button>
              <Button type="button" variant="outline" className="rounded-none" onClick={() => setForm(null)}>Annuler</Button>
            </div>
          </form>
        )}

        {loading && !data && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
        {data && data.influencers.length === 0 && !form && (
          <p className="text-sm text-muted-foreground border border-dashed border-border px-4 py-6 text-center">Aucun code pour l'instant. Cliquez sur « Nouveau code ».</p>
        )}
        <ul className="space-y-3">
          {data?.influencers.map((i) => {
            const st = statusOf(i, today);
            return (
              <li key={i.id} className={cn("border border-border p-4 space-y-2", !i.active && "opacity-70")}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-lg font-semibold tracking-wider">{i.code ?? "—"}</span>
                  <span className={cn("text-xs px-1.5 py-0.5 border", st.cls)}>{st.label}</span>
                  <span className="text-sm">{i.name}</span>
                  <span className="text-sm text-muted-foreground">· -{pctLabel(i.discountRate)}</span>
                  <span className="text-sm text-muted-foreground">· du {i.validFrom ? formatDateCH(i.validFrom) : "—"} au {i.validUntil ? formatDateCH(i.validUntil) : "—"}</span>
                </div>
                <div className="text-sm tabular-nums">
                  {i.stats.paidOrders} commande{i.stats.paidOrders > 1 ? "s" : ""} payée{i.stats.paidOrders > 1 ? "s" : ""}
                  {" · "}CA après remb. {money(i.stats.revenueNet)}
                  {" · "}remises accordées {money(i.stats.discountGiven)}
                </div>
                {i.notes && <p className="text-xs text-muted-foreground">{i.notes}</p>}
                <div className="flex flex-wrap gap-2">
                  {i.code && <Button size="sm" variant="outline" className="rounded-none h-8" onClick={() => copy(i.code!, "Code")}><Copy className="w-3.5 h-3.5 mr-1" />Copier le code</Button>}
                  <Button size="sm" variant="outline" className="rounded-none h-8" onClick={() => copy(partnerLink(data.siteBaseUrl, i.referralToken), "Lien")}><Copy className="w-3.5 h-3.5 mr-1" />Copier le lien</Button>
                  <Button size="sm" variant="outline" className="rounded-none h-8" onClick={() => edit(i)}><Pencil className="w-3.5 h-3.5 mr-1" />Modifier</Button>
                  <Button size="sm" variant="ghost" className="rounded-none h-8" asChild><Link to={`/admin/partners/${i.id}`}>Voir les commandes</Link></Button>
                </div>
              </li>
            );
          })}
        </ul>
      </main>
    </AdminLayout>
  );
};

export default AdminInfluencers;
