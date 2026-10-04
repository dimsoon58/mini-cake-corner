import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { supabase } from "@/integrations/supabase/client";
import { useSessionPin } from "@/lib/adminSession";
import { LEAVE_STATUS_LABELS, PORTION_LABELS, longDate, teamApi, type LeaveRequest } from "@/lib/team";
import { cn } from "@/lib/utils";

// Admin > Équipe (F23) — pour Mel et Eli :
//   « Demandes de congés » : approuver (crée l'absence « vacances » avec les
//     règles existantes) ou refuser, avec un mot facultatif ;
//   « Accès employée » : adresse, invitation (e-mail Supabase existant, la
//     personne choisit son mot de passe ; aucun e-mail si un compte existe
//     déjà), activer / désactiver, droits. Session admin + PIN.

const box = "border border-border/60 bg-background";
const h2 = "text-sm font-semibold uppercase tracking-[0.08em]";
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

interface AccessRow { id: string; member_id: string; memberName: string; email: string | null; active: boolean; permissions: string[]; invited_at: string | null; user_id: string | null }
interface AccessList { access: AccessRow[]; permissions: { code: string; label: string; available: boolean }[]; members: { id: string; slug: string; name: string }[] }

async function staffApi<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("staff-access", { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    let j: { error?: string; reason?: string } | null = null;
    try { j = await ctx?.json(); } catch { /* not JSON */ }
    if (ctx?.status === 404 && !j?.reason) throw new Error("La fonction staff-access n'est pas encore déployée.");
    throw Object.assign(new Error(j?.error || "Erreur inattendue. Réessayez."), { reason: j?.reason ?? null });
  }
  return data?.data as T;
}

export function LeaveRequestsBox({ onChanged }: { onChanged: () => void }) {
  const [list, setList] = useState<LeaveRequest[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setList(await teamApi<LeaveRequest[]>({ action: "leave_requests" })); setErr(null); } catch (e) { setErr(errText(e)); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const decide = async (r: LeaveRequest, approve: boolean) => {
    const note = window.prompt(approve ? `Approuver la demande de ${r.memberName} (${longDate(r.start_date)}${r.end_date !== r.start_date ? ` → ${longDate(r.end_date)}` : ""}) ? Mot facultatif :` : `Refuser la demande de ${r.memberName} ? Raison (facultative) :`, "");
    if (note === null) return;
    setBusy(r.id);
    try { await teamApi({ action: "decide_leave", id: r.id, approve, note }); await load(); onChanged(); } catch (e) { setErr(errText(e)); }
    setBusy(null);
  };
  const pending = (list ?? []).filter((r) => r.status === "pending");
  const recent = (list ?? []).filter((r) => r.status !== "pending").slice(0, 8);
  return (
    <section className={cn(box, "p-3 space-y-2")} data-testid="leave-requests">
      <h2 className={h2}>Demandes de congés {pending.length > 0 && <span className="ml-1 px-1.5 py-0.5 text-[11px] bg-amber-100 text-amber-900">{pending.length} en attente</span>}</h2>
      {err && <p className="text-sm text-amber-800">{err}</p>}
      {!list && !err && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
      {list && pending.length === 0 && <p className="text-sm text-muted-foreground">Aucune demande en attente.</p>}
      {pending.length > 0 && (
        <ul className="divide-y divide-border/60 text-sm border border-amber-200">
          {pending.map((r) => (
            <li key={r.id} className="px-3 py-2 flex flex-wrap items-center gap-2">
              <span className="flex-1 min-w-[200px]"><strong>{r.memberName}</strong> · {longDate(r.start_date)}{r.end_date !== r.start_date ? ` → ${longDate(r.end_date)}` : ""}{r.portion !== "full" ? ` (${PORTION_LABELS[r.portion].toLowerCase()})` : ""}{r.note ? ` · « ${r.note} »` : ""}
                <span className="block text-xs text-muted-foreground">demandée le {longDate(r.created_at.slice(0, 10))}</span></span>
              <Button size="sm" className="rounded-none h-8" disabled={busy === r.id} onClick={() => decide(r, true)}>Approuver</Button>
              <Button size="sm" variant="outline" className="rounded-none h-8" disabled={busy === r.id} onClick={() => decide(r, false)}>Refuser</Button>
            </li>
          ))}
        </ul>
      )}
      {recent.length > 0 && (
        <details><summary className="cursor-pointer text-xs text-muted-foreground">Dernières décisions</summary>
          <ul className="text-xs space-y-0.5 pt-1">
            {recent.map((r) => <li key={r.id}><span className={cn("px-1 py-0.5", LEAVE_STATUS_LABELS[r.status].className)}>{LEAVE_STATUS_LABELS[r.status].label}</span> {r.memberName} · {longDate(r.start_date)}{r.end_date !== r.start_date ? ` → ${longDate(r.end_date)}` : ""}{r.decided_by ? ` · ${r.decided_by}` : ""}{r.decision_note ? ` · ${r.decision_note}` : ""}</li>)}
          </ul>
        </details>
      )}
      <p className="text-xs text-muted-foreground">Approuver crée l'absence « vacances » habituelle (mêmes règles de décompte). Une demande traitée ne change plus.</p>
    </section>
  );
}

export function EmployeeAccessBox() {
  const [pin, setPin, pinBySession] = useSessionPin();
  const [data, setData] = useState<AccessList | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setData(await staffApi<AccessList>({ action: "list" })); setErr(null); } catch (e) { setErr(errText(e)); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const nahya = data?.members.find((m) => m.slug === "nahya");
  const row = data?.access.find((a) => a.member_id === nahya?.id) ?? null;
  useEffect(() => { if (row?.email) setEmail(row.email); }, [row?.email]);
  const write = async (body: Record<string, unknown>) => {
    if (!pin.trim()) { setErr("Saisissez d'abord le code PIN administrateur."); return null; }
    setBusy(true); setErr(null); setMsg(null);
    try { const r = await staffApi<{ message?: string }>({ ...body, memberId: nahya!.id, pin }); await load(); return r; }
    catch (e) { setErr(errText(e)); return null; }
    finally { setBusy(false); }
  };
  return (
    <section className={cn(box, "p-3 space-y-2")} data-testid="employee-access">
      <h2 className={h2}>Accès employée{nahya ? ` — ${nahya.name}` : ""}</h2>
      {!data && !err && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
      {err && <p className="text-sm text-red-800" role="alert">{err}</p>}
      {msg && <p className="text-sm text-emerald-800" role="status">{msg}</p>}
      {data && nahya && (
        <>
          <p className="text-sm">
            {row?.email
              ? <>Adresse : <strong>{row.email}</strong> · {row.active ? <span className="text-emerald-800">actif</span> : <span className="text-amber-800">désactivé</span>}
                  {row.invited_at ? ` · invitée le ${longDate(row.invited_at.slice(0, 10))}` : ""}{row.user_id ? " · compte relié" : " · pas encore connectée"}</>
              : "Pas encore d'accès."}
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1"><Label htmlFor="emp-email" className="text-xs">Email de connexion de {nahya.name}</Label>
              <Input id="emp-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="rounded-none h-9 w-64" /></div>
            {!pinBySession && <div className="space-y-1"><Label htmlFor="emp-pin" className="text-xs">Code PIN</Label>
              <PasswordInput id="emp-pin" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} className="rounded-none h-9 w-32" /></div>}
            <Button className="rounded-none h-9" disabled={busy || !email.trim()} onClick={async () => {
              const e = email.trim().toLowerCase();
              if (!window.confirm(`Donner l'accès employée à ${e} ? Si aucun compte n'existe, une invitation est envoyée à cette adresse pour choisir le mot de passe.`)) return;
              setBusy(true); setErr(null); setMsg(null);
              try {
                const r = await staffApi<{ message: string }>({ action: "invite", memberId: nahya.id, email: e, pin, confirm: true });
                setMsg(r.message); await load();
              } catch (x) { setErr(errText(x)); }
              setBusy(false);
            }} data-testid="emp-invite">{busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Donner l'accès / inviter</Button>
            {row && (
              <Button variant="outline" className="rounded-none h-9" disabled={busy} onClick={async () => {
                if (!window.confirm(row.active ? "Désactiver l'accès ? Elle ne pourra plus rien voir." : "Réactiver l'accès ?")) return;
                const r = await write({ action: "save", email: row.email, active: !row.active });
                if (r) setMsg(row.active ? "Accès désactivé." : "Accès réactivé.");
              }}>{row.active ? "Désactiver" : "Réactiver"}</Button>
            )}
          </div>
          {row && (
            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground">Droits ({row.permissions.length})</summary>
              <ul className="text-xs space-y-0.5 pt-1">
                {data.permissions.map((p) => (
                  <li key={p.code} className={cn(!p.available && "text-muted-foreground")}>
                    {row.permissions.includes(p.code) ? "✓" : "—"} {p.label}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <p className="text-xs text-muted-foreground">Elle se connecte avec son propre email et mot de passe, sans le PIN. Elle ne voit aucun prix ni montant, seulement « payé / non payé ».</p>
        </>
      )}
    </section>
  );
}
