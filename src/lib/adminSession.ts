import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// Admin > PIN demandé une seule fois par session (F16).
//
// La connexion reste celle du site (Supabase Auth, email). Après connexion,
// le PIN est vérifié une fois par la fonction admin-pin, qui renvoie une
// autorisation (jeton aléatoire + expiration). Le PIN n'est jamais gardé :
// seul ce jeton l'est, dans le navigateur, lié au compte connecté ; le
// serveur n'en garde que l'empreinte, liée à l'email ET à la session de
// connexion. Le jeton est joint (champ _adminSession) aux appels des
// fonctions admin ; chaque fonction revérifie la connexion admin ET le jeton.
// Déconnexion, nouvelle connexion ou expiration → PIN redemandé.

const KEY = "bento_admin_pin_session";

/** Placeholder sent as `pin` once the session is unlocked: the server accepts
 *  the action thanks to the session token, never thanks to this value. */
export const SESSION_PIN = "__session__";

// Fonctions du dashboard admin (et seulement elles) reçoivent le jeton.
const ADMIN_FUNCTIONS = new Set([
  "admin-pin", "cancel-order", "cancel-order-item", "cancel-workshop-seats", "finance-month", "get-order-detail", "get-orders-for-labels", "get-production", "get-today",
  "list-manual-orders", "list-orders", "list-orders-by-date", "manage-customers", "manage-expenses",
  "manage-manual-order", "manage-order", "manage-partners", "manage-refunds", "quote-manual-order",
  "staff-access", "team-planning", "update-production-status", "update-production-stock",
]);

type Stored = { userId: string; token: string; expiresAt: string };
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function read(): Stored | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Stored;
    if (!s?.token || !s?.expiresAt || Date.parse(s.expiresAt) <= Date.now()) return null;
    return s;
  } catch {
    return null;
  }
}

/** Jeton valide pour ce compte (sinon null). */
export function getAdminSession(userId?: string | null): Stored | null {
  const s = read();
  return s && (!userId || s.userId === userId) ? s : null;
}

export function setAdminSession(userId: string, token: string, expiresAt: string) {
  try { window.localStorage.setItem(KEY, JSON.stringify({ userId, token, expiresAt })); } catch { /* stockage indisponible */ }
  notify();
}

export function clearAdminSession() {
  try { window.localStorage.removeItem(KEY); } catch { /* ignore */ }
  notify();
}

/** Révoque côté serveur puis oublie le jeton (déconnexion). */
export async function lockAdminSession() {
  const s = read();
  if (s) {
    try { await supabase.functions.invoke("admin-pin", { body: { action: "lock" } }); } catch { /* best effort */ }
  }
  clearAdminSession();
}

/** true quand une autorisation PIN valide est en cours pour ce compte. */
export function useAdminSessionActive(userId?: string | null): boolean {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    const s = getAdminSession(userId);
    const timer = s ? window.setTimeout(l, Math.max(0, Date.parse(s.expiresAt) - Date.now()) + 500) : undefined;
    return () => { listeners.delete(l); if (timer) window.clearTimeout(timer); };
  });
  return !!getAdminSession(userId);
}

/** État du PIN d'un écran : avec une autorisation de session, plus de
 *  champ PIN — `pin` vaut SESSION_PIN et le serveur s'appuie sur le jeton. */
export function useSessionPin(): [string, (v: string) => void, boolean] {
  const active = useAdminSessionActive();
  const [pin, setPin] = useState("");
  // Espaces au début / à la fin ignorés (remplissage automatique du navigateur).
  return [active ? SESSION_PIN : pin.trim(), setPin, active];
}

// ── Joindre le jeton aux appels des fonctions admin ──────────────────────
// Attention : dans supabase-js, `supabase.functions` est un accesseur qui
// crée un NOUVEAU client à chaque lecture. Modifier `invoke` sur un seul de
// ces clients ne sert à rien (le jeton n'était jamais envoyé → « Invalid
// PIN » et écran PIN redemandé). On enveloppe donc l'accesseur lui-même :
// chaque client renvoyé reçoit l'`invoke` qui joint le jeton.
type Invoke = (name: string, opts?: { body?: unknown; [k: string]: unknown }) => Promise<unknown>;

function withSessionToken(original: Invoke): Invoke {
  return (name, opts) => {
    const s = ADMIN_FUNCTIONS.has(name) ? read() : null;
    if (!s) return original(name, opts);
    const body = opts?.body;
    const plain = body === undefined || (body !== null && typeof body === "object" && Object.getPrototypeOf(body) === Object.prototype);
    if (!plain) return original(name, opts);
    return original(name, { ...(opts ?? {}), body: { ...((body as Record<string, unknown>) ?? {}), _adminSession: s.token } });
  };
}

function wrapClient<T extends { invoke: Invoke }>(client: T): T {
  if ((client as { __adminSession?: boolean }).__adminSession) return client;
  const original = client.invoke.bind(client);
  client.invoke = withSessionToken(original);
  (client as { __adminSession?: boolean }).__adminSession = true;
  return client;
}

let installed = false;
export function installAdminSessionTransport() {
  if (installed) return;
  installed = true;
  // Accesseur `functions` (supabase-js) : trouvé sur la chaîne des prototypes.
  let getter: (() => unknown) | undefined;
  for (let o: object | null = supabase; o && !getter; o = Object.getPrototypeOf(o)) {
    getter = Object.getOwnPropertyDescriptor(o, "functions")?.get;
  }
  if (getter) {
    const get = getter;
    Object.defineProperty(supabase, "functions", {
      configurable: true,
      get() { return wrapClient(get.call(this) as { invoke: Invoke }); },
    });
  } else {
    // Simple objet (tests) : un seul client, modifié une fois.
    wrapClient(supabase.functions as unknown as { invoke: Invoke });
  }
}
