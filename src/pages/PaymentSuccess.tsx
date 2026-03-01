import { useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCart } from "@/context/CartContext";
import Layout from "@/components/Layout";

const PaymentSuccess = () => {
  const [searchParams] = useSearchParams();
  const { clearCart } = useCart();
  const sessionId = searchParams.get("session_id");

  useEffect(() => {
    // Clear the cart after successful payment
    if (sessionId) {
      clearCart();
    }
  }, [sessionId, clearCart]);

  return (
    <Layout>
      <main className="container mx-auto px-4 py-16 max-w-2xl text-center">
        <div className="bg-card rounded-lg shadow-md p-8">
          <CheckCircle className="w-16 h-16 text-primary mx-auto mb-6" />
          
          <h1 className="text-2xl font-serif text-foreground mb-4">
            Thank you so much for ordering from Bento Cake Studio! 🤍
          </h1>
          
          <p className="text-muted-foreground mb-6">
            We truly appreciate your support and are so excited to create something special just for you.
          </p>

          <p className="text-muted-foreground mb-4">
            You will receive a confirmation message within the next 24 hours with the details of your pickup or delivery date and time.
          </p>

          <p className="text-muted-foreground mb-8">
            We can't wait for you to enjoy your cake! 🎂✨
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button asChild>
              <Link to="/">Back to Home</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/customize">New Order</Link>
            </Button>
          </div>
        </div>
      </main>
    </Layout>
  );
};

export default PaymentSuccess;
