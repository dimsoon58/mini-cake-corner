// Cross-tab notification: "this exact orderId's checkout is now genuinely
// finalised" (a real order was created server-side — PaymentSuccess.tsx's
// phase === "confirmed"). Fired ONLY from that single, already-existing
// place the cart is cleared after a real, server-confirmed success — never
// on a mere "Proceed to Payment" click, never speculatively, and never from
// anywhere else. Every other open tab (most commonly the original Checkout
// tab, left behind once PostFinance's payment page opens in a NEW tab —
// EmbeddedCheckout.tsx's link is target="_blank") can subscribe and, ONLY
// if ITS OWN current checkout attempt is this exact orderId, react — never
// a different, unrelated cart/attempt open in parallel.
//
// BroadcastChannel first (same-browser, same-origin, every tab) — well
// supported everywhere this site runs. A localStorage "storage" event
// fallback covers the rare case BroadcastChannel itself is unavailable
// (very old browsers / some locked-down webviews). Per spec, NEITHER
// mechanism ever fires back in the tab that sent the message — only other
// tabs receive it — so no self-notification guard is needed anywhere.

const CHANNEL_NAME = "bento-order-completion";
const FALLBACK_STORAGE_KEY = "bento_order_completed_broadcast";

interface OrderCompletedMessage {
  type: "order_completed";
  orderId: string;
}

export function broadcastOrderCompleted(orderId: string): void {
  if (!orderId) return;
  const message: OrderCompletedMessage = { type: "order_completed", orderId };

  try {
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(CHANNEL_NAME);
      channel.postMessage(message);
      channel.close();
    }
  } catch {
    /* ignore — the storage fallback below still fires regardless */
  }

  // Always ALSO write the storage fallback (cheap, harmless even when
  // BroadcastChannel worked) — a tab whose own listener could only use the
  // "storage" event (BroadcastChannel unavailable there) would otherwise
  // never hear about it. `at` makes the same orderId completing twice
  // (a retry / a duplicate call) still change the stored value, so a
  // "storage" event reliably fires again even for a repeat.
  try {
    localStorage.setItem(FALLBACK_STORAGE_KEY, JSON.stringify({ ...message, at: Date.now() }));
  } catch {
    /* ignore */
  }
}

// Returns an unsubscribe function — call it from a useEffect cleanup.
export function onOrderCompleted(handler: (orderId: string) => void): () => void {
  const unsubscribers: Array<() => void> = [];

  try {
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(CHANNEL_NAME);
      const onMessage = (event: MessageEvent<OrderCompletedMessage>) => {
        if (event.data?.type === "order_completed" && event.data.orderId) {
          handler(event.data.orderId);
        }
      };
      channel.addEventListener("message", onMessage);
      unsubscribers.push(() => {
        channel.removeEventListener("message", onMessage);
        channel.close();
      });
    }
  } catch {
    /* ignore — the storage fallback below still works on its own */
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key !== FALLBACK_STORAGE_KEY || !event.newValue) return;
    try {
      const parsed = JSON.parse(event.newValue) as OrderCompletedMessage;
      if (parsed?.type === "order_completed" && parsed.orderId) {
        handler(parsed.orderId);
      }
    } catch {
      /* ignore a malformed stored value */
    }
  };
  window.addEventListener("storage", onStorage);
  unsubscribers.push(() => window.removeEventListener("storage", onStorage));

  return () => { unsubscribers.forEach((unsub) => unsub()); };
}
