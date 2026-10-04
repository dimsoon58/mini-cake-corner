import { useState } from "react";
import { Ban, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLang } from "@/context/LanguageContext";
import { supabase } from "@/integrations/supabase/client";
import { newKey } from "@/lib/manualOrders";
import { useSessionPin } from "@/lib/adminSession";
import { PasswordInput } from "@/components/ui/password-input";

// Order page block « Annulation » — what used to be done from Notion:
//   - cancel the whole order (cancel-order): the existing cancellation email
//     is sent, workshop seats are released, cakes leave production;
//   - cancel some or all seats of a workshop reservation
//     (cancel-workshop-seats): the existing workshop cancellation email.
// No refund is ever made here: it is done by hand, then recorded in the
// « Remboursements » block above (no email). A double click or a retry never
// cancels twice nor sends a second email (server-side guards + the same
// idempotency key reused until the cancellation succeeds).

export type WorkshopReservation = {
  id: string;
  order_item_id: string | null;
  workshop_reference: string;
  purchased_seats: number;
  cancelled_seats: number;
  status: string;
};

const box = "border border-border/60 bg-background p-4 space-y-3";

async function call(name: "cancel-order" | "cancel-workshop-seats", body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let payload: { error?: string; reason?: string } | null = null;
    try { payload = await (error as { context?: Response }).context?.json(); } catch { /* not JSON */ }
    return { ok: false as const, error: payload?.error ?? (error as Error).message, reason: payload?.reason ?? null };
  }
  if (data?.error) return { ok: false as const, error: String(data.error), reason: data.reason ?? null };
  return { ok: true as const, data };
}

export const OrderCancellationPanel = ({
  order, reservations, canCancelOrder, labelFor, onChanged,
}: {
  order: { id: string; order_number?: string | null; payment_status?: string | null };
  reservations: WorkshopReservation[];
  canCancelOrder: boolean;
  labelFor: (orderItemId: string | null) => string;
  onChanged: () => void;
}) => {
  const { t } = useLang();
  const [pin, setPin, pinBySession] = useSessionPin();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [seats, setSeats] = useState<Record<string, string>>({});
  // Same key for the same pending cancellation (retry after an error / double
  // click) — the server then returns the first result, never a second one.
  const [keys, setKeys] = useState<Record<string, { seats: number; key: string }>>({});

  const active = reservations.filter((r) => ["confirmed", "partially_cancelled"].includes(r.status) && r.purchased_seats - r.cancelled_seats > 0);
  // Kept while a message is shown (e.g. « Commande annulée. E-mail envoyé. »
  // right after the last possible cancellation).
  if (!canCancelOrder && active.length === 0 && !message) return null;

  const reasonText = (reason: string | null, fallback: string) =>
    reason === "awaiting_decision" ? t("This order is still awaiting your decision: refuse it instead.", "Cette commande attend encore votre décision : refusez-la plutôt.")
      : reason === "no_email" ? t("This order has no customer email: the cancellation email cannot be sent.", "Cette commande n'a pas d'e-mail client : l'e-mail d'annulation ne peut pas être envoyé.")
      : reason === "draft" ? t("This is a draft: there is nothing to cancel.", "C'est un brouillon : rien à annuler.")
      : reason === "refused" ? t("This order was already refused.", "Cette commande a déjà été refusée.")
      : fallback === "Invalid PIN" ? t("Invalid PIN.", "PIN incorrect.")
      : fallback;

  const needPin = () => {
    if (pinBySession || pin.trim()) return false;
    setMessage({ type: "error", text: t("Please enter the admin PIN.", "Veuillez saisir le code PIN administrateur.") });
    return true;
  };

  const cancelOrder = async () => {
    if (busy || needPin()) return;
    const paid = order.payment_status === "paid";
    if (!window.confirm(t(
      `Cancel the whole order ${order.order_number ?? ""}? The customer receives the cancellation email.${paid ? " No refund is made automatically: refund by hand, then record it below." : ""}`,
      `Annuler toute la commande ${order.order_number ?? ""} ? Le client reçoit l'e-mail d'annulation.${paid ? " Aucun remboursement automatique : remboursez vous-même, puis enregistrez-le dans « Remboursements »." : ""}`,
    ))) return;
    setBusy("order"); setMessage(null);
    const r = await call("cancel-order", { orderId: order.id, pin });
    setBusy(null);
    if (!r.ok) { setMessage({ type: "error", text: reasonText(r.reason, r.error) }); return; }
    setMessage({
      type: "ok",
      text: r.data?.alreadyCancelled
        ? t("This order was already cancelled — no new email.", "Cette commande était déjà annulée — aucun nouvel e-mail.")
        : t("Order cancelled. Cancellation email sent.", "Commande annulée. E-mail d'annulation envoyé.")
          + (r.data?.seatsReleased ? ` ${t("Workshop seats released:", "Places workshop libérées :")} ${r.data.seatsReleased}.` : ""),
    });
    onChanged();
  };

  const cancelSeats = async (res: WorkshopReservation) => {
    if (busy || needPin()) return;
    const max = res.purchased_seats - res.cancelled_seats;
    const n = Number(seats[res.id] ?? max);
    if (!Number.isInteger(n) || n < 1 || n > max) {
      setMessage({ type: "error", text: t(`Choose between 1 and ${max} seat(s).`, `Choisissez entre 1 et ${max} place(s).`) });
      return;
    }
    if (!window.confirm(t(
      `Cancel ${n} seat(s) of ${res.workshop_reference}? The customer receives the workshop cancellation email. No refund is made automatically.`,
      `Annuler ${n} place(s) de ${res.workshop_reference} ? Le client reçoit l'e-mail d'annulation du workshop. Aucun remboursement automatique.`,
    ))) return;
    const prev = keys[res.id];
    const key = prev && prev.seats === n ? prev.key : `admin-${newKey()}`;
    setKeys((k) => ({ ...k, [res.id]: { seats: n, key } }));
    setBusy(res.id); setMessage(null);
    const r = await call("cancel-workshop-seats", { reservation_id: res.id, seats_to_cancel: n, idempotency_key: key, pin });
    setBusy(null);
    if (!r.ok) { setMessage({ type: "error", text: reasonText(r.reason, r.error) }); return; }
    setKeys((k) => { const next = { ...k }; delete next[res.id]; return next; });
    setMessage({
      type: "ok",
      text: r.data?.already_cancelled
        ? t("Already done — no new email.", "Déjà fait — aucun nouvel e-mail.")
        : t(`${n} seat(s) cancelled. Workshop cancellation email sent.`, `${n} place(s) annulée(s). E-mail d'annulation du workshop envoyé.`),
    });
    onChanged();
  };

  return (
    <div className={box} data-testid="order-cancellation">
      <h3 className="font-sans text-[12px] tracking-[0.105em] font-semibold uppercase text-foreground flex items-center gap-2">
        <Ban className="w-3.5 h-3.5 text-primary" strokeWidth={1.5} />
        {t("Cancellation", "Annulation")}
      </h3>
      <p className="text-xs text-muted-foreground">
        {t("The existing email is sent to the customer. No refund is made automatically.", "L'e-mail existant est envoyé au client. Aucun remboursement automatique.")}
      </p>

      {!pinBySession && (canCancelOrder || active.length > 0) && (
        <PasswordInput value={pin} onChange={(e) => setPin(e.target.value)} placeholder={t("Admin PIN", "Code PIN administrateur")} className="max-w-xs rounded-none" />
      )}

      {active.map((res) => {
        const max = res.purchased_seats - res.cancelled_seats;
        return (
          <div key={res.id} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="min-w-0">
              {labelFor(res.order_item_id)} · {res.workshop_reference} · {t(`${max} of ${res.purchased_seats} seat(s) active`, `${max} place(s) active(s) sur ${res.purchased_seats}`)}
            </span>
            <Input type="number" min={1} max={max} value={seats[res.id] ?? String(max)} onChange={(e) => setSeats((s) => ({ ...s, [res.id]: e.target.value }))}
              aria-label={t("Seats to cancel", "Places à annuler")} className="w-20 rounded-none h-8" />
            <Button variant="outline" size="sm" className="rounded-none" disabled={!!busy} onClick={() => cancelSeats(res)}>
              {busy === res.id && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
              {t("Cancel seat(s)", "Annuler les places")}
            </Button>
          </div>
        );
      })}

      {canCancelOrder && (
        <Button variant="destructive" className="rounded-none" disabled={!!busy} onClick={cancelOrder}>
          {busy === "order" && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          {t("Cancel the whole order", "Annuler toute la commande")}
        </Button>
      )}

      {message && (
        <p role={message.type === "error" ? "alert" : "status"} className={message.type === "error" ? "text-sm text-destructive" : "text-sm text-emerald-800"}>
          {message.text}
        </p>
      )}
    </div>
  );
};
