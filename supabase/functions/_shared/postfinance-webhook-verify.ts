// PostFinance Checkout / Wallee webhook authentication.
//
// TWO independent layers — the webhook function decides which to enforce:
//
//  1. Shared secret in the URL: the Webhook URL is registered in PostFinance
//     as
//       https://<PROJECT_ID>.supabase.co/functions/v1/postfinance-webhook?s=<secret>
//     (this project: https://ekciarsrdyismyevgkqg.supabase.co/functions/v1/postfinance-webhook?s=<secret>)
//     and POSTFINANCE_WEBHOOK_SECRET holds the same <secret>. Constant-time
//     compared. This is the mandatory gate.
//
//  2. Payload signature (optional hardening, enable with
//     POSTFINANCE_WEBHOOK_ENFORCE_SIGNATURE=true): when the Webhook Listener
//     has "Enable Payload Signature and State" ticked, PostFinance adds
//       x-signature: algorithm=SHA256withECDSA, keyId=<uuid>, signature=<b64>
//     ECDSA P-256 / SHA-256, DER-encoded signature, public key fetched from
//       GET /webhooks/encryption-keys/{keyId}
//
// ⚠️ The signature path below is implemented from the documented format but
// has NOT been checked against a real PostFinance delivery. Keep
// POSTFINANCE_WEBHOOK_ENFORCE_SIGNATURE unset until verified end-to-end;
// layer 1 (the URL secret over HTTPS) is the real gate in the meantime.

import { type PostFinanceCredentials, pfFetch } from "./postfinance.ts";

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function verifyWebhookSecret(reqUrl: string, expected: string | undefined): boolean {
  if (!expected) return false;
  let provided: string | null = null;
  try {
    provided = new URL(reqUrl).searchParams.get("s");
  } catch {
    return false;
  }
  return !!provided && constantTimeEqual(provided, expected);
}

interface ParsedSignatureHeader {
  algorithm: string;
  keyId: string;
  signature: string;
}

function parseSignatureHeader(header: string | null): ParsedSignatureHeader | null {
  if (!header) return null;
  const parts: Record<string, string> = {};
  for (const seg of header.split(",")) {
    const idx = seg.indexOf("=");
    if (idx === -1) continue;
    const k = seg.slice(0, idx).trim();
    const v = seg.slice(idx + 1).trim();
    if (k) parts[k] = v;
  }
  if (!parts.keyId || !parts.signature) return null;
  return {
    algorithm: parts.algorithm || "SHA256withECDSA",
    keyId: parts.keyId,
    signature: parts.signature,
  };
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// DER (X9.62) ECDSA signature -> raw r||s (IEEE P1363), 32-byte fields for P-256.
function derToP1363(der: Uint8Array, fieldLen = 32): Uint8Array | null {
  try {
    if (der[0] !== 0x30) return null;
    let offset = 2;
    if (der[1] & 0x80) offset = 2 + (der[1] & 0x7f); // long-form length
    if (der[offset] !== 0x02) return null;
    const rLen = der[offset + 1];
    let r = der.slice(offset + 2, offset + 2 + rLen);
    offset = offset + 2 + rLen;
    if (der[offset] !== 0x02) return null;
    const sLen = der[offset + 1];
    let s = der.slice(offset + 2, offset + 2 + sLen);

    const trimLeft = (b: Uint8Array) => {
      let i = 0;
      while (i < b.length - 1 && b[i] === 0x00) i++;
      return b.slice(i);
    };
    const padLeft = (b: Uint8Array) => {
      if (b.length > fieldLen) return null;
      const out = new Uint8Array(fieldLen);
      out.set(b, fieldLen - b.length);
      return out;
    };
    const rp = padLeft(trimLeft(r));
    const sp = padLeft(trimLeft(s));
    if (!rp || !sp) return null;
    const out = new Uint8Array(fieldLen * 2);
    out.set(rp, 0);
    out.set(sp, fieldLen);
    return out;
  } catch {
    return null;
  }
}

function pemBodyToDer(key: string): Uint8Array {
  const body = key
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  return b64ToBytes(body);
}

// Returns:
//   true  — signature present and valid
//   false — signature present and INVALID
//   null  — no signature header (caller decides whether that is acceptable)
export async function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  credentials: PostFinanceCredentials,
): Promise<boolean | null> {
  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed) return null;

  try {
    const keyResp = await pfFetch(
      credentials,
      `/webhooks/encryption-keys/${parsed.keyId}`,
      "GET",
    ) as { publicKey?: string; public_key?: string };
    const pub = keyResp.publicKey ?? keyResp.public_key;
    if (!pub) {
      console.error("verifyWebhookSignature: no publicKey in encryption-keys response");
      return false;
    }

    const der = pub.includes("-----BEGIN") ? pemBodyToDer(pub) : b64ToBytes(pub);
    const cryptoKey = await crypto.subtle.importKey(
      "spki",
      der,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );

    const sigBytes = b64ToBytes(parsed.signature);
    const p1363 = sigBytes[0] === 0x30 ? derToP1363(sigBytes) : sigBytes;
    if (!p1363) {
      console.error("verifyWebhookSignature: could not normalise signature bytes");
      return false;
    }

    return await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      cryptoKey,
      p1363,
      new TextEncoder().encode(rawBody),
    );
  } catch (e) {
    console.error("verifyWebhookSignature threw:", e);
    return false;
  }
}
