import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

// Server-side connection to the PostFinance Checkout (ex-Wallee) API.
// This function only creates a transaction and returns the hosted payment
// page URL — it does not capture/void anything and is not yet called by
// any frontend code. Capture/void ("approve"/"reject") logic stays in
// manage-order, migrated separately.
//
// Auth scheme and request/response shapes verified against the current
// official TypeScript SDK source (github.com/pfpayments/typescript-sdk,
// src/auth/HttpBearerAuth.ts and src/models/TransactionCreate.ts): a JWT,
// signed HS256 with the base64-decoded Application Key, sent as
// "Authorization: Bearer <jwt>". The JWT payload binds the token to the
// exact request path + method, so it can't be replayed against another
// endpoint. The Space ID goes in a separate "space" header. The JSON body
// itself uses camelCase field names (completionBehavior, lineItems, ...),
// not the snake_case used internally by the PHP SDK's property names.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const POSTFINANCE_API_HOST = "https://checkout.postfinance.ch/api/v2.0";

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

interface PostFinanceCredentials {
  spaceId: string;
  userId: string;
  authenticationKey: string;
}

function getCredentials(): PostFinanceCredentials {
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
async function pfFetch(
  credentials: PostFinanceCredentials,
  path: string,
  method: "GET" | "POST",
  body?: unknown,
): Promise<unknown> {
  const authHeader = await buildAuthHeader(credentials.userId, credentials.authenticationKey, path, method);

  const resp = await fetch(`${POSTFINANCE_API_HOST}${path}`, {
    method,
    headers: {
      "Authorization": authHeader,
      "space": credentials.spaceId,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
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

interface CartItem {
  sizeName: string;
  shapeName: string;
  flavorName: string;
  styleName?: string;
  extrasNames: string[];
  total: number;
}

interface TransactionRequest {
  items: CartItem[];
  customerEmail: string;
  customerName: string;
  customerPhone: string;
  deliveryOption: string;
  deliveryAddress?: string;
  deliveryFee: number;
  totalAmount: number;
  orderId: string;
  lang?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const credentials = getCredentials();

    const body: TransactionRequest = await req.json();
    const {
      items, customerEmail, customerName, customerPhone,
      deliveryOption, deliveryAddress, deliveryFee, totalAmount, orderId, lang,
    } = body;

    if (!items || items.length === 0) throw new Error("No items in cart");
    if (!customerEmail) throw new Error("Customer email is required");
    if (!orderId) throw new Error("orderId is required");

    const lineItems = items.map((item, i) => {
      const description = [item.flavorName, item.styleName, item.extrasNames?.length ? `Extras: ${item.extrasNames.join(", ")}` : null]
        .filter(Boolean)
        .join(" • ");
      return {
        uniqueId: `item-${i}`,
        name: `${item.sizeName} ${item.shapeName} Cake`.trim(),
        quantity: 1,
        amountIncludingTax: item.total,
        type: "PRODUCT",
        attributes: description ? { description: { label: "Details", value: description } } : undefined,
      };
    });

    if (deliveryOption === "delivery" && deliveryFee > 0) {
      lineItems.push({
        uniqueId: "delivery-fee",
        name: "Delivery Fee",
        quantity: 1,
        amountIncludingTax: deliveryFee,
        type: "SHIPPING",
      });
    }

    const lineItemsSum = lineItems.reduce((sum, li) => sum + li.amountIncludingTax * li.quantity, 0);
    if (Math.abs(lineItemsSum - totalAmount) > 0.01) {
      console.warn(`Line items sum (${lineItemsSum}) does not match totalAmount (${totalAmount}) for order ${orderId}`);
    }

    const origin = req.headers.get("origin") || "";

    // completionBehavior: COMPLETE_DEFERRED keeps the transaction as an
    // authorization only — funds are captured later via the Completion API
    // (built as part of the manage-order migration, not here).
    // environmentSelectionStrategy is deliberately omitted: it defaults to
    // USE_CONFIGURATION, which lets the Space itself (a dedicated Test
    // Space) determine test vs. production — exactly what we want here.
    const transactionCreate = {
      currency: "CHF",
      language: lang === "en" ? "en-US" : "fr-CH",
      customerEmailAddress: customerEmail,
      merchantReference: orderId,
      successUrl: `${origin}/payment-success?order_id=${orderId}`,
      failedUrl: `${origin}/checkout`,
      completionBehavior: "COMPLETE_DEFERRED",
      lineItems,
      metaData: {
        order_id: orderId,
        customer_name: customerName,
        customer_phone: customerPhone,
        delivery_option: deliveryOption,
        delivery_address: deliveryAddress || "",
      },
    };

    const transaction = await pfFetch(credentials, "/payment/transactions", "POST", transactionCreate) as { id: number };
    console.log("PostFinance transaction created:", transaction.id, "for order", orderId);

    // Plain "payment-page-url" (not the "charge-flow/payment-page-url"
    // variant): the simpler, general-purpose endpoint for a straightforward
    // hosted-page integration like ours.
    const paymentPageUrl = await pfFetch(
      credentials,
      `/payment/transactions/${transaction.id}/payment-page-url`,
      "GET",
    ) as string;

    return new Response(JSON.stringify({
      transactionId: transaction.id,
      paymentPageUrl,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Error creating PostFinance transaction:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
