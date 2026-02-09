import { useCallback, useState, useEffect } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  EmbeddedCheckoutProvider,
  EmbeddedCheckout,
} from "@stripe/react-stripe-js";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLIC_KEY || "pk_test_placeholder");

interface EmbeddedCheckoutProps {
  payload: {
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
    deliveryFee: number;
    totalAmount: number;
  };
  onComplete?: () => void;
}

// Detect if running inside an iframe (Lovable preview)
const isInIframe = () => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
};

export const EmbeddedStripeCheckout = ({ payload, onComplete }: EmbeddedCheckoutProps) => {
  const [error, setError] = useState<string | null>(null);
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);
  const [isIframe] = useState(isInIframe);

  // In iframe mode, get a redirect URL instead of embedding
  useEffect(() => {
    if (!isIframe) return;

    const fetchRedirectUrl = async () => {
      try {
        const { data, error } = await supabase.functions.invoke("create-payment", {
          body: { ...payload, embedded: false },
        });

        if (error) {
          setError(error.message);
          return;
        }

        if (data?.url) {
          setRedirectUrl(data.url);
        } else {
          setError("Impossible de créer la session de paiement");
        }
      } catch (err) {
        console.error("Error fetching redirect URL:", err);
        setError(err instanceof Error ? err.message : "Erreur inconnue");
      }
    };

    fetchRedirectUrl();
  }, [isIframe, payload]);

  const fetchClientSecret = useCallback(async () => {
    try {
      const { data, error } = await supabase.functions.invoke("create-payment", {
        body: { ...payload, embedded: true },
      });

      if (error) {
        setError(error.message);
        throw new Error(error.message);
      }

      if (!data?.clientSecret) {
        setError("Impossible de créer la session de paiement");
        throw new Error("No client secret returned");
      }

      return data.clientSecret;
    } catch (err) {
      console.error("Error fetching client secret:", err);
      throw err;
    }
  }, [payload]);

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  // In iframe mode, show a button to open Stripe in a new tab
  if (isIframe) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-6 text-center space-y-4">
        <p className="text-sm text-muted-foreground">
          Le paiement s'ouvre dans un nouvel onglet pour assurer la compatibilité avec toutes les méthodes de paiement (TWINT, etc.).
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
  }

  // On the published site, use embedded checkout directly
  const options = { fetchClientSecret };

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <EmbeddedCheckoutProvider stripe={stripePromise} options={options}>
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  );
};
