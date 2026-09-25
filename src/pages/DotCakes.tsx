import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { CalendarIcon, ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import Layout from "@/components/Layout";
import { useCart } from "@/context/CartContext";
import { useLang } from "@/context/LanguageContext";
import { MULTI_DATE_FULFILLMENT_ENABLED } from "@/lib/featureFlags";
import { isOrderDateDisabled, expressCalendarNotice } from "@/lib/orderDates";
import { expressCalendarProps } from "@/components/ExpressDateNotice";
import { flavorCategories, glutenFreeFlavorCategories, candles as kitCandles, NUMBER_CANDLE_IMAGES_KIT } from "@/pages/KitBentoCake";
import { NUMBER_CANDLE_ID, NUMBER_CANDLE_PRICE, NUMBER_CANDLE_DIGITS, priceCandleSelection, getSimpleCandleQty, changeSimpleCandleQty, upsertCandleSelection, removeCandleSelection } from "@/lib/candleCartHelpers";
import type { CandleSelection } from "@/context/CartContext";
import { ColorFamilyCandleCard, FAMILY_CANDLE_COLORS } from "@/components/ColorFamilyCandleCard";
import { allergenMap, AllergenNotice } from "@/data/allergens";
import { PriceSummaryBar, PriceSummaryPanel, type PriceLine } from "@/components/PriceSummary";
import dotGallery1 from "@/assets/dot-gallery-1.jpg";
import dotGallery2 from "@/assets/dot-gallery-2.jpg";
import dotGallery3 from "@/assets/dot-gallery-3.jpg";
import dotGallery4 from "@/assets/dot-gallery-4.jpg";
import dotGallery5 from "@/assets/dot-gallery-5.jpg";
import dotGallery6 from "@/assets/dot-gallery-6.jpg";
import dotGallery7 from "@/assets/dot-gallery-7.jpg";
import dotGallery8 from "@/assets/dot-gallery-8.jpg";
import dotGallery9 from "@/assets/dot-gallery-9.jpg";

const packs = [
  { size: 4, flavours: 2, price: 35 },
  { size: 6, flavours: 3, price: 51 },
  { size: 9, flavours: 3, price: 75 },
  { size: 12, flavours: 4, price: 99 },
  { size: 20, flavours: 5, price: 160 },
];

const tierByCategory: Record<string, { label: string; surcharge: number; note: string }> = {
  "Standard Flavors": { label: "Standard Flavours", surcharge: 0, note: "included" },
  "Premium Flavors": { label: "Premium Flavours", surcharge: 1.5, note: "+CHF 1.50 per Dot Cake" },
  "Deluxe Flavors": { label: "Deluxe Flavours", surcharge: 2.5, note: "+CHF 2.50 per Dot Cake" },
  "Gluten-Free Standard": { label: "Gluten-Free Standard", surcharge: 2.5, note: "+CHF 2.50 per Dot Cake" },
  "Gluten-Free Premium": { label: "Gluten-Free Premium", surcharge: 3.5, note: "+CHF 3.50 per Dot Cake" },
  "Gluten-Free Deluxe": { label: "Gluten-Free Deluxe", surcharge: 5, note: "+CHF 5.00 per Dot Cake" },
};

const tierNoteFr: Record<string, string> = {
  "included": "inclus",
  "+CHF 1.50 per Dot Cake": "+CHF 1.50 par Dot Cake",
  "+CHF 2.50 per Dot Cake": "+CHF 2.50 par Dot Cake",
  "+CHF 3.50 per Dot Cake": "+CHF 3.50 par Dot Cake",
  "+CHF 5.00 per Dot Cake": "+CHF 5.00 par Dot Cake",
};

const INITIAL_CANDLES_SHOWN = 4;

const dotGallery = [
  dotGallery1, dotGallery2, dotGallery3, dotGallery4,
  dotGallery6, dotGallery7, dotGallery8, dotGallery9, dotGallery5,
];

const DotGallery = () => {
  const { t } = useLang();
  const scrollRef = useRef<HTMLDivElement>(null);
  const scroll = (direction: "left" | "right") => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollBy({ left: direction === "left" ? -320 : 320, behavior: "smooth" });
  };
  return (
    <section className="space-y-6">
      <h2 className="font-sans text-xl font-semibold text-center uppercase tracking-[0.105em] text-foreground">
        {t("Dot Cake Moments", "Dot Cake Moments")}
      </h2>
      <div className="relative overflow-hidden">
        <button onClick={() => scroll("left")} aria-label={t("Previous", "Precedent")}
          className="absolute left-2 top-1/2 -translate-y-1/2 z-10 bg-background/80 hover:bg-background rounded-none p-2 shadow-md">
          <ChevronLeft className="h-5 w-5 text-foreground" />
        </button>
        <div ref={scrollRef} className="flex gap-4 overflow-x-auto scroll-smooth px-3" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
          {dotGallery.map((photo, index) => (
            <div key={index} className="flex-shrink-0 w-64 h-64 overflow-hidden">
              <img src={photo} alt={`Dot Cake ${index + 1}`} loading="lazy" className="w-full h-full object-cover" />
            </div>
          ))}
        </div>
        <button onClick={() => scroll("right")} aria-label={t("Next", "Suivant")}
          className="absolute right-2 top-1/2 -translate-y-1/2 z-10 bg-background/80 hover:bg-background rounded-none p-2 shadow-md">
          <ChevronRight className="h-5 w-5 text-foreground" />
        </button>
      </div>
    </section>
  );
};

const STEPS = [
  { key: "date" },
  { key: "pack" },
  { key: "flavours" },
  { key: "candles" },
  { key: "confirm" },
] as const;

const DotCakes = () => {
  const navigate = useNavigate();
  const { addItem, cartOrderDate } = useCart();
  const { t, lang } = useLang();

  const [step, setStep] = useState(1);
  // While MULTI_DATE_FULFILLMENT_ENABLED is off, pre-filling with the cart's
  // existing date matches the single-date-per-cart rule enforced by
  // CartContext.addItem. Once it's on, start blank so a new pack added from
  // this page doesn't silently inherit whatever date is already in the cart.
  const [orderDate, setOrderDate] = useState<Date | undefined>(() =>
    MULTI_DATE_FULFILLMENT_ENABLED ? undefined : (cartOrderDate ? new Date(cartOrderDate) : undefined)
  );
  const [calOpen, setCalOpen] = useState(false);
  const [packSize, setPackSize] = useState<number | null>(null);
  const [selectedFlavours, setSelectedFlavours] = useState<string[]>([]);
  const [candleSelections, setCandleSelections] = useState<CandleSelection[]>([]);
  const [numberCandleDigits, setNumberCandleDigits] = useState<string[]>([]);
  const [numberCandlePreview, setNumberCandlePreview] = useState("0");
  const [showAllCandles, setShowAllCandles] = useState(false);
  // Bumped when a candle is removed from the price recap, to remount the
  // colour-family candle cards (they keep their own pack/piece counters).
  const [candleCardResetKey, setCandleCardResetKey] = useState(0);

  useEffect(() => {
    setCandleSelections((prev) => {
      const others = prev.filter((c) => c.id !== NUMBER_CANDLE_ID);
      if (numberCandleDigits.length === 0) return others;
      return [...others, { id: NUMBER_CANDLE_ID, quantity: numberCandleDigits.length, hasPack: false }];
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numberCandleDigits]);
  const [showGlutenFree, setShowGlutenFree] = useState(false);
  const [configuratorVisible, setConfiguratorVisible] = useState(false);
  const configuratorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = t("Dot Cakes – Bento Cake Studio", "Dot Cakes – Bento Cake Studio");
    return () => { document.title = "Bento Cake Studio Geneva"; };
  }, [t]);

  const pack = packs.find((p) => p.size === packSize) || null;

  const allFlavours = useMemo(
    () => [...flavorCategories, ...glutenFreeFlavorCategories].flatMap((cat) =>
      cat.flavors.map((fl) => ({ ...fl, category: cat.name }))
    ), []
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

  const handleCandleQtyChange = (candleId: string, delta: number) =>
    setCandleSelections((prev) => changeSimpleCandleQty(prev, candleId, delta));

  const getCandlePrice = (candleId: string) => {
    const entry = candleSelections.find((c) => c.id === candleId);
    if (!entry) return 0;
    return priceCandleSelection(entry, kitCandles.find((c) => c.id === candleId), candleId === NUMBER_CANDLE_ID);
  };

  const candlesTotal = candleSelections.reduce((acc, entry) => acc + getCandlePrice(entry.id), 0);

  const total = useMemo(() => {
    if (!pack) return 0;
    let sum = pack.price;
    // Each flavour always covers its final share of the pack (e.g. 6 dots /
    // 3 flavours = 2), even while some slots are still empty — dividing by
    // the number picked so far made the live total overshoot, then drop back
    // as the remaining flavours were chosen. Identical once all are picked.
    const dotsPerFlavour = pack.size / pack.flavours;
    selectedFlavours.forEach((id) => { sum += dotsPerFlavour * surchargeFor(id); });
    return Math.round((sum + candlesTotal) * 100) / 100;
  }, [pack, selectedFlavours, candlesTotal]);

  const goNext = () => {
    if (step === 1 && !orderDate) {
      toast.error(t("Please choose your pick-up date (minimum 2 days' notice).", "Veuillez choisir votre date de retrait (minimum 2 jours à l'avance)."));
      return;
    }
    if (step === 2 && !pack) {
      toast.error(t("Please choose a pack.", "Veuillez choisir un pack."));
      return;
    }
    if (step === 3 && selectedFlavours.length < (pack?.flavours ?? 1)) {
      toast.error(t("Please choose all " + (pack?.flavours ?? 1) + " flavours.", "Veuillez choisir les " + (pack?.flavours ?? 1) + " parfums."));
      return;
    }
    setStep((s) => Math.min(s + 1, 5));
  };

  const goBack = () => { setStep((s) => Math.max(s - 1, 1)); };
  useEffect(() => {
    if (configuratorVisible) window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [step, configuratorVisible]);

  const handleOrder = () => {
    if (!orderDate || !pack || selectedFlavours.length === 0) return;
    // A flavour can be removed from the price recap at any step, including
    // this last one — send the customer back to fill the empty slot.
    if (selectedFlavours.length < pack.flavours) {
      toast.error(t("Please choose all " + pack.flavours + " flavours.", "Veuillez choisir les " + pack.flavours + " parfums."));
      setStep(3);
      return;
    }
    const flavourNames = selectedFlavours.map((id) => {
      const fl = allFlavours.find((f) => f.id === id)!;
      return `${fl.name} (${tierByCategory[fl.category]?.label ?? fl.category})`;
    });
    const selectedCandles = candleSelections.map((c) =>
      c.id === NUMBER_CANDLE_ID ? { ...c, digits: numberCandleDigits } : c
    );
    // Dot Cakes has no per-order design choice (no design step, and several
    // flavours can be picked at once — no single flavour photo represents
    // the whole item), so unlike Catalog.tsx there's no real "the customer's
    // own photo" to use. Reuses the exact same field (designImageUrl) and
    // the same absolute-URL construction as Catalog.tsx's chosenDesignImage,
    // pointed at this page's own hero photo (dotGallery1, already shown on
    // the landing screen) — so Cart/checkout/the confirmation email finally
    // show a real product photo instead of nothing, same mechanism as Bento
    // Cake end to end, just with a fixed source image for this product line.
    const designImageUrl = new URL(dotGallery1, window.location.origin).href;
    const added = addItem({
      id: "", product: "dot_cakes",
      orderDate: format(orderDate, "yyyy-MM-dd"), orderTime: "",
      size: `dot-cakes-${pack.size}`, sizeName: `Dot Cake Pack of ${pack.size}`,
      shape: "", shapeName: "",
      flavor: selectedFlavours.join(", "), flavorName: flavourNames.join(", "),
      style: "dot-cakes", styleName: "Dot Cakes",
      baseColor: "", baseColorName: "", decorationColor: "", decorationColorName: "",
      cakeText: "", textColor: "", textColorName: "", textStyle: "normal",
      extras: [], extrasNames: [], ribbonColor: "", ribbonColorName: "",
      butterflyColor: "", butterflyColorName: "",
      candles: selectedCandles, comment: "", imageUrls: [], imageFiles: [], total,
      designImageUrl,
    });
    if (!added.ok) {
      toast.error(t("This item's date doesn't match the rest of your cart. Please place a separate order.", "La date de cet article ne correspond pas au reste de votre panier. Merci de passer une commande séparée."));
      return;
    }
    toast.success(t("Dot cakes added to your cart!", "Dot cakes ajoutés à votre panier !"));
    navigate("/cart");
  };

  const stepLabels = [
    t("Date", "Date"),
    t("Pack", "Pack"),
    t("Flavours", "Parfums"),
    t("Candles", "Bougies"),
    t("Confirm", "Confirmer"),
  ];

  const flavourNames = selectedFlavours.map((id) => allFlavours.find((f) => f.id === id)?.name ?? id);

  // Every line making up `total`, for the live price recap. Paid flavours and
  // candles can be dropped from the recap itself.
  const priceLines: PriceLine[] = [];
  if (pack) {
    priceLines.push({ key: "pack", label: t(`Pack of ${pack.size}`, `Pack de ${pack.size}`), price: pack.price, isBase: true });
    const dotsPerFlavour = pack.size / pack.flavours;
    // By slot position, not id: the same flavour may fill two slots.
    selectedFlavours.forEach((id, idx) => {
      const price = Math.round(dotsPerFlavour * surchargeFor(id) * 100) / 100;
      if (price <= 0) return;
      const fl = allFlavours.find((f) => f.id === id);
      priceLines.push({
        key: `flavour-${idx}`,
        label: `${fl?.name ?? id} ×${dotsPerFlavour}`,
        price,
        onRemove: () => setSelectedFlavours((prev) => prev.filter((_, j) => j !== idx)),
      });
    });
    candleSelections.forEach((entry) => {
      const price = getCandlePrice(entry.id);
      if (price <= 0) return;
      if (entry.id === NUMBER_CANDLE_ID) {
        priceLines.push({
          key: "candle-number",
          label: `${t("Number Candle", "Bougie chiffre")} (${numberCandleDigits.join(", ")})`,
          price,
          // The digit list is the source of truth — the effect above drops
          // the candle entry once it's empty.
          onRemove: () => setNumberCandleDigits([]),
        });
        return;
      }
      const candle = kitCandles.find((c) => c.id === entry.id);
      if (!candle) return;
      const name = t(candle.name, candle.nameFr ?? candle.name);
      priceLines.push({
        key: `candle-${entry.id}`,
        label: entry.quantity > 1 ? `${name} ×${entry.quantity}` : name,
        price,
        onRemove: () => {
          setCandleSelections((prev) => removeCandleSelection(prev, entry.id));
          setCandleCardResetKey((k) => k + 1);
        },
      });
    });
  }
  const showPriceSummary = configuratorVisible && !!pack;

  return (
    <Layout>
      <div className="container mx-auto px-4">
      <div className="flex justify-center lg:gap-10">
        {/* SIDEBAR */}

        {/* MAIN */}
        <main className="w-full max-w-2xl mx-auto pt-12 pb-2 px-4">
          <h1 className="font-sans text-4xl md:text-5xl tracking-[0.105em] uppercase text-foreground mb-6 font-semibold text-center">
            {t("Dot Cakes", "Dot Cakes")}
          </h1>
          <p className="text-center text-muted-foreground mb-8 max-w-2xl mx-auto text-sm md:text-base">
            {t("Soft sponge, light whipped cream and colourful sprinkles, in small formats made for sharing.", "Une génoise moelleuse, une crème fouettée légère et des sprinkles colorés réunis dans de petits formats à partager.")}
          </p>

          {/* Starting price */}
          <p className="text-center text-muted-foreground mb-10 max-w-2xl mx-auto text-sm">
            {t("Starting from", "À partir de")} <span className="font-semibold text-foreground">CHF {packs[0].price}</span>
          </p>

          {/* CTA — visible only before configurator opens */}
          {!configuratorVisible && (
            <div className="flex flex-col items-center gap-8 mb-2">
              <button
                onClick={() => {
                  setConfiguratorVisible(true);
                }}
                className="bg-primary hover:bg-primary/90 text-primary-foreground text-[11px] font-semibold uppercase tracking-[0.18em] rounded-none px-10 py-3.5 transition-colors"
              >
                {t("Build your box →", "Composez votre box →")}
              </button>
            </div>
          )}

          {/* Configurator — hidden until CTA clicked */}
          <div
            ref={configuratorRef}
            className={configuratorVisible ? "transition-all duration-500 ease-out opacity-100 translate-y-0" : "pointer-events-none select-none opacity-0 translate-y-4 h-0 overflow-hidden"}
            aria-hidden={!configuratorVisible}
          >

          {/* Stepper */}
          <div className="flex items-start mb-10">
            {STEPS.map((s, i) => {
              const num = i + 1;
              const isActive = step === num;
              const isDone = step > num;
              return (
                <div key={s.key} className="flex-1 flex flex-col items-center relative">
                  {i < STEPS.length - 1 && (
                    <div className={cn(
                      "absolute top-[14px] left-1/2 w-full h-px transition-colors",
                      isDone ? "bg-primary" : "bg-border"
                    )} />
                  )}
                  <div className={cn(
                    "w-7 h-7 flex items-center justify-center border transition-all relative z-10 text-xs font-semibold",
                    isActive && "bg-primary border-primary text-primary-foreground",
                    isDone && "bg-primary border-primary text-primary-foreground",
                    !isActive && !isDone && "bg-background border-border text-muted-foreground"
                  )}>
                    {isDone ? "✓" : num}
                  </div>
                  <span className={cn(
                    "text-[8px] font-semibold uppercase tracking-[0.06em] mt-1 text-center",
                    (isActive || isDone) ? "text-primary" : "text-muted-foreground"
                  )}>
                    {stepLabels[i]}
                  </span>
                </div>
              );
            })}
          </div>

          {/* STEP 1: DATE */}
          {step === 1 && (
            <div className="space-y-6 max-w-2xl mx-auto">
              <h2 className="font-sans text-sm font-semibold uppercase tracking-[0.14em] text-foreground">
                {t("Choose Your Date", "Choisissez votre date")}<span className="text-destructive ml-1">*</span>
              </h2>
              <p className="text-sm text-muted-foreground">
                {t("Minimum 2 days' notice required.", "Minimum 2 jours à l'avance requis.")}
              </p>
              <Popover open={calOpen} onOpenChange={setCalOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" disabled={!MULTI_DATE_FULFILLMENT_ENABLED && !!cartOrderDate}
                    className={cn(
                      "w-full max-w-xs justify-start text-left font-normal rounded-none px-3 text-sm",
                      !orderDate && "text-muted-foreground",
                      !MULTI_DATE_FULFILLMENT_ENABLED && cartOrderDate && "opacity-60 cursor-not-allowed"
                    )}>
                    <CalendarIcon className="mr-2 h-4 w-4 flex-shrink-0" />
                    <span className="truncate">
                      {orderDate ? format(orderDate, "PPP") : t("Select a date", "Choisir une date")}
                    </span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  {/* Food-order lead time: J0/J+1 blocked, J+2+ selectable
                      (was wrongly hardcoded to J+4 here — see
                      src/lib/orderDates.ts, the single shared source of
                      truth for this rule). */}
                  <Calendar {...expressCalendarProps} mode="single" selected={orderDate} onSelect={(d) => { setOrderDate(d); setCalOpen(false); }}
                    disabled={(date) => isOrderDateDisabled(date)} initialFocus />
                </PopoverContent>
              </Popover>
              {/* Outside the Popover on purpose: PopoverContent unmounts the
                  instant a date is picked (onSelect above closes it), so a
                  notice placed inside it can never survive past that same
                  tap/click on mobile OR desktop — it would only ever flash
                  for an instant. Placed here, keyed off orderDate directly,
                  it stays visible once a date is chosen, which is exactly
                  what a touch device (no hover) needs to actually see it. */}
              {expressCalendarNotice(orderDate, lang) && (
                <p className="text-[10px] italic text-muted-foreground">ⓘ {expressCalendarNotice(orderDate, lang)}</p>
              )}
              {!MULTI_DATE_FULFILLMENT_ENABLED && cartOrderDate && (
                <p className="text-xs text-muted-foreground">
                  {t(
                    `All items in this order will be prepared for ${format(new Date(cartOrderDate), "dd.MM.yyyy")}. To order for another date, please place a separate order.`,
                    `Tous les articles de cette commande seront préparés pour le ${format(new Date(cartOrderDate), "dd.MM.yyyy")}. Pour commander pour une autre date, veuillez passer une commande séparée.`
                  )}
                </p>
              )}
              <div className="flex gap-3 pt-4">
                <Button onClick={goNext}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground text-[11px] font-semibold uppercase tracking-[0.12em] rounded-none px-8 py-2.5">
                  {t("Next", "Suivant")} →
                </Button>
              </div>
            </div>
          )}

          {/* STEP 2: PACK */}
          {step === 2 && (
            <div className="space-y-6 max-w-2xl mx-auto">
              <h2 className="font-sans text-sm font-semibold uppercase tracking-[0.14em] text-foreground">
                {t("Choose Your Quantity", "Choisissez votre quantité")}<span className="text-destructive ml-1">*</span>
              </h2>
              <div className="flex flex-col gap-3">
                {packs.map((p) => (
                  <button key={p.size}
                    onClick={() => { setPackSize(p.size); setSelectedFlavours((prev) => prev.slice(0, p.flavours)); }}
                    className={cn(
                      "border px-5 py-4 text-left transition-all",
                      packSize === p.size ? "border-primary ring-2 ring-primary/20 bg-secondary/50" : "border-border hover:border-primary/50"
                    )}>
                    <span className="block font-semibold text-foreground text-sm">{t("Pack of " + p.size, "Pack de " + p.size)}</span>
                    <span className="block text-sm text-muted-foreground">
                      {t(p.flavours + " flavours · CHF " + p.price, p.flavours + " parfums · CHF " + p.price)}
                    </span>
                  </button>
                ))}
              </div>
              <div className="mt-3 mb-1">
                <p className="font-sans text-[10px] font-semibold uppercase tracking-[0.13em] text-foreground/50 mb-2">
                  {t("Flavour supplements per Dot Cake", "Suppléments par Dot Cake")}
                </p>
                {[
                  { label: t("Premium", "Premium"), price: "+CHF 1.50" },
                  { label: t("Deluxe", "Deluxe"), price: "+CHF 2.50" },
                  { label: t("Gluten-free · Premium", "Sans gluten · Premium"), price: "+CHF 3.50" },
                  { label: t("Gluten-free · Deluxe", "Sans gluten · Deluxe"), price: "+CHF 5.00" },
                ].map((row, i) => (
                  <div key={i} className="flex justify-between items-baseline py-1.5 border-b border-border/30 last:border-0">
                    <span className="text-xs text-foreground/70">{row.label}</span>
                    <span className="text-xs font-medium text-foreground tabular-nums">{row.price}</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-3 pt-2">
                <Button variant="outline" onClick={goBack}
                  className="rounded-none border-border text-[11px] font-semibold uppercase tracking-[0.12em] px-6 py-2.5">
                  ← {t("Back", "Retour")}
                </Button>
                <Button onClick={goNext}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground text-[11px] font-semibold uppercase tracking-[0.12em] rounded-none px-8 py-2.5">
                  {t("Next", "Suivant")} →
                </Button>
              </div>
            </div>
          )}

          {/* STEP 3: FLAVOURS */}
          {step === 3 && pack && (
            <div className="space-y-5 max-w-2xl mx-auto">
              <h2 className="font-sans text-sm font-semibold uppercase tracking-[0.14em] text-foreground">
                {t("Choose " + pack.flavours + " Flavours", "Choisissez " + pack.flavours + " parfums")}<span className="text-destructive ml-1">*</span>
              </h2>
              {(() => {
                const allFlavourOptions = [...flavorCategories, ...(showGlutenFree ? glutenFreeFlavorCategories : [])];
                const renderFlavorOption = (flavor: { id: string; name: string; nameFr?: string; description?: string; descriptionFr?: string; image: string }, surcharge: number) => {
                  const info = allergenMap[flavor.id];
                  const label = `${t(flavor.name, (flavor as { nameFr?: string }).nameFr ?? flavor.name)}`;
                  return (
                    <SelectItem key={flavor.id} value={flavor.id} itemText={label}>
                      <div className="flex items-start gap-2">
                        <img src={flavor.image} alt={flavor.name} className="w-12 h-12 object-contain flex-shrink-0" />
                        <div>
                          <span>{t(flavor.name, (flavor as { nameFr?: string }).nameFr ?? flavor.name)}</span>
                          {(flavor.description || flavor.descriptionFr) && (
                            <div className="text-[10px] text-foreground/70 leading-tight mt-0.5 whitespace-normal">
                              {t(flavor.description ?? "", flavor.descriptionFr ?? "")}
                            </div>
                          )}

                        </div>
                      </div>
                    </SelectItem>
                  );
                };
                return (
                  <div className="space-y-3">
                    {Array.from({ length: pack.flavours }, (_, i) => {
                      const currentVal = selectedFlavours[i] ?? "";
                      const info = currentVal ? allergenMap[currentVal] : null;
                      return (
                        <div key={i} className="space-y-1.5">
                          <label className="text-xs font-semibold uppercase tracking-[0.10em] text-foreground/70">
                            {t(`Flavour ${i + 1}`, `Parfum ${i + 1}`)}
                            <span className="text-destructive ml-1">*</span>
                          </label>
                          <Select
                            value={currentVal || (i === 0 ? "" : "__none__")}
                            onValueChange={(v) => {
                              const slots = Array.from({ length: pack.flavours }, (_, j) => selectedFlavours[j] ?? "");
                              slots[i] = v === "__none__" ? "" : v;
                              setSelectedFlavours(slots.filter(s => s !== "" && s !== "__none__"));
                            }}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder={t("Select a flavour", "Choisir un parfum")} />
                            </SelectTrigger>
                            <SelectContent nativeScroll className="w-[min(90vw,420px)]">
                
                              {flavorCategories.map((cat) => {
                                const tier = tierByCategory[cat.name];
                                return (
                                  <SelectGroup key={cat.name}>
                                    <SelectLabel>
                                      {t(tier?.label ?? cat.name, cat.nameFr)}
                                      {tier?.surcharge > 0 ? ` (${t(tier.note, tierNoteFr[tier.note] ?? tier.note)})` : ""}
                                    </SelectLabel>
                                    {cat.flavors.map((fl) => renderFlavorOption(fl, tier?.surcharge ?? 0))}
                                  </SelectGroup>
                                );
                              })}
                              <div className="px-2 py-1">
                                <button
                                  type="button"
                                  onPointerDown={e => e.preventDefault()}
                                  onClick={() => setShowGlutenFree(v => !v)}
                                  className="flex w-full items-center gap-1.5 text-xs font-semibold text-primary uppercase tracking-[0.08em] py-1.5 px-1 hover:underline rounded"
                                >
                                  <ChevronDown className={cn("w-3.5 h-3.5 transition-transform flex-shrink-0", showGlutenFree && "rotate-180")} />
                                  {showGlutenFree
                                    ? t("Hide gluten-free", "Masquer sans gluten")
                                    : t("See gluten-free flavours", "Voir les parfums sans gluten")}
                                </button>
                              </div>
                              {showGlutenFree && glutenFreeFlavorCategories.map((cat) => {
                                const tier = tierByCategory[cat.name];
                                return (
                                  <SelectGroup key={cat.name}>
                                    <SelectLabel>
                                      {t(cat.name, cat.nameFr)}
                                      {tier?.surcharge > 0 ? ` (${t(tier.note, tierNoteFr[tier.note] ?? tier.note)})` : ""}
                                    </SelectLabel>
                                    {cat.flavors.map((fl) => renderFlavorOption(fl, tier?.surcharge ?? 0))}
                                  </SelectGroup>
                                );
                              })}
                            </SelectContent>
                          </Select>

                        </div>
                      );
                    })}
                  </div>
                );
              })()}
              <AllergenNotice className="pt-1" />
              <div className="flex gap-3 pt-2">
                <Button variant="outline" onClick={goBack}
                  className="rounded-none border-border text-[11px] font-semibold uppercase tracking-[0.12em] px-6 py-2.5">
                  ← {t("Back", "Retour")}
                </Button>
                <Button onClick={goNext}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground text-[11px] font-semibold uppercase tracking-[0.12em] rounded-none px-8 py-2.5">
                  {t("Next", "Suivant")} →
                </Button>
              </div>
            </div>
          )}

          {/* STEP 4: CANDLES */}
          {step === 4 && (
            <div className="space-y-6 max-w-2xl mx-auto">
              <h2 className="font-sans text-sm font-semibold uppercase tracking-[0.14em] text-foreground">
                {t("Add Candles (Optional)", "Ajouter des bougies (optionnel)")}
              </h2>

              <div className="grid grid-cols-2 gap-4">

                {/* Number Candle card */}
                <Card className={cn("flex flex-col overflow-hidden bg-white/60 hover:bg-white/80 transition-all border border-foreground/20 rounded-none", numberCandleDigits.length > 0 && "ring-2 ring-primary")}>
                  <div className="flex items-center justify-center bg-secondary/20 p-2 h-28">
                    <img key={numberCandlePreview} src={NUMBER_CANDLE_IMAGES_KIT[numberCandlePreview]} alt={`${t("Number Candle","Bougie chiffre")} ${numberCandlePreview}`} className="h-24 w-24 object-contain transition-all duration-200" />
                  </div>
                  <CardContent className="p-2 text-center space-y-1.5">
                    <h3 className="font-sans tracking-[0.105em] font-semibold uppercase text-foreground text-[11px]">{t("Number Candle","Bougie chiffre")}</h3>
                    <p className="text-[10px] text-muted-foreground">CHF {NUMBER_CANDLE_PRICE} / {t("piece","pièce")}</p>
                    {numberCandleDigits.length > 0 && (
                      <div className="space-y-1 text-left">
                        {numberCandleDigits.map((d, i) => (
                          <div key={i} className="flex items-center gap-1">
                            <span className="text-[9px] text-muted-foreground shrink-0 w-12">{t(`Candle ${i+1}`,`Bougie ${i+1}`)}</span>
                            <Select value={d} onValueChange={(v) => { const next=[...numberCandleDigits]; next[i]=v; setNumberCandleDigits(next); setNumberCandlePreview(v); }}>
                              <SelectTrigger className="h-5 text-xs flex-1 px-1"><SelectValue /></SelectTrigger>
                              <SelectContent>{NUMBER_CANDLE_DIGITS.map((digit) => <SelectItem key={digit} value={digit}>{digit}</SelectItem>)}</SelectContent>
                            </Select>
                            <button onClick={() => setNumberCandleDigits(numberCandleDigits.filter((_,idx)=>idx!==i))} className="text-muted-foreground hover:text-foreground text-xs leading-none px-0.5 shrink-0">×</button>
                          </div>
                        ))}
                      </div>
                    )}
                    <button
                      onClick={() => { setNumberCandleDigits([...numberCandleDigits,"0"]); setNumberCandlePreview("0"); }}
                      className="text-[9px] uppercase tracking-wider text-primary hover:underline font-medium"
                    >+ {t("Add candle","Ajouter")}</button>
                    {numberCandleDigits.length > 0 && (
                      <p className="text-[10px] text-primary font-medium">CHF {numberCandleDigits.length * NUMBER_CANDLE_PRICE}</p>
                    )}
                  </CardContent>
                </Card>
                {/* Other candle cards */}
                {kitCandles.slice(0, showAllCandles ? undefined : INITIAL_CANDLES_SHOWN).map((candle) => {
                  const family = FAMILY_CANDLE_COLORS[candle.id];
                  if (family) {
                    return (
                      <ColorFamilyCandleCard key={`${candle.id}-${candleCardResetKey}`} candle={candle} colors={family}
                        existing={candleSelections.find((c) => c.id === candle.id)}
                        onCommit={(entry) => setCandleSelections((prev) => upsertCandleSelection(prev, entry))}
                        onRemove={() => setCandleSelections((prev) => removeCandleSelection(prev, candle.id))}
                        imageClassName="h-20 w-20" compact />
                    );
                  }
                  const qty = getSimpleCandleQty(candleSelections, candle.id);
                  const price = getCandlePrice(candle.id);
                  const hasPackApplied = candle.packSize && qty >= candle.packSize;
                  return (
                    <Card key={candle.id} className={cn("flex flex-col overflow-hidden bg-white/60 hover:bg-white/80 transition-all border border-foreground/20 rounded-none", qty > 0 && "ring-2 ring-primary")}>
                      <div className="h-28 flex items-center justify-center bg-secondary/20 p-2">
                        <img src={candle.image} alt={t(candle.name, candle.nameFr)} className="h-20 w-20 object-contain" />
                      </div>
                      <CardContent className="p-2 text-center space-y-1.5">
                        <h3 className="font-sans tracking-[0.105em] font-semibold uppercase text-foreground text-[11px]">{t(candle.name, candle.nameFr)}</h3>
                        {candle.hasPack ? (
                          <p className="text-[10px] text-muted-foreground">CHF {candle.unitPrice}/pièce · Pack {candle.packSize}: CHF {candle.packPrice}</p>
                        ) : (
                          <p className="text-[10px] text-muted-foreground">CHF {candle.unitPrice} / pièce</p>
                        )}
                        <div className="flex items-center justify-center gap-1.5">
                          <button onClick={() => handleCandleQtyChange(candle.id, -1)} disabled={qty === 0}
                            className={cn("w-6 h-6 rounded-none flex items-center justify-center text-xs font-bold transition-all", qty === 0 ? "bg-muted text-muted-foreground cursor-not-allowed" : "bg-primary text-primary-foreground hover:bg-primary/90")}>−</button>
                          <span className="w-5 text-center font-medium text-foreground text-sm">{qty}</span>
                          <button onClick={() => handleCandleQtyChange(candle.id, 1)}
                            className="w-6 h-6 rounded-none bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold hover:bg-primary/90 transition-all">+</button>
                        </div>
                        {qty > 0 && candle.hasPack && (
                          <p className={cn("text-[10px] font-medium", hasPackApplied ? "text-green-700" : "text-muted-foreground")}>
                            {hasPackApplied ? `✓ ${t("Pack price applied","Prix pack appliqué")}, CHF ${price}` : `CHF ${price}`}
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              <button onClick={() => setShowAllCandles(!showAllCandles)}
                className="w-full flex items-center justify-center gap-1 text-sm text-primary font-medium py-2 hover:underline">
                {showAllCandles ? (
                  <>{t("See less", "Voir moins")} <ChevronUp className="w-4 h-4" /></>
                ) : (
                  <>{t("See more candles", "Voir plus de bougies")} <ChevronDown className="w-4 h-4" /></>
                )}
              </button>

              <div className="flex gap-3 pt-2">
                <Button variant="outline" onClick={goBack}
                  className="rounded-none border-border text-[11px] font-semibold uppercase tracking-[0.12em] px-6 py-2.5">
                  ← {t("Back", "Retour")}
                </Button>
                <Button onClick={goNext}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground text-[11px] font-semibold uppercase tracking-[0.12em] rounded-none px-8 py-2.5">
                  {t("Review order", "Vérifier la commande")} →
                </Button>
              </div>
            </div>
          )}

          {/* STEP 5: CONFIRM */}
          {step === 5 && pack && orderDate && (
            <div className="space-y-6 max-w-2xl mx-auto">
              <h2 className="font-sans text-sm font-semibold uppercase tracking-[0.14em] text-foreground">
                {t("Review & Confirm", "Vérifier et confirmer")}
              </h2>

              <div className="border border-border divide-y divide-border">
                <div className="flex justify-between px-4 py-3 text-sm">
                  <span className="text-muted-foreground">{t("Date", "Date")}</span>
                  <span className="font-medium">{format(orderDate, "PPP")}</span>
                </div>
                <div className="flex justify-between px-4 py-3 text-sm">
                  <span className="text-muted-foreground">{t("Pack", "Pack")}</span>
                  <span className="font-medium">{t("Pack of " + pack.size, "Pack de " + pack.size)} — CHF {pack.price}</span>
                </div>
                <div className="px-4 py-3 text-sm">
                  <div className="flex justify-between mb-1">
                    <span className="text-muted-foreground">{t("Flavours", "Parfums")}</span>
                    <span className="font-medium">{selectedFlavours.length}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {flavourNames.map((name) => (
                      <span key={name} className="bg-secondary text-foreground text-[11px] font-medium px-2.5 py-1">{name}</span>
                    ))}
                  </div>
                </div>
                {candlesTotal > 0 && (
                  <div className="flex justify-between px-4 py-3 text-sm">
                    <span className="text-muted-foreground">{t("Candles", "Bougies")}</span>
                    <span className="font-medium">CHF {candlesTotal.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between px-4 py-3">
                  <span className="text-sm font-semibold uppercase tracking-[0.08em]">{t("Total", "Total")}</span>
                  <span className="font-semibold">CHF {total.toFixed(2)}</span>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <Button variant="outline" onClick={goBack}
                  className="rounded-none border-border text-[11px] font-semibold uppercase tracking-[0.12em] px-6 py-2.5">
                  ← {t("Edit", "Modifier")}
                </Button>
                <Button onClick={handleOrder}
                  className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground py-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] rounded-none">
                  {t("ADD TO BASKET", "AJOUTER AU PANIER")}
                </Button>
              </div>
            </div>
          )}
          </div> {/* end configurator */}
        </main>

        {/* Desktop: live price recap beside the steps, follows the scroll */}
        {showPriceSummary && (
          <aside className="hidden lg:block w-[300px] shrink-0 self-start sticky top-28 mt-12">
            <PriceSummaryPanel lines={priceLines} total={total} />
          </aside>
        )}
      </div>
      </div>

      {/* Mobile / tablet: live total pinned to the bottom of the screen,
          detail expands upwards. The spacer keeps the end of the page
          reachable above the bar. */}
      {showPriceSummary && (
        <>
          <div className="h-20 lg:hidden" aria-hidden />
          <PriceSummaryBar className="lg:hidden fixed inset-x-0 bottom-0 z-40" lines={priceLines} total={total} />
        </>
      )}

      {/* Gallery — always shown */}
      <div className="container mx-auto px-6 py-8 md:py-16">
        <DotGallery />
      </div>
    </Layout>
  );
};

export default DotCakes;
