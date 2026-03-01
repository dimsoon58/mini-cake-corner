import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { format, addDays } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useCart } from "@/context/CartContext";
import { ShoppingBag, Trash2, ArrowLeft, Pencil, CalendarIcon, Clock, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import Layout from "@/components/Layout";
import { supabase } from "@/integrations/supabase/client";

// Duplicated data for editing - ideally shared via a data module
const sizes = [
  { id: "bento", name: "Bento", price: 40 },
  { id: "retro", name: "Retro Box", price: 40 },
  { id: "medium", name: "Medium", price: 80 },
  { id: "large", name: "Large", price: 160 },
];

const flavors = [
  { id: "vanilla", name: "Vanilla" },
  { id: "red-velvet", name: "Red Velvet" },
  { id: "chocolate", name: "Chocolate" },
  { id: "chocolate-lovers", name: "Chocolate Lovers" },
  { id: "dark-berrylicious", name: "Dark Berrylicious" },
  { id: "white-berrylicious", name: "White Berrylicious" },
  { id: "salted-caramel", name: "Salted Butter Caramel" },
  { id: "lemon-curd", name: "Lemon Curd" },
  { id: "tiramisu", name: "Tiramisu" },
  { id: "praline", name: "Praline Obsession" },
  { id: "passion-fruit", name: "Passion Fruit" },
  { id: "vanilla-gf", name: "Vanilla Gluten-Free" },
  { id: "red-velvet-gf", name: "Red Velvet Gluten-Free" },
  { id: "chocolate-gf", name: "Chocolate Gluten-Free" },
];

const generateTimeSlots = () => {
  const slots: string[] = [];
  for (let hour = 10; hour <= 18; hour++) {
    slots.push(`${hour.toString().padStart(2, '0')}:00`);
    if (hour < 18 || (hour === 18 && slots[slots.length - 1] !== "18:30")) {
      slots.push(`${hour.toString().padStart(2, '0')}:30`);
    }
  }
  return slots;
};

const TIME_SLOTS = generateTimeSlots();

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

  const handleFieldUpdate = (itemId: string, field: string, value: string) => {
    const item = items.find(i => i.id === itemId);
    if (!item) return;

    const updates: Record<string, any> = { [field]: value };

    // Update name fields too
    if (field === "size") {
      const sizeObj = sizes.find(s => s.id === value);
      updates.sizeName = sizeObj?.name || "";
    }
    if (field === "flavor") {
      const flavorObj = flavors.find(f => f.id === value);
      updates.flavorName = flavorObj?.name || "";
    }

    updateItem(itemId, updates);
  };

  return (
    <Layout>
      <main className="container mx-auto px-4 py-12">
        <div className="flex items-center justify-between mb-8">
          <Link
            to="/"
            className="inline-flex items-center text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Continue Shopping
          </Link>
          <div className="flex items-center gap-2">
            <ShoppingBag className="h-6 w-6 text-primary" />
            <span className="text-lg font-medium text-foreground">
              Your Basket ({itemCount})
            </span>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="text-center py-20">
            <ShoppingBag className="h-16 w-16 text-muted-foreground mx-auto mb-6" />
            <h2 className="font-serif text-3xl text-foreground mb-4">
              Your basket is empty
            </h2>
            <p className="text-muted-foreground mb-8">
              Start customizing your perfect cake!
            </p>
            <Button asChild>
              <Link to="/customize">Customize Your Cake</Link>
            </Button>
          </div>
        ) : (
          <div className="grid lg:grid-cols-3 gap-8">
            {/* Cart Items */}
            <div className="lg:col-span-2 space-y-4">
              <div className="flex justify-between items-center mb-4">
                <h2 className="font-serif text-2xl text-foreground">
                  Your Items
                </h2>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearCart}
                  className="text-destructive hover:text-destructive"
                >
                  Clear All
                </Button>
              </div>

              {items.map((item) => {
                const isEditing = editingItemId === item.id;

                return (
                  <Card key={item.id} className="overflow-hidden">
                    <CardContent className="p-6">
                      <div className="flex justify-between items-start mb-4">
                        <h3 className="font-serif text-xl text-foreground">
                          {item.sizeName} {item.shapeName} Cake
                        </h3>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditingItemId(isEditing ? null : item.id)}
                            className="text-primary hover:text-primary"
                          >
                            {isEditing ? <Check className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
                            {isEditing ? "Done" : "Edit"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeItem(item.id)}
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>

                      {isEditing ? (
                        <div className="space-y-4">
                          {/* Date & Time */}
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">Date & Time</label>
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button
                                  variant="outline"
                                  className={cn(
                                    "w-full justify-start text-left font-normal",
                                    !item.orderDate && "text-muted-foreground"
                                  )}
                                >
                                  <CalendarIcon className="mr-2 h-4 w-4" />
                                  {item.orderDate ? (
                                    <>
                                      {format(new Date(item.orderDate), "PPP")}
                                      {item.orderTime && ` at ${item.orderTime}`}
                                    </>
                                  ) : (
                                    <span>Pick a date & time</span>
                                  )}
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-auto p-0" align="start">
                                <div className="flex">
                                  <Calendar
                                    mode="single"
                                    selected={item.orderDate ? new Date(item.orderDate) : undefined}
                                    onSelect={(date) => {
                                      if (date) {
                                        updateItem(item.id, { orderDate: format(date, "yyyy-MM-dd") });
                                      }
                                    }}
                                    disabled={(date) => {
                                      const minDate = addDays(new Date(), 4);
                                      minDate.setHours(0, 0, 0, 0);
                                      if (date < minDate) return true;
                                      return fullyBookedDates.some(
                                        (bookedDate) => bookedDate.toDateString() === date.toDateString()
                                      );
                                    }}
                                    initialFocus
                                    className={cn("p-3 pointer-events-auto")}
                                  />
                                  <div className="border-l border-border p-3">
                                    <div className="flex items-center gap-2 mb-3 px-2">
                                      <Clock className="h-4 w-4 text-muted-foreground" />
                                      <span className="text-sm font-medium">Time</span>
                                    </div>
                                    <ScrollArea className="h-[280px] w-[100px]">
                                      <div className="flex flex-col gap-1 pr-4">
                                        {TIME_SLOTS.map((time) => (
                                          <Button
                                            key={time}
                                            variant={item.orderTime === time ? "default" : "ghost"}
                                            size="sm"
                                            className={cn(
                                              "w-full justify-center",
                                              item.orderTime === time && "bg-primary text-primary-foreground"
                                            )}
                                            onClick={() => updateItem(item.id, { orderTime: time })}
                                          >
                                            {time}
                                          </Button>
                                        ))}
                                      </div>
                                    </ScrollArea>
                                  </div>
                                </div>
                              </PopoverContent>
                            </Popover>
                          </div>

                          {/* Size */}
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">Size</label>
                            <Select
                              value={item.size}
                              onValueChange={(value) => handleFieldUpdate(item.id, "size", value)}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {sizes.map((size) => (
                                  <SelectItem key={size.id} value={size.id}>
                                    {size.name} - CHF {size.price}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          {/* Flavor */}
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">Flavor</label>
                            <Select
                              value={item.flavor}
                              onValueChange={(value) => handleFieldUpdate(item.id, "flavor", value)}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {flavors.map((flavor) => (
                                  <SelectItem key={flavor.id} value={flavor.id}>
                                    {flavor.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          {/* Design (read-only) */}
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">Design</label>
                            <div className="bg-secondary/50 rounded-lg p-3">
                              <p className="text-sm font-medium text-foreground">{item.styleName}</p>
                              <p className="text-xs text-muted-foreground mt-1">
                                To change the design, please add a new cake from the catalog.
                              </p>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {item.orderDate && (
                            <p className="text-sm text-muted-foreground">
                              📅 {format(new Date(item.orderDate), "PPP")}
                              {item.orderTime && ` at ${item.orderTime}`}
                            </p>
                          )}
                          <p className="text-muted-foreground">
                            Flavor: {item.flavorName}
                          </p>
                          <p className="text-muted-foreground">
                            Design: {item.styleName}
                          </p>
                          {item.baseColorName && (
                            <p className="text-sm text-muted-foreground">
                              Base: {item.baseColorName}
                              {item.decorationColorName && ` · Deco: ${item.decorationColorName}`}
                            </p>
                          )}
                          {item.cakeText && (
                            <p className="text-sm text-muted-foreground">
                              Text: "{item.cakeText}"
                            </p>
                          )}
                          {item.extrasNames.length > 0 && (
                            <p className="text-sm text-muted-foreground">
                              Extras: {item.extrasNames.join(", ")}
                            </p>
                          )}
                          <p className="text-xl font-bold text-primary text-right">
                            CHF {item.total}
                          </p>
                        </div>
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
                  <h3 className="font-serif text-xl text-foreground">
                    Order Summary
                  </h3>
                  <div className="space-y-2 border-b border-border pb-4">
                    {items.map((item) => (
                      <div
                        key={item.id}
                        className="flex justify-between text-sm"
                      >
                        <span className="text-muted-foreground">
                          {item.sizeName} {item.shapeName} Cake
                        </span>
                        <span className="text-foreground">CHF {item.total}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between text-lg font-bold">
                    <span className="text-foreground">Total</span>
                    <span className="text-primary">CHF {totalPrice}</span>
                  </div>
                  <Button className="w-full" size="lg" asChild>
                    <Link to="/checkout">Proceed to Checkout</Link>
                  </Button>
                  <Button variant="outline" className="w-full" asChild>
                    <Link to="/customize">Add Another Cake</Link>
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </main>
    </Layout>
  );
};

export default Cart;
