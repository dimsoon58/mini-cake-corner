import { useCallback, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  EmbeddedCheckoutProvider,
  EmbeddedCheckout,
} from "@stripe/react-stripe-js";
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

export const EmbeddedStripeCheckout = ({ payload, onComplete }: EmbeddedCheckoutProps) => {
  const [error, setError] = useState<string | null>(null);

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

  const options = { fetchClientSecret };

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <EmbeddedCheckoutProvider stripe={stripePromise} options={options}>
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  );
};
