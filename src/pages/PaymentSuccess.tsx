import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle, Clock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCart } from "@/context/CartContext";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/context/LanguageContext";
import Layout from "@/components/Layout";

const PaymentSuccess = () => {
  const { t } = useLang();
  const [searchParams] = useSearchParams();
  const { clearCart } = useCart();
  const orderId = searchParams.get("order_id");
  const [processed, setProcessed] = useState(false);
  const [orderCreated, setOrderCreated] = useState(false);
  const [orderValidation, setOrderValidation] = useState<string | null>(null);
  const [paymentFailed, setPaymentFailed] = useState(false);

  const MAX_CONFIRM_ATTEMPTS = 5;
  const CONFIRM_RETRY_DELAY_MS = 3000;

  // On landing here, confirm the PostFinance authorization server-side —
  // never trust the redirect alone. orders/order_items are only created by
  // confirm-postfinance-payment once it has verified the real transaction
  // state with PostFinance. A few retries cover the rare case where the
  // browser lands here slightly before PostFinance's own state settles.
  useEffect(() => {
    if (!orderId || processed) return;
    let cancelled = false;

    const confirmPayment = async (attempt: number) => {
      try {
        const { data, error } = await supabase.functions.invoke("confirm-postfinance-payment", {
          body: { orderId },
        });

        if (cancelled) return;

        if (error || data?.error) {
          console.error("Confirm payment error:", error || data?.error);
          clearCart();
          setProcessed(true);
          return;
        }

        if (data?.confirmed) {
          setOrderCreated(true);
          setOrderValidation(data.orderValidation);

          if (data.justCreated) {
            await supabase.functions.invoke("notify-order", { body: { orderId } });
            // Fire Make webhook silently in the background
            supabase.functions.invoke("send-make-webhook", { body: { orderId } })
              .catch((err) => console.warn("Make webhook failed (silent):", err));
          }

          clearCart();
          setProcessed(true);
          return;
        }

        if (data?.failed) {
          setPaymentFailed(true);
          clearCart();
          setProcessed(true);
          return;
        }

        // Still processing on PostFinance's side — retry a few times.
        if (attempt < MAX_CONFIRM_ATTEMPTS) {
          setTimeout(() => { if (!cancelled) confirmPayment(attempt + 1); }, CONFIRM_RETRY_DELAY_MS);
        } else {
          clearCart();
          setProcessed(true);
        }
      } catch (err) {
        console.error("Error confirming payment:", err);
        if (!cancelled) {
          clearCart();
          setProcessed(true);
        }
      }
    };

    confirmPayment(0);

    return () => { cancelled = true; };
  }, [orderId, clearCart, processed]);

  // Poll until the team has approved or rejected the order, once it
  // actually exists. payment_status (authorized vs captured vs voided) is
  // handled server-side and never read or written from here.
  useEffect(() => {
    if (!orderId || !orderCreated || orderValidation === "approved" || orderValidation === "rejected") return;

    let mounted = true;

    const refreshOrderValidation = async () => {
      const { data } = await supabase.rpc("get_order_validation", { target_order_id: orderId });
      if (mounted && data) {
        setOrderValidation(data);
      }
    };

    refreshOrderValidation();
    const intervalId = setInterval(refreshOrderValidation, 5000);

    return () => {
      mounted = false;
      clearInterval(intervalId);
    };
  }, [orderId, orderCreated, orderValidation]);

  const isOrderConfirmed = orderValidation === "approved";
  const isOrderRejected = orderValidation === "rejected";

  return (
    <Layout>
      <main className="container mx-auto px-4 py-16 max-w-2xl text-center">
        <div className="bg-card rounded-lg shadow-md p-8">
          <CheckCircle className="w-16 h-16 text-primary mx-auto mb-6" />

          {paymentFailed ? (
            <>
              <h1 className="text-2xl font-serif text-foreground mb-4">
                {t("Payment Unsuccessful", "Paiement non abouti")}
              </h1>

              <p className="text-muted-foreground mb-8">
                {t(
                  "Your payment could not be completed, so no order was placed and you have not been charged.",
                  "Votre paiement n'a pas pu être finalisé, aucune commande n'a donc été enregistrée et vous n'avez pas été débité."
                )}
                <br /><br />
                {t("You can try again from your cart.", "Vous pouvez réessayer depuis votre panier.")}
              </p>
            </>
          ) : isOrderConfirmed ? (
            <>
              <h1 className="text-2xl font-serif text-foreground mb-4">
                {t("Order Confirmed ✅", "Commande confirmée ✅")}
              </h1>
              
              <p className="text-muted-foreground mb-8">
                {t(
                  "Your order has been successfully placed and your payment has been processed.",
                  "Votre commande a bien été enregistrée et votre paiement a été traité."
                )}
                <br /><br />
                {t("We are now preparing your order.", "Nous préparons dès à présent votre commande.")}
                <br /><br />
                {t("You may close this page.", "Vous pouvez fermer cette page.")}
              </p>

              <div className="bg-secondary border border-border rounded-lg p-4 mb-6">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Sparkles className="w-5 h-5 text-primary" />
                  <p className="font-medium text-foreground">{t("Preparing Your Order", "Préparation de votre commande")}</p>
                </div>
                <p className="text-sm text-muted-foreground">
                  {t(
                    "We're excited to create something special for you!",
                    "Nous avons hâte de créer quelque chose de spécial rien que pour vous !"
                  )}
                </p>
              </div>
            </>
          ) : isOrderRejected ? (
            <>
              <h1 className="text-2xl font-serif text-foreground mb-4">
                {t("Order Declined", "Commande refusée")}
              </h1>

              <p className="text-muted-foreground mb-8">
                {t(
                  "We're sorry, we're unable to fulfil this order. Your payment authorization has been cancelled and you have not been charged.",
                  "Nous sommes désolés, nous ne pouvons pas honorer cette commande. L'autorisation de paiement a été annulée et vous n'avez pas été débité."
                )}
                <br /><br />
                {t("Please contact us if you have any questions.", "N'hésitez pas à nous contacter si vous avez des questions.")}
              </p>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-serif text-foreground mb-4">
                {t(
                  "Thank you so much for ordering from Bento Cake Studio! 🤍",
                  "Un grand merci pour votre commande chez Bento Cake Studio ! 🤍"
                )}
              </h1>
              
              <p className="text-muted-foreground mb-6">
                {t(
                  "We truly appreciate your support and are so excited to create something special just for you.",
                  "Nous vous remercions sincèrement de votre confiance et sommes ravis de créer quelque chose de spécial rien que pour vous."
                )}
              </p>

              <div className="bg-muted border border-border rounded-lg p-4 mb-6">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Clock className="w-5 h-5 text-primary" />
                  <p className="font-medium text-foreground">{t("Order Pending Approval", "Commande en attente de confirmation")}</p>
                </div>
                <p className="text-sm text-muted-foreground">
                  {t(
                    "Your payment has been authorized but will only be charged once we confirm your order. You will receive a confirmation message within the next 24 hours with the details of your pickup or delivery date and time.",
                    "Votre paiement a été autorisé, mais ne sera débité qu'une fois votre commande confirmée. Vous recevrez un message de confirmation dans les 24 heures, précisant la date et l'heure de votre retrait ou de votre livraison."
                  )}
                </p>
              </div>

              <p className="text-muted-foreground mb-8">
                {t(
                  "We can't wait for you to enjoy your cake! 🎂✨",
                  "Nous avons hâte que vous savouriez votre gâteau ! 🎂✨"
                )}
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
