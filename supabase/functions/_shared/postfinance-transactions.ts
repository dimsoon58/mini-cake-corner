// Shared PostFinance Checkout transaction helpers used by
// create-postfinance-payment (retry / resume), confirm-postfinance-payment
// and postfinance-webhook. All calls go through pfFetch (JWT-HMAC auth,
// REWARD_ONLY shim) — see _shared/postfinance.ts.

import { type PostFinanceCredentials, pfFetch } from "./postfinance.ts";
import { sendTechnicalAlert } from "./admin-alert.ts";

// One orderId ended up pointing at TWO different real PostFinance transactions.
// Read both real states, log + alert an operator, and NEVER overwrite. The
// caller must respond conservatively (5xx / in_progress) and create no new
// payment. Used identically by postfinance-webhook and by
// create-postfinance-payment's handleRetry.
export async function reportConflictingTransactions(
  credentials: PostFinanceCredentials,
  orderId: string,
  recordedTxId: string,
  incomingTxId: string,
): Promise<{ recordedState: string; incomingState: string }> {
  let recordedState = "unknown";
  let incomingState = "unknown";
  try {
    const t = await pfFetch(credentials, `/payment/transactions/${recordedTxId}`, "GET") as { state?: string };
    recordedState = t?.state ?? "unknown";
  } catch { /* leave unknown */ }
  try {
    const t = await pfFetch(credentials, `/payment/transactions/${incomingTxId}`, "GET") as { state?: string };
    incomingState = t?.state ?? "unknown";
  } catch { /* leave unknown */ }

  console.error(
    `CRITICAL: order ${orderId} already has transaction ${recordedTxId} (state ${recordedState}) ` +
    `but transaction ${incomingTxId} (state ${incomingState}) surfaced. NOT overwriting.`,
  );
  await sendTechnicalAlert({
    subject: `Deux transactions PostFinance pour une commande — ${orderId}`,
    lines: [
      `Order ID : ${orderId}`,
      `Transaction enregistrée : ${recordedTxId} — état ${recordedState}`,
      `Transaction entrante : ${incomingTxId} — état ${incomingState}`,
      `Heure : ${new Date().toISOString()}`,
      `Action : AUCUN écrasement. Vérification manuelle requise (double débit possible).`,
    ],
  }).catch(() => {});

  return { recordedState, incomingState };
}

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
// 2026-09-16: merchantReference at creation time switched from the raw
// orderId (UUID) to the human-readable payment_reference (PAY-YYMMDDNN) — see
// create-postfinance-payment's transactionCreate. merchantReference can NEVER
// be changed after PostFinance moves the transaction past its "Pending"
// state (confirmed against wallee/PostFinance Checkout's own docs — this
// happens automatically, before the customer even reaches the payment page),
// so every transaction created before this change permanently keeps the old
// UUID as its merchantReference, forever. To search correctly across BOTH
// eras with no cutover risk and no deploy-timing coordination needed, every
// search here takes a LIST of candidate reference values — typically
// [payment_reference, orderId] — and matches a transaction whose
// merchantReference equals ANY one of them. Build that list with
// referenceCandidates() below.
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
// (env) overrides the template below; `{ref}` is replaced with each candidate
// reference in turn. If the search call fails or returns an unexpected shape
// we fall back to a bounded, paginated walk of the recent transaction list,
// which needs no filter syntax at all.
const DEFAULT_SEARCH_QUERY_TEMPLATE = 'merchantReference:{ref}';
const LIST_PAGE_SIZE = 100;
const LIST_MAX_PAGES = 25; // up to 2500 most-recent transactions

interface FoundTx {
  id: string;
  state: string | null;
  merchantReference: string | null;
  createdOn: string | null;
}

// The candidate list every search below matches against: the current
// human-readable payment_reference (when the pending_payments row has one —
// it may be null only for the rare case reserve_payment_reference() itself
// failed at creation time) plus the legacy orderId (UUID), which is what
// every transaction created before 2026-09-16 permanently carries as its
// merchantReference. Order doesn't matter — every candidate is searched.
export function referenceCandidates(
  paymentReference: string | null | undefined,
  orderId: string,
): string[] {
  return [paymentReference, orderId].filter((v): v is string => !!v);
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

// Queries the search endpoint once PER candidate reference (never an OR
// query — that grammar is unverified, see the note above) and merges the
// results. `ok` is true only if EVERY candidate's query succeeded — a
// mid-list failure must never let a partial (possibly incomplete) result be
// trusted as if it were a full search.
async function trySearchEndpoint(
  credentials: PostFinanceCredentials,
  references: string[],
): Promise<{ ok: boolean; matches: FoundTx[] }> {
  const template = Deno.env.get("POSTFINANCE_SEARCH_QUERY") || DEFAULT_SEARCH_QUERY_TEMPLATE;
  const byId = new Map<string, FoundTx>();
  for (const ref of references) {
    const query = template.replace("{ref}", ref);
    try {
      const payload = await pfFetch(
        credentials,
        `/payment/transactions/search?query=${encodeURIComponent(query)}&limit=50`,
        "GET",
      );
      const arr = asArray(payload);
      if (!arr) return { ok: false, matches: [] };
      for (const raw of arr) {
        const t = pickTx(raw);
        if (t && t.merchantReference && references.includes(t.merchantReference)) {
          byId.set(t.id, t);
        }
      }
    } catch (e) {
      console.error("trySearchEndpoint failed (will fall back to list walk):", e);
      return { ok: false, matches: [] };
    }
  }
  return { ok: true, matches: [...byId.values()] };
}

async function walkRecentList(
  credentials: PostFinanceCredentials,
  references: string[],
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
      if (t.merchantReference && references.includes(t.merchantReference)) matches.push(t);
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
  references: string[],
  opts: { pendingCreatedAt?: string | null } = {},
): Promise<{ conclusive: boolean; transaction: FoundTx | null }> {
  if (references.length === 0) {
    // Nothing to search for — never call PostFinance with an empty filter,
    // which could match everything. Same "cannot prove it" outcome as an
    // API error: the caller must never treat this as absence.
    return { conclusive: false, transaction: null };
  }

  // 1. Preferred: the dedicated search endpoint.
  //    A POSITIVE match is always usable. An EMPTY result only PROVES absence
  //    once the query syntax has been verified against our own PostFinance
  //    space — set POSTFINANCE_SEARCH_QUERY_VERIFIED=true after that test.
  //    Until then an empty array is NOT proof: fall through to the exhaustive
  //    walk, and if that is also inconclusive, return conclusive:false
  //    (caller keeps the same orderId / in_progress — never a new transaction).
  const searchVerified = Deno.env.get("POSTFINANCE_SEARCH_QUERY_VERIFIED") === "true";
  const search = await trySearchEndpoint(credentials, references);
  if (search.ok && search.matches.length > 0) {
    return { conclusive: true, transaction: verifyMatch(newest(search.matches), references) };
  }
  if (search.ok && searchVerified) {
    // Verified endpoint answered with a proper empty result set → trust it.
    return { conclusive: true, transaction: null };
  }

  // 2. Fallback: bounded paginated walk of the recent transaction list.
  const notBefore = opts.pendingCreatedAt
    ? new Date(Date.parse(opts.pendingCreatedAt) - 60 * 60 * 1000).toISOString()
    : null;
  const walk = await walkRecentList(credentials, references, notBefore);
  if (walk.matches.length > 0) {
    return { conclusive: true, transaction: verifyMatch(newest(walk.matches), references) };
  }
  return { conclusive: walk.conclusive, transaction: null };
}

// Explicit final guard, on top of the filtering trySearchEndpoint/
// walkRecentList already do internally: never return a transaction as "the"
// match unless its OWN merchantReference genuinely equals one of the exact
// candidates searched for. Throws rather than silently returning a
// possibly-wrong transaction — a caller resuming/voiding the wrong
// transaction is far worse than a hard failure surfaced as conclusive:false
// would be, and this should be structurally impossible given the two
// callers already filter on the same condition.
function verifyMatch(tx: FoundTx, references: string[]): FoundTx {
  if (!tx.merchantReference || !references.includes(tx.merchantReference)) {
    throw new Error(
      `findTransactionByMerchantReference: matched transaction ${tx.id} has merchantReference ` +
      `"${tx.merchantReference}", which is not in the searched candidate list [${references.join(", ")}] — refusing to use it.`,
    );
  }
  return tx;
}

function newest(list: FoundTx[]): FoundTx {
  return [...list].sort((a, b) => {
    const ta = a.createdOn ? Date.parse(a.createdOn) : 0;
    const tb = b.createdOn ? Date.parse(b.createdOn) : 0;
    if (tb !== ta) return tb - ta;
    return Number(b.id) - Number(a.id);
  })[0];
}
