// Photos of cart items (image to print + inspiration photos), kept in the
// customer's browser (IndexedDB) so they survive a page reload, a tab the
// phone closed in the background, or coming back to pay later.
//
// localStorage can't hold File objects (and is far too small for photos),
// so the cart itself stays in localStorage (CartContext.tsx) and only the
// files live here, keyed by cart item id. Photos are still uploaded to
// Supabase only at checkout, exactly as before (30.10.2026).
//
// Every call is best effort: private browsing, blocked storage or an old
// browser simply means the photos aren't kept — never an error for the
// customer. Checkout then catches the missing photos (imageFileCount).

const DB_NAME = "cake-cart-photos";
const STORE = "items";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = run(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Every stored item's photos, by cart item id. Empty when unavailable. */
export async function loadCartPhotos(): Promise<Record<string, File[]>> {
  try {
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const out: Record<string, File[]> = {};
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) return;
          if (Array.isArray(cursor.value)) out[String(cursor.key)] = cursor.value as File[];
          cursor.continue();
        };
        tx.oncomplete = () => resolve(out);
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch (e) {
    console.warn("Cart photos could not be read:", e);
    return {};
  }
}

/** Replaces one item's photos ([] removes them). */
export async function saveCartPhotos(itemId: string, files: File[]): Promise<void> {
  try {
    await withStore("readwrite", (store) => (files.length ? store.put(files, itemId) : store.delete(itemId)));
  } catch (e) {
    console.warn("Cart photos could not be saved:", e);
  }
}

/** Removes the photos of every item not in keepIds (removed or paid items). */
export async function pruneCartPhotos(keepIds: string[]): Promise<void> {
  try {
    const keys = await withStore("readonly", (store) => store.getAllKeys());
    const keep = new Set(keepIds);
    for (const key of keys) {
      if (!keep.has(String(key))) await withStore("readwrite", (store) => store.delete(key));
    }
  } catch (e) {
    console.warn("Cart photos could not be cleaned up:", e);
  }
}
