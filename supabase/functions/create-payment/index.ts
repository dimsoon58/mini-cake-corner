import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "npm:stripe@18.5.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface CartItem {
  sizeName: string;
  shapeName: string;
  flavorName: string;
  styleName?: string;
  extrasNames: string[];
  total: number;
}

interface PaymentRequest {
  items: CartItem[];
  customerEmail: string;
  customerName: string;
  customerPhone: string;
  deliveryOption: string;
  deliveryAddress?: string;
  deliveryFee: number;
  totalAmount: number;
  embedded?: boolean;
  orderId?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      throw new Error("STRIPE_SECRET_KEY is not configured");
    }

    const stripe = new Stripe(stripeKey, {
      apiVersion: "2025-08-27.basil",
    });

    const body: PaymentRequest = await req.json();
    console.log("Payment request received:", JSON.stringify(body));

    const { items, customerEmail, customerName, customerPhone, deliveryOption, deliveryAddress, deliveryFee, totalAmount, embedded, orderId } = body;

    if (!items || items.length === 0) {
      throw new Error("No items in cart");
    }

    if (!customerEmail) {
      throw new Error("Customer email is required");
    }

    // Build line items for each cake
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = items.map((item) => {
      const description = [
        item.flavorName,
        item.styleName,
        item.extrasNames.length > 0 ? `Extras: ${item.extrasNames.join(", ")}` : null,
      ]
        .filter(Boolean)
        .join(" • ");

      return {
        price_data: {
          currency: "chf",
          product_data: {
            name: `${item.sizeName} ${item.shapeName} Cake`,
            description: description || undefined,
          },
          unit_amount: Math.round(item.total * 100),
        },
        quantity: 1,
      };
    });

    // Add delivery fee as a separate line item if applicable
    if (deliveryOption === "delivery" && deliveryFee > 0) {
      lineItems.push({
        price_data: {
          currency: "chf",
          product_data: {
            name: "Delivery Fee",
            description: deliveryAddress || "Delivery to your address",
          },
          unit_amount: Math.round(deliveryFee * 100),
        },
        quantity: 1,
      });
    }

    // Check if customer already exists
    const customers = await stripe.customers.list({ email: customerEmail, limit: 1 });
    let customerId: string | undefined;

    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
      await stripe.customers.update(customerId, {
        name: customerName,
        phone: customerPhone,
      });
    } else {
      const newCustomer = await stripe.customers.create({
        email: customerEmail,
        name: customerName,
        phone: customerPhone,
      });
      customerId = newCustomer.id;
    }

    // Create checkout session with per-payment-method manual capture
    // TWINT does not support manual capture, so we only set it for card
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      customer: customerId,
      line_items: lineItems,
      mode: "payment",
      payment_intent_data: {
        capture_method: "manual",
        metadata: {
          order_id: orderId || "",
          customer_name: customerName,
          customer_phone: customerPhone,
          delivery_option: deliveryOption,
          delivery_address: deliveryAddress || "",
        },
      },
      metadata: {
        order_id: orderId || "",
        customer_name: customerName,
        customer_phone: customerPhone,
        delivery_option: deliveryOption,
        delivery_address: deliveryAddress || "",
      },
    };

    if (embedded) {
      sessionParams.ui_mode = "embedded";
      sessionParams.return_url = `${req.headers.get("origin")}/payment-success?session_id={CHECKOUT_SESSION_ID}`;
    } else {
      sessionParams.success_url = `${req.headers.get("origin")}/payment-success?session_id={CHECKOUT_SESSION_ID}`;
      sessionParams.cancel_url = `${req.headers.get("origin")}/checkout`;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    console.log("Checkout session created:", session.id, "embedded:", !!embedded);

    if (embedded) {
      return new Response(JSON.stringify({ 
        clientSecret: session.client_secret,
        sessionId: session.id,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    return new Response(JSON.stringify({ 
      url: session.url,
      sessionId: session.id,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Error creating payment:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
