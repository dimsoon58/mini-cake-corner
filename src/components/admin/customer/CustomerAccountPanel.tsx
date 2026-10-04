import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLang } from "@/context/LanguageContext";
import { chf, formatDay } from "@/lib/refunds";
import {
  REWARD_EVENT_LABELS, customersApi, welcomeState,
  type AccountStatus, type CustomerDetail, type RewardHistory,
} from "@/lib/customers";
import { cn } from "@/lib/utils";

// Fiche client (F20) : compte de connexion, cagnotte (historique + crédit
// manuel), offre de bienvenue, newsletter. La cagnotte est celle du compte
// client du site (aucun deuxième système) ; le crédit manuel ajoute un lot
// valable un an (en CHF, comme le solde). Notion n'est plus synchronisé
// (scénario Make 7131969 désactivé) : la cagnotte de référence est celle-ci.
// Les actions utilisent la session admin et le PIN déjà validé (ou le PIN
// saisi plus haut) ; chaque action est journalisée avec son résultat.

const box = "border border-border/60 bg-background p-4";
const h2 = "font-sans text-[12px] tracking-[0.105em] font-semibold uppercase text-foreground";
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Write = (body: Record<string, unknown>, ok?: string) => Promise<{ ok: boolean; data?: unknown; error?: string }>;

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex justify-between gap-3"><dt className="text-muted-foreground shrink-0">{label}</dt><dd className="text-right min-w-0 break-words">{children}</dd></div>
);

// ── Compte de connexion ─────────────────────────────────────────────────
export function AccountBox({ detail, write }: { detail: CustomerDetail; write: Write }) {
  const { t, lang } = useLang();
  const l = lang === "en" ? "en" : "fr";
  const c = detail.customer;
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [inviteEmail, setInviteEmail] = useState(c.email ?? "");
  const [newLogin, setNewLogin] = useState<string | null>(null);

  const loadStatus = async () => {
    try { setStatus(await customersApi<AccountStatus>({ action: "account_status", customerId: c.id })); setErr(null); }
    catch (e) { setErr(errText(e)); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadStatus(); }, [c.id, detail.account?.profileId]);

  const run = async (action: string, confirmText: string, extra: Record<string, unknown> = {}) => {
    if (busy || !window.confirm(confirmText)) return;
    setBusy(action); setResult(null);
    const r = await write({ action, customerId: c.id, ...extra });
    setBusy(null);
    setResult(r.ok ? { ok: true, text: String((r.data as { message?: string })?.message ?? t("Done.", "Fait.")) } : { ok: false, text: r.error ?? "" });
    await loadStatus();
  };

  const STATE: Record<string, { en: string; fr: string; tone: string }> = {
    none: { en: "No account", fr: "Pas de compte", tone: "bg-secondary" },
    missing: { en: "Account not found in Auth", fr: "Compte introuvable dans Auth", tone: "bg-red-100 text-red-900" },
    invited: { en: "Invited — not activated yet", fr: "Invité — pas encore activé", tone: "bg-amber-100 text-amber-900" },
    unconfirmed: { en: "Created — email not confirmed", fr: "Créé — email non confirmé", tone: "bg-amber-100 text-amber-900" },
    active: { en: "Active", fr: "Actif", tone: "bg-emerald-100 text-emerald-900" },
  };
  const s = status?.state ?? (detail.account ? null : "none");
  const history = detail.events.filter((e) => ["account_invite", "account_resend", "password_reset", "login_email_change"].includes(e.kind));
  const disabled = !!c.mergedInto;

  return (
    <section className={box} data-testid="customer-login-account">
      <h2 className={cn(h2, "mb-2")}>{t("Login account", "Compte de connexion")}</h2>
      {err && <p className="text-sm text-amber-800">{err}</p>}
      <dl className="text-sm space-y-1">
        <Row label={t("Status", "Statut")}>
          {s ? <span className={cn("text-xs px-1.5 py-0.5", STATE[s].tone)} data-testid="account-state">{STATE[s][l]}</span> : <Loader2 className="w-3.5 h-3.5 animate-spin inline" />}
        </Row>
        <Row label={t("Contact email (record)", "Email de contact (fiche)")}>{c.email ?? "—"}</Row>
        {detail.account && <Row label={t("Login email (account)", "Email de connexion (compte)")}><strong>{status?.loginEmail ?? detail.account.email ?? "—"}</strong></Row>}
        {status?.lastSignInAt && <Row label={t("Last sign-in", "Dernière connexion")}>{formatDay(status.lastSignInAt, l)}</Row>}
        {status?.invitedAt && s !== "active" && <Row label={t("Invited on", "Invité le")}>{formatDay(status.invitedAt, l)}</Row>}
      </dl>
      {detail.account && status?.loginEmail && c.email && status.loginEmail.toLowerCase() !== c.email.toLowerCase() && (
        <p className="text-xs text-muted-foreground mt-1">{t("The login email differs from the contact email: both are kept.", "L'email de connexion diffère de l'email de contact : les deux sont conservés.")}</p>
      )}

      {!disabled && (
        <div className="mt-3 space-y-2" data-testid="account-actions">
          {s === "none" && (
            <div className="space-y-1">
              <Label htmlFor="invite-email" className="text-xs text-muted-foreground">{t("Login email for the invitation", "Email de connexion pour l'invitation")}</Label>
              <div className="flex gap-2">
                <Input id="invite-email" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} className="rounded-none h-9" />
                <Button className="rounded-none h-9 shrink-0" disabled={!!busy || !inviteEmail.trim()} data-testid="account-invite"
                  onClick={() => run("account_invite", t(`Create the account and send the invitation to ${inviteEmail}?`, `Créer le compte et envoyer l'invitation à ${inviteEmail} ?`), { email: inviteEmail })}>
                  {busy === "account_invite" && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}{t("Invite", "Inviter")}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">{t("The customer receives the existing invitation email and chooses a password.", "Le client reçoit l'e-mail d'invitation existant et choisit son mot de passe.")}</p>
            </div>
          )}
          {(s === "invited" || s === "unconfirmed") && (
            <Button variant="outline" className="rounded-none w-full" disabled={!!busy} data-testid="account-resend"
              onClick={() => run("account_resend", t("Send the activation email again?", "Renvoyer l'e-mail d'activation ?"))}>
              {busy === "account_resend" && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}{t("Resend the activation", "Renvoyer l'activation")}
            </Button>
          )}
          {s === "active" && (
            <Button variant="outline" className="rounded-none w-full" disabled={!!busy} data-testid="password-reset"
              onClick={() => run("password_reset", t(`Send a password reset link to ${status?.loginEmail}?`, `Envoyer un lien de réinitialisation du mot de passe à ${status?.loginEmail} ?`))}>
              {busy === "password_reset" && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}{t("Send a password reset link", "Envoyer un lien de réinitialisation")}
            </Button>
          )}
          {detail.account && s !== "missing" && (newLogin === null ? (
            <Button variant="ghost" className="rounded-none w-full" disabled={!!busy} onClick={() => setNewLogin("")} data-testid="login-email-open">
              {t("Change the login email", "Changer l'email de connexion")}
            </Button>
          ) : (
            <div className="space-y-1">
              <Label htmlFor="new-login" className="text-xs text-muted-foreground">{t("New login email", "Nouvel email de connexion")}</Label>
              <div className="flex gap-2">
                <Input id="new-login" type="email" value={newLogin} onChange={(e) => setNewLogin(e.target.value)} className="rounded-none h-9" />
                <Button className="rounded-none h-9 shrink-0" disabled={!!busy || !newLogin.trim()} data-testid="login-email-save"
                  onClick={async () => { await run("login_email_change", t(`Change the login email to ${newLogin}? The contact email does not change. No email is sent.`, `Changer l'email de connexion en ${newLogin} ? L'email de contact ne change pas. Aucun e-mail n'est envoyé.`), { email: newLogin }); setNewLogin(null); }}>
                  {t("Change", "Changer")}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      {result && <p role="status" className={cn("mt-2 text-sm px-2 py-1 border", result.ok ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-red-50 border-red-200 text-red-800")} data-testid="account-result">{result.text}</p>}
      {history.length > 0 && (
        <ul className="mt-3 text-xs text-muted-foreground space-y-0.5" data-testid="account-history">
          {history.map((e, i) => {
            const d = (e.detail ?? {}) as { result?: string; message?: string; email?: string };
            return <li key={i}>{formatDay(e.at, l)} · {ACCOUNT_EVENT[e.kind]?.[l] ?? e.kind}{e.by ? ` · ${e.by}` : ""} · <span className={d.result === "error" ? "text-red-700" : d.result === "ok" ? "text-emerald-800" : ""}>{d.result === "ok" ? t("done", "fait") : d.result === "error" ? `${t("failed", "échec")} — ${d.message ?? ""}` : t("in progress", "en cours")}</span></li>;
          })}
        </ul>
      )}
    </section>
  );
}

const ACCOUNT_EVENT: Record<string, { en: string; fr: string }> = {
  account_invite: { en: "invitation", fr: "invitation" },
  account_resend: { en: "activation resent", fr: "activation renvoyée" },
  password_reset: { en: "password reset link", fr: "lien de réinitialisation" },
  login_email_change: { en: "login email changed", fr: "email de connexion changé" },
};

// ── Cagnotte, bienvenue, newsletter ─────────────────────────────────────
export function BenefitsBox({ detail, write }: { detail: CustomerDetail; write: Write }) {
  const { t, lang } = useLang();
  const l = lang === "en" ? "en" : "fr";
  const a = detail.account;
  const [creditOpen, setCreditOpen] = useState(false);
  const [brevo, setBrevo] = useState<{ found: boolean; createdAt?: string | null; inList?: boolean; reason?: string } | null>(null);
  const [brevoBusy, setBrevoBusy] = useState(false);
  if (!a) return (
    <section className={box} data-testid="customer-account">
      <h2 className={cn(h2, "mb-2")}>{t("Benefits", "Avantages")}</h2>
      <p className="text-sm text-muted-foreground">{t("No customer account: no reward balance, no welcome offer.", "Pas de compte client : pas de cagnotte ni d'offre de bienvenue.")}</p>
    </section>
  );
  const r = a.rewards;
  const mismatch = r && r.balance != null && Math.abs(Number(r.balance) - Number(r.computedBalance)) >= 0.005;
  const ws = welcomeState(a);
  const WELCOME: Record<string, { en: string; fr: string; tone: string }> = {
    available: { en: "Available", fr: "Disponible", tone: "bg-emerald-100 text-emerald-900" },
    used: { en: "Used", fr: "Utilisée", tone: "bg-secondary" },
    expired: { en: "Expired", fr: "Expirée", tone: "bg-amber-100 text-amber-900" },
    reserved: { en: "Reserved for an order in progress", fr: "Réservée pour une commande en cours", tone: "bg-sky-100 text-sky-900" },
    inactive: { en: "Not activated (no newsletter subscription)", fr: "Non activée (pas d'inscription newsletter)", tone: "bg-secondary" },
  };
  return (
    <section className={box} data-testid="customer-account">
      <h2 className={cn(h2, "mb-2")}>{t("Benefits", "Avantages")}</h2>
      <dl className="text-sm space-y-1.5">
        <Row label={t("Reward balance", "Cagnotte")}><span className="font-semibold tabular-nums" data-testid="reward-balance">{chf(a.rewardBalance)}</span>
          {r?.nextExpiry && <span className="block text-[11px] text-muted-foreground">{t("next expiry", "prochaine expiration")} {formatDay(r.nextExpiry, l)}</span>}</Row>
        {mismatch && <p className="text-xs border border-amber-300 bg-amber-50 text-amber-900 px-2 py-1">{t(`Valid lots add up to ${chf(r!.computedBalance)}: the balance has not been recomputed — to check.`, `Les lots valides totalisent ${chf(r!.computedBalance)} : le solde n'a pas été recalculé — à vérifier.`)}</p>}
        <Row label={t("Welcome offer", "Offre de bienvenue")}>
          <span className={cn("text-xs px-1.5 py-0.5", WELCOME[ws].tone)} data-testid="welcome-state">{WELCOME[ws][l]}</span>
          <span className="block text-[11px] text-muted-foreground">
            {ws === "used" && a.welcomeUsedAt ? `${t("used on", "utilisée le")} ${formatDay(a.welcomeUsedAt, l)}${a.welcomeUsedOrder ? ` · ${a.welcomeUsedOrder}` : ""}` : ""}
            {ws !== "used" && a.welcomeExpiresAt ? `${ws === "expired" ? t("expired on", "expirée le") : t("expires on", "expire le")} ${formatDay(a.welcomeExpiresAt, l)}` : ""}
          </span>
        </Row>
        <Row label="Newsletter">
          <span data-testid="newsletter-state">{a.newsletter ? t("subscribed", "inscrit") : t("not subscribed", "non inscrit")}</span>
          <span className="block text-[11px] text-muted-foreground">
            {a.newsletterSubscribedAt ? `${t("subscribed on", "inscrit le")} ${formatDay(a.newsletterSubscribedAt, l)}` : a.newsletter ? t("subscription date unknown (before 05.10.2026)", "date d'inscription inconnue (avant le 05.10.2026)") : ""}
            {a.newsletterUnsubscribedAt ? ` · ${t("unsubscribed on", "désinscrit le")} ${formatDay(a.newsletterUnsubscribedAt, l)}` : ""}
          </span>
          {brevo ? (
            <span className="block text-[11px]" data-testid="brevo-info">
              {brevo.found ? `Brevo : ${t("contact added on", "contact ajouté le")} ${brevo.createdAt ? formatDay(brevo.createdAt, l) : "—"} · ${brevo.inList ? t("in the list", "dans la liste") : t("not in the list", "hors de la liste")}`
                : brevo.reason === "not_in_brevo" ? t("Brevo: no contact", "Brevo : aucun contact") : t("Brevo not available", "Brevo indisponible")}
            </span>
          ) : (
            <button type="button" className="text-[11px] underline text-muted-foreground" disabled={brevoBusy} data-testid="brevo-check"
              onClick={async () => { setBrevoBusy(true); try { setBrevo(await customersApi({ action: "newsletter_brevo", customerId: detail.customer.id })); } catch { setBrevo({ found: false, reason: "error" }); } setBrevoBusy(false); }}>
              {t("Check the date in Brevo", "Voir la date dans Brevo")}
            </button>
          )}
        </Row>
      </dl>
      <p className="text-[11px] text-muted-foreground mt-2">{t("Newsletter: changed only by the customer (never subscribed automatically).", "Newsletter : modifiée seulement par le client (jamais d'inscription automatique).")}</p>
      {!detail.customer.mergedInto && (
        <Button variant="outline" className="rounded-none w-full mt-3" onClick={() => setCreditOpen(true)} data-testid="reward-credit-open">
          {t("Credit the reward balance", "Créditer la cagnotte")}
        </Button>
      )}
      {creditOpen && <CreditDialog detail={detail} write={write} onClose={() => setCreditOpen(false)} />}
    </section>
  );
}

function CreditDialog({ detail, write, onClose }: { detail: CustomerDetail; write: Write; onClose: () => void }) {
  const { t } = useLang();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Une clé par ouverture : un double clic ou une nouvelle tentative ne crédite qu'une fois.
  const key = useRef(newKey());
  const n = Number(amount.replace(/[’'\s]/g, "").replace(",", "."));
  const valid = Number.isFinite(n) && n > 0 && n <= 500 && reason.trim().length > 0;
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-md rounded-none">
        <DialogHeader>
          <DialogTitle>{t("Credit the reward balance", "Créditer la cagnotte")}</DialogTitle>
          <DialogDescription>{t("Adds a lot in CHF, valid one year, to the customer's existing balance (the one shown in their account on the site). Notion is not updated.", "Ajoute un lot en CHF, valable un an, à la cagnotte existante du client (celle affichée dans son compte sur le site). Notion n'est pas mis à jour.")}</DialogDescription>
        </DialogHeader>
        {!confirm ? (
          <div className="space-y-3">
            <div className="space-y-1"><Label htmlFor="credit-amount" className="text-xs">{t("Amount (CHF, max 500)", "Montant (CHF, max 500)")}</Label>
              <Input id="credit-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="rounded-none" data-testid="credit-amount" /></div>
            <div className="space-y-1"><Label htmlFor="credit-reason" className="text-xs">{t("Reason (required)", "Motif (obligatoire)")}</Label>
              <Input id="credit-reason" value={reason} onChange={(e) => setReason(e.target.value)} className="rounded-none" data-testid="credit-reason" /></div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" className="rounded-none" onClick={onClose}>{t("Cancel", "Annuler")}</Button>
              <Button className="rounded-none" disabled={!valid} onClick={() => setConfirm(true)} data-testid="credit-next">{t("Continue", "Continuer")}</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm">{t(`Credit ${chf(n)} to ${detail.customer.firstName ?? ""} ${detail.customer.lastName ?? ""} for: « ${reason.trim()} »?`, `Créditer ${chf(n)} à ${detail.customer.firstName ?? ""} ${detail.customer.lastName ?? ""} pour : « ${reason.trim()} » ?`)}</p>
            {err && <p className="text-sm text-red-800" role="alert">{err}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" className="rounded-none" disabled={busy} onClick={() => setConfirm(false)}>{t("Back", "Retour")}</Button>
              <Button className="rounded-none" disabled={busy} data-testid="credit-confirm" onClick={async () => {
                if (busy) return;
                setBusy(true); setErr(null);
                const r = await write({ action: "reward_credit", customerId: detail.customer.id, amount: String(n), reason: reason.trim(), idempotencyKey: key.current },
                  t(`${chf(n)} credited.`, `${chf(n)} crédités.`));
                setBusy(false);
                if (r.ok) onClose(); else setErr(r.error ?? "");
              }}>{busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}{t("Confirm the credit", "Confirmer le crédit")}</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Historique de la cagnotte ───────────────────────────────────────────
export function RewardHistoryBox({ history }: { history: RewardHistory }) {
  const { t, lang } = useLang();
  const l = lang === "en" ? "en" : "fr";
  return (
    <section className="space-y-2" data-testid="reward-history">
      <h2 className={h2}>{t("Reward balance history", "Historique de la cagnotte")} ({history.events.length})</h2>
      {history.events.length === 0 ? <p className="text-sm text-muted-foreground">{t("No movement.", "Aucun mouvement.")}</p> : (
        <ul className="divide-y divide-border/60 border border-border/60 text-sm">
          {history.events.map((e, i) => (
            <li key={i} className="px-3 py-1.5 grid grid-cols-[80px_minmax(0,1fr)_auto] gap-2" data-kind={e.kind}>
              <span className="tabular-nums text-muted-foreground">{e.at ? formatDay(e.at, l) : t("date ?", "date ?")}</span>
              <span className="min-w-0">
                {REWARD_EVENT_LABELS[e.kind]?.[l] ?? e.kind}
                {e.orderId && <> · <Link to={`/admin/order/${e.orderId}`} className="underline">{e.orderNumber ?? e.orderId.slice(0, 8)}</Link></>}
                {e.reason && <span className="text-muted-foreground"> · {e.reason}</span>}
                {e.by && <span className="text-muted-foreground"> · {e.by}</span>}
              </span>
              <span className={cn("tabular-nums text-right", e.amount < 0 ? "text-red-800" : "text-emerald-800")}>{e.amount > 0 ? "+" : "−"}{chf(Math.abs(e.amount))}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">{t("Read from the existing reward registers; nothing is recomputed. A partial refund removes 3.5 % of the refunded amount once; a fully refunded order cancels its remaining cashback and gives back the balance used.", "Lu dans les registres de la cagnotte existante ; rien n'est recalculé. Un remboursement partiel retire une seule fois 3,5 % du montant remboursé ; une commande remboursée en entier annule son cashback restant et rend la cagnotte utilisée.")}</p>
    </section>
  );
}
