import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format, addDays } from "date-fns";
import { CalendarIcon, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import Layout from "@/components/Layout";
import { useCart } from "@/context/CartContext";
import { useLang } from "@/context/LanguageContext";
import { flavorCategories, candles as kitCandles } from "@/pages/KitBentoCake";

/* Dot cake pricing: pack base price + per-dot surcharge for premium/deluxe
   flavours, split evenly across the chosen flavours. */
const packs = [
  { size: 4, flavours: 2, price: 35 },
  { size: 6, flavours: 3, price: 51 },
  { size: 9, flavours: 3, price: 75 },
  { size: 12, flavours: 4, price: 99 },
  { size: 20, flavours: 5, price: 160 },
];

// DIY kit categories mapped to dot-cake tiers
const tierByCategory: Record<string, { label: string; surcharge: number; note: string }> = {
  "Standard Flavors": { label: "Standard Flavours", surcharge: 0, note: "included" },
  "Special Flavors": { label: "Premium Flavours", surcharge: 1.5, note: "+CHF 1.50 per Dot Cake" },
  "Deluxe Flavors": { label: "Deluxe Flavours", surcharge: 2.5, note: "+CHF 2.50 per Dot Cake" },
};

const tierNoteFr: Record<string, string> = {
  "included": "inclus",
  "+CHF 1.50 per Dot Cake": "+CHF 1.50 par Dot Cake",
  "+CHF 2.50 per Dot Cake": "+CHF 2.50 par Dot Cake",
};

const INITIAL_CANDLES_SHOWN = 4;

const SectionHeading = ({ children }: { children: React.ReactNode }) => (
  <h2 className="font-sans text-xl font-semibold text-center uppercase tracking-[0.105em] text-foreground">
    {children}
  </h2>
);

const DotCakes = () => {
  const navigate = useNavigate();
  const { addItem } = useCart();
  const { t } = useLang();
  const [orderDate, setOrderDate] = useState<Date | undefined>(undefined);
  const [packSize, setPackSize] = useState<number | null>(null);
  const [selectedFlavours, setSelectedFlavours] = useState<string[]>([]);
  const [candleSelections, setCandleSelections] = useState<Record<string, number>>({});
  const [showAllCandles, setShowAllCandles] = useState(false);

  useEffect(() => {
    document.title = t("Dot Cakes – Bento Cake Studio", "Dot Cakes – Bento Cake Studio");
    return () => {
      document.title = "Bento Cake Studio Geneva";
    };
  }, [t]);

  const pack = packs.find((p) => p.size === packSize) || null;

  const allFlavours = useMemo(
    () =>
      flavorCategories.flatMap((cat) =>
        cat.flavors.map((fl) => ({ ...fl, category: cat.name }))
      ),
    []
  );

  const surchargeFor = (flavourId: string) => {
    const fl = allFlavours.find((f) => f.id === flavourId);
    return fl ? tierByCategory[fl.category]?.surcharge ?? 0 : 0;
  };

  const toggleFlavour = (id: string) => {
    if (!pack) return;
    setSelectedFlavours((prev) => {
      if (prev.includes(id)) return prev.filter((f) => f !== id);
      if (prev.length >= pack.flavours) return prev;
      return [...prev, id];
    });
  };

  const handleCandleQtyChange = (candleId: string, delta: number) => {
    setCandleSelections((prev) => {
      const next = Math.max(0, (prev[candleId] || 0) + delta);
      const copy = { ...prev };
      if (next === 0) delete copy[candleId];
      else copy[candleId] = next;
      return copy;
    });
  };

  const getCandlePrice = (candleId: string, qty: number) => {
    const candle = kitCandles.find((c) => c.id === candleId);
    if (!candle || qty === 0) return 0;
    if (candle.hasPack && candle.packPrice && candle.packSize) {
      const fullPacks = Math.floor(qty / candle.packSize);
      const remainder = qty % candle.packSize;
      return fullPacks * candle.packPrice + remainder * candle.unitPrice;
    }
    return qty * candle.unitPrice;
  };

  const candlesTotal = Object.entries(candleSelections).reduce(
    (acc, [id, qty]) => acc + getCandlePrice(id, qty),
    0
  );

  const total = useMemo(() => {
    if (!pack) return 0;
    let sum = pack.price;
    if (selectedFlavours.length > 0) {
      const dotsPerFlavour = pack.size / selectedFlavours.length;
      selectedFlavours.forEach((id) => {
        sum += dotsPerFlavour * surchargeFor(id);
      });
    }
    return Math.round((sum + candlesTotal) * 100) / 100;
  }, [pack, selectedFlavours, candlesTotal]);

  const handleOrder = () => {
    if (!orderDate) {
      toast.error(t("Please choose your pick-up date (minimum 4 days' notice).", "Veuillez choisir votre date de retrait (minimum 4 jours à l'avance)."));
      return;
    }
    if (!pack) {
      toast.error(t("Please choose a pack.", "Veuillez choisir un pack."));
      return;
    }
    if (selectedFlavours.length === 0) {
      toast.error(t("Please choose up to " + pack.flavours + " flavours (at least one).", "Veuillez choisir jusqu'à " + pack.flavours + " parfums (au moins un)."));
      return;
    }

    const flavourNames = selectedFlavours.map((id) => {
      const fl = allFlavours.find((f) => f.id === id)!;
      return `${fl.name} (${tierByCategory[fl.category]?.label ?? fl.category})`;
    });
    const candleDetails = Object.entries(candleSelections)
      .map(([id, qty]) => {
        const candle = kitCandles.find((c) => c.id === id);
        return `${qty}x ${candle?.name}`;
      })
      .join("; ");

    addItem({
      id: "",
      orderDate: format(orderDate, "yyyy-MM-dd"),
      orderTime: "",
      size: "dot-cakes",
      sizeName: `Dot Cake Pack of ${pack.size}`,
      shape: "",
      shapeName: "",
      flavor: selectedFlavours.join(", "),
      flavorName: flavourNames.join(", "),
      style: "dot-cakes",
      styleName: "Dot Cakes",
      baseColor: "",
      baseColorName: "",
      decorationColor: "",
      decorationColorName: "",
      cakeText: "",
      textColor: "",
      textColorName: "",
      textStyle: "normal",
      extras: [],
      extrasNames: candleDetails ? [candleDetails] : [],
      ribbonColor: "",
      ribbonColorName: "",
      butterflyColor: "",
      butterflyColorName: "",
      candles: [],
      comment: "",
      imageUrls: [],
      imageFiles: [],
      total,
    });
    toast.success(t("Dot cakes added to your cart!", "Dot cakes ajoutés à votre panier !"));
    navigate("/cart");
  };

  const packCandles = kitCandles.filter((c) => c.hasPack);
  const individualCandles = kitCandles.filter((c) => !c.hasPack);

  return (
    <Layout>
      <div className="container mx-auto px-4 py-16">
        <h1 className="font-sans text-4xl md:text-5xl text-center tracking-[0.105em] uppercase text-foreground mb-6">
          DOT CAKES
        </h1>
        <p className="text-center text-muted-foreground mb-12 max-w-2xl mx-auto">
          {t("Bite-sized cakes topped with a cloud of colourful sprinkles, perfect for parties, gifts and moments when one cake just isn't enough.", "Nos Dot Cakes allient une crème fouettée légère à des sprinkles colorés, pour de petites créations gourmandes à partager ou à offrir.")}
        </p>

        <div className="max-w-4xl mx-auto space-y-14">
          {/* 1. Pick-up date */}
          <section className="space-y-3">
            <SectionHeading>
              {t("Choose Your Date", "Choisissez votre date")}<span className="text-destructive ml-1">*</span>
            </SectionHeading>
            <p className="text-center text-sm text-muted-foreground">
              {t("Minimum 4 days' notice required.", "Minimum 4 jours à l'avance requis.")}
            </p>
            <div className="flex justify-center">
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-[280px] justify-start text-left font-normal rounded-none",
                      !orderDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {orderDate ? format(orderDate, "PPP") : t("Select your pick-up date", "Sélectionnez votre date de retrait")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="center">
                  <Calendar
                    mode="single"
                    selected={orderDate}
                    onSelect={setOrderDate}
                    disabled={(date) => date < addDays(new Date(), 4)}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
          </section>

          {/* 2. Choose quantity, appears once a date is selected */}
          {orderDate && (
          <section className="space-y-4">
            <SectionHeading>
              {t("Choose Your Quantity", "Choisissez votre quantité")}<span className="text-destructive ml-1">*</span>
            </SectionHeading>
            <div className="flex flex-wrap justify-center gap-3">
              {packs.map((p) => (
                <button
                  key={p.size}
                  onClick={() => {
                    setPackSize(p.size);
                    setSelectedFlavours((prev) => prev.slice(0, p.flavours));
                  }}
                  className={cn(
                    "w-full sm:w-[calc(50%-0.375rem)] lg:w-[calc(33.333%-0.5rem)] border px-5 py-4 text-left transition-all",
                    packSize === p.size
                      ? "border-primary ring-2 ring-primary/30 bg-secondary/50"
                      : "border-border hover:border-primary/50"
                  )}
                >
                  <span className="block font-semibold text-foreground">{t("Pack of " + p.size, "Pack de " + p.size)}</span>
                  <span className="block text-sm text-muted-foreground">
                    {t("Up to " + p.flavours + " flavours · CHF " + p.price, "Jusqu'à " + p.flavours + " parfums · CHF " + p.price)}
                  </span>
                </button>
              ))}
            </div>
            <div className="text-xs text-muted-foreground text-center space-y-0.5">
              <p>{t("Premium flavour: +CHF 1.50 per Dot Cake", "Parfum Premium : +CHF 1.50 par Dot Cake")}</p>
              <p>{t("Deluxe flavour: +CHF 2.50 per Dot Cake", "Parfum Deluxe : +CHF 2.50 par Dot Cake")}</p>
            </div>
          </section>
          )}

          {/* 3. Flavour selection, DIY Kit style tiles */}
          {pack && (
            <section className="space-y-6">
              <SectionHeading>
                {t("Choose up to " + pack.flavours + " Flavours", "Choisissez jusqu'à " + pack.flavours + " parfums")}<span className="text-destructive ml-1">*</span>
              </SectionHeading>
              <p className="text-center text-sm text-muted-foreground">
                {selectedFlavours.length}/{pack.flavours} {t("selected", "sélectionnés")}
              </p>
              {flavorCategories.map((category) => {
                const tier = tierByCategory[category.name];
                return (
                  <div key={category.name} className="space-y-3">
                    <h3 className="text-lg font-medium">
                      {t(tier?.label ?? category.name, "Parfums " + (tier?.label ?? category.name).replace(" Flavours", ""))}
                      {tier && tier.surcharge > 0 && (
                        <span className="text-muted-foreground ml-2 text-sm">({t(tier.note, tierNoteFr[tier.note] ?? tier.note)})</span>
                      )}
                    </h3>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      {category.flavors.map((flavor) => {
                        const isSelected = selectedFlavours.includes(flavor.id);
                        const atCap = !isSelected && selectedFlavours.length >= pack.flavours;
                        return (
                          <div
                            key={flavor.id}
                            className={cn(
                              "bg-card rounded-none overflow-hidden shadow-sm transition-shadow cursor-pointer",
                              isSelected && "ring-2 ring-primary",
                              atCap ? "opacity-40 cursor-not-allowed" : "hover:shadow-lg"
                            )}
                            onClick={() => !atCap && toggleFlavour(flavor.id)}
                          >
                            <div className="aspect-square overflow-hidden bg-muted/30 p-4">
                              <img src={flavor.image} alt={flavor.name} className="w-full h-full object-contain" />
                            </div>
                            <div className="p-3 text-center">
                              <p className="font-sans font-medium text-sm tracking-[0.105em]">{flavor.name}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </section>
          )}

          {/* 4. Add candles, same design as the DIY Kit page */}
          {pack && (
            <section className="space-y-6">
              <SectionHeading>{t("Add Candles (Optional)", "Ajouter des bougies (optionnel)")}</SectionHeading>

              <div className="space-y-4">
                <div className="flex flex-wrap justify-center gap-4 max-w-5xl mx-auto">
                  {kitCandles.slice(0, showAllCandles ? undefined : INITIAL_CANDLES_SHOWN).map((candle) => {
                    const qty = candleSelections[candle.id] || 0;
                    const price = getCandlePrice(candle.id, qty);
                    const hasPackApplied = candle.packSize && qty >= candle.packSize;
                    return (
                      <div key={candle.id} className="flex flex-col items-center w-40 sm:w-48">
                        <img src={candle.image} alt={candle.name} className="h-56 w-56 object-contain mb-2" />
                        <Card className={cn("w-full transition-all", qty > 0 ? "ring-2 ring-primary bg-white/80" : "bg-white/60")}>
                          <CardContent className="p-2 text-center">
                            <h3 className="font-medium text-foreground text-xs mb-0.5">{candle.name}</h3>
                            {candle.hasPack ? (
                              <p className="text-[10px] text-muted-foreground mb-1">
                                CHF {candle.unitPrice}/pièce · Pack {candle.packSize}: CHF {candle.packPrice}
                              </p>
                            ) : (
                              <p className="text-[10px] text-muted-foreground mb-1.5">CHF {candle.unitPrice} / pièce</p>
                            )}
                            <div className="flex items-center justify-center gap-1.5 mb-1">
                              <button
                                onClick={() => handleCandleQtyChange(candle.id, -1)}
                                disabled={qty === 0}
                                className={cn(
                                  "w-6 h-6 rounded-none flex items-center justify-center text-xs font-bold transition-all",
                                  qty === 0
                                    ? "bg-muted text-muted-foreground cursor-not-allowed"
                                    : "bg-primary text-primary-foreground hover:bg-primary/90"
                                )}
                              >
                                −
                              </button>
                              <span className="w-5 text-center font-medium text-foreground text-sm">{qty}</span>
                              <button
                                onClick={() => handleCandleQtyChange(candle.id, 1)}
                                className="w-6 h-6 rounded-none bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold hover:bg-primary/90 transition-all"
                              >
                                +
                              </button>
                            </div>
                            {qty > 0 && candle.hasPack && (
                              <p className={cn("text-[10px] font-medium", hasPackApplied ? "text-green-700" : "text-muted-foreground")}>
                                {hasPackApplied ? t("✓ Pack price applied, CHF " + price, "✓ Prix pack appliqué, CHF " + price) : `CHF ${price}`}
                              </p>
                            )}
                          </CardContent>
                        </Card>
                      </div>
                    );
                  })}
                </div>
              </div>

                            <button
                onClick={() => setShowAllCandles(!showAllCandles)}
                className="w-full flex items-center justify-center gap-1 text-sm text-primary font-medium py-2 hover:underline"
              >
                {showAllCandles ? (
                  <>{t("See less", "Voir moins")} <ChevronUp className="w-4 h-4" /></>
                ) : (
                  <>{t("See more candles", "Voir plus")} <ChevronDown className="w-4 h-4" /></>
                )}
              </button>
            </section>
          )}

          {/* Total + order */}
          {pack && (
            <section className="space-y-6">
              <div className="flex justify-between items-center py-4 bg-secondary/50 px-4">
                <span className="text-sm font-semibold uppercase tracking-[0.105em] text-foreground">
                  {t("Total", "Total")}
                </span>
                <span className="font-semibold text-foreground">CHF {total.toFixed(2)}</span>
              </div>
              <Button
                onClick={handleOrder}
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground py-6 text-base font-medium tracking-[0.105em] rounded-none"
              >
                {t("ADD TO BASKET", "AJOUTER AU PANIER")}
              </Button>
            </section>
          )}
        </div>
      </div>
    </Layout>
  );
};

export default DotCakes;
