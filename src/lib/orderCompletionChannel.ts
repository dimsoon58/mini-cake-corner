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
//
// 2026-09-19: both of the above are LIVE mechanisms — they only ever reach
// a tab that is actively listening at the exact instant the other tab
// broadcasts. A backgrounded mobile tab is routinely SUSPENDED by the OS
// (its JS paused entirely to save memory/battery) for as long as
// PostFinance's payment page is open in the other tab; if the broadcast
// happens while suspended, the live event is missed for good — browsers do
// not replay a "storage" event or a BroadcastChannel message to a tab that
// resumes later. The persisted marker this file already writes to
// localStorage (FALLBACK_STORAGE_KEY, below — always written, never
// deleted here) survives that suspension untouched, so onOrderCompleted now
// ALSO actively re-reads it whenever a subscribing tab becomes active again
// (mount, visibilitychange, focus, pageshow) — catching up a tab that
// missed every live event entirely, using only what was already being
// written to localStorage. No new network call, nothing server-side
// touched.

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

// A marker older than this is treated as if it didn't exist at all — never
// acted on, by any of the three paths below. Not a correctness requirement
// at all: the orderId match against this tab's own getStoredOrderId() is
// already what makes acting on a wrong/unrelated marker impossible
// (sessionStorage is per-tab, and checkoutOrderId.ts only ever reuses an
// orderId for a retry of the SAME still-open attempt, never a fresh
// checkout) — a customer coming back to the original tab must never find
// their cart still full just because more time has passed than some
// arbitrary window, however long they were away. This is pure, long-horizon
// storage hygiene for a marker nothing ever consumed (e.g. the tab that
// should have closed instead) — 7 days, deliberately far longer than any
// realistic "customer returns to check their cart" gap.
const MAX_MARKER_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// Re-reads whatever order-completion marker is currently sitting in
// localStorage (written by broadcastOrderCompleted, never deleted by it) —
// independent of the live "storage" event, which never fires for a tab that
// wasn't listening at the exact instant of the write. Returns null when
// there is none, it's malformed, or it's older than MAX_MARKER_AGE_MS.
function readPersistedCompletion(): OrderCompletedMessage | null {
  try {
    const raw = localStorage.getItem(FALLBACK_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OrderCompletedMessage & { at?: number };
    if (parsed?.type !== "order_completed" || !parsed.orderId) return null;
    if (typeof parsed.at === "number" && Date.now() - parsed.at > MAX_MARKER_AGE_MS) return null;
    return { type: "order_completed", orderId: parsed.orderId };
  } catch {
    return null;
  }
}

// Removes the persisted marker. Called ONLY after `handler` reports (by
// returning true — see onOrderCompleted below) that it actually matched and
// acted on this exact orderId — from EVERY path that can reach `handler`
// (the live BroadcastChannel message, the live "storage" event, and the
// active re-read on visibility/focus/pageshow/mount), so a marker a tab has
// already matched and acted on is never left sitting around indefinitely,
// however it was received. Never removed just because a tab read it and
// found no match — a different tab may still be waiting for that exact
// marker.
function consumePersistedCompletion(): void {
  try { localStorage.removeItem(FALLBACK_STORAGE_KEY); } catch { /* ignore */ }
}

// Returns an unsubscribe function — call it from a useEffect cleanup.
// `handler` may return `true` to report "this orderId was a real match for
// me, I acted on it" — only then is the persisted marker (see above)
// consumed; a void/false return leaves it untouched for whichever tab it's
// actually meant for.
export function onOrderCompleted(handler: (orderId: string) => void | boolean): () => void {
  const unsubscribers: Array<() => void> = [];

  // Shared by all three delivery paths below: calls `handler`, and consumes
  // the persisted marker if (and only if) it reports a real match — a
  // marker this tab has already acted on must never remain forever just
  // because it happened to arrive via the fast BroadcastChannel/storage
  // path rather than the visibility-triggered catch-up read.
  const react = (orderId: string) => {
    const handled = handler(orderId);
    if (handled === true) consumePersistedCompletion();
  };

  try {
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(CHANNEL_NAME);
      const onMessage = (event: MessageEvent<OrderCompletedMessage>) => {
        if (event.data?.type === "order_completed" && event.data.orderId) {
          react(event.data.orderId);
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
        react(parsed.orderId);
      }
    } catch {
      /* ignore a malformed stored value */
    }
  };
  window.addEventListener("storage", onStorage);
  unsubscribers.push(() => window.removeEventListener("storage", onStorage));

  // Catch-up path: re-read the persisted marker directly whenever this tab
  // becomes active again — covers a tab that was suspended (and so missed
  // the live "storage" event above entirely) while the other tab completed
  // the order. Also checked once immediately on subscribe, so a tab that's
  // already active (or gets fully reloaded rather than merely resumed) by
  // the time it mounts doesn't need to wait for one of these events either.
  const checkPersisted = () => {
    const found = readPersistedCompletion();
    if (!found) return;
    react(found.orderId);
  };
  checkPersisted();
  const onVisibilityChange = () => { if (document.visibilityState === "visible") checkPersisted(); };
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("focus", checkPersisted);
  window.addEventListener("pageshow", checkPersisted);
  unsubscribers.push(() => {
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("focus", checkPersisted);
    window.removeEventListener("pageshow", checkPersisted);
  });

  return () => { unsubscribers.forEach((unsub) => unsub()); };
}
