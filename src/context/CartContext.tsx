import { createContext, useContext, useState, useEffect, ReactNode } from "react";

export interface CandleCartItem {
  id: string;
  quantity: number;
  hasPack: boolean;
}

export interface CartItem {
  id: string;
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
  candles: CandleCartItem[];
  comment: string;
  imageUrls: string[];
  imageFiles: File[];
  total: number;
}

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
    return stored ? JSON.parse(stored) : [];
  });

  useEffect(() => {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
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
