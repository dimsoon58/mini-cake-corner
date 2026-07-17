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

const INITIAL_CANDLES_SHOWN = 4;

const SectionHeading = ({ children }: { children: React.ReactNode }) => (
  <h2 className="font-sans text-xl font-semibold text-center uppercase tracking-[0.105em] text-foreground">
    {children}
  </h2>
);

const DotCakes = () => {
  const navigate = useNavigate();
  const { addItem } = useCart();
  const [orderDate, setOrderDate] = useState<Date | undefined>(undefined);
  const [packSize, setPackSize] = useState<number | null>(null);
  const [selectedFlavours, setSelectedFlavours] = useState<string[]>([]);
  const [candleSelections, setCandleSelections] = useState<Record<string, number>>({});
  const [showAllCandles, setShowAllCandles] = useState(false);

  useEffect(() => {
    document.title = "Dot Cakes – Bento Cake Studio";
    return () => {
      document.title = "Bento Cake Studio Geneva";
    };
  }, []);

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
      toast.error("Please choose your pick-up date (minimum 4 days' notice).");
      return;
    }
    if (!pack) {
      toast.error("Please choose a pack.");
      return;
    }
    if (selectedFlavours.length === 0) {
      toast.error(`Please choose up to ${pack.flavours} flavours (at least one).`);
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
    toast.success("Dot cakes added to your basket!");
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
          Bite-sized cakes topped with a cloud of colourful sprinkles — perfect
          for parties, gifts and moments when one cake just isn't enough.
        </p>

        <div className="max-w-4xl mx-auto space-y-14">
          {/* 1. Pick-up date */}
          <section className="space-y-3">
            <SectionHeading>Choose Your Pick-Up Date</SectionHeading>
            <p className="text-center text-sm text-muted-foreground">
              Minimum 4 days' notice required.
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
                    {orderDate ? format(orderDate, "PPP") : "Select your pick-up date"}
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

          {/* 2. Choose quantity — packs only */}
          <section className="space-y-4">
            <SectionHeading>Choose Quantity</SectionHeading>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {packs.map((p) => (
                <button
                  key={p.size}
                  onClick={() => {
                    setPackSize(p.size);
                    setSelectedFlavours((prev) => prev.slice(0, p.flavours));
                  }}
                  className={cn(
                    "border px-5 py-4 text-left transition-all",
                    packSize === p.size
                      ? "border-primary ring-2 ring-primary/30 bg-secondary/50"
                      : "border-border hover:border-primary/50"
                  )}
                >
                  <span className="block font-semibold text-foreground">Pack of {p.size}</span>
                  <span className="block text-sm text-muted-foreground">
                    Up to {p.flavours} flavours · CHF {p.price}
                  </span>
                </button>
              ))}
            </div>
            <div className="text-xs text-muted-foreground text-center space-y-0.5">
              <p>Premium flavour: +CHF 1.50 per Dot Cake</p>
              <p>Deluxe flavour: +CHF 2.50 per Dot Cake</p>
            </div>
          </section>

          {/* 3. Flavour selection — DIY Kit style tiles */}
          {pack && (
            <section className="space-y-6">
              <SectionHeading>
                Choose up to {pack.flavours} Flavours
              </SectionHeading>
              <p className="text-center text-sm text-muted-foreground">
                {selectedFlavours.length}/{pack.flavours} selected
              </p>
              {flavorCategories.map((category) => {
                const tier = tierByCategory[category.name];
                return (
                  <div key={category.name} className="space-y-3">
                    <h3 className="text-lg font-medium">
                      {tier?.label ?? category.name}
                      {tier && tier.surcharge > 0 && (
                        <span className="text-muted-foreground ml-2 text-sm">({tier.note})</span>
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
                              <p className="font-serif font-medium text-sm">{flavor.name}</p>
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

          {/* 4. Add candles — same design as the DIY Kit page */}
          {pack && (
            <section className="space-y-6">
              <SectionHeading>Add Candles (Optional)</SectionHeading>

              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-center text-foreground/80">
                  Ombré & Spirales (Pack de 6 disponible)
                </h3>
                <div className="flex flex-wrap justify-center gap-4 max-w-4xl mx-auto">
                  {packCandles.slice(0, showAllCandles ? undefined : INITIAL_CANDLES_SHOWN).map((candle) => {
                    const qty = candleSelections[candle.id] || 0;
                    const price = getCandlePrice(candle.id, qty);
                    const hasPackApplied = candle.packSize && qty >= candle.packSize;
                    return (
                      <div key={candle.id} className="flex flex-col items-center w-40 sm:w-48">
                        <img src={candle.image} alt={candle.name} className="h-56 w-56 object-contain mb-2" />
                        <Card className={cn("w-full transition-all", qty > 0 ? "ring-2 ring-primary bg-white/80" : "bg-white/60")}>
                          <CardContent className="p-2 text-center">
                            <h3 className="font-medium text-foreground text-xs mb-0.5">{candle.name}</h3>
                            <p className="text-[10px] text-muted-foreground mb-1">
                              CHF {candle.unitPrice}/pièce · Pack {candle.packSize}: CHF {candle.packPrice}
                            </p>
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
                            {qty > 0 && (
                              <p className={cn("text-[10px] font-medium", hasPackApplied ? "text-green-700" : "text-muted-foreground")}>
                                {hasPackApplied ? `✓ Pack price applied — CHF ${price}` : `CHF ${price}`}
                              </p>
                            )}
                          </CardContent>
                        </Card>
                      </div>
                    );
                  })}
                </div>
              </div>

              {showAllCandles && (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-center text-foreground/80">Individual Candles</h3>
                  <div className="flex flex-wrap justify-center gap-4 max-w-5xl mx-auto">
                    {individualCandles.map((candle) => {
                      const qty = candleSelections[candle.id] || 0;
                      return (
                        <div key={candle.id} className="flex flex-col items-center w-40 sm:w-48">
                          <img src={candle.image} alt={candle.name} className="h-56 w-56 object-contain mb-2" />
                          <Card className={cn("w-full transition-all", qty > 0 ? "ring-2 ring-primary bg-white/80" : "bg-white/60")}>
                            <CardContent className="p-2 text-center">
                              <h3 className="font-medium text-foreground text-xs mb-0.5">{candle.name}</h3>
                              <p className="text-[10px] text-muted-foreground mb-1.5">CHF {candle.unitPrice} / pièce</p>
                              <div className="flex items-center justify-center gap-1.5">
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
                            </CardContent>
                          </Card>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <button
                onClick={() => setShowAllCandles(!showAllCandles)}
                className="w-full flex items-center justify-center gap-1 text-sm text-primary font-medium py-2 hover:underline"
              >
                {showAllCandles ? (
                  <>See less <ChevronUp className="w-4 h-4" /></>
                ) : (
                  <>See more candles <ChevronDown className="w-4 h-4" /></>
                )}
              </button>
            </section>
          )}

          {/* Total + order */}
          {pack && (
            <section className="space-y-6">
              <div className="flex justify-between items-center py-4 bg-secondary/50 px-4">
                <span className="text-sm font-semibold uppercase tracking-[0.105em] text-foreground">
                  Total
                </span>
                <span className="font-semibold text-foreground">CHF {total.toFixed(2)}</span>
              </div>
              <Button
                onClick={handleOrder}
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground py-6 text-base font-medium tracking-[0.105em] rounded-none"
              >
                ADD TO BASKET
              </Button>
            </section>
          )}
        </div>
      </div>
    </Layout>
  );
};

export default DotCakes;
