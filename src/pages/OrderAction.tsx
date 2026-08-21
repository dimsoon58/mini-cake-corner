import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CheckCircle, XCircle, Loader2, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/context/LanguageContext";

const OrderAction = () => {
  const { t } = useLang();
  const [searchParams] = useSearchParams();
  const orderId = searchParams.get("orderId");
  const action = searchParams.get("action");
  const token = searchParams.get("token");

  const isValidAction = action === "approve" || action === "reject" || action === "decline";
  const isDecline = action === "reject" || action === "decline";

  // "idle" = waiting for an explicit click on the confirm button below.
  // Simply loading this page — including automated link scanners that
  // pre-fetch links found in the notification email (Outlook Safe Links,
  // Gmail, corporate mail filters, etc.) — must never by itself capture,
  // void, or refund a payment. Only a real click on the button calls
  // manage-order.
  const [status, setStatus] = useState<"idle" | "invalid" | "loading" | "success" | "error">(
    !orderId || !action || !token || !isValidAction ? "invalid" : "idle"
  );
  const [message, setMessage] = useState(() => {
    if (!orderId || !action || !token) {
      return t("Missing required parameters. Please use the link from the notification email.", "Paramètres requis manquants. Veuillez utiliser le lien reçu dans l'e-mail de notification.");
    }
    if (!isValidAction) {
      return t("Invalid action. Must be 'approve', 'reject', or 'decline'.", "Action invalide. Elle doit être « approve », « reject » ou « decline ».");
    }
    return "";
  });

  useEffect(() => {
    if (!orderId || !action || !token) {
      setStatus("invalid");
      setMessage(t("Missing required parameters. Please use the link from the notification email.", "Paramètres requis manquants. Veuillez utiliser le lien reçu dans l'e-mail de notification."));
      return;
    }

    if (!isValidAction) {
      setStatus("invalid");
      setMessage(t("Invalid action. Must be 'approve', 'reject', or 'decline'.", "Action invalide. Elle doit être « approve », « reject » ou « decline »."));
    }
    // Otherwise: stay "idle" and wait for the admin to click the
    // confirmation button — nothing is called automatically here.
  }, [orderId, action, token, isValidAction, t]);

  const execute = async () => {
    setStatus("loading");
    try {
      const { data, error } = await supabase.functions.invoke("manage-order", {
        body: { orderId, action, token },
      });

      if (error) {
        setStatus("error");
        setMessage(error.message || t("An error occurred.", "Une erreur est survenue."));
        return;
      }

      if (data?.error) {
        setStatus("error");
        setMessage(data.error);
        return;
      }

      setStatus("success");
      setMessage(
        isDecline
          ? t("Order declined. Payment has been refunded and the customer has been notified.", "Commande refusée. Le paiement a été remboursé et le client a été informé.")
          : t("Order approved! Payment has been captured and a calendar event has been created.", "Commande approuvée ! Le paiement a été capturé et un événement a été ajouté au calendrier.")
      );
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : t("Unknown error occurred.", "Une erreur inconnue est survenue."));
    }
  };

  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl shadow-lg p-8 max-w-md w-full text-center space-y-6">
        <div className="flex justify-center">
          <div className="w-20 h-20 rounded-full flex items-center justify-center" style={{
            background: status === "idle" ? "#f3f4f6" :
              status === "loading" ? "#f3f4f6" :
              status === "success" && !isDecline ? "#d1fae5" :
              status === "success" && isDecline ? "#fef2f2" :
              "#fef3c7"
          }}>
            {status === "idle" && (isDecline
              ? <XCircle className="w-10 h-10 text-red-600" />
              : <CheckCircle className="w-10 h-10 text-emerald-600" />)}
            {status === "loading" && <Loader2 className="w-10 h-10 animate-spin text-muted-foreground" />}
            {status === "success" && !isDecline && <CheckCircle className="w-10 h-10 text-emerald-600" />}
            {status === "success" && isDecline && <XCircle className="w-10 h-10 text-red-600" />}
            {(status === "error" || status === "invalid") && <AlertTriangle className="w-10 h-10 text-amber-600" />}
          </div>
        </div>

        <h1 className="text-2xl font-serif text-foreground">
          {status === "idle" && (isDecline
            ? t("Decline this order?", "Refuser cette commande ?")
            : t("Approve this order?", "Approuver cette commande ?"))}
          {status === "loading" && t("Processing...", "Traitement en cours...")}
          {status === "success" && !isDecline && t("Order Confirmed ✅", "Commande confirmée ✅")}
          {status === "success" && isDecline && t("Order Declined ❌", "Commande refusée ❌")}
          {(status === "error" || status === "invalid") && t("Action Failed", "Échec de l'action")}
        </h1>

        {status === "idle" && (
          <div className="space-y-4">
            <p className="text-muted-foreground text-sm leading-relaxed">
              {t("Please confirm this action. Nothing happens until you click the button below.", "Merci de confirmer cette action. Rien ne se passe tant que vous n'avez pas cliqué sur le bouton ci-dessous.")}
            </p>
            <button
              onClick={execute}
              className={
                isDecline
                  ? "w-full rounded-lg bg-red-600 text-white font-medium py-3 px-6 hover:bg-red-700 transition-colors"
                  : "w-full rounded-lg bg-emerald-600 text-white font-medium py-3 px-6 hover:bg-emerald-700 transition-colors"
              }
            >
              {isDecline ? t("Confirm decline", "Confirmer le refus") : t("Confirm approval", "Confirmer l'acceptation")}
            </button>
          </div>
        )}

        {status === "success" && !isDecline ? (
          <div className="space-y-4">
            <p className="text-muted-foreground text-sm leading-relaxed">
              {t("Your order has been successfully placed and your payment has been processed.", "Votre commande a bien été enregistrée et votre paiement a été traité.")}
            </p>
            <p className="text-muted-foreground text-sm leading-relaxed">
              {t("We are now preparing your order.", "Nous préparons désormais votre commande.")}
            </p>
            <p className="text-muted-foreground text-sm leading-relaxed">
              {t("You may close this page.", "Vous pouvez fermer cette page.")}
            </p>
          </div>
        ) : status !== "idle" ? (
          <>
            <p className="text-muted-foreground text-sm leading-relaxed">{message}</p>
            {status === "success" && (
              <p className="text-xs text-muted-foreground">{t("You can close this page.", "Vous pouvez fermer cette page.")}</p>
            )}
          </>
        ) : null}

        <div className="pt-4 border-t border-border">
          <p className="text-xs text-muted-foreground">Bento Cake Studio · {t("Order Management", "Gestion des commandes")}</p>
        </div>
      </div>
    </div>
  );
};

export default OrderAction;
