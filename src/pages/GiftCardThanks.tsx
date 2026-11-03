import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle, Gift, Loader2, XCircle } from "lucide-react";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/context/LanguageContext";

// F37 (03.11.2026) — PostFinance success URL of a gift card
// (/bon-cadeau/merci?gc=<id>). Polls confirm-gift-card-payment for up to
// ~40 s: the capture is immediate but PostFinance can take a few seconds to
// say COMPLETED. The code itself is never shown here — it is in the email.

type State =
  | { kind: "checking" }
  | { kind: "active"; amount: number | null; email: string | null; emailSent: boolean }
  | { kind: "failed" }
  | { kind: "slow" }
  | { kind: "error" };

const POLL_MS = 2500;
const MAX_TRIES = 16;

const GiftCardThanks = () => {
  const { t } = useLang();
  const [params] = useSearchParams();
  const id = params.get("gc") ?? "";
  const [state, setState] = useState<State>({ kind: "checking" });

  useEffect(() => {
    if (!id) { setState({ kind: "error" }); return; }
    let alive = true;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      tries += 1;
      try {
        const { data, error } = await supabase.functions.invoke("confirm-gift-card-payment", { body: { id } });
        if (!alive) return;
        if (error || data?.error) throw new Error("check failed");
        if (data.status === "active" && (data.emailSent || tries >= MAX_TRIES)) {
          setState({ kind: "active", amount: data.amount ?? null, email: data.email ?? null, emailSent: !!data.emailSent });
          return;
        }
        if (data.status === "failed") { setState({ kind: "failed" }); return; }
      } catch {
        if (!alive) return;
        if (tries >= MAX_TRIES) { setState({ kind: "error" }); return; }
      }
      if (tries >= MAX_TRIES) { setState({ kind: "slow" }); return; }
      timer = setTimeout(check, POLL_MS);
    };
    void check();
    return () => { alive = false; clearTimeout(timer); };
  }, [id]);

  const amount = state.kind === "active" && state.amount !== null
    ? (Number.isInteger(state.amount) ? `CHF ${state.amount}` : `CHF ${state.amount.toFixed(2)}`)
    : null;

  return (
    <Layout>
      <section className="container mx-auto px-4 sm:px-6 py-16 md:py-24 max-w-xl text-center">
        {state.kind === "checking" && (
          <>
            <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-4" />
            <p className="text-muted-foreground">{t("We are confirming your payment…", "Nous confirmons votre paiement…")}</p>
          </>
        )}

        {state.kind === "active" && (
          <>
            <CheckCircle className="w-10 h-10 text-primary mx-auto mb-4" strokeWidth={1.5} />
            <h1 className="font-sans text-2xl md:text-3xl tracking-[0.105em] uppercase font-semibold mb-4">{t("Thank you!", "Merci !")}</h1>
            <p className="text-foreground mb-2">
              {amount
                ? t(`Your ${amount} gift card is paid.`, `Votre bon cadeau de ${amount} est payé.`)
                : t("Your gift card is paid.", "Votre bon cadeau est payé.")}
            </p>
            <p className="text-muted-foreground text-sm">
              {state.emailSent
                ? t(`It has been sent by email${state.email ? ` to ${state.email}` : ""}, as a PDF to print or forward. Remember to check your spam folder.`,
                    `Il vient d'être envoyé par email${state.email ? ` à ${state.email}` : ""}, en PDF à imprimer ou à transmettre. Pensez à vérifier vos spams.`)
                : t("You will receive it by email in a few minutes. If it doesn't arrive, contact us — your gift card is safely recorded.",
                    "Vous le recevrez par email dans quelques minutes. S'il n'arrive pas, contactez-nous : votre bon cadeau est bien enregistré.")}
            </p>
            <Button asChild variant="outline" className="rounded-none mt-8 uppercase tracking-[0.105em]">
              <Link to="/">{t("Back to the site", "Retour au site")}</Link>
            </Button>
          </>
        )}

        {state.kind === "slow" && (
          <>
            <Gift className="w-10 h-10 text-primary mx-auto mb-4" strokeWidth={1.5} />
            <p className="text-foreground mb-2">{t("Your payment is still being confirmed.", "Votre paiement est encore en cours de confirmation.")}</p>
            <p className="text-muted-foreground text-sm">
              {t("You will receive your gift card by email as soon as it is confirmed. No need to pay again.", "Vous recevrez votre bon cadeau par email dès qu'il sera confirmé. Inutile de payer une deuxième fois.")}
            </p>
          </>
        )}

        {state.kind === "failed" && (
          <>
            <XCircle className="w-10 h-10 text-destructive mx-auto mb-4" strokeWidth={1.5} />
            <p className="text-foreground mb-6">{t("The payment did not go through. Nothing was charged.", "Le paiement n'a pas abouti. Rien n'a été prélevé.")}</p>
            <Button asChild className="rounded-none uppercase tracking-[0.105em]">
              <Link to="/bon-cadeau">{t("Try again", "Réessayer")}</Link>
            </Button>
          </>
        )}

        {state.kind === "error" && (
          <>
            <Gift className="w-10 h-10 text-primary mx-auto mb-4" strokeWidth={1.5} />
            <p className="text-foreground mb-2">{t("We couldn't check your payment from this page.", "Nous n'avons pas pu vérifier votre paiement depuis cette page.")}</p>
            <p className="text-muted-foreground text-sm">
              {t("If you paid, your gift card will arrive by email. Otherwise, contact us.", "Si vous avez payé, votre bon cadeau arrivera par email. Sinon, contactez-nous.")}
            </p>
          </>
        )}
      </section>
    </Layout>
  );
};

export default GiftCardThanks;
