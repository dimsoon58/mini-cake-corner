import { useState, useMemo, useEffect } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { CalendarIcon, ArrowLeft } from "lucide-react";
import {
  sizes, shapes, styles, extras as catalogExtrasData,
  getFlavorCategoryExtra, getCandleTotalPrice, getExtraPrice, candles as customisationCandles,
  flavorCategories,
} from "@/data/customization";
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
import { useCart, type CartItem } from "@/context/CartContext";
import { useToast } from "@/hooks/use-toast";
import Layout from "@/components/Layout";
import { useLang } from "@/context/LanguageContext";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

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

// Uploads each item's reference images into its own folder in the
// (public) "order-images" bucket and returns a map of cart item id -> URLs,
// so each order_items row can carry only the images that belong to it.
const uploadReferenceImagesByItem = async (
  items: CartItem[],
  orderId: string,
  onProgress?: (status: string) => void
): Promise<Record<string, string[]>> => {
  const itemsWithFiles = items.filter(item => (item.imageFiles || []).length > 0);
  if (!itemsWithFiles.length) return {};

  onProgress?.("Uploading images...");
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const urlsByItemId: Record<string, string[]> = {};

  for (const item of itemsWithFiles) {
    const files = item.imageFiles || [];
    const uploadedUrls: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const safeExt = ["jpg", "jpeg", "png", "webp"].includes(ext) ? ext : "jpg";
      const filePath = `${year}/${month}/${orderId}/${item.id}/reference_${i}.${safeExt}`;

      let uploaded = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        const { error: uploadError } = await supabase.storage
          .from("order-images")
          .upload(filePath, file, { contentType: file.type, upsert: true });

        if (!uploadError) {
          uploaded = true;
          break;
        }
        console.warn(`Upload attempt ${attempt + 1} failed for ${item.id}/reference_${i}:`, uploadError.message);
        if (attempt < 2) await new Promise(r => setTimeout(r, 1000));
      }

      if (uploaded) {
        const { data } = supabase.storage.from("order-images").getPublicUrl(filePath);
        uploadedUrls.push(data.publicUrl);
      } else {
        console.error(`Failed to upload ${item.id}/reference_${i} after 3 attempts`);
      }
    }

    urlsByItemId[item.id] = uploadedUrls;
  }

  onProgress?.("Upload complete");
  return urlsByItemId;
};

// Product type stored on order_items, derived from the fields each product
// page already sets on the cart item — no page other than Checkout changes.
type ProductType = Database["public"]["Enums"]["product_type"];

const PRODUCT_TYPE_BY_SIZE: Record<string, ProductType> = {
  "dot-cakes": "dot_cakes",
  "kit-bento": "diy_kit",
  "printing": "edible_printing",
  "rectangle": "rectangle_cake",
};

const getProductType = (item: CartItem): ProductType => {
  if (item.isCandleProduct) return "candles";
  return PRODUCT_TYPE_BY_SIZE[item.size] || "bento_cake";
};

// Fallback for pages that only set a single flavour name string (everything
// except Dot Cakes, which sets item.flavorNames directly). order_items only
// stores the readable names — technical ids stay frontend-only.
const splitList = (value: string): string[] =>
  value ? value.split(", ").map(v => v.trim()).filter(Boolean) : [];

const getItemFlavorNames = (item: CartItem): string[] =>
  item.flavorNames && item.flavorNames.length ? item.flavorNames : splitList(item.flavorName);

const buildCandlesJson = (item: CartItem) =>
  (item.candles || [])
    .filter(c => c.quantity > 0)
    .map(c => {
      const candle = customisationCandles.find(x => x.id === c.id);
      return {
        id: c.id,
        name: candle?.name || c.id,
        quantity: c.quantity,
        has_pack: c.hasPack,
        unit_price: candle?.unitPrice ?? 0,
      };
    });

const getCandlesPrice = (item: CartItem): number => {
  const candleIds = Array.from(new Set((item.candles || []).map(c => c.id)));
  return candleIds.reduce((sum, id) => sum + getCandleTotalPrice(id, item.candles || []), 0);
};

const getExtrasPrice = (item: CartItem): number =>
  (item.extras || []).reduce((sum, extraId) => sum + getExtraPrice(extraId, item.size), 0);

const buildOrderItemRow = (
  item: CartItem,
  orderId: string,
  referenceImagesByItemId: Record<string, string[]>
) => ({
  order_id: orderId,
  product: getProductType(item),
  size: item.sizeName || null,
  shape: item.shapeName || null,
  flavors: getItemFlavorNames(item),
  design: item.styleName || null,
  base_color: item.baseColorName || null,
  decoration_color: item.decorationColorName || null,
  cake_text: item.cakeText || null,
  text_color: item.textColorName || null,
  text_style: item.textStyle || null,
  ribbon_color: item.ribbonColorName || null,
  butterfly_color: item.butterflyColorName || null,
  extras: item.extrasNames || [],
  extras_price: getExtrasPrice(item),
  candles: buildCandlesJson(item),
  candles_price: getCandlesPrice(item),
  reference_images: referenceImagesByItemId[item.id] || [],
  item_comment: item.comment || null,
  total: item.total,
});

// Combines the pickup/delivery date with the chosen "HH:mm – HH:mm" slot
// into a single timestamptz for orders.pickup_delivery_datetime.
const buildPickupDeliveryDatetime = (date: Date, timeSlot: string): string => {
  const startTime = timeSlot.split(" – ")[0] || "00:00";
  const [hours, minutes] = startTime.split(":").map(Number);
  const dt = new Date(date);
  dt.setHours(hours || 0, minutes || 0, 0, 0);
  return dt.toISOString();
};

const Checkout = () => {
  const { items, clearCart } = useCart();
  const { toast } = useToast();
  const [firstName, setFirstName] = useState("");
  const { t, lang } = useLang();
  const [applyReward, setApplyReward] = useState(false);
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
        title: t("Empty cart", "Panier vide"),
        description: t("Please add at least one cake before proceeding to payment.", "Ajoutez au moins un gâteau avant de procéder au paiement."),
        variant: "destructive",
      });
      return;
    }

    if (!acceptPrivacyPolicy) {
      toast({
        title: t("Privacy Policy required", "Politique de confidentialité requise"),
        description: t("Please accept the privacy policy to continue.", "Veuillez accepter la politique de confidentialité pour continuer."),
        variant: "destructive",
      });
      return;
    }

    if (!deliveryDate) {
      toast({
        title: t("Please select a delivery date", "Veuillez sélectionner une date"),
        variant: "destructive",
      });
      return;
    }

    if (deliveryOption === "delivery" && !deliveryAddress.trim()) {
      toast({
        title: t("Please enter your delivery address", "Veuillez saisir votre adresse de livraison"),
        variant: "destructive",
      });
      return;
    }

    if (deliveryOption === "delivery" && !detectedZone) {
      toast({
        title: t("Delivery zone not recognised", "Zone de livraison non reconnue"),
        description: t(
          "Please make sure your address includes a recognised area name (e.g., Carouge, Champel, Meyrin...)",
          "Merci de vérifier que votre adresse contient un nom de quartier reconnu (ex. Carouge, Champel, Meyrin...)"),
        variant: "destructive",
      });
      return;
    }

    if (deliveryOption === "pickup" && !pickupTime) {
      toast({
        title: t("Pick-up Time required", "Heure de retrait requise"),
        description: t("Please select a pick-up time slot.", "Veuillez sélectionner un créneau de retrait."),
        variant: "destructive",
      });
      return;
    }

    if (deliveryOption === "delivery" && (!deliveryTime || !deliveryComment.trim())) {
      toast({
        title: t("Delivery information required", "Informations de livraison requises"),
        description: t("Please select a delivery time slot and add a comment with the necessary delivery information.", "Veuillez sélectionner un créneau de livraison et ajouter un commentaire avec les informations nécessaires."),
        variant: "destructive",
      });
      return;
    }

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
          title: t("Date fully booked", "Date complète"),
          description: t(
            "This date has reached the maximum number of orders. Please select another date.",
            "Cette date a atteint le nombre maximum de commandes. Veuillez choisir une autre date."),
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

      // Not persisted yet: this id is only a correlation key sent to
      // PostFinance (merchantReference + return URL). orders/order_items
      // only get created once payment is confirmed authorized — creating
      // them here would leave a fake "order" behind for every abandoned
      // cart, since not everyone who reaches this button completes payment.
      const orderId = crypto.randomUUID();

      // Upload each item's reference images into its own folder. Harmless
      // even if the payment is abandoned afterwards — unlike a DB order
      // row, an orphaned image folder isn't a fake order.
      const referenceImagesByItemId = await uploadReferenceImagesByItem(items, orderId, (status) => {
        toast({ title: status });
      });

      const pickupDeliveryDatetime = buildPickupDeliveryDatetime(
        deliveryDate,
        deliveryOption === "pickup" ? pickupTime : deliveryTime
      );

      // Full orders/order_items rows, built with the same helpers used
      // everywhere else in this migration — not persisted yet, just staged
      // server-side (pending_payments) until PostFinance confirms the
      // authorization, in create-postfinance-payment.
      const orderRow = {
        order_source: "website",
        lang,
        first_name: firstName,
        last_name: lastName,
        email,
        phone: fullPhoneNumber,
        delivery_method: deliveryOption,
        delivery_address: deliveryOption === "delivery" ? deliveryAddress : null,
        delivery_zone: deliveryOption === "delivery" ? (detectedZone?.name ?? null) : null,
        delivery_fee: deliveryOption === "delivery" ? deliveryPrice : 0,
        pickup_delivery_datetime: pickupDeliveryDatetime,
        order_comment: deliveryOption === "delivery" ? deliveryComment : null,
        total_amount: totalPrice,
        newsletter_subscription: subscribeNewsletter,
      };

      const orderItemRows = items.map(item =>
        buildOrderItemRow(item, orderId, referenceImagesByItemId)
      );

      // Build payload for the PostFinance transaction
      const paymentPayload = {
        orderId,
        order: orderRow,
        orderItems: orderItemRows,
      };

      // Send to Brevo if newsletter is checked (before navigating away to PostFinance)
      if (subscribeNewsletter) {
        try {
          await supabase.functions.invoke("subscribe-newsletter", {
            body: {
              email,
              firstName,
              lastName,
            },
          });
          console.log("Newsletter subscription sent to Brevo");
        } catch (newsletterErr) {
          console.error("Newsletter subscription error (non-blocking):", newsletterErr);
        }
      }

      console.log("Creating PostFinance transaction:", {
        itemCount: paymentPayload.orderItems.length,
        totalAmount: paymentPayload.order.total_amount,
        orderId: paymentPayload.orderId,
      });

      const { data: pfData, error: pfError } = await supabase.functions.invoke("create-postfinance-payment", {
        body: paymentPayload,
      });

      if (pfError || pfData?.error || !pfData?.paymentPageUrl) {
        console.error("PostFinance transaction error:", pfError || pfData?.error);
        throw new Error("Impossible de démarrer le paiement PostFinance.");
      }

      window.location.href = pfData.paymentPageUrl;
    } catch (err) {
      console.error("Checkout submit error:", err);
      toast({
        title: t("Error", "Erreur"),
        description:
          err instanceof Error
            ? err.message
            : t("An unexpected error occurred.", "Une erreur inattendue est survenue."),
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
          {t("Back to Cart", "Retour au panier")}
        </Link>

        <div className="bg-card rounded-lg shadow-md p-6">
          <h2 className="text-xl font-serif text-foreground mb-6">
            {t("Contact Information", "Coordonnées")}
          </h2>

          {items.length === 0 && (
            <div className="mb-6 rounded-lg border border-border bg-muted/30 p-4">
              <p className="text-sm text-muted-foreground">
                {t("Your cart is empty. Please add a cake before proceeding to payment.", "Votre panier est vide. Ajoutez un gâteau avant de procéder au paiement.")}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button asChild variant="default">
                  <Link to="/cart">{t("Go to cart", "Aller au panier")}</Link>
                </Button>
                <Button asChild variant="outline">
                  <Link to="/catalog">{t("View the catalogue", "Voir le catalogue")}</Link>
                </Button>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Name Fields */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">
                  {t("First Name", "Prénom")} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="firstName"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder={t("Enter your first name", "Saisissez votre prénom")}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">
                  {t("Last Name", "Nom")} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="lastName"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder={t("Enter your last name", "Saisissez votre nom")}
                  required
                />
              </div>
            </div>

            {/* Phone */}
            <div className="space-y-2">
              <Label htmlFor="phone">
                {t("Phone Number", "Numéro de téléphone")} <span className="text-destructive">*</span>
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
                  onChange={(e) => setPhone(e.target.value.replace(/\s/g, ''))}
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
                placeholder={t("Enter your email address", "Saisissez votre adresse e-mail")}
                required
              />
            </div>

            {/* Pickup Date */}
            <div className="space-y-2">
              <Label>{t("Pick-up / Delivery Date", "Date de retrait / livraison")}</Label>
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
                      <span>{t("Pick a date", "Choisir une date")}</span>
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
              <Label>{t("Delivery Option", "Mode de réception")}</Label>
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
                    <span className="font-medium">{t("Pick-up", "Retrait")}</span>
                    <p className="text-sm text-muted-foreground">
                      {t("Pick up your order at our store", "Retirez votre commande à notre boutique")}
                    </p>
                  </Label>
                </div>
                <div className="flex items-center space-x-3 p-3 border border-border rounded-lg hover:bg-muted/50 cursor-pointer">
                  <RadioGroupItem value="delivery" id="delivery" />
                  <Label htmlFor="delivery" className="cursor-pointer flex-1">
                    <span className="font-medium">{t("Delivery", "Livraison")}</span>
                    <p className="text-sm text-muted-foreground">
                      {t("We deliver to your address", "Nous livrons à votre adresse")}
                    </p>
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {/* Pickup Time - Only shown when pickup is selected */}
            {deliveryOption === "pickup" && (
              <div className="space-y-2">
                <Label>{t("Pick-up Time", "Heure de retrait")} <span className="text-destructive">*</span></Label>
                <Select value={pickupTime} onValueChange={setPickupTime}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("Select a pickup time", "Choisir une heure de retrait")} />
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
                <h3 className="font-medium text-foreground">{t("Delivery Details", "Détails de la livraison")}</h3>
                
                {/* Address Input */}
                <div className="space-y-2">
                  <Label htmlFor="deliveryAddress">{t("Delivery Address", "Adresse de livraison")}</Label>
                  <Input
                    id="deliveryAddress"
                    value={deliveryAddress}
                    onChange={(e) => setDeliveryAddress(e.target.value)}
                    placeholder={t("Enter your full address (e.g., Rue de Carouge 12, 1205 Genève)", "Saisissez votre adresse complète (ex. Rue de Carouge 12, 1205 Genève)")}
                    required={deliveryOption === "delivery"}
                  />
                  {deliveryAddress.trim() && (
                    <div className="text-sm">
                      {detectedZone ? (
                        <p className="text-primary">
                          ✓ {detectedZone.name} {t("detected - Delivery fee:", "détecté, frais de livraison :")} CHF {detectedZone.price}
                        </p>
                      ) : (
                        <p className="text-destructive">
                          {t("Zone not detected. Please include area name (e.g., Carouge, Champel, Meyrin...)", "Zone non détectée. Merci d'indiquer le nom du quartier (ex. Carouge, Champel, Meyrin...)")}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Delivery Time Slot */}
                <div className="space-y-2">
                  <Label>{t("Delivery Time Slot", "Créneau de livraison")} <span className="text-destructive">*</span></Label>
                  <Select value={deliveryTime} onValueChange={setDeliveryTime}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t("Select a delivery time slot", "Choisir un créneau de livraison")} />
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
                  <Label htmlFor="deliveryComment">{t("Delivery Instructions", "Instructions de livraison")} <span className="text-destructive">*</span></Label>
                  <Textarea
                    id="deliveryComment"
                    value={deliveryComment}
                    onChange={(e) => setDeliveryComment(e.target.value)}
                    placeholder={t("e.g., If possible around 14:30, code 4589, apartment 12, 3rd floor...", "ex. Si possible vers 14h30, code 4589, appartement 12, 3e étage...")}
                    rows={3}
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("Please include: apartment number, door code, floor, and any delivery instructions.", "Merci d'indiquer : le numéro d'appartement, le code d'entrée, l'étage et toute instruction de livraison.")}
                  </p>
                </div>
              </div>
            )}

            {/* Order Summary */}
            <div className="border-t border-border pt-6 mt-6">
              <div className="flex justify-between items-center mb-2">
                <span className="text-muted-foreground">{t("Items", "Articles")} ({items.length})</span>
                <span className="font-medium">CHF {itemsTotal}</span>
              </div>

              {items.length > 0 && (
                <div className="mb-4 space-y-3">
                  {items.map((item) => {
                    if (item.isCandleProduct) {
                      return (
                        <div key={item.id} className="rounded-lg border border-border bg-muted/20 p-3">
                          <div className="flex justify-between items-start">
                            <span className="font-medium text-sm text-foreground">🕯️ {item.candleProductName} ×{item.candleProductQty || 1}</span>
                            <span className="font-semibold text-sm text-primary">CHF {item.total}</span>
                          </div>
                        </div>
                      );
                    }
                    const sizeObj = sizes.find(s => s.id === item.size);
                    const sizePrice = sizeObj?.price || 0;
                    const shapeObj = shapes.find(s => s.id === item.shape);
                    const shapeExtra = shapeObj ? (shapeObj.extraPrice[item.size as keyof typeof shapeObj.extraPrice] || 0) : 0;
                    const flavorExtra = getFlavorCategoryExtra(item.flavor, item.size);
                    const styleObj = styles.find(s => s.id === item.style);
                    const styleExtra = styleObj ? (styleObj.price[item.size as keyof typeof styleObj.price] || 0) : 0;
                    const extraEntries = (item.extras || []).map((extraId: string) => {
                      const extra = catalogExtrasData.find(e => e.id === extraId);
                      if (!extra) return null;
                      const price = extra.price[item.size as keyof typeof extra.price] || 0;
                      return { name: extra.name, price };
                    }).filter(Boolean) as { name: string; price: number }[];
                    const candleEntries = (item.candles || [])
                      .filter((c: any) => c.quantity > 0)
                      .map((c: any) => {
                        const candle = customisationCandles.find(x => x.id === c.id);
                        const price = candle ? getCandleTotalPrice(candle.id, item.candles || []) : 0;
                        return { name: candle?.name || "", qty: c.quantity, price };
                      })
                      .filter((e: any) => e.name);

                    return (
                      <div key={item.id} className="rounded-lg border border-border bg-muted/20 p-3 space-y-1">
                        <div className="flex justify-between items-start">
                          <span className="font-medium text-sm text-foreground">
                            {item.sizeName} {item.shapeName} {t("Cake", "Gâteau")}
                          </span>
                          <span className="font-semibold text-sm text-primary">CHF {item.total}</span>
                        </div>
                        <div className="text-xs text-muted-foreground space-y-0.5">
                          <div className="flex justify-between">
                            <span>{t("Base", "Base")} ({item.sizeName})</span>
                            <span>CHF {sizePrice}{shapeExtra > 0 ? ` + ${shapeExtra}` : ""}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>{t("Flavour:", "Parfum :")} {item.flavorName}</span>
                            <span>{flavorExtra > 0 ? `+ CHF ${flavorExtra}` : t("included", "inclus")}</span>
                          </div>
                          {item.styleName && (
                            <div className="flex justify-between">
                              <span>{t("Design:", "Design :")} {item.styleName}</span>
                              <span>{styleExtra > 0 ? `+ CHF ${styleExtra}` : t("included", "inclus")}</span>
                            </div>
                          )}
                          {extraEntries.map((e: any, i: number) => (
                            <div key={i} className="flex justify-between">
                              <span>+ {e.name}</span>
                              <span>+ CHF {e.price}</span>
                            </div>
                          ))}
                          {candleEntries.map((e: any, i: number) => (
                            <div key={i} className="flex justify-between">
                              <span>🕯️ {e.name} ×{e.qty}</span>
                              <span>+ CHF {e.price}</span>
                            </div>
                          ))}
                          {item.baseColorName && <p>{t("Base Colour:", "Couleur de base :")} {item.baseColorName}</p>}
                          {item.decorationColorName && <p>{t("Decoration Colour:", "Couleur de décoration :")} {item.decorationColorName}</p>}
                          {item.cakeText && (
                            <p>{t("Text:", "Texte :")} "{item.cakeText}"{item.textColorName ? ` (${item.textColorName})` : ""}</p>
                          )}
                          {item.ribbonColorName && <p>{t("Ribbon:", "Ruban :")} {item.ribbonColorName}</p>}
                          {item.butterflyColorName && <p>{t("Butterfly:", "Papillon :")} {item.butterflyColorName}</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {deliveryOption === "delivery" && deliveryPrice > 0 && (
                <div className="flex justify-between items-center mb-2">
                  <span className="text-muted-foreground">
                    {t("Delivery Fee", "Frais de livraison")} ({detectedZone?.name})
                  </span>
                  <span className="font-medium">CHF {deliveryPrice}</span>
                </div>
              )}
              <div className="flex justify-between items-center text-lg font-semibold pt-2 border-t border-border">
                <span>{t("Total", "Total")}</span>
                <span className="text-primary">CHF {totalPrice}</span>
              </div>
            </div>

            {/* Loyalty Rewards (UI-only, demo values) */}
            <div className="border border-primary/40 bg-secondary/40 p-4 space-y-2 mt-2">
              <p className="text-sm text-foreground">
                {t("You have 125 points available.", "Vous avez 125 points disponibles.")}
              </p>
              <p className="text-sm text-foreground/80">
                {t("Redeem 100 points to receive CHF 5 off this order.", "Utilisez 100 points pour obtenir CHF 5 de réduction sur cette commande.")}
              </p>
              <div className="flex items-center space-x-3 pt-1">
                <Checkbox id="applyReward" checked={applyReward} onCheckedChange={(c) => setApplyReward(c === true)} />
                <Label htmlFor="applyReward" className="text-sm cursor-pointer">{t("Apply my reward", "Utiliser ma récompense")}</Label>
              </div>
              <p className="text-xs text-muted-foreground pt-1">
                {t(`You'll earn ${Math.floor(totalPrice)} points with this order.`, `Vous gagnerez ${Math.floor(totalPrice)} points avec cette commande.`)}
              </p>
            </div>

            {/* Privacy Policy & Newsletter */}
            <div className="space-y-4 border-t border-border pt-6">
              <h3 className="font-medium text-foreground">{t("Privacy Policy", "Politique de confidentialité")}</h3>
              
              {/* Privacy Policy Checkbox - Required */}
              <div className="flex items-start space-x-3">
                <Checkbox
                  id="privacyPolicy"
                  checked={acceptPrivacyPolicy}
                  onCheckedChange={(checked) => setAcceptPrivacyPolicy(checked === true)}
                  className="mt-0.5"
                />
                <Label htmlFor="privacyPolicy" className="text-sm cursor-pointer leading-relaxed">
                  {t("I have read and accept the", "J'ai lu et j'accepte la")}{" "}
                  <a
                    href="/privacy-policy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline hover:text-primary/80"
                  >
                    {t("privacy policy", "politique de confidentialité")}
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
                  {t("Unlock exclusive updates & offers ✨", "Recevez nos actualités et offres exclusives ✨")}
                </Label>
              </div>
            </div>

            {/* Submit Button */}
            <Button
              type="submit"
              className="w-full"
              size="lg"
              disabled={!acceptPrivacyPolicy || isSubmitting || items.length === 0}
            >
              {items.length === 0
                ? t("Empty cart", "Panier vide")
                : isSubmitting
                  ? t("Redirecting to payment...", "Redirection vers le paiement...")
                  : t("Proceed to Payment", "Procéder au paiement")}
            </Button>
          </form>
        </div>
      </main>
    </Layout>
  );
};

export default Checkout;
