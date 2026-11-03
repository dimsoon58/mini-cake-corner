import { useEffect, useLayoutEffect, useRef } from "react";
import { useNavigationType } from "react-router-dom";

// Admin lists (Aujourd'hui, Commandes): coming back from an order with the
// browser's or the page's « Retour » button puts the list back where it was.
// The scroll position is kept per list in sessionStorage and restored once the
// list has loaded — only on a back/forward visit, never when the list is
// opened fresh from the menu.
export function useScrollMemory(key: string, ready: boolean) {
  const navigationType = useNavigationType();
  const storageKey = `admin-scroll:${key}`;

  // Layout effect: the listener is removed while the list is unmounted, before
  // the order page resets the scroll, so that reset is never saved.
  useLayoutEffect(() => {
    const save = () => {
      try { sessionStorage.setItem(storageKey, String(window.scrollY)); } catch { /* storage unavailable */ }
    };
    window.addEventListener("scroll", save, { passive: true });
    return () => window.removeEventListener("scroll", save);
  }, [storageKey]);

  const restored = useRef(false);
  useEffect(() => {
    if (!ready || restored.current) return;
    restored.current = true;
    if (navigationType !== "POP") return;
    let y = 0;
    try { y = Number(sessionStorage.getItem(storageKey) || 0); } catch { /* storage unavailable */ }
    if (y > 0) requestAnimationFrame(() => window.scrollTo(0, y));
  }, [ready, navigationType, storageKey]);
}
