import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { adminPinOk, requireAdmin } from "../_shared/admin-auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  fruitSupplementOf,
  quoteManualOrder,
  type AdjustmentType,
  type QuoteFulfillmentInput,
  type QuoteItemInput,
} from "../_shared/manual-order-quote.ts";
import { FLAVOUR_BY_ID, resolveFlavour } from "../_shared/production-catalog.ts";
import { CAKE_EXTRAS, DIY_KIT_PIPING, roundToCents } from "../_shared/pricing.ts";
import { getSiteBaseUrl } from "../_shared/site-config.ts";
import { isCatalogColourId } from "../_shared/catalog-colours.ts";
import { renderPaymentLinkEmail } from "../_shared/payment-link-email.ts";

// Admin manual orders — writes. Same core tables as website orders (orders,
// order_items, order_fulfillments); no second order system.
//
// Actions (this version):
//   - get:        load an Admin order back into the editor
//   - save:       create / update a draft or an order awaiting payment.
//                 Prices are ALWAYS recomputed here with quoteManualOrder()
//                 (the checkout's engine) — only the adjustment comes from
//                 the form. order_source = 'manual order' so the live
//                 trigger assigns ORDM-/INV- numbers. No workshop seat is
//                 reserved, no email is sent, nothing goes to Make.
//   - upload_url: signed upload URL for a reference image (order-images
//                 bucket, same bucket as the checkout).
//   - mark_paid:  admin session + ADMIN_ORDER_PIN. Atomic
//                 mark_manual_order_paid (workshop seats + paid), then the
//                 confirmation email if requested.
//   - send_confirmation: (re)send the confirmation + invoice of a paid
//                 Admin order through send-manual-order-confirmation.
// Cancellation and editing a paid order are later actions.
//
// F31 (13.10.2026) — contact: name, phone, email and Instagram handle are
// each optional; a confirmed order needs at least ONE of them (a name alone,
// with the order channel, is enough — e.g. an order taken in person).
// No email address → no email is ever attempted (mark_paid skips it,
// send_confirmation is refused); the order and the accounts are unaffected.
//
// F30 (13.10.2026) — « Commande historique — sans email » (orders.is_historical):
// an order already made before the website, entered only for the accounts.
// Past dates allowed, no express surcharge, no workshop; phone / email
// optional. NO email ever: mark_paid ignores sendConfirmation and
// send_confirmation is refused. Items whose date is today or earlier are
// stored as already handed over (production_status picked_up / delivered,
// no stock movement), so they never show up as « à préparer ». Payment is
// recorded with the usual mark_paid (real date and method): realisation
// month = the order date, cash-in month = the payment date, as for any order.

const json = (cors: Record<string, string>, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// Price of an item's extras (a repeated id, e.g. Scattered Pearls × 3, counts
// each time, exactly like priceOrderItem()).
function extrasPrice(it: EditorItem): number {
  const extras = Array.isArray(it.extras) ? it.extras : [];
  if (it.product === "bento_cake" || it.product === "rectangle_cake") {
    const size = String(it.size ?? "") as keyof (typeof CAKE_EXTRAS)[string];
    return roundToCents(extras.reduce((sum, e) => sum + (CAKE_EXTRAS[e]?.[size] ?? 0), 0));
  }
  if (it.product === "diy_kit") return roundToCents(extras.reduce((sum, e) => sum + (DIY_KIT_PIPING[e] ?? 0), 0));
  return 0;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// F31 (13.10.2026) — pseudo Instagram : lettres, chiffres, point, tiret bas ;
// stocké avec « @ » devant. Une valeur qui ne ressemble pas à un pseudo est refusée.
const INSTAGRAM_RE = /^[A-Za-z0-9._]{1,30}$/;
export function normaliseInstagram(v: unknown): string | null {
  if (typeof v !== "string") return null;
  let h = v.trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/[/?#].*$/, "").replace(/^@+/, "");
  if (!h) return null;
  return INSTAGRAM_RE.test(h) ? `@${h}` : `invalid:${h}`;
}
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CHANNELS = ["phone", "instagram", "whatsapp", "email", "in_person", "other"];
const REASONS = ["goodwill", "loyal_customer", "agreed_price", "b2b", "partner", "custom_supplement", "other"];

interface EditorItem extends QuoteItemInput {
  item_comment?: string | null;       // visible to the customer (emails)
  internal_notes?: string | null;     // internal only
  reference_images?: string[];
  base_color?: string | null;
  decoration_color?: string | null;
  cake_text?: string | null;
  text_color?: string | null;
  text_style?: string | null;
  ribbon_color?: string | null;
  butterfly_color?: string | null;
  extra?: string | null;              // readable extras, e.g. "Gold Leaves, Scattered Pearls × 3"
  extra_type?: string | null;         // their catalogue groups, e.g. "Toppings, Pearls"
  extra_color?: string | null;        // option colours alone, e.g. "Pink, Gold" (as the checkout)
  inside_color?: string | null;       // Gender Reveal inside colour, "Rose" / "Bleu" (as the checkout)
  workshop_sponge_choices?: string[] | null;
  workshop_base_colors?: string[] | null; // F45 — Pochage : couleur de base par participant
  workshop_has_minor?: boolean;
  workshop_minor_consent_confirmed?: boolean;
}

interface SaveBody {
  orderId?: string | null;
  mode: "draft" | "confirm";
  customer: {
    first_name?: string; last_name?: string; phone?: string; email?: string;
    company?: string | null; lang?: "fr" | "en"; channel?: string | null;
  };
  internal_notes?: string | null;
  order_comment?: string | null;       // visible to the customer
  items: EditorItem[];
  fulfillments: QuoteFulfillmentInput[];
  adjustment?: { type: AdjustmentType; value: number; reason?: string | null; note?: string | null } | null;
}

// Sends the customer confirmation + PDF invoice through the EXISTING
// send-manual-order-confirmation function — same templates (workshop-only →
// workshop email; any cake → cake email), same invoice generator, same
// duplicate protection (manual_confirmation_status lock, "already sent"
// short-circuit, Resend idempotency key). Server-to-server, service role.
// deno-lint-ignore no-explicit-any
async function sendManualConfirmation(supabase: any, orderId: string): Promise<{ sent: boolean; alreadySent?: boolean; error?: string | null }> {
  try {
    const { data, error } = await supabase.functions.invoke("send-manual-order-confirmation", { body: { orderId } });
    if (error) {
      let detail: string | null = null;
      try { detail = (await (error as { context?: Response }).context?.json())?.error ?? null; } catch { /* ignore */ }
      console.error(`send-manual-order-confirmation failed for ${orderId}:`, detail ?? error);
      return { sent: false, error: detail ?? (error instanceof Error ? error.message : "Email could not be sent") };
    }
    if (data?.error) return { sent: false, error: String(data.error) };
    return { sent: true, alreadySent: !!data?.alreadySent, error: null };
  } catch (e) {
    console.error(`send-manual-order-confirmation threw for ${orderId}:`, e);
    return { sent: false, error: e instanceof Error ? e.message : "Email could not be sent" };
  }
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const strOrNull = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

// Products of an order in a stable order (rows inserted together share the
// same created_at, so the id breaks the tie).
// deno-lint-ignore no-explicit-any
function sortItemRows<T extends { id: string; created_at?: any }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const ta = String(a.created_at ?? ""), tb = String(b.created_at ?? "");
    return ta < tb ? -1 : ta > tb ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

// What makes a product "the same cake" for Production.
// deno-lint-ignore no-explicit-any
const itemSignature = (r: any) => JSON.stringify([
  r.product ?? null, r.size ?? null, r.shape ?? null, r.design ?? null,
  Array.isArray(r.flavors) ? r.flavors : [], r.workshop_session_id ?? null,
]);

const NOT_STARTED = new Set(["to_assign", "pending"]);

// Pairs the saved products with the products already on the order, so that
// they are updated in place instead of deleted and re-created.
//   1. same product (signature) → same row, in order;
//   2. otherwise, the next unused row whose Production hasn't started
//      (production_status to_assign / pending / empty) — a product already
//      started (Déco, « Fait », emballé, remis) is never re-used for a
//      different cake.
// Rows left over are the products removed from the order.
// deno-lint-ignore no-explicit-any
function matchItemRows(olds: any[], news: any[]): { targetByNew: (string | null)[]; removed: { id: string }[] } {
  const used = new Set<string>();
  const targetByNew: (string | null)[] = news.map(() => null);
  news.forEach((n, i) => {
    const sig = itemSignature(n);
    const o = olds.find((x) => !used.has(x.id) && itemSignature(x) === sig);
    if (o) { used.add(o.id); targetByNew[i] = o.id; }
  });
  news.forEach((_, i) => {
    if (targetByNew[i]) return;
    const o = olds.find((x) => !used.has(x.id) && NOT_STARTED.has(x.production_status ?? "to_assign"));
    if (o) { used.add(o.id); targetByNew[i] = o.id; }
  });
  return { targetByNew, removed: olds.filter((x) => !used.has(x.id)).map((x) => ({ id: x.id })) };
}

// deno-lint-ignore no-explicit-any
function editableState(o: any): { ok: boolean; reason?: string } {
  if (o.created_via !== "admin") return { ok: false, reason: "Only orders created from the Admin can be edited here" };
  if (o.order_validation === "cancelled" || o.order_validation === "rejected" || o.order_failure_reason) return { ok: false, reason: "This order is cancelled" };
  if (o.payment_status !== "pending") return { ok: false, reason: "This order is already paid — editing a paid order comes in a later step" };
  return { ok: true };
}

serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  // deno-lint-ignore no-explicit-any
  let supabase: any;
  try {
    supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );
    const admin = await requireAdmin(req, supabase);
    if (!admin) return json(cors, { error: "Admin sign-in required" }, 401);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "");

    // ── upload_url ─────────────────────────────────────────────────────
    if (action === "upload_url") {
      const name = String(body?.fileName ?? "image").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
      const now = new Date();
      const path = `admin/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${crypto.randomUUID()}_${name}`;
      const { data, error } = await supabase.storage.from("order-images").createSignedUploadUrl(path);
      if (error) throw new Error(`Failed to prepare upload: ${error.message}`);
      const { data: pub } = supabase.storage.from("order-images").getPublicUrl(path);
      return json(cors, { path, token: data.token, publicUrl: pub.publicUrl });
    }

    // ── get ────────────────────────────────────────────────────────────
    if (action === "get") {
      const orderId = String(body?.orderId ?? "");
      const { data: o, error } = await supabase.from("orders").select("*").eq("id", orderId).maybeSingle();
      if (error) throw new Error(`Failed to load order: ${error.message}`);
      if (!o) return json(cors, { error: "Order not found" }, 404);
      const { data: items, error: iErr } = await supabase.from("order_items").select("*").eq("order_id", orderId).order("created_at", { ascending: true });
      if (iErr) throw new Error(`Failed to load items: ${iErr.message}`);
      const { data: fuls, error: fErr } = await supabase.from("order_fulfillments").select("*").eq("order_id", orderId).order("pickup_delivery_date", { ascending: true });
      if (fErr) throw new Error(`Failed to load dates: ${fErr.message}`);

      const fIndex = new Map((fuls ?? []).map((f: { id: string }, i: number) => [f.id, i]));
      const fulfillments = (fuls ?? []).map((f: Record<string, unknown>) => ({
        date: f.pickup_delivery_date,
        deliveryMethod: f.delivery_method === "delivery" ? "delivery" : "pickup",
        deliveryPlaceId: f.delivery_place_id ?? null,
        deliveryAddressLabel: f.delivery_address ?? null,
        slot: f.pickup_delivery_slot ?? null,
        itemIndexes: [] as number[],
      }));
      // deno-lint-ignore no-explicit-any
      const editorItems = sortItemRows(items ?? []).map((it: any, idx: number) => {
        if (it.fulfillment_id && fIndex.has(it.fulfillment_id)) fulfillments[fIndex.get(it.fulfillment_id)!].itemIndexes.push(idx);
        return {
          product: it.product,
          size: it.size,
          shape: it.shape,
          // Stored as display names (like the checkout) → back to ids.
          flavors: (it.flavors ?? []).map((n: string) => resolveFlavour(n)?.id ?? n),
          design: it.design,
          extras: it.extras ?? [],
          candles: it.candles ?? [],
          fruit_supplement: it.fruit_supplement != null ? Number(it.fruit_supplement) : null,
          workshop_session_id: it.workshop_session_id,
          workshop_participants: it.workshop_participants,
          workshop_sponge_choices: it.workshop_sponge_choices,
          workshop_has_minor: it.workshop_has_minor,
          workshop_minor_consent_confirmed: it.workshop_minor_consent_confirmed,
          item_comment: it.item_comment,
          internal_notes: it.internal_notes,
          reference_images: it.reference_images ?? [],
          base_color: it.base_color,
          decoration_color: it.decoration_color,
          cake_text: it.cake_text,
          text_color: it.text_color,
          text_style: it.text_style,
          ribbon_color: it.ribbon_color,
          butterfly_color: it.butterfly_color,
          inside_color: it.inside_color,
          // Couleurs des paillettes : relues dans ce texte par l'éditeur (« Glitter: Gold »).
          extra: it.extra,
        };
      });
      const edit = editableState(o);
      return json(cors, {
        orderId: o.id,
        orderNumber: o.order_number,
        isDraft: !!o.is_draft,
        historical: o.is_historical === true,
        paymentStatus: o.payment_status,
        editable: edit.ok,
        notEditableReason: edit.reason ?? null,
        customer: {
          first_name: o.first_name, last_name: o.last_name, phone: o.phone, email: o.email, instagram: o.customer_instagram ?? "",
          company: o.customer_company, lang: o.lang === "en" ? "en" : "fr", channel: o.order_channel,
        },
        internal_notes: o.internal_notes,
        order_comment: o.order_comment,
        items: editorItems,
        fulfillments,
        adjustment: o.price_adjustment_type
          ? { type: o.price_adjustment_type, value: Number(o.price_adjustment_value), reason: o.price_adjustment_reason, note: o.price_adjustment_note }
          : null,
        calculatedAmount: o.calculated_amount != null ? Number(o.calculated_amount) : null,
        finalAmount: o.total_amount != null ? Number(o.total_amount) : null,
        createdAt: o.created_at,
        lastEditedAt: o.last_edited_at,
      });
    }

    // ── save ───────────────────────────────────────────────────────────
    if (action === "save") {
      const b = body as SaveBody & { action: string };
      const mode = b.mode === "confirm" ? "confirm" : "draft";
      const items = Array.isArray(b.items) ? b.items : [];
      const fulfillments = Array.isArray(b.fulfillments) ? b.fulfillments : [];
      if (items.length === 0) return json(cors, { error: "Add at least one product" }, 400);
      if (items.length > 50 || fulfillments.length > 20) return json(cors, { error: "Too many items or dates" }, 400);

      // Existing order: must still be editable (Admin order, not paid, not
      // cancelled) and must hold no workshop reservation.
      // deno-lint-ignore no-explicit-any
      let existing: any = null;
      if (b.orderId) {
        const { data: o, error } = await supabase.from("orders").select("*").eq("id", b.orderId).maybeSingle();
        if (error) throw new Error(`Failed to load order: ${error.message}`);
        if (!o) return json(cors, { error: "Order not found" }, 404);
        const edit = editableState(o);
        if (!edit.ok) return json(cors, { error: edit.reason }, 409);
        const { data: res } = await supabase.from("workshop_reservations").select("id").eq("order_id", o.id).limit(1);
        if ((res ?? []).length > 0) return json(cors, { error: "This order already holds workshop seats and can't be edited here" }, 409);
        existing = o;
      }

      // Customer
      const c = b.customer ?? {};
      const customer = {
        first_name: str(c.first_name), last_name: str(c.last_name), phone: str(c.phone), email: str(c.email).toLowerCase(),
        instagram: normaliseInstagram(c.instagram),
        company: strOrNull(c.company), lang: c.lang === "en" ? "en" : "fr",
        channel: c.channel && CHANNELS.includes(c.channel) ? c.channel : null,
      };

      // Adjustment (validated here; its amount is recomputed by the quote)
      const adj = b.adjustment && ["amount", "percent", "final"].includes(b.adjustment.type)
        ? {
          type: b.adjustment.type,
          value: Number(b.adjustment.value),
          reason: b.adjustment.reason && REASONS.includes(b.adjustment.reason) ? b.adjustment.reason : null,
          note: strOrNull(b.adjustment.note),
        }
        : null;

      // F30 : une commande déjà payée ne peut plus changer de mode (editableState l'empêche).
      const historical = b.historical === true;

      // Prices — always recomputed with the checkout's engine.
      const quote = await quoteManualOrder(supabase, {
        items,
        fulfillments,
        adjustment: adj ? { type: adj.type, value: adj.value } : null,
        historical,
      });

      if (mode === "confirm") {
        const problems: string[] = [];
        // F31 : prénom et nom facultatifs (une commande peut n'avoir qu'un téléphone ou un pseudo).
        // F31 : nom, téléphone, e-mail et Instagram facultatifs ; au moins l'un des quatre
        // (commande normale comme historique) pour savoir à qui est la commande.
        if (customer.email !== "" && !EMAIL_RE.test(customer.email)) problems.push("A valid email is required");
        if (customer.instagram?.startsWith("invalid:")) problems.push("The Instagram handle is not valid");
        if (!customer.first_name && !customer.last_name && !customer.phone && !customer.email && !customer.instagram) {
          problems.push("Give at least a name or a contact: name, phone, email or Instagram");
        }
        if (!quote.ok) {
          problems.push(...quote.errors);
          quote.items.forEach((r) => r.error && problems.push(`Item ${r.index + 1}: ${r.error}`));
          quote.fulfillments.forEach((f) => f.error && problems.push(`Date ${f.index + 1}: ${f.error}`));
          if (quote.errors.length === 0 && quote.totals.calculated === null && problems.length === 0) problems.push("The price could not be calculated");
        }
        if (adj && quote.adjustment.amount !== 0 && !adj.reason) problems.push("Choose a reason for the price adjustment");
        // F45 — sessions Pochage (la couleur de base y est obligatoire).
        const wsIds = items.filter((it) => it.product === "workshop" && it.workshop_session_id).map((it) => String(it.workshop_session_id));
        const pipingSessions = new Set<string>();
        if (wsIds.length > 0) {
          const { data: sessRows } = await supabase.from("workshop_sessions").select("id, workshop_type").in("id", wsIds);
          for (const r of sessRows ?? []) if (r.workshop_type === "piping") pipingSessions.add(r.id);
        }
        const wsTypeOf = (it: { workshop_session_id?: string | null }) => (it.workshop_session_id && pipingSessions.has(it.workshop_session_id) ? "piping" : null);
        items.forEach((it, i) => {
          if (it.product === "workshop") {
            const n = Number(it.workshop_participants) || 0;
            const ch = it.workshop_sponge_choices ?? [];
            if (ch.length !== n || !ch.every((x) => x === "vanilla" || x === "chocolate")) problems.push(`Item ${i + 1}: choose the sponge of each participant`);
            // F45 — Pochage : une couleur de base par participant.
            if (wsTypeOf(it) === "piping") {
              const col = it.workshop_base_colors ?? [];
              if (col.length !== n || !col.every((x) => isCatalogColourId(x))) problems.push(`Item ${i + 1}: choose the base colour of each participant`);
            }
            if (it.workshop_has_minor && !it.workshop_minor_consent_confirmed) problems.push(`Item ${i + 1}: confirm the legal representative's consent for the minor`);
          }
        });
        if (problems.length > 0) return json(cors, { error: "The order can't be confirmed yet", problems, quote }, 422);
      }

      // Duplicate / malformed dates can't be stored even as a draft
      // (one order_fulfillments row per date).
      const validDates = fulfillments.map((f) => ISO_DATE.test(String(f?.date ?? "")));
      if (validDates.some((v) => !v)) return json(cors, { error: "Every date group needs a date", quote }, 422);
      if (new Set(fulfillments.map((f) => f.date)).size !== fulfillments.length) {
        return json(cors, { error: "The same date is used twice — put those items in one date group", quote }, 422);
      }

      const hasWorkshop = items.some((it) => it.product === "workshop");
      const hasPhysical = items.some((it) => it.product !== "workshop");
      const fulfillmentType = hasWorkshop ? (hasPhysical ? "mixed" : "workshop_only") : "cake_only";
      const qf = quote.fulfillments;
      const single = qf.length === 1 ? qf[0] : null;
      const nowIso = new Date().toISOString();

      // F41 : des paiements sont déjà reçus → le total ne peut pas passer
      // en dessous, et la commande ne peut pas redevenir un brouillon.
      if (existing) {
        const { data: pays } = await supabase.from("manual_order_payments").select("amount").eq("order_id", existing.id).eq("status", "recorded");
        const alreadyPaid = roundToCents((pays ?? []).reduce((sum: number, p: { amount: number }) => sum + Number(p.amount), 0));
        if (alreadyPaid > 0 && mode === "draft") {
          return json(cors, { error: `Payments of CHF ${alreadyPaid.toFixed(2)} are already recorded: the order can't go back to draft`, reason: "has_payments", quote }, 409);
        }
        if (alreadyPaid > 0 && (quote.final ?? 0) < alreadyPaid) {
          return json(cors, { error: `The new total is below the payments already received (CHF ${alreadyPaid.toFixed(2)})`, reason: "below_paid", quote }, 409);
        }
      }

      const orderFields: Record<string, unknown> = {
        order_source: "manual order",   // → ORDM-/INV- numbers from the live trigger
        created_via: "admin",
        is_draft: mode === "draft",
        is_historical: historical,
        order_channel: customer.channel,
        first_name: customer.first_name,
        last_name: customer.last_name,
        phone: customer.phone,
        email: customer.email,
        customer_instagram: customer.instagram?.startsWith("invalid:") ? null : customer.instagram,
        customer_company: customer.company,
        lang: customer.lang,
        internal_notes: strOrNull(b.internal_notes),
        order_comment: strOrNull(b.order_comment),
        payment_status: "pending",
        order_validation: "approved",
        physical_validation: hasPhysical ? "approved" : "not_applicable",
        fulfillment_type: fulfillmentType,
        calculated_amount: quote.totals.calculated,
        price_adjustment_type: adj?.type ?? null,
        price_adjustment_value: adj ? adj.value : null,
        price_adjustment_amount: quote.totals.calculated !== null ? quote.adjustment.amount : 0,
        price_adjustment_reason: adj?.reason ?? null,
        price_adjustment_note: adj?.note ?? null,
        // A draft whose price can't be computed yet is stored at 0 (the
        // column is NOT NULL); it can't be confirmed until it prices cleanly.
        total_amount: quote.final ?? 0,
        delivery_fee: quote.totals.delivery,
        express_surcharge_amount: quote.totals.express,
        // Order-level date fields: same rule as the checkout — filled for a
        // single date, left empty for a multi-date order.
        pickup_delivery_date: single ? single.date : null,
        pickup_delivery_slot: single ? single.slot : null,
        pickup_delivery_datetime: null,
        delivery_method: single ? single.deliveryMethod : null,
        delivery_address: single ? single.deliveryAddress : null,
        delivery_postal_code: single ? single.deliveryPostalCode : null,
        delivery_city: single ? single.deliveryCity : null,
        delivery_latitude: single ? single.deliveryLatitude : null,
        delivery_longitude: single ? single.deliveryLongitude : null,
        delivery_distance_km: single ? single.deliveryDistanceKm : null,
        delivery_zone: single ? single.deliveryZone : null,
        last_edited_at: nowIso,
      };

      // 1. Order row
      let orderId: string;
      let createdNow = false;
      if (existing) {
        orderId = existing.id;
      } else {
        const { data: created, error } = await supabase.from("orders").insert(orderFields).select("id").single();
        if (error) throw new Error(`Failed to create order: ${error.message}`);
        orderId = created.id;
        createdNow = true;
      }

      // Snapshot of the current rows, to restore them if the save fails.
      // Full rows (not only ids): products kept in place are restored from
      // this snapshot if a later step fails.
      // deno-lint-ignore no-explicit-any
      const { data: oldItemsRaw } = existing ? await supabase.from("order_items").select("*").eq("order_id", orderId) : { data: [] };
      // deno-lint-ignore no-explicit-any
      const oldItems: any[] = sortItemRows(oldItemsRaw ?? []);
      const { data: oldFuls } = existing ? await supabase.from("order_fulfillments").select("*").eq("order_id", orderId) : { data: [] };
      let newFulIds: string[] = [];
      let newItemIds: string[] = [];
      let keptItemIds: string[] = [];
      try {
        // 2. Dates — for an existing order, the old rows are removed first
        //    (one row per date is enforced by the database).
        if (existing && (oldItems ?? []).length > 0) {
          const { error } = await supabase.from("order_items").update({ fulfillment_id: null }).eq("order_id", orderId);
          if (error) throw new Error(`Failed to detach items: ${error.message}`);
        }
        if (existing && (oldFuls ?? []).length > 0) {
          const { error } = await supabase.from("order_fulfillments").delete().eq("order_id", orderId);
          if (error) throw new Error(`Failed to replace dates: ${error.message}`);
        }
        if (qf.length > 0) {
          const { data: insF, error } = await supabase.from("order_fulfillments").insert(qf.map((f) => ({
            order_id: orderId,
            pickup_delivery_date: f.date,
            delivery_method: f.deliveryMethod,
            pickup_delivery_slot: f.slot,
            pickup_delivery_datetime: null,
            delivery_address: f.deliveryAddress,
            delivery_place_id: f.deliveryPlaceId,
            delivery_postal_code: f.deliveryPostalCode,
            delivery_city: f.deliveryCity,
            delivery_latitude: f.deliveryLatitude,
            delivery_longitude: f.deliveryLongitude,
            delivery_distance_km: f.deliveryDistanceKm,
            delivery_zone: f.deliveryZone,
            delivery_fee: f.deliveryFee ?? 0,
          }))).select("id");
          if (error) throw new Error(`Failed to save dates: ${error.message}`);
          newFulIds = (insF ?? []).map((r: { id: string }) => r.id);
        }
        const fulIdByItem = new Map<number, string>();
        qf.forEach((f, fIdx) => f.itemIndexes.forEach((i) => fulIdByItem.set(i, newFulIds[fIdx])));

        // 3. Items — the same columns and value formats as a website order
        //    (flavours stored as the site's display names).
        const sessionInfo = new Map(quote.items.filter((r) => r.workshop).map((r) => [r.index, r.workshop!]));
        const itemRows = items.map((it, i) => {
          const ws = sessionInfo.get(i);
          const isWorkshop = it.product === "workshop";
          return {
            order_id: orderId,
            product: it.product,
            size: isWorkshop ? null : (it.size ?? null),
            shape: isWorkshop ? null : (it.shape ?? null),
            flavors: isWorkshop ? [] : (it.flavors ?? []).map((id) => FLAVOUR_BY_ID.get(id)?.names[0] ?? id),
            design: isWorkshop ? null : (it.design ?? null),
            extras: isWorkshop ? [] : (it.extras ?? []),
            candles: isWorkshop ? [] : (it.candles ?? []),
            total: quote.items[i]?.total ?? 0,
            fulfillment_id: isWorkshop ? null : (fulIdByItem.get(i) ?? null),
            item_comment: strOrNull(it.item_comment),
            internal_notes: strOrNull(it.internal_notes),
            reference_images: Array.isArray(it.reference_images) ? it.reference_images.filter((u) => typeof u === "string") : [],
            base_color: strOrNull(it.base_color),
            decoration_color: strOrNull(it.decoration_color),
            cake_text: strOrNull(it.cake_text),
            text_color: strOrNull(it.text_color),
            text_style: strOrNull(it.text_style),
            ribbon_color: strOrNull(it.ribbon_color),
            // Readable extras for the emails / invoice / Admin detail (the
            // checkout fills the same columns). Display text only — the
            // price below comes from the engine's own tables.
            extra: isWorkshop ? null : strOrNull(it.extra),
            extra_type: isWorkshop ? null : strOrNull(it.extra_type),
            extra_color: isWorkshop ? null : strOrNull(it.extra_color),
            inside_color: isWorkshop ? null : strOrNull(it.inside_color),
            extras_price: isWorkshop ? 0 : extrasPrice(it),
            // Supplément fruits : déjà compris dans `total` (quote) ; gardé à
            // part pour la ligne de la facture et l'Admin.
            fruit_supplement: fruitSupplementOf(it).amount || null,
            butterfly_color: strOrNull(it.butterfly_color),
            workshop_type: ws?.type ?? null,
            workshop_session_id: isWorkshop ? (it.workshop_session_id ?? null) : null,
            workshop_date: ws?.date ?? null,
            workshop_time: ws?.time ?? null,
            workshop_participants: isWorkshop ? (Number(it.workshop_participants) || null) : null,
            workshop_unit_price: ws?.unitPrice ?? null,
            workshop_sponge_choices: isWorkshop && Array.isArray(it.workshop_sponge_choices) &&
                it.workshop_sponge_choices.length === Number(it.workshop_participants) &&
                it.workshop_sponge_choices.every((x) => x === "vanilla" || x === "chocolate")
              ? it.workshop_sponge_choices : null,
            workshop_base_colors: isWorkshop && ws?.type === "piping" && Array.isArray(it.workshop_base_colors) &&
                it.workshop_base_colors.length === Number(it.workshop_participants) &&
                it.workshop_base_colors.every((x) => isCatalogColourId(x))
              ? it.workshop_base_colors : null,
            workshop_has_minor: isWorkshop ? !!it.workshop_has_minor : false,
            workshop_minor_consent_confirmed: isWorkshop ? !!it.workshop_minor_consent_confirmed : false,
          };
        });
        // Products already on the order are updated IN PLACE (same id), not
        // deleted and re-created: Production (« Fait », stock movements,
        // preparations, steps), labels, notes and item changes all point at
        // order_items.id and must keep their history (14.11.2026 — saving an
        // order whose cake was already « Fait » failed on
        // production_stock_movements_order_item_id_fkey).
        const plan = matchItemRows(oldItems, itemRows);
        for (const [i, row] of itemRows.entries()) {
          const target = plan.targetByNew[i];
          if (!target) continue;
          // deno-lint-ignore no-unused-vars
          const { order_id, ...fields } = row;
          const { error } = await supabase.from("order_items").update(fields).eq("id", target);
          if (error) throw new Error(`Failed to save products: ${error.message}`);
          keptItemIds.push(target);
        }
        const toInsert = itemRows.filter((_, i) => !plan.targetByNew[i]);
        if (toInsert.length > 0) {
          const { data: insI, error: iErr } = await supabase.from("order_items").insert(toInsert).select("id");
          if (iErr) throw new Error(`Failed to save products: ${iErr.message}`);
          newItemIds = (insI ?? []).map((r: { id: string }) => r.id);
        }

        // 4. Products removed from the order, then the order fields.
        if (plan.removed.length > 0) {
          const { error } = await supabase.from("order_items").delete().in("id", plan.removed.map((r) => r.id));
          if (error) {
            if (/foreign key/i.test(error.message)) {
              throw new Error(
                "A removed product already has a Production history (marked done, stock used or label printed) and can't be deleted here. " +
                "Keep it on the order, or cancel it from the order page (« Annuler ce gâteau »).",
              );
            }
            throw new Error(`Failed to replace products: ${error.message}`);
          }
        }
        if (existing) {
          const { error } = await supabase.from("orders").update(orderFields).eq("id", orderId);
          if (error) throw new Error(`Failed to update order: ${error.message}`);
        }
      } catch (e) {
        // Best-effort compensation: never leave half a new order behind, and
        // put an existing order's previous dates/products back as they were.
        if (newItemIds.length) await supabase.from("order_items").delete().in("id", newItemIds);
        if (newFulIds.length) await supabase.from("order_fulfillments").delete().in("id", newFulIds);
        if (createdNow) {
          await supabase.from("orders").delete().eq("id", orderId).eq("created_via", "admin").eq("payment_status", "pending");
        } else {
          const { data: stillThere } = await supabase.from("order_fulfillments").select("id").eq("order_id", orderId);
          if ((stillThere ?? []).length === 0 && (oldFuls ?? []).length > 0) {
            const { error: restoreErr } = await supabase.from("order_fulfillments").insert(oldFuls);
            if (restoreErr) console.error(`manage-manual-order: could not restore dates of ${orderId}:`, restoreErr);
          }
          // Every previous product gets its previous content back (products
          // updated in place) and its previous date link.
          const kept = new Set(keptItemIds);
          for (const it of oldItems) {
            if (kept.has(it.id)) {
              // deno-lint-ignore no-unused-vars
              const { id, created_at, ...previous } = it;
              const { error: rErr } = await supabase.from("order_items").update(previous).eq("id", it.id);
              if (rErr) console.error(`manage-manual-order: could not restore product ${it.id}:`, rErr);
            } else if (it.fulfillment_id) {
              await supabase.from("order_items").update({ fulfillment_id: it.fulfillment_id }).eq("id", it.id);
            }
          }
        }
        throw e;
      }

      // F30 : gâteaux d'une commande historique dont la date est passée (ou
      // aujourd'hui) = déjà remis — jamais « à préparer ». Écrit directement,
      // sans mouvement de stock (update-production-status n'est pas appelé).
      if (historical) {
        const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date());
        const { data: fs } = await supabase.from("order_fulfillments").select("id, pickup_delivery_date, delivery_method").eq("order_id", orderId);
        for (const f of (fs ?? []) as { id: string; pickup_delivery_date: string | null; delivery_method: string | null }[]) {
          if (!f.pickup_delivery_date || String(f.pickup_delivery_date).slice(0, 10) > today) continue;
          const { error } = await supabase.from("order_items")
            .update({ production_status: f.delivery_method === "delivery" ? "delivered" : "picked_up" })
            .eq("order_id", orderId).eq("fulfillment_id", f.id);
          if (error) throw new Error(`Failed to mark historical items as handed over: ${error.message}`);
        }
      }

      const { data: saved } = await supabase.from("orders").select("id, order_number, is_draft, total_amount, calculated_amount").eq("id", orderId).single();
      return json(cors, { success: true, orderId, orderNumber: saved?.order_number ?? null, isDraft: saved?.is_draft ?? (mode === "draft"), quote });
    }

    // ── mark_paid ──────────────────────────────────────────────────────
    // One atomic database call (mark_manual_order_paid, migration MO2):
    // workshop seats are claimed and confirmed through the live
    // finalize_manual_workshop_order mechanism, THEN the order becomes paid.
    // A full or closed session raises inside that transaction, so nothing
    // changes. Only after the payment is committed is the confirmation
    // email sent (if requested) — an email failure never undoes a payment.
    if (action === "mark_paid") {
      // PIN validé pour la session (F16) ou saisi avec la demande.
      if (!adminPinOk(admin, body?.pin)) return json(cors, { error: "Invalid PIN" }, 403);

      const orderId = String(body?.orderId ?? "");
      const method = String(body?.paymentMethod ?? "");
      const paidOn = ISO_DATE.test(String(body?.paidOn ?? "")) ? String(body.paidOn) : null;
      // Noon Zurich-ish on the chosen day, so the date never shifts in UTC.
      const paidAt = paidOn ? `${paidOn}T12:00:00+02:00` : new Date().toISOString();

      const { data: paid, error: payErr } = await supabase.rpc("mark_manual_order_paid", {
        p_order_id: orderId,
        p_payment_method: method,
        p_payment_note: strOrNull(body?.paymentNote),
        p_paid_at: paidAt,
      });
      if (payErr) {
        const code = (payErr as { code?: string }).code ?? "";
        const reason =
          code === "P0004" ? "session_full" :
          code === "P0003" ? "session_closed" :
          code === "P0007" ? "minor_consent_missing" :
          code === "P0011" ? "still_draft" :
          code === "P0012" ? "cancelled" :
          code === "P0013" ? "not_awaiting_payment" :
          code === "22023" ? "invalid_payment_method" : "payment_failed";
        console.error(`mark_manual_order_paid failed for ${orderId} (${code}):`, payErr.message);
        // Nothing was changed: the whole transaction was rolled back.
        return json(cors, { error: payErr.message, reason, paid: false }, 409);
      }

      let email: { requested: boolean; sent: boolean; alreadySent?: boolean; error?: string | null; historical?: boolean; noEmail?: boolean } = { requested: false, sent: false };
      // F30 : commande historique → jamais d'e-mail, même si la case arrivait cochée.
      const { data: hist } = await supabase.from("orders").select("is_historical, email").eq("id", orderId).maybeSingle();
      if (hist?.is_historical === true) email = { requested: false, sent: false, historical: true };
      // F31 : pas d'adresse → aucun envoi tenté (le paiement reste enregistré normalement).
      else if (!String(hist?.email ?? "").trim()) email = { requested: false, sent: false, noEmail: true };
      else if (body?.sendConfirmation === true) {
        email = { requested: true, ...(await sendManualConfirmation(supabase, orderId)) };
      }
      return json(cors, { success: true, paid: true, order: paid, email });
    }

    // ── F41 : paiements reçus et lien de paiement ──────────────────────
    //   payments            lecture : total, payé, solde, paiements, lien
    //   record_payment      (PIN) un paiement reçu (acompte ou solde) ; au
    //                       solde atteint, même passage à « payée » que
    //                       mark_paid (places de workshop), puis e-mail si demandé
    //   cancel_payment      (PIN) annule une saisie erronée (historique gardé)
    //   payment_link        (PIN) renvoie le lien actif, ou le crée
    //   disable_payment_link (PIN)
    //   send_payment_link_email (PIN, F43) email « Confirmez votre commande »
    //                       avec le récapitulatif et le lien actif ; un
    //                       nouvel envoi demande resend: true
    if (action === "payments") {
      const { data, error } = await supabase.rpc("manual_order_payments_summary", { p_order_id: String(body?.orderId ?? "") });
      if (error) return json(cors, { error: error.message }, (error as { code?: string }).code === "P0002" ? 404 : 500);
      return json(cors, { data });
    }

    if (["record_payment", "cancel_payment", "payment_link", "disable_payment_link", "send_payment_link_email"].includes(action)) {
      if (!adminPinOk(admin, body?.pin)) return json(cors, { error: "Invalid PIN" }, 403);
      const by = admin.email ?? null;
      const orderId = String(body?.orderId ?? "");
      const refused = (error: { code?: string; message?: string }) => {
        const code = error.code ?? "";
        const reason =
          code === "P0004" ? "session_full" : code === "P0003" ? "session_closed" : code === "P0007" ? "minor_consent_missing" :
          code === "P0011" ? "still_draft" : code === "P0012" ? "cancelled" : code === "P0013" ? "not_awaiting_payment" :
          code === "P0014" ? "above_balance" : code === "P0016" ? "nothing_to_pay" : code === "P0017" ? "not_cancellable" :
          code === "22023" ? "invalid_input" : code === "P0002" ? "not_found" : "failed";
        console.error(`manage-manual-order ${action} refused for ${orderId} (${code}):`, error.message);
        return json(cors, { error: error.message, reason }, 409);
      };

      if (action === "record_payment") {
        const paidOn = ISO_DATE.test(String(body?.paidOn ?? "")) ? String(body.paidOn) : null;
        const method = String(body?.paymentMethod ?? "");
        if (method === "postfinance") return json(cors, { error: "PostFinance payments are recorded by the payment link", reason: "invalid_input" }, 400);
        const amount = Number(String(body?.amount ?? "").replace(",", "."));
        const { data, error } = await supabase.rpc("record_manual_order_payment", {
          p_order_id: orderId, p_amount: amount, p_method: method,
          p_paid_at: paidOn ? `${paidOn}T12:00:00+02:00` : new Date().toISOString(),
          p_note: strOrNull(body?.note), p_by: by, p_source: "admin",
        });
        if (error) return refused(error);
        let email: { requested: boolean; sent: boolean; alreadySent?: boolean; error?: string | null; noEmail?: boolean; historical?: boolean } = { requested: false, sent: false };
        if (data?.fully_paid) {
          const { data: o } = await supabase.from("orders").select("is_historical, email").eq("id", orderId).maybeSingle();
          if (o?.is_historical === true) email = { requested: false, sent: false, historical: true };
          else if (!String(o?.email ?? "").trim()) email = { requested: false, sent: false, noEmail: true };
          else if (body?.sendConfirmation === true) email = { requested: true, ...(await sendManualConfirmation(supabase, orderId)) };
        }
        return json(cors, { success: true, data, email });
      }

      if (action === "cancel_payment") {
        const { data, error } = await supabase.rpc("cancel_manual_order_payment", { p_payment_id: String(body?.paymentId ?? ""), p_by: by, p_reason: strOrNull(body?.reason) });
        if (error) return refused(error);
        return json(cors, { success: true, data });
      }

      if (action === "payment_link") {
        const bytes = crypto.getRandomValues(new Uint8Array(24));
        const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
        const token = Array.from(bytes, (x) => ALPHA[x % ALPHA.length]).join("");
        const { data, error } = await supabase.rpc("payment_link_create", {
          p_order_id: orderId, p_token: token, p_send_confirmation: body?.sendConfirmation !== false, p_by: by,
        });
        if (error) return refused(error);
        return json(cors, { success: true, data: { ...data, url: `${getSiteBaseUrl()}/payer/${data.token}` } });
      }

      if (action === "send_payment_link_email") {
        const { data: link, error: lErr } = await supabase.from("order_payment_links").select("*")
          .eq("order_id", orderId).eq("status", "active").maybeSingle();
        if (lErr) throw new Error(`Failed to load payment link: ${lErr.message}`);
        if (!link) return json(cors, { error: "No active payment link for this order", reason: "no_link" }, 409);
        const { data: order, error: oErr } = await supabase.from("orders").select("*").eq("id", orderId).maybeSingle();
        if (oErr) throw new Error(`Failed to load order: ${oErr.message}`);
        if (!order) return json(cors, { error: "Order not found", reason: "not_found" }, 404);
        if (order.is_historical === true) return json(cors, { error: "Historical order: no email is ever sent", reason: "historical" }, 409);
        const to = String(order.email ?? "").trim();
        if (!to) return json(cors, { error: "This order has no email address", reason: "no_email" }, 409);
        if (order.order_validation === "cancelled" || order.order_validation === "rejected" || order.order_failure_reason) {
          return json(cors, { error: "This order is cancelled", reason: "cancelled" }, 409);
        }
        const { data: sum, error: sErr } = await supabase.rpc("manual_order_payments_summary", { p_order_id: orderId });
        if (sErr) return refused(sErr);
        const balance = Number(sum?.balance ?? 0);
        if (order.payment_status === "paid" || !(balance > 0)) return json(cors, { error: "Nothing left to pay", reason: "nothing_to_pay" }, 409);
        const prev = Number(link.email_sent_count ?? 0);
        // La page envoie le nombre d'envois qu'elle a vu : un double clic sur
        // « Renvoyer » ne part qu'une fois.
        const expected = Number.isInteger(body?.expectedCount) ? Number(body.expectedCount) : null;
        if ((prev > 0 && body?.resend !== true) || (expected !== null && expected !== prev)) {
          return json(cors, { error: "Already sent", reason: "already_sent", data: { sentAt: link.email_sent_at, to: link.email_sent_to, count: prev } }, 409);
        }
        const resendApiKey = Deno.env.get("RESEND_API_KEY");
        if (!resendApiKey) throw new Error("RESEND_API_KEY not configured");

        // Verrou : un seul envoi à la fois (le compteur doit être celui lu).
        const sentAt = new Date().toISOString();
        const { data: claimed, error: cErr } = await supabase.from("order_payment_links")
          .update({ email_sent_count: prev + 1, email_sent_at: sentAt, email_sent_to: to, email_sent_by: by })
          .eq("id", link.id).eq("email_sent_count", prev).eq("status", "active").select("id");
        if (cErr) throw new Error(`Failed to record the email: ${cErr.message}`);
        if (!claimed || claimed.length !== 1) return json(cors, { error: "An email is already being sent", reason: "in_progress" }, 409);

        const { data: items } = await supabase.from("order_items").select("*").eq("order_id", orderId).order("created_at", { ascending: true });
        const { data: fulfillments } = await supabase.from("order_fulfillments").select("*").eq("order_id", orderId);
        const { subject, html } = renderPaymentLinkEmail(order, items ?? [], fulfillments ?? [], {
          url: `${getSiteBaseUrl()}/payer/${link.token}`, total: Number(sum?.total ?? order.total_amount ?? 0), paid: Number(sum?.paid ?? 0), balance,
        });
        let sendError: string | null = null;
        try {
          const resp = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json", "Idempotency-Key": `payment-link-email-${link.id}-${prev + 1}` },
            body: JSON.stringify({ from: "contact@bentocakestudio.ch", to: [to], subject, html }),
          });
          if (!resp.ok) sendError = `Resend ${resp.status}: ${JSON.stringify(await resp.json().catch(() => ({})))}`;
        } catch (e) {
          sendError = e instanceof Error ? e.message : String(e);
        }
        if (sendError) {
          console.error(`send_payment_link_email failed for ${orderId}:`, sendError);
          // Rien n'est parti : on remet la trace d'avant.
          await supabase.from("order_payment_links")
            .update({ email_sent_count: prev, email_sent_at: link.email_sent_at, email_sent_to: link.email_sent_to, email_sent_by: link.email_sent_by })
            .eq("id", link.id).eq("email_sent_count", prev + 1);
          return json(cors, { error: "The email could not be sent", reason: "send_failed" }, 502);
        }
        return json(cors, { success: true, data: { sentAt, to, count: prev + 1 } });
      }

      // disable_payment_link
      const { data, error } = await supabase.rpc("payment_link_disable", { p_link_id: String(body?.linkId ?? ""), p_by: by, p_reason: strOrNull(body?.reason) });
      if (error) return refused(error);
      return json(cors, { success: true, data });
    }

    // ── send_confirmation (manual, e.g. after an email failure) ────────
    if (action === "send_confirmation") {
      const orderId = String(body?.orderId ?? "");
      const { data: o } = await supabase.from("orders").select("created_via, payment_status, is_historical, email").eq("id", orderId).maybeSingle();
      if (!o) return json(cors, { error: "Order not found" }, 404);
      if (o.is_historical === true) return json(cors, { error: "Historical order: no email is ever sent", reason: "historical" }, 409);
      if (!String(o.email ?? "").trim()) return json(cors, { error: "This order has no email address", reason: "no_email" }, 409);
      if (o.created_via !== "admin") return json(cors, { error: "Only orders created from the Admin are handled here" }, 409);
      if (o.payment_status !== "paid") return json(cors, { error: "The order must be paid before the confirmation is sent" }, 409);
      const result = await sendManualConfirmation(supabase, orderId);
      return json(cors, { success: result.sent, email: { requested: true, ...result } }, result.sent ? 200 : 502);
    }

    return json(cors, { error: `Unknown action: ${action}` }, 400);
  } catch (error) {
    console.error("manage-manual-order error:", error);
    return json(cors, { error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
