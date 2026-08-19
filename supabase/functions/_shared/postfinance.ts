// Shared PostFinance Checkout API client, used by both
// create-postfinance-payment and confirm-postfinance-payment.
//
// Auth scheme verified against the official TypeScript SDK source
// (github.com/pfpayments/typescript-sdk, src/auth/HttpBearerAuth.ts): a
// JWT, signed HS256 with the base64-decoded Application Key, sent as
// "Authorization: Bearer <jwt>". The JWT payload binds the token to the
// exact request path + method. The Space ID goes in a separate "space"
// header. Content-Type is only sent on requests with a JSON body (POST),
// never on bodyless GETs, and no Accept header is sent at all — sending
// either on a bodyless GET triggers a 406 "Unsupported HTTP Request".

export const POSTFINANCE_API_HOST = "https://checkout.postfinance.ch/api/v2.0";

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64Decode(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacSha256(keyBytes: Uint8Array, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return new Uint8Array(signature);
}

// Builds the "Authorization: Bearer <jwt>" header value for one request.
async function buildAuthHeader(
  userId: string,
  authenticationKey: string,
  path: string,
  method: string,
): Promise<string> {
  const header = { alg: "HS256", typ: "JWT", ver: 1 };
  const payload = {
    sub: userId,
    iat: Math.floor(Date.now() / 1000),
    requestPath: `/api/v2.0${path}`,
    requestMethod: method,
  };

  const encodedHeader = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const encodedPayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const keyBytes = base64Decode(authenticationKey);
  const signature = await hmacSha256(keyBytes, signingInput);
  const encodedSignature = base64UrlEncode(signature);

  return `Bearer ${signingInput}.${encodedSignature}`;
}

export interface PostFinanceCredentials {
  spaceId: string;
  userId: string;
  authenticationKey: string;
}

export function getPostFinanceCredentials(): PostFinanceCredentials {
  const spaceId = Deno.env.get("POSTFINANCE_SPACE_ID");
  const userId = Deno.env.get("POSTFINANCE_USER_ID");
  const authenticationKey = Deno.env.get("POSTFINANCE_AUTHENTICATION_KEY");

  if (!spaceId || !userId || !authenticationKey) {
    throw new Error(
      "PostFinance credentials are not configured (POSTFINANCE_SPACE_ID / POSTFINANCE_USER_ID / POSTFINANCE_AUTHENTICATION_KEY)",
    );
  }
  return { spaceId, userId, authenticationKey };
}

// Authenticated request against the PostFinance Checkout API.
export async function pfFetch(
  credentials: PostFinanceCredentials,
  path: string,
  method: "GET" | "POST",
  body?: unknown,
): Promise<unknown> {
  const authHeader = await buildAuthHeader(credentials.userId, credentials.authenticationKey, path, method);

  const headers: Record<string, string> = {
    "Authorization": authHeader,
    "space": credentials.spaceId,
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const resp = await fetch(`${POSTFINANCE_API_HOST}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const raw = await resp.text();
  let data: unknown = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }

  if (!resp.ok) {
    console.error(`PostFinance API error on ${method} ${path}:`, resp.status, data);
    throw new Error(`PostFinance API error (${resp.status}): ${typeof data === "string" ? data : JSON.stringify(data)}`);
  }
  return data;
}
