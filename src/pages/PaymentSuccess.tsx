import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle, Clock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCart } from "@/context/CartContext";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";

const PaymentSuccess = () => {
  const [searchParams] = useSearchParams();
  const { clearCart } = useCart();
  const sessionId = searchParams.get("session_id");
  const [processed, setProcessed] = useState(false);
  const [orderStatus, setOrderStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId || processed) return;

    const processPayment = async () => {
      try {
        // If already linked, read current status directly
        const { data: existingOrders } = await supabase
          .from("orders")
          .select("id, status")
          .eq("stripe_session_id", sessionId)
          .order("created_at", { ascending: false })
          .limit(1);

        if (existingOrders && existingOrders.length > 0) {
          setOrderStatus(existingOrders[0].status);
          // Fire Make webhook silently in the background
          supabase.functions.invoke("send-make-webhook", {
            body: { orderId: existingOrders[0].id },
          }).catch((err) => console.warn("Make webhook failed (silent):", err));
          clearCart();
          setProcessed(true);
          return;
        }

        // Otherwise link the most recent pending order
        const { data: recentOrders } = await supabase
          .from("orders")
          .select("id, status")
          .eq("status", "pending")
          .is("stripe_session_id", null)
          .order("created_at", { ascending: false })
          .limit(1);

        if (recentOrders && recentOrders.length > 0) {
          const orderId = recentOrders[0].id;
          setOrderStatus(recentOrders[0].status ?? "pending");

          const { error: updateError } = await supabase
            .from("orders")
            .update({ stripe_session_id: sessionId })
            .eq("id", orderId);

          if (!updateError) {
            await supabase.functions.invoke("notify-order", {
              body: { orderId },
            });
          }
        }

        clearCart();
        setProcessed(true);
      } catch (err) {
        console.error("Error processing payment success:", err);
        clearCart();
        setProcessed(true);
      }
    };

    processPayment();
  }, [sessionId, clearCart, processed]);

  useEffect(() => {
    if (!sessionId || !processed || orderStatus === "approved" || orderStatus === "accepted" || orderStatus === "confirmed") return;

    let mounted = true;

    const refreshOrderStatus = async () => {
      const { data } = await supabase
        .from("orders")
        .select("status")
        .eq("stripe_session_id", sessionId)
        .order("created_at", { ascending: false })
        .limit(1);

      if (mounted && data && data.length > 0) {
        setOrderStatus(data[0].status);
      }
    };

    refreshOrderStatus();
    const intervalId = setInterval(refreshOrderStatus, 5000);

    return () => {
      mounted = false;
      clearInterval(intervalId);
    };
  }, [sessionId, processed, orderStatus]);

  const isOrderConfirmed =
    orderStatus === "approved" || orderStatus === "accepted" || orderStatus === "confirmed";

  return (
    <Layout>
      <main className="container mx-auto px-4 py-16 max-w-2xl text-center">
        <div className="bg-card rounded-lg shadow-md p-8">
          <CheckCircle className="w-16 h-16 text-primary mx-auto mb-6" />
          
          {isOrderConfirmed ? (
            <>
              <h1 className="text-2xl font-serif text-foreground mb-4">
                Order Confirmed ✅
              </h1>
              
              <p className="text-muted-foreground mb-8">
                Your order has been successfully placed and your payment has been processed.
                <br /><br />
                We are now preparing your order.
                <br /><br />
                You may close this page.
              </p>

              <div className="bg-secondary border border-border rounded-lg p-4 mb-6">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Sparkles className="w-5 h-5 text-primary" />
                  <p className="font-medium text-foreground">Preparing Your Order</p>
                </div>
                <p className="text-sm text-muted-foreground">
                  We're excited to create something special for you!
                </p>
              </div>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-serif text-foreground mb-4">
                Thank you so much for ordering from Bento Cake Studio! 🤍
              </h1>
              
              <p className="text-muted-foreground mb-6">
                We truly appreciate your support and are so excited to create something special just for you.
              </p>

              <div className="bg-muted border border-border rounded-lg p-4 mb-6">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Clock className="w-5 h-5 text-primary" />
                  <p className="font-medium text-foreground">Order Pending Approval</p>
                </div>
                <p className="text-sm text-muted-foreground">
                  Your payment has been authorized but will only be charged once we confirm your order. 
                  You will receive a confirmation message within the next 24 hours with the details of your pickup or delivery date and time.
                </p>
              </div>

              <p className="text-muted-foreground mb-8">
                We can't wait for you to enjoy your cake! 🎂✨
              </p>
            </>
          )}

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button asChild>
              <Link to="/">Back to Home</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/catalog">New Order</Link>
            </Button>
          </div>
        </div>
      </main>
    </Layout>
  );
};

export default PaymentSuccess;
