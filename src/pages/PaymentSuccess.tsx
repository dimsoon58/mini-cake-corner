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
            Paiement réussi !
          </h1>
          
          <p className="text-muted-foreground mb-6">
            Merci pour votre commande. Vous recevrez un email de confirmation avec les détails de votre commande.
          </p>

          <p className="text-sm text-muted-foreground mb-8">
            Nous vous contacterons bientôt pour confirmer la date et l'heure de livraison/retrait.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button asChild>
              <Link to="/">Retour à l'accueil</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/customize">Nouvelle commande</Link>
            </Button>
          </div>
        </div>
      </main>
    </Layout>
  );
};

export default PaymentSuccess;
