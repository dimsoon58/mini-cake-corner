import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

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
}

// create-postfinance-payment always returns a hosted PostFinance
// payment-page URL, so this always redirects there — on every surface
// (published site and Lovable preview iframe alike).
export const PostFinanceCheckout = ({ payload }: EmbeddedCheckoutProps) => {
  const [error, setError] = useState<string | null>(null);
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);

  useEffect(() => {
    const fetchRedirectUrl = async () => {
      try {
        const { data, error } = await supabase.functions.invoke("create-postfinance-payment", {
          body: payload,
        });

        if (error) {
          // supabase-js gives a generic message for a non-2xx function
          // response; the readable reason (e.g. "Delivery is not available
          // for this address.") is in the JSON body — surface that instead.
          let message = error.message;
          try {
            const body = await (error as { context?: Response }).context?.json();
            if (body?.error) message = body.error;
          } catch {
            /* keep the generic message */
          }
          setError(message);
          return;
        }

        if (data?.paymentPageUrl) {
          setRedirectUrl(data.paymentPageUrl);
        } else {
          setError("Impossible de créer la session de paiement");
        }
      } catch (err) {
        console.error("Error fetching payment page URL:", err);
        setError(err instanceof Error ? err.message : "Erreur inconnue");
      }
    };

    fetchRedirectUrl();
  }, [payload]);

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-6 text-center space-y-4">
      <p className="text-sm text-muted-foreground">
        Payment opens in a new tab to ensure compatibility with all payment methods (TWINT, etc.).
      </p>
      {redirectUrl ? (
        <Button asChild size="lg" className="w-full">
          <a href={redirectUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="w-4 h-4 mr-2" />
            Open Payment Page
          </a>
        </Button>
      ) : (
        <Button disabled size="lg" className="w-full">
          Loading payment...
        </Button>
      )}
    </div>
  );
};
