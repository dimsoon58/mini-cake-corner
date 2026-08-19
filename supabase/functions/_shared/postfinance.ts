/**
 * Client PostFinance Checkout pour les fonctions Supabase (Deno).
 *
 * Authentification officielle : un JSON Web Token signe en HS256, envoye dans
 * l'en-tete Authorization. La cle d'authentification fournie par PostFinance
 * est encodee en base64 et doit etre decodee avant de servir de secret.
 * Voir https://checkout.postfinance.ch/en-us/doc/api/web-service
 *
 * Les identifiants ne sont jamais ecrits ici : ils viennent des secrets
 * Supabase POSTFINANCE_SPACE_ID, POSTFINANCE_USER_ID et
 * POSTFINANCE_AUTHENTICATION_KEY.
 */

const HOST = "https://checkout.postfinance.ch";

export function pfConfig() {
  const spaceId = Deno.env.get("POSTFINANCE_SPACE_ID");
  const userId = Deno.env.get("POSTFINANCE_USER_ID");
  const authKey = Deno.env.get("POSTFINANCE_AUTHENTICATION_KEY");

  const missing = [
    !spaceId && "POSTFINANCE_SPACE_ID",
    !userId && "POSTFINANCE_USER_ID",
    !authKey && "POSTFINANCE_AUTHENTICATION_KEY",
  ].filter(Boolean);

  if (missing.length) {
    throw new Error(
      `Secrets PostFinance manquants : ${missing.join(", ")}. ` +
        `A ajouter dans Supabase > Project Settings > Edge Functions > Secrets.`,
    );
  }

  return { spaceId: spaceId!, userId: userId!, authKey: authKey! };
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlText(text: string): string {
  return b64url(new TextEncoder().encode(text));
}

/** Decode la cle base64 fournie par PostFinance en octets bruts. */
function decodeKey(authKey: string): Uint8Array {
  const raw = atob(authKey.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Construit le JWT pour une requete donnee. Le chemin doit inclure la
 * query string exactement telle qu'elle sera envoyee.
 */
async function buildJwt(requestPath: string, requestMethod: string): Promise<string> {
  const { userId, authKey } = pfConfig();

  const header = { alg: "HS256", typ: "JWT", ver: 1 };
  const payload = {
    sub: String(userId),
    iat: Math.floor(Date.now() / 1000),
    requestPath,
    requestMethod: requestMethod.toUpperCase(),
  };

  const signingInput = `${b64urlText(JSON.stringify(header))}.${b64urlText(JSON.stringify(payload))}`;

  const key = await crypto.subtle.importKey(
    "raw",
    decodeKey(authKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput)),
  );

  return `${signingInput}.${b64url(sig)}`;
}

export interface PfResponse<T = unknown> {
  ok: boolean;
  status: number;
  body: T;
  raw: string;
}

/**
 * Appelle l'API PostFinance. `path` commence par "/" et ne contient pas le
 * spaceId : il est ajoute automatiquement en query string.
 */
export async function pfRequest<T = unknown>(
  path: string,
  method: "GET" | "POST" = "GET",
  body?: unknown,
  extraQuery: Record<string, string> = {},
): Promise<PfResponse<T>> {
  const { spaceId } = pfConfig();

  const qs = new URLSearchParams({ spaceId, ...extraQuery });
  const requestPath = `${path}?${qs.toString()}`;
  const jwt = await buildJwt(requestPath, method);

  const res = await fetch(`${HOST}${requestPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json;charset=utf-8",
      Accept: "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const raw = await res.text();
  let parsed: unknown = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = raw;
  }

  if (!res.ok) {
    console.error("PostFinance", method, requestPath, "->", res.status, raw.slice(0, 800));
  }

  return { ok: res.ok, status: res.status, body: parsed as T, raw };
}

/* ------------------------------------------------------------------ */
/* Operations utilisees par le site                                     */
/* ------------------------------------------------------------------ */

export const PF = {
  createTransaction: (tx: unknown) => pfRequest("/api/transaction/create", "POST", tx),

  readTransaction: (id: string | number) =>
    pfRequest("/api/transaction/read", "GET", undefined, { id: String(id) }),

  paymentPageUrl: (id: string | number) =>
    pfRequest<string>("/api/transaction-payment-page/payment-page-url", "GET", undefined, {
      id: String(id),
    }),

  /** Encaisse une transaction autorisee. */
  complete: (id: string | number) =>
    pfRequest("/api/transaction-completion/completeOnline", "POST", undefined, {
      id: String(id),
    }),

  /** Libere une autorisation non encaissee. */
  void: (id: string | number) =>
    pfRequest("/api/transaction-void/voidOnline", "POST", undefined, { id: String(id) }),

  /** Rembourse une transaction deja encaissee. */
  refund: (transactionId: string | number, amount: number, reference: string) =>
    pfRequest("/api/refund/refund", "POST", {
      transaction: Number(transactionId),
      amount,
      externalId: reference,
      merchantReference: reference,
      type: "MERCHANT_INITIATED_ONLINE",
    }),
};

/** Etats PostFinance -> statut de paiement stocke dans Supabase. */
export function mapPaymentStatus(state: string | undefined): string | null {
  switch ((state || "").toUpperCase()) {
    case "AUTHORIZED":
      return "authorized";
    case "COMPLETED":
    case "FULFILL":
      return "paid";
    case "DECLINE":
    case "FAILED":
      return "failed";
    case "VOIDED":
      return "voided";
    default:
      return null; // CREATE / PENDING / CONFIRMED / PROCESSING : on n'ecrit rien
  }
}
