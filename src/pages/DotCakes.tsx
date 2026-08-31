import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format, addDays } from "date-fns";
import { CalendarIcon, ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import Layout from "@/components/Layout";
import { useCart } from "@/context/CartContext";
import { useLang } from "@/context/LanguageContext";
import { flavorCategories, glutenFreeFlavorCategories, candles as kitCandles } from "@/pages/KitBentoCake";
import { NUMBER_CANDLE_ID, NUMBER_CANDLE_PRICE, NUMBER_CANDLE_DIGITS, priceCandleSelection, getSimpleCandleQty, changeSimpleCandleQty, upsertCandleSelection, removeCandleSelection } from "@/lib/candleCartHelpers";
import type { CandleSelection } from "@/context/CartContext";
import { ColorFamilyCandleCard, FAMILY_CANDLE_COLORS } from "@/components/ColorFamilyCandleCard";
import { AllergenDisplay, AllergenNotice } from "@/data/allergens";
import { FlavorDesc } from "@/data/flavorDesc";
import dotGallery1 from "@/assets/dot-gallery-1.jpg";
import dotGallery2 from "@/assets/dot-gallery-2.jpg";
import dotGallery3 from "@/assets/dot-gallery-3.jpg";
import dotGallery4 from "@/assets/dot-gallery-4.jpg";
import dotGallery5 from "@/assets/dot-gallery-5.jpg";
import dotGallery6 from "@/assets/dot-gallery-6.jpg";
import dotGallery7 from "@/assets/dot-gallery-7.jpg";
import dotGallery8 from "@/assets/dot-gallery-8.jpg";
import dotGallery9 from "@/assets/dot-gallery-9.jpg";

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
  dotGallery1, dotGallery2, dotGallery3, dotGallery4, dotGallery5,
  dotGallery6, dotGallery7, dotGallery8, dotGallery9,
];

/* Galerie qui defile, meme principe que le carrousel de la page d'accueil */
const DotGallery = () => {
  const { t } = useLang();
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: "left" | "right") => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollBy({
      left: direction === "left" ? -320 : 320,
      behavior: "smooth",
    });
  };

  return (
    <section className="space-y-6">
      <SectionHeading>{t("Dot Cakes in Real Life", "Les Dot Cakes en vrai")}</SectionHeading>
      <div className="relative">
        <button
          onClick={() => scroll("left")}
          aria-label={t("Previous", "Precedent")}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-10 bg-background/80 hover:bg-background rounded-none p-2 shadow-md -ml-3"
        >
          <ChevronLeft className="h-5 w-5 text-foreground" />
        </button>
        <div
          ref={scrollRef}
          className="flex gap-4 overflow-x-auto scroll-smooth px-3"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          {dotGallery.map((photo, index) => (
            <div key={index} className="flex-shrink-0 w-64 h-64 overflow-hidden">
              <img
                src={photo}
                alt={`Dot Cake ${index + 1}`}
                loading="lazy"
                className="w-full h-full object-cover"
              />
            </div>
          ))}
        </div>
        <button
          onClick={() => scroll("right")}
          aria-label={t("Next", "Suivant")}
          className="absolute right-0 top-1/2 -translate-y-1/2 z-10 bg-background/80 hover:bg-background rounded-none p-2 shadow-md -mr-3"
        >
          <ChevronRight className="h-5 w-5 text-foreground" />
        </button>
      </div>
    </section>
  );
};

const SectionHeading = ({ children }: { children: React.ReactNode }) => (
  <h2 className="font-sans text-xl font-semibold text-center uppercase tracking-[0.105em] text-foreground">
    {children}
  </h2>
);

const DotCakes = () => {
  const navigate = useNavigate();
  const { addItem, cartOrderDate } = useCart();
  const { t } = useLang();
  const [orderDate, setOrderDate] = useState<Date | undefined>(() => (cartOrderDate ? new Date(cartOrderDate) : undefined));
  const [packSize, setPackSize] = useState<number | null>(null);
  const [selectedFlavours, setSelectedFlavours] = useState<string[]>([]);
  const [candleSelections, setCandleSelections] = useState<CandleSelection[]>([]);
  const [numberCandleDigit, setNumberCandleDigit] = useState("0");
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
      [...flavorCategories, ...glutenFreeFlavorCategories].flatMap((cat) =>
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
    if (selectedFlavours.length > 0) {
      const dotsPerFlavour = pack.size / selectedFlavours.length;
      selectedFlavours.forEach((id) => {
        sum += dotsPerFlavour * surchargeFor(id);
      });
    }
    return Math.round((sum + candlesTotal) * 100) / 100;
  }, [pack, selectedFlavours, candlesTotal]);

  /* Champs obligatoires : on previent ET on remonte au bon endroit */
  const dateSectionRef = useRef<HTMLElement>(null);
  const packSectionRef = useRef<HTMLElement>(null);
  const flavourSectionRef = useRef<HTMLElement>(null);
  const focusSection = (ref: { current: HTMLElement | null }) => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const handleOrder = () => {
    if (!orderDate) {
      focusSection(dateSectionRef);
      toast.error(t("Please choose your pick-up date (minimum 4 days' notice).", "Veuillez choisir votre date de retrait (minimum 4 jours à l'avance)."));
      return;
    }
    if (!pack) {
      focusSection(packSectionRef);
      toast.error(t("Please choose a pack.", "Veuillez choisir un pack."));
      return;
    }
    if (selectedFlavours.length === 0) {
      focusSection(flavourSectionRef);
      toast.error(t("Please choose up to " + pack.flavours + " flavours (at least one).", "Veuillez choisir jusqu'à " + pack.flavours + " parfums (au moins un)."));
      return;
    }

    const flavourNames = selectedFlavours.map((id) => {
      const fl = allFlavours.find((f) => f.id === id)!;
      return `${fl.name} (${tierByCategory[fl.category]?.label ?? fl.category})`;
    });
    const selectedCandles = candleSelections.map((c) =>
      c.id === NUMBER_CANDLE_ID ? { ...c, digit: numberCandleDigit } : c
    );

    const added = addItem({
      id: "",
      product: "dot_cakes",
      orderDate: format(orderDate, "yyyy-MM-dd"),
      orderTime: "",
      // Pack-specific (not the old generic "dot-cakes" literal) so the
      // backend can determine the voucher base directly from this field
      // instead of trusting a free-text display string.
      size: `dot-cakes-${pack.size}`,
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
      extrasNames: [],
      ribbonColor: "",
      ribbonColorName: "",
      butterflyColor: "",
      butterflyColorName: "",
      candles: selectedCandles,
      comment: "",
      imageUrls: [],
      imageFiles: [],
      total,
    });
    if (!added) {
      toast.error(t("This item's date doesn't match the rest of your cart. Please place a separate order.", "La date de cet article ne correspond pas au reste de votre panier. Merci de passer une commande séparée."));
      return;
    }
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
          {t("Soft sponge, light whipped cream and colourful sprinkles, in small formats made for sharing.", "Une génoise moelleuse, une crème fouettée légère et des sprinkles colorés réunis dans de petits formats à partager.")}
        </p>

        <div className="max-w-4xl mx-auto space-y-14">
          {/* 1. Pick-up date */}
          <section ref={dateSectionRef} className="space-y-3">
            <SectionHeading>
              {t("Choose Your Date", "Choisissez votre date")}<span className="text-destructive ml-1">*</span>
            </SectionHeading>
            <p className="text-center text-sm text-muted-foreground">
              {t("Minimum 4 days' notice required.", "Minimum 4 jours à l'avance requis.")}
            </p>
            <div className="flex justify-center px-4">
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    disabled={!!cartOrderDate}
                    className={cn(
                      "w-full max-w-[320px] justify-start text-left font-normal rounded-none px-3 text-sm",
                      !orderDate && "text-muted-foreground",
                      cartOrderDate && "opacity-60 cursor-not-allowed"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4 flex-shrink-0" />
                    <span className="truncate">
                      {orderDate ? format(orderDate, "PPP") : t("Select your pick-up date", "Sélectionnez votre date de retrait")}
                    </span>
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
            {cartOrderDate && (
              <p className="text-center text-xs text-muted-foreground">
                {t(
                  `All items in this order will be prepared for ${format(new Date(cartOrderDate), "dd.MM.yyyy")}. To order for another date, please place a separate order.`,
                  `Tous les articles de cette commande seront préparés pour le ${format(new Date(cartOrderDate), "dd.MM.yyyy")}. Pour commander pour une autre date, veuillez passer une commande séparée.`
                )}
              </p>
            )}
          </section>

          {/* 2. Choose quantity, appears once a date is selected */}
          {orderDate && (
          <section ref={packSectionRef} className="space-y-4">
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
              <p>{t("Gluten-Free Premium flavour: +CHF 3.50 per Dot Cake", "Parfum Sans Gluten Premium : +CHF 3.50 par Dot Cake")}</p>
              <p>{t("Gluten-Free Deluxe flavour: +CHF 5.00 per Dot Cake", "Parfum Sans Gluten Deluxe : +CHF 5.00 par Dot Cake")}</p>
            </div>
          </section>
          )}

          {/* 3. Flavour selection, DIY Kit style tiles */}
          {pack && (
            <section ref={flavourSectionRef} className="space-y-6">
              <SectionHeading>
                {t("Choose up to " + pack.flavours + " Flavours", "Choisissez jusqu'à " + pack.flavours + " parfums")}<span className="text-destructive ml-1">*</span>
              </SectionHeading>
              <p className="text-center text-sm text-muted-foreground">
                {selectedFlavours.length}/{pack.flavours} {t("selected", "sélectionnés")}
              </p>
              {[...flavorCategories, ...glutenFreeFlavorCategories].map((category) => {
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
                              <FlavorDesc flavorId={flavor.id} />
                              <AllergenDisplay flavorId={flavor.id} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              <AllergenNotice className="pt-2" />
            </section>
          )}

          {/* 4. Add candles, same design as the DIY Kit page */}
          {pack && (
            <section className="space-y-6">
              <SectionHeading>{t("Add Candles (Optional)", "Ajouter des bougies (optionnel)")}</SectionHeading>

              <div className="space-y-4">
                <div className="flex flex-wrap justify-center gap-4 max-w-5xl mx-auto">
                  {kitCandles.slice(0, showAllCandles ? undefined : INITIAL_CANDLES_SHOWN).map((candle) => {
                    const family = FAMILY_CANDLE_COLORS[candle.id];
                    if (family) {
                      return (
                        <div key={candle.id} className="w-40 sm:w-48 min-w-0">
                          <ColorFamilyCandleCard
                            candle={candle}
                            colors={family}
                            existing={candleSelections.find((c) => c.id === candle.id)}
                            onCommit={(entry) => setCandleSelections((prev) => upsertCandleSelection(prev, entry))}
                            onRemove={() => setCandleSelections((prev) => removeCandleSelection(prev, candle.id))}
                            imageClassName="h-56 w-56"
                            compact
                          />
                        </div>
                      );
                    }

                    const qty = getSimpleCandleQty(candleSelections, candle.id);
                    const price = getCandlePrice(candle.id);
                    const hasPackApplied = candle.packSize && qty >= candle.packSize;
                    return (
                      <div key={candle.id} className="w-40 sm:w-48 min-w-0">
                        <Card className={cn("flex flex-col overflow-hidden w-full bg-white/60 hover:bg-white/80 transition-all", qty > 0 && "ring-2 ring-primary")}>
                          <div className="flex items-center justify-center bg-secondary/20 p-2">
                            <img src={candle.image} alt={t(candle.name, candle.nameFr)} className="h-56 w-56 object-contain" />
                          </div>
                          <CardContent className="p-2 text-center">
                            <h3 className="font-medium text-foreground text-xs mb-0.5">{t(candle.name, candle.nameFr)}</h3>
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

                  {/* Number Candle — digit picker, no product photo, flat rate */}
                  <div className="w-40 sm:w-48 min-w-0">
                    <Card className={cn("flex flex-col overflow-hidden w-full bg-white/60 hover:bg-white/80 transition-all", getSimpleCandleQty(candleSelections, NUMBER_CANDLE_ID) > 0 && "ring-2 ring-primary")}>
                      <div className="h-56 flex items-center justify-center bg-secondary/20 p-2">
                        <span className="text-6xl font-bold text-primary" aria-hidden="true">{numberCandleDigit}</span>
                      </div>
                      <CardContent className="p-2 text-center">
                        <h3 className="font-medium text-foreground text-xs mb-0.5">{t("Number Candle", "Bougie chiffre")}</h3>
                        <p className="text-[10px] text-muted-foreground mb-1.5">CHF {NUMBER_CANDLE_PRICE} / pièce</p>
                        <Select value={numberCandleDigit} onValueChange={setNumberCandleDigit}>
                          <SelectTrigger className="h-7 text-xs mb-1.5" aria-label={t("Choose a digit", "Choisir un chiffre")}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {NUMBER_CANDLE_DIGITS.map((digit) => (
                              <SelectItem key={digit} value={digit}>{digit}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <div className="flex items-center justify-center gap-1.5 mb-1">
                          <button onClick={() => handleCandleQtyChange(NUMBER_CANDLE_ID, -1)} disabled={getSimpleCandleQty(candleSelections, NUMBER_CANDLE_ID) === 0}
                            className={cn("w-6 h-6 rounded-none flex items-center justify-center text-xs font-bold transition-all",
                              getSimpleCandleQty(candleSelections, NUMBER_CANDLE_ID) === 0 ? "bg-muted text-muted-foreground cursor-not-allowed" : "bg-primary text-primary-foreground hover:bg-primary/90"
                            )}>−</button>
                          <span className="w-5 text-center font-medium text-foreground text-sm">{getSimpleCandleQty(candleSelections, NUMBER_CANDLE_ID)}</span>
                          <button onClick={() => handleCandleQtyChange(NUMBER_CANDLE_ID, 1)}
                            className="w-6 h-6 rounded-none bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold hover:bg-primary/90 transition-all">+</button>
                        </div>
                        {getSimpleCandleQty(candleSelections, NUMBER_CANDLE_ID) > 0 && (
                          <p className="text-[10px] text-primary font-medium">CHF {getCandlePrice(NUMBER_CANDLE_ID)}</p>
                        )}
                      </CardContent>
                    </Card>
                  </div>
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

          <DotGallery />
        </div>
      </div>
    </Layout>
  );
};

export default DotCakes;
