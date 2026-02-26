import { useState, useMemo, useEffect } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { CalendarIcon, ArrowLeft, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { useCart } from "@/context/CartContext";
import { useToast } from "@/hooks/use-toast";
import Layout from "@/components/Layout";
import { supabase } from "@/integrations/supabase/client";
import { EmbeddedStripeCheckout } from "@/components/EmbeddedCheckout";

// Country codes
const COUNTRY_CODES = [
  { code: "+41", country: "CH", flag: "🇨🇭" },
  { code: "+33", country: "FR", flag: "🇫🇷" },
  { code: "+49", country: "DE", flag: "🇩🇪" },
  { code: "+39", country: "IT", flag: "🇮🇹" },
  { code: "+43", country: "AT", flag: "🇦🇹" },
  { code: "+32", country: "BE", flag: "🇧🇪" },
  { code: "+44", country: "UK", flag: "🇬🇧" },
  { code: "+34", country: "ES", flag: "🇪🇸" },
  { code: "+351", country: "PT", flag: "🇵🇹" },
  { code: "+31", country: "NL", flag: "🇳🇱" },
  { code: "+1", country: "US", flag: "🇺🇸" },
];

// Generate time slots from 10:00 to 18:30 in 30-minute intervals
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

// Delivery zones configuration with postal codes for auto-detection
const DELIVERY_ZONES = [
  {
    id: "zone1",
    name: "Zone 1 – Eaux-Vives & alentours",
    price: 15,
    postalCodes: ["1207", "1206", "1208", "1225", "1224", "1223"],
  },
  {
    id: "zone2",
    name: "Zone 2 – Carouge, Thônex, Plainpalais",
    price: 20,
    postalCodes: ["1227", "1226", "1205", "1201", "1204"],
  },
  {
    id: "zone3",
    name: "Zone 3 – Pâquis, Servette, Nations",
    price: 25,
    postalCodes: ["1203", "1202", "1209"],
  },
  {
    id: "zone4",
    name: "Zone 4 – Meyrin, Vernier, Lancy",
    price: 35,
    postalCodes: ["1217", "1214", "1219", "1212", "1213", "1228"],
  },
  {
    id: "zone5",
    name: "Zone 5 – Bernex, Versoix, Bellevue…",
    price: 40,
    postalCodes: ["1233", "1234", "1232", "1290", "1292", "1293", "1294"],
  },
];

// Function to detect zone from address using postal codes
const detectZoneFromAddress = (address: string): typeof DELIVERY_ZONES[0] | null => {
  const postalCodeMatches = address.match(/\b\d{4,5}\b/g);
  
  if (!postalCodeMatches) return null;
  
  for (const postalCode of postalCodeMatches) {
    for (const zone of DELIVERY_ZONES) {
      if (zone.postalCodes.includes(postalCode)) {
        return zone;
      }
    }
  }
  return null;
};

const Checkout = () => {
  const { items, clearCart } = useCart();
  const { toast } = useToast();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [countryCode, setCountryCode] = useState("+41");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [deliveryDate, setDeliveryDate] = useState<Date>(() => {
    if (items.length > 0 && items[0].orderDate) {
      const parsed = new Date(items[0].orderDate);
      return isNaN(parsed.getTime()) ? undefined as unknown as Date : parsed;
    }
    return undefined as unknown as Date;
  });
  const [deliveryTime, setDeliveryTime] = useState<string>("");
  const [deliveryOption, setDeliveryOption] = useState("pickup");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryComment, setDeliveryComment] = useState("");
  const [acceptPrivacyPolicy, setAcceptPrivacyPolicy] = useState(false);
  const [subscribeNewsletter, setSubscribeNewsletter] = useState(false);
  const [fullyBookedDates, setFullyBookedDates] = useState<Date[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showEmbeddedCheckout, setShowEmbeddedCheckout] = useState(false);
  const [checkoutPayload, setCheckoutPayload] = useState<any>(null);

  // Fetch fully booked dates on mount
  useEffect(() => {
    const fetchBookedDates = async () => {
      const { data, error } = await supabase.rpc('get_fully_booked_dates');
      if (!error && data) {
        setFullyBookedDates(data.map((d: { booked_date: string }) => new Date(d.booked_date)));
      }
    };
    fetchBookedDates();
  }, []);

  const itemsTotal = items.reduce((sum, item) => sum + item.total, 0);
  
  const detectedZone = useMemo(() => {
    if (deliveryOption !== "delivery" || !deliveryAddress.trim()) return null;
    return detectZoneFromAddress(deliveryAddress);
  }, [deliveryOption, deliveryAddress]);

  const deliveryPrice = detectedZone?.price || 0;
  const totalPrice = itemsTotal + (deliveryOption === "delivery" ? deliveryPrice : 0);

  // Build phone number with country code
  const fullPhoneNumber = `${countryCode}${phone.replace(/^0+/, '')}`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (items.length === 0) {
      toast({
        title: "Panier vide",
        description: "Ajoutez au moins un gâteau avant de procéder au paiement.",
        variant: "destructive",
      });
      return;
    }

    if (!acceptPrivacyPolicy) {
      toast({
        title: "Privacy Policy required",
        description: "Please accept the privacy policy to continue.",
        variant: "destructive",
      });
      return;
    }

    if (!deliveryDate) {
      toast({
        title: "Please select a delivery date",
        variant: "destructive",
      });
      return;
    }

    if (deliveryOption === "delivery" && !deliveryAddress.trim()) {
      toast({
        title: "Please enter your delivery address",
        variant: "destructive",
      });
      return;
    }

    if (deliveryOption === "delivery" && !detectedZone) {
      toast({
        title: "Delivery zone not recognized",
        description:
          "Please make sure your address includes a recognized area name (e.g., Carouge, Champel, Meyrin...)",
        variant: "destructive",
      });
      return;
    }

    setShowEmbeddedCheckout(false);
    setIsSubmitting(true);

    try {
      // Check if date is still available (max 5 orders)
      const formattedDate = format(deliveryDate, "yyyy-MM-dd");
      const { data: orderCount, error: orderCountError } = await supabase.rpc(
        "get_order_count_for_date",
        {
          target_date: formattedDate,
        },
      );

      if (orderCountError) {
        console.error("Order count error:", orderCountError);
      }

      if (orderCount && orderCount >= 5) {
        toast({
          title: "Date fully booked",
          description:
            "This date has reached the maximum number of orders. Please select another date.",
          variant: "destructive",
        });

        // Refresh booked dates
        const { data } = await supabase.rpc("get_fully_booked_dates");
        if (data) {
          setFullyBookedDates(
            data.map((d: { booked_date: string }) => new Date(d.booked_date)),
          );
        }
        return;
      }

      // Save order to database
      const { error: orderError } = await supabase.from("orders").insert({
        order_date: formattedDate,
        customer_name: `${firstName} ${lastName}`,
        customer_email: email,
        customer_phone: fullPhoneNumber,
        total_amount: totalPrice,
        delivery_option: deliveryOption,
        delivery_address: deliveryOption === "delivery" ? deliveryAddress : null,
        newsletter_subscription: subscribeNewsletter,
      });

      if (orderError) {
        console.error("Order save error:", orderError);
      }

      // Build payload for embedded checkout
      const payload = {
        items: items.map((item) => ({
          sizeName: item.sizeName,
          shapeName: item.shapeName,
          flavorName: item.flavorName,
          styleName: item.styleName,
          extrasNames: item.extrasNames,
          total: item.total,
        })),
        customerEmail: email,
        customerName: `${firstName} ${lastName}`,
        customerPhone: fullPhoneNumber,
        deliveryOption,
        deliveryAddress: deliveryOption === "delivery" ? deliveryAddress : undefined,
        deliveryFee: deliveryPrice,
        totalAmount: totalPrice,
      };

      console.log("Setting up embedded checkout with:", {
        itemCount: payload.items.length,
        totalAmount: payload.totalAmount,
        deliveryOption: payload.deliveryOption,
      });

      setCheckoutPayload(payload);
      setShowEmbeddedCheckout(true);
    } catch (err) {
      console.error("Checkout submit error:", err);
      toast({
        title: "Erreur",
        description:
          err instanceof Error
            ? err.message
            : "Une erreur inattendue est survenue.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Layout>
      <main className="container mx-auto px-4 py-8 max-w-2xl">
        <Link
          to="/cart"
          className="inline-flex items-center text-muted-foreground hover:text-primary mb-6"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Cart
        </Link>

        <div className="bg-card rounded-lg shadow-md p-6">
          <h2 className="text-xl font-serif text-foreground mb-6">
            Contact Information
          </h2>

          {items.length === 0 && (
            <div className="mb-6 rounded-lg border border-border bg-muted/30 p-4">
              <p className="text-sm text-muted-foreground">
                Votre panier est vide. Ajoutez un gâteau avant de procéder au paiement.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button asChild variant="default">
                  <Link to="/cart">Aller au panier</Link>
                </Button>
                <Button asChild variant="outline">
                  <Link to="/catalog">Voir le catalogue</Link>
                </Button>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Name Fields */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">
                  First Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="firstName"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="Enter your first name"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">
                  Last Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="lastName"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Enter your last name"
                  required
                />
              </div>
            </div>

            {/* Phone */}
            <div className="space-y-2">
              <Label htmlFor="phone">
                Phone Number <span className="text-destructive">*</span>
              </Label>
              <div className="flex gap-2">
                <Select value={countryCode} onValueChange={setCountryCode}>
                  <SelectTrigger className="w-[100px] shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COUNTRY_CODES.map((cc) => (
                      <SelectItem key={cc.code} value={cc.code}>
                        {cc.flag} {cc.code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  id="phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="79 123 45 67"
                  required
                />
              </div>
            </div>

            {/* Email */}
            <div className="space-y-2">
              <Label htmlFor="email">
                Email <span className="text-destructive">*</span>
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email address"
                required
              />
            </div>

            {/* Delivery Date & Time */}
            <div className="space-y-2">
              <Label>Pick-up / Delivery Date & Time</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !deliveryDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {deliveryDate ? (
                      <>
                        {format(deliveryDate, "PPP")}
                        {deliveryTime && ` at ${deliveryTime}`}
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
                      selected={deliveryDate}
                      onSelect={setDeliveryDate}
                      disabled={(date) => {
                        // Disable dates less than 4 days from now
                        const minDate = new Date();
                        minDate.setDate(minDate.getDate() + 4);
                        minDate.setHours(0, 0, 0, 0);
                        if (date < minDate) return true;
                        // Disable fully booked dates
                        return fullyBookedDates.some(
                          (bookedDate) => 
                            bookedDate.toDateString() === date.toDateString()
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
                              variant={deliveryTime === time ? "default" : "ghost"}
                              size="sm"
                              className={cn(
                                "w-full justify-center",
                                deliveryTime === time && "bg-primary text-primary-foreground"
                              )}
                              onClick={() => setDeliveryTime(time)}
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

            {/* Delivery Option */}
            <div className="space-y-3">
              <Label>Delivery Option</Label>
              <RadioGroup
                value={deliveryOption}
                onValueChange={(value) => {
                  setDeliveryOption(value);
                  if (value === "pickup") {
                    setDeliveryAddress("");
                    setDeliveryComment("");
                  }
                }}
                className="flex flex-col space-y-2"
              >
                <div className="flex items-center space-x-3 p-3 border border-border rounded-lg hover:bg-muted/50 cursor-pointer">
                  <RadioGroupItem value="pickup" id="pickup" />
                  <Label htmlFor="pickup" className="cursor-pointer flex-1">
                    <span className="font-medium">Pickup</span>
                    <p className="text-sm text-muted-foreground">
                      Pick up your order at our store
                    </p>
                  </Label>
                </div>
                <div className="flex items-center space-x-3 p-3 border border-border rounded-lg hover:bg-muted/50 cursor-pointer">
                  <RadioGroupItem value="delivery" id="delivery" />
                  <Label htmlFor="delivery" className="cursor-pointer flex-1">
                    <span className="font-medium">Delivery</span>
                    <p className="text-sm text-muted-foreground">
                      We deliver to your address
                    </p>
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {/* Delivery Details - Only shown when delivery is selected */}
            {deliveryOption === "delivery" && (
              <div className="space-y-4 p-4 bg-muted/30 rounded-lg border border-border">
                <h3 className="font-medium text-foreground">Delivery Details</h3>
                
                {/* Address Input */}
                <div className="space-y-2">
                  <Label htmlFor="deliveryAddress">Delivery Address</Label>
                  <Input
                    id="deliveryAddress"
                    value={deliveryAddress}
                    onChange={(e) => setDeliveryAddress(e.target.value)}
                    placeholder="Enter your full address (e.g., Rue de Carouge 12, 1205 Genève)"
                    required={deliveryOption === "delivery"}
                  />
                  {deliveryAddress.trim() && (
                    <div className="text-sm">
                      {detectedZone ? (
                        <p className="text-primary">
                          ✓ {detectedZone.name} detected - Delivery fee: CHF {detectedZone.price}
                        </p>
                      ) : (
                        <p className="text-destructive">
                          Zone not detected. Please include area name (e.g., Carouge, Champel, Meyrin...)
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Preferred Delivery Time & Complementary Indications */}
                <div className="space-y-2">
                  <Label htmlFor="deliveryComment">Preferred Delivery Time & Complementary Indications (optional)</Label>
                  <Textarea
                    id="deliveryComment"
                    value={deliveryComment}
                    onChange={(e) => setDeliveryComment(e.target.value)}
                    placeholder="e.g., Between 2pm and 4pm, 3rd floor, ring doorbell twice, code: 1234..."
                    rows={2}
                  />
                </div>
              </div>
            )}

            {/* Order Summary */}
            <div className="border-t border-border pt-6 mt-6">
              <div className="flex justify-between items-center mb-2">
                <span className="text-muted-foreground">Items ({items.length})</span>
                <span className="font-medium">CHF {itemsTotal}</span>
              </div>

              {items.length > 0 && (
                <div className="mb-4 space-y-3">
                  {items.map((item, index) => (
                    <div key={item.id} className="rounded-lg border border-border bg-muted/20 p-3 space-y-1">
                      <div className="flex justify-between items-start">
                        <span className="font-medium text-sm text-foreground">
                          {item.sizeName} {item.shapeName} Cake
                        </span>
                        <span className="font-semibold text-sm text-primary">CHF {item.total}</span>
                      </div>
                      <div className="text-xs text-muted-foreground space-y-0.5">
                        <p>Flavor: {item.flavorName}</p>
                        {item.styleName && <p>Style: {item.styleName}</p>}
                        {item.baseColorName && <p>Base Color: {item.baseColorName}</p>}
                        {item.decorationColorName && <p>Decoration Color: {item.decorationColorName}</p>}
                        {item.cakeText && (
                          <p>Text: "{item.cakeText}"{item.textColorName ? ` (${item.textColorName})` : ""}</p>
                        )}
                        {item.extrasNames.length > 0 && (
                          <p>Extras: {item.extrasNames.join(", ")}</p>
                        )}
                        {item.ribbonColorName && <p>Ribbon: {item.ribbonColorName}</p>}
                        {item.butterflyColorName && <p>Butterfly: {item.butterflyColorName}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {deliveryOption === "delivery" && deliveryPrice > 0 && (
                <div className="flex justify-between items-center mb-2">
                  <span className="text-muted-foreground">
                    Delivery Fee ({detectedZone?.name})
                  </span>
                  <span className="font-medium">CHF {deliveryPrice}</span>
                </div>
              )}
              <div className="flex justify-between items-center text-lg font-semibold pt-2 border-t border-border">
                <span>Total</span>
                <span className="text-primary">CHF {totalPrice}</span>
              </div>
            </div>

            {/* Privacy Policy & Newsletter */}
            <div className="space-y-4 border-t border-border pt-6">
              <h3 className="font-medium text-foreground">Privacy Policy</h3>
              
              {/* Privacy Policy Checkbox - Required */}
              <div className="flex items-start space-x-3">
                <Checkbox
                  id="privacyPolicy"
                  checked={acceptPrivacyPolicy}
                  onCheckedChange={(checked) => setAcceptPrivacyPolicy(checked === true)}
                  className="mt-0.5"
                />
                <Label htmlFor="privacyPolicy" className="text-sm cursor-pointer leading-relaxed">
                  I have read and accept the{" "}
                  <a
                    href="/privacy-policy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline hover:text-primary/80"
                  >
                    privacy policy
                  </a>
                  <span className="text-destructive ml-1">*</span>
                </Label>
              </div>

              {/* Newsletter Checkbox - Optional */}
              <div className="flex items-start space-x-3">
                <Checkbox
                  id="newsletter"
                  checked={subscribeNewsletter}
                  onCheckedChange={(checked) => setSubscribeNewsletter(checked === true)}
                  className="mt-0.5"
                />
                <Label htmlFor="newsletter" className="text-sm cursor-pointer leading-relaxed">
                  I would like to subscribe to the newsletter
                </Label>
              </div>
            </div>

            {/* Submit Button */}
            <Button
              type="submit"
              className="w-full"
              size="lg"
              disabled={!acceptPrivacyPolicy || isSubmitting || items.length === 0 || showEmbeddedCheckout}
            >
              {items.length === 0
                ? "Empty cart"
                : isSubmitting
                  ? "Loading..."
                  : showEmbeddedCheckout
                    ? "Complete payment below"
                    : "Proceed to Payment"}
            </Button>
          </form>

          {/* Embedded Stripe Checkout */}
          {showEmbeddedCheckout && checkoutPayload && (
            <div className="mt-8 pt-6 border-t border-border">
              <h3 className="text-lg font-serif text-foreground mb-2">
                Complete Your Payment
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                Please complete your payment below to confirm your order. All transactions are secured by Stripe.
              </p>
              <EmbeddedStripeCheckout payload={checkoutPayload} />
            </div>
          )}
        </div>
      </main>
    </Layout>
  );
};

export default Checkout;
