// Shared PostFinance Checkout transaction helpers used by
// create-postfinance-payment (retry / resume), confirm-postfinance-payment
// and postfinance-webhook. All calls go through pfFetch (JWT-HMAC auth,
// REWARD_ONLY shim) — see _shared/postfinance.ts.

import { type PostFinanceCredentials, pfFetch } from "./postfinance.ts";

// PostFinance Checkout / Wallee transaction states.
//   success  : the payment is (at least) authorised — an order may be created.
//   failure  : terminal negative — cleanup + a new attempt is allowed.
//   in_progress: everything else, INCLUDING any state we don't recognise —
//                keep the same orderId, never create a second transaction.
export const TX_SUCCESS_STATES = new Set(["AUTHORIZED", "COMPLETED", "FULFILL"]);
export const TX_FAILURE_STATES = new Set(["FAILED", "DECLINE", "VOIDED"]);

export type TxClass = "success" | "failure" | "in_progress";

export function classifyTxState(state: string | null | undefined): TxClass {
  const s = String(state ?? "").toUpperCase();
  if (TX_SUCCESS_STATES.has(s)) return "success";
  if (TX_FAILURE_STATES.has(s)) return "failure";
  // CREATE / PENDING / CONFIRMED / PROCESSING / unknown → not terminal.
  return "in_progress";
}

export async function getTransactionState(
  credentials: PostFinanceCredentials,
  transactionId: string | number,
): Promise<string | null> {
  try {
    const tx = await pfFetch(
      credentials,
      `/payment/transactions/${transactionId}`,
      "GET",
    ) as { state?: string };
    return tx?.state ?? null;
  } catch (e) {
    console.error(`getTransactionState(${transactionId}) failed:`, e);
    return null;
  }
}

export async function getPaymentPageUrl(
  credentials: PostFinanceCredentials,
  transactionId: string | number,
): Promise<string> {
  return await pfFetch(
    credentials,
    `/payment/transactions/${transactionId}/payment-page-url`,
    "GET",
  ) as string;
}

// ── Prove whether a PostFinance transaction exists for a given merchantReference
//
// Returns:
//   { conclusive: true,  transaction: {...} } — found it.
//   { conclusive: true,  transaction: null }  — PROVEN that none exists.
//   { conclusive: false, transaction: null }  — could NOT prove it either way
//                                               (API error / unverified query
//                                               syntax / window too small).
//
// The caller MUST treat `conclusive: false` as "keep the same orderId, do not
// create a new transaction" — never as absence.
//
// NOTE (verify before production): the exact filter grammar of the
// `GET /payment/transactions/search?query=` endpoint of the PostFinance
// Checkout v2.0 REST API is not documented publicly. POSTFINANCE_SEARCH_QUERY
// (env) overrides the template below; `{ref}` is replaced with the orderId.
// If the search call fails or returns an unexpected shape we fall back to a
// bounded, paginated walk of the recent transaction list, which needs no
// filter syntax at all.
const DEFAULT_SEARCH_QUERY_TEMPLATE = 'merchantReference:{ref}';
const LIST_PAGE_SIZE = 100;
const LIST_MAX_PAGES = 25; // up to 2500 most-recent transactions

interface FoundTx {
  id: string;
  state: string | null;
  merchantReference: string | null;
  createdOn: string | null;
}

function pickTx(raw: any): FoundTx | null {
  if (!raw || typeof raw !== "object") return null;
  const id = raw.id ?? raw.transactionId ?? null;
  if (id === null || id === undefined) return null;
  return {
    id: String(id),
    state: raw.state ?? null,
    merchantReference: raw.merchantReference ?? raw.merchant_reference ?? null,
    createdOn: raw.createdOn ?? raw.created_on ?? raw.plannedPurgeDate ?? null,
  };
}

function asArray(payload: any): any[] | null {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.result)) return payload.result;
  if (Array.isArray(payload?.data)) return payload.data;
  return null;
}

async function trySearchEndpoint(
  credentials: PostFinanceCredentials,
  orderId: string,
): Promise<{ ok: boolean; matches: FoundTx[] }> {
  const template = Deno.env.get("POSTFINANCE_SEARCH_QUERY") || DEFAULT_SEARCH_QUERY_TEMPLATE;
  const query = template.replace("{ref}", orderId);
  try {
    const payload = await pfFetch(
      credentials,
      `/payment/transactions/search?query=${encodeURIComponent(query)}&limit=50`,
      "GET",
    );
    const arr = asArray(payload);
    if (!arr) return { ok: false, matches: [] };
    const matches = arr
      .map(pickTx)
      .filter((t): t is FoundTx => !!t && t.merchantReference === orderId);
    return { ok: true, matches };
  } catch (e) {
    console.error("trySearchEndpoint failed (will fall back to list walk):", e);
    return { ok: false, matches: [] };
  }
}

async function walkRecentList(
  credentials: PostFinanceCredentials,
  orderId: string,
  notBeforeISO: string | null,
): Promise<{ conclusive: boolean; matches: FoundTx[] }> {
  const matches: FoundTx[] = [];
  let cursor: string | null = null;
  let reachedOldEnough = false;
  const notBefore = notBeforeISO ? Date.parse(notBeforeISO) : NaN;

  for (let page = 0; page < LIST_MAX_PAGES; page++) {
    let payload: any;
    try {
      const q = new URLSearchParams({
        limit: String(LIST_PAGE_SIZE),
        order: "createdOn DESC",
      });
      if (cursor) q.set("after", cursor);
      payload = await pfFetch(credentials, `/payment/transactions?${q.toString()}`, "GET");
    } catch (e) {
      console.error(`walkRecentList page ${page} failed:`, e);
      return { conclusive: false, matches };
    }

    const arr = asArray(payload);
    if (!arr || arr.length === 0) {
      // Ran out of transactions → we have seen them all.
      reachedOldEnough = true;
      break;
    }

    for (const raw of arr) {
      const t = pickTx(raw);
      if (!t) continue;
      if (t.merchantReference === orderId) matches.push(t);
      if (!Number.isNaN(notBefore) && t.createdOn) {
        const ts = Date.parse(t.createdOn);
        if (!Number.isNaN(ts) && ts < notBefore) reachedOldEnough = true;
      }
    }
    if (reachedOldEnough) break;

    const last = pickTx(arr[arr.length - 1]);
    const nextCursor = last?.id ?? null;
    if (!nextCursor || nextCursor === cursor) {
      // Pagination did not advance — cannot keep walking safely.
      return { conclusive: false, matches };
    }
    cursor = nextCursor;
  }

  // Conclusive only if we actually walked back far enough to be sure the
  // transaction (created around notBefore) would have been in the window.
  return { conclusive: reachedOldEnough || matches.length > 0, matches };
}

export async function findTransactionByMerchantReference(
  credentials: PostFinanceCredentials,
  orderId: string,
  opts: { pendingCreatedAt?: string | null } = {},
): Promise<{ conclusive: boolean; transaction: FoundTx | null }> {
  // 1. Preferred: the dedicated search endpoint.
  const search = await trySearchEndpoint(credentials, orderId);
  if (search.ok) {
    if (search.matches.length > 0) {
      return { conclusive: true, transaction: newest(search.matches) };
    }
    // The endpoint answered with a proper (empty) result set → trust it.
    return { conclusive: true, transaction: null };
  }

  // 2. Fallback: bounded paginated walk of the recent transaction list.
  const notBefore = opts.pendingCreatedAt
    ? new Date(Date.parse(opts.pendingCreatedAt) - 60 * 60 * 1000).toISOString()
    : null;
  const walk = await walkRecentList(credentials, orderId, notBefore);
  if (walk.matches.length > 0) {
    return { conclusive: true, transaction: newest(walk.matches) };
  }
  return { conclusive: walk.conclusive, transaction: null };
}

function newest(list: FoundTx[]): FoundTx {
  return [...list].sort((a, b) => {
    const ta = a.createdOn ? Date.parse(a.createdOn) : 0;
    const tb = b.createdOn ? Date.parse(b.createdOn) : 0;
    if (tb !== ta) return tb - ta;
    return Number(b.id) - Number(a.id);
  })[0];
}
