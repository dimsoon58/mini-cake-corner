/**
 * Google Analytics 4 — e-commerce event helpers.
 *
 * Consent: gtag.js is loaded by Cookiebot only after the visitor grants
 * "statistics" consent (see the two <script type="text/plain"
 * data-cookieconsent="statistics"> tags in index.html). Until then
 * `window.gtag` does not exist and no Analytics cookie is set. Every event
 * below is additionally gated on `Cookiebot.consent.statistics === true`, so
 * nothing is ever sent — and nothing is queued — before consent. If the
 * visitor withdraws consent, Cookiebot unloads gtag.js and deletes the _ga*
 * cookies; these helpers then silently no-op again.
 *
 * All monetary values are in CHF. Prices already include everything the
 * customer pays for that line (the cart never stores a separate unit price
 * for cakes — one configured cake = one line = quantity 1).
 */

import type { CartItem } from "@/context/CartContext";

type GA4Item = {
  item_id: string;
  item_name: string;
  item_category?: string;
  item_variant?: string;
  price?: number;
  quantity?: number;
  index?: number;
};

// Maps CartItem.product (the Supabase order_items.product enum, the single
// source of truth) to a human-readable name + category for GA4.
const PRODUCT_CATALOG: Record<string, { item_name: string; item_category: string }> = {
  bento_cake: { item_name: "Bento Cake", item_category: "Bento Cakes" },
  rectangle_cake: { item_name: "Rectangle Cake", item_category: "Rectangle Cakes" },
  dot_cakes: { item_name: "Dot Cake", item_category: "Dot Cakes" },
  diy_kit: { item_name: "DIY Bento Cake Kit", item_category: "DIY Kit" },
  candles: { item_name: "Candles", item_category: "Candles" },
  edible_printing: { item_name: "Edible Printing", item_category: "Edible Printing" },
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function consentGranted(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as any;
  return w.Cookiebot?.consent?.statistics === true && typeof w.gtag === "function";
}

/**
 * Send a GA4 event, but only if Analytics consent is currently granted and
 * gtag.js is loaded. Returns whether the event was actually dispatched.
 */
export function trackEvent(name: string, params: Record<string, unknown> = {}): boolean {
  if (!consentGranted()) return false;
  try {
    (window as any).gtag("event", name, params);
    return true;
  } catch {
    /* never let analytics break a user flow */
    return false;
  }
}

/**
 * Like `trackEvent`, but for events fired on page/route mount where gtag.js
 * may still be loading on a fresh page load for an ALREADY-consented visitor.
 * Retries every 250ms for ~6s, but only while consent is (or turns out to be)
 * granted — it never waits for an undecided visitor to accept, so it can't
 * replay a backlog of events after a late consent.
 */
export function trackEventWhenReady(
  name: string,
  params: Record<string, unknown> = {},
  attemptsLeft = 24,
): void {
  if (typeof window === "undefined") return;
  const w = window as any;
  const cb = w.Cookiebot;
  // Cookiebot has loaded and reported the choice:
  if (cb && cb.consent) {
    // Not granted (declined or not yet decided) -> do not send, do not wait.
    if (cb.consent.statistics !== true) return;
    // Granted -> fall through and keep retrying only until gtag is ready.
  }
  // else: Cookiebot script still downloading — a returning visitor's stored
  // "granted" may still resolve; keep trying through the short window.
  if (trackEvent(name, params)) return;
  if (attemptsLeft <= 0) return;
  setTimeout(() => trackEventWhenReady(name, params, attemptsLeft - 1), 250);
}

/**
 * Run `cb` exactly once, as soon as Analytics consent is granted AND gtag is
 * ready — whether that is immediately, after the load settles, or when the
 * visitor accepts cookies while still on this page (the one deliberate
 * "fire after consent" case, used for the current page's `view_item`).
 * Returns a cleanup that cancels a still-pending run; call it when navigating
 * away so nothing fires retroactively for a page the visitor already left.
 * Never runs `cb` if the banner is answered without granting "statistics".
 */
export function onAnalyticsReady(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const w = window as any;
  let done = false;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;

  const finish = () => {
    done = true;
    if (pollTimer) clearTimeout(pollTimer);
    w.removeEventListener?.("CookiebotOnAccept", onConsentEvent);
    w.removeEventListener?.("CookiebotOnDecline", onConsentEvent);
    w.removeEventListener?.("CookiebotOnConsentReady", onConsentEvent);
  };

  const attempt = (): boolean => {
    if (done) return true;
    if (consentGranted()) {
      try {
        cb();
      } catch {
        /* ignore */
      }
      finish();
      return true;
    }
    // Banner answered without statistics -> give up for good.
    if (w.Cookiebot?.hasResponse === true && w.Cookiebot?.consent?.statistics !== true) {
      finish();
      return true;
    }
    return false;
  };

  function onConsentEvent() {
    attempt();
  }

  if (attempt()) return finish;

  // Not ready yet: watch for a later accept (no time limit) and poll for
  // gtag to finish loading (bounded — after that only an accept can trigger).
  w.addEventListener?.("CookiebotOnAccept", onConsentEvent);
  w.addEventListener?.("CookiebotOnDecline", onConsentEvent);
  w.addEventListener?.("CookiebotOnConsentReady", onConsentEvent);

  const poll = (left: number) => {
    if (done) return;
    if (attempt() || left <= 0) return; // stop polling; the accept listener stays
    pollTimer = setTimeout(() => poll(left - 1), 250);
  };
  poll(60);

  return finish;
}

/** Build a GA4 `items[]` entry from a cart line. */
export function cartItemToGA4Item(item: CartItem, index?: number): GA4Item {
  const cat = PRODUCT_CATALOG[item.product];
  const isCandleProduct = !!item.isCandleProduct;

  const quantity = isCandleProduct ? item.candleProductQty || 1 : 1;
  const price =
    isCandleProduct && item.candleProductQty
      ? round2(item.total / item.candleProductQty)
      : round2(item.total);

  const item_name = isCandleProduct
    ? item.candleProductName || cat?.item_name || item.product
    : [cat?.item_name || item.product, item.sizeName].filter(Boolean).join(" – ");

  const item_id = isCandleProduct
    ? item.candleProductId || item.product
    : item.product;

  const variant = isCandleProduct
    ? item.candleProductVariant || undefined
    : [item.shapeName, item.flavorName].filter(Boolean).join(", ") || undefined;

  const ga: GA4Item = {
    item_id,
    item_name,
    item_category: cat?.item_category || item.product,
    price,
    quantity,
  };
  if (variant) ga.item_variant = variant;
  if (typeof index === "number") ga.index = index;
  return ga;
}

export function cartItemsToGA4Items(items: CartItem[]): GA4Item[] {
  return items.map((it, idx) => cartItemToGA4Item(it, idx));
}

export function cartItemsValue(items: CartItem[]): number {
  return round2(items.reduce((sum, it) => sum + it.total, 0));
}

/**
 * `view_item` for a product line the visitor is currently configuring.
 * Caller (ViewItemTracker) wraps this in `onAnalyticsReady`, so by the time
 * it runs consent is granted and gtag is loaded — a plain send is enough.
 */
export function trackViewItem(product: string): void {
  const cat = PRODUCT_CATALOG[product];
  if (!cat) return;
  trackEvent("view_item", {
    currency: "CHF",
    items: [{ item_id: product, item_name: cat.item_name, item_category: cat.item_category }],
  });
}

/*
 * No `trackPageView` here on purpose: GA4 Enhanced Measurement ("Page changes
 * based on browser history events") already sends one page_view per SPA route
 * change. A manual page_view would double-count. Verified in production.
 */

export function trackAddToCart(item: CartItem): void {
  const ga = cartItemToGA4Item(item);
  trackEvent("add_to_cart", {
    currency: "CHF",
    value: round2((ga.price || 0) * (ga.quantity || 1)),
    items: [ga],
  });
}

export function trackRemoveFromCart(item: CartItem): void {
  const ga = cartItemToGA4Item(item);
  trackEvent("remove_from_cart", {
    currency: "CHF",
    value: round2((ga.price || 0) * (ga.quantity || 1)),
    items: [ga],
  });
}

/* ------------------------------------------------------------------ */
/* purchase — fired once per real, confirmed transaction              */
/* ------------------------------------------------------------------ */

const PURCHASE_SENT_KEY = "ga4_purchase_sent";
const purchaseSnapshotKey = (transactionId: string) => `ga4_purchase_${transactionId}`;

export type PurchaseSnapshot = {
  transaction_id: string;
  currency: "CHF";
  value: number;
  shipping: number;
  items: GA4Item[];
};

/**
 * Called from Checkout right before the customer is handed to the payment
 * provider. Persists the real order figures so `purchase` can be sent with
 * accurate data once — and only if — the payment is later confirmed, even
 * though the cart is cleared in the meantime.
 */
export function stashPurchaseSnapshot(snapshot: PurchaseSnapshot): void {
  try {
    pruneStaleSnapshots();
    localStorage.setItem(
      purchaseSnapshotKey(snapshot.transaction_id),
      JSON.stringify({ ...snapshot, _ts: Date.now() }),
    );
  } catch {
    /* private mode / quota — purchase just won't be reported for this order */
  }
}

// Drop snapshots for orders that were started but never confirmed (payment
// abandoned/declined) after ~14 days, so localStorage can't accumulate.
function pruneStaleSnapshots(): void {
  const MAX_AGE = 14 * 24 * 60 * 60 * 1000;
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith("ga4_purchase_") || key === PURCHASE_SENT_KEY) continue;
      try {
        const parsed = JSON.parse(localStorage.getItem(key) || "{}");
        if (!parsed._ts || Date.now() - parsed._ts > MAX_AGE) localStorage.removeItem(key);
      } catch {
        localStorage.removeItem(key);
      }
    }
  } catch {
    /* ignore */
  }
}

function purchaseAlreadySent(transactionId: string): boolean {
  try {
    const sent: string[] = JSON.parse(localStorage.getItem(PURCHASE_SENT_KEY) || "[]");
    return Array.isArray(sent) && sent.includes(transactionId);
  } catch {
    return false;
  }
}

function markPurchaseSent(transactionId: string): void {
  try {
    let sent: string[] = JSON.parse(localStorage.getItem(PURCHASE_SENT_KEY) || "[]");
    if (!Array.isArray(sent)) sent = [];
    sent.push(transactionId);
    // Keep the ledger bounded — only recent transactions can realistically
    // be re-confirmed by a poll/refresh.
    localStorage.setItem(PURCHASE_SENT_KEY, JSON.stringify(sent.slice(-50)));
    localStorage.removeItem(purchaseSnapshotKey(transactionId));
  } catch {
    /* ignore */
  }
}

/**
 * Fire `purchase` for a transaction that the backend has confirmed as a
 * real, successful payment. Idempotent: at most one `purchase` per
 * transaction_id per browser, regardless of how many times the confirmation
 * poll returns `confirmed: true`, page refreshes, or the success page is
 * revisited. No-op if there is no stashed snapshot (nothing reliable to
 * report) or if Analytics consent is not granted.
 */
export function firePurchaseOnce(transactionId: string): void {
  if (!transactionId || purchaseAlreadySent(transactionId)) return;

  let snapshot: PurchaseSnapshot | null = null;
  try {
    const raw = localStorage.getItem(purchaseSnapshotKey(transactionId));
    snapshot = raw ? (JSON.parse(raw) as PurchaseSnapshot) : null;
  } catch {
    snapshot = null;
  }
  if (!snapshot || !snapshot.items?.length) return;

  const dispatched = trackEvent("purchase", {
    transaction_id: snapshot.transaction_id,
    currency: snapshot.currency,
    value: snapshot.value,
    shipping: snapshot.shipping,
    items: snapshot.items,
  });

  // Only burn the snapshot once the event actually went out. If consent
  // isn't granted (or gtag hasn't finished loading yet), leave it for the
  // next confirmation poll / page visit — still capped at one send by the
  // ledger check above.
  if (dispatched) markPurchaseSent(transactionId);
}
