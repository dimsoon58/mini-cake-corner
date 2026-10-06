import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Copy, Loader2, Lock, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import AdminLayout from "@/components/admin/AdminLayout";
import PartnerForm from "@/components/admin/partners/PartnerForm";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { isAdminEmail } from "@/lib/adminAccess";
import { money } from "@/lib/compta";
import { commissionDue, netForBento, partnerBalance, partnerLink, partnersApi, pctLabel, type PartnerRow } from "@/lib/partners";
import { cn } from "@/lib/utils";

// Admin > Partenaires (lot Partenaires V1) — liste. Les commandes sont
// attribuées automatiquement par le site (lien ?ref=) ; aucune attribution
// manuelle. La commission est affichée directement, avec ce qui reste à
// Bento une fois la commission déduite.

const monthStart = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date()).slice(0, 8) + "01";
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date());

const AdminPartners = () => {
  const { t } = useLang();
  const { user, loading: authLoading } = useAuth();
  const isAdmin = isAdminEmail(user?.email);
  const navigate = useNavigate();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(true);
  const [data, setData] = useState<{ siteBaseUrl: string; partners: PartnerRow[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    document.title = "Admin – Partenaires – Bento Cake Studio";
    return () => { document.title = "Bento Cake Studio Geneva"; };
  }, []);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await partnersApi({ action: "list", from: from || null, to: to || null, search, includeInactive: showInactive })); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [from, to, search, showInactive]);
  useEffect(() => {
    if (authLoading || !isAdmin) return;
    const id = setTimeout(load, 250);
    return () => clearTimeout(id);
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

  const copy = async (url: string) => { try { await navigator.clipboard.writeText(url); setNotice("Lien copié."); } catch { setNotice(url); } };

  return (
    <AdminLayout>
      <main className="container mx-auto px-4 py-8 max-w-6xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-sans uppercase tracking-[0.105em] text-2xl md:text-3xl text-foreground font-semibold">Partenaires</h1>
          <Button className="rounded-none" onClick={() => setAdding((v) => !v)}><Plus className="w-4 h-4 mr-1" /> Ajouter un partenaire</Button>
        </div>
        <p className="text-xs text-muted-foreground">Les commandes sont attribuées automatiquement par le lien du partenaire (le dernier lien valide ouvert l'emporte). Aucune remise ni attribution sur les commandes manuelles. Commandes de test exclues.</p>
        {adding && <PartnerForm partner={null} onCancel={() => setAdding(false)} onSaved={(id) => navigate(`/admin/partners/${id}`)} />}
        {error && <p className="border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="alert">{error}</p>}
        {notice && <p className="border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 break-all" role="status">{notice}</p>}

        <div className="flex flex-wrap items-end gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nom, identifiant, contact, code" className="pl-9 rounded-none" aria-label="Rechercher" />
          </div>
          <div className="space-y-1"><Label className="text-xs text-muted-foreground">Période du</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-none h-10 w-40" /></div>
          <div className="space-y-1"><Label className="text-xs text-muted-foreground">au</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-none h-10 w-40" /></div>
          <label className="flex items-center gap-2 text-sm pb-2"><input type="checkbox" className="w-4 h-4" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />Afficher les inactifs</label>
          {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground mb-3" />}
        </div>

        <div className="overflow-x-auto border border-border/60" data-testid="partner-list">
          <table className="w-full text-sm tabular-nums">
            <thead className="bg-secondary/30 text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
              <tr>
                <th className="text-left px-2 py-2 font-normal">Partenaire</th>
                <th className="text-left px-2 font-normal">Lien</th>
                <th className="text-right px-2 font-normal">Commandes<br />période / total</th>
                <th className="text-right px-2 font-normal">CA après remb.<br />période</th>
                <th className="text-right px-2 font-normal">Commission<br />période</th>
                <th className="text-right px-2 font-normal">Net pour Bento<br />période</th>
                <th className="text-right px-2 font-normal">Payées<br />total</th>
                <th className="text-right px-2 font-normal">Reste à payer<br />total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {data?.partners.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-muted-foreground">Aucun partenaire.</td></tr>}
              {data?.partners.map((p) => {
                const url = partnerLink(data.siteBaseUrl, p.referralToken);
                const { balance, provisional, overpaid } = partnerBalance(p.total);
                return (
                  <tr key={p.id} className={cn(!p.active && "opacity-60")}>
                    <td className="px-2 py-2 min-w-[200px]">
                      <Link to={`/admin/partners/${p.id}`} className="font-semibold underline underline-offset-2">{p.name}</Link>
                      <span className={cn("ml-2 text-[11px] px-1.5 py-0.5 border", p.active ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-border text-muted-foreground")}>{p.active ? "Actif" : "Inactif"}</span>
                      <span className="block text-xs text-muted-foreground">remise {pctLabel(p.customerDiscountRate)} · commission {p.conditions.commissionConfigured ? pctLabel(p.commissionRate) : "À configurer"}{p.promoCodeReference ? ` · code Notion ${p.promoCodeReference} (référence)` : ""}</span>
                    </td>
                    <td className="px-2"><Button size="sm" variant="outline" className="rounded-none h-8" onClick={() => copy(url)} aria-label={`Copier le lien de ${p.name}`}><Copy className="w-3.5 h-3.5 mr-1" />Copier</Button></td>
                    <td className="text-right px-2">{p.period.ordersCount} / {p.total.ordersCount}</td>
                    <td className="text-right px-2">{money(p.period.revenueNet)}</td>
                    <td className="text-right px-2">{money(commissionDue(p.period))}
                      {p.period.toCheckCount > 0 && <span className="block text-[11px] text-amber-800">{p.period.toCheckCount} commande(s) à vérifier</span>}
                    </td>
                    <td className="text-right px-2 font-semibold">{money(netForBento(p.period))}</td>
                    <td className="text-right px-2">{money(p.total.payouts)}</td>
                    <td className={cn("text-right px-2", overpaid && "text-red-700 font-semibold")}>{money(balance)}
                      {overpaid && <span className="block text-[11px]">trop versé à compenser</span>}
                      {provisional && <span className="block text-[11px] text-amber-800">provisoire</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </main>
    </AdminLayout>
  );
};

export default AdminPartners;
