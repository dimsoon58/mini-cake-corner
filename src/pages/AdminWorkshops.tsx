import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Lock, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PasswordInput } from "@/components/ui/password-input";
import AdminLayout from "@/components/admin/AdminLayout";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { isAdminEmail } from "@/lib/adminAccess";
import { useSessionPin } from "@/lib/adminSession";
import { cn } from "@/lib/utils";

// Admin > Workshops (F24) : sessions proposées sur le site (dates, heures,
// capacité, prix par personne, ouverte / fermée). Les règles sont vérifiées
// par le serveur (manage-workshop-sessions) : capacité jamais sous les places
// occupées, type figé dès qu'il y a des réservations, changement de date ou
// d'heure confirmé quand des personnes sont inscrites (personne n'est
// prévenu automatiquement), pas de suppression (fermer la session). Un prix
// modifié ne vaut que pour les nouvelles réservations.

type WType = "signature" | "paint";
interface Session {
  id: string; type: WType; date: string; time: string; unitPrice: number; capacity: number; isOpen: boolean; updatedAt: string;
  occupied: number; remaining: number; reservations: number; cancelledSeats: number;
}
const TYPE_LABEL: Record<WType, string> = { signature: "Signature", paint: "Peinture" };
const box = "border border-border/60 bg-background";
const h2 = "text-sm font-semibold uppercase tracking-[0.08em]";
const chf = (n: number) => `CHF ${Number(n).toFixed(2)}`;
const frDate = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
const zurichToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date());

async function sessionsApi<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("manage-workshop-sessions", { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    let j: { error?: string; reason?: string } | null = null;
    try { j = await ctx?.json(); } catch { /* not JSON */ }
    if (ctx?.status === 404 && !j?.reason) throw Object.assign(new Error("La fonction manage-workshop-sessions n'est pas encore déployée."), { reason: "not_deployed" });
    throw Object.assign(new Error(j?.error || "Erreur inattendue. Réessayez."), { reason: j?.reason ?? null });
  }
  return data?.data as T;
}

const AdminWorkshops = () => {
  const { user, loading: authLoading } = useAuth();
  const isAdmin = isAdminEmail(user?.email);
  const [pin, setPin, pinBySession] = useSessionPin();
  const [list, setList] = useState<Session[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<Session | "new" | null>(null);
  const [showPast, setShowPast] = useState(false);

  const load = useCallback(async () => {
    try { setList(await sessionsApi<Session[]>({ action: "list" })); setErr(null); } catch (e) { setErr((e as Error).message); }
  }, []);
  useEffect(() => { if (!authLoading && isAdmin) load(); }, [authLoading, isAdmin, load]);
  useEffect(() => { document.title = "Admin – Workshops – Bento Cake Studio"; return () => { document.title = "Bento Cake Studio Geneva"; }; }, []);

  if (authLoading) return <AdminLayout><main className="py-16 text-center"><Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" /></main></AdminLayout>;
  if (!user || !isAdmin) {
    return (
      <AdminLayout>
        <main className="max-w-md mx-auto px-6 py-24 text-center">
          <Lock className="w-8 h-8 mx-auto text-muted-foreground mb-4" />
          <h1 className="font-sans uppercase tracking-[0.105em] text-2xl mb-4">{!user ? "Connexion administrateur requise" : "Accès refusé"}</h1>
          {!user && <Button asChild className="rounded-none"><Link to="/login?redirect=%2Fadmin%2Fworkshops">Se connecter</Link></Button>}
        </main>
      </AdminLayout>
    );
  }
  const today = zurichToday();
  const upcoming = (list ?? []).filter((s) => s.date >= today);
  const past = (list ?? []).filter((s) => s.date < today).reverse();

  return (
    <AdminLayout>
      <main className="container mx-auto px-4 py-8 max-w-4xl space-y-5" data-testid="admin-workshops">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-sans uppercase tracking-[0.105em] text-2xl md:text-3xl font-semibold">Workshops</h1>
          <Button className="rounded-none" onClick={() => setEditing("new")} data-testid="ws-new"><Plus className="w-4 h-4 mr-1" /> Nouvelle session</Button>
        </div>
        <p className="text-sm text-muted-foreground">Les sessions ouvertes et à venir sont proposées sur le site. Un prix modifié ne vaut que pour les nouvelles réservations ; les réservations existantes gardent leur prix.</p>
        {!pinBySession && (
          <div className="space-y-1"><Label htmlFor="ws-pin" className="text-xs text-muted-foreground">Code PIN administrateur (pour modifier)</Label>
            <PasswordInput id="ws-pin" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} className="w-40 rounded-none" /></div>
        )}
        {err && <p className="border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">{err}</p>}
        {notice && <p className="border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900" role="status">{notice}</p>}
        {!list && !err && <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />}

        {list && (
          <section className="space-y-2">
            <h2 className={h2}>À venir ({upcoming.length})</h2>
            {upcoming.length === 0 ? <p className="text-sm text-muted-foreground">Aucune session à venir : rien n'est proposé sur le site.</p> : (
              <ul className={cn(box, "divide-y divide-border/60 text-sm")} data-testid="ws-upcoming">
                {upcoming.map((s) => <SessionRow key={s.id} s={s} onEdit={() => setEditing(s)} />)}
              </ul>
            )}
            {past.length > 0 && (
              <details open={showPast} onToggle={(e) => setShowPast((e.target as HTMLDetailsElement).open)}>
                <summary className="cursor-pointer text-sm text-muted-foreground">Sessions passées ({past.length})</summary>
                <ul className={cn(box, "divide-y divide-border/60 text-sm mt-2")}>
                  {past.map((s) => <SessionRow key={s.id} s={s} onEdit={() => setEditing(s)} past />)}
                </ul>
              </details>
            )}
          </section>
        )}

        {editing && (
          <SessionDialog session={editing === "new" ? null : editing} pin={pin} onClose={() => setEditing(null)}
            onSaved={(m) => { setEditing(null); setNotice(m); load(); }} />
        )}
      </main>
    </AdminLayout>
  );
};

function SessionRow({ s, onEdit, past }: { s: Session; onEdit: () => void; past?: boolean }) {
  const full = s.remaining <= 0;
  return (
    <li className={cn("px-3 py-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1", past && "opacity-70")} data-session={s.id}>
      <span className="min-w-0">
        <strong>{frDate(s.date)} · {s.time}</strong> · {TYPE_LABEL[s.type]} · {chf(s.unitPrice)} / pers.
        <span className="block text-xs text-muted-foreground">{s.occupied} / {s.capacity} places occupées · {s.reservations} réservation(s){s.cancelledSeats ? ` · ${s.cancelledSeats} place(s) annulée(s)` : ""}</span>
      </span>
      <span className="flex items-center gap-2 justify-self-end">
        <span className={cn("px-1.5 py-0.5 text-[11px]", !s.isOpen ? "bg-secondary text-muted-foreground" : full ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900")}>
          {!s.isOpen ? "Fermée" : full ? "Complète" : `${s.remaining} place(s)`}
        </span>
        <Button size="sm" variant="outline" className="rounded-none h-8" onClick={onEdit}>Modifier</Button>
      </span>
    </li>
  );
}

function SessionDialog({ session, pin, onClose, onSaved }: { session: Session | null; pin: string; onClose: () => void; onSaved: (m: string) => void }) {
  const [f, setF] = useState({
    type: (session?.type ?? "paint") as WType, date: session?.date ?? "", time: session?.time ?? "14:00",
    price: session ? String(session.unitPrice) : "", capacity: session ? String(session.capacity) : "10", isOpen: session?.isOpen ?? true,
  });
  const [confirmMsg, setConfirmMsg] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (p: Partial<typeof f>) => { setF({ ...f, ...p }); setConfirmMsg(null); setConfirmed(false); };
  const locked = !!session && session.reservations > 0;
  const save = async () => {
    if (busy) return;
    if (!pin.trim()) { setErr("Saisissez d'abord le code PIN administrateur."); return; }
    setBusy(true); setErr(null);
    try {
      await sessionsApi({ action: "save", id: session?.id, type: f.type, date: f.date, time: f.time, price: f.price, capacity: Number(f.capacity), isOpen: f.isOpen, confirm: confirmed, pin });
      onSaved(session ? `Session du ${frDate(f.date)} enregistrée.` : `Session du ${frDate(f.date)} créée : elle est proposée sur le site${f.isOpen ? "" : " dès qu'elle sera ouverte"}.`);
    } catch (e) {
      const x = e as Error & { reason?: string };
      if (x.reason === "confirm") setConfirmMsg(x.message); else setErr(x.message);
    }
    setBusy(false);
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-md rounded-none" data-testid="ws-dialog">
        <DialogHeader>
          <DialogTitle>{session ? `Modifier la session ${frDate(session.date)}` : "Nouvelle session"}</DialogTitle>
          <DialogDescription>{session ? `${session.occupied} place(s) occupée(s) sur ${session.capacity}.` : "La session est proposée sur le site si elle est ouverte et à venir."}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1 col-span-2"><Label htmlFor="ws-type" className="text-xs">Type</Label>
            <select id="ws-type" value={f.type} disabled={locked} onChange={(e) => set({ type: e.target.value as WType })} className="w-full border border-input bg-background h-10 px-2 text-sm rounded-none">
              <option value="paint">Peinture</option><option value="signature">Signature</option>
            </select>
            {locked && <p className="text-[11px] text-muted-foreground">Type figé : des réservations existent.</p>}</div>
          <div className="space-y-1"><Label htmlFor="ws-date" className="text-xs">Date</Label><Input id="ws-date" type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} className="rounded-none" /></div>
          <div className="space-y-1"><Label htmlFor="ws-time" className="text-xs">Heure</Label><Input id="ws-time" type="time" value={f.time} onChange={(e) => set({ time: e.target.value })} className="rounded-none" /></div>
          <div className="space-y-1"><Label htmlFor="ws-price" className="text-xs">Prix par personne (CHF)</Label><Input id="ws-price" inputMode="decimal" value={f.price} onChange={(e) => set({ price: e.target.value })} className="rounded-none" /></div>
          <div className="space-y-1"><Label htmlFor="ws-cap" className="text-xs">Capacité (places)</Label><Input id="ws-cap" type="number" min={Math.max(1, session?.occupied ?? 1)} value={f.capacity} onChange={(e) => set({ capacity: e.target.value })} className="rounded-none" /></div>
          <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isOpen} onChange={(e) => set({ isOpen: e.target.checked })} /> Ouverte aux réservations sur le site</label>
        </div>
        {confirmMsg && (
          <div className="border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 space-y-2">
            <p>{confirmMsg}</p>
            <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              <span>Je préviens moi-même les personnes inscrites du changement.</span></label>
          </div>
        )}
        {err && <p className="text-sm text-red-800" role="alert">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" className="rounded-none" disabled={busy} onClick={onClose}>Annuler</Button>
          <Button className="rounded-none" disabled={busy || !f.date || !f.time || !f.price || (!!confirmMsg && !confirmed)} onClick={save} data-testid="ws-save">
            {busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}{confirmMsg ? "Confirmer le changement" : "Enregistrer"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default AdminWorkshops;
