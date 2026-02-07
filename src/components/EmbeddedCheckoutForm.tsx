import { useCallback, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  EmbeddedCheckoutProvider,
  EmbeddedCheckout,
} from "@stripe/react-stripe-js";
import { supabase } from "@/integrations/supabase/client";
import { CartItem } from "@/context/CartContext";
import { Loader2 } from "lucide-react";

// Load Stripe with the publishable key
const stripePromise = loadStripe("pk_test_51RSRu1KXSZ5n6lhXyFqGx6NsOmjO5IDAz7h8TZSVf2sujuJNDflqHlFy8oGz1RXG5eKYwWc3NxWO0SxjTxNJpRMn00E3w8XL8N");

interface EmbeddedCheckoutFormProps {
  items: CartItem[];
  customerEmail: string;
  customerName: string;
  customerPhone: string;
  deliveryOption: string;
  deliveryAddress?: string;
  deliveryFee: number;
  totalAmount: number;
  orderDate: string;
  subscribeNewsletter: boolean;
  onError: (error: string) => void;
}

const EmbeddedCheckoutForm = ({
  items,
  customerEmail,
  customerName,
  customerPhone,
  deliveryOption,
  deliveryAddress,
  deliveryFee,
  totalAmount,
  orderDate,
  subscribeNewsletter,
  onError,
}: EmbeddedCheckoutFormProps) => {
  const [isLoading, setIsLoading] = useState(true);

  const fetchClientSecret = useCallback(async () => {
    try {
      // Save order to database first
      await supabase.from("orders").insert({
        order_date: orderDate,
        customer_name: customerName,
        customer_email: customerEmail,
        customer_phone: customerPhone,
        total_amount: totalAmount,
        delivery_option: deliveryOption,
        delivery_address: deliveryOption === "delivery" ? deliveryAddress : null,
        newsletter_subscription: subscribeNewsletter,
      });

      // Call Stripe payment edge function
      const { data, error } = await supabase.functions.invoke("create-payment", {
        body: {
          items: items.map((item) => ({
            sizeName: item.sizeName,
            shapeName: item.shapeName,
            flavorName: item.flavorName,
            styleName: item.styleName,
            extrasNames: item.extrasNames,
            total: item.total,
          })),
          customerEmail,
          customerName,
          customerPhone,
          deliveryOption,
          deliveryAddress: deliveryOption === "delivery" ? deliveryAddress : undefined,
          deliveryFee,
          totalAmount,
        },
      });

      if (error) {
        throw new Error(error.message);
      }

      if (!data?.clientSecret) {
        throw new Error("No client secret received");
      }

      setIsLoading(false);
      return data.clientSecret;
    } catch (error) {
      console.error("Payment error:", error);
      onError(error instanceof Error ? error.message : "Une erreur est survenue");
      throw error;
    }
  }, [
    items,
    customerEmail,
    customerName,
    customerPhone,
    deliveryOption,
    deliveryAddress,
    deliveryFee,
    totalAmount,
    orderDate,
    subscribeNewsletter,
    onError,
  ]);

  const options = { fetchClientSecret };

  return (
    <div className="mt-6">
      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="ml-2 text-muted-foreground">Chargement du paiement...</span>
        </div>
      )}
      <EmbeddedCheckoutProvider stripe={stripePromise} options={options}>
        <EmbeddedCheckout className="embedded-checkout" />
      </EmbeddedCheckoutProvider>
    </div>
  );
};

export default EmbeddedCheckoutForm;
