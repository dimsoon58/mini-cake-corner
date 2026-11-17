import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { Copy, History, Loader2, Mail, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/context/LanguageContext";
import { useSessionPin } from "@/lib/adminSession";
import { formatChf, PAYMENT_METHODS } from "@/lib/manualOrders";

// F47 (17.11.2026) — Fiche commande : « Modifier la commande » (commande du
// site, ou manuelle déjà payée), historique des modifications, supplément
// encore à payer (lien à copier ou à envoyer, ou paiement reçu à la main).

const field = "w-full border border-input bg-background px-2 py-1.5 text-sm rounded-none";

interface Edit {
  id: string; created_at: string; author_name: string | null; summary: string | null; note: string | null;
  old_total: number; new_total: number; price_change: number; settlement: "none" | "supplement" | "refund" | "kept";
  kept_amount: number; absorbed_amount: number; refund_amount: number;
  supplement_amount: number; supplement_status: "due" | "paid" | "replaced" | null; supplement_paid_at: string | null; supplement_method: string | null;
}
interface Data { edits: Edit[]; dueEditId: string | null; link: { url: string; emailSentAt: string | null; emailSentTo: string | null; emailSentCount: number } | null }

const zurichToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date());

export function OrderEditsPanel({ orderId, canEdit, reloadKey, onChanged }: { orderId: string; canEdit: boolean; reloadKey: number; onChanged: () => void }) {
  const { t } = useLang();
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState<"link" | "email" | "pay" | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [method, setMethod] = useState("twint");
  const [paidOn, setPaidOn] = useState(zurichToday());
  const [note, setNote] = useState("");
  const [pin, setPin, pinBySession] = useSessionPin();

  useEffect(() => {
    // Silencieux si la fonction n'est pas encore déployée.
    supabase.functions.invoke("manage-manual-order", { body: { action: "edits", orderId } })
      .then(({ data: d, error }) => { if (!error && d?.data) setData(d.data as Data); })
      .catch(() => {});
  }, [orderId, reloadKey]);

  const call = async (action: string, extra: Record<string, unknown>) => {
    const { data: d, error } = await supabase.functions.invoke("manage-manual-order", { body: { action, orderId, editId: data?.dueEditId, pin, ...extra } });
    if (error || d?.error) {
      let p: { error?: string; reason?: string } | null = d ?? null;
      if (error) { try { p = await (error as { context?: Response }).context?.json(); } catch { /* ignore */ } }
      return { ok: false as const, error: p?.error === "Invalid PIN" ? t("Wrong PIN.", "Code PIN incorrect.") : p?.reason === "already_sent" ? t("Already sent.", "Déjà envoyé.") : (p?.error ?? t("Error", "Erreur")) };
    }
    return { ok: true as const, data: d.data };
  };

  const due = data?.edits.find((e) => e.id === data.dueEditId) ?? null;
  const edits = data?.edits ?? [];

  const copyLink = async () => {
    let url = data?.link?.url;
    if (!url) {
      setBusy("link");
      const r = await call("supplement_link", {});
      setBusy(null);
      if (!r.ok) { toast.error(r.error); return; }
      url = r.data.url;
      onChanged();
    }
    try { await navigator.clipboard.writeText(url!); toast.success(t("Link copied", "Lien copié")); } catch { toast.message(url!); }
  };
  const sendEmail = async () => {
    const count = data?.link?.emailSentCount ?? 0;
    if (count > 0 && !window.confirm(t("Send the link again by email?", "Renvoyer le lien par e-mail ?"))) return;
    setBusy("email");
    const r = await call("supplement_email", { resend: count > 0, expectedCount: count });
    setBusy(null);
    if (!r.ok) { toast.error(r.error); return; }
    setPin("");
    toast.success(t(`Email sent to ${r.data.to}`, `E-mail envoyé à ${r.data.to}`));
    onChanged();
  };
  const recordPaid = async () => {
    if (!pinBySession && !pin.trim()) { toast.error(t("Enter the admin PIN.", "Saisissez le code PIN administrateur.")); return; }
    setBusy("pay");
    const r = await call("supplement_record", { paymentMethod: method, paidOn, note: note.trim() || null });
    setBusy(null);
    if (!r.ok) { toast.error(r.error); return; }
    setPin(""); setPayOpen(false); setNote("");
    toast.success(t("Supplement recorded as paid.", "Supplément enregistré comme payé."));
    onChanged();
  };

  const settlementText = (e: Edit) => {
    if (e.settlement === "refund") return t(`refund CHF ${Number(e.refund_amount).toFixed(2)} (in « Refunds »)`, `remboursement CHF ${Number(e.refund_amount).toFixed(2)} (dans « Remboursements »)`);
    if (e.settlement === "kept") return t(`difference kept CHF ${Number(e.kept_amount).toFixed(2)}`, `différence gardée CHF ${Number(e.kept_amount).toFixed(2)}`);
    if (e.supplement_status === "due") return t(`supplement CHF ${Number(e.supplement_amount).toFixed(2)} to pay`, `supplément CHF ${Number(e.supplement_amount).toFixed(2)} à payer`);
    if (e.supplement_status === "paid") return t(`supplement CHF ${Number(e.supplement_amount).toFixed(2)} paid${e.supplement_method ? ` (${e.supplement_method})` : ""}`, `supplément CHF ${Number(e.supplement_amount).toFixed(2)} payé${e.supplement_method ? ` (${e.supplement_method})` : ""}`);
    if (e.supplement_status === "replaced") return t("supplement replaced by a later change", "supplément remplacé par une modification suivante");
    return Number(e.price_change) === 0 ? t("price unchanged", "prix inchangé") : "";
  };

  if (!canEdit && edits.length === 0) return null;
  return (
    <div className="border border-border/60 p-4 space-y-3" data-testid="order-edits">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs font-semibold uppercase tracking-[0.105em] flex items-center gap-1.5"><History className="w-3.5 h-3.5" /> {t("Changes to the order", "Modifications de la commande")}</p>
        {canEdit && (
          <Button asChild size="sm" variant="outline" className="rounded-none">
            <Link to={`/admin/manual-orders/${orderId}/edit`}><Pencil className="w-4 h-4 mr-1" /> {t("Edit the order", "Modifier la commande")}</Link>
          </Button>
        )}
      </div>

      {due && (
        <div className="border border-amber-300 bg-amber-50 px-3 py-2 space-y-2 text-sm">
          <p className="font-semibold text-amber-900">{t(`Supplement to pay: ${formatChf(Number(due.supplement_amount))}`, `Supplément à payer : ${formatChf(Number(due.supplement_amount))}`)}</p>
          {data?.link?.emailSentAt && (
            <p className="text-xs text-amber-900">{t("Link emailed", "Lien envoyé")} {format(new Date(data.link.emailSentAt), "dd.MM.yyyy HH:mm")} → {data.link.emailSentTo}{data.link.emailSentCount > 1 ? ` (${data.link.emailSentCount}×)` : ""}</p>
          )}
          {!pinBySession && (
            <div className="max-w-[220px]">
              <label className="block text-xs mb-1" htmlFor="sup-pin">{t("Admin PIN", "Code PIN administrateur")}</label>
              <PasswordInput id="sup-pin" value={pin} onChange={(e) => setPin(e.target.value)} className={field} autoComplete="off" />
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="rounded-none" onClick={copyLink} disabled={!!busy}>
              {busy === "link" ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Copy className="w-4 h-4 mr-1" />} {t("Copy the payment link", "Copier le lien de paiement")}
            </Button>
            <Button size="sm" variant="outline" className="rounded-none" onClick={sendEmail} disabled={!!busy}>
              {busy === "email" ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Mail className="w-4 h-4 mr-1" />} {(data?.link?.emailSentCount ?? 0) > 0 ? t("Send the link again", "Renvoyer le lien") : t("Email the link", "Envoyer le lien par e-mail")}
            </Button>
            <Button size="sm" variant="outline" className="rounded-none" onClick={() => setPayOpen((v) => !v)} disabled={!!busy}>
              {t("Paid by hand (TWINT, cash…)", "Payé à la main (TWINT, cash…)")}
            </Button>
          </div>
          {payOpen && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
              <select value={method} onChange={(e) => setMethod(e.target.value)} className={field} aria-label={t("Payment method", "Moyen de paiement")}>
                {PAYMENT_METHODS.map((m) => <option key={m.id} value={m.id}>{t(m.en, m.fr)}</option>)}
              </select>
              <input type="date" value={paidOn} max={zurichToday()} onChange={(e) => setPaidOn(e.target.value)} className={field} aria-label={t("Payment date", "Date du paiement")} />
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("Note (optional)", "Note (facultatif)")} className={field} />
              <Button size="sm" className="rounded-none sm:col-span-3 bg-primary hover:bg-primary/90 text-primary-foreground" onClick={recordPaid} disabled={!!busy}>
                {busy === "pay" && <Loader2 className="w-4 h-4 animate-spin mr-1" />} {t(`Record ${formatChf(Number(due.supplement_amount))} received`, `Enregistrer ${formatChf(Number(due.supplement_amount))} reçus`)}
              </Button>
            </div>
          )}
        </div>
      )}

      {edits.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("No change yet.", "Aucune modification pour l'instant.")}</p>
      ) : (
        <ul className="space-y-2">
          {[...edits].reverse().map((e) => (
            <li key={e.id} className="border-l-2 border-border pl-3 text-xs space-y-0.5">
              <p className="text-muted-foreground">
                {format(new Date(e.created_at), "dd.MM.yyyy HH:mm")} · {e.author_name ?? "—"} · {formatChf(Number(e.old_total))} → <b className="text-foreground">{formatChf(Number(e.new_total))}</b>
                {settlementText(e) ? ` · ${settlementText(e)}` : ""}
              </p>
              {(e.summary ?? "").split("\n").filter(Boolean).map((line) => <p key={line}>{line}</p>)}
              {e.note && <p className="italic text-muted-foreground">« {e.note} »</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
