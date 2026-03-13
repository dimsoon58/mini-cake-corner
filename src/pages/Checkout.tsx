import { useState, useMemo, useEffect } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { CalendarIcon, ArrowLeft } from "lucide-react";
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

// Generate 1-hour pickup time slots from 10:00 to 18:00
const PICKUP_TIME_SLOTS = [
  "10:00 – 11:00",
  "11:00 – 12:00",
  "12:00 – 13:00",
  "13:00 – 14:00",
  "14:00 – 15:00",
  "15:00 – 16:00",
  "16:00 – 17:00",
  "17:00 – 18:00",
];

// Generate 1-hour delivery time slots from 08:00 to 20:00
const DELIVERY_TIME_SLOTS = [
  "08:00 – 09:00",
  "09:00 – 10:00",
  "10:00 – 11:00",
  "11:00 – 12:00",
  "12:00 – 13:00",
  "13:00 – 14:00",
  "14:00 – 15:00",
  "15:00 – 16:00",
  "16:00 – 17:00",
  "17:00 – 18:00",
  "18:00 – 19:00",
  "19:00 – 20:00",
];

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

const formatDisplayDate = (date: Date) => format(date, "dd.MM.yyyy");

const uploadImageFilesToStorage = async (
  allFiles: File[],
  orderId: string,
  onProgress?: (status: string) => void
): Promise<string[]> => {
  if (!allFiles.length) return [];

  onProgress?.("Uploading images...");
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const uploadedUrls: string[] = [];

  for (let i = 0; i < allFiles.length; i++) {
    const file = allFiles[i];
    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const safeExt = ["jpg", "jpeg", "png", "webp"].includes(ext) ? ext : "jpg";
    const filePath = `${year}/${month}/${orderId}/reference_${i}.${safeExt}`;

    let uploaded = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      const { error: uploadError } = await supabase.storage
        .from("order-images")
        .upload(filePath, file, { contentType: file.type, upsert: true });

      if (!uploadError) {
        uploaded = true;
        break;
      }
      console.warn(`Upload attempt ${attempt + 1} failed for reference_${i}:`, uploadError.message);
      if (attempt < 2) await new Promise(r => setTimeout(r, 1000));
    }

    if (uploaded) {
      const { data } = supabase.storage.from("order-images").getPublicUrl(filePath);
      uploadedUrls.push(data.publicUrl);
    } else {
      console.error(`Failed to upload reference_${i} after 3 attempts`);
    }
  }

  onProgress?.("Upload complete");
  return uploadedUrls;
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
  const [deliveryOption, setDeliveryOption] = useState("pickup");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryComment, setDeliveryComment] = useState("");
  const [acceptPrivacyPolicy, setAcceptPrivacyPolicy] = useState(false);
  const [subscribeNewsletter, setSubscribeNewsletter] = useState(false);
  const [fullyBookedDates, setFullyBookedDates] = useState<Date[]>([]);
  const [pickupTime, setPickupTime] = useState("");
  const [deliveryTime, setDeliveryTime] = useState("");
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

    if (deliveryOption === "pickup" && !pickupTime) {
      toast({
        title: "Pickup Time required",
        description: "Please select a pickup time slot.",
        variant: "destructive",
      });
      return;
    }

    if (deliveryOption === "delivery" && (!deliveryTime || !deliveryComment.trim())) {
      toast({
        title: "Delivery information required",
        description: "Please select a delivery time slot and add a comment with the necessary delivery information.",
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

      const orderId = crypto.randomUUID();

      // Collect all image files from cart items and upload to Supabase
      const allImageFiles = items.flatMap(item => item.imageFiles || []);
      const orderImageUrls = await uploadImageFilesToStorage(allImageFiles, orderId, (status) => {
        toast({ title: status });
      });

      // Build per-item image URLs (distribute back to items for order details)
      let urlIndex = 0;
      const orderItemsWithImageUrls = items.map(item => {
        const itemFileCount = (item.imageFiles || []).length;
        const itemUrls = orderImageUrls.slice(urlIndex, urlIndex + itemFileCount);
        urlIndex += itemFileCount;
        return { ...item, imageUrls: itemUrls };
      });

      // Build order details JSON for admin review
      const orderDetailsJson = {
        items: orderItemsWithImageUrls.map((item) => ({
          sizeName: item.sizeName,
          shapeName: item.shapeName,
          flavorName: item.flavorName,
          styleName: item.styleName,
          baseColorName: item.baseColorName,
          decorationColorName: item.decorationColorName,
          cakeText: item.cakeText,
          textColorName: item.textColorName,
          textStyle: item.textStyle,
          extrasNames: item.extrasNames,
          ribbonColorName: item.ribbonColorName,
          butterflyColorName: item.butterflyColorName,
          candles: item.candles,
          orderTime: item.orderTime,
          comment: item.comment,
          imageUrls: item.imageUrls || [],
          total: item.total,
        })),
        deliveryComment,
        pickupTime: deliveryOption === "pickup" ? pickupTime : "",
        deliveryTime: deliveryOption === "delivery" ? deliveryTime : "",
      };

      // Save order to database with pending status
      const { data: orderData, error: orderError } = await supabase.from("orders").insert({
        id: orderId,
        order_date: formattedDate,
        customer_name: `${firstName} ${lastName}`,
        customer_email: email,
        customer_phone: fullPhoneNumber,
        total_amount: totalPrice,
        delivery_option: deliveryOption,
        delivery_address: deliveryOption === "delivery" ? deliveryAddress : null,
        newsletter_subscription: subscribeNewsletter,
        status: "pending",
        image_urls: orderImageUrls,
        order_details_json: orderDetailsJson as any,
      }).select("id").single();

      if (orderError) {
        console.error("Order save error:", orderError);
        throw new Error("Impossible d'enregistrer la commande.");
      }

      const createdOrderId = orderData?.id;

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
        orderId: createdOrderId || orderId,
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

            {/* Pickup Date */}
            <div className="space-y-2">
              <Label>Pick-up / Delivery Date</Label>
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
                      formatDisplayDate(deliveryDate)
                    ) : (
                      <span>Pick a date</span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={deliveryDate}
                    onSelect={setDeliveryDate}
                    disabled={(date) => {
                      const minDate = new Date();
                      minDate.setDate(minDate.getDate() + 4);
                      minDate.setHours(0, 0, 0, 0);
                      if (date < minDate) return true;
                      return fullyBookedDates.some(
                        (bookedDate) => bookedDate.toDateString() === date.toDateString()
                      );
                    }}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
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

            {/* Pickup Time - Only shown when pickup is selected */}
            {deliveryOption === "pickup" && (
              <div className="space-y-2">
                <Label>Pickup Time <span className="text-destructive">*</span></Label>
                <Select value={pickupTime} onValueChange={setPickupTime}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a pickup time" />
                  </SelectTrigger>
                  <SelectContent>
                    {PICKUP_TIME_SLOTS.map((slot) => (
                      <SelectItem key={slot} value={slot}>
                        {slot}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

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

                {/* Delivery Time Slot */}
                <div className="space-y-2">
                  <Label>Delivery Time Slot <span className="text-destructive">*</span></Label>
                  <Select value={deliveryTime} onValueChange={setDeliveryTime}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select a delivery time slot" />
                    </SelectTrigger>
                    <SelectContent>
                      {DELIVERY_TIME_SLOTS.map((slot) => (
                        <SelectItem key={slot} value={slot}>
                          {slot}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Delivery Comment - Required */}
                <div className="space-y-2">
                  <Label htmlFor="deliveryComment">Delivery Instructions <span className="text-destructive">*</span></Label>
                  <Textarea
                    id="deliveryComment"
                    value={deliveryComment}
                    onChange={(e) => setDeliveryComment(e.target.value)}
                    placeholder="e.g., If possible around 14:30, code 4589, apartment 12, 3rd floor..."
                    rows={3}
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Please include: apartment number, door code, floor, and any delivery instructions.
                  </p>
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
                  Unlock exclusive updates & offers ✨
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
