import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { requireAdmin } from "../_shared/admin-auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  quoteManualOrder,
  type AdjustmentType,
  type QuoteFulfillmentInput,
  type QuoteItemInput,
} from "../_shared/manual-order-quote.ts";
import { FLAVOUR_BY_ID, resolveFlavour } from "../_shared/production-catalog.ts";

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
// Mark-as-paid, cancellation and the confirmation email are later actions.

const json = (cors: Record<string, string>, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
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
  workshop_sponge_choices?: string[] | null;
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

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const strOrNull = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

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
      const editorItems = (items ?? []).map((it: any, idx: number) => {
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
        };
      });
      const edit = editableState(o);
      return json(cors, {
        orderId: o.id,
        orderNumber: o.order_number,
        isDraft: !!o.is_draft,
        paymentStatus: o.payment_status,
        editable: edit.ok,
        notEditableReason: edit.reason ?? null,
        customer: {
          first_name: o.first_name, last_name: o.last_name, phone: o.phone, email: o.email,
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

      // Prices — always recomputed with the checkout's engine.
      const quote = await quoteManualOrder(supabase, {
        items,
        fulfillments,
        adjustment: adj ? { type: adj.type, value: adj.value } : null,
      });

      if (mode === "confirm") {
        const problems: string[] = [];
        if (!customer.first_name) problems.push("First name is required");
        if (!customer.last_name) problems.push("Last name is required");
        if (!customer.phone) problems.push("Phone is required");
        if (!EMAIL_RE.test(customer.email)) problems.push("A valid email is required");
        if (!quote.ok) {
          problems.push(...quote.errors);
          quote.items.forEach((r) => r.error && problems.push(`Item ${r.index + 1}: ${r.error}`));
          quote.fulfillments.forEach((f) => f.error && problems.push(`Date ${f.index + 1}: ${f.error}`));
          if (quote.errors.length === 0 && quote.totals.calculated === null && problems.length === 0) problems.push("The price could not be calculated");
        }
        if (adj && quote.adjustment.amount !== 0 && !adj.reason) problems.push("Choose a reason for the price adjustment");
        items.forEach((it, i) => {
          if (it.product === "workshop") {
            const n = Number(it.workshop_participants) || 0;
            const ch = it.workshop_sponge_choices ?? [];
            if (ch.length !== n || !ch.every((x) => x === "vanilla" || x === "chocolate")) problems.push(`Item ${i + 1}: choose the sponge of each participant`);
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

      const orderFields: Record<string, unknown> = {
        order_source: "manual order",   // → ORDM-/INV- numbers from the live trigger
        created_via: "admin",
        is_draft: mode === "draft",
        order_channel: customer.channel,
        first_name: customer.first_name,
        last_name: customer.last_name,
        phone: customer.phone,
        email: customer.email,
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
      const { data: oldItems } = existing ? await supabase.from("order_items").select("id, fulfillment_id").eq("order_id", orderId) : { data: [] };
      const { data: oldFuls } = existing ? await supabase.from("order_fulfillments").select("*").eq("order_id", orderId) : { data: [] };
      let newFulIds: string[] = [];
      let newItemIds: string[] = [];
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
            workshop_has_minor: isWorkshop ? !!it.workshop_has_minor : false,
            workshop_minor_consent_confirmed: isWorkshop ? !!it.workshop_minor_consent_confirmed : false,
          };
        });
        const { data: insI, error: iErr } = await supabase.from("order_items").insert(itemRows).select("id");
        if (iErr) throw new Error(`Failed to save products: ${iErr.message}`);
        newItemIds = (insI ?? []).map((r: { id: string }) => r.id);

        // 4. Old items, then the order fields.
        if ((oldItems ?? []).length > 0) {
          const { error } = await supabase.from("order_items").delete().in("id", (oldItems ?? []).map((r: { id: string }) => r.id));
          if (error) throw new Error(`Failed to replace products: ${error.message}`);
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
          for (const it of (oldItems ?? []) as { id: string; fulfillment_id: string | null }[]) {
            if (it.fulfillment_id) await supabase.from("order_items").update({ fulfillment_id: it.fulfillment_id }).eq("id", it.id);
          }
        }
        throw e;
      }

      const { data: saved } = await supabase.from("orders").select("id, order_number, is_draft, total_amount, calculated_amount").eq("id", orderId).single();
      return json(cors, { success: true, orderId, orderNumber: saved?.order_number ?? null, isDraft: saved?.is_draft ?? (mode === "draft"), quote });
    }

    return json(cors, { error: `Unknown action: ${action}` }, 400);
  } catch (error) {
    console.error("manage-manual-order error:", error);
    return json(cors, { error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
