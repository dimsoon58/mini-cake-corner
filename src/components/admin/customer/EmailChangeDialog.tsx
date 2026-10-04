import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLang } from "@/context/LanguageContext";
import { formatDay } from "@/lib/refunds";
import {
  EMAIL_STEP_LABELS, customersApi, CustomersError,
  type CustomerDetail, type EmailChangeOp, type EmailChangePreview, type EmailChangeResult,
} from "@/lib/customers";
import { cn } from "@/lib/utils";

// F21 — « Modifier l'adresse email » : la seule façon de changer l'email d'une
// fiche existante. Le serveur (manage-customers) vérifie les conflits AVANT
// toute écriture, puis : email de connexion (si compte) → fiche + profil →
// contact Brevo renommé (jamais créé, jamais inscrit). Chaque étape est
// journalisée ; une reprise ne refait pas ce qui est déjà fait. Aucun e-mail
// n'est envoyé au client, l'ancienne boîte n'est pas nécessaire.

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

const StepList = ({ steps }: { steps: Record<string, string> }) => {
  const { t, lang } = useLang();
  const l = lang === "en" ? "en" : "fr";
  const RES: Record<string, { en: string; fr: string; tone: string }> = {
    ok: { en: "done", fr: "fait", tone: "text-emerald-800" },
    not_needed: { en: "nothing to do", fr: "rien à faire", tone: "text-muted-foreground" },
    error: { en: "failed — to do", fr: "échec — reste à faire", tone: "text-red-800" },
    pending: { en: "to do", fr: "reste à faire", tone: "text-amber-800" },
  };
  return (
    <ul className="text-sm space-y-1" data-testid="email-change-steps">
      {Object.keys(EMAIL_STEP_LABELS).map((k) => {
        const r = RES[steps[k] ?? "pending"] ?? RES.pending;
        return (
          <li key={k} data-step={k} data-result={steps[k] ?? "pending"}>
            {EMAIL_STEP_LABELS[k][l]} : <span className={cn("font-medium", r.tone)}>{r[l]}</span>
            {steps[`${k}_message`] && <span className="block text-xs text-muted-foreground">{steps[`${k}_message`]}</span>}
          </li>
        );
      })}
      <li className="text-xs text-muted-foreground">{t("Orders and invoices already issued keep their details.", "Commandes et factures déjà émises : coordonnées d'origine conservées.")}</li>
    </ul>
  );
};

export function EmailChangeDialog({ detail, pin, onClose, onChanged }: {
  detail: CustomerDetail; pin: string; onClose: () => void; onChanged: () => Promise<void> | void;
}) {
  const { t, lang } = useLang();
  const l = lang === "en" ? "en" : "fr";
  const c = detail.customer;
  const [current, setCurrent] = useState<EmailChangePreview | null>(null);
  const [check, setCheck] = useState<EmailChangePreview | null>(null);
  const [email, setEmail] = useState("");
  const [identity, setIdentity] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<EmailChangeResult | null>(null);
  // Une clé par adresse vérifiée : un double clic ou un nouvel essai ne crée pas une deuxième opération.
  const attempt = useRef<{ email: string; key: string } | null>(null);

  const loadCurrent = async () => {
    try { setCurrent(await customersApi<EmailChangePreview>({ action: "email_change_preview", customerId: c.id })); setErr(null); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadCurrent(); }, [c.id]);

  const open: EmailChangeOp | null = current?.latest && ["in_progress", "partial"].includes(current.latest.status) ? current.latest : null;
  const differs = !!current?.hasAccount && !!current.loginEmail && !!current.contactEmail && !same(current.loginEmail, current.contactEmail);
  const target = (open?.new_email ?? email).trim().toLowerCase();
  const blocked = !!check?.conflicts?.otherCustomer || !!check?.conflicts?.otherAccount || check?.brevoNew?.status === 200
    || (check?.brevoOld.filter((b) => b.status === 200).length ?? 0) > 1;
  const brevoDown = !!check && (check.brevoNew?.status === 0 || (check.brevoNew != null && ![200, 404].includes(check.brevoNew.status))
    || check.brevoOld.some((b) => ![200, 404].includes(b.status)));

  const verify = async () => {
    const e = email.trim().toLowerCase();
    if (!EMAIL_RE.test(e)) { setErr(t("Invalid email address.", "Adresse email invalide.")); return; }
    setLoading(true); setErr(null); setCheck(null); setIdentity(false);
    try { setCheck(await customersApi<EmailChangePreview>({ action: "email_change_preview", customerId: c.id, email: e })); }
    catch (x) { setErr(x instanceof Error ? x.message : String(x)); }
    setLoading(false);
  };

  const submit = async () => {
    if (busy || !identity || !pin.trim()) return;
    const e = target;
    if (open) attempt.current = { email: open.new_email, key: open.key };
    else if (!attempt.current || attempt.current.email !== e) attempt.current = { email: e, key: newKey() };
    setBusy(true); setErr(null);
    try {
      const r = await customersApi<EmailChangeResult>({ action: "email_change", customerId: c.id, email: e, idempotencyKey: attempt.current.key, identityChecked: true, pin });
      setResult(r);
    } catch (x) {
      const ce = x as CustomersError;
      const d = ce.data as EmailChangeResult | null;
      if (d?.status) {
        setResult(d);
        if (d.status === "blocked") attempt.current = null; // rien n'a été fait : un nouvel essai repart de zéro
      } else setErr(ce.message);
    }
    setBusy(false);
    await onChanged();
    await loadCurrent();
  };

  const tone = result?.status === "completed" ? "bg-emerald-50 border-emerald-200 text-emerald-900"
    : result?.status === "partial" ? "bg-amber-50 border-amber-300 text-amber-900" : "bg-red-50 border-red-200 text-red-900";

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-lg rounded-none max-h-[90vh] overflow-y-auto" data-testid="email-change-dialog">
        <DialogHeader>
          <DialogTitle>{t("Change the email address", "Modifier l'adresse email")}</DialogTitle>
          <DialogDescription>{t(
            "Fixes a mistake or replaces an address the customer can no longer access. Same account, same reward balance, benefits and history. No email is sent; access to the old mailbox is not needed.",
            "Pour corriger une erreur ou remplacer une adresse à laquelle le client n'a plus accès. Même compte, même cagnotte, mêmes avantages et historique. Aucun e-mail n'est envoyé ; l'accès à l'ancienne boîte n'est pas nécessaire.")}</DialogDescription>
        </DialogHeader>

        {!current && !err && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
        {current && (
          <dl className="text-sm space-y-1 border border-border/60 p-3" data-testid="email-change-current">
            <div className="flex flex-wrap justify-between gap-x-3"><dt className="text-muted-foreground">{t("Contact email (record)", "Email de contact (fiche)")}</dt><dd className="[overflow-wrap:anywhere]" data-testid="current-contact">{current.contactEmail ?? "—"}</dd></div>
            <div className="flex flex-wrap justify-between gap-x-3"><dt className="text-muted-foreground">{t("Login email (account)", "Email de connexion (compte)")}</dt>
              <dd className="[overflow-wrap:anywhere]" data-testid="current-login">{current.hasAccount ? current.loginEmail ?? "—" : t("no account", "pas de compte")}</dd></div>
            {current.hasAccount && current.profileEmail && current.loginEmail && !same(current.profileEmail, current.loginEmail) && (
              <div className="flex flex-wrap justify-between gap-x-3"><dt className="text-muted-foreground">{t("Account profile email", "Email du profil du compte")}</dt><dd className="[overflow-wrap:anywhere]">{current.profileEmail}</dd></div>
            )}
            {differs && (
              <p className="flex gap-1.5 text-xs border border-amber-300 bg-amber-50 text-amber-900 px-2 py-1 mt-1" data-testid="email-differs">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                {t("The contact email and the login email are DIFFERENT. Both will be replaced by the new address.",
                  "L'email de contact et l'email de connexion sont DIFFÉRENTS. Les deux seront remplacés par la nouvelle adresse.")}
              </p>
            )}
            {!current.hasAccount && <p className="text-xs text-muted-foreground">{t("No account: only the record (and the Brevo contact if any) changes. No account is created.", "Pas de compte : seule la fiche change (et le contact Brevo s'il existe). Aucun compte n'est créé.")}</p>}
          </dl>
        )}

        {/* Opération non terminée : reprise (même opération, rien n'est refait) */}
        {open && !result && (
          <div className="space-y-2 border border-amber-300 bg-amber-50 p-3" data-testid="email-change-open">
            <p className="text-sm text-amber-900">{t(`Change to ${open.new_email} not finished (started ${formatDay(open.created_at, l)} by ${open.created_by}).`,
              `Modification vers ${open.new_email} non terminée (commencée le ${formatDay(open.created_at, l)} par ${open.created_by}).`)}</p>
            <StepList steps={open.steps} />
          </div>
        )}

        {!open && !result && current && (
          <div className="space-y-2">
            <Label htmlFor="new-email" className="text-xs">{t("New address", "Nouvelle adresse")}</Label>
            <div className="flex gap-2">
              <Input id="new-email" type="email" value={email} autoComplete="off" data-testid="new-email"
                onChange={(e) => { setEmail(e.target.value); setCheck(null); setIdentity(false); }} className="rounded-none" />
              <Button variant="outline" className="rounded-none shrink-0" disabled={loading || !email.trim()} onClick={verify} data-testid="email-check">
                {loading && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}{t("Check", "Vérifier")}
              </Button>
            </div>
          </div>
        )}

        {check && !open && !result && (
          <div className="text-sm space-y-1" data-testid="email-change-check">
            {check.conflicts?.otherCustomer && <p className="text-red-800" data-testid="conflict-customer">{t(`Already the address of another record (${check.conflicts.otherCustomer.name || check.conflicts.otherCustomer.id}). No automatic merge.`, `Déjà l'adresse d'une autre fiche (${check.conflicts.otherCustomer.name || check.conflicts.otherCustomer.id}). Aucune fusion automatique.`)}</p>}
            {check.conflicts?.otherAccount && <p className="text-red-800" data-testid="conflict-account">{t("Already used by another customer account.", "Déjà utilisée par un autre compte client.")}</p>}
            {check.brevoNew?.status === 200 && <p className="text-red-800" data-testid="conflict-brevo">{t(`A Brevo contact already exists with this address (${check.brevoNew.state}): to check in Brevo.`, `Un contact Brevo existe déjà avec cette adresse (${check.brevoNew.state}) : à vérifier dans Brevo.`)}</p>}
            {check.brevoOld.filter((b) => b.status === 200).length > 1 && <p className="text-red-800">{t("Two Brevo contacts exist for this customer: merge them in Brevo first.", "Deux contacts Brevo existent pour ce client : à regrouper dans Brevo d'abord.")}</p>}
            {brevoDown && <p className="text-red-800">{t("Brevo is not answering: try again later.", "Brevo ne répond pas : réessayez plus tard.")}</p>}
            {!blocked && !brevoDown && (
              <>
                <p className="font-medium">{t("Will be updated:", "Sera mis à jour :")}</p>
                <ul className="list-disc pl-5">
                  <li>{t("Contact email of the record", "Email de contact de la fiche")} : {check.contactEmail ?? "—"} → <strong>{check.newEmail}</strong></li>
                  {check.hasAccount && <li>{t("Login email and account profile", "Email de connexion et profil du compte")} : {check.loginEmail ?? "—"} → <strong>{check.newEmail}</strong></li>}
                  <li>Brevo : {check.brevoOld.find((b) => b.status === 200)
                    ? t(`contact ${check.brevoOld.find((b) => b.status === 200)!.email} renamed — ${check.brevoOld.find((b) => b.status === 200)!.state}, unchanged`, `contact ${check.brevoOld.find((b) => b.status === 200)!.email} renommé — ${check.brevoOld.find((b) => b.status === 200)!.state}, inchangé`)
                    : t("no contact: nothing created, no subscription", "aucun contact : rien créé, aucune inscription")}</li>
                </ul>
              </>
            )}
          </div>
        )}

        {!result && (open || (check && !blocked && !brevoDown)) && (
          <div className="space-y-3 border-t border-border/60 pt-3">
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input type="checkbox" className="mt-1" checked={identity} onChange={(e) => setIdentity(e.target.checked)} data-testid="identity-checked" />
              <span>{t("I have verified the customer's identity (they are the person on this record) and the new address is theirs.",
                "J'ai vérifié l'identité du client (c'est bien la personne de cette fiche) et la nouvelle adresse est la sienne.")}</span>
            </label>
            {!pin.trim() && <p className="text-xs text-red-800">{t("Enter the admin PIN on the record first.", "Saisissez d'abord le code PIN administrateur sur la fiche.")}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" className="rounded-none" disabled={busy} onClick={onClose}>{t("Cancel", "Annuler")}</Button>
              <Button className="rounded-none" disabled={busy || !identity || !pin.trim()} onClick={submit} data-testid="email-change-confirm">
                {busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                {open ? t(`Resume (to ${open.new_email})`, `Reprendre (vers ${open.new_email})`) : t(`Replace with ${target}`, `Remplacer par ${target}`)}
              </Button>
            </div>
          </div>
        )}

        {err && <p className="text-sm text-red-800" role="alert" data-testid="email-change-error">{err}</p>}

        {result && (
          <div className={cn("space-y-2 border p-3", tone)} role="status" data-testid="email-change-result" data-status={result.status}>
            <p className="text-sm font-medium">
              {result.status === "completed" ? t("Address replaced — every step is done.", "Adresse remplacée — toutes les étapes sont faites.")
                : result.status === "partial" ? t("NOT finished: part of the change is done.", "PAS terminé : une partie seulement est faite.")
                : t("Nothing was changed.", "Rien n'a été modifié.")}
            </p>
            <StepList steps={result.steps} />
            <p className="text-xs">{result.message}</p>
            <div className="flex justify-end gap-2">
              {result.status !== "completed" && (
                <Button variant="outline" className="rounded-none" onClick={() => { setResult(null); setCheck(null); setIdentity(false); }} data-testid="email-change-retry">
                  {result.status === "partial" ? t("Resume", "Reprendre") : t("Back", "Retour")}
                </Button>
              )}
              <Button className="rounded-none" onClick={onClose}>{t("Close", "Fermer")}</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
