import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import Layout from "@/components/Layout";
import { useCart } from "@/context/CartContext";
import { candles } from "@/pages/KitBentoCake";
import { getCandleTotalPrice } from "@/data/customization";
import { useLang } from "@/context/LanguageContext";

// A single "Number Candle" card with a 0–9 picker, kept entirely local to
// this page — never 10 separate candle products. The chosen digit is
// stored structured (candleProductVariant) AND composed into
// candleProductName ("Number Candle – 7") for every existing display
// consumer (Cart.tsx, order_items.candle_name, admin view, confirmation
// email) — see the audit note on candleProductVariant in CartContext.tsx.
//
const NUMBER_CANDLE_PRICE = 5; // Confirmé
const NUMBER_CANDLE_ID = "number-candle";
const NUMBER_CANDLE_DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

// Colour choices for the 4 spiral families that can be bought loose, by the
// piece — keyed by the matching candle.id in the `candles` array. A family
// NOT in this map (all other candles, including the 4 new spiral models
// below) keeps the plain single quantity stepper, unchanged.
const FAMILY_CANDLE_COLORS: Record<string, { id: string; en: string; fr: string }[]> = {
  "thick-spiral": [
    { id: "green", en: "Green", fr: "Vert" },
    { id: "blue", en: "Blue", fr: "Bleu" },
    { id: "purple", en: "Purple", fr: "Violet" },
    { id: "pink", en: "Pink", fr: "Rose" },
    { id: "yellow", en: "Yellow", fr: "Jaune" },
  ],
  "shiny-spiral": [
    { id: "red", en: "Red", fr: "Rouge" },
    { id: "purple", en: "Purple", fr: "Violet" },
    { id: "green", en: "Green", fr: "Vert" },
    { id: "gold", en: "Gold", fr: "Or" },
    { id: "pink", en: "Pink", fr: "Rose" },
    { id: "blue", en: "Blue", fr: "Bleu" },
  ],
  "spiral-pastel": [
    { id: "blue", en: "Blue", fr: "Bleu" },
    { id: "purple", en: "Purple", fr: "Violet" },
    { id: "dark-pink", en: "Dark Pink", fr: "Rose foncé" },
    { id: "light-pink", en: "Light Pink", fr: "Rose clair" },
    { id: "yellow", en: "Yellow", fr: "Jaune" },
    { id: "green", en: "Green", fr: "Vert" },
  ],
  rainbow: [
    { id: "turquoise", en: "Turquoise", fr: "Turquoise" },
    { id: "dark-blue", en: "Dark Blue", fr: "Bleu foncé" },
    { id: "blue", en: "Blue", fr: "Bleu" },
    { id: "green", en: "Green", fr: "Vert" },
    { id: "purple", en: "Purple", fr: "Violet" },
    { id: "light-pink", en: "Light Pink", fr: "Rose clair" },
    { id: "dark-pink", en: "Dark Pink", fr: "Rose foncé" },
    { id: "yellow", en: "Yellow", fr: "Jaune" },
    { id: "orange", en: "Orange", fr: "Orange" },
  ],
};

const Candles = () => {
  const navigate = useNavigate();
  const { t } = useLang();
  const { addItem } = useCart();
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [numberCandleDigit, setNumberCandleDigit] = useState("0");

  // Pack vs. piece purchase state for the 4 colour families — keyed by
  // candle.id, independent of the plain `quantities` stepper used by every
  // other candle.
  const [familyMode, setFamilyMode] = useState<Record<string, "pack" | "piece">>({});
  const [familyPackCount, setFamilyPackCount] = useState<Record<string, number>>({});
  const [familyColorId, setFamilyColorId] = useState<Record<string, string>>({});
  const [familyPieceQty, setFamilyPieceQty] = useState<Record<string, number>>({});

  const getFamilyMode = (id: string) => familyMode[id] ?? "pack";
  const getFamilyPackCount = (id: string) => familyPackCount[id] ?? 1;
  const getFamilyColorId = (id: string) => familyColorId[id] ?? FAMILY_CANDLE_COLORS[id][0].id;
  const getFamilyPieceQty = (id: string) => familyPieceQty[id] ?? 1;

  const changeFamilyPackCount = (id: string, delta: number) => {
    setFamilyPackCount((prev) => ({ ...prev, [id]: Math.max(1, getFamilyPackCount(id) + delta) }));
  };

  // Hard-capped at packSize - 1: this is what makes it structurally
  // impossible to recompose a full pack (e.g. 6 loose pieces of one
  // colour) through the "by the piece" path — the "+" button simply
  // disables at the cap.
  const changeFamilyPieceQty = (id: string, delta: number, maxQty: number) => {
    setFamilyPieceQty((prev) => ({
      ...prev,
      [id]: Math.min(maxQty, Math.max(1, getFamilyPieceQty(id) + delta)),
    }));
  };

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

  const handleAddFamilyPackToCart = (candle: (typeof candles)[number]) => {
    const packSize = candle.packSize || 6;
    const packs = getFamilyPackCount(candle.id);
    const qty = packs * packSize;
    const price = packs * (candle.packPrice || 0);

    addItem({
      id: "",
      product: "candles",
      orderDate: "",
      orderTime: "",
      size: "candles",
      // No colour in the name/variant here — a pack is always the fixed
      // assortment, never a customer-chosen colour.
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
      extrasNames: [],
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
      candleProductQty: qty,
      candleProductHasPack: true,
    });

    toast.success(
      t(`${candle.name} added to your cart!`, `${candle.name} ajouté à votre panier !`),
      {
        action: {
          label: t("View cart", "Voir le panier"),
          onClick: () => navigate("/cart"),
        },
      }
    );
    setFamilyPackCount((prev) => ({ ...prev, [candle.id]: 1 }));
  };

  const handleAddFamilyPieceToCart = (candle: (typeof candles)[number]) => {
    const familyColors = FAMILY_CANDLE_COLORS[candle.id];
    const colorId = getFamilyColorId(candle.id);
    const color = familyColors.find((c) => c.id === colorId) ?? familyColors[0];
    const qty = getFamilyPieceQty(candle.id);
    const price = qty * candle.unitPrice;
    const colorLabel = t(color.en, color.fr);
    const label = `${candle.name} – ${colorLabel}`;

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
      candles: [],
      comment: "",
      imageUrls: [],
      imageFiles: [],
      total: price,
      isCandleProduct: true,
      candleProductId: `${candle.id}-${color.id}`,
      candleProductName: label,
      candleProductVariant: colorLabel,
      candleProductQty: qty,
      candleProductHasPack: false,
      // Base model's real per-piece price — never pack-eligible here, so
      // Cart.tsx can recompute on quantity change without needing to look
      // this composite id up in the candle catalogue.
      candleProductUnitPrice: candle.unitPrice,
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
    setFamilyPieceQty((prev) => ({ ...prev, [candle.id]: 1 }));
  };

  const handleAddNumberCandleToCart = () => {
    const qty = getQty(NUMBER_CANDLE_ID);
    const price = NUMBER_CANDLE_PRICE * qty;
    const label = `${t("Number Candle", "Bougie chiffre")} – ${numberCandleDigit}`;

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
      candles: [],
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
        <h1 className="font-sans text-4xl md:text-5xl text-center tracking-[0.105em] uppercase text-foreground mb-6">
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
              const mode = getFamilyMode(candle.id);
              const packSize = candle.packSize || 6;
              const packs = getFamilyPackCount(candle.id);
              const pieceQty = getFamilyPieceQty(candle.id);
              const maxPieceQty = packSize - 1;
              const colorId = getFamilyColorId(candle.id);

              return (
                <Card
                  key={candle.id}
                  className="flex flex-col overflow-hidden bg-white/60 hover:bg-white/80 transition-all"
                >
                  <div className="aspect-square flex items-center justify-center p-4 bg-secondary/20">
                    <img src={candle.image} alt={candle.name} className="h-40 w-40 object-contain" />
                  </div>
                  <CardContent className="p-4 text-center flex flex-col flex-1">
                    <h3 className="font-sans text-[13px] tracking-[0.105em] font-semibold uppercase text-foreground mb-1">
                      {candle.name}
                    </h3>
                    <p className="text-[11px] text-muted-foreground mb-3">
                      CHF {candle.unitPrice}/pièce · Pack {packSize} = CHF {candle.packPrice}
                    </p>

                    <RadioGroup
                      value={mode}
                      onValueChange={(value) =>
                        setFamilyMode((prev) => ({ ...prev, [candle.id]: value as "pack" | "piece" }))
                      }
                      className="flex justify-center gap-4 mb-3"
                    >
                      <div className="flex items-center space-x-1.5">
                        <RadioGroupItem value="pack" id={`${candle.id}-mode-pack`} />
                        <Label htmlFor={`${candle.id}-mode-pack`} className="text-xs cursor-pointer">
                          {t("Pack (assorted)", "Pack (assorti)")}
                        </Label>
                      </div>
                      <div className="flex items-center space-x-1.5">
                        <RadioGroupItem value="piece" id={`${candle.id}-mode-piece`} />
                        <Label htmlFor={`${candle.id}-mode-piece`} className="text-xs cursor-pointer">
                          {t("By the piece", "À la pièce")}
                        </Label>
                      </div>
                    </RadioGroup>

                    <div className="mt-auto space-y-3">
                      {mode === "pack" ? (
                        <>
                          <p className="text-[10px] text-muted-foreground">
                            {t(
                              "Fixed colour assortment — no colour choice.",
                              "Assortiment de couleurs fixe — pas de choix de couleur."
                            )}
                          </p>
                          <div className="flex items-center justify-center gap-2">
                            <button
                              type="button"
                              onClick={() => changeFamilyPackCount(candle.id, -1)}
                              disabled={packs <= 1}
                              className={cn(
                                "w-7 h-7 rounded-none flex items-center justify-center text-sm font-bold transition-all",
                                packs <= 1
                                  ? "bg-muted text-muted-foreground cursor-not-allowed"
                                  : "bg-primary text-primary-foreground hover:bg-primary/90"
                              )}
                              aria-label={t("Decrease pack quantity", "Diminuer le nombre de packs")}
                            >
                              −
                            </button>
                            <span className="flex-1 text-center font-medium text-foreground text-sm">
                              {packs} {t("pack(s)", "pack(s)")} ({packs * packSize} {t("pcs", "pièces")})
                            </span>
                            <button
                              type="button"
                              onClick={() => changeFamilyPackCount(candle.id, 1)}
                              className="w-7 h-7 rounded-none bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold hover:bg-primary/90 transition-all"
                              aria-label={t("Increase pack quantity", "Augmenter le nombre de packs")}
                            >
                              +
                            </button>
                          </div>
                          <Button
                            onClick={() => handleAddFamilyPackToCart(candle)}
                            className="w-full rounded-none bg-primary hover:bg-primary/90 text-primary-foreground text-[12px] tracking-[0.105em] uppercase"
                          >
                            {t("Add to Cart", "Ajouter au panier")}
                          </Button>
                        </>
                      ) : (
                        <>
                          <Select
                            value={colorId}
                            onValueChange={(value) =>
                              setFamilyColorId((prev) => ({ ...prev, [candle.id]: value }))
                            }
                          >
                            <SelectTrigger className="w-full" aria-label={t("Choose a colour", "Choisir une couleur")}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {familyColors.map((color) => (
                                <SelectItem key={color.id} value={color.id}>
                                  {t(color.en, color.fr)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <div className="flex items-center justify-center gap-2">
                            <button
                              type="button"
                              onClick={() => changeFamilyPieceQty(candle.id, -1, maxPieceQty)}
                              disabled={pieceQty <= 1}
                              className={cn(
                                "w-7 h-7 rounded-none flex items-center justify-center text-sm font-bold transition-all",
                                pieceQty <= 1
                                  ? "bg-muted text-muted-foreground cursor-not-allowed"
                                  : "bg-primary text-primary-foreground hover:bg-primary/90"
                              )}
                              aria-label={t("Decrease quantity", "Diminuer la quantité")}
                            >
                              −
                            </button>
                            <span className="w-6 text-center font-medium text-foreground text-sm">{pieceQty}</span>
                            <button
                              type="button"
                              onClick={() => changeFamilyPieceQty(candle.id, 1, maxPieceQty)}
                              disabled={pieceQty >= maxPieceQty}
                              className={cn(
                                "w-7 h-7 rounded-none flex items-center justify-center text-sm font-bold transition-all",
                                pieceQty >= maxPieceQty
                                  ? "bg-muted text-muted-foreground cursor-not-allowed"
                                  : "bg-primary text-primary-foreground hover:bg-primary/90"
                              )}
                              aria-label={t("Increase quantity", "Augmenter la quantité")}
                            >
                              +
                            </button>
                          </div>
                          {/* Hard cap at packSize - 1: the only way past this is the
                              "Pack" mode above, which never exposes a colour choice —
                              this is what keeps a curated pack from being recomposed
                              as N loose pieces of a single colour. */}
                          <p className="text-[10px] text-muted-foreground">
                            {t(
                              `Max ${maxPieceQty} loose pieces — add a full pack beyond that.`,
                              `Maximum ${maxPieceQty} pièces à l'unité — au-delà, ajoutez un pack complet.`
                            )}
                          </p>
                          <Button
                            onClick={() => handleAddFamilyPieceToCart(candle)}
                            className="w-full rounded-none bg-primary hover:bg-primary/90 text-primary-foreground text-[12px] tracking-[0.105em] uppercase"
                          >
                            {t("Add to Cart", "Ajouter au panier")}
                          </Button>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
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
