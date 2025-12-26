import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useCart } from "@/context/CartContext";
import { ShoppingBag, Trash2, ArrowLeft } from "lucide-react";
import logo from "@/assets/logo.png";

const Cart = () => {
  const { items, removeItem, clearCart, itemCount } = useCart();

  const totalPrice = items.reduce((sum, item) => sum + item.total, 0);

  return (
    <div className="min-h-screen bg-background font-sans">
      {/* Header */}
      <header className="bg-background py-8 border-b border-border">
        <div className="container mx-auto px-4 flex items-center justify-between">
          <Link to="/">
            <img src={logo} alt="Bento Cake Studio" className="h-16 md:h-20" />
          </Link>
          <div className="flex items-center gap-2">
            <ShoppingBag className="h-6 w-6 text-primary" />
            <span className="text-lg font-medium text-foreground">
              Your Basket ({itemCount})
            </span>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-12">
        <Link
          to="/"
          className="inline-flex items-center text-muted-foreground hover:text-foreground mb-8"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Continue Shopping
        </Link>

        {items.length === 0 ? (
          <div className="text-center py-20">
            <ShoppingBag className="h-16 w-16 text-muted-foreground mx-auto mb-6" />
            <h2 className="font-serif text-3xl text-foreground mb-4">
              Your basket is empty
            </h2>
            <p className="text-muted-foreground mb-8">
              Start customizing your perfect cake!
            </p>
            <Button asChild>
              <Link to="/customize">Customize Your Cake</Link>
            </Button>
          </div>
        ) : (
          <div className="grid lg:grid-cols-3 gap-8">
            {/* Cart Items */}
            <div className="lg:col-span-2 space-y-4">
              <div className="flex justify-between items-center mb-4">
                <h2 className="font-serif text-2xl text-foreground">
                  Your Items
                </h2>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearCart}
                  className="text-destructive hover:text-destructive"
                >
                  Clear All
                </Button>
              </div>

              {items.map((item) => (
                <Card key={item.id} className="overflow-hidden">
                  <CardContent className="p-6">
                    <div className="flex justify-between items-start">
                      <div className="space-y-2">
                        <h3 className="font-serif text-xl text-foreground">
                          {item.sizeName} {item.shapeName} Cake
                        </h3>
                        <p className="text-muted-foreground">
                          Flavor: {item.flavorName}
                        </p>
                        {item.extrasNames.length > 0 && (
                          <p className="text-sm text-muted-foreground">
                            Extras: {item.extrasNames.join(", ")}
                          </p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-xl font-bold text-primary">
                          CHF {item.total}
                        </p>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeItem(item.id)}
                          className="text-destructive hover:text-destructive mt-2"
                        >
                          <Trash2 className="h-4 w-4 mr-1" />
                          Remove
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Order Summary */}
            <div className="lg:col-span-1">
              <Card className="sticky top-8">
                <CardContent className="p-6 space-y-4">
                  <h3 className="font-serif text-xl text-foreground">
                    Order Summary
                  </h3>
                  <div className="space-y-2 border-b border-border pb-4">
                    {items.map((item, index) => (
                      <div
                        key={item.id}
                        className="flex justify-between text-sm"
                      >
                        <span className="text-muted-foreground">
                          Cake {index + 1}
                        </span>
                        <span className="text-foreground">CHF {item.total}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between text-lg font-bold">
                    <span className="text-foreground">Total</span>
                    <span className="text-primary">CHF {totalPrice}</span>
                  </div>
                  <Button className="w-full" size="lg">
                    Proceed to Checkout
                  </Button>
                  <Button variant="outline" className="w-full" asChild>
                    <Link to="/customize">Add Another Cake</Link>
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default Cart;
