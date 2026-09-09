import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ExternalLink, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/context/LanguageContext";

interface EmbeddedCheckoutProps {
  payload: {
    orderId: string;
    order: Record<string, unknown>;
    orderItems: Record<string, unknown>[];
    items: Array<{
      sizeName: string;
      shapeName: string;
      flavorName: string;
      styleName?: string;
      extrasNames: string[];
      total: number;
    }>;
    customerEmail: string;
    customerName: string;
    customerPhone: string;
    deliveryOption: string;
    deliveryAddress?: string;
    // Google place id of the selected address — the only delivery value the
    // backend trusts (it re-resolves address + driving distance + fee).
    deliveryPlaceId?: string;
    deliveryFee: number;
    totalAmount: number;
    // Intent only — create-postfinance-payment independently verifies
    // eligibility and computes the real discount amount server-side.
    useWelcomeDiscount?: boolean;
  };
  onComplete?: () => void;
  // Ask the parent (Checkout) to rebuild a fresh checkout with a NEW orderId —
  // used when the previous PostFinance transaction is confirmed FAILED /
  // DECLINE / VOIDED, or when the server proved no transaction was created.
  onRequestNewOrder?: () => void;
}

type UiState =
  | { kind: "loading" }
  | { kind: "ready"; url: string }
  | { kind: "error"; message: string }
  // Same orderId — the server is still resolving a previous attempt.
  | { kind: "in_progress"; message: string }
  // The previous attempt is dead — a brand-new checkout is required.
  | { kind: "restart"; message: string };

// create-postfinance-payment always returns a hosted PostFinance
// payment-page URL for a fresh checkout. On a retry (same orderId) it may
// instead resolve an existing transaction — this component handles every
// resolved shape without ever silently creating a second transaction.
export const PostFinanceCheckout = ({ payload, onRequestNewOrder }: EmbeddedCheckoutProps) => {
  const { t } = useLang();
  const navigate = useNavigate();
  const [state, setState] = useState<UiState>({ kind: "loading" });
  // Bumped by the "Try again" button — re-runs the call for the SAME payload
  // (same orderId), which is exactly the class-C timeout retry path.
  const [attempt, setAttempt] = useState(0);

  const run = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const { data, error } = await supabase.functions.invoke("create-postfinance-payment", {
        body: payload,
      });

      if (error) {
        let message = error.message;
        try {
          const body = await (error as { context?: Response }).context?.json();
          if (body?.error) message = body.error;
        } catch {
          /* keep the generic message */
        }
        setState({ kind: "error", message });
        return;
      }

      // Resolved an already-authorised / already-confirmed transaction.
      if (data?.status === "authorized" || data?.status === "already_confirmed") {
        navigate(`/payment-success?order_id=${encodeURIComponent(payload.orderId)}`);
        return;
      }

      // Same orderId, server still resolving — offer a manual re-check.
      if (data?.status === "in_progress") {
        setState({
          kind: "in_progress",
          message: data.message
            ?? t(
              "We're still checking your payment. Please wait a moment and try again.",
              "Nous vérifions encore votre paiement. Merci de patienter un instant puis de réessayer.",
            ),
        });
        return;
      }

      // Previous attempt is dead — the parent must rebuild with a new orderId.
      if (data?.status === "restart_checkout" || data?.retryWithNewOrder === true) {
        setState({
          kind: "restart",
          message: data.message
            ?? t(
              "Your previous payment did not go through. Your cart has been saved — please try again.",
              "Votre paiement précédent n'a pas abouti. Votre panier a été conservé, merci de réessayer.",
            ),
        });
        return;
      }

      if (data?.paymentPageUrl) {
        setState({ kind: "ready", url: data.paymentPageUrl });
        return;
      }

      setState({
        kind: "error",
        message: t("Could not create the payment session.", "Impossible de créer la session de paiement."),
      });
    } catch (err) {
      console.error("Error creating payment session:", err);
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : t("Unknown error", "Erreur inconnue"),
      });
    }
  }, [payload, navigate, t]);

  // Guards against React 18 strict-mode's double effect invocation creating
  // two "first" calls for the same orderId. Explicit retries bump `attempt`
  // and are keyed separately.
  const lastRunKey = useRef<string>("");
  useEffect(() => {
    const key = `${payload.orderId}#${attempt}`;
    if (lastRunKey.current === key) return;
    lastRunKey.current = key;
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload, attempt]);

  const retrySameOrder = () => setAttempt((n) => n + 1);

  if (state.kind === "error" || state.kind === "in_progress") {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3 text-center">
        <p className={`text-sm ${state.kind === "error" ? "text-destructive" : "text-muted-foreground"}`}>
          {state.message}
        </p>
        <div className="flex flex-col sm:flex-row gap-2 justify-center">
          <Button onClick={retrySameOrder} size="sm" variant="outline">
            <RefreshCw className="w-4 h-4 mr-2" />
            {t("Try again", "Réessayer")}
          </Button>
          {onRequestNewOrder && (
            <Button onClick={onRequestNewOrder} size="sm" variant="ghost">
              {t("Start over", "Recommencer")}
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (state.kind === "restart") {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3 text-center">
        <p className="text-sm text-muted-foreground">{state.message}</p>
        <Button onClick={onRequestNewOrder ?? retrySameOrder} size="sm">
          <RefreshCw className="w-4 h-4 mr-2" />
          {t("Retry payment", "Réessayer le paiement")}
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-6 text-center space-y-4">
      <p className="text-sm text-muted-foreground">
        {t(
          "Payment opens in a new tab to ensure compatibility with all payment methods (TWINT, etc.).",
          "Le paiement s'ouvre dans un nouvel onglet pour assurer la compatibilité avec tous les moyens de paiement (TWINT, etc.).",
        )}
      </p>
      {state.kind === "ready" ? (
        <Button asChild size="lg" className="w-full">
          <a href={state.url} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="w-4 h-4 mr-2" />
            {t("Open Payment Page", "Ouvrir la page de paiement")}
          </a>
        </Button>
      ) : (
        <Button disabled size="lg" className="w-full">
          {t("Loading payment...", "Chargement du paiement...")}
        </Button>
      )}
    </div>
  );
};
