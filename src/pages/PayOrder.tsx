import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { CheckCircle, Loader2, XCircle } from "lucide-react";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/context/LanguageContext";

// F41 (04.11.2026) — lien de paiement d'une commande manuelle
// (/payer/<jeton>). Le client voit le solde restant et paie sur PostFinance.
// Retour de PostFinance : ?a=<tentative> → on interroge pay-order-link
// (status) quelques secondes, le temps que le paiement soit confirmé.
// Textes dans la langue de la commande.

type View = { orderNumber: string | null; firstName: string | null; lang: "fr" | "en"; total: number; paid: number; balance: number; state: "open" | "paid" | "cancelled" | "disabled" };
type Phase = "loading" | "ready" | "redirecting" | "confirming" | "slow" | "notfound" | "error";

const POLL_MS = 2500;
const MAX_TRIES = 16;
const chf = (n: number) => `CHF ${Number(n).toFixed(2)}`;

const PayOrder = () => {
  const { lang: siteLang } = useLang();
  const { token = "" } = useParams();
  const [params] = useSearchParams();
  const attempt = params.get("a");
  const failedReturn = params.get("payment") === "failed";
  const [view, setView] = useState<View | null>(null);
  const [phase, setPhase] = useState<Phase>(attempt ? "confirming" : "loading");
  const [notice, setNotice] = useState<string | null>(null);
  const [voided, setVoided] = useState(false);
  const started = useRef(false);

  const l = view?.lang ?? (siteLang === "en" ? "en" : "fr");
  const t = (en: string, fr: string) => (l === "en" ? en : fr);

  const call = async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("pay-order-link", { body: { token, ...body } });
    if (error) {
      let detail: { error?: string; reason?: string; data?: View } | null = null;
      try { detail = await (error as { context?: Response }).context?.json(); } catch { /* not JSON */ }
      return { ok: false as const, status: (error as { context?: Response }).context?.status ?? 0, detail };
    }
    return { ok: true as const, data };
  };

  // Chargement, ou retour de PostFinance (attente de confirmation).
  useEffect(() => {
    let alive = true;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const run = async () => {
      tries += 1;
      const r = await call(attempt ? { action: "status", attempt } : { action: "get" });
      if (!alive) return;
      if (!r.ok) { setPhase(r.status === 404 ? "notfound" : "error"); return; }
      const v = r.data.data as View & { attempt?: { status: string } | null };
      setView(v);
      if (!attempt) { setPhase("ready"); return; }
      const st = v.attempt?.status;
      if (v.state === "paid" || st === "paid") { setPhase("ready"); return; }
      if (st === "voided" || st === "failed" || st === "to_refund") { setVoided(st !== "to_refund"); setPhase("ready"); return; }
      if (tries >= MAX_TRIES) { setPhase("slow"); return; }
      timer = setTimeout(run, POLL_MS);
    };
    void run();
    return () => { alive = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, attempt]);

  const pay = async () => {
    if (started.current) return;
    started.current = true;
    setNotice(null);
    setPhase("redirecting");
    const r = await call({ action: "start" });
    if (r.ok && r.data?.data?.paymentPageUrl) { window.location.href = r.data.data.paymentPageUrl; return; }
    started.current = false;
    setPhase("ready");
    const reason = r.ok ? "error" : r.detail?.reason;
    if (!r.ok && r.detail?.data) setView(r.detail.data);
    setNotice(
      reason === "in_progress" ? t("A payment is already in progress for this order. Please wait a moment and refresh the page.", "Un paiement est déjà en cours pour cette commande. Patientez un instant puis actualisez la page.")
      : reason === "paid" ? t("This order is already paid.", "Cette commande est déjà payée.")
      : reason === "closed" ? t("This payment link is no longer active. Please contact us.", "Ce lien de paiement n'est plus actif. Merci de nous contacter.")
      : t("The payment page could not open. Please try again.", "La page de paiement n'a pas pu s'ouvrir. Merci de réessayer."),
    );
  };

  return (
    <Layout>
      <section className="container mx-auto px-4 sm:px-6 py-16 md:py-24 max-w-xl text-center">
        {(phase === "loading" || phase === "confirming") && (
          <>
            <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-4" />
            <p className="text-muted-foreground">{phase === "confirming" ? t("We are confirming your payment…", "Nous confirmons votre paiement…") : t("Loading…", "Chargement…")}</p>
          </>
        )}

        {phase === "notfound" && (
          <p className="text-foreground">{t("This payment link doesn't exist. Please check the link or contact us.", "Ce lien de paiement n'existe pas. Vérifiez le lien ou contactez-nous.")}</p>
        )}
        {phase === "error" && (
          <p className="text-foreground">{t("The page could not load. Please try again in a moment.", "La page n'a pas pu se charger. Merci de réessayer dans un instant.")}</p>
        )}
        {phase === "slow" && (
          <>
            <p className="text-foreground mb-2">{t("Your payment is still being confirmed.", "Votre paiement est encore en cours de confirmation.")}</p>
            <p className="text-muted-foreground text-sm">{t("No need to pay again: we will confirm your order as soon as it is done.", "Inutile de payer une deuxième fois : nous confirmerons votre commande dès que ce sera fait.")}</p>
          </>
        )}

        {(phase === "ready" || phase === "redirecting") && view && (
          view.state === "paid" ? (
            <>
              <CheckCircle className="w-10 h-10 text-primary mx-auto mb-4" strokeWidth={1.5} />
              <h1 className="font-sans text-2xl md:text-3xl tracking-[0.105em] uppercase font-semibold mb-4">{t("Thank you!", "Merci !")}</h1>
              <p className="text-foreground mb-2">{t(`Order ${view.orderNumber ?? ""} is fully paid.`, `La commande ${view.orderNumber ?? ""} est entièrement payée.`)}</p>
              <p className="text-muted-foreground text-sm">{t("We look forward to seeing you!", "Nous nous réjouissons de vous retrouver !")}</p>
              <Button asChild variant="outline" className="rounded-none mt-8 uppercase tracking-[0.105em]"><Link to="/">{t("Back to the site", "Retour au site")}</Link></Button>
            </>
          ) : view.state !== "open" ? (
            <p className="text-foreground">{t("This payment link is no longer active. Please contact us.", "Ce lien de paiement n'est plus actif. Merci de nous contacter.")}</p>
          ) : (
            <>
              {(failedReturn || voided) && (
                <p className="mb-6 border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm flex items-start gap-2 text-left">
                  <XCircle className="w-4 h-4 mt-0.5 shrink-0 text-destructive" />
                  {t("The payment did not go through. Nothing was charged. You can try again.", "Le paiement n'a pas abouti. Rien n'a été prélevé. Vous pouvez réessayer.")}
                </p>
              )}
              <h1 className="font-sans text-xl md:text-2xl tracking-[0.105em] uppercase font-semibold mb-2">{t("Payment of your order", "Paiement de votre commande")}</h1>
              <p className="text-muted-foreground mb-8">
                {view.firstName ? t(`Hello ${view.firstName}, `, `Bonjour ${view.firstName}, `) : ""}
                {t(`here is the balance of order ${view.orderNumber ?? ""}.`, `voici le solde de la commande ${view.orderNumber ?? ""}.`)}
              </p>
              <div className="border-[3px] border-primary p-1.5 mb-8 text-left">
                <div className="border border-primary px-5 py-4 space-y-1.5 text-sm">
                  <div className="flex justify-between"><span>{t("Order total", "Total de la commande")}</span><span>{chf(view.total)}</span></div>
                  {view.paid > 0 && <div className="flex justify-between text-muted-foreground"><span>{t("Already paid", "Déjà payé")}</span><span>− {chf(view.paid)}</span></div>}
                  <div className="flex justify-between font-semibold text-base border-t border-primary/30 pt-2 mt-2"><span>{t("Remaining balance", "Solde restant")}</span><span>{chf(view.balance)}</span></div>
                </div>
              </div>
              <Button onClick={pay} disabled={phase === "redirecting"} className="rounded-none w-full h-12 uppercase tracking-[0.105em] bg-primary hover:bg-primary/90 text-primary-foreground">
                {phase === "redirecting" && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                {t(`Pay ${chf(view.balance)}`, `Payer ${chf(view.balance)}`)}
              </Button>
              {notice && <p className="mt-4 text-sm text-destructive">{notice}</p>}
              <p className="mt-4 text-xs text-muted-foreground">{t("Secure payment with PostFinance.", "Paiement sécurisé avec PostFinance.")}</p>
            </>
          )
        )}
      </section>
    </Layout>
  );
};

export default PayOrder;
