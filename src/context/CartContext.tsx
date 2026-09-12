import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { trackAddToCart, trackRemoveFromCart } from "@/lib/analytics";
import { MULTI_DATE_FULFILLMENT_ENABLED } from "@/lib/featureFlags";

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
}

const CartContext = createContext<CartContextType | undefined>(undefined);

const CART_STORAGE_KEY = "cake-cart-items";

export const CartProvider = ({ children }: { children: ReactNode }) => {
  const [items, setItems] = useState<CartItem[]>(() => {
    const stored = localStorage.getItem(CART_STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    // Hydrate with empty imageFiles since File objects can't be serialized.
    // Drop any stored item without a currently-valid product — stale data
    // left over from before this field existed (or from a renamed product
    // type) must never resurface into a live cart again.
    return parsed
      .filter((item: any) => VALID_PRODUCTS.has(item?.product))
      .map((item: any) => ({ ...item, imageFiles: [] }));
  });

  useEffect(() => {
    // Exclude non-serializable File objects from localStorage
    const serializable = items.map(({ imageFiles, ...rest }) => rest);
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(serializable));
  }, [items]);

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
