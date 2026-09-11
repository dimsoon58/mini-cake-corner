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

type OrderInfo = {
  fulfillmentType: string | null;
  workshopConfirmed: boolean;
  physicalValidation: string | null;
  orderValidation: string | null;
  orderFailureReason: string | null;
};

const PaymentSuccess = () => {
  const { t } = useLang();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { clearCart } = useCart();
  // create-postfinance-payment's successUrl is /payment-success?order_id=<orderId>.
  const orderId = searchParams.get("order_id");

  const [phase, setPhase] = useState<Phase>("verifying");
  const [info, setInfo] = useState<OrderInfo | null>(null);
  // A workshop seat sold out between checkout and payment confirmation. Three
  // truthful situations:
  //   rewardOnly                    -> no money was ever taken
  //   refundState === 'to_refund'   -> money received, refund still to process
  //   refundState === 'refunded'    -> money received, refund already done
  const [capacity, setCapacity] = useState<{ rewardOnly: boolean; refundState: string } | null>(null);
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
    if (capacity) return;

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
        const rewardOnly = !!data.rewardOnly;
        const refundState: string = data.refundState
          ?? (data.refundResolved || data.financiallyResolved ? "refunded" : "to_refund");
        setCapacity({ rewardOnly, refundState });
        stop();
        return;
      }

      if (data?.confirmed === true) {
        firePurchaseOnce(id);
        setInfo({
          fulfillmentType: data.fulfillmentType ?? null,
          workshopConfirmed: !!data.workshopConfirmed,
          physicalValidation: data.physicalValidation ?? null,
          orderValidation: data.orderValidation ?? "pending",
          orderFailureReason: data.orderFailureReason ?? null,
        });
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

  // ── Confirmed-screen wording, by order shape ──────────────────────────
  // cake_only     : payment taken, order awaiting validation.
  // workshop_only : payment taken, workshop auto-confirmed.
  // mixed         : payment taken, workshop confirmed, physical part awaiting
  //                 validation.
  // A capacity abort persisted order_validation='cancelled' — treated in its
  // own branch below, never here.
  const ft = info?.fulfillmentType;
  const workshopConfirmed = !!info?.workshopConfirmed;
  const isWorkshopOnly = ft === "workshop_only";
  const isMixed = ft === "mixed";
  // "fully done, nothing pending" = workshop-only (auto-confirmed) OR a cake/
  // mixed order the admin already approved.
  const nothingPending = isWorkshopOnly
    ? workshopConfirmed
    : info?.physicalValidation === "approved";

  const headline = nothingPending
    ? t("Order Confirmed", "Commande confirmée")
    : t("Payment received", "Paiement reçu");

  let bodyText: string;
  let panelTitle: string;
  let panelText: string;
  if (isWorkshopOnly) {
    bodyText = t(
      "Your payment has been received and your workshop booking is confirmed automatically.",
      "Votre paiement a bien été reçu et votre réservation d'atelier est confirmée automatiquement.",
    );
    panelTitle = t("Workshop confirmed", "Atelier confirmé");
    panelText = t(
      "You will receive a confirmation e-mail with the date, time and practical details of your workshop.",
      "Vous recevrez un e-mail de confirmation avec la date, l'heure et les informations pratiques de votre atelier.",
    );
  } else if (isMixed) {
    bodyText = t(
      "Your payment has been received. Your workshop place is confirmed. The cake / products part of your order is now awaiting validation by Bento Cake Studio.",
      "Votre paiement a bien été reçu. Votre place d'atelier est confirmée. La partie gâteau / produits de votre commande est maintenant en attente de validation par Bento Cake Studio.",
    );
    panelTitle = info?.physicalValidation === "approved"
      ? t("Order confirmed", "Commande confirmée")
      : t("Cake part pending approval", "Partie gâteau en attente de validation");
    panelText = info?.physicalValidation === "approved"
      ? t("We're excited to create something special for you!", "Nous avons hâte de créer quelque chose de spécial rien que pour vous !")
      : t(
          "Your workshop is confirmed and paid. We will review the cake / products part and send you a confirmation within the next 24 hours.",
          "Votre atelier est confirmé et payé. Nous examinons la partie gâteau / produits et vous enverrons une confirmation dans les 24 heures.",
        );
  } else {
    // cake_only
    bodyText = nothingPending
      ? t(
          "Your order has been placed and your payment has been received. We are now preparing your order.",
          "Votre commande a bien été enregistrée et votre paiement a bien été reçu. Nous préparons dès à présent votre commande.",
        )
      : t(
          "Your payment has been received. Your order is now awaiting validation by Bento Cake Studio.",
          "Votre paiement a bien été reçu. Votre commande est maintenant en attente de validation par Bento Cake Studio.",
        );
    panelTitle = nothingPending
      ? t("Preparing Your Order", "Préparation de votre commande")
      : t("Order Pending Approval", "Commande en attente de validation");
    panelText = nothingPending
      ? t("We're excited to create something special for you!", "Nous avons hâte de créer quelque chose de spécial rien que pour vous !")
      : t(
          "Your payment has been received. We will confirm your order within the next 24 hours with the details of your pickup or delivery date and time. If we cannot fulfil it, you will be refunded.",
          "Votre paiement a bien été reçu. Nous vous confirmerons votre commande dans les 24 heures, en précisant la date et l'heure de votre retrait ou de votre livraison. Si nous ne pouvons pas la réaliser, vous serez remboursé.",
        );
  }

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
                {capacity.rewardOnly
                  ? t(
                      "The remaining seats for this workshop were booked while your payment was being processed. No order was placed and nothing was charged (your reward balance has been released). Please choose another session.",
                      "Les dernières places de cet atelier ont été réservées pendant le traitement de votre paiement. Aucune commande n'a été enregistrée et aucun montant n'a été prélevé (votre cagnotte a été libérée). Merci de choisir une autre session."
                    )
                  : capacity.refundState === "refunded"
                  ? t(
                      "The remaining seats for this workshop were booked while your payment was being processed, so your order could not be fulfilled. Your payment was received and has already been refunded. Please contact us if you have any question.",
                      "Les dernières places de cet atelier ont été réservées pendant le traitement de votre paiement ; votre commande n'a donc pas pu aboutir. Votre paiement a bien été reçu et a déjà été remboursé. Contactez-nous pour toute question."
                    )
                  : t(
                      "The remaining seats for this workshop were booked while your payment was being processed, so your order could not be fulfilled. Your payment has been received and a refund is being processed by our team — you do not need to do anything. Please contact us if you have any question.",
                      "Les dernières places de cet atelier ont été réservées pendant le traitement de votre paiement ; votre commande n'a donc pas pu aboutir. Votre paiement a bien été reçu et un remboursement est en cours de traitement par notre équipe — vous n'avez rien à faire. Contactez-nous pour toute question."
                    )}
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center mb-2">
                <Button variant="outline" asChild>
                  <Link to="/contact">{t("Contact us", "Nous contacter")}</Link>
                </Button>
              </div>
            </>
          ) : phase === "failed" ? (
            <>
              <XCircle className="w-16 h-16 text-destructive mx-auto mb-6" />
              <h1 className="text-sm font-sans font-medium uppercase tracking-widest text-foreground mb-4">
                {t("Payment Not Completed", "Paiement non abouti")}
              </h1>
              <p className="text-muted-foreground mb-8">
                {t(
                  "Your payment could not be finalised and nothing was charged. Your cart has been saved. You can try again.",
                  "Votre paiement n'a pas pu être finalisé et aucun montant n'a été prélevé. Votre panier a été conservé. Vous pouvez réessayer."
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
          ) : isMixed ? (
            // Dedicated mixed-cart (workshop + cake/products) confirmation
            // screen — two separate status blocks so the customer sees at a
            // glance that the workshop is settled and only the physical part
            // is still being reviewed. Same t() / useLang() system as the
            // rest of the site; no new i18n mechanism.
            <>
              <CheckCircle className="w-16 h-16 text-primary mx-auto mb-6" />
              <h1 className="text-sm font-sans font-medium uppercase tracking-widest text-foreground mb-2">
                {t("THANK YOU FOR YOUR ORDER", "MERCI POUR VOTRE COMMANDE")}
              </h1>
              <p className="text-muted-foreground mb-6">{t("Payment received", "Paiement reçu")}</p>

              <div className="bg-muted border border-border p-4 mb-4 text-left">
                <div className="flex items-center gap-2 mb-1">
                  <Sparkles className="w-5 h-5 text-primary shrink-0" />
                  <p className="font-medium text-foreground">{t("Workshop confirmed", "Atelier confirmé")}</p>
                </div>
                <p className="text-sm text-muted-foreground">
                  {t("Your workshop booking is confirmed.", "Votre réservation à l'atelier est confirmée.")}
                </p>
              </div>

              <div className="bg-muted border border-border p-4 mb-6 text-left">
                <div className="flex items-center gap-2 mb-1">
                  <Clock className="w-5 h-5 text-primary shrink-0" />
                  <p className="font-medium text-foreground">
                    {t("Cake and other products pending approval", "Gâteau et autres produits en cours de validation")}
                  </p>
                </div>
                <p className="text-sm text-muted-foreground">
                  {t("We are currently reviewing this part of your order.", "Nous vérifions actuellement cette partie de votre commande.")}
                </p>
              </div>

              <p className="text-muted-foreground mb-8">
                {t("You will receive a confirmation email within 24 hours.", "Vous recevrez un email de confirmation dans les 24 heures.")}
              </p>
            </>
          ) : (
            <>
              <CheckCircle className="w-16 h-16 text-primary mx-auto mb-6" />
              <h1 className="text-sm font-sans font-medium uppercase tracking-widest text-foreground mb-4">
                {headline}
              </h1>

              <p className="text-muted-foreground mb-6">{bodyText}</p>

              <div className="bg-muted border border-border p-4 mb-6">
                <div className="flex items-center justify-center gap-2 mb-2">
                  {nothingPending ? (
                    <Sparkles className="w-5 h-5 text-primary" />
                  ) : (
                    <Clock className="w-5 h-5 text-primary" />
                  )}
                  <p className="font-medium text-foreground">{panelTitle}</p>
                </div>
                <p className="text-sm text-muted-foreground">{panelText}</p>
              </div>

              <p className="text-muted-foreground mb-8">
                {t("You may close this page.", "Vous pouvez fermer cette page.")}
              </p>
            </>
          )}

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button asChild>
              <Link to="/">
                {phase === "confirmed" && !capacity && isMixed
                  ? t("BACK TO HOME", "RETOUR À L'ACCUEIL")
                  : t("Back to Home", "Retour à l'accueil")}
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/catalog">
                {phase === "confirmed" && !capacity && isMixed
                  ? t("CONTINUE SHOPPING", "CONTINUER MES ACHATS")
                  : t("New Order", "Nouvelle commande")}
              </Link>
            </Button>
          </div>
        </div>
      </main>
    </Layout>
  );
};

export default PaymentSuccess;
