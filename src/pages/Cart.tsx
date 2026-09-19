import { useState, useRef, useEffect } from "react";
// @ts-ignore
import "@fontsource/dancing-script";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import ExtraImageLightbox from "@/components/ExtraImageLightbox";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { useCart, CandleSelection, CartItem } from "@/context/CartContext";
import { useAuth } from "@/context/AuthContext";
import { getStoredOrderId, clearStoredOrderId } from "@/lib/checkoutOrderId";
import { isWelcomeDiscountSelectedForAttempt, pickWelcomeDiscountItem, computeWelcomeDiscountAmount } from "@/lib/welcomeDiscount";
import { computePartnerEligibleBase, computePartnerDiscountAmount } from "@/lib/partnerDiscount";
import { sumChf, roundChf, formatChf } from "@/lib/money";
import { useToast } from "@/hooks/use-toast";
import { trackEventWhenReady, trackRemoveFromCart, cartItemsToGA4Items, cartItemsValue } from "@/lib/analytics";
import { ShoppingBag, Trash2, ArrowLeft, Pencil, Check, Plus, Minus, Upload, X, Info, CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import Layout from "@/components/Layout";
import { useLang } from "@/context/LanguageContext";
import { formatSessionDate } from "@/data/workshopSessions";
import { expressSurchargeBreakdown, expressSummaryLabel, isOrderDateDisabled, expressCalendarNotice } from "@/lib/orderDates";
import { ExpressDateNotice, expressCalendarProps } from "@/components/ExpressDateNotice";
import { sizeInfo, sizeInfoSummary } from "@/data/sizeInfo";
import { FlavorDesc } from "@/data/flavorDesc";
import { supabase } from "@/integrations/supabase/client";
import { NUMBER_CANDLE_ID, NUMBER_CANDLE_PRICE, NUMBER_CANDLE_DIGITS, priceCandleSelection, composeCandleName, upsertCandleSelection, removeCandleSelection } from "@/lib/candleCartHelpers";
import { ColorFamilyCandleCard, FAMILY_CANDLE_COLORS } from "@/components/ColorFamilyCandleCard";
import { splitComment, flavorLabel, shapeLabel, cartItemTitle } from "@/lib/orderLabels";
import {
  sizes,
  shapes,
  allFlavors,
  flavorCategories,
  styles,
  extras,
  candles as customisationCandles,
  baseColors,
  textColors,
  ribbonColors,
  butterflyColors,
  glitterColors,
  glitterCherriesColors,
  calculateCartItemTotal,
  getExcludedExtras,
  extraGroups,
  extraDescriptions,
  getAvailableSizesForStyle,
  getFlavorCategoryExtra,
} from "@/data/customization";
import { INSPIRATIONS } from "@/data/inspirations";

import designRibbons from "@/assets/design-ribbons-new.jpg";
import designButterflyGarden from "@/assets/design-butterfly-garden-new.jpg";

// DIY Kit is a single fixed size ("kit-bento"), never part of the standard
// bento/retro/medium/large/rectangle tables — these mirror KitBentoCake.tsx's
// real values (BASE_PRICE, shapes, pipingBagOptions) for both display and
// real-total recompute here in the cart.
const DIY_KIT_BASE_PRICE = 40;
const DIY_KIT_SHAPE_EXTRA: Record<string, number> = { round: 0, heart: 3 };
const DIY_KIT_PIPING_PRICE: Record<string, number> = { "piping-2-bags": 0, "piping-3-bags": 2 };

// Candles reordered: packs first, then individuals
const cartCandles = [
  ...customisationCandles.filter(c => c.hasPack),
  ...customisationCandles.filter(c => !c.hasPack),
];

const formatDateFromIso = (dateValue: string) => {
  const [year, month, day] = dateValue.split("-");
  return year && month && day ? `${day}.${month}.${year}` : dateValue;
};

const Cart = () => {
  const { items, removeItem, updateItem, clearCart, itemCount, cartOrderDate, partnerReferral } = useCart();
  const { t, lang } = useLang();
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [editingItemId, setEditingItemId] = useState<string | null>(null);

  // "Modify date" — scoped to exactly ONE cart line (its item.id), never the
  // whole cart. Was previously wired to handleClearAll (a copy-paste bug:
  // both this and "Clear cart" called the same handler), which wiped every
  // item instead of touching a single date. Popover is keyed by item.id so
  // opening one item's calendar can never affect another item's date, even
  // when several items in the cart each have their own distinct date.
  const [dateEditItemId, setDateEditItemId] = useState<string | null>(null);
  const [fullyBookedDates, setFullyBookedDates] = useState<Date[]>([]);

  useEffect(() => {
    const fetchBookedDates = async () => {
      const { data, error } = await supabase.rpc("get_fully_booked_dates");
      if (!error && data) {
        setFullyBookedDates(data.map((d: { booked_date: string }) => new Date(d.booked_date)));
      }
    };
    fetchBookedDates();
  }, []);

  // Only ever writes item.orderDate on the single targeted line — every
  // other field (product, size, shape, flavor, style, colors, text, extras,
  // candles, images, comment, quantity, total, …) is left completely
  // untouched, and no other cart item is read or written. Not selecting a
  // date (closing the popover, clicking away, Escape) never calls this, so
  // cancelling leaves the cart exactly as it was. item.total is a product
  // price and is deliberately NOT recomputed here — only the express
  // surcharge depends on the date, and that's derived from `items` fresh on
  // every render (see expressGroups/expressBreakdown below), so it updates
  // automatically for the new date with no extra code.
  const handleDateChange = (itemId: string, date: Date | undefined) => {
    if (!date) return;
    updateItem(itemId, { orderDate: format(date, "yyyy-MM-dd") });
    setDateEditItemId(null);
  };

  // 2026-09-14: combined with sumChf (integer cents), not plain +/- — see
  // money.ts. Chaining plain floats here is what produced e.g.
  // "CHF 48.699999999999996" instead of "CHF 48.70". No price/discount rule
  // changes — display/estimate only, exactly as before.
  const totalPrice = sumChf(...items.map((item) => item.total));

  // Welcome discount (-10%) preview — NEVER shown just because the account
  // is ELIGIBLE (that would apply itself the instant an eligible customer
  // opens the cart, with no action from them — the 2026-09-14 bug). Cart.tsx
  // has no checkbox of its own, so the only thing that may show -10% here is
  // an actual SELECTION that already round-tripped through the server: a
  // live reservation (profiles.welcome_discount_reserved_order_id, set only
  // by claim_welcome_discount inside create-postfinance-payment — i.e. only
  // once the customer both checked "Use my welcome offer" AND pressed
  // "Proceed to Payment") for THIS SAME browser tab's own current/last
  // attempt (getStoredOrderId — checkoutOrderId.ts's sessionStorage slot).
  // That's exactly what keeps the line visible if the customer opens
  // PostFinance and comes back, refreshes, or hits Back — their own
  // selection round-tripped through the server and is remembered for that
  // attempt — while a customer who never checked the box, merely being
  // eligible, sees the plain price. Preview only: nothing here applies,
  // reserves, or consumes the discount — only create-postfinance-payment
  // (payment) and the decide_order_physical SQL trigger (marks it used,
  // only after a genuinely valid confirmed order) ever change its real
  // state. See isWelcomeDiscountSelectedForAttempt's own comment for why
  // eligibility and selection must never be the same check.
  // Partner referral (2026-09-16) — display-only preview, exactly like the
  // welcome discount below. Never applied, reserved, or consumed here; the
  // server independently revalidates the token and recomputes this amount.
  // Mutually exclusive with the welcome discount (never -20%): an active
  // partner referral takes priority and the welcome discount preview is
  // suppressed below, matching what create-postfinance-payment actually
  // does (it never even claims the welcome voucher when a partner is
  // active), so this preview is never misleading.
  const partnerEligibleBase = partnerReferral ? computePartnerEligibleBase(items) : 0;
  const partnerDiscountAmount = (partnerReferral && partnerEligibleBase > 0)
    ? roundChf(computePartnerDiscountAmount(partnerEligibleBase, partnerReferral.discountRate))
    : 0;

  const welcomeDiscountSelected = !partnerReferral && isWelcomeDiscountSelectedForAttempt(profile, getStoredOrderId());
  const { item: welcomeDiscountItem, base: welcomeDiscountBase } = pickWelcomeDiscountItem(items);
  const welcomeDiscountAmount = (welcomeDiscountSelected && welcomeDiscountItem)
    ? roundChf(computeWelcomeDiscountAmount(welcomeDiscountBase))
    : 0;

  // Express surcharge, computed per DATE (multi-date fulfillment: a cart can
  // now span several pickup/delivery dates, each with its own rate) — never
  // one date's rate applied to the whole cart's physical total. Groups the
  // express-eligible items (food products only: workshops and candles are
  // excluded, same base as always) by their OWN item.orderDate, prices each
  // date's own subtotal at that date's own tier, then expressSurchargeBreakdown
  // sums those per-date amounts back together by rate — so a cart with a
  // J+2 (20%) date and a J+4 (15%) date shows both "Express surcharge (20%)"
  // and "Express surcharge (15%)" as two separate, individually-accurate
  // lines, each charging only its own date's products. Single-date carts
  // (the common case) reduce to exactly the one line/rate as before.
  const expressGroups = (() => {
    const byDate = new Map<string, number[]>();
    for (const item of items) {
      if (item.product === "workshop" || item.product === "candles" || !item.orderDate) continue;
      const totals = byDate.get(item.orderDate) ?? [];
      totals.push(item.total);
      byDate.set(item.orderDate, totals);
    }
    return Array.from(byDate.entries()).map(([date, totals]) => ({
      date: new Date(date + "T00:00:00"),
      eligibleTotal: sumChf(...totals),
    }));
  })();
  const expressBreakdown = expressSurchargeBreakdown(expressGroups);

  // GA4 view_cart — once when the cart page opens with something in it.
  const viewCartSentRef = useRef(false);
  useEffect(() => {
    if (viewCartSentRef.current || items.length === 0) return;
    viewCartSentRef.current = true;
    trackEventWhenReady("view_cart", {
      currency: "CHF",
      value: cartItemsValue(items),
      items: cartItemsToGA4Items(items),
    });
  }, [items]);

  // "Clear all" — emit remove_from_cart per line, then clear (clearCart
  // itself is intentionally event-free; see CartContext).
  //
  // 2026-09-14: if a checkout attempt is outstanding (getStoredOrderId) for
  // a LOGGED-IN customer, clearing the cart used to only ever touch
  // frontend state — reward_reservations and pending_payments were left
  // exactly as they were, silently holding the customer's points out of
  // their spendable balance with no way left to ever release them. Guest
  // checkouts are skipped entirely here: a guest can never hold a reward or
  // welcome-discount reservation (both require a profiles row), so there is
  // nothing abandon-checkout could ever release for one — clearing stays
  // exactly as before for them.
  //
  // clearingCart both prevents a real double-click from firing two requests
  // and gives abandon-checkout's own idempotent design (see that function)
  // a first line of defense — a genuine race there still can't double-
  // release, this just avoids it in the common case.
  const [clearingCart, setClearingCart] = useState(false);
  const doClearCart = () => {
    items.forEach((it) => trackRemoveFromCart(it));
    clearCart();
  };
  const handleClearAll = async () => {
    if (clearingCart) return;
    const storedOrderId = getStoredOrderId();
    if (!user || !storedOrderId) {
      doClearCart();
      return;
    }

    setClearingCart(true);
    try {
      const { data, error } = await supabase.functions.invoke("abandon-checkout", {
        body: { orderId: storedOrderId },
      });
      if (error) {
        console.error("abandon-checkout error:", error);
        toast({
          title: t("Could not clear the cart", "Impossible de vider le panier"),
          description: t("Please try again in a moment.", "Merci de réessayer dans un instant."),
          variant: "destructive",
        });
        return; // never clear silently when the backend couldn't confirm anything
      }

      if (data?.status === "abandoned") {
        doClearCart();
        clearStoredOrderId();
        return;
      }

      if (data?.status === "already_confirmed") {
        toast({
          title: t("This order was already confirmed", "Cette commande a déjà été confirmée"),
          description: t(
            "Check My Orders — this checkout attempt already went through.",
            "Vérifiez Mes commandes — cette tentative de paiement a déjà abouti.",
          ),
        });
        return;
      }

      // "payment_in_progress" (or anything else non-"abandoned") — a real
      // payment attempt is still active; never clear silently.
      toast({
        title: t("Payment still in progress", "Paiement toujours en cours"),
        description: data?.message || t(
          "We can't clear your cart yet — a payment attempt for it is still active.",
          "Impossible de vider le panier pour l'instant — une tentative de paiement est encore active.",
        ),
      });
    } catch (e) {
      console.error("abandon-checkout threw:", e);
      toast({
        title: t("Could not clear the cart", "Impossible de vider le panier"),
        description: t("Please try again in a moment.", "Merci de réessayer dans un instant."),
        variant: "destructive",
      });
    } finally {
      setClearingCart(false);
    }
  };

  const recalcAndUpdate = (itemId: string, updates: Record<string, any>) => {
    const item = items.find(i => i.id === itemId);
    if (!item) return;
    const merged = { ...item, ...updates };
    let newTotal: number;
    if (merged.product === "diy_kit") {
      const shapeExtra = DIY_KIT_SHAPE_EXTRA[merged.shape] ?? 0;
      const flavorExtra = getFlavorCategoryExtra(merged.flavor, merged.size);
      const pipingPrice = (merged.extras || []).reduce(
        (acc: number, extraId: string) => acc + (DIY_KIT_PIPING_PRICE[extraId] ?? 0), 0
      );
      const candlesPrice = (merged.candles || []).reduce(
        (acc: number, entry: CandleSelection) =>
          acc + priceCandleSelection(entry, cartCandles.find(c => c.id === entry.id), entry.id === NUMBER_CANDLE_ID),
        0
      );
      newTotal = DIY_KIT_BASE_PRICE + shapeExtra + flavorExtra + pipingPrice + candlesPrice;
    } else {
      // Was passing [] for extras and adding a separately (buggy) computed
      // extrasPrice on top — calculateCartItemTotal already prices extras
      // correctly via the canonical extras table (rectangle included).
      newTotal = calculateCartItemTotal(
        merged.size, merged.shape, merged.flavor, merged.style,
        merged.extras || [], merged.candles || []
      );
    }
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
        updates.extrasNames = filteredExtras.map(id => extras.find(e => e.id === id)?.name || "");
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
      newExtrasNames = newExtras.map(id => extras.find(e => e.id === id)?.name || "");
      const updates: Record<string, any> = { extras: newExtras, extrasNames: newExtrasNames };
      // Clear related color selections when deselecting
      if (extraId === "glitter") updates.glitterColor = "";
      if (extraId === "ribbons") { updates.ribbonColor = ""; updates.ribbonColorName = ""; }
      if (extraId === "butterfly") { updates.butterflyColor = ""; updates.butterflyColorName = ""; }
      if (extraId === "glitter-cherries") updates.glitterCherriesColor = "";
      recalcAndUpdate(itemId, updates);
    } else {
      newExtras = [...currentExtras, extraId];
      newExtrasNames = newExtras.map(id => extras.find(e => e.id === id)?.name || "");
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
    // The edit textarea only ever shows/edits the customer-typed portion
    // (see splitComment) — re-attach the "[Preferred design: Option N]" tag
    // here, if this item has one, so editing the comment never silently
    // drops which design photo was picked (still needed by the admin
    // invoice/email — see orderLabels.ts).
    const { designPhoto } = splitComment(items.find((i) => i.id === itemId)?.comment);
    const nextComment = designPhoto != null
      ? `[Preferred design: Option ${designPhoto}]${comment ? " " + comment : ""}`
      : comment;
    updateItem(itemId, { comment: nextComment });
  };

  const handleImageFilesChange = (itemId: string, imageFiles: File[]) => {
    updateItem(itemId, { imageFiles });
  };

  const handleCandleQuantityChange = (itemId: string, candleId: string, delta: number) => {
    const item = items.find(i => i.id === itemId);
    if (!item) return;
    const currentCandles: CandleSelection[] = item.candles || [];
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

  const handleNumberCandleDigitChange = (itemId: string, digit: string) => {
    const item = items.find(i => i.id === itemId);
    if (!item) return;
    const newCandles = (item.candles || []).map((c: CandleSelection) =>
      c.id === NUMBER_CANDLE_ID ? { ...c, digit } : c
    );
    recalcAndUpdate(itemId, { candles: newCandles });
  };

  // Removes ONE digit from the Number Candle entry — several digits live in
  // ONE CandleSelection (digits: ["1","8"]), never as separate entries with
  // the same id, so this can't be handleCandleQuantityChange/
  // removeCandleSelection (both key purely on `id === "number-candle"`,
  // which would drop every digit at once). Keeps every other digit intact
  // and shrinks quantity to match; removes the whole entry only once the
  // last digit is gone.
  const handleRemoveNumberCandleDigit = (itemId: string, digitIndex: number) => {
    const item = items.find(i => i.id === itemId);
    if (!item) return;
    const entry = (item.candles || []).find((c: CandleSelection) => c.id === NUMBER_CANDLE_ID);
    if (!entry) return;
    const digits: string[] = entry.digits || (entry.digit ? [entry.digit] : []);
    const newDigits = digits.filter((_, i) => i !== digitIndex);
    const newCandles = newDigits.length === 0
      ? (item.candles || []).filter((c: CandleSelection) => c.id !== NUMBER_CANDLE_ID)
      : (item.candles || []).map((c: CandleSelection) =>
          c.id === NUMBER_CANDLE_ID ? { ...c, digits: newDigits, digit: undefined, quantity: newDigits.length } : c
        );
    recalcAndUpdate(itemId, { candles: newCandles });
  };

  const getCandleUnitQty = (item: typeof items[0], candleId: string) => {
    return (item.candles || []).find(c => c.id === candleId && !c.hasPack)?.quantity || 0;
  };

  const handleCandleProductQty = (itemId: string, delta: number) => {
    const item = items.find(i => i.id === itemId);
    if (!item || !item.isCandleProduct || !item.candleProductId || item.candleProductQtyLocked) return;
    const newQty = Math.max(1, (item.candleProductQty || 1) + delta);

    let price: number;
    if (item.candleProductUnitPrice !== undefined) {
      // Flat-rate line (Number Candle, or a colour bought loose by the
      // piece) — the id here is composite ("shiny-spiral-blue",
      // "number-candle-7") and was never going to match anything in
      // cartCandles. The per-piece price was fixed at add-to-cart time and
      // is never pack-eligible, so no catalogue lookup is needed at all.
      price = item.candleProductUnitPrice * newQty;
    } else {
      // Regular catalogue candle (plain id, e.g. "puppy") or a full pack
      // purchase (e.g. "shiny-spiral") — unchanged pack-aware lookup.
      const candle = cartCandles.find(c => c.id === item.candleProductId);
      if (candle) {
        if (candle.hasPack && newQty >= (candle.packSize || 6)) {
          const packs = Math.floor(newQty / (candle.packSize || 6));
          const remaining = newQty % (candle.packSize || 6);
          price = packs * (candle.packPrice || 0) + remaining * candle.unitPrice;
        } else {
          price = candle.unitPrice * newQty;
        }
      } else {
        // Defensive fallback only — should not be reachable now that every
        // flat-rate path sets candleProductUnitPrice above. Never silently
        // zero the price: derive the per-unit rate from the item's own
        // current total instead of dropping it.
        const previousUnitPrice = item.candleProductQty ? item.total / item.candleProductQty : item.total;
        price = previousUnitPrice * newQty;
      }
    }

    updateItem(itemId, {
      candleProductQty: newQty,
      sizeName: `${newQty}× ${item.candleProductName}`,
      extrasNames: [`${newQty}× ${item.candleProductName}`],
      total: price,
      // Keep the raw structured selection (sent to create-postfinance-payment
      // for server-side recompute) in sync with candleProductQty — otherwise
      // a +/- edit here would leave item.candles[0].quantity stale.
      candles: item.candles?.length ? [{ ...item.candles[0], quantity: newQty }] : item.candles,
    });
  };

  const getCandleItemPrice = (candleId: string, itemCandles: CandleSelection[]) => {
    const entry = (itemCandles || []).find(c => c.id === candleId);
    if (!entry) return 0;
    return priceCandleSelection(entry, cartCandles.find(c => c.id === candleId), candleId === NUMBER_CANDLE_ID);
  };

  return (
    <Layout>
      <main className="container mx-auto px-4 py-12">
        {/* Mobile-first header */}
        <div className="mb-6">
          <Link to="/" className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground mb-4">
            <ArrowLeft className="h-3 w-3 mr-1" />
            {t("Continue shopping", "Continuer mes achats")}
          </Link>
          <h1 className="font-sans uppercase tracking-[0.18em] text-2xl md:text-3xl text-foreground">{t("Your Cart", "Votre panier")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{itemCount} {itemCount === 1 ? t("item", "article") : t("items", "articles")}</p>
        </div>

        {items.length === 0 ? (
          <div className="text-center py-20">
            <ShoppingBag className="h-16 w-16 text-muted-foreground mx-auto mb-6" strokeWidth={1.25} />
            <h2 className="font-sans uppercase tracking-[0.105em] text-2xl md:text-3xl text-foreground mb-4">{t("Your cart is empty", "Votre panier est vide")}</h2>
            <p className="text-muted-foreground mb-8">{t("Start customizing your perfect cake!", "Composez le gâteau parfait !")}</p>
            <Button size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground px-10 py-2.5 text-base font-medium tracking-wide rounded-none" asChild><Link to="/catalog">{t("Customise Your Cake", "Personnalisez votre gâteau")}</Link></Button>
          </div>
        ) : (
          <div className="grid lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-4">
              <div className="flex justify-end mb-2">
                <button onClick={handleClearAll} disabled={clearingCart} className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 disabled:opacity-50 disabled:cursor-not-allowed">{t("Clear cart", "Vider le panier")}</button>
              </div>

              {/* This banner is a cart-wide summary only — it never decides
                  what's charged or how fulfillment is split (that's still
                  cartOrderDate / per-item orderDate, untouched below and
                  everywhere else in this file). With 2+ different pickup/
                  delivery dates among the cart's items, stating any single
                  one here would be misleading, so it switches to a plain
                  "multiple dates" notice instead — each item's own card
                  below always shows its own exact date, with its own
                  "Modify date" control right next to it (a cart-wide button
                  here could never identify which single line to change once
                  the cart holds more than one date). */}
              {(() => {
                const distinctDates = Array.from(new Set(items.filter((i) => i.orderDate).map((i) => i.orderDate)));
                if (distinctDates.length === 0) return null;
                return (
                  <div className="mb-4 bg-cream/60 border border-border/30 px-4 py-2.5">
                    <span className="text-xs text-foreground/70">
                      {distinctDates.length > 1
                        ? t("Multiple pickup dates", "Plusieurs dates de retrait")
                        : `${t("Pickup", "Retrait le")} ${formatDateFromIso(distinctDates[0]!)}`}
                    </span>
                  </div>
                );
              })()}

              {items.map((item) => {
                const isEditing = editingItemId === item.id;
                if (item.product === "workshop") {
                  const workshopName = item.styleName
                    || (item.workshopType === "paint" ? t("Paint Workshop", "Atelier Peinture") : t("Signature Workshop", "Atelier Signature"));
                  return (
                    <Card key={item.id} className="overflow-hidden rounded-none">
                      <CardContent className="p-6">
                        <div className="flex items-start justify-between gap-4 mb-3">
                          <div className="min-w-0">
                            <h3 className="font-sans uppercase tracking-[0.105em] text-sm font-semibold text-foreground">{workshopName}</h3>
                            <p className="text-xs text-muted-foreground mt-0.5">{t("Workshop", "Atelier")}</p>
                          </div>
                          <span className="font-semibold text-primary whitespace-nowrap text-base">CHF {formatChf(item.total)}</span>
                        </div>
                        <div className="text-sm text-foreground/80 space-y-1">
                          <div className="flex justify-between gap-4">
                            <span className="text-muted-foreground">{t("Date", "Date")}</span>
                            <span className="text-right">
                              {item.workshopDate ? formatSessionDate(item.workshopDate, lang === "fr" ? "fr" : "en") : "—"}
                            </span>
                          </div>
                          <div className="flex justify-between gap-4">
                            <span className="text-muted-foreground">{t("Time", "Horaire")}</span>
                            <span className="text-right">{item.workshopTime || "—"}</span>
                          </div>
                          <div className="flex justify-between gap-4">
                            <span className="text-muted-foreground">{t("Participants", "Participants")}</span>
                            <span className="text-right">
                              {item.workshopParticipants} × CHF {formatChf(item.workshopUnitPrice)}
                            </span>
                          </div>
                          {item.workshopSpongeChoices && item.workshopSpongeChoices.length > 0 && (
                            <div className="mt-1 space-y-0.5">
                              {item.workshopSpongeChoices.map((ch, i) => (
                                <p key={i} className="text-[10px] text-muted-foreground">
                                  P{i + 1}: {ch === "vanilla" ? "Génoise vanille" : "Génoise chocolat"}
                                </p>
                              ))}
                            </div>
                          )}
                          {item.comment && (
                            <div className="flex justify-between gap-4">
                              <span className="text-muted-foreground shrink-0">{t("Notes", "Notes")}</span>
                              <span className="text-right break-words">{item.comment}</span>
                            </div>
                          )}
                        </div>
                        <div className="border-t border-border/30 pt-3 mt-3 flex justify-end">
                          <Button variant="ghost" size="sm" onClick={() => removeItem(item.id)} className="text-muted-foreground hover:text-destructive h-auto p-0 text-xs">
                            <Trash2 className="h-3 w-3 mr-1" />
                            {t("Remove", "Supprimer")}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                }
                if (item.isCandleProduct) {
                  return (
                    <Card key={item.id} className="overflow-hidden rounded-none">
                      <CardContent className="p-6">
                        <div className="flex items-center gap-4 mb-3">
                          {item.candleProductImage ? (
                            <img src={item.candleProductImage} alt={item.candleProductName} className="h-16 w-16 object-contain flex-shrink-0" />
                          ) : (
                            <div className="h-16 w-16 flex items-center justify-center flex-shrink-0 bg-secondary/20 text-2xl" aria-hidden="true">
                              
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <h3 className="font-sans uppercase tracking-[0.105em] text-sm font-semibold text-foreground">{item.candleProductName}</h3>
                            <p className="text-xs text-muted-foreground mt-0.5">{t("Candle", "Bougie")}</p>
                          </div>
                          <span className="font-semibold text-primary whitespace-nowrap text-base">CHF {formatChf(item.total)}</span>
                        </div>
                        {!item.candleProductQtyLocked && (
                          <div className="flex items-center gap-2 mb-3">
                            <button
                              onClick={() => handleCandleProductQty(item.id, -1)}
                              disabled={(item.candleProductQty || 1) <= 1}
                              className={cn(
                                "w-7 h-7 rounded-none flex items-center justify-center text-sm font-bold transition-all",
                                (item.candleProductQty || 1) <= 1
                                  ? "bg-muted text-muted-foreground cursor-not-allowed"
                                  : "bg-primary text-primary-foreground hover:bg-primary/90"
                              )}
                            >−</button>
                            <span className="w-6 text-center font-medium text-foreground text-sm">{item.candleProductQty || 1}</span>
                            <button
                              onClick={() => handleCandleProductQty(item.id, 1)}
                              className="w-7 h-7 rounded-none bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold hover:bg-primary/90 transition-all"
                            >+</button>
                          </div>
                        )}
                        {item.candleProductQtyLocked && (
                          <p className="text-sm font-medium text-foreground mb-3">{t("Quantity", "Quantité")}: {item.candleProductQty || 1}</p>
                        )}
                        <div className="border-t border-border/30 pt-3 flex justify-end">
                          <Button variant="ghost" size="sm" onClick={() => removeItem(item.id)} className="text-muted-foreground hover:text-destructive h-auto p-0 text-xs">
                            <Trash2 className="h-3 w-3 mr-1" />
                            {t("Remove", "Supprimer")}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                }
                return (
                  <Card key={item.id} className="overflow-hidden rounded-none">
                    <CardContent className="p-6">
                      <h3 className="font-sans uppercase tracking-[0.105em] text-sm font-semibold text-foreground mb-2">{cartItemTitle(item, lang, t)}</h3>

                      {/* This item's OWN pickup/delivery date — never the
                          cart-wide banner above, which can be misleading
                          the moment two cakes in the same cart have
                          different dates (see the "Multiple pickup dates"
                          fallback on that banner). Straight from
                          item.orderDate, already stored per CartItem —
                          no derived/global date here. */}
                      {item.orderDate && (
                        <div className="flex items-center gap-2 mb-3">
                          <p className="text-sm font-bold text-foreground">
                            {t("PICKUP", "RETRAIT")} — {formatDateFromIso(item.orderDate)}
                          </p>
                          <Popover
                            open={dateEditItemId === item.id}
                            onOpenChange={(open) => setDateEditItemId(open ? item.id : null)}
                          >
                            <PopoverTrigger asChild>
                              <button className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 shrink-0">
                                {t("Modify date", "Modifier la date")}
                              </button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <Calendar
                                {...expressCalendarProps}
                                mode="single"
                                // Pre-selects this item's OWN current date —
                                // never another item's, never today.
                                selected={new Date(`${item.orderDate}T00:00:00`)}
                                onSelect={(date) => handleDateChange(item.id, date)}
                                disabled={(date) => {
                                  if (isOrderDateDisabled(date)) return true;
                                  return fullyBookedDates.some(
                                    (bookedDate) => bookedDate.toDateString() === date.toDateString()
                                  );
                                }}
                                initialFocus
                                className="p-3 pointer-events-auto"
                              />
                              {expressCalendarNotice(new Date(`${item.orderDate}T00:00:00`), lang) && (
                                <p className="text-[10px] italic text-muted-foreground px-3 pb-3">
                                  ⓘ {expressCalendarNotice(new Date(`${item.orderDate}T00:00:00`), lang)}
                                </p>
                              )}
                            </PopoverContent>
                          </Popover>
                        </div>
                      )}

                      {/* The exact design/product photo the customer picked,
                          if the site captured one (designImageUrl, set once
                          at add-to-cart time — never rebuilt from
                          item.design/item.style here). Every physical
                          product now sets this the same way Bento Cake
                          always has: a real catalogue design/hero photo for
                          Catalog/Dot Cakes/DIY Kit, or — when there's no
                          hosted URL yet, i.e. Printing, whose file is only
                          uploaded to storage at checkout — a local preview
                          of the exact photo the customer just uploaded
                          (item.imageFiles[0]), so the cart never shows a
                          generic placeholder when the real thing is right
                          there. Nothing shown when neither is available.
                          Fixed thumbnail box so a portrait or landscape
                          source photo never stretches. Delegated to
                          ItemDesignImage so the local blob: URL (Printing
                          only) is created once per file and properly
                          revoked, never leaked on every re-render. */}
                      <ItemDesignImage item={item} alt={t("Chosen design", "Design choisi")} />

                      {isEditing ? (
                        <CartItemEditor
                          item={item}
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
                          onImageFilesChange={(files) => handleImageFilesChange(item.id, files)}
                          onCandleQtyChange={(candleId, delta) => handleCandleQuantityChange(item.id, candleId, delta)}
                          getCandleUnitQty={(candleId) => getCandleUnitQty(item, candleId)}
                          getCandleItemPrice={(candleId) => getCandleItemPrice(candleId, item.candles || [])}
                          onNumberCandleDigitChange={(digit) => handleNumberCandleDigitChange(item.id, digit)}
                          onRemoveNumberCandleDigit={(digitIndex) => handleRemoveNumberCandleDigit(item.id, digitIndex)}
                          onCandleSelectionCommit={(entry) => recalcAndUpdate(item.id, { candles: upsertCandleSelection(item.candles || [], entry) })}
                          onCandleSelectionRemove={(candleId) => recalcAndUpdate(item.id, { candles: removeCandleSelection(item.candles || [], candleId) })}
                        />
                      ) : (
                        <CartItemSummary item={item} />
                      )}
                      {!isEditing && (
                        <div className="border-t border-border/30 px-6 py-3 flex items-center justify-between">
                          <button
                            onClick={() => setEditingItemId(item.id)}
                            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                          >
                            <Pencil className="h-3 w-3" />
                            {t("Edit", "Modifier")}
                          </button>
                          <button
                            onClick={() => removeItem(item.id)}
                            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-3 w-3" />
                            {t("Remove", "Supprimer")}
                          </button>
                        </div>
                      )}
                      {isEditing && (
                        <div className="border-t border-border/30 px-6 py-3 flex justify-end">
                          <button
                            onClick={() => setEditingItemId(null)}
                            className="inline-flex items-center gap-1 text-xs text-primary font-medium"
                          >
                            <Check className="h-3 w-3" />
                            {t("Done", "Terminé")}
                          </button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Order Summary */}
            <div className="lg:col-span-1">
              <Card className="sticky top-8 rounded-none">
                <CardContent className="p-6 space-y-4">
                  <h3 className="font-sans uppercase tracking-[0.105em] text-sm font-semibold text-foreground">{t("Order Summary", "Récapitulatif")}</h3>
                  <div className="space-y-2 border-b border-border pb-4">
                    {items.map((item) => (
                      <div key={item.id} className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{
                          item.product === "workshop"
                            ? `${item.styleName || t("Workshop", "Atelier")}${item.workshopParticipants ? ` ×${item.workshopParticipants}` : ""}`
                            : item.isCandleProduct
                              ? item.candleProductName
                              : cartItemTitle(item, lang, t)
                        }</span>
                        <span className="text-foreground">CHF {formatChf(item.total)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{t("Subtotal", "Sous-total")}</span>
                    <span className="text-foreground">CHF {formatChf(totalPrice)}</span>
                  </div>
                  {partnerDiscountAmount > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">
                        {t(
                          `${partnerReferral!.partnerName} partner discount`,
                          `Réduction partenaire ${partnerReferral!.partnerName}`,
                        )}
                      </span>
                      <span className="text-primary">- CHF {formatChf(partnerDiscountAmount)}</span>
                    </div>
                  )}
                  {partnerDiscountAmount > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {t(
                        `Partner benefit: -${Math.round(partnerReferral!.discountRate * 100)}% on the cake base price`,
                        `Avantage partenaire : -${Math.round(partnerReferral!.discountRate * 100)} % sur le prix de base du gâteau`,
                      )}
                      <br />
                      {t(
                        "Excludes extras, options, surcharges and delivery.",
                        "Hors extras, options, suppléments et livraison.",
                      )}
                    </p>
                  )}
                  {welcomeDiscountAmount > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{t("Welcome discount -10%", "Réduction bienvenue -10%")}</span>
                      <span className="text-primary">- CHF {formatChf(welcomeDiscountAmount)}</span>
                    </div>
                  )}
                  {expressBreakdown.byRate.map(({ rate, amount }) => (
                    <div key={rate} className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{expressSummaryLabel(lang === "fr" ? "fr" : "en", rate)}</span>
                      <span className="text-foreground">CHF {formatChf(amount)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between text-lg font-bold">
                    <span className="text-foreground">{t("Total", "Total")}</span>
                    <span className="text-primary">CHF {formatChf(sumChf(totalPrice, expressBreakdown.total, -welcomeDiscountAmount, -partnerDiscountAmount))}</span>
                  </div>
                  <ExpressDateNotice date={cartOrderDate ? new Date(cartOrderDate + "T00:00:00") : null} />
                  {items.some((i) => i.product === "workshop") &&
                   items.some((i) => i.product !== "workshop") && (
                    <p className="text-xs text-muted-foreground border border-border bg-muted/40 p-3 rounded-none">
                      {t(
                        "Workshop confirmed immediately. Cakes and products are confirmed separately.",
                        "Workshop confirmé immédiatement. Gâteaux et produits confirmés séparément.",
                      )}
                    </p>
                  )}
                  <Button className="w-full bg-primary hover:bg-primary/90 text-primary-foreground py-2.5 text-base font-medium tracking-wide rounded-none" size="lg" asChild><Link to="/checkout">{t("Proceed to Checkout", "Passer la commande")}</Link></Button>
                  <Button variant="outline" className="w-full rounded-none" asChild><Link to="/catalog">{t("Add Another Cake", "Ajouter un autre gâteau")}</Link></Button>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </main>
    </Layout>
  );
};

/* ---------- Design/product photo thumbnail ---------- */
// Shows item.designImageUrl when set (every product's normal case — a real
// hosted URL, nothing to create or clean up). Falls back to a LOCAL preview
// of the customer's own uploaded file (Printing, pre-checkout only, before
// its real URL exists) via URL.createObjectURL — done here, in a dedicated
// component with its own effect, rather than inline in JSX, specifically so
// the blob: URL is created exactly once per file and revoked (URL.revokeObjectURL)
// on cleanup — when the file changes, is removed, or this card unmounts —
// instead of leaking a brand new, never-released blob URL on every re-render
// of the cart (every quantity change, every other item's edit, etc.).
const ItemDesignImage = ({ item, alt }: { item: CartItem; alt: string }) => {
  const file = item.imageFiles?.[0];
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (item.designImageUrl || !file) {
      setObjectUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [item.designImageUrl, file]);

  const src = item.designImageUrl || objectUrl;
  if (!src) return null;
  return (
    <img
      src={src}
      alt={alt}
      className="w-20 h-20 object-cover rounded mb-4 flex-shrink-0"
    />
  );
};

/* ---------- Summary (read-only view) ---------- */
const CartItemSummary = ({ item }: { item: any }) => {
  const { t, lang } = useLang();
  const isDiyKit = item.product === "diy_kit";
  // Dot Cakes/DIY Kit/Printing/Candles: "design"/styleName is a fixed
  // internal product name, never a real customer choice — showing it as a
  // "Design:" row would just repeat the product name for no new info.
  const hasNoMeaningfulDesign = isDiyKit || item.product === "dot_cakes" || item.product === "edible_printing";
  const sizeObj = sizes.find(s => s.id === item.size);
  const sizePrice = isDiyKit ? DIY_KIT_BASE_PRICE : (sizeObj?.price || 0);
  const shapeObj = shapes.find(s => s.id === item.shape);
  const shapeExtra = isDiyKit
    ? (DIY_KIT_SHAPE_EXTRA[item.shape] ?? 0)
    : (shapeObj ? shapeObj.extraPrice[item.size as keyof typeof shapeObj.extraPrice] || 0 : 0);
  const flavorExtra = getFlavorCategoryExtra(item.flavor, item.size);
  const isInspiration = item.style?.startsWith("inspiration-");
  const styleObj = styles.find(s => s.id === item.style);
  const inspirationObj = isInspiration ? INSPIRATIONS.find(i => i.id === item.style) : undefined;
  const styleExtra = isInspiration
    ? (inspirationObj?.price[item.size as keyof typeof inspirationObj.price] || 0)
    : (styleObj ? (styleObj.price[item.size as keyof typeof styleObj.price] || 0) : 0);

  const candleEntries = (item.candles || [])
    .filter((c: CandleSelection) => c.quantity > 0)
    .map((c: CandleSelection) => {
      const candle = cartCandles.find(x => x.id === c.id);
      const baseName = c.id === NUMBER_CANDLE_ID ? t("Number Candle", "Bougie chiffre") : (candle?.name || "");
      const name = composeCandleName(c, baseName);
      const price = priceCandleSelection(c, candle, c.id === NUMBER_CANDLE_ID);
      return { name, qty: c.quantity, price };
    })
    .filter((e: any) => e.name);

  const extraEntries = isDiyKit
    ? (item.extras || []).map((extraId: string, i: number) => ({
        name: item.extrasNames?.[i] || extraId,
        price: DIY_KIT_PIPING_PRICE[extraId] ?? 0,
      }))
    : (item.extras || []).map((extraId: string) => {
        const extra = extras.find(e => e.id === extraId);
        if (!extra) return null;
        const price = extra.price[item.size as keyof typeof extra.price] || 0;
        return { name: extra.name, price };
      }).filter(Boolean) as { name: string; price: number }[];

  const candlesTotal = candleEntries.reduce((sum: number, e: any) => sum + e.price, 0);
  const extrasTotal = extraEntries.reduce((sum: number, e: any) => sum + e.price, 0);

  return (
    <div className="space-y-2">
{/* date shown globally above the list */}

      {/* Price Breakdown */}
      <div className="bg-muted/30 rounded-lg p-3 space-y-3 text-sm">
        {/* Dot Cakes/Printing aren't in the static sizes catalogue this row
            prices against (sizePrice resolves to 0 for them — their real
            price lives entirely in item.total, computed elsewhere,
            untouched here) — showing "CHF 0" would be misleading, so this
            purely informational row is skipped for those two only. */}
        {item.product !== "dot_cakes" && item.product !== "edible_printing" && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">{item.sizeName}</span>
            <span className="text-foreground">CHF {formatChf(sizePrice)}</span>
          </div>
        )}
        {/* Shape surcharge shown on its own row, same convention as Flavour/
            Design below (+CHF X when it costs extra, "included" when it
            doesn't) — never appended to the size row above as "CHF 40 + 3",
            which read as a single confusing price rather than two amounts. */}
        {item.shapeName && shapeExtra > 0 && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t("Shape:", "Forme :")} {shapeLabel(item.shape, lang)}</span>
            <span className="text-foreground">+ CHF {formatChf(shapeExtra)}</span>
          </div>
        )}
        {item.shapeName && shapeExtra === 0 && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t("Shape:", "Forme :")} {shapeLabel(item.shape, lang)}</span>
            <span className="text-muted-foreground text-xs">{t("included", "inclus")}</span>
          </div>
        )}
        {item.flavorName && flavorExtra > 0 && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t("Flavour:", "Parfum :")} {flavorLabel(item.flavorName)}</span>
            <span className="text-foreground">+ CHF {formatChf(flavorExtra)}</span>
          </div>
        )}
        {item.flavorName && flavorExtra === 0 && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t("Flavour:", "Parfum :")} {flavorLabel(item.flavorName)}</span>
            <span className="text-muted-foreground text-xs">{t("included", "inclus")}</span>
          </div>
        )}
        {/* An Inspiration cake's styleName is the unhelpful "Inspiration #N"
            — the actual photo is now shown as a thumbnail at the top of
            this card (item.designImageUrl), so this row only needs a
            plain, readable label instead of that raw name. Every other
            design keeps its own plain text label, unchanged. Dot Cakes/
            Printing/DIY Kit don't have a real "design" pick at all — their
            styleName is just their own product name again ("Dot Cakes",
            "Edible Printing"), so this row is skipped for them too, same
            as the equivalent fix in the confirmation e-mails/invoice. */}
        {hasNoMeaningfulDesign ? null : item.style?.startsWith("inspiration-") ? (
          <div className="flex justify-between items-center gap-3">
            <span className="text-muted-foreground">{t("Design:", "Design :")} {t("Inspiration photo", "Photo d'inspiration")}</span>
            {styleExtra > 0 ? (
              <span className="text-foreground">+ CHF {formatChf(styleExtra)}</span>
            ) : (
              <span className="text-muted-foreground text-xs">{t("included", "inclus")}</span>
            )}
          </div>
        ) : (
          <>
            {styleExtra > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("Design:", "Design :")} {item.styleName}</span>
                <span className="text-foreground">+ CHF {formatChf(styleExtra)}</span>
              </div>
            )}
            {styleExtra === 0 && item.styleName && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("Design:", "Design :")} {item.styleName}</span>
                <span className="text-muted-foreground text-xs">{t("included", "inclus")}</span>
              </div>
            )}
          </>
        )}
        {extraEntries.length > 0 && (
          <>
            <div className="border-t border-border my-1" />
            {extraEntries.map((e: any, i: number) => (
              <div key={i} className="flex justify-between">
                <span className="text-muted-foreground">+ {e.name}</span>
                <span className="text-foreground">+ CHF {formatChf(e.price)}</span>
              </div>
            ))}
          </>
        )}
        {candleEntries.length > 0 && (
          <>
            <div className="border-t border-border my-1" />
            {candleEntries.map((e: any, i: number) => (
              <div key={i} className="flex justify-between">
                <span className="text-muted-foreground">{e.name} ×{e.qty}</span>
                <span className="text-foreground">+ CHF {formatChf(e.price)}</span>
              </div>
            ))}
          </>
        )}
      </div>

      {(() => {
        // item.comment may carry the internal "[Preferred design: Option N]"
        // tag Catalog.tsx embeds for a multi-photo design (see orderLabels.ts)
        // — that tag is data for the admin invoice/email, never something the
        // customer typed, so it must never be shown here as their comment.
        // splitComment(...).comment is null/empty for a tag-only value, and
        // the plain customer text otherwise (or unchanged if there's no tag).
        const displayComment = splitComment(item.comment).comment;
        return (item.baseColorName || item.decorationColorName || item.cakeText || displayComment) && (
          <div className="border-t border-border/30 mt-5 pt-5 space-y-3">
            {item.baseColorName && (
              <div className="flex gap-2 text-sm">
                <span className="text-muted-foreground/70 shrink-0 w-28">{t("Base", "Base")}</span>
                <span className="text-foreground">{item.baseColorName}</span>
              </div>
            )}
            {item.decorationColorName && (
              <div className="flex gap-2 text-sm">
                <span className="text-muted-foreground/70 shrink-0 w-28">{t("Decoration", "Décoration")}</span>
                <span className="text-foreground">{item.decorationColorName}</span>
              </div>
            )}
            {item.cakeText && (
              <div className="flex gap-2 text-sm">
                <span className="text-muted-foreground/70 shrink-0 w-28">{t("Text", "Texte")}</span>
                <span className="text-foreground">"{item.cakeText}"</span>
              </div>
            )}
            {displayComment && (
              <div className="flex gap-2 text-sm">
                <span className="text-muted-foreground/70 shrink-0 w-28">{t("Comment", "Commentaire")}</span>
                <span className="text-foreground break-words">{displayComment}</span>
              </div>
            )}
          </div>
        );
      })()}

      <div className="flex justify-between items-center pt-3 mt-3 border-t border-border/30">
        <span className="text-sm text-muted-foreground">{t("Total", "Total")}</span>
        <span className="text-lg font-bold text-primary">CHF {formatChf(item.total)}</span>
      </div>
    </div>
  );
};

/* ---------- Editor ---------- */
interface CartItemEditorProps {
  item: any;
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
  onImageFilesChange: (files: File[]) => void;
  onCandleQtyChange: (candleId: string, delta: number) => void;
  getCandleUnitQty: (candleId: string) => number;
  getCandleItemPrice: (candleId: string) => number;
  onNumberCandleDigitChange: (digit: string) => void;
  onRemoveNumberCandleDigit: (digitIndex: number) => void;
  onCandleSelectionCommit: (entry: CandleSelection) => void;
  onCandleSelectionRemove: (candleId: string) => void;
}

const CartItemEditor = ({
  item,
  onSizeChange, onFlavorChange, onStyleChange,
  onBaseColorChange, onDecoColorChange, onTextChange, onTextColorChange, onTextStyleChange,
  onToggleExtra, onRibbonColorChange, onButterflyColorChange,
  onGlitterColorChange, onGlitterCherriesColorChange,
  onCommentChange, onImageFilesChange,
  onCandleQtyChange, getCandleUnitQty, getCandleItemPrice,
  onNumberCandleDigitChange, onRemoveNumberCandleDigit,
  onCandleSelectionCommit, onCandleSelectionRemove,
}: CartItemEditorProps) => {
  const { t } = useLang();
  const showDecoColor = item.style !== "normal-without-border";
  const showText = item.style !== "printed-picture";
  const excludedExtras = getExcludedExtras(item.style);
  const availableSizeIds = getAvailableSizesForStyle(item.style);
  const commentFileInputRef = useRef<HTMLInputElement>(null);

  const handleCommentImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    const currentFiles: File[] = item.imageFiles || [];
    const remainingSlots = Math.max(0, 5 - currentFiles.length);
    const files = selectedFiles.slice(0, remainingSlots);

    if (!files.length) {
      if (commentFileInputRef.current) commentFileInputRef.current.value = "";
      return;
    }

    // Validate size (5MB max each)
    const validFiles = files.filter(f => f.size <= 5 * 1024 * 1024);
    
    onImageFilesChange([...currentFiles, ...validFiles]);
    if (commentFileInputRef.current) commentFileInputRef.current.value = "";
  };

  const removeCommentImage = (index: number) => {
    const currentFiles: File[] = item.imageFiles || [];
    onImageFilesChange(currentFiles.filter((_: File, i: number) => i !== index));
  };

  const getExtraPriceForSize = (extra: typeof extras[0]) => {
    return extra.price[item.size as keyof typeof extra.price] || 0;
  };

  return (
    <TooltipProvider delayDuration={200}>
    <div className="space-y-6">
      {item.orderDate && (
        <p className="text-sm text-muted-foreground">{formatDateFromIso(item.orderDate)}</p>
      )}

      {/* Size with box images */}
      <EditSection label={t("Size", "Taille")} tooltip={t(`Choose the size of your cake. ${sizeInfoSummary.en}`, `Choisissez la taille de votre gâteau. ${sizeInfoSummary.fr}`)} required>
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
                <span className="text-sm text-muted-foreground ml-2">CHF {formatChf(size.price)}</span>
                {sizeInfo[size.id] && (
                  <span className="block text-xs text-primary/80 mt-0.5">
                    {t(sizeInfo[size.id].en, sizeInfo[size.id].fr)}
                  </span>
                )}
              </div>
              {item.size === size.id && <Check className="h-4 w-4 text-primary" />}
            </button>
          ))}
        </div>
      </EditSection>

      {/* Flavor with images */}
      <EditSection label={t("Flavor", "Parfum")} tooltip={t("Please select the flavour of your cake.", "Veuillez sélectionner le parfum de votre gâteau.")} required>
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
              <img src={flavor.image} alt={flavor.name} className="h-10 w-10 object-contain rounded flex-shrink-0" />
              <span className="min-w-0">
                <span className="block text-xs font-medium text-foreground leading-tight">{flavor.name}</span>
                <FlavorDesc flavorId={flavor.id} className="mt-0.5" />
              </span>
            </button>
          )))}
        </div>
      </EditSection>

      {/* Design */}
      <EditSection label={t("Design", "Design")} tooltip={t("You can select any design. You can also add extras and/or inspiration pictures in the next steps.", "Vous pouvez sélectionner n'importe quel design. Vous pourrez également ajouter des suppléments et/ou des photos d'inspiration aux étapes suivantes.")}>
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
                <span className="text-xs text-primary">+CHF {formatChf(style.price[item.size as keyof typeof style.price])}</span>
              )}
            </button>
          ))}
        </div>
      </EditSection>

      {/* Base Colour */}
      <EditSection label={t("Base Colour", "Couleur de base")} tooltip={t("The base colour is essential to personalise your cake.", "La couleur de base est essentielle pour personnaliser votre gâteau.")} required>
        <ColorPicker colors={baseColors} selected={item.baseColor} onSelect={onBaseColorChange} />
      </EditSection>

      {/* Decoration Colour */}
      {showDecoColor && (
        <EditSection label={t("Decoration Colour", "Couleur de décoration")} tooltip={t("Choose the colours for the decorative elements of your cake.", "Choisissez les couleurs des éléments décoratifs de votre gâteau.")} required>
          <ColorPicker colors={baseColors} selected={item.decorationColor} onSelect={onDecoColorChange} />
        </EditSection>
      )}

      {/* Text */}
      {showText && (
        <EditSection label={t("Cake Text", "Texte du gâteau")} tooltip={t("If you would like to add text, you can choose the typography.", "Si vous souhaitez ajouter un texte, vous pouvez choisir la typographie.")}>
          {/* Text Style Selection */}
          <div className="space-y-2 mb-3">
            <p className="text-xs font-medium text-muted-foreground">{t("Text Style", "Style du texte")}</p>
            <div className="flex gap-2">
              {[
                { id: "normal", name: t("Normal", "Normal") },
                { id: "uppercase", name: t("Uppercase", "Majuscules") },
                { id: "cursive", name: t("Cursive", "Cursive") },
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
            placeholder={t("Enter text for your cake (max 30 chars)", "Saisissez le texte de votre gâteau (max 30 caractères)")}
            value={item.cakeText || ""}
            onChange={(e) => onTextChange(e.target.value.slice(0, 30))}
            maxLength={30}
          />
          <p className="text-xs text-muted-foreground text-right">{(item.cakeText || "").length}/30</p>

          {/* Live text preview */}
          {item.cakeText && (
            <div className="bg-muted/30 rounded-lg p-3 text-center mt-1">
              <p className="text-xs text-muted-foreground mb-1">{t("Preview:", "Aperçu :")}</p>
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
              <p className="text-xs font-medium text-muted-foreground mb-1">{t("Text Colour", "Couleur du texte")}</p>
              <ColorPicker colors={textColors} selected={item.textColor} onSelect={onTextColorChange} />
            </div>
          )}
        </EditSection>
      )}

      {/* Extras */}
      <EditSection label={t("Extra", "Suppléments")} tooltip={t("You can add any additional elements to personalise your design.", "Vous pouvez ajouter des éléments supplémentaires pour personnaliser votre design.")}>
        {extraGroups.map((group) => {
          const visibleExtras = group.ids
            .map(id => extras.find(e => e.id === id))
            .filter((extra): extra is typeof extras[0] => !!extra && !excludedExtras.includes(extra.id))
            .filter(extra => {
              const price = extra.price[item.size as keyof typeof extra.price];
              return price !== undefined && price > 0;
            });
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
                      <ExtraImageLightbox src={extra.image} alt={extra.name} className="w-10 h-10 object-cover rounded flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1">
                          <p className="text-xs font-medium text-foreground whitespace-normal leading-snug">{extra.name}</p>
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
                        <p className="text-[10px] text-primary">+CHF {formatChf(price)}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Glitter Colour */}
        {((item.extras || []).some(e => ["glitter", "glitter-base", "glitter-in-the-air"].includes(e)) || ["retro-glitter-cake", "retro-ribbons-glitter"].includes(item.style)) && (
          <div className="space-y-2 mt-3">
            <p className="text-xs font-medium text-foreground">{t("Glitter Colour", "Couleur des paillettes")} <span className="text-destructive">*</span></p>
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

        {/* Glitter Cherries Colour */}
        {((item.extras || []).includes("glitter-cherries") || item.style === "glitter-cherries-retro") && (
          <div className="space-y-2 mt-3">
            <p className="text-xs font-medium text-foreground">{t("Glitter Cherries Colour", "Couleur des cerises pailletées")}</p>
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

        {/* Ribbon Colour */}
        {((item.extras || []).includes("ribbons") || item.style === "retro-ribbons" || item.style === "retro-ribbons-glitter") && (
          <div className="space-y-2 mt-3">
            <p className="text-xs font-medium text-foreground">{t("Ribbon Colour", "Couleur du ruban")} <span className="text-destructive">*</span></p>
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

        {/* Butterfly Colour */}
        {((item.extras || []).includes("butterfly") || item.style === "butterfly-garden") && (
          <div className="space-y-2 mt-3">
            <p className="text-xs font-medium text-foreground">{t("Butterfly Colour", "Couleur des papillons")} <span className="text-destructive">*</span></p>
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
      <EditSection label={t("Comment", "Commentaire")} tooltip={t("Write any guidelines you would like to clarify. Please note that if you request decorations or extras that were not selected, the price may change.", "Indiquez toute précision que vous souhaitez apporter. Veuillez noter que si vous demandez des décorations ou des suppléments non sélectionnés, le prix peut varier.")}>
        <Textarea
          value={splitComment(item.comment).comment || ""}
          onChange={(e) => onCommentChange(e.target.value)}
          placeholder={t("Any special requests or details about your cake...", "Toute demande particulière ou détail concernant votre gâteau...")}
          className="min-h-[80px]"
        />
      </EditSection>

      {/* Upload */}
      <EditSection label={t("Upload", "Photos")} tooltip={t("Upload an inspiration picture if you would like.", "Ajoutez une photo d'inspiration si vous le souhaitez.")}>
        <p className="text-xs text-muted-foreground mb-2">
          {t("Upload reference images (max 5, JPG, PNG, WEBP)", "Ajoutez des images de référence (max 5, JPG, PNG, WEBP)")}
        </p>
        <input
          ref={commentFileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          onChange={handleCommentImageUpload}
          className="hidden"
        />
        {(item.imageFiles || []).length < 5 && (
          <button
            onClick={() => commentFileInputRef.current?.click()}
            className="w-full border-2 border-dashed border-border rounded-lg p-4 flex flex-col items-center gap-1 hover:border-primary/50 transition-colors"
          >
            <Upload className="w-6 h-6 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">{t("Click to upload images", "Cliquez pour ajouter des images")}</span>
          </button>
        )}
        {(item.imageFiles || []).length > 0 && (
          <>
            <div className="flex flex-wrap gap-2 mt-2">
              {(item.imageFiles || []).map((file: File, index: number) => (
                <div key={index} className="relative w-16 h-16">
                  <img
                    src={URL.createObjectURL(file)}
                    alt={`Reference ${index + 1}`}
                    className="w-full h-full object-cover rounded-lg"
                  />
                  <button
                    onClick={() => removeCommentImage(index)}
                    className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-none p-0.5 hover:bg-destructive/80"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground/80 italic mt-2 leading-tight">
              {t("When a client provides an inspiration photo, it is for reference only. Bento Cake Studio SNC will create a design inspired by it and aim to respect the colours and style, but an identical reproduction is not guaranteed.", "Lorsqu'un client fournit une photo d'inspiration, celle-ci sert uniquement de référence. Bento Cake Studio SNC créera un design qui s'en inspire en veillant à respecter les couleurs et le style, mais une reproduction à l'identique n'est pas garantie.")}
            </p>
          </>
        )}
      </EditSection>

      {/* Candles - packs first, then individual */}
      <EditSection label={t("Candles", "Bougies")}>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {cartCandles.map((candle) => {
            const family = FAMILY_CANDLE_COLORS[candle.id];
            if (family) {
              return (
                <div key={candle.id} className="min-w-0">
                  <ColorFamilyCandleCard
                    candle={candle}
                    colors={family}
                    existing={(item.candles || []).find((c: CandleSelection) => c.id === candle.id)}
                    onCommit={onCandleSelectionCommit}
                    onRemove={() => onCandleSelectionRemove(candle.id)}
                    imageClassName="h-14 w-14"
                    compact
                  />
                </div>
              );
            }

            const qty = getCandleUnitQty(candle.id);
            const price = getCandleItemPrice(candle.id);
            const isPackApplied = candle.hasPack && qty >= (candle.packSize || 6);
            return (
              <div
                key={candle.id}
                className={cn(
                  "flex flex-col items-center p-2 rounded-lg border transition-all min-w-0",
                  qty > 0 ? "ring-2 ring-primary border-primary bg-secondary" : "border-border"
                )}
              >
                <img src={candle.image} alt={candle.name} className="h-20 w-20 object-contain mb-1" />
                <span className="text-xs font-medium text-foreground text-center">{candle.name}</span>
                <span className="text-xs text-muted-foreground">CHF {formatChf(candle.unitPrice)}{t("/ea", "/pièce")}</span>
                {candle.hasPack && (
                  <span className="text-[10px] text-muted-foreground">{t("Pack", "Lot")} {candle.packSize} = CHF {formatChf(candle.packPrice)}</span>
                )}
                <div className="flex items-center gap-2 mt-2">
                  <button
                    onClick={() => onCandleQtyChange(candle.id, -1)}
                    disabled={qty === 0}
                    className="h-7 w-7 rounded-none border border-border flex items-center justify-center text-foreground disabled:opacity-30 hover:bg-muted"
                  >
                    <Minus className="h-3 w-3" />
                  </button>
                  <span className="text-sm font-medium w-6 text-center text-foreground">{qty}</span>
                  <button
                    onClick={() => onCandleQtyChange(candle.id, 1)}
                    className="h-7 w-7 rounded-none border border-border flex items-center justify-center text-foreground hover:bg-muted"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>
                {qty > 0 && <span className="text-xs text-primary font-medium mt-1">CHF {formatChf(price)}</span>}
                {isPackApplied && <span className="text-xs text-green-600 font-medium">{t("✓ Pack applied", "✓ Lot appliqué")}</span>}
              </div>
            );
          })}

          {/* Number Candle — multi-digit display, each digit individually
              removable. Several digits live in ONE CandleSelection
              (digits: ["1","8"]), never as separate entries — removing one
              must never take out the others, hence onRemoveNumberCandleDigit
              keying on the digit's own index, not on id === "number-candle"
              (which would always remove every digit at once). */}
          {(() => {
            const entry = (item.candles || []).find((c: CandleSelection) => c.id === NUMBER_CANDLE_ID);
            if (!entry) return null;
            const digits: string[] = entry.digits || (entry.digit ? [entry.digit] : []);
            if (digits.length === 0) return null;
            const total = digits.length * NUMBER_CANDLE_PRICE;
            return (
              <div className={cn(
                "flex flex-col items-center p-2 rounded-lg border transition-all min-w-0",
                "ring-2 ring-primary border-primary bg-secondary"
              )}>
                <div className="h-20 w-20 mb-1 flex items-center justify-center bg-secondary/20">
                  <span className="text-xl font-bold text-primary tracking-wider">{digits.join(" · ")}</span>
                </div>
                <span className="text-xs font-medium text-foreground text-center">{t("Number Candle", "Bougie chiffre")}</span>
                <span className="text-[10px] text-muted-foreground mt-0.5">{digits.length} × CHF {formatChf(NUMBER_CANDLE_PRICE)}</span>
                <span className="text-xs text-primary font-medium mt-1 mb-1.5">CHF {formatChf(total)}</span>
                <div className="flex flex-wrap justify-center gap-1">
                  {digits.map((d, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => onRemoveNumberCandleDigit(i)}
                      className="flex items-center gap-0.5 text-[10px] bg-background border border-border rounded-none px-1.5 py-0.5 text-foreground hover:border-destructive hover:text-destructive transition-colors"
                      aria-label={t(`Remove digit ${d}`, `Retirer le chiffre ${d}`)}
                    >
                      {d}<X className="w-2.5 h-2.5" />
                    </button>
                  ))}
                </div>
                {digits.length > 1 && (
                  <button
                    type="button"
                    onClick={() => onCandleSelectionRemove(NUMBER_CANDLE_ID)}
                    className="text-[10px] text-muted-foreground hover:text-destructive underline mt-1.5"
                  >
                    {t("Remove all", "Tout retirer")}
                  </button>
                )}
              </div>
            );
          })()}
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
          "h-8 w-8 rounded-none border-2 transition-all flex items-center justify-center",
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
