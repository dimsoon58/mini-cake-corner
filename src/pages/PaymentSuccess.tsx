import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle, Clock, Loader2, Sparkles, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCart } from "@/context/CartContext";
import { firePurchaseOnce } from "@/lib/analytics";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/context/LanguageContext";
import Layout from "@/components/Layout";

// Poll confirm-postfinance-payment until it reaches an authoritative outcome.
// ~4s interval; after this many attempts (~2 min) we stop and show a neutral
// "still verifying" screen — the webhook will finish the order server-side.
const MAX_POLLS = 30;

type Phase = "verifying" | "confirmed" | "failed" | "timeout";

const PaymentSuccess = () => {
  const { t } = useLang();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { clearCart } = useCart();
  // create-postfinance-payment's successUrl is /payment-success?order_id=<orderId>.
  const orderId = searchParams.get("order_id");

  const [phase, setPhase] = useState<Phase>("verifying");
  const [orderValidation, setOrderValidation] = useState<string | null>(null);
  // A workshop seat sold out between checkout and payment confirmation.
  const [capacity, setCapacity] = useState<{ financiallyResolved: boolean } | null>(null);
  const cartClearedRef = useRef(false);
  const pollsRef = useRef(0);
  // After the order is confirmed we keep polling a few more times so that any
  // side-effect (Make webhook / e-mails) that hasn't been delivered yet gets
  // re-fired server-side — belt-and-suspenders alongside the PostFinance
  // webhook's own retries.
  const sideEffectsDoneRef = useRef(false);
  const nudgeRef = useRef(0);
  const MAX_NUDGES = 8;

  // The cart is cleared ONLY once the payment is really confirmed — never
  // merely because this page rendered (a failed / abandoned payment must keep
  // the cart so the customer can retry).
  useEffect(() => {
    if (phase === "confirmed" && !cartClearedRef.current) {
      cartClearedRef.current = true;
      clearCart();
    }
  }, [phase, clearCart]);

  useEffect(() => {
    if (!orderId) {
      setPhase("timeout");
      return;
    }
    if (phase === "failed" || phase === "timeout") return;
    if (phase === "confirmed" && (sideEffectsDoneRef.current || nudgeRef.current >= MAX_NUDGES)) return;
    if (capacity?.financiallyResolved) return;

    const id = orderId;
    let mounted = true;
    let intervalId: ReturnType<typeof setInterval> | undefined;
    const stop = () => { if (intervalId !== undefined) clearInterval(intervalId); };

    const confirm = async () => {
      if (phase === "confirmed") {
        nudgeRef.current += 1;
        if (sideEffectsDoneRef.current || nudgeRef.current > MAX_NUDGES) { stop(); return; }
      } else {
        pollsRef.current += 1;
      }

      const { data, error } = await supabase.functions.invoke("confirm-postfinance-payment", {
        body: { orderId: id },
      });

      if (!mounted) return;

      if (error) {
        console.error("Error confirming payment:", error);
        if (phase !== "confirmed" && pollsRef.current >= MAX_POLLS) setPhase("timeout");
        return;
      }

      if (data?.reason === "workshop_capacity_unavailable") {
        setCapacity({ financiallyResolved: !!data.financiallyResolved });
        stop();
        return;
      }

      if (data?.confirmed === true) {
        firePurchaseOnce(id);
        setOrderValidation(data.orderValidation ?? "pending");
        if (data.sideEffectsComplete !== false) {
          sideEffectsDoneRef.current = true;
          stop();
        }
        setPhase("confirmed");
        return;
      }

      if (data?.failed === true) {
        setPhase("failed");
        stop();
        return;
      }

      // Not confirmed (still finalising / non-terminal state), not failed —
      // keep polling until the cap, then hand off to the server-side webhook.
      if (pollsRef.current >= MAX_POLLS) { setPhase("timeout"); stop(); }
    };

    confirm();
    intervalId = setInterval(confirm, 4000);
    return () => {
      mounted = false;
      stop();
    };
  }, [orderId, phase, capacity]);

  const isOrderApproved = orderValidation === "approved";

  return (
    <Layout>
      <main className="container mx-auto px-4 py-16 max-w-2xl text-center">
        <div className="bg-card shadow-md p-8">
          {capacity ? (
            <>
              <XCircle className="w-16 h-16 text-destructive mx-auto mb-6" />
              <h1 className="text-sm font-sans font-medium uppercase tracking-widest text-foreground mb-4">
                {t("Workshop No Longer Available", "Atelier plus disponible")}
              </h1>
              <p className="text-muted-foreground mb-8">
                {capacity.financiallyResolved
                  ? t(
                      "The remaining seats for this workshop were booked while your payment was being processed. No order was placed and your payment has been cancelled or refunded. Please choose another session.",
                      "Les dernières places de cet atelier ont été réservées pendant le traitement de votre paiement. Aucune commande n'a été enregistrée et votre paiement a été annulé ou remboursé. Merci de choisir une autre session."
                    )
                  : t(
                      "The remaining seats for this workshop were booked while your payment was being processed, so your booking could not be completed. We are finalising the cancellation of your payment now — please contact us if you see a charge.",
                      "Les dernières places de cet atelier ont été réservées pendant le traitement de votre paiement ; votre réservation n'a pas pu aboutir. Nous finalisons l'annulation de votre paiement — contactez-nous si un débit apparaît."
                    )}
              </p>
            </>
          ) : phase === "failed" ? (
            <>
              <XCircle className="w-16 h-16 text-destructive mx-auto mb-6" />
              <h1 className="text-sm font-sans font-medium uppercase tracking-widest text-foreground mb-4">
                {t("Payment Not Completed", "Paiement non abouti")}
              </h1>
              <p className="text-muted-foreground mb-8">
                {t(
                  "Your payment could not be finalised. Your cart has been saved. You can try again.",
                  "Votre paiement n'a pas pu être finalisé. Votre panier a été conservé. Vous pouvez réessayer."
                )}
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center mb-2">
                <Button onClick={() => navigate("/checkout")}>
                  {t("Retry payment", "Réessayer le paiement")}
                </Button>
                <Button variant="outline" asChild>
                  <Link to="/contact">{t("Contact us", "Nous contacter")}</Link>
                </Button>
              </div>
            </>
          ) : phase === "verifying" ? (
            <>
              <Loader2 className="w-16 h-16 text-primary mx-auto mb-6 animate-spin" />
              <h1 className="text-sm font-sans font-medium uppercase tracking-widest text-foreground mb-4">
                {t("Confirming your payment", "Confirmation de votre paiement")}
              </h1>
              <p className="text-muted-foreground mb-8">
                {t(
                  "Please wait a moment while we confirm your payment. Do not close this page.",
                  "Merci de patienter un instant pendant que nous confirmons votre paiement. Ne fermez pas cette page."
                )}
              </p>
            </>
          ) : phase === "timeout" ? (
            <>
              <Clock className="w-16 h-16 text-primary mx-auto mb-6" />
              <h1 className="text-sm font-sans font-medium uppercase tracking-widest text-foreground mb-4">
                {t("Payment is being verified", "Paiement en cours de vérification")}
              </h1>
              <p className="text-muted-foreground mb-8">
                {t(
                  "Your payment is taking a little longer than usual to confirm. You do not need to pay again — we are finalising it and you will receive a confirmation e-mail shortly. Please contact us if you have any doubt.",
                  "La confirmation de votre paiement prend un peu plus de temps que d'habitude. Vous n'avez pas besoin de payer à nouveau — nous le finalisons et vous recevrez un e-mail de confirmation sous peu. Contactez-nous en cas de doute."
                )}
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center mb-2">
                <Button variant="outline" asChild>
                  <Link to="/contact">{t("Contact us", "Nous contacter")}</Link>
                </Button>
              </div>
            </>
          ) : (
            <>
              <CheckCircle className="w-16 h-16 text-primary mx-auto mb-6" />
              <h1 className="text-sm font-sans font-medium uppercase tracking-widest text-foreground mb-4">
                {isOrderApproved
                  ? t("Order Confirmed", "Commande confirmée")
                  : t("Payment received", "Paiement reçu")}
              </h1>

              <p className="text-muted-foreground mb-6">
                {isOrderApproved
                  ? t(
                      "Your order has been successfully placed and your payment has been processed. We are now preparing your order.",
                      "Votre commande a bien été enregistrée et votre paiement a été traité. Nous préparons dès à présent votre commande."
                    )
                  : t(
                      "Your payment has been received. Your order has been received and is now awaiting validation by Bento Cake Studio.",
                      "Votre paiement a bien été pris en compte. Votre commande a été reçue et est maintenant en attente de validation par Bento Cake Studio."
                    )}
              </p>

              <div className="bg-muted border border-border p-4 mb-6">
                <div className="flex items-center justify-center gap-2 mb-2">
                  {isOrderApproved ? (
                    <Sparkles className="w-5 h-5 text-primary" />
                  ) : (
                    <Clock className="w-5 h-5 text-primary" />
                  )}
                  <p className="font-medium text-foreground">
                    {isOrderApproved
                      ? t("Preparing Your Order", "Préparation de votre commande")
                      : t("Order Pending Approval", "Commande en attente de confirmation")}
                  </p>
                </div>
                <p className="text-sm text-muted-foreground">
                  {isOrderApproved
                    ? t(
                        "We're excited to create something special for you!",
                        "Nous avons hâte de créer quelque chose de spécial rien que pour vous !"
                      )
                    : t(
                        "Your payment has been authorized but will only be charged once we confirm your order. You will receive a confirmation message within the next 24 hours with the details of your pickup or delivery date and time.",
                        "Votre paiement a été autorisé, mais ne sera débité qu'une fois votre commande confirmée. Vous recevrez un message de confirmation dans les 24 heures, précisant la date et l'heure de votre retrait ou de votre livraison."
                      )}
                </p>
              </div>

              <p className="text-muted-foreground mb-8">
                {t("You may close this page.", "Vous pouvez fermer cette page.")}
              </p>
            </>
          )}

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button asChild>
              <Link to="/">{t("Back to Home", "Retour à l'accueil")}</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/catalog">{t("New Order", "Nouvelle commande")}</Link>
            </Button>
          </div>
        </div>
      </main>
    </Layout>
  );
};

export default PaymentSuccess;
