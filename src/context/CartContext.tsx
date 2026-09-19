import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { trackAddToCart, trackRemoveFromCart } from "@/lib/analytics";
import { MULTI_DATE_FULFILLMENT_ENABLED } from "@/lib/featureFlags";
import { INSPIRATIONS } from "@/data/inspirations";
import { useLang } from "@/context/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { getStoredOrderId, clearStoredOrderId } from "@/lib/checkoutOrderId";
import { onOrderCompleted } from "@/lib/orderCompletionChannel";
import { supabase } from "@/integrations/supabase/client";
import {
  getStoredPartnerReferral,
  setStoredPartnerReferral,
  type PartnerReferral,
} from "@/lib/partnerReferral";

// Canonical shape for a candle attached to a cart item — used both for
// candles added directly on the Candles page and for candles added on top
// of a cake (Catalog/DotCakes/KitBentoCake). `colors` and `digit` are only
// ever set together with the id they apply to: a colour-family "by the
// piece" selection sets `colors` (never duplicated, length === quantity);
// the Number Candle sets `digit`; every other candle (packs, plain items)
// leaves both unset.
export interface CandleSelection {
  id: string;
  quantity: number;
  hasPack: boolean;
  colors?: string[];
  digit?: string;
  digits?: string[];  // multi-digit number candle selection
}

export interface CartItem {
  id: string;
  /* Stable product-line id, independent of language — matches Supabase's
     order_items.product enum (bento_cake / rectangle_cake / dot_cakes /
     diy_kit / candles / edible_printing). */
  product: string;
  orderDate: string;
  orderTime: string;
  size: string;
  sizeName: string;
  shape: string;
  shapeName: string;
  flavor: string;
  flavorName: string;
  style: string;
  styleName: string;
  baseColor: string;
  baseColorName: string;
  decorationColor: string;
  decorationColorName: string;
  cakeText: string;
  textColor: string;
  textColorName: string;
  textStyle: string;
  extras: string[];
  extrasNames: string[];
  ribbonColor: string;
  ribbonColorName: string;
  butterflyColor: string;
  butterflyColorName: string;
  /* Only set by Catalog.tsx, for the Glitter / Glitter Cherries extras —
     optional so every other add-to-cart page is unaffected. */
  glitterColorName?: string;
  glitterCherriesColorName?: string;
  /* Gender Reveal only: the colour inside the cake ("Rose" / "Bleu",
     already French — an internal, admin-facing value, not translated by
     useLang()). Deliberately separate from decorationColor/decorationColorName
     (a genuinely different piece of information — see order_items.inside_color)
     — optional so every other design is unaffected. Persisted to
     order_items.inside_color. */
  insideColor?: string;
  candles: CandleSelection[];
  comment: string;
  imageUrls: string[];
  imageFiles: File[];
  /* Absolute URL of the catalogue design photo the customer chose on
     Catalog.tsx: the exact option they clicked for a multi-photo design,
     otherwise the design's single photo. Complements `style`/`design` (the
     design type id) and `imageUrls` / order_items.reference_images (client
     uploads) — it never replaces either. null for an inspiration cake and
     for every other add-to-cart surface; persisted to
     order_items.design_image_url. */
  designImageUrl?: string | null;
  /* Workshop line (product === "workshop"). Set only by WorkshopBooking.tsx.
     Every cake field above stays empty for a workshop. These persist to the
     matching order_items.workshop_* columns. Customer contact details are
     NOT duplicated here — they live on orders (collected at checkout). */
  workshopType?: "signature" | "paint";
  workshopSessionId?: string;
  workshopDate?: string;   // "YYYY-MM-DD"
  workshopTime?: string;   // "HH:MM"
  workshopParticipants?: number;
  workshopUnitPrice?: number;
  /* "Does the booking include one or more participants under 18?" and, when
     yes, the mandatory legal-representative-authorisation confirmation. When
     workshopHasMinor is false, workshopMinorConsentConfirmed is always false.
     Persisted to order_items.workshop_has_minor /
     order_items.workshop_minor_consent_confirmed. */
  workshopHasMinor?: boolean;
  workshopMinorConsentConfirmed?: boolean;
  workshopSpongeChoices?: string[];  // one per participant: "vanilla" | "chocolate"
  total: number;
  /* Standalone candle product (added from the Candles page) */
  isCandleProduct?: boolean;
  candleProductId?: string;
  candleProductName?: string;
  candleProductImage?: string;
  candleProductQty?: number;
  candleProductHasPack?: boolean;
  // Structured attribute for a candle variant (a digit, a colour, ...) —
  // candleProductName stays the composed display string ("Number Candle –
  // 7") for every existing consumer (Cart.tsx, order_items.candle_name,
  // admin view, confirmation email); this field exists purely so that
  // attribute is also available structured, without re-parsing the name.
  candleProductVariant?: string;
  // Fixed per-unit price for a candle line that is NEVER pack-eligible
  // (the Number Candle, or a colour bought loose by the piece) — set once
  // at add-to-cart time. When present, Cart.tsx's quantity +/- recomputes
  // price from this directly instead of looking candleProductId back up
  // in the candle catalogue, which composite ids like "shiny-spiral-blue"
  // or "number-candle-7" were never going to match. Left unset for every
  // other candle (packs, plain catalogue items), which keep using the
  // existing catalogue-lookup recalculation unchanged.
  candleProductUnitPrice?: number;
  // When true, Cart.tsx hides the +/- quantity stepper for this line and
  // only offers removal — used for the colour-piece candle families, where
  // quantity IS the count of distinct colours already chosen, so it can't
  // be bumped without picking another colour on the Candles page.
  candleProductQtyLocked?: boolean;
}

// Mirrors Supabase's order_items.product enum (product_type) exactly. Kept
// here, as the single source of truth, so any cart item lacking a currently
// valid product — e.g. one added before this field existed, sitting in a
// visitor's localStorage across a deploy — is dropped on load instead of
// silently reaching checkout and failing the order_items insert later.
export const VALID_PRODUCTS = new Set([
  "bento_cake",
  "rectangle_cake",
  "dot_cakes",
  "diy_kit",
  "candles",
  "edible_printing",
  "workshop",
]);

// Result of an addItem() attempt. `ok: false` means the item was NOT added
// (never silently dropped, never partially added) and carries the reason so
// each "Add to cart" surface can show the customer a precise message.
//   - "date_mismatch": a dated item whose date differs from the cart's date
// (A workshop + cake mix is ALLOWED — one checkout, one payment. The workshop
//  auto-confirms; the cake part waits for the admin.)
export interface AddItemResult {
  ok: boolean;
  /* Set whenever ok === false. Left undefined on success. */
  reason?: "date_mismatch";
}

interface CartContextType {
  items: CartItem[];
  addItem: (item: CartItem) => AddItemResult;
  updateItem: (id: string, updates: Partial<CartItem>) => void;
  removeItem: (id: string) => void;
  clearCart: () => void;
  itemCount: number;
  cartOrderDate: string | null;
  /* True when the cart already holds at least one workshop line / at least
     one non-workshop (cake / kit / candle / printing) line. Exposed so a
     surface can pre-check and guide the customer before they even click. */
  cartHasWorkshop: boolean;
  cartHasCake: boolean;
  /* Validated partner referral for the current shopping session (step 1 —
     recognition only, see src/lib/partnerReferral.ts). null for every
     visitor without a valid ?ref= token — the overwhelming majority. Never
     used for pricing here; a later step recalculates and verifies the
     discount/commission server-side. */
  partnerReferral: PartnerReferral | null;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

const CART_STORAGE_KEY = "cake-cart-items";

export const CartProvider = ({ children }: { children: ReactNode }) => {
  const { t } = useLang();
  const { toast } = useToast();
  // Set (once, synchronously, by the items initializer below) whenever a
  // pre-fix Inspiration cart item had to be dropped rather than silently
  // remapped — see the migration comment below. Consumed by the effect
  // right under it to show exactly one toast per mount, then reset.
  const [staleInspirationDropped, setStaleInspirationDropped] = useState(0);

  const [items, setItems] = useState<CartItem[]>(() => {
    const stored = localStorage.getItem(CART_STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    // Hydrate with empty imageFiles since File objects can't be serialized.
    // Drop any stored item without a currently-valid product — stale data
    // left over from before this field existed (or from a renamed product
    // type) must never resurface into a live cart again.
    const withValidProduct = parsed.filter((item: any) => VALID_PRODUCTS.has(item?.product));

    // Carts saved before the Inspirations pricing fix can still hold a
    // cake item with the old, generic style: "inspiration" — a single id
    // shared by every Inspiration photo, which the server has never
    // priced (supabase/functions/_shared/pricing.ts's INSPIRATION_DESIGNS
    // rejects unknown design ids on purpose, never charges a guessed
    // price) and never will. That value must never reach checkout again:
    //  - Every Inspiration item, before and after the fix, also carries
    //    imageUrls: [selectedCake.image] (Catalog.tsx) — the exact photo's
    //    built asset URL, whose filename embeds the original image number
    //    (e.g. ".../inspiration-14-<hash>.jpg", from src/assets/
    //    inspiration-14.jpg). That number is unambiguous and independent
    //    of this bug, so if it's present and that photo still exists in
    //    today's INSPIRATIONS list, remap the item to its current stable
    //    id ("inspiration-14") instead of the old generic one.
    //  - If the photo can't be identified (no imageUrls) or no longer
    //    exists (removed from the gallery since), the item is dropped —
    //    never left as "inspiration" for checkout to choke on — and the
    //    customer is told once (see the effect below) so the cart doesn't
    //    just silently lose an item with no explanation.
    let staleCount = 0;
    const migrated = withValidProduct.reduce((acc: any[], item: any) => {
      if (item?.style !== "inspiration") {
        acc.push(item);
        return acc;
      }
      const match = /inspiration-(\d+)/.exec(item?.imageUrls?.[0] || "");
      const candidateId = match ? `inspiration-${match[1]}` : null;
      const candidate = candidateId ? INSPIRATIONS.find((i) => i.id === candidateId) : undefined;
      if (candidate) {
        acc.push({
          ...item,
          style: candidate.id,
          // Old buggy add-to-cart run always left this null for
          // Inspiration items — backfill it now so the cart can finally
          // show the photo instead of a bare "Inspiration #N" label.
          designImageUrl: item.designImageUrl || candidate.src,
        });
      } else {
        staleCount++;
      }
      return acc;
    }, []);

    if (staleCount > 0) {
      // Deferred: this initializer runs during render, before effects —
      // setState here would be dropped. queueMicrotask fires right after
      // mount, in time for the effect below to read the updated value.
      queueMicrotask(() => setStaleInspirationDropped(staleCount));
    }

    return migrated.map((item: any) => ({ ...item, imageFiles: [] }));
  });

  useEffect(() => {
    if (staleInspirationDropped === 0) return;
    toast({
      title: t("Cake removed from cart", "Gâteau retiré du panier"),
      description: t(
        "One of your Inspiration cakes could no longer be identified after a recent update. Please select it again from the Inspirations page.",
        "Un de vos gâteaux d'inspiration n'a pas pu être identifié après une récente mise à jour. Merci de le sélectionner à nouveau depuis la page Inspirations."
      ),
      variant: "destructive",
    });
    setStaleInspirationDropped(0);
  }, [staleInspirationDropped, toast, t]);

  useEffect(() => {
    // Exclude non-serializable File objects from localStorage
    const serializable = items.map(({ imageFiles, ...rest }) => rest);
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(serializable));
  }, [items]);

  // ── Partner referral recognition — step 1 (frontend only) ────────────
  // Hydrate any referral already validated earlier this session (e.g. the
  // customer landed on a partner link, then navigated to another page).
  const [partnerReferral, setPartnerReferral] = useState<PartnerReferral | null>(
    () => getStoredPartnerReferral(),
  );

  // Runs once, on site load — matches the task's own "on site load" spec.
  // CartProvider mounts exactly once at the app root (see App.tsx) and never
  // remounts on client-side navigation, so this also correctly covers a
  // partner link landing directly on any page (e.g. /catalog?ref=...), not
  // only "/". Absent ?ref, this does nothing at all — zero behaviour change
  // for every normal visitor.
  useEffect(() => {
    let cancelled = false;
    const ref = new URLSearchParams(window.location.search).get("ref");
    if (!ref) return;

    // Already resolved for this exact token this session (e.g. a second
    // effect run under React StrictMode in dev) — never re-validate or
    // re-toast for the same token.
    const already = getStoredPartnerReferral();
    if (already?.token === ref) {
      setPartnerReferral(already);
      return;
    }

    (async () => {
      try {
        // resolve-partner-ref's confirmed live response shape:
        // { valid: true, partner: { name: string, discountRate: number } }
        // — discountRate is a FRACTION (0.10 = 10%), not a percentage.
        const { data, error } = await supabase.functions.invoke("resolve-partner-ref", {
          body: { token: ref },
        });
        if (cancelled || error || !data?.valid || !data?.partner) return;

        const partner = data.partner as { name?: unknown; discountRate?: unknown };
        if (typeof partner.name !== "string" || typeof partner.discountRate !== "number") return;

        const resolved: PartnerReferral = {
          token: ref,
          partnerName: partner.name,
          // Stored exactly as returned (a fraction) — never converted here,
          // so a later step reads the same raw value the server verifies.
          discountRate: partner.discountRate,
        };
        setPartnerReferral(resolved);
        setStoredPartnerReferral(resolved);

        // Display only — the fraction is converted to a whole percentage
        // purely for the toast wording, never stored or used for pricing.
        const displayPercent = Math.round(resolved.discountRate * 100);
        toast({
          title: t(
            `${resolved.partnerName} partner benefit activated`,
            `Avantage partenaire ${resolved.partnerName} activé`,
          ),
          description: t(
            `${displayPercent}% off the base price of your eligible cake.`,
            `${displayPercent} % de réduction sur le prix de base de votre gâteau éligible.`,
          ),
        });
      } catch (e) {
        // Invalid / inactive / missing token, or the call failed: never
        // surface an error to the customer, never activate anything — the
        // site continues exactly as normal, silently, as specified.
        console.error("resolve-partner-ref failed (no referral activated):", e);
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addItem = (item: CartItem): AddItemResult => {
    // Workshop + cake in one cart is allowed — a single checkout, a single
    // payment captured immediately. The workshop part auto-confirms; the cake
    // part waits for the admin.
    //
    // Multiple pickup/delivery DATES among physical items are only refused
    // while MULTI_DATE_FULFILLMENT_ENABLED is false (see src/lib/
    // featureFlags.ts) — Checkout groups physical items by date and creates
    // one order_fulfillments row per distinct date server-side, but Make/
    // Notion are not yet adapted to consume that, so this guard stays in
    // place until the flag flips. Flipping it does not relax anything else
    // here: workshop + cake mixing was already allowed regardless.
    if (!MULTI_DATE_FULFILLMENT_ENABLED && item.orderDate) {
      const existingDate = items.find((i) => i.orderDate)?.orderDate;
      if (existingDate && existingDate !== item.orderDate) {
        return { ok: false, reason: "date_mismatch" };
      }
    }
    const newItem = { ...item, id: Date.now().toString() };
    setItems((prev) => [...prev, newItem]);
    // GA4 add_to_cart — fired here so every "Add to cart" surface (Catalog,
    // Dot Cakes, Candles, DIY Kit, Printing, …) is covered once, and only
    // when the item is genuinely accepted into the cart.
    trackAddToCart(newItem);
    return { ok: true };
  };

  const updateItem = (id: string, updates: Partial<CartItem>) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...updates } : item))
    );
  };

  const removeItem = (id: string) => {
    // GA4 remove_from_cart — only for an explicit single-line removal.
    // clearCart() stays event-free: it is also used after a successful order
    // and on the payment-success page, where the items were purchased, not
    // removed. Cart.tsx's "Clear all" emits remove_from_cart itself.
    const gone = items.find((item) => item.id === id);
    if (gone) trackRemoveFromCart(gone);
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const clearCart = () => {
    setItems([]);
  };

  // 2026-09-14: cross-tab sync — the original Checkout tab is commonly left
  // behind once PostFinance's payment page opens in a NEW tab
  // (EmbeddedCheckout.tsx's link is target="_blank"); when that other tab
  // pays and PaymentSuccess.tsx confirms the order, it broadcasts the exact
  // orderId (see orderCompletionChannel.ts) — never on a mere "Proceed to
  // Payment" click, only once the order is genuinely, server-confirmed
  // finalised. Every tab (this one included) subscribes here, at the single
  // app-wide CartProvider, so it applies no matter which page a stale tab
  // happens to be showing. Reuses the SAME clearCart() already used by
  // PaymentSuccess.tsx — never a second clearing implementation. Only acts
  // if THIS tab's own tracked attempt (getStoredOrderId) is the exact
  // orderId that just completed — a different, unrelated cart/checkout
  // started since is never touched, so a genuinely new order in progress in
  // this same tab can never be wiped by an unrelated completion elsewhere.
  useEffect(() => {
    const unsubscribe = onOrderCompleted((orderId) => {
      if (getStoredOrderId() === orderId) {
        clearCart();
        clearStoredOrderId();
        // Reports the match back to onOrderCompleted — only on a real match
        // is its persisted localStorage marker safe to consume (see that
        // function's own comment for why: a mismatch might still be meant
        // for a different tab).
        return true;
      }
      return false;
    });
    return unsubscribe;
  }, []);

  const cartOrderDate = items.find((i) => i.orderDate)?.orderDate || null;
  const cartHasWorkshop = items.some((i) => i.product === "workshop");
  const cartHasCake = items.some((i) => i.product !== "workshop");

  return (
    <CartContext.Provider
      value={{
        items,
        addItem,
        updateItem,
        removeItem,
        clearCart,
        itemCount: items.length,
        cartOrderDate,
        cartHasWorkshop,
        cartHasCake,
        partnerReferral,
      }}
    >
      {children}
    </CartContext.Provider>
  );
};

export const useCart = () => {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart must be used within a CartProvider");
  }
  return context;
};
