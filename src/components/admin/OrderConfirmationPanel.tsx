import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mail, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { supabase } from "@/integrations/supabase/client";
import { useSessionPin } from "@/lib/adminSession";
import { newKey } from "@/lib/manualOrders";
import { confirmationTexts, type ConfirmationStatus } from "@/lib/orderConfirmation";

// Fiche commande, bloc « Confirmation » (13.10.2026, F29) — fonction
// resend-order-confirmation. L'adresse de la commande, sa correction (cette
// commande seulement), puis l'envoi ou le renvoi de l'e-mail déjà prévu pour
// elle (« Commande reçue », ou la confirmation — avec « à régler sur place »
// pour une commande manuelle non payée), et l'historique. Rien d'autre n'est modifié : ni la
// commande, ni le paiement, ni les réservations. Le PIN de la session suffit ;
// sinon il est demandé une fois dans ce bloc.

const box = "border border-border/60 bg-background p-4 space-y-3";

async function call(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("resend-order-confirmation", { body });
  if (error) {
    let payload: { error?: string; reason?: string } | null = null;
    try { payload = await (error as { context?: Response }).context?.json(); } catch { /* pas du JSON */ }
    const status = (error as { context?: Response }).context?.status;
    return { ok: false as const, error: payload?.error ?? (status === 404 ? "not_deployed" : (error as Error).message), reason: payload?.reason ?? null };
  }
  if (data?.error) return { ok: false as const, error: String(data.error), reason: data.reason ?? null };
  return { ok: true as const, data };
}

export const OrderConfirmationPanel = ({ orderId, onChanged }: { orderId: string; onChanged: () => void }) => {
  const T = confirmationTexts;
  const [pin, setPin, pinBySession] = useSessionPin();
  const [status, setStatus] = useState<ConfirmationStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"send" | "email" | null>(null);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // Même clé tant que l'envoi n'a pas réussi : un double clic ou un nouvel
  // essai après une coupure ne peut jamais envoyer deux e-mails.
  const sendKey = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await call({ action: "status", orderId });
    if (!r.ok) { setLoadError(r.error === "not_deployed" ? T.notDeployed : r.error); return; }
    setLoadError(null);
    setStatus(r.data as ConfirmationStatus);
  }, [orderId, T.notDeployed]);
  useEffect(() => { refresh(); }, [refresh]);

  const needPin = () => {
    if (pinBySession || pin.trim()) return false;
    setMessage({ type: "error", text: T.pinNeeded });
    return true;
  };

  const saveEmail = async () => {
    if (busy || needPin() || !status) return;
    const next = draft.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) { setMessage({ type: "error", text: T.invalidEmail }); return; }
    if (!window.confirm(T.confirmEmailChange(status.email ?? "—", next))) return;
    setBusy("email"); setMessage(null);
    const r = await call({ action: "update_email", orderId, email: next, expectedEmail: status.email ?? "", pin });
    setBusy(null);
    if (!r.ok) { setMessage({ type: "error", text: T.reason(r.reason, r.error) }); await refresh(); return; }
    setEditing(false);
    sendKey.current = null;
    setMessage({ type: "ok", text: r.data?.unchanged ? T.emailUnchanged : T.emailSaved(next) });
    await refresh();
    onChanged();
  };

  const send = async () => {
    if (busy || needPin() || !status?.email || !status.kind) return;
    if (!window.confirm(T.confirmSend(status.button, status.email))) return;
    if (!sendKey.current) sendKey.current = newKey();
    setBusy("send"); setMessage(null);
    const r = await call({ action: "send", orderId, expectedEmail: status.email, idempotencyKey: sendKey.current, pin });
    setBusy(null);
    if (!r.ok) {
      // Échec réel de l'envoi : la même clé est gardée pour le nouvel essai.
      if (r.reason !== "send_failed" && r.reason !== "in_progress") sendKey.current = null;
      setMessage({ type: "error", text: T.reason(r.reason, r.error) });
      await refresh();
      return;
    }
    sendKey.current = null;
    setMessage({ type: "ok", text: T.sent(r.data.email, r.data.invoice, !!r.data.alreadySent) });
    await refresh();
  };

  if (loadError) {
    return <div className={box}><h3 className="font-sans text-[12px] tracking-[0.105em] font-semibold uppercase">{T.title}</h3><p className="text-sm text-destructive">{loadError}</p></div>;
  }
  if (!status) return <div className={box}><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>;

  const canSend = !!status.kind && !status.blocked;
  const showEditor = editing || status.blocked === "no_email";
  return (
    <div className={box} data-testid="order-confirmation-panel">
      <h3 className="font-sans text-[12px] tracking-[0.105em] font-semibold uppercase text-foreground flex items-center gap-2">
        <Mail className="w-3.5 h-3.5 text-primary" strokeWidth={1.5} />{T.title}
      </h3>

      <div className="text-sm space-y-1">
        <p><span className="text-muted-foreground">{T.orderEmail} </span><b className="break-all">{status.email || "—"}</b></p>
        {status.customerEmail && status.customerEmail.toLowerCase() !== (status.email ?? "").toLowerCase() && (
          <p className="text-xs text-amber-900">
            {T.customerDiffers(status.customerEmail)}{" "}
            <button type="button" className="underline" onClick={() => { setEditing(true); setDraft(status.customerEmail!); }}>{T.useCustomerEmail}</button>
          </p>
        )}
        <p className="text-xs text-muted-foreground">{status.lastSent ? T.lastSent(status.lastSent) : T.neverResent}</p>
      </div>

      {showEditor ? (
        <div className="flex flex-wrap gap-2 items-center">
          <Input type="email" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="client@exemple.ch" className="rounded-none h-9 max-w-xs" aria-label={T.newEmail} />
          <Button size="sm" className="rounded-none h-9" onClick={saveEmail} disabled={!!busy}>
            {busy === "email" && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}{T.saveEmail}
          </Button>
          {status.blocked !== "no_email" && <Button size="sm" variant="ghost" className="rounded-none h-9" onClick={() => setEditing(false)} disabled={!!busy}>{T.cancel}</Button>}
          <p className="w-full text-xs text-muted-foreground">{T.emailScope}</p>
        </div>
      ) : (
        <Button size="sm" variant="outline" className="rounded-none h-8" onClick={() => { setEditing(true); setDraft(status.email ?? ""); }} disabled={!!busy}>
          <Pencil className="w-3.5 h-3.5 mr-1" />{T.editEmail}
        </Button>
      )}

      {!pinBySession && (
        <PasswordInput value={pin} onChange={(e) => setPin(e.target.value)} placeholder={T.pinPlaceholder} className="max-w-xs rounded-none" />
      )}

      {canSend ? (
        <div className="space-y-1">
          <Button className="rounded-none" onClick={send} disabled={!!busy} data-testid="confirmation-send">
            {busy === "send" && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}{T.buttonLabel(status.button)}
          </Button>
          <p className="text-xs text-muted-foreground">{T.whatIsSent(status)}</p>
        </div>
      ) : status.blocked && status.blocked !== "no_email" ? (
        <p className="text-sm text-muted-foreground">{T.blocked(status.blocked)}</p>
      ) : null}

      {message && <p className={message.type === "ok" ? "text-sm text-emerald-700" : "text-sm text-destructive"} role="status">{message.text}</p>}

      {status.history.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">{T.history(status.history.length)}</summary>
          <ul className="mt-2 space-y-1">
            {status.history.map((e) => <li key={e.id} className="break-words">{T.historyLine(e)}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
};
