import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { format, addDays } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { useCart, CandleCartItem } from "@/context/CartContext";
import { ShoppingBag, Trash2, ArrowLeft, Pencil, CalendarIcon, Check, Plus, Minus } from "lucide-react";
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
  candles,
  baseColors,
  textColors,
  ribbonColors,
  butterflyColors,
  calculateCartItemTotal,
  CandleSelection,
} from "@/data/customization";

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
    const newTotal = calculateCartItemTotal(
      merged.size, merged.shape, merged.flavor, merged.style,
      merged.extras, merged.candles || []
    );
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
    const candle = candles.find(c => c.id === candleId);
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
const CartItemSummary = ({ item }: { item: typeof import("@/context/CartContext").CartProvider extends never ? never : any }) => {
  const candleNames = (item.candles || [])
    .filter((c: CandleCartItem) => c.quantity > 0)
    .map((c: CandleCartItem) => {
      const candle = candles.find(x => x.id === c.id);
      return candle ? `${candle.name} ×${c.quantity}` : "";
    })
    .filter(Boolean);

  return (
    <div className="space-y-2">
      {item.orderDate && <p className="text-sm text-muted-foreground">📅 {format(new Date(item.orderDate), "PPP")}</p>}
      <p className="text-muted-foreground">Flavor: {item.flavorName}</p>
      <p className="text-muted-foreground">Design: {item.styleName}</p>
      {item.baseColorName && (
        <p className="text-sm text-muted-foreground">
          Base: {item.baseColorName}
          {item.decorationColorName && ` · Deco: ${item.decorationColorName}`}
        </p>
      )}
      {item.cakeText && <p className="text-sm text-muted-foreground">Text: "{item.cakeText}"</p>}
      {item.extrasNames.length > 0 && <p className="text-sm text-muted-foreground">Extras: {item.extrasNames.join(", ")}</p>}
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
  onCandleQtyChange: (candleId: string, delta: number) => void;
  getCandleUnitQty: (candleId: string) => number;
  getCandleItemPrice: (candleId: string) => number;
}

const CartItemEditor = ({
  item, fullyBookedDates,
  onDateChange, onSizeChange, onFlavorChange, onStyleChange,
  onBaseColorChange, onDecoColorChange, onTextChange, onTextColorChange,
  onCandleQtyChange, getCandleUnitQty, getCandleItemPrice,
}: CartItemEditorProps) => {
  const showDecoColor = item.style !== "normal-without-border";
  const showText = item.style !== "printed-picture";

  return (
    <div className="space-y-6">
      {/* Date */}
      <EditSection label="Pickup Date">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !item.orderDate && "text-muted-foreground")}>
              <CalendarIcon className="mr-2 h-4 w-4" />
              {item.orderDate ? format(new Date(item.orderDate), "PPP") : <span>Pick a date</span>}
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
      <EditSection label="Size">
        <div className="grid grid-cols-1 gap-2">
          {sizes.map((size) => (
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
      <EditSection label="Flavor">
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
      <EditSection label="Design">
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
      <EditSection label="Base Color">
        <ColorPicker colors={baseColors} selected={item.baseColor} onSelect={onBaseColorChange} />
      </EditSection>

      {/* Decoration Color */}
      {showDecoColor && (
        <EditSection label="Decoration Color">
          <ColorPicker colors={baseColors} selected={item.decorationColor} onSelect={onDecoColorChange} />
        </EditSection>
      )}

      {/* Text */}
      {showText && (
        <EditSection label="Cake Text">
          <Input
            placeholder="Enter text for your cake (max 30 chars)"
            value={item.cakeText || ""}
            onChange={(e) => onTextChange(e.target.value.slice(0, 30))}
            maxLength={30}
          />
          {item.cakeText && (
            <div className="mt-2">
              <p className="text-xs font-medium text-muted-foreground mb-1">Text Color</p>
              <ColorPicker colors={textColors} selected={item.textColor} onSelect={onTextColorChange} />
            </div>
          )}
        </EditSection>
      )}

      {/* Candles */}
      <EditSection label="Candles">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {candles.map((candle) => {
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
  );
};

/* ---------- Shared sub-components ---------- */
const EditSection = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="space-y-2">
    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</label>
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
