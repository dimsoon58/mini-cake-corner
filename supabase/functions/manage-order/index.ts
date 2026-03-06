import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { orderId, action, pin } = await req.json();

    if (!orderId || !action || !pin) {
      throw new Error("Missing required fields: orderId, action, pin");
    }

    // Verify admin PIN
    const adminPin = Deno.env.get("ADMIN_ORDER_PIN");
    if (!adminPin || pin !== adminPin) {
      return new Response(JSON.stringify({ error: "Invalid PIN" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 403,
      });
    }

    if (action !== "approve" && action !== "reject") {
      throw new Error("Action must be 'approve' or 'reject'");
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not configured");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // Get order from DB
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      throw new Error("Order not found");
    }

    if (order.status !== "pending") {
      return new Response(JSON.stringify({ 
        error: `Order has already been ${order.status}`,
        status: order.status 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    let newStatus: string;
    let stripeAction: string;

    if (action === "approve") {
      // Retrieve the checkout session to get the payment intent
      if (!order.stripe_session_id) {
        throw new Error("No Stripe session ID found for this order");
      }

      const session = await stripe.checkout.sessions.retrieve(order.stripe_session_id);
      const paymentIntentId = session.payment_intent as string;

      if (!paymentIntentId) {
        throw new Error("No payment intent found for this session");
      }

      // Capture the payment
      await stripe.paymentIntents.capture(paymentIntentId);
      newStatus = "approved";
      stripeAction = "Payment captured";
      console.log(`Payment captured for order ${orderId}, PI: ${paymentIntentId}`);
    } else {
      // Reject - cancel/refund the payment intent
      if (!order.stripe_session_id) {
        throw new Error("No Stripe session ID found for this order");
      }

      const session = await stripe.checkout.sessions.retrieve(order.stripe_session_id);
      const paymentIntentId = session.payment_intent as string;

      if (paymentIntentId) {
        const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
        if (pi.status === "requires_capture") {
          await stripe.paymentIntents.cancel(paymentIntentId);
          stripeAction = "Payment canceled";
        } else if (pi.status === "succeeded") {
          await stripe.refunds.create({ payment_intent: paymentIntentId });
          stripeAction = "Payment refunded";
        } else {
          stripeAction = `Payment intent status: ${pi.status}`;
        }
      } else {
        stripeAction = "No payment intent to cancel";
      }
      newStatus = "rejected";
      console.log(`Order ${orderId} rejected. ${stripeAction}`);
    }

    // Update order status
    const { error: updateError } = await supabase
      .from("orders")
      .update({ status: newStatus })
      .eq("id", orderId);

    if (updateError) {
      console.error("Error updating order status:", updateError);
      throw new Error("Failed to update order status");
    }

    return new Response(JSON.stringify({ 
      success: true, 
      status: newStatus,
      stripeAction,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Error managing order:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
