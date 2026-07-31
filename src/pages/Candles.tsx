import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import Layout from "@/components/Layout";
import { useCart } from "@/context/CartContext";
import { candles } from "@/pages/KitBentoCake";
import { getCandleTotalPrice } from "@/data/customization";
import { useLang } from "@/context/LanguageContext";

const Candles = () => {
  const navigate = useNavigate();
  const { t } = useLang();
  const { addItem } = useCart();
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  useEffect(() => {
    document.title = t("Candles – Bento Cake Studio", "Bougies – Bento Cake Studio");
    return () => {
      document.title = "Bento Cake Studio Geneva";
    };
  }, [t]);

  const getQty = (id: string) => quantities[id] ?? 1;

  const changeQty = (id: string, delta: number) => {
    setQuantities((prev) => {
      const next = Math.max(1, (prev[id] ?? 1) + delta);
      return { ...prev, [id]: next };
    });
  };

  const handleAddToCart = (candle: (typeof candles)[number]) => {
    const qty = getQty(candle.id);
    const price = getCandleTotalPrice(candle.id, [
      { id: candle.id, quantity: qty, hasPack: false },
    ]);

    addItem({
      id: "",
      orderDate: "",
      orderTime: "",
      size: "candles",
      sizeName: `${qty}× ${candle.name}`,
      shape: "",
      shapeName: "",
      flavor: "",
      flavorName: "",
      style: "candles",
      styleName: t("Candle Order", "Commande de bougies"),
      baseColor: "",
      baseColorName: "",
      decorationColor: "",
      decorationColorName: "",
      cakeText: "",
      textColor: "",
      textColorName: "",
      textStyle: "normal",
      extras: [],
      extrasNames: [`${qty}× ${candle.name}`],
      ribbonColor: "",
      ribbonColorName: "",
      butterflyColor: "",
      butterflyColorName: "",
      candles: [],
      comment: "",
      imageUrls: [],
      imageFiles: [],
      total: price,
      isCandleProduct: true,
      candleProductId: candle.id,
      candleProductName: candle.name,
      candleProductImage: candle.image,
      candleProductQty: qty,
      candleProductHasPack: candle.hasPack,
    });

    toast.success(
      t(
        `${candle.name} added to your cart!`,
        `${candle.name} ajouté à votre panier !`
      ),
      {
        action: {
          label: t("View cart", "Voir le panier"),
          onClick: () => navigate("/cart"),
        },
      }
    );
    setQuantities((prev) => ({ ...prev, [candle.id]: 1 }));
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-16">
        <h1 className="font-sans text-4xl md:text-5xl text-center tracking-[0.105em] uppercase text-foreground mb-6">
          {t("CANDLES", "BOUGIES")}
        </h1>
        <p className="text-center text-muted-foreground mb-16 max-w-2xl mx-auto">
          {t(
            "Add the perfect finishing touch to your cake with our selection of fun and colourful candles.",
            "Ajoutez la touche finale idéale à votre gâteau grâce à notre sélection de bougies ludiques et colorées."
          )}
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6 max-w-6xl mx-auto">
          {candles.map((candle) => {
            const qty = getQty(candle.id);
            return (
              <Card
                key={candle.id}
                className="flex flex-col overflow-hidden bg-white/60 hover:bg-white/80 transition-all"
              >
                <div className="aspect-square flex items-center justify-center p-4 bg-secondary/20">
                  <img
                    src={candle.image}
                    alt={candle.name}
                    className="h-40 w-40 object-contain"
                  />
                </div>
                <CardContent className="p-4 text-center flex flex-col flex-1">
                  <h3 className="font-sans text-[13px] tracking-[0.105em] font-semibold uppercase text-foreground mb-1">
                    {candle.name}
                  </h3>
                  {candle.hasPack ? (
                    <p className="text-[11px] text-muted-foreground mb-4">
                      CHF {candle.unitPrice}/pièce · Pack {candle.packSize} = CHF{" "}
                      {candle.packPrice}
                    </p>
                  ) : (
                    <p className="text-[11px] text-muted-foreground mb-4">
                      CHF {candle.unitPrice} / pièce
                    </p>
                  )}

                  <div className="mt-auto space-y-3">
                    <div className="flex items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => changeQty(candle.id, -1)}
                        disabled={qty <= 1}
                        className={cn(
                          "w-7 h-7 rounded-none flex items-center justify-center text-sm font-bold transition-all",
                          qty <= 1
                            ? "bg-muted text-muted-foreground cursor-not-allowed"
                            : "bg-primary text-primary-foreground hover:bg-primary/90"
                        )}
                        aria-label={t(
                          `Decrease ${candle.name} quantity`,
                          `Diminuer la quantité de ${candle.name}`
                        )}
                      >
                        −
                      </button>
                      <span className="w-6 text-center font-medium text-foreground text-sm">
                        {qty}
                      </span>
                      <button
                        type="button"
                        onClick={() => changeQty(candle.id, 1)}
                        className="w-7 h-7 rounded-none bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold hover:bg-primary/90 transition-all"
                        aria-label={t(
                          `Increase ${candle.name} quantity`,
                          `Augmenter la quantité de ${candle.name}`
                        )}
                      >
                        +
                      </button>
                    </div>
                    <Button
                      onClick={() => handleAddToCart(candle)}
                      className="w-full rounded-none bg-primary hover:bg-primary/90 text-primary-foreground text-[12px] tracking-[0.105em] uppercase"
                    >
                      {t("Add to Cart", "Ajouter au panier")}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </Layout>
  );
};

export default Candles;
