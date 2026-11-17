import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Gift, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { useSessionPin } from "@/lib/adminSession";
import { money } from "@/lib/compta";
import { giftCardsApi, type OrderGiftCard } from "@/lib/giftCards";

// F39 (03.11.2026) — on the Admin order page of an order paid (partly) with
// a gift voucher: how much the voucher paid, how much was put back, and a
// way to put an amount back on the voucher after a partial cancellation
// (never more than the voucher paid). A full refusal / refund / cancellation
// gives the voucher back by itself.

const STATUS_LABEL: Record<string, string> = {
  reserved: "en attente d'acceptation",
  consumed: "utilisé",
  released: "rendu en entier (commande refusée ou paiement échoué)",
  recredited: "remis en entier sur le bon",
};

export function GiftCardOrderPanel({ orderId }: { orderId: string }) {
  const [info, setInfo] = useState<OrderGiftCard | undefined>(undefined);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pin, setPin, pinBySession] = useSessionPin();

  const load = async () => {
    try { setInfo(await giftCardsApi<OrderGiftCard>({ action: "order", orderId })); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); setInfo(null); }
  };
  useEffect(() => { void load(); }, [orderId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (info === undefined) return null;
  if (info === null) return error ? <p className="text-sm text-amber-900">{error}</p> : null;
  const left = Math.round((info.amount - info.recredited) * 100) / 100;
  const canRecredit = (info.status === "consumed" || info.status === "recredited") && left > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pinBySession && !pin.trim()) { setError("Saisissez le code PIN administrateur."); return; }
    setBusy(true); setError(null); setNotice(null);
    try {
      const res = await giftCardsApi<{ recredited: number }>({ action: "recredit_order", pin, orderId, amount });
      setNotice(`${money(res.recredited)} remis sur le bon ${info.code}.`);
      setAmount("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border border-border/60 bg-background p-4 space-y-2" data-testid="gift-card-order-panel">
      <h3 className="font-sans text-[12px] tracking-[0.105em] font-semibold uppercase text-foreground flex items-center gap-2">
        <Gift className="w-3.5 h-3.5 text-primary" strokeWidth={1.5} /> Bon cadeau
      </h3>
      <p className="text-sm">
        <Link to="/admin/gift-cards" className="font-mono font-semibold text-primary hover:underline">{info.code}</Link>
        {" · "}{money(info.amount)} payés avec le bon · {STATUS_LABEL[info.status] ?? info.status}
        {info.recredited > 0 && ` · ${money(info.recredited)} déjà remis`}
      </p>
      <p className="text-xs text-muted-foreground">Solde actuel du bon : {money(info.balance)}. Un bon n'est jamais remboursé en argent.</p>
      {canRecredit && (
        <form onSubmit={submit} className="flex flex-wrap items-center gap-2 pt-1">
          <Input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.,]/g, ""))} inputMode="decimal" placeholder={`max ${left.toFixed(2)}`} className="rounded-none h-9 w-28" />
          {!pinBySession && <PasswordInput autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="PIN" className="rounded-none h-9 w-28" />}
          <Button type="submit" size="sm" variant="outline" className="rounded-none h-9" disabled={busy || !amount}>
            {busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Remettre sur le bon
          </Button>
        </form>
      )}
      {canRecredit && <p className="text-xs text-muted-foreground">Après une annulation partielle (un gâteau, des places de workshop) : la part payée avec le bon y revient, le reste se rembourse par carte comme d'habitude.</p>}
      {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
      {notice && <p className="text-sm text-emerald-800" role="status">{notice}</p>}
    </div>
  );
}
