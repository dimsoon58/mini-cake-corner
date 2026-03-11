import { useState, useRef, useEffect } from "react";
// @ts-ignore
import "@fontsource/dancing-script";
import { Link } from "react-router-dom";
import { format, addDays } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useCart, CandleCartItem } from "@/context/CartContext";
import { ShoppingBag, Trash2, ArrowLeft, Pencil, CalendarIcon, Check, Plus, Minus, Upload, X, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import Layout from "@/components/Layout";
import { supabase } from "@/integrations/supabase/client";
import {
  sizes,
  shapes,
  allFlavors,
  flavorCategories,
  styles,
  extras,
  candles as customizationCandles,
  baseColors,
  textColors,
  ribbonColors,
  butterflyColors,
  glitterColors,
  glitterCherriesColors,
  calculateCartItemTotal,
  CandleSelection,
  getExcludedExtras,
  extraGroups,
  extraDescriptions,
  getAvailableSizesForStyle,
} from "@/data/customization";

// Import images for catalogExtras
import extraGoldLeaves from "@/assets/extra-gold-leaves.png";
import extraCherries from "@/assets/extra-cherries.png";
import extraGlitterCherries from "@/assets/extra-glitter-cherries.png";
import designScatteredPearls from "@/assets/design-scattered-pearls-new.jpg";
import designGlitterCake from "@/assets/design-glitter-cake-new.jpg";
import designGlitterInAir from "@/assets/design-glitter-in-air-new.jpg";
import designPearlBorders from "@/assets/design-pearl-borders-new.jpg";
import extraRetro from "@/assets/extra-retro.png";
import designRibbons from "@/assets/design-ribbons-new.jpg";
import extraDrawing from "@/assets/extra-drawing.png";
import extraHeart from "@/assets/extra-heart.png";
import designButterflyGarden from "@/assets/design-butterfly-garden-new.jpg";
import designPearlNumber from "@/assets/design-pearl-number-new.jpg";
import extraPrintedPicture from "@/assets/extra-printed-picture.png";
import extraButterfly from "@/assets/extra-butterfly.png";
import extraRibbons from "@/assets/extra-ribbons.png";
import extraSprinkles from "@/assets/extra-sprinkles-new.jpg";

const catalogExtras = [
  { id: "gold-leaves", name: "Gold Leaves", price: { bento: 2, retro: 4, medium: 5, large: 8 }, image: extraGoldLeaves },
  { id: "cherries", name: "Cherries", price: { retro: 4, medium: 8, large: 12 }, image: extraCherries },
  { id: "glitter-cherries", name: "Glitter Cherries", price: { retro: 7, medium: 10, large: 15 }, image: extraGlitterCherries },
  { id: "scattered-pearl", name: "Scattered Pearl", price: { bento: 2, retro: 4, medium: 5, large: 6 }, image: designScatteredPearls },
  { id: "glitter", name: "Glitter", price: { bento: 4, retro: 4, medium: 8, large: 10 }, image: designGlitterCake },
  { id: "glitter-base", name: "Glitter Base", price: { bento: 6, retro: 8, medium: 10, large: 12 }, image: designGlitterCake },
  { id: "glitter-in-the-air", name: "Glitter in the Air", price: { bento: 10, retro: 12, medium: 15, large: 20 }, image: designGlitterInAir },
  { id: "pearl-border", name: "Pearl Border (each)", price: { retro: 8, medium: 15, large: 20 }, image: designPearlBorders },
  { id: "retro", name: "Retro", price: { retro: 5, medium: 15, large: 20 }, image: extraRetro },
  { id: "ribbons", name: "Ribbons", price: { retro: 5, medium: 8, large: 10 }, image: extraRibbons },
  { id: "drawing", name: "Drawing", price: { bento: 5, retro: 5, medium: 8, large: 10 }, image: extraDrawing },
  { id: "heart", name: "Heart", price: { bento: 3, retro: 5, medium: 10, large: 15 }, image: extraHeart },
  { id: "butterfly", name: "Butterfly", price: { bento: 4, retro: 6, medium: 8, large: 10 }, image: extraButterfly },
  { id: "pearl-number", name: "Pearl Number", price: { bento: 5, retro: 5, medium: 5, large: 5 }, image: designPearlNumber },
  { id: "printed-picture", name: "Printed Picture", price: { bento: 15, retro: 15, medium: 15, large: 15 }, image: extraPrintedPicture },
  { id: "sprinkles", name: "Sprinkles", price: { bento: 2, retro: 4, medium: 4, large: 6 }, image: extraSprinkles },
];

// Candles reordered: packs first, then individuals
const cartCandles = [
  ...customizationCandles.filter(c => c.hasPack),
  ...customizationCandles.filter(c => !c.hasPack),
];

const formatDateFromIso = (dateValue: string) => {
  const [year, month, day] = dateValue.split("-");
  return year && month && day ? `${day}.${month}.${year}` : dateValue;
};

const Cart = () => {
  const { items, removeItem, updateItem, clearCart, itemCount } = useCart();
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [fullyBookedDates, setFullyBookedDates] = useState<Date[]>([]);

  useEffect(() => {
    const fetchBookedDates = async () => {
      const { data, error } = await supabase.rpc('get_fully_booked_dates');
      if (!error && data) {
        setFullyBookedDates(data.map((d: { booked_date: string }) => new Date(d.booked_date)));
      }
    };
    fetchBookedDates();
  }, []);

  const totalPrice = items.reduce((sum, item) => sum + item.total, 0);

  const recalcAndUpdate = (itemId: string, updates: Record<string, any>) => {
    const item = items.find(i => i.id === itemId);
    if (!item) return;
    const merged = { ...item, ...updates };
    // Calculate extras price from catalogExtras
    const extrasPrice = (merged.extras || []).reduce((acc: number, extraId: string) => {
      const extra = catalogExtras.find(e => e.id === extraId);
      if (!extra) return acc;
      return acc + (extra.price[merged.size as keyof typeof extra.price] || 0);
    }, 0);
    const newTotal = calculateCartItemTotal(
      merged.size, merged.shape, merged.flavor, merged.style,
      [], merged.candles || []
    ) + extrasPrice;
    updateItem(itemId, { ...updates, total: newTotal });
  };

  const handleSizeChange = (itemId: string, sizeId: string) => {
    const sizeObj = sizes.find(s => s.id === sizeId);
    recalcAndUpdate(itemId, { size: sizeId, sizeName: sizeObj?.name || "" });
  };

  const handleFlavorChange = (itemId: string, flavorId: string) => {
    const flavorObj = allFlavors.find(f => f.id === flavorId);
    recalcAndUpdate(itemId, { flavor: flavorId, flavorName: flavorObj?.name || "" });
  };

  const handleStyleChange = (itemId: string, styleId: string) => {
    const styleObj = styles.find(s => s.id === styleId);
    const updates: Record<string, any> = { style: styleId, styleName: styleObj?.name || "" };
    if (styleId === "printed-picture") {
      updates.cakeText = "";
      updates.textColor = "";
      updates.textColorName = "";
    }
    if (styleId === "normal-without-border") {
      updates.decorationColor = "";
      updates.decorationColorName = "";
    }
    // Reset size if current size is not available for the new style
    const item = items.find(i => i.id === itemId);
    if (item) {
      const availableSizes = getAvailableSizesForStyle(styleId);
      if (!availableSizes.includes(item.size)) {
        const newSizeId = availableSizes[0] || "bento";
        const newSizeObj = sizes.find(s => s.id === newSizeId);
        updates.size = newSizeId;
        updates.sizeName = newSizeObj?.name || "";
      }
      // Remove incompatible extras when design changes
      const excluded = getExcludedExtras(styleId);
      const currentExtras = item.extras || [];
      const filteredExtras = currentExtras.filter(e => !excluded.includes(e));
      if (filteredExtras.length !== currentExtras.length) {
        updates.extras = filteredExtras;
        updates.extrasNames = filteredExtras.map(id => catalogExtras.find(e => e.id === id)?.name || "");
        // Clear color selections for removed extras
        if (!filteredExtras.includes("glitter")) updates.glitterColor = "";
        if (!filteredExtras.includes("ribbons")) { updates.ribbonColor = ""; updates.ribbonColorName = ""; }
        if (!filteredExtras.includes("butterfly")) { updates.butterflyColor = ""; updates.butterflyColorName = ""; }
        if (!filteredExtras.includes("glitter-cherries")) updates.glitterCherriesColor = "";
      }
    }
    recalcAndUpdate(itemId, updates);
  };

  const handleBaseColorChange = (itemId: string, colorId: string) => {
    const colorObj = baseColors.find(c => c.id === colorId);
    recalcAndUpdate(itemId, { baseColor: colorId, baseColorName: colorObj?.name || "" });
  };

  const handleDecoColorChange = (itemId: string, colorId: string) => {
    const colorObj = baseColors.find(c => c.id === colorId);
    recalcAndUpdate(itemId, { decorationColor: colorId, decorationColorName: colorObj?.name || "" });
  };

  const handleTextChange = (itemId: string, text: string) => {
    recalcAndUpdate(itemId, { cakeText: text });
  };

  const handleTextColorChange = (itemId: string, colorId: string) => {
    const colorObj = textColors.find(c => c.id === colorId);
    recalcAndUpdate(itemId, { textColor: colorId, textColorName: colorObj?.name || "" });
  };

  const handleTextStyleChange = (itemId: string, styleId: string) => {
    recalcAndUpdate(itemId, { textStyle: styleId });
  };

  const handleToggleExtra = (itemId: string, extraId: string) => {
    const item = items.find(i => i.id === itemId);
    if (!item) return;
    const currentExtras = item.extras || [];
    let newExtras: string[];
    let newExtrasNames: string[];
    if (currentExtras.includes(extraId)) {
      newExtras = currentExtras.filter(e => e !== extraId);
      newExtrasNames = newExtras.map(id => catalogExtras.find(e => e.id === id)?.name || "");
      const updates: Record<string, any> = { extras: newExtras, extrasNames: newExtrasNames };
      // Clear related color selections when deselecting
      if (extraId === "glitter") updates.glitterColor = "";
      if (extraId === "ribbons") { updates.ribbonColor = ""; updates.ribbonColorName = ""; }
      if (extraId === "butterfly") { updates.butterflyColor = ""; updates.butterflyColorName = ""; }
      if (extraId === "glitter-cherries") updates.glitterCherriesColor = "";
      recalcAndUpdate(itemId, updates);
    } else {
      newExtras = [...currentExtras, extraId];
      newExtrasNames = newExtras.map(id => catalogExtras.find(e => e.id === id)?.name || "");
      recalcAndUpdate(itemId, { extras: newExtras, extrasNames: newExtrasNames });
    }
  };

  const handleRibbonColorChange = (itemId: string, colorId: string) => {
    const colorObj = ribbonColors.find(c => c.id === colorId);
    recalcAndUpdate(itemId, { ribbonColor: colorId, ribbonColorName: colorObj?.name || "" });
  };

  const handleButterflyColorChange = (itemId: string, colorId: string) => {
    const colorObj = butterflyColors.find(c => c.id === colorId);
    recalcAndUpdate(itemId, { butterflyColor: colorId, butterflyColorName: colorObj?.name || "" });
  };

  const handleGlitterColorChange = (itemId: string, colorId: string) => {
    recalcAndUpdate(itemId, { glitterColor: colorId });
  };

  const handleGlitterCherriesColorChange = (itemId: string, colorId: string) => {
    recalcAndUpdate(itemId, { glitterCherriesColor: colorId });
  };

  const handleCommentChange = (itemId: string, comment: string) => {
    updateItem(itemId, { comment });
  };

  const handleImageFilesChange = (itemId: string, imageFiles: File[]) => {
    updateItem(itemId, { imageFiles });
  };

  const handleCandleQuantityChange = (itemId: string, candleId: string, delta: number) => {
    const item = items.find(i => i.id === itemId);
    if (!item) return;
    const currentCandles: CandleCartItem[] = item.candles || [];
    const existingIndex = currentCandles.findIndex(c => c.id === candleId && !c.hasPack);
    let newCandles = [...currentCandles];
    if (existingIndex >= 0) {
      const newQty = newCandles[existingIndex].quantity + delta;
      if (newQty <= 0) {
        newCandles = newCandles.filter((_, i) => i !== existingIndex);
      } else {
        newCandles[existingIndex] = { ...newCandles[existingIndex], quantity: newQty };
      }
    } else if (delta > 0) {
      newCandles.push({ id: candleId, quantity: 1, hasPack: false });
    }
    recalcAndUpdate(itemId, { candles: newCandles });
  };

  const getCandleUnitQty = (item: typeof items[0], candleId: string) => {
    return (item.candles || []).find(c => c.id === candleId && !c.hasPack)?.quantity || 0;
  };

  const getCandleItemPrice = (candleId: string, itemCandles: CandleCartItem[]) => {
    const candle = cartCandles.find(c => c.id === candleId);
    if (!candle) return 0;
    const unitQty = (itemCandles || []).find(c => c.id === candleId && !c.hasPack)?.quantity || 0;
    if (unitQty === 0) return 0;
    if (candle.hasPack && unitQty >= (candle.packSize || 6)) {
      const packs = Math.floor(unitQty / (candle.packSize || 6));
      const remaining = unitQty % (candle.packSize || 6);
      return packs * (candle.packPrice || 0) + remaining * candle.unitPrice;
    }
    return candle.unitPrice * unitQty;
  };

  return (
    <Layout>
      <main className="container mx-auto px-4 py-12">
        <div className="flex items-center justify-between mb-8">
          <Link to="/" className="inline-flex items-center text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Continue Shopping
          </Link>
          <div className="flex items-center gap-2">
            <ShoppingBag className="h-6 w-6 text-primary" />
            <span className="text-lg font-medium text-foreground">Your Basket ({itemCount})</span>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="text-center py-20">
            <ShoppingBag className="h-16 w-16 text-muted-foreground mx-auto mb-6" />
            <h2 className="font-serif text-3xl text-foreground mb-4">Your basket is empty</h2>
            <p className="text-muted-foreground mb-8">Start customizing your perfect cake!</p>
            <Button asChild><Link to="/catalog">Customize Your Cake</Link></Button>
          </div>
        ) : (
          <div className="grid lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-4">
              <div className="flex justify-between items-center mb-4">
                <h2 className="font-serif text-2xl text-foreground">Your Items</h2>
                <Button variant="ghost" size="sm" onClick={clearCart} className="text-destructive hover:text-destructive">Clear All</Button>
              </div>

              {items.map((item) => {
                const isEditing = editingItemId === item.id;
                return (
                  <Card key={item.id} className="overflow-hidden">
                    <CardContent className="p-6">
                      <div className="flex justify-between items-start mb-4">
                        <h3 className="font-serif text-xl text-foreground">{item.sizeName} {item.shapeName} Cake</h3>
                        <div className="flex items-center gap-2">
                          <Button variant="ghost" size="sm" onClick={() => setEditingItemId(isEditing ? null : item.id)} className="text-primary hover:text-primary">
                            {isEditing ? <Check className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
                            {isEditing ? "Done" : "Edit"}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => removeItem(item.id)} className="text-destructive hover:text-destructive">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>

                      {isEditing ? (
                        <CartItemEditor
                          item={item}
                          fullyBookedDates={fullyBookedDates}
                          onDateChange={(date) => updateItem(item.id, { orderDate: format(date, "yyyy-MM-dd") })}
                          onSizeChange={(v) => handleSizeChange(item.id, v)}
                          onFlavorChange={(v) => handleFlavorChange(item.id, v)}
                          onStyleChange={(v) => handleStyleChange(item.id, v)}
                          onBaseColorChange={(v) => handleBaseColorChange(item.id, v)}
                          onDecoColorChange={(v) => handleDecoColorChange(item.id, v)}
                          onTextChange={(v) => handleTextChange(item.id, v)}
                          onTextColorChange={(v) => handleTextColorChange(item.id, v)}
                          onTextStyleChange={(v) => handleTextStyleChange(item.id, v)}
                          onToggleExtra={(extraId) => handleToggleExtra(item.id, extraId)}
                          onRibbonColorChange={(v) => handleRibbonColorChange(item.id, v)}
                          onButterflyColorChange={(v) => handleButterflyColorChange(item.id, v)}
                          onGlitterColorChange={(v) => handleGlitterColorChange(item.id, v)}
                          onGlitterCherriesColorChange={(v) => handleGlitterCherriesColorChange(item.id, v)}
                          onCommentChange={(v) => handleCommentChange(item.id, v)}
                          onImageUrlsChange={(urls) => handleImageUrlsChange(item.id, urls)}
                          onCandleQtyChange={(candleId, delta) => handleCandleQuantityChange(item.id, candleId, delta)}
                          getCandleUnitQty={(candleId) => getCandleUnitQty(item, candleId)}
                          getCandleItemPrice={(candleId) => getCandleItemPrice(candleId, item.candles || [])}
                        />
                      ) : (
                        <CartItemSummary item={item} />
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Order Summary */}
            <div className="lg:col-span-1">
              <Card className="sticky top-8">
                <CardContent className="p-6 space-y-4">
                  <h3 className="font-serif text-xl text-foreground">Order Summary</h3>
                  <div className="space-y-2 border-b border-border pb-4">
                    {items.map((item) => (
                      <div key={item.id} className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{item.sizeName} {item.shapeName} Cake</span>
                        <span className="text-foreground">CHF {item.total}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between text-lg font-bold">
                    <span className="text-foreground">Total</span>
                    <span className="text-primary">CHF {totalPrice}</span>
                  </div>
                  <Button className="w-full" size="lg" asChild><Link to="/checkout">Proceed to Checkout</Link></Button>
                  <Button variant="outline" className="w-full" asChild><Link to="/catalog">Add Another Cake</Link></Button>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </main>
    </Layout>
  );
};

/* ---------- Summary (read-only view) ---------- */
const CartItemSummary = ({ item }: { item: any }) => {
  const candleNames = (item.candles || [])
    .filter((c: CandleCartItem) => c.quantity > 0)
    .map((c: CandleCartItem) => {
      const candle = cartCandles.find(x => x.id === c.id);
      return candle ? `${candle.name} ×${c.quantity}` : "";
    })
    .filter(Boolean);

  return (
    <div className="space-y-2">
      {item.orderDate && <p className="text-sm text-muted-foreground">📅 {formatDateFromIso(item.orderDate)}</p>}
      <p className="text-muted-foreground">Flavor: {item.flavorName}</p>
      <p className="text-muted-foreground">Design: {item.styleName}</p>
      {item.baseColorName && (
        <p className="text-sm text-muted-foreground">
          Base: {item.baseColorName}
          {item.decorationColorName && ` · Deco: ${item.decorationColorName}`}
        </p>
      )}
      {item.cakeText && <p className="text-sm text-muted-foreground">Text: "{item.cakeText}"</p>}
      {item.extras && item.extras.length > 0 && (
        <div className="text-sm text-muted-foreground">
          {extraGroups.map((group) => {
            const selectedInGroup = group.ids.filter(id => item.extras.includes(id));
            if (selectedInGroup.length === 0) return null;
            const names = selectedInGroup.map(id => catalogExtras.find(e => e.id === id)?.name || id);
            return (
              <p key={group.label}>{group.label}: {names.join(", ")}</p>
            );
          })}
        </div>
      )}
      {item.comment && <p className="text-sm text-muted-foreground">Comment: {item.comment}</p>}
      {candleNames.length > 0 && <p className="text-sm text-muted-foreground">Candles: {candleNames.join(", ")}</p>}
      <p className="text-xl font-bold text-primary text-right">CHF {item.total}</p>
    </div>
  );
};

/* ---------- Editor ---------- */
interface CartItemEditorProps {
  item: any;
  fullyBookedDates: Date[];
  onDateChange: (date: Date) => void;
  onSizeChange: (v: string) => void;
  onFlavorChange: (v: string) => void;
  onStyleChange: (v: string) => void;
  onBaseColorChange: (v: string) => void;
  onDecoColorChange: (v: string) => void;
  onTextChange: (v: string) => void;
  onTextColorChange: (v: string) => void;
  onTextStyleChange: (v: string) => void;
  onToggleExtra: (extraId: string) => void;
  onRibbonColorChange: (v: string) => void;
  onButterflyColorChange: (v: string) => void;
  onGlitterColorChange: (v: string) => void;
  onGlitterCherriesColorChange: (v: string) => void;
  onCommentChange: (v: string) => void;
  onImageUrlsChange: (urls: string[]) => void;
  onCandleQtyChange: (candleId: string, delta: number) => void;
  getCandleUnitQty: (candleId: string) => number;
  getCandleItemPrice: (candleId: string) => number;
}

const CartItemEditor = ({
  item, fullyBookedDates,
  onDateChange, onSizeChange, onFlavorChange, onStyleChange,
  onBaseColorChange, onDecoColorChange, onTextChange, onTextColorChange, onTextStyleChange,
  onToggleExtra, onRibbonColorChange, onButterflyColorChange,
  onGlitterColorChange, onGlitterCherriesColorChange,
  onCommentChange, onImageUrlsChange,
  onCandleQtyChange, getCandleUnitQty, getCandleItemPrice,
}: CartItemEditorProps) => {
  const showDecoColor = item.style !== "normal-without-border";
  const showText = item.style !== "printed-picture";
  const excludedExtras = getExcludedExtras(item.style);
  const availableSizeIds = getAvailableSizesForStyle(item.style);
  const commentFileInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingImages, setIsUploadingImages] = useState(false);

  const handleCommentImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    const currentUrls: string[] = item.imageUrls || [];
    const remainingSlots = Math.max(0, 5 - currentUrls.length);
    const files = selectedFiles.slice(0, remainingSlots);

    if (!files.length) {
      if (commentFileInputRef.current) commentFileInputRef.current.value = "";
      return;
    }

    setIsUploadingImages(true);

    try {
      const now = new Date();
      const year = String(now.getFullYear());
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const folderId = item.id || crypto.randomUUID();
      const uploadedUrls: string[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
        const filePath = `${year}/${month}/${folderId}/reference_${currentUrls.length + i + 1}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from("order-images")
          .upload(filePath, file, { contentType: file.type, upsert: false });

        if (uploadError) {
          throw new Error(uploadError.message);
        }

        const { data } = supabase.storage.from("order-images").getPublicUrl(filePath);
        uploadedUrls.push(data.publicUrl);
      }

      onImageUrlsChange([...currentUrls, ...uploadedUrls]);
    } catch (error) {
      console.error("Reference image upload error:", error);
    } finally {
      setIsUploadingImages(false);
      if (commentFileInputRef.current) commentFileInputRef.current.value = "";
    }
  };

  const removeCommentImage = (index: number) => {
    const currentUrls: string[] = item.imageUrls || [];
    onImageUrlsChange(currentUrls.filter((_: string, i: number) => i !== index));
  };

  const getExtraPriceForSize = (extra: typeof catalogExtras[0]) => {
    return extra.price[item.size as keyof typeof extra.price] || 0;
  };

  return (
    <TooltipProvider delayDuration={200}>
    <div className="space-y-6">
      {/* Date */}
      <EditSection label="Pickup Date" tooltip="Order preparation date (minimum 4 days in advance)" required>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !item.orderDate && "text-muted-foreground")}>
              <CalendarIcon className="mr-2 h-4 w-4" />
              {item.orderDate ? formatDateFromIso(item.orderDate) : <span>Pick a date</span>}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={item.orderDate ? new Date(item.orderDate) : undefined}
              onSelect={(date) => { if (date) onDateChange(date); }}
              disabled={(date) => {
                const minDate = addDays(new Date(), 4);
                minDate.setHours(0, 0, 0, 0);
                if (date < minDate) return true;
                return fullyBookedDates.some(b => b.toDateString() === date.toDateString());
              }}
              initialFocus
              className="p-3 pointer-events-auto"
            />
          </PopoverContent>
        </Popover>
      </EditSection>

      {/* Size with box images */}
      <EditSection label="Size" tooltip="Choose the size of your cake." required>
        <div className="grid grid-cols-1 gap-2">
          {sizes.filter(size => availableSizeIds.includes(size.id)).map((size) => (
            <button
              key={size.id}
              onClick={() => onSizeChange(size.id)}
              className={cn(
                "flex items-center gap-3 p-3 rounded-lg border transition-all text-left",
                item.size === size.id ? "ring-2 ring-primary bg-secondary border-primary" : "border-border hover:bg-muted/50"
              )}
            >
              <img src={size.image} alt={size.name} className="h-12 w-12 object-contain rounded" />
              <div className="flex-1">
                <span className="font-medium text-foreground">{size.name}</span>
                <span className="text-sm text-muted-foreground ml-2">CHF {size.price}</span>
              </div>
              {item.size === size.id && <Check className="h-4 w-4 text-primary" />}
            </button>
          ))}
        </div>
      </EditSection>

      {/* Flavor with images */}
      <EditSection label="Flavor" tooltip="Please select the flavor of your cake." required>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {flavorCategories.map(cat => cat.flavors.map(flavor => (
            <button
              key={flavor.id}
              onClick={() => onFlavorChange(flavor.id)}
              className={cn(
                "flex items-center gap-2 p-2 rounded-lg border transition-all text-left",
                item.flavor === flavor.id ? "ring-2 ring-primary bg-secondary border-primary" : "border-border hover:bg-muted/50"
              )}
            >
              <img src={flavor.image} alt={flavor.name} className="h-10 w-10 object-contain rounded" />
              <span className="text-xs font-medium text-foreground leading-tight">{flavor.name}</span>
            </button>
          )))}
        </div>
      </EditSection>

      {/* Design */}
      <EditSection label="Design" tooltip="You can select any design. You can also add extras and/or inspiration pictures in the next steps.">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {styles.map((style) => (
            <button
              key={style.id}
              onClick={() => onStyleChange(style.id)}
              className={cn(
                "flex flex-col items-center gap-1 p-2 rounded-lg border transition-all",
                item.style === style.id ? "ring-2 ring-primary bg-secondary border-primary" : "border-border hover:bg-muted/50"
              )}
            >
              <img src={style.image} alt={style.name} className="h-16 w-16 object-cover rounded" />
              <span className="text-xs font-medium text-foreground text-center leading-tight">{style.name}</span>
              {item.size && style.price[item.size as keyof typeof style.price] > 0 && (
                <span className="text-xs text-primary">+CHF {style.price[item.size as keyof typeof style.price]}</span>
              )}
            </button>
          ))}
        </div>
      </EditSection>

      {/* Base Color */}
      <EditSection label="Base Color" tooltip="The base color is essential to personalize your cake." required>
        <ColorPicker colors={baseColors} selected={item.baseColor} onSelect={onBaseColorChange} />
      </EditSection>

      {/* Decoration Color */}
      {showDecoColor && (
        <EditSection label="Decoration Color" tooltip="Choose the colors for the decorative elements of your cake." required>
          <ColorPicker colors={baseColors} selected={item.decorationColor} onSelect={onDecoColorChange} />
        </EditSection>
      )}

      {/* Text */}
      {showText && (
        <EditSection label="Cake Text" tooltip="If you would like to add text, you can choose the typography.">
          {/* Text Style Selection */}
          <div className="space-y-2 mb-3">
            <p className="text-xs font-medium text-muted-foreground">Text Style</p>
            <div className="flex gap-2">
              {[
                { id: "normal", name: "Normal" },
                { id: "uppercase", name: "Uppercase" },
                { id: "cursive", name: "Cursive" },
              ].map((style) => (
                <button
                  key={style.id}
                  onClick={() => onTextStyleChange(style.id)}
                  className={cn(
                    "flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all",
                    (item.textStyle || "normal") === style.id
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80",
                    style.id === "cursive" && "font-normal",
                  )}
                  style={style.id === "cursive" ? { fontFamily: "'Dancing Script', cursive" } : undefined}
                >
                  {style.name}
                </button>
              ))}
            </div>
          </div>

          <Input
            placeholder="Enter text for your cake (max 30 chars)"
            value={item.cakeText || ""}
            onChange={(e) => onTextChange(e.target.value.slice(0, 30))}
            maxLength={30}
          />
          <p className="text-xs text-muted-foreground text-right">{(item.cakeText || "").length}/30</p>

          {/* Live text preview */}
          {item.cakeText && (
            <div className="bg-muted/30 rounded-lg p-3 text-center mt-1">
              <p className="text-xs text-muted-foreground mb-1">Preview:</p>
              <p
                className={cn(
                  "text-lg text-foreground",
                  (item.textStyle || "normal") !== "cursive" && "font-medium"
                )}
                style={(item.textStyle || "normal") === "cursive" ? { fontFamily: "'Dancing Script', cursive", fontSize: "1.25rem" } : undefined}
              >
                {(item.textStyle || "normal") === "uppercase" ? (item.cakeText || "").toUpperCase() : item.cakeText}
              </p>
            </div>
          )}

          {item.cakeText && (
            <div className="mt-2">
              <p className="text-xs font-medium text-muted-foreground mb-1">Text Color</p>
              <ColorPicker colors={textColors} selected={item.textColor} onSelect={onTextColorChange} />
            </div>
          )}
        </EditSection>
      )}

      {/* Extras */}
      <EditSection label="✨ Extra" tooltip="You can add any additional elements to personalize your design.">
        {extraGroups.map((group) => {
          const visibleExtras = group.ids
            .map(id => catalogExtras.find(e => e.id === id))
            .filter((extra): extra is typeof catalogExtras[0] => !!extra && !excludedExtras.includes(extra.id));
          if (visibleExtras.length === 0) return null;
          return (
            <div key={group.label} className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{group.label}</p>
              <div className="grid grid-cols-2 gap-2">
                {visibleExtras.map((extra) => {
                  const isSelected = (item.extras || []).includes(extra.id);
                  const price = getExtraPriceForSize(extra);
                  return (
                    <button
                      key={extra.id}
                      onClick={() => onToggleExtra(extra.id)}
                      className={cn(
                        "flex items-center gap-2 p-2 rounded-lg border transition-all text-left",
                        isSelected
                          ? "ring-2 ring-primary border-primary bg-secondary/50"
                          : "border-border hover:border-primary/50"
                      )}
                    >
                      <img src={extra.image} alt={extra.name} className="w-10 h-10 object-cover rounded flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1">
                          <p className="text-xs font-medium text-foreground truncate">{extra.name}</p>
                          {extraDescriptions[extra.id] && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Info className="w-3 h-3 text-muted-foreground cursor-help flex-shrink-0" />
                              </TooltipTrigger>
                              <TooltipContent side="top">
                                <p className="text-xs max-w-[200px]">{extraDescriptions[extra.id]}</p>
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                        <p className="text-[10px] text-primary">+CHF {price}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Glitter Color */}
        {((item.extras || []).some(e => ["glitter", "glitter-base", "glitter-in-the-air"].includes(e)) || ["retro-glitter-cake", "retro-ribbons-glitter"].includes(item.style)) && (
          <div className="space-y-2 mt-3">
            <p className="text-xs font-medium text-foreground">Glitter Color <span className="text-destructive">*</span></p>
            <div className="flex flex-wrap gap-2">
              {(() => {
                const isGlitterInTheAir = (item.extras || []).includes("glitter-in-the-air") || item.style === "retro-ribbons-glitter";
                const availableColors = isGlitterInTheAir ? glitterColors.filter(c => c.id === "pink") : glitterColors;
                return availableColors.map((color) => (
                  <button
                    key={color.id}
                    onClick={() => onGlitterColorChange(color.id)}
                    className={cn(
                      "flex flex-col items-center gap-1 p-1 rounded-lg transition-all",
                      (item as any).glitterColor === color.id ? "ring-2 ring-primary" : ""
                    )}
                  >
                    <div className={cn("w-6 h-6 rounded-full border", color.id === "white" ? "border-muted-foreground/30" : "border-transparent")} style={{ backgroundColor: color.color }} />
                    <span className="text-[10px] text-foreground">{color.name}</span>
                  </button>
                ));
              })()}
            </div>
          </div>
        )}

        {/* Glitter Cherries Color */}
        {((item.extras || []).includes("glitter-cherries") || item.style === "glitter-cherries-retro") && (
          <div className="space-y-2 mt-3">
            <p className="text-xs font-medium text-foreground">Glitter Cherries Color</p>
            <div className="flex flex-wrap gap-2">
              {glitterCherriesColors.map((color) => (
                <button
                  key={color.id}
                  onClick={() => onGlitterCherriesColorChange(color.id)}
                  className={cn(
                    "flex flex-col items-center gap-1 p-1 rounded-lg transition-all",
                    (item as any).glitterCherriesColor === color.id ? "ring-2 ring-primary" : ""
                  )}
                >
                  <div className={cn("w-6 h-6 rounded-full border", color.id === "white" ? "border-muted-foreground/30" : "border-transparent")} style={{ backgroundColor: color.color }} />
                  <span className="text-[10px] text-foreground">{color.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Ribbon Color */}
        {((item.extras || []).includes("ribbons") || item.style === "retro-ribbons" || item.style === "retro-ribbons-glitter") && (
          <div className="space-y-2 mt-3">
            <p className="text-xs font-medium text-foreground">Ribbon Color <span className="text-destructive">*</span></p>
            <div className="flex flex-wrap gap-2">
              {ribbonColors.map((color) => (
                <button
                  key={color.id}
                  onClick={() => onRibbonColorChange(color.id)}
                  className={cn(
                    "flex flex-col items-center gap-1 p-1 rounded-lg transition-all",
                    item.ribbonColor === color.id ? "ring-2 ring-primary" : ""
                  )}
                >
                  <div className={cn("w-6 h-6 rounded-full border", color.id === "white" ? "border-muted-foreground/30" : "border-transparent")} style={{ backgroundColor: color.color }} />
                  <span className="text-[10px] text-foreground">{color.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Butterfly Color */}
        {((item.extras || []).includes("butterfly") || item.style === "butterfly-garden") && (
          <div className="space-y-2 mt-3">
            <p className="text-xs font-medium text-foreground">Butterfly Color <span className="text-destructive">*</span></p>
            <div className="flex flex-wrap gap-2">
              {butterflyColors.map((color) => (
                <button
                  key={color.id}
                  onClick={() => onButterflyColorChange(color.id)}
                  className={cn(
                    "flex flex-col items-center gap-1 p-1 rounded-lg transition-all",
                    item.butterflyColor === color.id ? "ring-2 ring-primary" : ""
                  )}
                >
                  <div className="w-6 h-6 rounded-full border border-muted" style={{ backgroundColor: color.color }} />
                  <span className="text-[10px] text-foreground">{color.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </EditSection>

      {/* Comment */}
      <EditSection label="💬 Comment" tooltip="Write any guidelines you would like to clarify. Please note that if you request decorations or extras that were not selected, the price may change.">
        <Textarea
          value={item.comment || ""}
          onChange={(e) => onCommentChange(e.target.value)}
          placeholder="Any special requests or details about your cake..."
          className="min-h-[80px]"
        />
      </EditSection>

      {/* Upload */}
      <EditSection label="Upload" tooltip="Upload an inspiration picture if you would like.">
        <p className="text-xs text-muted-foreground mb-2">
          Upload reference images (max 5 — JPG, PNG, WEBP)
        </p>
        <input
          ref={commentFileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          onChange={handleCommentImageUpload}
          className="hidden"
        />
        {(item.imageUrls || []).length < 5 && (
          <button
            onClick={() => commentFileInputRef.current?.click()}
            disabled={isUploadingImages}
            className="w-full border-2 border-dashed border-border rounded-lg p-4 flex flex-col items-center gap-1 hover:border-primary/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Upload className="w-6 h-6 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">{isUploadingImages ? "Uploading..." : "Click to upload images"}</span>
          </button>
        )}
        {(item.imageUrls || []).length > 0 && (
          <>
            <div className="flex flex-wrap gap-2 mt-2">
              {(item.imageUrls || []).map((url: string, index: number) => (
                <div key={url} className="relative w-16 h-16">
                  <img
                    src={url}
                    alt={`Reference ${index + 1}`}
                    className="w-full h-full object-cover rounded-lg"
                  />
                  <button
                    onClick={() => removeCommentImage(index)}
                    className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 hover:bg-destructive/80"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground/80 italic mt-2 leading-tight">
              When a client provides an inspiration photo, it is for reference only. Bento Cake Studio SNC will create a design inspired by it and aim to respect the colors and style, but an identical reproduction is not guaranteed.
            </p>
          </>
        )}
      </EditSection>

      {/* Candles - packs first, then individual */}
      <EditSection label="🕯️ Candles">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {cartCandles.map((candle) => {
            const qty = getCandleUnitQty(candle.id);
            const price = getCandleItemPrice(candle.id);
            const isPackApplied = candle.hasPack && qty >= (candle.packSize || 6);
            return (
              <div
                key={candle.id}
                className={cn(
                  "flex flex-col items-center p-2 rounded-lg border transition-all",
                  qty > 0 ? "ring-2 ring-primary border-primary bg-secondary" : "border-border"
                )}
              >
                <img src={candle.image} alt={candle.name} className="h-16 w-16 object-contain mb-1" />
                <span className="text-xs font-medium text-foreground text-center">{candle.name}</span>
                <span className="text-xs text-muted-foreground">CHF {candle.unitPrice}/ea</span>
                {candle.hasPack && (
                  <span className="text-[10px] text-muted-foreground">Pack {candle.packSize} = CHF {candle.packPrice}</span>
                )}
                <div className="flex items-center gap-2 mt-2">
                  <button
                    onClick={() => onCandleQtyChange(candle.id, -1)}
                    disabled={qty === 0}
                    className="h-7 w-7 rounded-full border border-border flex items-center justify-center text-foreground disabled:opacity-30 hover:bg-muted"
                  >
                    <Minus className="h-3 w-3" />
                  </button>
                  <span className="text-sm font-medium w-6 text-center text-foreground">{qty}</span>
                  <button
                    onClick={() => onCandleQtyChange(candle.id, 1)}
                    className="h-7 w-7 rounded-full border border-border flex items-center justify-center text-foreground hover:bg-muted"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>
                {qty > 0 && <span className="text-xs text-primary font-medium mt-1">CHF {price}</span>}
                {isPackApplied && <span className="text-xs text-green-600 font-medium">✓ Pack applied</span>}
              </div>
            );
          })}
        </div>
      </EditSection>
    </div>
    </TooltipProvider>
  );
};

/* ---------- Shared sub-components ---------- */
const EditSection = ({ label, children, tooltip, required }: { label: string; children: React.ReactNode; tooltip?: string; required?: boolean }) => (
  <div className="space-y-2">
    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
      {label}
      {required && <span className="text-destructive">*</span>}
      {tooltip && (
        <Tooltip>
          <TooltipTrigger asChild><Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" /></TooltipTrigger>
          <TooltipContent><p className="text-xs max-w-[200px]">{tooltip}</p></TooltipContent>
        </Tooltip>
      )}
    </label>
    {children}
  </div>
);

const ColorPicker = ({
  colors,
  selected,
  onSelect,
}: { colors: typeof baseColors; selected: string; onSelect: (id: string) => void }) => (
  <div className="flex flex-wrap gap-2">
    {colors.map((c) => (
      <button
        key={c.id}
        onClick={() => onSelect(c.id)}
        title={c.name}
        className={cn(
          "h-8 w-8 rounded-full border-2 transition-all flex items-center justify-center",
          selected === c.id ? "ring-2 ring-primary ring-offset-2" : "border-border hover:scale-110"
        )}
        style={{ backgroundColor: c.color }}
      >
        {selected === c.id && (
          <Check className={cn("h-4 w-4", c.id === "white" || c.id === "cream" || c.id === "pastel-yellow" ? "text-foreground" : "text-white")} />
        )}
      </button>
    ))}
  </div>
);

export default Cart;
