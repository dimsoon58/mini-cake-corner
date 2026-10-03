import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, Lock, Plus, Search, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import AdminLayout from "@/components/admin/AdminLayout";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { isAdminEmail } from "@/lib/adminAccess";
import { chf, formatDay } from "@/lib/refunds";
import { customersApi, CustomersError, fullName, type CustomerList } from "@/lib/customers";
import { cn } from "@/lib/utils";
import { useSessionPin } from "@/lib/adminSession";

// Admin > Clients (lot C) — one shared customer base (with or without an
// account). Search by name, email or phone; sort; pages of 25. Figures come
// from the lot 1–3 registers (net paid after refunds), test orders excluded.

const SORTS = [
  { key: "last_order", en: "Last order", fr: "Dernière commande" },
  { key: "name", en: "Name", fr: "Nom" },
  { key: "orders", en: "Orders", fr: "Commandes" },
  { key: "net", en: "Net paid", fr: "Net payé" },
  { key: "created", en: "Created", fr: "Création" },
] as const;

const AdminCustomers = () => {
  const { t, lang } = useLang();
  const l = lang === "en" ? "en" : "fr";
  const { user, loading: authLoading } = useAuth();
  const isAdmin = isAdminEmail(user?.email);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const search = params.get("q") ?? "";
  const sort = (SORTS.some((s) => s.key === params.get("sort")) ? params.get("sort") : "last_order") as string;
  const desc = params.get("dir") !== "asc";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const includeTests = params.get("tests") === "1";
  const setParam = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === "") p.delete(k);
      else p.set(k, v);
    }
    setParams(p, { replace: true });
  };

  const [draft, setDraft] = useState(search);
  const [data, setData] = useState<CustomerList | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    document.title = "Admin – Clients – Bento Cake Studio";
    return () => { document.title = "Bento Cake Studio Geneva"; };
  }, []);

  // Search as you type (light debounce).
  useEffect(() => {
    const id = setTimeout(() => { if (draft !== search) setParam({ q: draft || null, page: null }); }, 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await customersApi<CustomerList>({ action: "list", search, sort, desc, page, size: 25, includeTests }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [search, sort, desc, page, includeTests]);

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
          {!user && <Button asChild className="rounded-none"><Link to={`/login?redirect=${encodeURIComponent(window.location.pathname)}`}>{t("Sign in", "Se connecter")}</Link></Button>}
        </main>
      </AdminLayout>
    );
  }

  const pages = data ? Math.max(1, Math.ceil(Number(data.total) / data.size)) : 1;

  return (
    <AdminLayout>
      <main className="container mx-auto px-4 py-8 max-w-5xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-sans uppercase tracking-[0.105em] text-2xl md:text-3xl text-foreground font-semibold">{t("Customers", "Clients")}</h1>
          <Button className="rounded-none" onClick={() => setAdding((v) => !v)}><Plus className="w-4 h-4 mr-1" /> {t("Add a customer", "Ajouter un client")}</Button>
        </div>

        {adding && <NewCustomerForm onCancel={() => setAdding(false)} onCreated={(id) => navigate(`/admin/customers/${id}`)} />}

        <div className="flex flex-wrap items-end gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t("Name, email or phone", "Nom, email ou téléphone")} className="pl-9 rounded-none" aria-label={t("Search", "Rechercher")} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{t("Sort by", "Trier par")}</Label>
            <div className="flex">
              <select value={sort} onChange={(e) => setParam({ sort: e.target.value, page: null })} className="h-10 border border-input bg-background px-2 text-sm">
                {SORTS.map((s) => <option key={s.key} value={s.key}>{s[l]}</option>)}
              </select>
              <Button variant="outline" className="rounded-none h-10 px-3" onClick={() => setParam({ dir: desc ? "asc" : null, page: null })} aria-label={t("Sort direction", "Sens du tri")}>
                {desc ? "↓" : "↑"}
              </Button>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm pb-2">
            <input type="checkbox" className="w-4 h-4" checked={includeTests} onChange={(e) => setParam({ tests: e.target.checked ? "1" : null, page: null })} />
            {t("Show tests", "Afficher les tests")}
          </label>
        </div>

        {error && <p className="border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">{error}</p>}

        <div className="border border-border/60" data-testid="customer-list">
          <div className="hidden md:grid grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1.3fr)_70px_110px_110px] gap-3 px-4 py-2 bg-secondary/30 border-b border-border/60 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
            <span>{t("Name", "Nom")}</span><span>Email</span><span>{t("Phone", "Téléphone")}</span>
            <span className="text-right">{t("Orders", "Cmdes")}</span><span className="text-right">{t("Net paid", "Net payé")}</span><span className="text-right">{t("Last order", "Dernière")}</span>
          </div>
          {loading && !data ? <div className="py-10 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" /></div>
            : data && data.rows.length === 0 ? <p className="px-4 py-6 text-sm text-muted-foreground">{search ? t("No customer found.", "Aucun client trouvé.") : t("No customer yet.", "Aucun client pour l'instant.")}</p>
            : (
              <ul className="divide-y divide-border/60">
                {data?.rows.map((c) => (
                  <li key={c.id}>
                    <Link to={`/admin/customers/${c.id}`} data-row={c.id}
                      className="grid grid-cols-2 md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1.3fr)_70px_110px_110px] gap-x-3 gap-y-0.5 px-4 py-3 text-sm hover:bg-secondary/40">
                      <span className="col-span-2 md:col-span-1 font-medium flex items-center gap-1.5 min-w-0">
                        <UserRound className={cn("w-3.5 h-3.5 shrink-0", c.hasAccount ? "text-primary" : "text-muted-foreground/50")} aria-label={c.hasAccount ? t("Has an account", "A un compte") : undefined} />
                        <span className="truncate">{fullName(c)}</span>
                        {c.openAlerts > 0 && <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" aria-label={t("Alert to check", "Alerte à vérifier")} />}
                      </span>
                      <span className="truncate text-muted-foreground md:text-foreground">{c.email ?? "—"}</span>
                      <span className="truncate text-muted-foreground">{c.phone ?? "—"}</span>
                      <span className="md:text-right tabular-nums text-muted-foreground md:text-foreground">{c.ordersCount}<span className="md:hidden"> {t("order(s)", "cmde(s)")}</span></span>
                      <span className="md:text-right tabular-nums">{chf(c.net)}</span>
                      <span className="md:text-right tabular-nums text-muted-foreground">{c.lastOrderAt ? formatDay(c.lastOrderAt, l) : "—"}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
        </div>

        {data && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{data.total} {t("customer(s)", "client(s)")}</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" className="rounded-none h-8 w-8" disabled={page <= 1} onClick={() => setParam({ page: String(page - 1) })} aria-label={t("Previous page", "Page précédente")}><ChevronLeft className="w-4 h-4" /></Button>
              <span className="tabular-nums">{page} / {pages}</span>
              <Button variant="outline" size="icon" className="rounded-none h-8 w-8" disabled={page >= pages} onClick={() => setParam({ page: String(page + 1) })} aria-label={t("Next page", "Page suivante")}><ChevronRight className="w-4 h-4" /></Button>
            </div>
          </div>
        )}
      </main>
    </AdminLayout>
  );
};

// ── Add a customer (manual-order customers) ──────────────────────────────
const NewCustomerForm = ({ onCancel, onCreated }: { onCancel: () => void; onCreated: (id: string) => void }) => {
  const { t } = useLang();
  const [f, setF] = useState({ firstName: "", lastName: "", email: "", phone: "", company: "", address: "", notes: "" });
  const [pin, setPin, pinBySession] = useSessionPin();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ text: string; existingId?: string | null } | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="border border-primary/30 bg-primary/5 p-4 space-y-3" data-testid="new-customer"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        setErr(null);
        try {
          const r = await customersApi<{ customerId: string }>({ action: "save", pin, ...f });
          onCreated(r.customerId);
        } catch (e2) {
          const ce = e2 as CustomersError;
          setErr({ text: ce.message, existingId: ce.existingId });
        } finally {
          setBusy(false);
        }
      }}>
      <p className="text-sm font-medium">{t("New customer", "Nouveau client")}</p>
      <div className="grid sm:grid-cols-2 gap-3">
        {([["firstName", t("First name", "Prénom")], ["lastName", t("Last name", "Nom")], ["email", "Email"], ["phone", t("Phone", "Téléphone")], ["company", t("Company (optional)", "Société (facultatif)")], ["address", t("Address (optional)", "Adresse (facultatif)")]] as [keyof typeof f, string][]).map(([k, label]) => (
          <div key={k} className="space-y-1">
            <Label htmlFor={`nc-${k}`} className="text-xs text-muted-foreground">{label}</Label>
            <Input id={`nc-${k}`} type={k === "email" ? "email" : k === "phone" ? "tel" : "text"} value={f[k]} onChange={set(k)} className="rounded-none" />
          </div>
        ))}
      </div>
      <div className="space-y-1">
        <Label htmlFor="nc-notes" className="text-xs text-muted-foreground">{t("Internal notes (optional)", "Notes internes (facultatif)")}</Label>
        <Input id="nc-notes" value={f.notes} onChange={set("notes")} className="rounded-none" />
      </div>
      <div className="flex flex-wrap items-end gap-2">
        {!pinBySession && (
          <div className="space-y-1">
            <Label htmlFor="nc-pin" className="text-xs text-muted-foreground">{t("Admin PIN", "Code PIN administrateur")}</Label>
            <Input id="nc-pin" type="password" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} className="w-32 rounded-none" />
          </div>
        )}
        <Button type="submit" className="rounded-none" disabled={busy || !pin.trim() || !(f.firstName.trim() || f.lastName.trim() || f.email.trim())}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}{t("Create", "Créer")}
        </Button>
        <Button type="button" variant="ghost" className="rounded-none" onClick={onCancel}>{t("Cancel", "Annuler")}</Button>
      </div>
      {err && (
        <p className="text-sm bg-red-50 border border-red-200 text-red-800 px-3 py-2">
          {err.text}{" "}
          {err.existingId && <Link to={`/admin/customers/${err.existingId}`} className="underline">{t("Open that record", "Ouvrir cette fiche")}</Link>}
        </p>
      )}
    </form>
  );
};

export default AdminCustomers;
