import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { corsHeaders } from "../_shared/cors.ts";
import { adminPinOk, requireAdmin } from "../_shared/admin-auth.ts";
import { isAwaitingDecision, isManualOrder, type ProdOrder } from "../_shared/production-stats.ts";
import { renderCakeOrderConfirmationEmail } from "../_shared/cake-order-confirmation-email.ts";
import { renderWorkshopConfirmationEmail, type WorkshopItem } from "../_shared/workshop-confirmation-email.ts";
import { renderOrderReceivedEmail } from "../_shared/order-received-email.ts";
import { type ConfirmationMoney, showMoneyRows } from "../_shared/confirmation-money.ts";

// Admin > fiche commande, bloc « Confirmation » (13.10.2026, F29).
//
// Actions (admin connectée ; PIN de la session, ou PIN saisi, pour écrire) :
//   status        lecture : e-mail de la commande, e-mail de la fiche client,
//                 quel e-mail peut partir (ou pourquoi pas), facture, montants,
//                 historique des renvois et corrections.
//   update_email  corrige orders.email de CETTE commande seulement (la fiche
//                 client et le compte ne changent pas) ; ancienne adresse
//                 gardée dans order_email_events.
//   send          envoie l'e-mail à l'adresse actuelle de la commande :
//                   - commande du site « À accepter »   → « Commande reçue »
//                   - commande manuelle non payée       → la confirmation, avec
//                                                         « Le montant restant de … CHF
//                                                         sera à régler sur place. »
//                                                         (elle reste non payée)
//                   - commande acceptée / payée         → la confirmation
//                 avec le modèle existant (gâteau / mixte ou workshop), relu au
//                 moment de l'envoi : seuls les articles et places encore
//                 actifs ; montants lus dans la compta (order_confirmation_money).
//
// Ce renvoi n'envoie QUE l'e-mail : aucune commande créée, aucun paiement,
// aucune réservation ni aucun statut modifié (seule order_email_events est
// écrite, et orders.email par update_email). Refusé pour un brouillon, une
// commande annulée, refusée ou en échec. Un double clic ne peut pas envoyer
// deux fois : une seule ligne « sending » par commande (index unique) et la
// même clé Resend (Idempotency-Key) pour la même demande.
//
// Facture : comme le premier e-mail — jointe seulement si la commande en
// avait une (orders.invoice_path), et seulement si elle est encore juste
// (aucun article ni place annulé ou refusé depuis). Sinon elle n'est pas
// jointe (« not_current ») : on ne renvoie jamais une facture devenue fausse.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const KEY_RE = /^[A-Za-z0-9_-]{8,80}$/;
const STALE_MS = 5 * 60 * 1000;
const FROM = "contact@bentocakestudio.ch";

type Kind = "confirmation" | "payment_due" | "order_received";
type Blocked = "draft" | "cancelled" | "refused" | "failed" | "no_email" | "awaiting_decision" | "not_paid" | "nothing_left" | "use_manual_panel" | "historical";

const json = (cors: Record<string, string>, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
type Row = any;

interface Loaded {
  order: Row;
  items: Row[];
  fulfillments: Row[];
  activeItems: Row[];
  changed: boolean;       // un article / des places annulés ou refusés
  money: ConfirmationMoney;
  customerEmail: string | null;
}

async function load(supabase: Row, orderId: string): Promise<Loaded | null> {
  const { data: order, error: oErr } = await supabase.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (oErr) throw new Error(`orders: ${oErr.message}`);
  if (!order) return null;
  const [{ data: items, error: iErr }, { data: fulfillments, error: fErr }, { data: reservations, error: rErr }, { data: cancels, error: cErr }] = await Promise.all([
    supabase.from("order_items").select("*").eq("order_id", orderId).order("created_at", { ascending: true }),
    supabase.from("order_fulfillments").select("*").eq("order_id", orderId),
    supabase.from("workshop_reservations").select("order_item_id, status, purchased_seats, cancelled_seats, created_at").eq("order_id", orderId),
    supabase.from("order_manual_refunds").select("order_item_id, status").eq("order_id", orderId).eq("cancels_item", true),
  ]);
  if (iErr) throw new Error(`order_items: ${iErr.message}`);
  if (fErr) throw new Error(`order_fulfillments: ${fErr.message}`);
  if (rErr) throw new Error(`workshop_reservations: ${rErr.message}`);
  if (cErr) throw new Error(`order_manual_refunds: ${cErr.message}`);

  // Articles encore actifs — mêmes règles que la compta (sales_lines) :
  // article annulé (production_status ou remboursement « annule l'article »),
  // partie gâteau refusée, places de workshop annulées.
  const cancelledIds = new Set<string>((cancels ?? []).filter((c: Row) => !["voided", "rejected", "duplicate"].includes(c.status)).map((c: Row) => c.order_item_id));
  const physicalRefused = order.physical_validation === "rejected";
  let changed = false;
  const activeItems: Row[] = [];
  for (const it of items ?? []) {
    if (it.production_status === "cancelled" || cancelledIds.has(it.id) || (physicalRefused && it.product !== "workshop")) { changed = true; continue; }
    if (it.product === "workshop") {
      const res = (reservations ?? []).filter((r: Row) => r.order_item_id === it.id).sort((a: Row, b: Row) => String(a.created_at).localeCompare(String(b.created_at)))[0];
      if (res) {
        const purchased = Number(res.purchased_seats) || 0;
        const active = ["cancelled", "rejected"].includes(res.status) ? 0 : Math.max(purchased - (Number(res.cancelled_seats) || 0), 0);
        if (active === 0) { changed = true; continue; }
        if (active < purchased) {
          changed = true;
          const unit = Number(it.workshop_unit_price) || 0;
          activeItems.push({ ...it, workshop_participants: active, total: unit ? Math.round(unit * active * 100) / 100 : it.total });
          continue;
        }
      }
    }
    activeItems.push(it);
  }

  const { data: m, error: mErr } = await supabase.rpc("order_confirmation_money", { p_order_id: orderId });
  if (mErr) throw new Error(`order_confirmation_money: ${mErr.message}`);
  const row = Array.isArray(m) ? m[0] : m;
  const n = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100;
  const total = row?.in_sales ? n(row.kept_total) : n(order.total_amount);
  if (row?.in_sales && n(row.cancelled_total) > 0) changed = true;
  const paid = n(row?.collected);
  const money: ConfirmationMoney = {
    total,
    afterCancellation: changed,
    paid,
    toPay: 0,
    refunded: n(row?.refunded),
    refundDue: n(row?.refund_due),
  };

  let customerEmail: string | null = null;
  if (order.customer_ref_id) {
    const { data: c } = await supabase.from("customers").select("email, merged_into").eq("id", order.customer_ref_id).maybeSingle();
    customerEmail = c?.email ? String(c.email) : null;
  }
  return { order, items: items ?? [], fulfillments: fulfillments ?? [], activeItems, changed, money, customerEmail };
}

/** Quel e-mail peut partir pour cette commande, ou pourquoi pas. */
export function decide(d: Loaded): { kind: Kind | null; blocked: Blocked | null } {
  const o = d.order;
  const block = (b: Blocked) => ({ kind: null, blocked: b });
  if (o.is_draft === true) return block("draft");
  // F30 : commande historique (réalisée avant le site) — jamais d'e-mail.
  if (o.is_historical === true) return block("historical");
  if (o.order_validation === "cancelled") return block("cancelled");
  if (o.order_validation === "rejected") return block("refused");
  if (o.order_failure_reason || ["failed", "cancelled"].includes(o.payment_status)) return block("failed");
  const manual = isManualOrder(o as ProdOrder);
  let kind: Kind | null = null;
  if (!manual && isAwaitingDecision(o as ProdOrder)) {
    // Seul « Commande reçue » est déjà parti (commande avec gâteau) ; un
    // workshop seul n'a encore rien reçu : l'accepter envoie la confirmation.
    if (!d.items.some((it) => it.product !== "workshop")) return block("awaiting_decision");
    kind = "order_received";
  } else if (["paid", "refunded"].includes(o.payment_status)) {
    // Commande manuelle payée dont la confirmation n'est jamais partie : le
    // bloc « Commande manuelle » l'envoie (il crée aussi la facture acquittée).
    if (manual && !o.manual_confirmation_sent_at && o.created_via === "admin") return block("use_manual_panel");
    kind = "confirmation";
  }
  else if (manual && o.payment_status === "pending") kind = "payment_due";
  else return block("not_paid");
  if (kind !== "order_received" && d.activeItems.length === 0) return block("nothing_left");
  if (!o.email || !EMAIL_RE.test(String(o.email))) return { kind, blocked: "no_email" };
  return { kind, blocked: null };
}

/** E-mail rendu (sujet + HTML) et facture à joindre, sans rien envoyer. */
export function renderFor(d: Loaded, kind: Kind): { subject: string; html: string; invoice: "stored" | "none" | "not_current"; workshopOnly: boolean } {
  const o = d.order;
  if (kind === "order_received") {
    const { subject, html } = renderOrderReceivedEmail(o, d.items, d.fulfillments);
    return { subject, html, invoice: "none", workshopOnly: false };
  }
  const paymentDue = kind === "payment_due";
  const money: ConfirmationMoney = { ...d.money, toPay: paymentDue ? Math.max(Math.round((d.money.total - d.money.paid) * 100) / 100, 0) : 0 };
  // Paiement sur place : le montant restant est toujours passé (phrase sous le titre).
  const opts = { paymentDue, money: paymentDue || showMoneyRows({ paymentDue, money }) ? money : undefined };
  const physical = d.activeItems.filter((it) => it.product !== "workshop");
  const workshopOnly = physical.length === 0;
  const { subject, html } = workshopOnly
    ? renderWorkshopConfirmationEmail(o, d.activeItems as WorkshopItem[], { confirmed: true, ...opts })
    : renderCakeOrderConfirmationEmail(o, d.activeItems, d.fulfillments, opts);
  const invoice = paymentDue || !o.invoice_path ? "none" : d.changed ? "not_current" : "stored";
  return { subject, html, invoice, workshopOnly };
}

const buttonOf = (kind: Kind | null, sentBefore: boolean) =>
  kind === "order_received" ? "resend_received" : sentBefore ? "resend" : "send";

serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json(cors, { error: "Method not allowed" }, 405);

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
    const body = await req.json().catch(() => ({}));
    const admin = await requireAdmin(req, supabase, { body });
    if (!admin) return json(cors, { error: "Admin sign-in required" }, 401);

    const action = String(body?.action ?? "");
    const orderId = typeof body?.orderId === "string" ? body.orderId : "";
    if (!/^[0-9a-f-]{36}$/i.test(orderId)) return json(cors, { error: "orderId invalide" }, 400);

    const events = async () => {
      const { data, error } = await supabase.from("order_email_events")
        .select("id, kind, email, previous_email, status, invoice, error, created_by, created_at, finished_at")
        .eq("order_id", orderId).order("created_at", { ascending: false }).limit(20);
      if (error) throw new Error(`order_email_events: ${error.message}`);
      return data ?? [];
    };

    // ── status (lecture) ────────────────────────────────────────────────
    if (action === "status") {
      const d = await load(supabase, orderId);
      if (!d) return json(cors, { error: "Commande introuvable" }, 404);
      const { kind, blocked } = decide(d);
      const history = await events();
      const sentBefore = history.some((e: Row) => e.status === "sent" && e.kind !== "order_received")
        || !!d.order.manual_confirmation_sent_at
        || (!isManualOrder(d.order as ProdOrder) && kind === "confirmation");
      const preview = kind && !blocked ? renderFor(d, kind) : null;
      return json(cors, {
        email: d.order.email ?? null,
        customerEmail: d.customerEmail,
        kind, blocked,
        button: buttonOf(kind, sentBefore),
        invoice: preview?.invoice ?? null,
        subject: preview?.subject ?? null,
        changed: d.changed,
        money: d.money,
        lastSent: history.find((e: Row) => e.status === "sent" && e.kind !== "email_change") ?? null,
        history,
      });
    }

    if (!adminPinOk(admin, body?.pin)) return json(cors, { error: "Invalid PIN" }, 403);

    // ── update_email ────────────────────────────────────────────────────
    if (action === "update_email") {
      const next = String(body?.email ?? "").trim().toLowerCase();
      if (!EMAIL_RE.test(next) || next.length > 254) return json(cors, { error: "Adresse e-mail invalide", reason: "invalid_email" }, 400);
      const { data: o, error } = await supabase.from("orders").select("id, email").eq("id", orderId).maybeSingle();
      if (error) throw new Error(error.message);
      if (!o) return json(cors, { error: "Commande introuvable" }, 404);
      const previous = o.email ?? "";
      if (previous.trim().toLowerCase() === next) return json(cors, { success: true, unchanged: true, email: previous });
      // Optimiste : refusé si l'adresse a changé entre-temps (autre fenêtre).
      const expected = typeof body?.expectedEmail === "string" ? body.expectedEmail : previous;
      if (expected !== previous) return json(cors, { error: "L'adresse a déjà été modifiée", reason: "email_changed", email: previous }, 409);
      const { data: upd, error: uErr } = await supabase.from("orders").update({ email: next }).eq("id", orderId).eq("email", previous).select("id");
      if (uErr) throw new Error(uErr.message);
      if (!upd || upd.length !== 1) return json(cors, { error: "L'adresse a déjà été modifiée", reason: "email_changed" }, 409);
      const { error: eErr } = await supabase.from("order_email_events").insert({
        order_id: orderId, kind: "email_change", email: next, previous_email: previous, status: "done",
        idempotency_key: `email-change-${crypto.randomUUID()}`, created_by: admin.email, finished_at: new Date().toISOString(),
      });
      if (eErr) console.error("resend-order-confirmation: email change saved but not logged:", eErr);
      return json(cors, { success: true, email: next, previousEmail: previous });
    }

    // ── send ────────────────────────────────────────────────────────────
    if (action === "send") {
      const key = String(body?.idempotencyKey ?? "");
      if (!KEY_RE.test(key)) return json(cors, { error: "idempotencyKey invalide" }, 400);
      const d = await load(supabase, orderId);
      if (!d) return json(cors, { error: "Commande introuvable" }, 404);
      const { kind, blocked } = decide(d);
      if (!kind || blocked) return json(cors, { error: "Envoi impossible", reason: blocked }, 409);
      // La confirmation affichée à l'écran doit être la bonne adresse.
      if (typeof body?.expectedEmail !== "string" || body.expectedEmail !== d.order.email) {
        return json(cors, { error: "L'adresse de la commande a changé : rechargez la page", reason: "email_changed", email: d.order.email }, 409);
      }

      // Même demande déjà traitée (double clic, réseau) → même réponse.
      const { data: prev } = await supabase.from("order_email_events").select("*").eq("idempotency_key", key).maybeSingle();
      if (prev?.status === "sent") return json(cors, { success: true, alreadySent: true, email: prev.email, sentAt: prev.finished_at, invoice: prev.invoice, kind: prev.kind });
      if (prev?.status === "sending") return json(cors, { error: "Envoi déjà en cours", reason: "in_progress" }, 409);

      // Un envoi resté « sending » (fonction interrompue) n'empêche pas un nouvel essai.
      const { data: stuck } = await supabase.from("order_email_events").select("id, created_at").eq("order_id", orderId).eq("status", "sending");
      for (const s of stuck ?? []) {
        if (Date.now() - Date.parse(s.created_at) > STALE_MS) {
          await supabase.from("order_email_events").update({ status: "error", error: "interrompu", finished_at: new Date().toISOString() }).eq("id", s.id).eq("status", "sending");
        }
      }

      const rendered = renderFor(d, kind);
      let eventId: string;
      if (prev) {
        const { data: claim } = await supabase.from("order_email_events")
          .update({ status: "sending", error: null, email: d.order.email, invoice: rendered.invoice }).eq("id", prev.id).eq("status", "error").select("id");
        if (!claim || claim.length !== 1) return json(cors, { error: "Envoi déjà en cours", reason: "in_progress" }, 409);
        eventId = prev.id;
      } else {
        const { data: ins, error: insErr } = await supabase.from("order_email_events").insert({
          order_id: orderId, kind, email: d.order.email, status: "sending", idempotency_key: key, invoice: rendered.invoice, created_by: admin.email,
        }).select("id");
        if (insErr || !ins?.[0]) return json(cors, { error: "Envoi déjà en cours", reason: "in_progress" }, 409);
        eventId = ins[0].id;
      }

      const finish = (fields: Record<string, unknown>) =>
        supabase.from("order_email_events").update({ ...fields, finished_at: new Date().toISOString() }).eq("id", eventId);

      try {
        const resendKey = Deno.env.get("RESEND_API_KEY");
        if (!resendKey) throw new Error("RESEND_API_KEY not configured");
        // deno-lint-ignore no-explicit-any
        const payload: any = { from: FROM, to: [d.order.email], subject: rendered.subject, html: rendered.html };
        if (rendered.invoice === "stored") {
          const { data: blob, error: dlErr } = await supabase.storage.from("invoice").download(d.order.invoice_path);
          if (dlErr || !blob) throw new Error(`Facture introuvable (${dlErr?.message ?? "fichier vide"})`);
          const bytes = new Uint8Array(await blob.arrayBuffer());
          let bin = "";
          for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          const num = d.order.invoice_number || d.order.order_number || "facture";
          const fr = d.order.lang !== "en";
          payload.attachments = [{ filename: rendered.workshopOnly && !isManualOrder(d.order as ProdOrder) ? `${num}.pdf` : `${fr ? "Facture" : "Invoice"}_${num}.pdf`, content: btoa(bin) }];
        }
        const resp = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json", "Idempotency-Key": `order-email-${key}` },
          body: JSON.stringify(payload),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(`Resend ${resp.status}: ${data?.message ?? JSON.stringify(data).slice(0, 300)}`);
        await finish({ status: "sent", resend_email_id: data?.id ?? null });
        return json(cors, { success: true, email: d.order.email, kind, invoice: rendered.invoice, sentAt: new Date().toISOString(), emailId: data?.id ?? null });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await finish({ status: "error", error: msg.slice(0, 500) });
        console.error(`resend-order-confirmation: send failed for ${orderId}:`, msg);
        return json(cors, { error: msg, reason: "send_failed" }, 502);
      }
    }

    return json(cors, { error: "Action inconnue" }, 400);
  } catch (error) {
    console.error("resend-order-confirmation error:", error);
    return json(cors, { error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
