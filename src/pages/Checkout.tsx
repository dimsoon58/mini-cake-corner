import { useState, useMemo, useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import { CalendarIcon, ArrowLeft } from "lucide-react";
import {
  sizes, shapes, styles, extras as catalogExtrasData,
  getFlavorCategoryExtra, getExtraPrice, getCandleTotalPrice, candles as customisationCandles,
  flavorCategories, extraGroups,
} from "@/data/customization";
import { candles as kitBentoCandles } from "@/pages/KitBentoCake";
import { NUMBER_CANDLE_ID, NUMBER_CANDLE_PRICE, composeCandleName } from "@/lib/candleCartHelpers";
import {
  COUNTRY_CODES,
  normalizeEmail,
  normalizeName,
  sanitizePhoneLocalInput,
  combinePhoneNumber,
  splitPhoneNumber,
} from "@/lib/identity";
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
import { useCart, VALID_PRODUCTS } from "@/context/CartContext";
import {
  trackEvent,
  trackEventWhenReady,
  cartItemsToGA4Items,
  cartItemsValue,
  stashPurchaseSnapshot,
} from "@/lib/analytics";
import { useToast } from "@/hooks/use-toast";
import Layout from "@/components/Layout";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { PostFinanceCheckout } from "@/components/EmbeddedCheckout";

// Fixed voucher base price per (product, size) pair — must stay identical
// to WELCOME_VOUCHER_BASE in create-postfinance-payment/index.ts (the
// authoritative copy). Never a single size alone, so an inconsistent
// combination can never resolve to a base. Intentionally NOT the live
// catalogue price (e.g. retro/large differ from data/customization.ts and
// Catalog.tsx today).
const WELCOME_VOUCHER_BASE: Record<string, Record<string, number>> = {
  bento_cake: { bento: 40, retro: 40, medium: 85, large: 160 },
  rectangle_cake: { rectangle: 450 },
  diy_kit: { "kit-bento": 40 },
  edible_printing: { printing: 15 },
  dot_cakes: {
    "dot-cakes-4": 35,
    "dot-cakes-6": 51,
    "dot-cakes-9": 75,
    "dot-cakes-12": 99,
    "dot-cakes-20": 160,
  },
};

// Display-only mirror of getWelcomeVoucherBase() in
// create-postfinance-payment/index.ts. For Dot Cakes, item.size is written
// pack-specific ("dot-cakes-6", set in DotCakes.tsx). Returns null when the
// pair isn't in the fixed table above — including a stale cart still
// carrying the old generic "dot-cakes" size — in which case the item is
// never selected as the discounted one.
function getWelcomeVoucherBase(item: { product: string; size: string }): number | null {
  return WELCOME_VOUCHER_BASE[item.product]?.[item.size] ?? null;
}

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

// Temporary compatibility field: pickup_delivery_datetime is being phased
// out in favour of pickup_delivery_date + pickup_delivery_slot (kept filled
// until nothing on the site or in Make/Notion still reads it). Picks the
// slot's start time as the datetime; browser-local, same as the old
// order_date-only behaviour this replaces.
const buildPickupDeliveryDatetime = (date: Date, slot: string): string => {
  const startTime = slot.split(/[–-]/)[0]?.trim() || "00:00";
  const [hours, minutes] = startTime.split(":").map((n) => parseInt(n, 10));
  const combined = new Date(date);
  combined.setHours(Number.isFinite(hours) ? hours : 0, Number.isFinite(minutes) ? minutes : 0, 0, 0);
  return combined.toISOString();
};

// order_items.extra_type comes from the real catalog structure (customization.ts's
// extraGroups: "Pearls", "Glitter", "Decorations"...), not from parsing text —
// e.g. pearl-number and glitter resolve to "Pearls, Glitter", never left as a
// copy of `extra` and never as the raw ids.
const EXTRA_GROUP_BY_ID: Record<string, string> = {};
extraGroups.forEach((group) => {
  group.ids.forEach((id) => { EXTRA_GROUP_BY_ID[id] = group.label; });
});

// Builds order_items.extra / extra_type / extra_color as clean, readable
// values (no raw JSON, no technical ids).
const buildExtraFields = (item: {
  extras: string[];
  extrasNames: string[];
  ribbonColorName: string;
  butterflyColorName: string;
  glitterColorName?: string;
  glitterCherriesColorName?: string;
}): { extra: string; extraType: string; extraColor: string } => {
  const parts = [...item.extrasNames];
  if (item.ribbonColorName) parts.push(`Ribbon: ${item.ribbonColorName}`);
  if (item.butterflyColorName) parts.push(`Butterfly: ${item.butterflyColorName}`);
  if (item.glitterColorName) parts.push(`Glitter: ${item.glitterColorName}`);
  if (item.glitterCherriesColorName) parts.push(`Glitter Cherries: ${item.glitterCherriesColorName}`);
  const cleanParts = parts.filter(Boolean);
  const extra = cleanParts.join(", ");

  // Structured lookup first: each extra's real catalog category.
  const groupLabels = Array.from(new Set(
    (item.extras || [])
      .map((id) => EXTRA_GROUP_BY_ID[id])
      .filter((label): label is string => Boolean(label))
  ));
  const colorParts = [
    item.ribbonColorName,
    item.butterflyColorName,
    item.glitterColorName,
    item.glitterCherriesColorName,
  ].filter(Boolean);

  let extraType = groupLabels.join(", ");
  let extraColor = colorParts.join(", ");

  // Ids with no catalog group (e.g. KitBentoCake's piping-bag option, which
  // isn't in customization.ts's extras catalog at all) fall back to the
  // single readable entry itself, which already embeds "Type: Colour(s)"
  // (e.g. "3 Piping Bags: Sky Blue, Pink, Pastel Orange").
  if (!extraType && cleanParts.length === 1) {
    const [only] = cleanParts;
    const colonIndex = only.indexOf(":");
    if (colonIndex > -1) {
      extraType = only.slice(0, colonIndex).replace(/^\d+\s+/, "").trim();
      if (!extraColor) extraColor = only.slice(colonIndex + 1).trim();
    } else {
      extraType = only.replace(/^\d+\s+/, "").trim();
    }
  }

  return { extra, extraType, extraColor };
};

// Builds order_items.candle_name / candle_quantity as clean readable values
// (no raw candle JSON). A single candle type stores its own name/quantity;
// multiple distinct types are joined into a readable list, with
// candle_quantity summed so it stays a plain number either way.
const buildCandleFields = (
  candleSelections: { id: string; quantity: number; hasPack?: boolean; colors?: string[]; digit?: string }[],
): { candleName: string; candleQuantity: number } => {
  const active = candleSelections.filter((c) => c.quantity > 0);
  if (active.length === 0) return { candleName: "", candleQuantity: 0 };
  const names = active.map((c) => {
    // Persisted candle_name stays English-only, matching sizeName/flavorName/etc.
    const baseName = c.id === NUMBER_CANDLE_ID
      ? "Number Candle"
      : customisationCandles.find((x) => x.id === c.id)?.name
        || kitBentoCandles.find((x) => x.id === c.id)?.name
        || c.id;
    return composeCandleName(c, baseName);
  });
  const totalQuantity = active.reduce((sum, c) => sum + c.quantity, 0);
  return { candleName: names.join(", "), candleQuantity: totalQuantity };
};

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

    let uploaded = false;
    let uploadedPath = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      // A fresh unique path every attempt — never re-upload to the same key
      // — so a retry is always a plain INSERT, never an UPDATE. With a fixed
      // path and upsert:true, a retry that lands on a path a previous
      // attempt already created becomes an UPDATE, which has no RLS policy
      // and fails with "new row violates row-level security policy" even
      // though INSERT is correctly allowed.
      const filePath = `${year}/${month}/${orderId}/${crypto.randomUUID()}_reference_${i}.${safeExt}`;
      const { error: uploadError } = await supabase.storage
        .from("order-images")
        .upload(filePath, file, { contentType: file.type, upsert: false });

      if (!uploadError) {
        uploaded = true;
        uploadedPath = filePath;
        break;
      }
      console.warn(`Upload attempt ${attempt + 1} failed for reference_${i}:`, uploadError.message);
      if (attempt < 2) await new Promise(r => setTimeout(r, 1000));
    }

    if (uploaded) {
      const { data } = supabase.storage.from("order-images").getPublicUrl(uploadedPath);
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
  const [searchParams] = useSearchParams();
  const [firstName, setFirstName] = useState("");
  const { t, lang } = useLang();
  const { user, profile, refreshProfile } = useAuth();
  // Identity fields come from the account and are locked once signed in —
  // phone stays editable even then, since a customer may want a different
  // contact number for this specific order.
  const isLoggedIn = !!user;
  const [useWelcomeDiscount, setUseWelcomeDiscount] = useState(false);
  // No amount picker — enabling this always requests the maximum usable
  // amount, computed below.
  const [useReward, setUseReward] = useState(false);
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

  // Prefill from the logged-in customer's profile — never overwrites what
  // they've already typed. Guest checkout (profile stays null) is untouched.
  // Not depending on [firstName, lastName, email, phone] is intentional:
  // this must only run when profile itself (re)loads, never on keystrokes.
  useEffect(() => {
    if (!profile) return;
    setFirstName((prev) => prev || (profile.first_name ? normalizeName(profile.first_name) : ""));
    setLastName((prev) => prev || (profile.last_name ? normalizeName(profile.last_name) : ""));
    setEmail((prev) => prev || normalizeEmail(profile.email || user?.email || ""));

    if (profile.phone && !phone) {
      const parsed = splitPhoneNumber(profile.phone);
      if (parsed.countryCode) setCountryCode(parsed.countryCode);
      setPhone(parsed.localPhone);
    }
  }, [profile, user]);

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

  // PostFinance's failedUrl brings the customer straight back here with
  // ?payment=failed — cart is left untouched (nothing here calls
  // clearCart()) so they can retry immediately.
  useEffect(() => {
    if (searchParams.get("payment") === "failed") {
      toast({
        title: t("Payment failed", "Échec du paiement"),
        description: t(
          "Payment failed. Please try again or use another payment method.",
          "Le paiement a échoué. Veuillez réessayer ou utiliser un autre moyen de paiement."
        ),
        variant: "destructive",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // GA4 funnel guards — each step at most once per Checkout mount.
  const beginCheckoutSentRef = useRef(false);
  const shippingInfoSentRef = useRef(false);
  const paymentInfoSentRef = useRef(false);

  // begin_checkout — the customer has reached the checkout with a cart.
  useEffect(() => {
    if (beginCheckoutSentRef.current || items.length === 0) return;
    beginCheckoutSentRef.current = true;
    trackEventWhenReady("begin_checkout", {
      currency: "CHF",
      value: cartItemsValue(items),
      items: cartItemsToGA4Items(items),
    });
  }, [items]);

  const itemsTotal = items.reduce((sum, item) => sum + item.total, 0);

  const detectedZone = useMemo(() => {
    if (deliveryOption !== "delivery" || !deliveryAddress.trim()) return null;
    return detectZoneFromAddress(deliveryAddress);
  }, [deliveryOption, deliveryAddress]);

  const deliveryPrice = detectedZone?.price || 0;

  // Server-verified at create-postfinance-payment time — this is only a
  // display estimate. A reservation already in flight
  // (welcome_discount_reserved_order_id set) also hides the option, since
  // the account isn't currently free to claim a new one.
  // welcome_discount_expires_at is read directly from Supabase as the
  // source of truth — never recomputed client-side. !!profile guards
  // against treating a not-yet-loaded profile as eligible.
  const baseWelcomeDiscountEligible = !!user
    && !!user.email_confirmed_at
    && !!profile
    && !profile?.welcome_discount_used_at
    && !profile?.welcome_discount_reserved_order_id;

  // Genuinely already active in the DB right now.
  const welcomeVoucherEligible = baseWelcomeDiscountEligible
    && profile?.welcome_discount_available === true
    && !!profile?.welcome_discount_expires_at
    && new Date(profile.welcome_discount_expires_at) > new Date();

  // Not active yet, but checking the newsletter box in this same checkout
  // would activate it (via the DB trigger) before payment is requested —
  // genuinely means "transitioning right now": the trigger only fires on
  // an actual change of newsletter_subscription, so if it's already true
  // in profiles this isn't a transition and must not claim to be one. A
  // missing expiry means "never subscribed before" — first-time eligible.
  // An existing expiry must still be in the future — an expired date never
  // becomes eligible again, no matter what's checked.
  const justSubscribingNow = baseWelcomeDiscountEligible
    && subscribeNewsletter
    && profile?.newsletter_subscription !== true
    && !welcomeVoucherEligible
    && (!profile?.welcome_discount_expires_at || new Date(profile.welcome_discount_expires_at) > new Date());

  const canUseWelcomeDiscountNow = welcomeVoucherEligible || justSubscribingNow;

  // Mirrors, item for item, the selection rule enforced server-side in
  // create-postfinance-payment: candles ("product" === "candles") are
  // entirely excluded whenever at least one non-candle product is in the
  // cart. Among the remaining items, the one with the lowest VOUCHER BASE
  // price wins (fixed per product type/size, never the real sale price
  // which includes decorations/extras/supplements). A candles-only cart is
  // the one exception that keeps using the real line total. Display only —
  // the server independently recomputes and verifies this amount, never
  // trusting this client-side value for anything financial.
  const nonCandleItems = items.filter((item) => item.product !== "candles");
  const isCandlesOnlyCart = nonCandleItems.length === 0;

  let discountedItem: (typeof items)[number] | null = null;
  let discountedBase = 0;
  for (const item of (isCandlesOnlyCart ? items : nonCandleItems)) {
    const base = isCandlesOnlyCart ? item.total : getWelcomeVoucherBase(item);
    if (base === null) continue;
    if (discountedItem === null || base < discountedBase) {
      discountedItem = item;
      discountedBase = base;
    }
  }

  const estimatedWelcomeDiscount = (useWelcomeDiscount && canUseWelcomeDiscountNow && discountedItem)
    ? Math.round(discountedBase * 0.10 * 100) / 100
    : 0;

  // Reward balance ("cagnotte") — display-only. profile.reward_balance is a
  // server-maintained cache; this page never derives, recomputes, or
  // second-guesses it — it just reads it and proposes an intention. The
  // server independently verifies and caps the real usable amount at
  // capture time.
  const rewardBalance = profile?.reward_balance ?? 0;
  const rewardEligible = !!user && rewardBalance >= 1;
  // Products only, after the welcome discount, delivery excluded — matches
  // the business rule; still just a display cap, never trusted as the real
  // ceiling.
  const maxRewardUsable = Math.max(0, Math.round((itemsTotal - estimatedWelcomeDiscount) * 100) / 100);
  // No amount choice — enabling the option always requests the maximum
  // usable amount (never more than what's left to pay on products).
  const estimatedRewardUsed = (useReward && rewardEligible)
    ? Math.round(Math.min(rewardBalance, maxRewardUsable) * 100) / 100
    : 0;

  const totalPrice = itemsTotal - estimatedWelcomeDiscount - estimatedRewardUsed + (deliveryOption === "delivery" ? deliveryPrice : 0);

  // Build phone number with country code
  const fullPhoneNumber = combinePhoneNumber(countryCode, phone);

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

    const datedItems = items.filter((i) => i.orderDate);
    const mismatchedDates = datedItems.some((i) => i.orderDate !== datedItems[0]?.orderDate);
    if (mismatchedDates) {
      toast({
        title: t("Order dates do not match", "Les dates de commande ne correspondent pas"),
        description: t(
          "Please make sure every item in your cart has the same pickup date, or place separate orders.",
          "Merci de vérifier que tous les articles de votre panier ont la même date de retrait, ou de passer des commandes séparées."
        ),
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

    // GA4 add_shipping_info — pickup vs delivery (and zone) is now fully
    // chosen and validated. Fired before the availability re-check / payload
    // build so it reflects the moment the delivery choice is confirmed.
    if (!shippingInfoSentRef.current) {
      shippingInfoSentRef.current = true;
      trackEvent("add_shipping_info", {
        currency: "CHF",
        value: cartItemsValue(items),
        shipping_tier:
          deliveryOption === "delivery"
            ? detectedZone?.name || "delivery"
            : "pickup",
        items: cartItemsToGA4Items(items),
      });
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

      // Last line of defense: an item without a currently-valid product
      // would make the whole order_items insert fail later (in
      // confirm-postfinance-payment), long after the customer has paid —
      // catch it here instead, before anything is sent to PostFinance or
      // Supabase. Normal cart items always have one; this only fires for
      // stale items left in localStorage from before this field existed.
      const invalidProductItem = items.find((item) => !VALID_PRODUCTS.has(item.product));
      if (invalidProductItem) {
        toast({
          title: t("Cart item needs to be re-added", "Un article du panier doit être ajouté à nouveau"),
          description: t(
            "One of your cart items is outdated. Please remove it and add it again before checking out.",
            "Un article de votre panier est obsolète. Merci de le retirer et de l'ajouter à nouveau avant de valider votre commande."
          ),
          variant: "destructive",
        });
        return;
      }

      const orderId = crypto.randomUUID();
      const slot = deliveryOption === "pickup" ? pickupTime : deliveryTime;

      // Collect all image files from cart items and upload to Supabase
      const allImageFiles = items.flatMap(item => item.imageFiles || []);
      const orderImageUrls = await uploadImageFilesToStorage(allImageFiles, orderId, (status) => {
        toast({ title: status });
      });

      // Build per-item image URLs (distribute back to items for their own
      // order_items.reference_images row)
      let urlIndex = 0;
      const orderItemsWithImageUrls = items.map(item => {
        const itemFileCount = (item.imageFiles || []).length;
        const itemUrls = orderImageUrls.slice(urlIndex, urlIndex + itemFileCount);
        urlIndex += itemFileCount;
        return { ...item, imageUrls: itemUrls };
      });

      // Nothing is written to Supabase yet. The order only becomes real
      // once PostFinance confirms the payment authorization — creating it
      // here would leave a fake "order" behind (with a burnt order_number)
      // for every abandoned or declined checkout. What we build below is
      // staged into pending_payments by create-postfinance-payment, and only
      // turned into real orders/order_items rows by confirm-postfinance-payment
      // once the customer returns and the transaction is confirmed.
      const orderData = {
        id: orderId,
        order_source: "website",
        lang,
        first_name: normalizeName(firstName),
        last_name: normalizeName(lastName),
        email: normalizeEmail(email),
        phone: fullPhoneNumber,
        delivery_method: deliveryOption,
        delivery_address: deliveryOption === "delivery" ? deliveryAddress : null,
        delivery_zone: deliveryOption === "delivery" ? (detectedZone?.name ?? null) : null,
        delivery_fee: deliveryOption === "delivery" ? deliveryPrice : 0,
        pickup_delivery_date: formattedDate,
        pickup_delivery_slot: slot,
        // Temporary: kept filled until nothing still reads pickup_delivery_datetime.
        pickup_delivery_datetime: buildPickupDeliveryDatetime(deliveryDate, slot),
        order_comment: deliveryOption === "delivery" ? deliveryComment : null,
        total_amount: totalPrice,
        newsletter_subscription: subscribeNewsletter,
      };

      // Each cake/product is its own order_items row, with its own real
      // price — never orders.total_amount split evenly.
      const orderItemsRows = orderItemsWithImageUrls.map((item) => {
        const { extra, extraType, extraColor } = buildExtraFields(item);

        // Standalone candle purchases (Candles.tsx) carry their candle in
        // candleProduct* fields, not in item.candles — that array is only
        // used for candles added on top of a cake (Catalog/DotCakes/KitBentoCake).
        let candleName: string;
        let candleQuantity: number;
        let candlesPrice: number;
        if (item.isCandleProduct) {
          candleName = item.candleProductName || "";
          candleQuantity = item.candleProductQty || 0;
          candlesPrice = item.total;
        } else {
          const built = buildCandleFields(item.candles || []);
          candleName = built.candleName;
          candleQuantity = built.candleQuantity;
          const distinctCandleIds = Array.from(new Set((item.candles || []).map((c) => c.id)));
          candlesPrice = distinctCandleIds.reduce(
            (sum, id) => sum + getCandleTotalPrice(id, item.candles || []),
            0,
          );
        }

        return {
          order_id: orderId,
          product: item.product,
          size: item.size || null,
          shape: item.shape || null,
          flavors: item.flavorName ? item.flavorName.split(",").map((f) => f.trim()).filter(Boolean) : [],
          design: item.style || null,
          base_color: item.baseColor || null,
          decoration_color: item.decorationColor || null,
          cake_text: item.cakeText || null,
          text_color: item.textColor || null,
          text_style: item.textStyle || null,
          extra,
          extra_type: extraType,
          extra_color: extraColor,
          extras_price: (item.extras || []).reduce(
            (sum, extraId) => sum + getExtraPrice(extraId, item.size),
            0,
          ),
          candle_name: candleName,
          candle_quantity: candleQuantity,
          candles_price: candlesPrice,
          reference_images: item.imageUrls || [],
          item_comment: item.comment || null,
          total: item.total,
          // Kept temporarily alongside the clean fields above, in case
          // anything downstream still reads the old shape.
          ribbon_color: item.ribbonColorName || null,
          butterfly_color: item.butterflyColorName || null,
          extras: item.extras || [],
          candles: item.candles || [],
        };
      });

      // Newsletter activation runs BEFORE the payload is built and BEFORE
      // create-postfinance-payment is called (not after, as it used to) —
      // deliberately, so if useWelcomeDiscount depends on justSubscribingNow,
      // the DB trigger has already flipped welcome_discount_available by
      // the time claim_welcome_discount runs server-side, and so we know
      // for certain whether the activation actually succeeded before
      // deciding whether the discount can be requested at all.
      let brevoSucceeded = true; // meaningful only if subscribeNewsletter attempts a call below
      let newsletterProfileUpdateSucceeded = true; // meaningful only if isLoggedIn && user attempts a call below

      if (subscribeNewsletter) {
        try {
          const { error: brevoError } = await supabase.functions.invoke("subscribe-newsletter", {
            body: {
              email,
              firstName,
              lastName,
            },
          });
          if (brevoError) {
            console.error("Newsletter subscription error:", brevoError);
            brevoSucceeded = false;
          } else {
            console.log("Newsletter subscription sent to Brevo");
          }
        } catch (newsletterErr) {
          console.error("Newsletter subscription error:", newsletterErr);
          brevoSucceeded = false;
        }

        // Logged-in customer only — a guest never gets a profiles row
        // created just for this. Keeps profiles.newsletter_subscription in
        // sync so Make/Notion (which reads this column) reflects reality,
        // and so this checkbox stays hidden for them on their next
        // checkout.
        if (isLoggedIn && user) {
          try {
            const { error: profileUpdateError } = await supabase
              .from("profiles")
              .update({ newsletter_subscription: true })
              .eq("id", user.id);
            if (profileUpdateError) {
              console.error("Failed to update profile newsletter_subscription:", profileUpdateError);
              newsletterProfileUpdateSucceeded = false;
            } else {
              await refreshProfile();
            }
          } catch (profileErr) {
            console.error("Profile newsletter_subscription update error:", profileErr);
            newsletterProfileUpdateSucceeded = false;
          }
        }
      }

      const newsletterActivationSucceeded = brevoSucceeded && newsletterProfileUpdateSucceeded;

      // The welcome discount checkbox was only checkable BECAUSE of
      // justSubscribingNow (not already independently eligible in the DB).
      // If either half of the activation that was supposed to unlock it
      // just failed, stop here rather than silently charging full price
      // for something the customer explicitly asked to redeem. A checkout
      // NOT relying on justSubscribingNow for its discount is unaffected —
      // a Brevo/profile hiccup stays non-blocking for it, same as before.
      if (useWelcomeDiscount && justSubscribingNow && !newsletterActivationSucceeded) {
        setIsSubmitting(false);
        toast({
          title: t("Could not activate your welcome offer", "Impossible d'activer votre offre de bienvenue"),
          description: t(
            "We couldn't confirm your newsletter subscription, so your welcome discount couldn't be activated. Please try again.",
            "Nous n'avons pas pu confirmer votre inscription à la newsletter, donc votre réduction de bienvenue n'a pas pu être activée. Merci de réessayer."
          ),
          variant: "destructive",
        });
        return;
      }

      // The actual, verified outcome — distinct from canUseWelcomeDiscountNow,
      // which is only the pre-submit display estimate.
      const canApplyWelcomeDiscountToThisOrder = welcomeVoucherEligible
        || (justSubscribingNow && newsletterActivationSucceeded);

      // Build payload for the payment page. `order`/`orderItems` are the
      // real rows create-postfinance-payment stages into pending_payments —
      // nothing has touched orders/order_items yet. `items` below is display-only,
      // used solely to build the PostFinance payment page's line items.
      const payload = {
        order: orderData,
        orderItems: orderItemsRows,
        // Raw ids only — never a price. create-postfinance-payment recomputes
        // orderItemsRows[i].total from this; item.total above no longer
        // decides what gets charged.
        pricingItems: orderItemsWithImageUrls.map((item) => ({
          product: item.product,
          size: item.size || null,
          shape: item.shape || null,
          flavors: item.isCandleProduct
            ? []
            : item.flavor ? item.flavor.split(",").map((f) => f.trim()).filter(Boolean) : [],
          design: item.style || null,
          extras: item.isCandleProduct ? [] : (item.extras || []),
          candles: item.candles || [],
        })),
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
        orderId,
        language: lang,
        // Intent only — create-postfinance-payment independently verifies
        // eligibility and computes the real discount server-side.
        useWelcomeDiscount: useWelcomeDiscount && canApplyWelcomeDiscountToThisOrder,
        // Intent only — never the amount actually credited/debited. The
        // backend independently verifies the real available balance, caps
        // it, and reserves it. Requires backend support (reserve_reward_credit
        // etc.) not yet implemented — safe to send regardless, current
        // create-postfinance-payment simply ignores unknown fields.
        rewardAmountToUse: estimatedRewardUsed,
      };

      console.log("Setting up embedded checkout with:", {
        itemCount: payload.items.length,
        totalAmount: payload.totalAmount,
        deliveryOption: payload.deliveryOption,
      });

      // GA4 — the order is finalised and the customer is about to be handed
      // to PostFinance. Record the real order figures now so `purchase` can
      // be reported accurately later (the cart is cleared before the
      // payment-success page runs), keyed by this orderId = transaction_id.
      const ga4Items = cartItemsToGA4Items(items);
      stashPurchaseSnapshot({
        transaction_id: orderId,
        currency: "CHF",
        value: totalPrice,
        shipping: deliveryOption === "delivery" ? deliveryPrice : 0,
        items: ga4Items,
      });
      if (!paymentInfoSentRef.current) {
        paymentInfoSentRef.current = true;
        trackEvent("add_payment_info", {
          currency: "CHF",
          value: totalPrice,
          payment_type: "PostFinance Checkout",
          items: ga4Items,
        });
      }

      setCheckoutPayload(payload);
      setShowEmbeddedCheckout(true);
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

        <div className="bg-card shadow-md p-6">
          <h2 className="font-sans uppercase tracking-[0.105em] text-xl text-foreground mb-6 font-semibold">
            {t("Contact Information", "Coordonnées")}
          </h2>

          {items.length === 0 && (
            <div className="mb-6 border border-border bg-muted/30 p-4">
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
                  onBlur={() => setFirstName((prev) => normalizeName(prev))}
                  placeholder={t("Enter your first name", "Saisissez votre prénom")}
                  readOnly={isLoggedIn}
                  className={cn("rounded-none", isLoggedIn && "bg-muted text-muted-foreground cursor-not-allowed")}
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
                  onBlur={() => setLastName((prev) => normalizeName(prev))}
                  placeholder={t("Enter your last name", "Saisissez votre nom")}
                  readOnly={isLoggedIn}
                  className={cn("rounded-none", isLoggedIn && "bg-muted text-muted-foreground cursor-not-allowed")}
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
                  <SelectTrigger className="w-[110px] shrink-0 rounded-none">
                    <span className="flex items-center gap-1 text-sm leading-none">{COUNTRY_CODES.find(c => c.code === countryCode)?.flag} {countryCode}</span>
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
                  inputMode="numeric"
                  className="rounded-none"
                  value={phone}
                  onChange={(e) => setPhone(sanitizePhoneLocalInput(e.target.value, countryCode))}
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
                onBlur={() => setEmail((prev) => normalizeEmail(prev))}
                placeholder={t("Enter your email address", "Saisissez votre adresse e-mail")}
                readOnly={isLoggedIn}
                className={cn("rounded-none", isLoggedIn && "bg-muted text-muted-foreground cursor-not-allowed")}
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
                      "w-full justify-start text-left font-normal rounded-none",
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
                <div className="flex items-center space-x-3 p-3 border border-border hover:bg-muted/50 cursor-pointer">
                  <RadioGroupItem value="pickup" id="pickup" />
                  <Label htmlFor="pickup" className="cursor-pointer flex-1">
                    <span className="font-medium">{t("Pick-up", "Retrait")}</span>
                    <p className="text-sm text-muted-foreground">
                      {t("Pick up your order at our store", "Retirez votre commande à notre boutique")}
                    </p>
                  </Label>
                </div>
                <div className="flex items-center space-x-3 p-3 border border-border hover:bg-muted/50 cursor-pointer">
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
                  <SelectTrigger className="w-full rounded-none">
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
              <div className="space-y-4 p-4 bg-muted/30 border border-border">
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
                    <SelectTrigger className="w-full rounded-none">
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
                        const baseName = c.id === NUMBER_CANDLE_ID ? t("Number Candle", "Bougie chiffre") : (candle?.name || "");
                        const name = composeCandleName(c, baseName);
                        const price = c.id === NUMBER_CANDLE_ID
                          ? c.quantity * NUMBER_CANDLE_PRICE
                          : (candle ? getCandleTotalPrice(candle.id, item.candles || []) : 0);
                        return { name, qty: c.quantity, price };
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

              {canUseWelcomeDiscountNow && (
                <div className="flex items-center space-x-3 py-2">
                  <Checkbox
                    id="useWelcomeDiscount"
                    checked={useWelcomeDiscount}
                    onCheckedChange={(c) => setUseWelcomeDiscount(c === true)}
                  />
                  <Label htmlFor="useWelcomeDiscount" className="text-sm cursor-pointer">
                    {t("Use my welcome offer -10%", "Utiliser mon offre de bienvenue -10%")}
                  </Label>
                </div>
              )}

              {useWelcomeDiscount && canUseWelcomeDiscountNow && (
                <div className="flex justify-between items-center mb-2">
                  <span className="text-muted-foreground">{t("Welcome discount -10%", "Réduction bienvenue -10%")}</span>
                  <span className="font-medium text-primary">- CHF {estimatedWelcomeDiscount.toFixed(2)}</span>
                </div>
              )}

              {rewardEligible && (
                <div className="flex items-center space-x-3 py-2">
                  <Checkbox
                    id="useReward"
                    checked={useReward}
                    onCheckedChange={(c) => setUseReward(c === true)}
                  />
                  <Label htmlFor="useReward" className="text-sm cursor-pointer">
                    {t(`Use my balance (CHF ${rewardBalance.toFixed(2)} available)`, `Utiliser ma cagnotte (CHF ${rewardBalance.toFixed(2)} disponible)`)}
                  </Label>
                </div>
              )}

              {estimatedRewardUsed > 0 && (
                <div className="flex justify-between items-center mb-2">
                  <span className="text-muted-foreground">{t("Reward balance used", "Cagnotte utilisée")}</span>
                  <span className="font-medium text-primary">- CHF {estimatedRewardUsed.toFixed(2)}</span>
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

              {/* Newsletter Checkbox - Optional. Hidden for a logged-in
                  customer already subscribed — nothing left to offer them. */}
              {!(isLoggedIn && profile?.newsletter_subscription) && (
                <div className="flex items-start space-x-3">
                  <Checkbox
                    id="newsletter"
                    checked={subscribeNewsletter}
                    onCheckedChange={(checked) => setSubscribeNewsletter(checked === true)}
                    className="mt-0.5"
                  />
                  <div>
                    <Label htmlFor="newsletter" className="text-sm cursor-pointer leading-relaxed">
                      {t("Unlock exclusive updates & offers ✨", "Recevez nos actualités et offres exclusives ✨")}
                    </Label>
                    <p className="text-xs text-foreground/50 mt-1">
                      {isLoggedIn ? (
                        t("Subscribe to our newsletter to unlock 10% off your first order.", "Inscrivez-vous à notre newsletter pour débloquer -10 % sur votre première commande.")
                      ) : (
                        <>
                          {t("Want 10% off your first order? ", "Vous voulez -10 % sur votre première commande ? ")}
                          <Link to="/signup" className="underline hover:text-foreground/80">
                            {t("Create an account", "Créez un compte")}
                          </Link>
                          {t(" and subscribe to our newsletter.", " et inscrivez-vous à notre newsletter.")}
                        </>
                      )}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Submit Button */}
            <Button
              type="submit"
              className="w-full"
              size="lg"
              disabled={!acceptPrivacyPolicy || isSubmitting || items.length === 0 || showEmbeddedCheckout}
            >
              {items.length === 0
                ? t("Empty cart", "Panier vide")
                : isSubmitting
                  ? t("Loading...", "Chargement...")
                  : showEmbeddedCheckout
                    ? t("Complete payment below", "Finalisez le paiement ci-dessous")
                    : t("Proceed to Payment", "Procéder au paiement")}
            </Button>
          </form>

          {/* PostFinance Checkout */}
          {showEmbeddedCheckout && checkoutPayload && (
            <div className="mt-8 pt-6 border-t border-border">
              <h3 className="text-lg font-serif text-foreground mb-2">
                {t("Complete Your Payment", "Finalisez votre paiement")}
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                {t("Please complete your payment below to confirm your order. All transactions are secured by PostFinance.", "Veuillez finaliser votre paiement ci-dessous pour confirmer votre commande. Toutes les transactions sont sécurisées par PostFinance.")}
              </p>
              <PostFinanceCheckout payload={checkoutPayload} />
            </div>
          )}
        </div>
      </main>
    </Layout>
  );
};

export default Checkout;
