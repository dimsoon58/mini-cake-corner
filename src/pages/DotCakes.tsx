import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format, addDays } from "date-fns";
import { CalendarIcon, Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import Layout from "@/components/Layout";
import { useCart } from "@/context/CartContext";
import dotCakesImage from "@/assets/home-cat-dots.png";

/* Flavour tiers — adjust the tier of any flavour here.
   Standard CHF 9 each · Premium CHF 11 each (+1.50/dot in packs) ·
   Deluxe CHF 13 each (+2.50/dot in packs) */
type Tier = "standard" | "premium" | "deluxe";

const tierInfo: Record<Tier, { label: string; individual: number; packSurcharge: number }> = {
  standard: { label: "Standard", individual: 9, packSurcharge: 0 },
  premium: { label: "Premium", individual: 11, packSurcharge: 1.5 },
  deluxe: { label: "Deluxe", individual: 13, packSurcharge: 2.5 },
};

const dotFlavours: { id: string; name: string; tier: Tier }[] = [
  { id: "vanilla", name: "Vanilla", tier: "standard" },
  { id: "chocolate", name: "Chocolate", tier: "standard" },
  { id: "red-velvet", name: "Red Velvet", tier: "standard" },
  { id: "dark-berrylicious", name: "Dark Berrylicious", tier: "premium" },
  { id: "white-berrylicious", name: "White Berrylicious", tier: "premium" },
  { id: "lemon-curd", name: "Lemon Curd", tier: "premium" },
  { id: "orange-blossom", name: "Orange Blossom", tier: "premium" },
  { id: "salted-butter-caramel", name: "Salted Butter Caramel", tier: "deluxe" },
  { id: "tiramisu", name: "Tiramisu", tier: "deluxe" },
  { id: "praline-obsession", name: "Praline Obsession", tier: "deluxe" },
  { id: "pistachio-lovers", name: "Pistachio Lovers", tier: "deluxe" },
  { id: "passion-fruit", name: "Passion Fruit", tier: "deluxe" },
];

const packs = [
  { size: 4, flavours: 2, price: 35 },
  { size: 6, flavours: 3, price: 51 },
  { size: 9, flavours: 3, price: 75 },
  { size: 12, flavours: 4, price: 99 },
  { size: 20, flavours: 5, price: 160 },
];

const CANDLE_PRICE = 2;

type Choice = { kind: "single"; qty: number } | { kind: "pack"; size: number } | null;

const SectionHeading = ({ children }: { children: React.ReactNode }) => (
  <h2 className="font-sans text-xl font-semibold text-center uppercase tracking-[0.105em] text-foreground">
    {children}
  </h2>
);

const DotCakes = () => {
  const navigate = useNavigate();
  const { addItem } = useCart();
  const [orderDate, setOrderDate] = useState<Date | undefined>(undefined);
  const [choice, setChoice] = useState<Choice>(null);
  const [flavourSlots, setFlavourSlots] = useState<string[]>([]);
  const [wantsCandles, setWantsCandles] = useState(false);
  const [candleQty, setCandleQty] = useState(1);

  useEffect(() => {
    document.title = "Dot Cakes – Bento Cake Studio";
    return () => {
      document.title = "Bento Cake Studio Geneva";
    };
  }, []);

  const slots = useMemo(() => {
    if (!choice) return { count: 0, dotsPerSlot: 0 };
    if (choice.kind === "single") return { count: choice.qty, dotsPerSlot: 1 };
    const pack = packs.find((p) => p.size === choice.size)!;
    return { count: pack.flavours, dotsPerSlot: pack.size / pack.flavours };
  }, [choice]);

  const selectChoice = (next: Exclude<Choice, null>) => {
    setChoice(next);
    const count =
      next.kind === "single" ? next.qty : packs.find((p) => p.size === next.size)!.flavours;
    setFlavourSlots(Array(count).fill(""));
  };

  const total = useMemo(() => {
    if (!choice) return 0;
    let sum = 0;
    if (choice.kind === "single") {
      flavourSlots.forEach((id) => {
        const fl = dotFlavours.find((f) => f.id === id);
        sum += fl ? tierInfo[fl.tier].individual : tierInfo.standard.individual;
      });
    } else {
      const pack = packs.find((p) => p.size === choice.size)!;
      sum = pack.price;
      flavourSlots.forEach((id) => {
        const fl = dotFlavours.find((f) => f.id === id);
        if (fl) sum += slots.dotsPerSlot * tierInfo[fl.tier].packSurcharge;
      });
    }
    if (wantsCandles) sum += candleQty * CANDLE_PRICE;
    return sum;
  }, [choice, flavourSlots, slots, wantsCandles, candleQty]);

  const handleOrder = () => {
    if (!orderDate) {
      toast.error("Please pick a date for your order.");
      return;
    }
    if (!choice) {
      toast.error("Please choose a quantity or a pack.");
      return;
    }
    if (flavourSlots.some((s) => !s)) {
      toast.error(`Please choose ${slots.count === 1 ? "your flavour" : `all ${slots.count} flavours`}.`);
      return;
    }

    const flavourNames = flavourSlots.map((id) => {
      const fl = dotFlavours.find((f) => f.id === id)!;
      const dots = slots.dotsPerSlot > 1 ? ` ×${slots.dotsPerSlot}` : "";
      return `${fl.name} (${tierInfo[fl.tier].label})${dots}`;
    });
    const description =
      choice.kind === "single" ? `Dot Cakes ×${choice.qty}` : `Dot Cake Pack of ${choice.size}`;

    addItem({
      id: "",
      orderDate: format(orderDate, "yyyy-MM-dd"),
      orderTime: "",
      size: "dot-cakes",
      sizeName: description,
      shape: "",
      shapeName: "",
      flavor: flavourSlots.join(", "),
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
      extras: wantsCandles ? ["candles"] : [],
      extrasNames: wantsCandles ? [`${candleQty}x Classic candle`] : [],
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

  const choiceButton = (selected: boolean) =>
    cn(
      "border px-5 py-4 text-left transition-all w-full",
      selected
        ? "border-primary ring-2 ring-primary/30 bg-secondary/50"
        : "border-border hover:border-primary/50"
    );

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

        <div className="max-w-3xl mx-auto space-y-14">
          <div className="aspect-[16/9] overflow-hidden">
            <img
              src={dotCakesImage}
              alt="Dot cakes with colourful sprinkles"
              className="w-full h-full object-cover"
            />
          </div>

          {/* 1. Pick a date */}
          <section className="space-y-4">
            <SectionHeading>Pick a Date</SectionHeading>
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
                    disabled={(date) => date < addDays(new Date(), 3)}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
          </section>

          {/* 2. Choose quantity */}
          <section className="space-y-6">
            <SectionHeading>Choose Quantity</SectionHeading>

            <div className="space-y-3">
              <p className="text-sm font-semibold text-foreground uppercase tracking-[0.105em]">
                Individual Dot Cakes
              </p>
              <div className="grid grid-cols-3 gap-3">
                {[1, 2, 3].map((qty) => (
                  <button
                    key={qty}
                    onClick={() => selectChoice({ kind: "single", qty })}
                    className={choiceButton(choice?.kind === "single" && choice.qty === qty)}
                  >
                    <span className="block font-semibold text-foreground">{qty}</span>
                    <span className="block text-sm text-muted-foreground">CHF {qty * 9}</span>
                  </button>
                ))}
              </div>
              <div className="text-xs text-muted-foreground space-y-0.5">
                <p>Standard Flavours — CHF 9 each</p>
                <p>Premium Flavours — CHF 11 each</p>
                <p>Deluxe Flavours — CHF 13 each</p>
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-sm font-semibold text-foreground uppercase tracking-[0.105em]">
                Dot Cake Packs
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {packs.map((pack) => (
                  <button
                    key={pack.size}
                    onClick={() => selectChoice({ kind: "pack", size: pack.size })}
                    className={choiceButton(choice?.kind === "pack" && choice.size === pack.size)}
                  >
                    <span className="block font-semibold text-foreground">Pack of {pack.size}</span>
                    <span className="block text-sm text-muted-foreground">
                      Up to {pack.flavours} flavours · CHF {pack.price}
                    </span>
                  </button>
                ))}
              </div>
              <div className="text-xs text-muted-foreground space-y-0.5">
                <p>Premium flavours: +CHF 1.50 per Dot Cake</p>
                <p>Deluxe flavours: +CHF 2.50 per Dot Cake</p>
              </div>
            </div>
          </section>

          {/* 3. Dynamic flavour selection */}
          {choice && (
            <section className="space-y-4">
              <SectionHeading>
                Choose {slots.count} {slots.count === 1 ? "Flavour" : "Flavours"}
              </SectionHeading>
              <div className="space-y-3">
                {flavourSlots.map((value, i) => (
                  <div key={i} className="space-y-1">
                    <label className="text-sm font-medium text-foreground">
                      Flavour {i + 1}
                      {slots.dotsPerSlot > 1 && (
                        <span className="text-muted-foreground font-normal">
                          {" "}
                          — {slots.dotsPerSlot} dot cakes
                        </span>
                      )}
                    </label>
                    <Select
                      value={value}
                      onValueChange={(v) => {
                        const next = [...flavourSlots];
                        next[i] = v;
                        setFlavourSlots(next);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a flavour" />
                      </SelectTrigger>
                      <SelectContent>
                        {dotFlavours.map((fl) => {
                          const info = tierInfo[fl.tier];
                          const priceLabel =
                            choice.kind === "single"
                              ? `CHF ${info.individual}`
                              : info.packSurcharge > 0
                                ? `+CHF ${info.packSurcharge.toFixed(2)}/dot`
                                : "included";
                          return (
                            <SelectItem key={fl.id} value={fl.id}>
                              {fl.name} · {info.label} ({priceLabel})
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 4. Add candles */}
          {choice && (
            <section className="space-y-4">
              <SectionHeading>Add Candles</SectionHeading>
              <p className="text-center text-sm text-muted-foreground">
                Would you like to add candles to your order?
              </p>
              <div className="flex justify-center gap-3">
                <button
                  onClick={() => setWantsCandles(false)}
                  className={cn(
                    "px-8 py-2 border text-sm font-medium transition-all",
                    !wantsCandles
                      ? "border-primary ring-2 ring-primary/30 bg-secondary/50"
                      : "border-border hover:border-primary/50"
                  )}
                >
                  No thanks
                </button>
                <button
                  onClick={() => setWantsCandles(true)}
                  className={cn(
                    "px-8 py-2 border text-sm font-medium transition-all",
                    wantsCandles
                      ? "border-primary ring-2 ring-primary/30 bg-secondary/50"
                      : "border-border hover:border-primary/50"
                  )}
                >
                  Yes, add candles
                </button>
              </div>
              {wantsCandles && (
                <div className="flex items-center justify-center gap-4">
                  <span className="text-sm text-foreground">
                    Classic candles (CHF {CANDLE_PRICE} each)
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setCandleQty(Math.max(1, candleQty - 1))}
                      className="h-7 w-7 border border-border flex items-center justify-center hover:bg-muted"
                      aria-label="Fewer candles"
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <span className="w-6 text-center text-sm font-medium">{candleQty}</span>
                    <button
                      onClick={() => setCandleQty(Math.min(12, candleQty + 1))}
                      className="h-7 w-7 border border-border flex items-center justify-center hover:bg-muted"
                      aria-label="More candles"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Total + order */}
          {choice && (
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
