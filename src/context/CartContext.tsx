import { createContext, useContext, useState, useEffect, ReactNode } from "react";

export interface CandleCartItem {
  id: string;
  quantity: number;
  hasPack: boolean;
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
  candles: CandleCartItem[];
  comment: string;
  imageUrls: string[];
  imageFiles: File[];
  total: number;
  /* Standalone candle product (added from the Candles page) */
  isCandleProduct?: boolean;
  candleProductId?: string;
  candleProductName?: string;
  candleProductImage?: string;
  candleProductQty?: number;
  candleProductHasPack?: boolean;
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
]);

interface CartContextType {
  items: CartItem[];
  addItem: (item: CartItem) => void;
  updateItem: (id: string, updates: Partial<CartItem>) => void;
  removeItem: (id: string) => void;
  clearCart: () => void;
  itemCount: number;
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

  const addItem = (item: CartItem) => {
    const newItem = { ...item, id: Date.now().toString() };
    setItems((prev) => [...prev, newItem]);
  };

  const updateItem = (id: string, updates: Partial<CartItem>) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...updates } : item))
    );
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const clearCart = () => {
    setItems([]);
  };

  return (
    <CartContext.Provider
      value={{
        items,
        addItem,
        updateItem,
        removeItem,
        clearCart,
        itemCount: items.length,
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
