import { useState, useEffect, useRef, useMemo } from "react";
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
import { FAMILY_CANDLE_COLORS } from "@/components/ColorFamilyCandleCard";
import {
  normalizeEmail,
  normalizeName,
  combinePhoneNumber,
  splitPhoneNumber,
} from "@/lib/identity";
import { PhoneNumberField } from "@/components/PhoneNumberField";
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
import { useCart, VALID_PRODUCTS, type CartItem } from "@/context/CartContext";
import {
  trackEvent,
  trackEventWhenReady,
  cartItemsToGA4Items,
  cartItemsValue,
  stashPurchaseSnapshot,
} from "@/lib/analytics";
import { useToast } from "@/hooks/use-toast";
import Layout from "@/components/Layout";
import DeliveryAddressAutocomplete, { type AddressSelection } from "@/components/DeliveryAddressAutocomplete";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { isOrderDateDisabled, expressSurcharge, EXPRESS_COPY } from "@/lib/orderDates";
import { expressCalendarProps, ExpressLegend, ExpressDateNotice } from "@/components/ExpressDateNotice";
import { PostFinanceCheckout } from "@/components/EmbeddedCheckout";
import { MULTI_DATE_FULFILLMENT_ENABLED } from "@/lib/featureFlags";

// Anti double-payment guard. Set when the customer is handed to PostFinance,
// short TTL so a stale value can never wedge the checkout. Cleared on
// ?payment=failed, on unmount, and on an explicit "start over".
const CHECKOUT_INFLIGHT_KEY = "bento_checkout_inflight";
const CHECKOUT_INFLIGHT_TTL_MS = 60_000;

function isCheckoutInFlight(): boolean {
  try {
    const raw = sessionStorage.getItem(CHECKOUT_INFLIGHT_KEY);
    if (!raw) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts) || Date.now() - ts > CHECKOUT_INFLIGHT_TTL_MS) {
      sessionStorage.removeItem(CHECKOUT_INFLIGHT_KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
function markCheckoutInFlight() {
  try { sessionStorage.setItem(CHECKOUT_INFLIGHT_KEY, String(Date.now())); } catch { /* ignore */ }
}
function clearCheckoutInFlight() {
  try { sessionStorage.removeItem(CHECKOUT_INFLIGHT_KEY); } catch { /* ignore */ }
}

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

// Delivery pricing is no longer derived from the postal code on this page.
// The customer selects a real address (Google Places autocomplete); the
// driving distance and fee are resolved server-side by the
// resolve-delivery-quote edge function, and independently re-verified by
// create-postfinance-payment before any charge. The tariff grid lives only
// in supabase/functions/_shared/delivery-pricing.ts.

// Result of resolve-delivery-quote for the selected address.
type DeliveryQuote = {
  fee: number;
  distanceKm: number;
  postalCode: string;
  city: string;
  lat: number | null;
  lng: number | null;
  formattedAddress: string;
};

type DeliveryQuoteStatus =
  | "idle" // no address selected yet
  | "loading" // address selected, distance/fee being resolved
  | "ok" // fee available
  | "out_of_range" // address is beyond the delivery limit
  | "error"; // Google unreachable / distance couldn't be computed

const formatDisplayDate = (date: Date) => format(date, "dd.MM.yyyy");

// "YYYY-MM-DD" workshop session date → "DD.MM.YYYY" for the order summary.
const formatWorkshopDateCheckout = (dateStr: string) => {
  const [y, m, d] = dateStr.split("-");
  return y && m && d ? `${d}.${m}.${y}` : dateStr;
};

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

// Builds order_items.candle_colors — the human-readable English names of the
// colours the customer actually picked for "by the piece" colour-family
// candles (Thick / Shiny Spiral, Pastel Spiral, Rainbow). Same idea as
// buildCandleFields: one flat list across every candle line of the item,
// duplicates kept on purpose so two loose pink candles read as
// ["Pink", "Pink"]. Candles with no colour choice (packs, plain models,
// the Number Candle) contribute nothing, so an item without any coloured
// candle yields []. CandleSelection.colors holds colour ids ("dark-pink");
// FAMILY_CANDLE_COLORS[candleId] resolves each to its English label, and an
// unknown id falls back to the raw id rather than being dropped.
const buildCandleColors = (
  candleSelections: { id: string; colors?: string[] }[],
): string[] =>
  candleSelections.flatMap((c) => {
    if (!c.colors || c.colors.length === 0) return [];
    const family = FAMILY_CANDLE_COLORS[c.id];
    return c.colors.map(
      (colorId) => family?.find((x) => x.id === colorId)?.en ?? colorId,
    );
  });

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

  // A workshop is a real cart product but has no pickup/delivery: its date is
  // the session date, stored per order_item. Physical products keep the
  // existing single pickup/delivery date + method. When the cart is 100%
  // workshops there is no pickup/delivery step at all.
  const physicalItems = items.filter((i) => i.product !== "workshop");
  const workshopItems = items.filter((i) => i.product === "workshop");
  const hasPhysical = physicalItems.length > 0;

  // ── Multi-date fulfillment (Sept 2026) — grouping only, no UI/behaviour
  // change while MULTI_DATE_FULFILLMENT_ENABLED is false. Physical items
  // sharing the exact same orderDate become ONE fulfillment (one pickup/
  // delivery decision); each distinct date becomes its own. While the flag
  // is off, CartContext already refuses a second date at add-to-cart time,
  // so this can only ever resolve to 0 or 1 group in production today —
  // isMultiDateActive below is therefore always false until the flag flips.
  const physicalDateGroups = useMemo(() => {
    const byDate = new Map<string, CartItem[]>();
    for (const item of physicalItems) {
      if (!item.orderDate) continue;
      const list = byDate.get(item.orderDate);
      if (list) list.push(item); else byDate.set(item.orderDate, [item]);
    }
    return Array.from(byDate.entries())
      .map(([date, dateItems]) => ({ date, items: dateItems }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [physicalItems]);

  const isMultiDateActive = MULTI_DATE_FULFILLMENT_ENABLED && physicalDateGroups.length > 1;

  // One delivery decision per date group, keyed by ISO date. Only read/
  // written when isMultiDateActive — the single-date state below (deliveryOption,
  // deliveryAddress, …) stays the sole source of truth otherwise, completely
  // untouched by any of this.
  interface FulfillmentDraft {
    deliveryOption: "pickup" | "delivery";
    deliveryAddress: string;
    deliveryPlaceId: string | null;
    deliveryQuote: DeliveryQuote | null;
    deliveryQuoteStatus: DeliveryQuoteStatus;
    pickupTime: string;
    deliveryTime: string;
  }
  const EMPTY_FULFILLMENT_DRAFT: FulfillmentDraft = {
    deliveryOption: "pickup",
    deliveryAddress: "",
    deliveryPlaceId: null,
    deliveryQuote: null,
    deliveryQuoteStatus: "idle",
    pickupTime: "",
    deliveryTime: "",
  };
  const [fulfillmentDrafts, setFulfillmentDrafts] = useState<Record<string, FulfillmentDraft>>({});
  const getFulfillmentDraft = (date: string): FulfillmentDraft =>
    fulfillmentDrafts[date] ?? EMPTY_FULFILLMENT_DRAFT;
  const patchFulfillmentDraft = (date: string, patch: Partial<FulfillmentDraft>) => {
    setFulfillmentDrafts((prev) => ({
      ...prev,
      [date]: { ...(prev[date] ?? EMPTY_FULFILLMENT_DRAFT), ...patch },
    }));
  };
  const handleAddressSelectForDate = async (date: string, selection: AddressSelection) => {
    patchFulfillmentDraft(date, {
      deliveryAddress: selection.label,
      deliveryPlaceId: selection.placeId,
      deliveryQuote: null,
      deliveryQuoteStatus: "loading",
    });
    try {
      const { data, error } = await supabase.functions.invoke("resolve-delivery-quote", {
        body: { placeId: selection.placeId, sessionToken: selection.sessionToken },
      });
      if (error || !data) {
        patchFulfillmentDraft(date, { deliveryQuoteStatus: "error" });
        return;
      }
      if (!data.deliverable) {
        patchFulfillmentDraft(date, {
          deliveryQuoteStatus: "out_of_range",
          deliveryAddress: data.address?.formattedAddress || selection.label,
        });
        return;
      }
      patchFulfillmentDraft(date, {
        deliveryQuote: {
          fee: data.fee,
          distanceKm: data.distanceKm,
          postalCode: data.address?.postalCode ?? "",
          city: data.address?.city ?? "",
          lat: data.address?.lat ?? null,
          lng: data.address?.lng ?? null,
          formattedAddress: data.address?.formattedAddress ?? selection.label,
        },
        deliveryAddress: data.address?.formattedAddress || selection.label,
        deliveryQuoteStatus: "ok",
      });
    } catch {
      patchFulfillmentDraft(date, { deliveryQuoteStatus: "error" });
    }
  };

  // Sums used by both the price summary and the final total — 0 whenever
  // isMultiDateActive is false (the reduce runs over an empty array).
  const multiDateDeliveryFeeTotal = physicalDateGroups.reduce((sum, g) => {
    const d = getFulfillmentDraft(g.date);
    return sum + (d.deliveryOption === "delivery" && d.deliveryQuoteStatus === "ok" && d.deliveryQuote ? d.deliveryQuote.fee : 0);
  }, 0);
  const multiDateExpressSurchargeTotal = physicalDateGroups.reduce((sum, g) => {
    const groupTotal = g.items.reduce((s, i) => s + i.total, 0);
    return sum + expressSurcharge(groupTotal, new Date(g.date + "T00:00:00"));
  }, 0);

  const [deliveryDate, setDeliveryDate] = useState<Date>(() => {
    const firstPhysicalWithDate = items.find((i) => i.product !== "workshop" && i.orderDate);
    if (firstPhysicalWithDate?.orderDate) {
      const parsed = new Date(firstPhysicalWithDate.orderDate);
      return isNaN(parsed.getTime()) ? undefined as unknown as Date : parsed;
    }
    return undefined as unknown as Date;
  });
  const [deliveryOption, setDeliveryOption] = useState("pickup");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  // Set only when the customer picks a real Google suggestion. The place id
  // is the single delivery value the backend trusts — it re-resolves the
  // address, coordinates and driving distance from it before charging.
  const [deliveryPlaceId, setDeliveryPlaceId] = useState<string | null>(null);
  const [deliveryQuote, setDeliveryQuote] = useState<DeliveryQuote | null>(null);
  const [deliveryQuoteStatus, setDeliveryQuoteStatus] = useState<DeliveryQuoteStatus>("idle");
  const [deliveryComment, setDeliveryComment] = useState("");
  const [acceptPrivacyPolicy, setAcceptPrivacyPolicy] = useState(false);
  const [subscribeNewsletter, setSubscribeNewsletter] = useState(false);
  const [pickupTime, setPickupTime] = useState("");
  const [deliveryTime, setDeliveryTime] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showEmbeddedCheckout, setShowEmbeddedCheckout] = useState(false);
  const [checkoutPayload, setCheckoutPayload] = useState<any>(null);
  // PostFinance's failedUrl (/checkout?payment=failed) brings the customer
  // back here after a declined / failed payment. The cart is preserved (never
  // cleared on this path) — this just shows a persistent, actionable banner.
  const [showPaymentFailed, setShowPaymentFailed] = useState(false);

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


  // PostFinance's failedUrl brings the customer straight back here with
  // ?payment=failed&order_id=<orderId> — cart is left untouched (nothing here
  // calls clearCart()) so they can retry immediately. Clears the in-flight
  // lock so an immediate retry is never blocked, and asks the backend to
  // reconcile the failed attempt (confirm-postfinance-payment sees the
  // FAILED / DECLINE / VOIDED state and releases the welcome + reward
  // reservations tied to that orderId).
  useEffect(() => {
    if (searchParams.get("payment") === "failed") {
      clearCheckoutInFlight();
      setShowPaymentFailed(true);
      setShowEmbeddedCheckout(false);
      setCheckoutPayload(null);

      const failedOrderId = searchParams.get("order_id");
      if (failedOrderId) {
        supabase.functions
          .invoke("confirm-postfinance-payment", { body: { orderId: failedOrderId } })
          .catch((e) => console.error("failed-payment reconciliation error:", e));
      }

      toast({
        title: t("Payment failed", "Échec du paiement"),
        description: t(
          "Payment failed. Your cart has been saved — please try again or use another payment method.",
          "Le paiement a échoué. Votre panier a été conservé — réessayez ou utilisez un autre moyen de paiement."
        ),
        variant: "destructive",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The in-flight lock never outlives this page.
  useEffect(() => () => clearCheckoutInFlight(), []);

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
  // Reward balance & the welcome discount never apply to workshops — this is
  // the base they are computed against (products only, delivery excluded).
  const rewardEligibleItemsTotal = items
    .filter((item) => item.product !== "workshop")
    .reduce((sum, item) => sum + item.total, 0);

  // Clears any address/quote already entered — used when the customer edits
  // the address, or switches back to pick-up. Never leaves a stale fee
  // attached to a new address.
  const resetDeliveryQuote = () => {
    setDeliveryPlaceId(null);
    setDeliveryQuote(null);
    setDeliveryQuoteStatus("idle");
    setDeliveryAddress("");
  };

  // Fired when the customer picks a real suggestion. Immediately drops the
  // previous fee, then asks the backend for the driving distance + tariff.
  const handleAddressSelect = async (selection: AddressSelection) => {
    setDeliveryAddress(selection.label);
    setDeliveryPlaceId(selection.placeId);
    setDeliveryQuote(null);
    setDeliveryQuoteStatus("loading");
    try {
      const { data, error } = await supabase.functions.invoke("resolve-delivery-quote", {
        body: { placeId: selection.placeId, sessionToken: selection.sessionToken },
      });
      if (error || !data) {
        setDeliveryQuoteStatus("error");
        return;
      }
      if (!data.deliverable) {
        setDeliveryQuoteStatus("out_of_range");
        if (data.address?.formattedAddress) setDeliveryAddress(data.address.formattedAddress);
        return;
      }
      setDeliveryQuote({
        fee: data.fee,
        distanceKm: data.distanceKm,
        postalCode: data.address?.postalCode ?? "",
        city: data.address?.city ?? "",
        lat: data.address?.lat ?? null,
        lng: data.address?.lng ?? null,
        formattedAddress: data.address?.formattedAddress ?? selection.label,
      });
      if (data.address?.formattedAddress) setDeliveryAddress(data.address.formattedAddress);
      setDeliveryQuoteStatus("ok");
    } catch {
      setDeliveryQuoteStatus("error");
    }
  };

  // The embedded PostFinance checkout is a one-shot snapshot: `checkoutPayload`
  // is frozen when "Proceed to Payment" is pressed, and create-postfinance-payment
  // has already staged a pending_payment / created a PostFinance transaction
  // from it. If the customer then changes their delivery choice (pick-up ⇄
  // delivery, a different address, a re-resolved quote), that snapshot — and
  // the amount PostFinance will charge — no longer matches what the summary
  // shows. Drop it so the customer has to press "Proceed to Payment" again
  // and a fresh payload (current delivery_method / deliveryPlaceId /
  // delivery_address / fee) is sent. A clean single-pass checkout never
  // triggers this; Pick-up behaviour is unchanged.
  useEffect(() => {
    setShowEmbeddedCheckout(false);
    setCheckoutPayload(null);
  }, [deliveryOption, deliveryPlaceId, deliveryQuote]);

  // Multi-date active: the single deliveryOption/deliveryQuote state is not
  // used at all — multiDateDeliveryFeeTotal (summed across every date's own
  // draft, computed above) is the real figure.
  const deliveryPrice = isMultiDateActive
    ? multiDateDeliveryFeeTotal
    : (deliveryOption === "delivery" && deliveryQuoteStatus === "ok" && deliveryQuote
      ? deliveryQuote.fee
      : 0);

  const deliveryReady = isMultiDateActive
    ? physicalDateGroups.every((g) => {
        const d = getFulfillmentDraft(g.date);
        return d.deliveryOption !== "delivery" || d.deliveryQuoteStatus === "ok";
      })
    : (deliveryOption !== "delivery" || deliveryQuoteStatus === "ok");

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
    if (item.product === "workshop") continue; // workshops never carry the welcome discount
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
  const maxRewardUsable = Math.max(0, Math.round((rewardEligibleItemsTotal - estimatedWelcomeDiscount) * 100) / 100);
  // No amount choice — enabling the option always requests the maximum
  // usable amount (never more than what's left to pay on products).
  const estimatedRewardUsed = (useReward && rewardEligible)
    ? Math.round(Math.min(rewardBalance, maxRewardUsable) * 100) / 100
    : 0;

  // Express surcharge (+10%) — DISPLAY ONLY. The server
  // (create-postfinance-payment) re-derives it from the Europe/Zurich date vs
  // pickup_delivery_date and is the sole authority on the charged amount.
  // Base = physical products only (workshops + delivery excluded).
  // Multi-date active: each date is evaluated against its OWN items'
  // subtotal (multiDateExpressSurchargeTotal, computed above) — a J+2 date
  // and a J+9 date in the same order must not share one flag.
  const physicalProductsTotal = items
    .filter((item) => item.product !== "workshop")
    .reduce((sum, item) => sum + item.total, 0);
  const expressSurchargeAmount = isMultiDateActive
    ? multiDateExpressSurchargeTotal
    : expressSurcharge(physicalProductsTotal, deliveryDate);

  // deliveryPrice already resolves to 0 when there's nothing to charge, in
  // BOTH modes (single: gated by deliveryOption === "delivery" internally;
  // multi-date: multiDateDeliveryFeeTotal is 0 when every date is pickup) —
  // no need to re-gate on the single deliveryOption state here, which would
  // be WRONG for the multi-date case (that state isn't even used then, so
  // checking it here would silently drop a real multi-date delivery total).
  const totalPrice = itemsTotal
    - estimatedWelcomeDiscount
    - estimatedRewardUsed
    + expressSurchargeAmount
    + (hasPhysical ? deliveryPrice : 0);

  // Build phone number with country code
  const fullPhoneNumber = combinePhoneNumber(countryCode, phone);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Anti double-payment: a checkout was handed to PostFinance moments ago
    // and hasn't resolved. Never create a second parallel attempt.
    if (isCheckoutInFlight()) {
      toast({
        title: t("Payment already in progress", "Paiement déjà en cours"),
        description: t(
          "Please finish or close the payment you just started before trying again.",
          "Merci de finaliser ou de fermer le paiement que vous venez de démarrer avant de réessayer."
        ),
        variant: "destructive",
      });
      return;
    }

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

    if (!isMultiDateActive) {
      // ── Single-date validation — UNCHANGED from before multi-date existed ──
      if (hasPhysical && !deliveryDate) {
        toast({
          title: t("Please select a delivery date", "Veuillez sélectionner une date"),
          variant: "destructive",
        });
        return;
      }

      // Only physical items carry a pickup/delivery date; workshops have
      // their own session date per order_item and never enter this check.
      // While isMultiDateActive is false (always true in production today),
      // this can only ever find 0 or 1 distinct dates — CartContext already
      // refuses a second one at add-to-cart time — so this toast is web-only
      // reachable if that guard is ever bypassed (e.g. two browser tabs).
      const datedItems = physicalItems.filter((i) => i.orderDate);
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

      if (deliveryOption === "delivery" && (!deliveryPlaceId || deliveryQuoteStatus === "idle")) {
        toast({
          title: t("Please select your delivery address", "Veuillez sélectionner votre adresse de livraison"),
          description: t(
            "Start typing and pick your address from the suggestions.",
            "Commencez à saisir votre adresse et choisissez-la dans les suggestions.",
          ),
          variant: "destructive",
        });
        return;
      }

      if (deliveryOption === "delivery" && deliveryQuoteStatus === "loading") {
        toast({
          title: t("Calculating delivery fee…", "Calcul des frais de livraison…"),
          description: t("Please wait a moment and try again.", "Merci de patienter un instant puis de réessayer."),
          variant: "destructive",
        });
        return;
      }

      if (deliveryOption === "delivery" && deliveryQuoteStatus === "out_of_range") {
        toast({
          title: t("Delivery is not available for this address.", "La livraison n'est pas disponible pour cette adresse."),
          description: t(
            "You can still choose Pick-up at our store.",
            "Vous pouvez toujours choisir le retrait à notre boutique.",
          ),
          variant: "destructive",
        });
        return;
      }

      if (deliveryOption === "delivery" && (deliveryQuoteStatus !== "ok" || !deliveryQuote)) {
        toast({
          title: t("Delivery fee unavailable", "Frais de livraison indisponibles"),
          description: t(
            "We couldn't calculate the delivery fee. Please try again, or choose Pick-up.",
            "Impossible de calculer les frais de livraison. Réessayez, ou choisissez le retrait.",
          ),
          variant: "destructive",
        });
        return;
      }

      if (hasPhysical && deliveryOption === "pickup" && !pickupTime) {
        toast({
          title: t("Pick-up Time required", "Heure de retrait requise"),
          description: t("Please select a pick-up time slot.", "Veuillez sélectionner un créneau de retrait."),
          variant: "destructive",
        });
        return;
      }

      if (hasPhysical && deliveryOption === "delivery" && (!deliveryTime || !deliveryComment.trim())) {
        toast({
          title: t("Delivery information required", "Informations de livraison requises"),
          description: t("Please select a delivery time slot and add a comment with the necessary delivery information.", "Veuillez sélectionner un créneau de livraison et ajouter un commentaire avec les informations nécessaires."),
          variant: "destructive",
        });
        return;
      }
    } else {
      // ── Multi-date validation — same rules as above, evaluated once per
      // date group instead of once for the whole order. Stops at the FIRST
      // incomplete date group (never partially submits).
      for (const group of physicalDateGroups) {
        const d = getFulfillmentDraft(group.date);
        const dateLabel = formatDisplayDate(new Date(group.date + "T00:00:00"));

        if (d.deliveryOption === "delivery" && (!d.deliveryPlaceId || d.deliveryQuoteStatus === "idle")) {
          toast({
            title: t(`Please select a delivery address for ${dateLabel}`, `Veuillez sélectionner une adresse de livraison pour le ${dateLabel}`),
            variant: "destructive",
          });
          return;
        }
        if (d.deliveryOption === "delivery" && d.deliveryQuoteStatus === "loading") {
          toast({
            title: t("Calculating delivery fee…", "Calcul des frais de livraison…"),
            variant: "destructive",
          });
          return;
        }
        if (d.deliveryOption === "delivery" && d.deliveryQuoteStatus === "out_of_range") {
          toast({
            title: t(`Delivery is not available for ${dateLabel}'s address.`, `La livraison n'est pas disponible pour l'adresse du ${dateLabel}.`),
            variant: "destructive",
          });
          return;
        }
        if (d.deliveryOption === "delivery" && (d.deliveryQuoteStatus !== "ok" || !d.deliveryQuote)) {
          toast({
            title: t(`Delivery fee unavailable for ${dateLabel}`, `Frais de livraison indisponibles pour le ${dateLabel}`),
            variant: "destructive",
          });
          return;
        }
        if (d.deliveryOption === "pickup" && !d.pickupTime) {
          toast({
            title: t(`Pick-up time required for ${dateLabel}`, `Heure de retrait requise pour le ${dateLabel}`),
            variant: "destructive",
          });
          return;
        }
        if (d.deliveryOption === "delivery" && !d.deliveryTime) {
          toast({
            title: t(`Delivery time slot required for ${dateLabel}`, `Créneau de livraison requis pour le ${dateLabel}`),
            variant: "destructive",
          });
          return;
        }
      }
    }

    // GA4 add_shipping_info — pickup vs delivery (and zone) is now fully
    // chosen and validated. Fired before the availability re-check / payload
    // build so it reflects the moment the delivery choice is confirmed.
    if (!shippingInfoSentRef.current) {
      shippingInfoSentRef.current = true;
      trackEvent("add_shipping_info", {
        currency: "CHF",
        value: cartItemsValue(items),
        shipping_tier: deliveryOption === "delivery" ? "delivery" : "pickup",
        items: cartItemsToGA4Items(items),
      });
    }

    setShowEmbeddedCheckout(false);
    setIsSubmitting(true);

    try {
      // Physical products carry a pickup/delivery date; a workshop-only cart
      // has none (each workshop's session date lives on its order_item).
      // There is no per-day order cap any more — every calendar day is
      // available, the only rule is the J+2 lead time enforced by the
      // calendar and re-checked server-side (create-postfinance-payment
      // also derives the express surcharge from this same date).
      const formattedDate = hasPhysical && deliveryDate ? format(deliveryDate, "yyyy-MM-dd") : null;

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
      const slot = !hasPhysical ? null : (deliveryOption === "pickup" ? pickupTime : deliveryTime);

      // Multi-date fulfillment payload — undefined on every order today
      // (isMultiDateActive is only ever true once MULTI_DATE_FULFILLMENT_
      // ENABLED flips AND the cart genuinely spans 2+ dates). itemIndexes are
      // positions into `items` — the SAME order orderItemsWithImageUrls /
      // orderItemsRows / pricingItems are built from just below, so the
      // indices line up exactly for create-postfinance-payment to read.
      const fulfillmentsPayload = isMultiDateActive
        ? physicalDateGroups.map((group) => {
            const d = getFulfillmentDraft(group.date);
            const itemIndexes = items
              .map((it, idx) => (it.product !== "workshop" && it.orderDate === group.date ? idx : -1))
              .filter((idx) => idx >= 0);
            return {
              date: group.date,
              deliveryMethod: d.deliveryOption,
              deliveryPlaceId: d.deliveryOption === "delivery" ? d.deliveryPlaceId : undefined,
              slot: d.deliveryOption === "pickup" ? d.pickupTime : d.deliveryTime,
              itemIndexes,
            };
          })
        : undefined;

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
      // A workshop-only cart has no pickup/delivery: delivery_method and every
      // pickup_delivery_* field are null (orders.delivery_method and
      // orders.pickup_delivery_datetime are nullable — see migration).
      const usesDelivery = hasPhysical && deliveryOption === "delivery";
      const orderData = {
        id: orderId,
        order_source: "website",
        lang,
        first_name: normalizeName(firstName),
        last_name: normalizeName(lastName),
        email: normalizeEmail(email),
        phone: fullPhoneNumber,
        delivery_method: hasPhysical ? deliveryOption : null,
        // Delivery fields below are display/record values. create-postfinance-payment
        // re-resolves address, coordinates, distance and fee from deliveryPlaceId
        // (server-authoritative) and overwrites delivery_fee / delivery_zone /
        // delivery_distance_km / coordinates before charging.
        delivery_address: usesDelivery ? (deliveryQuote?.formattedAddress ?? deliveryAddress) : null,
        delivery_zone: null,
        delivery_fee: usesDelivery ? deliveryPrice : 0,
        delivery_postal_code: usesDelivery ? (deliveryQuote?.postalCode || null) : null,
        delivery_city: usesDelivery ? (deliveryQuote?.city || null) : null,
        delivery_latitude: usesDelivery ? (deliveryQuote?.lat ?? null) : null,
        delivery_longitude: usesDelivery ? (deliveryQuote?.lng ?? null) : null,
        delivery_distance_km: usesDelivery ? (deliveryQuote?.distanceKm ?? null) : null,
        pickup_delivery_date: formattedDate,
        pickup_delivery_slot: slot,
        // Temporary compatibility field, now nullable — null for a
        // workshop-only order.
        pickup_delivery_datetime: hasPhysical && deliveryDate && slot
          ? buildPickupDeliveryDatetime(deliveryDate, slot)
          : null,
        order_comment: usesDelivery ? deliveryComment : null,
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

        const isWorkshop = item.product === "workshop";

        return {
          order_id: orderId,
          product: item.product,
          size: item.size || null,
          shape: item.shape || null,
          flavors: item.flavorName ? item.flavorName.split(",").map((f) => f.trim()).filter(Boolean) : [],
          design: isWorkshop ? null : (item.style || null),
          // Workshop-only columns (nullable, empty for every other product).
          workshop_type: isWorkshop ? (item.workshopType ?? null) : null,
          workshop_session_id: isWorkshop ? (item.workshopSessionId ?? null) : null,
          workshop_date: isWorkshop ? (item.workshopDate ?? null) : null,
          workshop_time: isWorkshop ? (item.workshopTime ?? null) : null,
          workshop_participants: isWorkshop ? (item.workshopParticipants ?? null) : null,
          workshop_unit_price: isWorkshop ? (item.workshopUnitPrice ?? null) : null,
          workshop_has_minor: isWorkshop ? !!item.workshopHasMinor : false,
          workshop_minor_consent_confirmed: isWorkshop ? !!item.workshopMinorConsentConfirmed : false,
          // Exact catalogue design photo the customer clicked (multi-option
          // designs only) — complements `design`, never replaces it. null for
          // every other case; old orders stay null and keep working.
          design_image_url: item.designImageUrl || null,
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
          // Human-readable colours actually chosen for the candles (both the
          // standalone Candles.tsx purchase and candles added on top of a
          // cake carry them in item.candles[].colors). [] when none apply.
          candle_colors: buildCandleColors(item.candles || []),
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
          size: item.product === "workshop" ? null : (item.size || null),
          shape: item.product === "workshop" ? null : (item.shape || null),
          flavors: (item.isCandleProduct || item.product === "workshop")
            ? []
            : item.flavor ? item.flavor.split(",").map((f) => f.trim()).filter(Boolean) : [],
          design: item.product === "workshop" ? null : (item.style || null),
          extras: (item.isCandleProduct || item.product === "workshop") ? [] : (item.extras || []),
          candles: item.product === "workshop" ? [] : (item.candles || []),
          // Workshop-only — canonical snake_case. The server loads the
          // session from public.workshop_sessions and never trusts the
          // price / date / type sent here.
          workshop_type: item.product === "workshop" ? (item.workshopType ?? null) : null,
          workshop_session_id: item.product === "workshop" ? (item.workshopSessionId ?? null) : null,
          workshop_participants: item.product === "workshop" ? (item.workshopParticipants ?? null) : null,
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
        // The one delivery value the backend trusts: it re-resolves the
        // address + driving distance + fee from this id.
        deliveryPlaceId: deliveryOption === "delivery" ? deliveryPlaceId : undefined,
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
        // Multi-date fulfillment — undefined on every order today (see its
        // computation above). When present, create-postfinance-payment
        // treats it as authoritative and ignores deliveryOption/
        // deliveryAddress/deliveryPlaceId/deliveryFee above entirely.
        fulfillments: fulfillmentsPayload,
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

      setShowPaymentFailed(false);
      markCheckoutInFlight();
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

            {/* Phone — shared component, same markup/behaviour as before this
                extraction (src/components/PhoneNumberField.tsx). */}
            <PhoneNumberField
              id="phone"
              label={t("Phone Number", "Numéro de téléphone")}
              countryCode={countryCode}
              onCountryCodeChange={setCountryCode}
              localPhone={phone}
              onLocalPhoneChange={setPhone}
            />

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

            {/* Pickup / delivery block — only for carts with a physical product.
                A workshop-only cart has nothing to pick up or deliver.
                Single-date block below is UNCHANGED — it only renders when
                isMultiDateActive is false, which is always true in production
                today (MULTI_DATE_FULFILLMENT_ENABLED off). See the multi-date
                block right after for the 2+-date UI, active only once that
                flag flips and the cart genuinely spans several dates. */}
            {hasPhysical && !isMultiDateActive && (
            <>
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
                    disabled={(date) => isOrderDateDisabled(date)}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                    {...expressCalendarProps}
                  />
                  <div className="px-3 pb-3">
                    <ExpressLegend />
                  </div>
                </PopoverContent>
              </Popover>
              <ExpressDateNotice date={deliveryDate} />
            </div>

            {/* Delivery Option */}
            <div className="space-y-3">
              <Label>{t("Delivery Option", "Mode de réception")}</Label>
              <RadioGroup
                value={deliveryOption}
                onValueChange={(value) => {
                  setDeliveryOption(value);
                  if (value === "pickup") {
                    // Pick-up is unchanged — drop every delivery-only field.
                    resetDeliveryQuote();
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
                
                {/* Delivery address — Google Places autocomplete */}
                <div className="space-y-2">
                  <Label htmlFor="deliveryAddress">{t("Delivery address", "Adresse de livraison")}</Label>
                  <DeliveryAddressAutocomplete
                    id="deliveryAddress"
                    required={deliveryOption === "delivery"}
                    languageCode={lang}
                    placeholder={t("Start typing your address…", "Commencez à saisir votre adresse…")}
                    onSelect={handleAddressSelect}
                    onClear={resetDeliveryQuote}
                  />

                  {deliveryQuoteStatus === "loading" && (
                    <p className="text-sm text-muted-foreground">
                      {t("Calculating delivery fee…", "Calcul des frais de livraison…")}
                    </p>
                  )}
                  {deliveryQuoteStatus === "ok" && deliveryQuote && (
                    <p className="text-sm text-primary">
                      {t("Delivery", "Livraison")} — CHF {deliveryQuote.fee.toFixed(2)}
                    </p>
                  )}
                  {deliveryQuoteStatus === "out_of_range" && (
                    <p className="text-sm text-destructive">
                      {t(
                        "Delivery is not available for this address.",
                        "La livraison n'est pas disponible pour cette adresse.",
                      )}
                    </p>
                  )}
                  {deliveryQuoteStatus === "error" && (
                    <p className="text-sm text-destructive">
                      {t(
                        "We couldn't calculate the delivery fee. Please try again, or choose Pick-up.",
                        "Impossible de calculer les frais de livraison. Réessayez, ou choisissez le retrait.",
                      )}
                    </p>
                  )}
                  {deliveryQuoteStatus === "idle" && (
                    <p className="text-xs text-muted-foreground">
                      {t(
                        "Select an address from the suggestions to see the delivery fee.",
                        "Sélectionnez une adresse dans les suggestions pour voir les frais de livraison.",
                      )}
                    </p>
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
            </>
            )}

            {/* Multi-date fulfillment block — one card per distinct physical
                pickup/delivery date, each with its own pickup/delivery choice.
                Only rendered when MULTI_DATE_FULFILLMENT_ENABLED is on AND the
                cart genuinely spans 2+ dates — unreachable in production while
                the flag is off. */}
            {hasPhysical && isMultiDateActive && (
              <div className="space-y-6">
                {physicalDateGroups.map((group) => {
                  const draft = getFulfillmentDraft(group.date);
                  const groupDate = new Date(group.date + "T00:00:00");
                  const groupLabel = formatDisplayDate(groupDate);
                  const groupTotal = group.items.reduce((s, i) => s + i.total, 0);
                  return (
                    <div key={group.date} className="border border-border p-4 space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="font-sans uppercase tracking-wide text-sm font-semibold text-foreground">
                          {groupLabel}
                        </h3>
                        <span className="text-xs text-muted-foreground">
                          {t(`${group.items.length} item(s) — CHF ${groupTotal.toFixed(2)}`, `${group.items.length} article(s) — CHF ${groupTotal.toFixed(2)}`)}
                        </span>
                      </div>
                      <ExpressDateNotice date={groupDate} />

                      {/* Delivery Option for this date */}
                      <div className="space-y-3">
                        <Label>{t("Delivery Option", "Mode de réception")}</Label>
                        <RadioGroup
                          value={draft.deliveryOption}
                          onValueChange={(value) => {
                            patchFulfillmentDraft(group.date, {
                              deliveryOption: value as "pickup" | "delivery",
                              ...(value === "pickup"
                                ? { deliveryAddress: "", deliveryPlaceId: null, deliveryQuote: null, deliveryQuoteStatus: "idle" as DeliveryQuoteStatus }
                                : {}),
                            });
                          }}
                          className="flex flex-col space-y-2"
                        >
                          <div className="flex items-center space-x-3 p-3 border border-border hover:bg-muted/50 cursor-pointer">
                            <RadioGroupItem value="pickup" id={`pickup-${group.date}`} />
                            <Label htmlFor={`pickup-${group.date}`} className="cursor-pointer flex-1">
                              <span className="font-medium">{t("Pick-up", "Retrait")}</span>
                            </Label>
                          </div>
                          <div className="flex items-center space-x-3 p-3 border border-border hover:bg-muted/50 cursor-pointer">
                            <RadioGroupItem value="delivery" id={`delivery-${group.date}`} />
                            <Label htmlFor={`delivery-${group.date}`} className="cursor-pointer flex-1">
                              <span className="font-medium">{t("Delivery", "Livraison")}</span>
                            </Label>
                          </div>
                        </RadioGroup>
                      </div>

                      {draft.deliveryOption === "pickup" && (
                        <div className="space-y-2">
                          <Label>{t("Pick-up Time", "Heure de retrait")} <span className="text-destructive">*</span></Label>
                          <Select
                            value={draft.pickupTime}
                            onValueChange={(v) => patchFulfillmentDraft(group.date, { pickupTime: v })}
                          >
                            <SelectTrigger className="w-full rounded-none">
                              <SelectValue placeholder={t("Select a pickup time", "Choisir une heure de retrait")} />
                            </SelectTrigger>
                            <SelectContent>
                              {PICKUP_TIME_SLOTS.map((slot) => (
                                <SelectItem key={slot} value={slot}>{slot}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}

                      {draft.deliveryOption === "delivery" && (
                        <div className="space-y-4 p-4 bg-muted/30 border border-border">
                          <div className="space-y-2">
                            <Label htmlFor={`deliveryAddress-${group.date}`}>{t("Delivery address", "Adresse de livraison")}</Label>
                            <DeliveryAddressAutocomplete
                              id={`deliveryAddress-${group.date}`}
                              required
                              languageCode={lang}
                              placeholder={t("Start typing your address…", "Commencez à saisir votre adresse…")}
                              onSelect={(selection) => handleAddressSelectForDate(group.date, selection)}
                              onClear={() => patchFulfillmentDraft(group.date, { deliveryAddress: "", deliveryPlaceId: null, deliveryQuote: null, deliveryQuoteStatus: "idle" })}
                            />
                            {draft.deliveryQuoteStatus === "loading" && (
                              <p className="text-sm text-muted-foreground">{t("Calculating delivery fee…", "Calcul des frais de livraison…")}</p>
                            )}
                            {draft.deliveryQuoteStatus === "ok" && draft.deliveryQuote && (
                              <p className="text-sm text-primary">{t("Delivery", "Livraison")} — CHF {draft.deliveryQuote.fee.toFixed(2)}</p>
                            )}
                            {draft.deliveryQuoteStatus === "out_of_range" && (
                              <p className="text-sm text-destructive">{t("Delivery is not available for this address.", "La livraison n'est pas disponible pour cette adresse.")}</p>
                            )}
                            {draft.deliveryQuoteStatus === "error" && (
                              <p className="text-sm text-destructive">{t("We couldn't calculate the delivery fee. Please try again, or choose Pick-up.", "Impossible de calculer les frais de livraison. Réessayez, ou choisissez le retrait.")}</p>
                            )}
                          </div>
                          <div className="space-y-2">
                            <Label>{t("Delivery Time Slot", "Créneau de livraison")} <span className="text-destructive">*</span></Label>
                            <Select
                              value={draft.deliveryTime}
                              onValueChange={(v) => patchFulfillmentDraft(group.date, { deliveryTime: v })}
                            >
                              <SelectTrigger className="w-full rounded-none">
                                <SelectValue placeholder={t("Select a delivery time slot", "Choisir un créneau de livraison")} />
                              </SelectTrigger>
                              <SelectContent>
                                {DELIVERY_TIME_SLOTS.map((slot) => (
                                  <SelectItem key={slot} value={slot}>{slot}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          {/* NOTE (rollout report): there is deliberately no per-date
                              delivery-comment field here yet — order_fulfillments has
                              no comment column in the schema this was built against,
                              and orders.order_comment is a single, order-level value.
                              Flagged as an open question in the rollout report rather
                              than silently reusing one field for every address. */}
                        </div>
                      )}
                    </div>
                  );
                })}
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
                    if (item.product === "workshop") {
                      return (
                        <div key={item.id} className="rounded-lg border border-border bg-muted/20 p-3">
                          <div className="flex justify-between items-start gap-3">
                            <span className="font-medium text-sm text-foreground">
                              {item.styleName || t("Workshop", "Atelier")}
                              {" — "}
                              {item.workshopDate ? formatWorkshopDateCheckout(item.workshopDate) : ""}
                              {item.workshopTime ? ` ${item.workshopTime}` : ""}
                              {item.workshopParticipants ? ` (×${item.workshopParticipants})` : ""}
                            </span>
                            <span className="font-semibold text-sm text-primary whitespace-nowrap">CHF {item.total}</span>
                          </div>
                        </div>
                      );
                    }
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

              <div className="flex justify-between items-center mb-2">
                <span className="text-muted-foreground">{t("Subtotal", "Sous-total")}</span>
                <span className="font-medium">CHF {itemsTotal.toFixed(2)}</span>
              </div>

              {expressSurchargeAmount > 0 && (
                <div className="flex justify-between items-center mb-2">
                  <span className="text-muted-foreground">{EXPRESS_COPY.summaryLabel[lang === "fr" ? "fr" : "en"]}</span>
                  <span className="font-medium">CHF {expressSurchargeAmount.toFixed(2)}</span>
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

              {hasPhysical && !isMultiDateActive && deliveryOption === "delivery" && deliveryQuoteStatus === "ok" && deliveryQuote && (
                <div className="flex justify-between items-center mb-2">
                  <span className="text-muted-foreground">{t("Delivery", "Livraison")}</span>
                  <span className="font-medium">CHF {deliveryQuote.fee.toFixed(2)}</span>
                </div>
              )}

              {hasPhysical && isMultiDateActive && multiDateDeliveryFeeTotal > 0 && (
                <div className="flex justify-between items-center mb-2">
                  <span className="text-muted-foreground">{t("Delivery (all dates)", "Livraison (toutes dates)")}</span>
                  <span className="font-medium">CHF {multiDateDeliveryFeeTotal.toFixed(2)}</span>
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
                  {t("I have read and accept the", "J'ai lu et j'accepte les")}{" "}
                  <Link
                    to="/privacy-policy"
                    className="text-primary underline hover:text-primary/80"
                  >
                    {t("Terms & Conditions and Privacy Policy", "Conditions Générales de Vente et la Politique de confidentialité")}
                  </Link>
                  {"."}
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
              disabled={!acceptPrivacyPolicy || isSubmitting || items.length === 0 || showEmbeddedCheckout || !deliveryReady}
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

          {/* Persistent banner after a failed / declined PostFinance payment */}
          {showPaymentFailed && !showEmbeddedCheckout && (
            <div className="mt-6 rounded-lg border border-destructive/40 bg-destructive/10 p-4">
              <p className="text-sm font-medium text-destructive mb-1">
                {t("Your payment could not be finalised.", "Votre paiement n'a pas pu être finalisé.")}
              </p>
              <p className="text-sm text-muted-foreground">
                {t(
                  "Your cart has been saved. You can review your order and try again below.",
                  "Votre panier a été conservé. Vous pouvez vérifier votre commande et réessayer ci-dessous."
                )}
              </p>
            </div>
          )}

          {/* PostFinance Checkout */}
          {showEmbeddedCheckout && checkoutPayload && (
            <div className="mt-8 pt-6 border-t border-border">
              <h3 className="text-sm font-sans font-medium uppercase tracking-widest text-foreground mb-2">
                {t("Complete Your Payment", "Finalisez votre paiement")}
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                {t("Please complete your payment below to confirm your order. All transactions are secured by PostFinance.", "Veuillez finaliser votre paiement ci-dessous pour confirmer votre commande. Toutes les transactions sont sécurisées par PostFinance.")}
              </p>
              <PostFinanceCheckout
                payload={checkoutPayload}
                onRequestNewOrder={() => {
                  clearCheckoutInFlight();
                  setShowEmbeddedCheckout(false);
                  setCheckoutPayload(null);
                  setShowPaymentFailed(true);
                  toast({
                    title: t("Let's try again", "Réessayons"),
                    description: t(
                      "Please review your order and click “Proceed to Payment” again.",
                      "Vérifiez votre commande puis cliquez à nouveau sur « Procéder au paiement »."
                    ),
                  });
                }}
              />
            </div>
          )}
        </div>
      </main>
    </Layout>
  );
};

export default Checkout;
