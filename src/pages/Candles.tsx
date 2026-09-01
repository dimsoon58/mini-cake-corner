import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import Layout from "@/components/Layout";
import { useCart } from "@/context/CartContext";
import type { CandleSelection } from "@/context/CartContext";
import { ColorFamilyCandleCard, FAMILY_CANDLE_COLORS } from "@/components/ColorFamilyCandleCard";
import { candles } from "@/pages/KitBentoCake";
import { getCandleTotalPrice } from "@/data/customization";
import { NUMBER_CANDLE_ID, NUMBER_CANDLE_PRICE, NUMBER_CANDLE_DIGITS, priceCandleSelection, composeCandleName } from "@/lib/candleCartHelpers";
import { useLang } from "@/context/LanguageContext";

// A single "Number Candle" card with a 0–9 picker, kept entirely local to
// this page — never 10 separate candle products. The chosen digit is
// stored structured (candleProductVariant) AND composed into
// candleProductName ("Number Candle – 7") for every existing display
// consumer (Cart.tsx, order_items.candle_name, admin view, confirmation
// email) — see the audit note on candleProductVariant in CartContext.tsx.
// ID/price/digit-list are shared with Catalog.tsx, DotCakes.tsx and
// KitBentoCake.tsx, which also offer Number Candle as an embedded extra —
// imported from KitBentoCake.tsx instead of redeclared here.
//
// The 4 colour families' colour lists and swatch hex values, and the
// Pack/Piece selection logic itself, live in ColorFamilyCandleCard — the
// same component Catalog.tsx, DotCakes.tsx, KitBentoCake.tsx and Cart.tsx
// use, so there is exactly one implementation of that logic in the app.

const Candles = () => {
  const navigate = useNavigate();
  const { t } = useLang();
  const { addItem } = useCart();
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [numberCandleDigit, setNumberCandleDigit] = useState("0");

  // Forces ColorFamilyCandleCard to remount (fresh draft) after each
  // successful add — a standalone purchase here is always a brand-new cart
  // line, never an edit of a persistent selection, so `existing` is always
  // undefined and the card must reset itself between purchases.
  const [familyResetKeys, setFamilyResetKeys] = useState<Record<string, number>>({});

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
      product: "candles",
      orderDate: "",
      orderTime: "",
      size: "candles",
      sizeName: `${qty}× ${candle.name}`,
      shape: "",
      shapeName: "",
      flavor: "",
      flavorName: "",
      style: "candles",
      styleName: "Candle Order",
      baseColor: "",
      baseColorName: "",
      decorationColor: "",
      decorationColorName: "",
      cakeText: "",
      textColor: "",
      textColorName: "",
      textStyle: "normal",
      extras: [],
      // Candle name/quantity is carried via candleProductName/candleProductQty
      // below and lands in order_items.candle_name/candle_quantity — kept out
      // of extrasNames so it isn't duplicated into order_items.extra too.
      extrasNames: [],
      ribbonColor: "",
      ribbonColorName: "",
      butterflyColor: "",
      butterflyColorName: "",
      // Raw structured selection travels with the cart item — this is what
      // create-postfinance-payment recomputes the price from server-side.
      candles: [{ id: candle.id, quantity: qty, hasPack: false }],
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

  // Single handler for both Pack and Piece — ColorFamilyCandleCard already
  // validated and built the CandleSelection (colours never duplicated,
  // count matching quantity for piece mode, quantity always packSize-
  // aligned for pack mode); this only converts it into the standalone
  // CartItem fields and adds it.
  const handleFamilyCommit = (candle: (typeof candles)[number]) => (entry: CandleSelection) => {
    const familyColors = FAMILY_CANDLE_COLORS[candle.id];
    const price = priceCandleSelection(entry, candle, false);
    // Standalone purchases persist candleProductName directly as
    // candle_name (Checkout.tsx never re-derives it for isCandleProduct
    // items), so — unlike the embedded path, which stays English-only per
    // Pass 1 — this base name is localized to the customer's current
    // language at add time.
    const localizedName = t(candle.name, candle.nameFr || candle.name);

    const baseFields = {
      id: "", product: "candles", orderDate: "", orderTime: "", size: "candles",
      shape: "", shapeName: "", flavor: "", flavorName: "",
      style: "candles", styleName: "Candle Order",
      baseColor: "", baseColorName: "", decorationColor: "", decorationColorName: "",
      cakeText: "", textColor: "", textColorName: "", textStyle: "normal",
      extras: [], extrasNames: [], ribbonColor: "", ribbonColorName: "",
      butterflyColor: "", butterflyColorName: "",
      // Raw structured selection travels with the cart item now — this is
      // what create-postfinance-payment recomputes the price from. Never
      // parsed back out of candleProductId, which is display-only.
      candles: [entry],
      comment: "", imageUrls: [], imageFiles: [],
    };

    if (entry.colors) {
      const resolveColorLabel = (colorId: string) => {
        const color = familyColors.find((c) => c.id === colorId)!;
        return t(color.en, color.fr);
      };
      const label = composeCandleName(entry, localizedName, resolveColorLabel);
      const variantLabel = entry.colors.map(resolveColorLabel).join(", ");
      addItem({
        ...baseFields,
        sizeName: `${entry.quantity}× ${label}`,
        total: price,
        isCandleProduct: true,
        candleProductId: `${candle.id}-${entry.colors.slice().sort().join("-")}`,
        candleProductName: label,
        candleProductVariant: variantLabel,
        candleProductQty: entry.quantity,
        candleProductHasPack: false,
        // Base model's real per-piece price — never pack-eligible here, so
        // Cart.tsx can recompute on quantity change without needing to
        // look this composite id up in the candle catalogue.
        candleProductUnitPrice: candle.unitPrice,
        // Duplicate colours are forbidden by construction, so this exact
        // combination can't be "topped up" with +/- from the cart — the
        // customer removes the line and re-selects from this page instead.
        candleProductQtyLocked: true,
      });
      toast.success(t(`${label} added to your cart!`, `${label} ajouté à votre panier !`), {
        action: { label: t("View cart", "Voir le panier"), onClick: () => navigate("/cart") },
      });
    } else {
      // Pack mode — fixed assortment, no colour, stays quantity-adjustable in cart.
      addItem({
        ...baseFields,
        sizeName: `${entry.quantity}× ${localizedName}`,
        total: price,
        isCandleProduct: true,
        candleProductId: candle.id,
        candleProductName: localizedName,
        candleProductQty: entry.quantity,
        candleProductHasPack: true,
      });
      toast.success(t(`${localizedName} added to your cart!`, `${localizedName} ajouté à votre panier !`), {
        action: { label: t("View cart", "Voir le panier"), onClick: () => navigate("/cart") },
      });
    }

    setFamilyResetKeys((prev) => ({ ...prev, [candle.id]: (prev[candle.id] ?? 0) + 1 }));
  };

  const handleAddNumberCandleToCart = () => {
    const qty = getQty(NUMBER_CANDLE_ID);
    const price = priceCandleSelection({ id: NUMBER_CANDLE_ID, quantity: qty, hasPack: false, digit: numberCandleDigit }, undefined, true);
    const label = composeCandleName({ digit: numberCandleDigit }, t("Number Candle", "Bougie chiffre"));

    addItem({
      id: "",
      product: "candles",
      orderDate: "",
      orderTime: "",
      size: "candles",
      sizeName: `${qty}× ${label}`,
      shape: "",
      shapeName: "",
      flavor: "",
      flavorName: "",
      style: "candles",
      styleName: "Candle Order",
      baseColor: "",
      baseColorName: "",
      decorationColor: "",
      decorationColorName: "",
      cakeText: "",
      textColor: "",
      textColorName: "",
      textStyle: "normal",
      extras: [],
      extrasNames: [],
      ribbonColor: "",
      ribbonColorName: "",
      butterflyColor: "",
      butterflyColorName: "",
      candles: [{ id: NUMBER_CANDLE_ID, quantity: qty, hasPack: false, digit: numberCandleDigit }],
      comment: "",
      imageUrls: [],
      imageFiles: [],
      total: price,
      isCandleProduct: true,
      candleProductId: `${NUMBER_CANDLE_ID}-${numberCandleDigit}`,
      candleProductName: label,
      candleProductVariant: numberCandleDigit,
      candleProductQty: qty,
      candleProductHasPack: false,
      // Flat rate, never pack-eligible — same reasoning as the family
      // piece purchase above.
      candleProductUnitPrice: NUMBER_CANDLE_PRICE,
    });

    toast.success(
      t(`${label} added to your cart!`, `${label} ajouté à votre panier !`),
      {
        action: {
          label: t("View cart", "Voir le panier"),
          onClick: () => navigate("/cart"),
        },
      }
    );
    setQuantities((prev) => ({ ...prev, [NUMBER_CANDLE_ID]: 1 }));
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-16">
        <h1 className="font-sans text-4xl md:text-5xl text-center tracking-[0.105em] uppercase text-foreground mb-6 font-semibold">
          {t("CANDLES", "BOUGIES")}
        </h1>
        <p className="text-center text-muted-foreground mb-16 max-w-2xl mx-auto">
          {t(
            "Add the perfect finishing touch to your cake with our selection of fun and colourful candles.",
            "Complétez votre création avec notre sélection de bougies originales et colorées."
          )}
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6 max-w-6xl mx-auto">
          {candles.map((candle) => {
            const familyColors = FAMILY_CANDLE_COLORS[candle.id];
            if (familyColors) {
              return (
                <ColorFamilyCandleCard
                  key={`${candle.id}-${familyResetKeys[candle.id] ?? 0}`}
                  candle={candle}
                  colors={familyColors}
                  existing={undefined}
                  onCommit={handleFamilyCommit(candle)}
                  onRemove={() => {}}
                />
              );
            }

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

          <Card className="flex flex-col overflow-hidden bg-white/60 hover:bg-white/80 transition-all">
            <div className="aspect-square flex items-center justify-center p-4 bg-secondary/20">
              <span className="text-6xl font-bold text-primary" aria-hidden="true">
                {numberCandleDigit}
              </span>
            </div>
            <CardContent className="p-4 text-center flex flex-col flex-1">
              <h3 className="font-sans text-[13px] tracking-[0.105em] font-semibold uppercase text-foreground mb-1">
                {t("Number Candle", "Bougie chiffre")}
              </h3>
              <p className="text-[11px] text-muted-foreground mb-4">
                CHF {NUMBER_CANDLE_PRICE} / pièce
              </p>

              <div className="mt-auto space-y-3">
                <Select value={numberCandleDigit} onValueChange={setNumberCandleDigit}>
                  <SelectTrigger className="w-full" aria-label={t("Choose a digit", "Choisir un chiffre")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {NUMBER_CANDLE_DIGITS.map((digit) => (
                      <SelectItem key={digit} value={digit}>
                        {digit}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <div className="flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => changeQty(NUMBER_CANDLE_ID, -1)}
                    disabled={getQty(NUMBER_CANDLE_ID) <= 1}
                    className={cn(
                      "w-7 h-7 rounded-none flex items-center justify-center text-sm font-bold transition-all",
                      getQty(NUMBER_CANDLE_ID) <= 1
                        ? "bg-muted text-muted-foreground cursor-not-allowed"
                        : "bg-primary text-primary-foreground hover:bg-primary/90"
                    )}
                    aria-label={t("Decrease Number Candle quantity", "Diminuer la quantité de Bougie chiffre")}
                  >
                    −
                  </button>
                  <span className="w-6 text-center font-medium text-foreground text-sm">
                    {getQty(NUMBER_CANDLE_ID)}
                  </span>
                  <button
                    type="button"
                    onClick={() => changeQty(NUMBER_CANDLE_ID, 1)}
                    className="w-7 h-7 rounded-none bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold hover:bg-primary/90 transition-all"
                    aria-label={t("Increase Number Candle quantity", "Augmenter la quantité de Bougie chiffre")}
                  >
                    +
                  </button>
                </div>
                <Button
                  onClick={handleAddNumberCandleToCart}
                  className="w-full rounded-none bg-primary hover:bg-primary/90 text-primary-foreground text-[12px] tracking-[0.105em] uppercase"
                >
                  {t("Add to Cart", "Ajouter au panier")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  );
};

export default Candles;
