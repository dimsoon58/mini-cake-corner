/**
 * Webhook PostFinance Checkout.
 *
 * URL a declarer dans PostFinance (Space > Settings > General > Webhook URLs),
 * puis un listener sur l'entite Transaction :
 *   https://fgqwisxcpadrqgbjfdqj.supabase.co/functions/v1/postfinance-webhook
 *
 * Principe de securite : la notification recue n'est jamais crue sur parole.
 * Elle ne sert qu'a apprendre qu'une transaction a bouge ; l'etat reel est
 * ensuite relu directement aupres de l'API PostFinance avec nos identifiants.
 * Meme une fausse notification ne peut donc pas faire passer une commande en
 * payee.
 *
 * Deux cas selon que la commande existe deja ou non :
 *  - pending_payments contient encore la ligne (order_id) : c'est la
 *    PREMIERE notification pour cette transaction. Si l'etat reel est
 *    AUTHORIZED/COMPLETED, on cree enfin la vraie ligne orders puis tous les
 *    order_items a partir du payload en attente, on supprime la ligne
 *    pending_payments, et on declenche notify-order + send-make-webhook —
 *    seulement une fois ces donnees reellement enregistrees. Si l'etat reel
 *    est un echec/annulation, aucune commande n'est jamais creee : on
 *    nettoie juste pending_payments.
 *  - Sinon, la commande existe deja (notification suivante, ex. capture
 *    confirmee) : on se contente de mettre a jour son payment_status, comme
 *    avant.
 */
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { PF, mapPaymentStatus } from "../_shared/postfinance.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-signature",
};

interface WebhookPayload {
  entityId?: number | string;
  spaceId?: number | string;
  listenerEntityTechnicalName?: string;
  state?: string;
  timestamp?: string;
}

/** Libelle lisible du moyen de paiement, pour les emails et la facture. */
function paymentMethodLabel(tx: Record<string, unknown>): string | null {
  const conf = tx?.paymentConnectorConfiguration as Record<string, unknown> | undefined;
  const direct = (tx?.paymentMethodBrand as Record<string, unknown> | undefined)?.name;
  const name = (direct || conf?.name || "") as string;
  const n = String(name).toLowerCase();

  if (!n) return null;
  if (n.includes("twint")) return "TWINT";
  if (n.includes("postfinance")) return "PostFinance Pay";
  if (n.includes("visa")) return "Visa";
  if (n.includes("master")) return "Mastercard";
  if (n.includes("apple")) return "Apple Pay";
  if (n.includes("google")) return "Google Pay";
  return String(name);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const payload: WebhookPayload = await req.json();
    console.log("Webhook PostFinance recu :", JSON.stringify(payload));

    const entity = String(payload.listenerEntityTechnicalName || "").toLowerCase();
    if (entity && !entity.includes("transaction")) {
      // Un listener sur une autre entite : on accuse reception sans rien faire.
      return new Response(JSON.stringify({ ignored: entity }), {
        headers: { ...cors, "Content-Type": "application/json" },
        status: 200,
      });
    }

    const transactionId = payload.entityId;
    if (!transactionId) {
      return new Response(JSON.stringify({ error: "entityId manquant" }), {
        headers: { ...cors, "Content-Type": "application/json" },
        status: 400,
      });
    }

    // 1. Source de verite : on relit la transaction chez PostFinance.
    const read = await PF.readTransaction(transactionId);
    if (!read.ok) {
      console.error("Lecture de la transaction impossible :", read.status, read.raw.slice(0, 400));
      // 500 : PostFinance reessaiera plus tard.
      return new Response(JSON.stringify({ error: "lecture transaction impossible" }), {
        headers: { ...cors, "Content-Type": "application/json" },
        status: 500,
      });
    }

    const tx = read.body as Record<string, unknown>;
    const realState = String(tx?.state || "");
    const paymentStatus = mapPaymentStatus(realState);

    console.log("Transaction", transactionId, "etat reel :", realState, "->", paymentStatus);

    if (!paymentStatus) {
      // Etat intermediaire (PENDING, PROCESSING...) : rien a ecrire.
      return new Response(JSON.stringify({ state: realState, updated: false }), {
        headers: { ...cors, "Content-Type": "application/json" },
        status: 200,
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 2. La commande existe-t-elle deja, ou est-ce encore en attente ?
    const { data: pending, error: pendingError } = await supabase
      .from("pending_payments")
      .select("*")
      .eq("postfinance_transaction_id", String(transactionId))
      .maybeSingle();

    if (pendingError) {
      console.error("Lecture de pending_payments impossible :", pendingError);
      return new Response(JSON.stringify({ error: "lecture pending_payments impossible" }), {
        headers: { ...cors, "Content-Type": "application/json" },
        status: 500,
      });
    }

    if (pending) {
      // ── Premiere notification pour cette transaction ──────────────────
      if (paymentStatus === "failed" || paymentStatus === "voided") {
        // Le paiement n'a jamais abouti : aucune commande n'est creee.
        await supabase.from("pending_payments").delete().eq("order_id", pending.order_id);
        return new Response(
          JSON.stringify({ orderId: pending.order_id, state: realState, created: false }),
          { headers: { ...cors, "Content-Type": "application/json" }, status: 200 },
        );
      }

      // authorized (ou paid directement) : on cree enfin la vraie commande.
      const { order, orderItems } = pending.payload as {
        order: Record<string, unknown>;
        orderItems: Record<string, unknown>[];
      };

      const label = paymentMethodLabel(tx);
      const orderInsert: Record<string, unknown> = {
        ...order,
        id: pending.order_id,
        postfinance_transaction_id: String(transactionId),
        payment_status: paymentStatus,
      };
      if (label) orderInsert.payment_method = label;
      if (paymentStatus === "paid") orderInsert.paid_at = new Date().toISOString();

      const { data: insertedOrder, error: orderError } = await supabase
        .from("orders").insert(orderInsert).select().single();

      if (orderError || !insertedOrder) {
        console.error("Creation de la commande impossible :", orderError);
        // 500 : pending_payments reste intact, PostFinance reessaiera le
        // webhook et on retentera la creation depuis les memes donnees.
        return new Response(JSON.stringify({ error: "creation commande impossible" }), {
          headers: { ...cors, "Content-Type": "application/json" },
          status: 500,
        });
      }

      const itemsWithOrderId = (orderItems || []).map((item) => ({
        ...item,
        order_id: insertedOrder.id,
      }));

      const { error: itemsError } = await supabase.from("order_items").insert(itemsWithOrderId);

      if (itemsError) {
        console.error("Creation des order_items impossible :", itemsError);
        // On annule la commande pour qu'une relance reparte sur une base propre.
        await supabase.from("orders").delete().eq("id", insertedOrder.id);
        return new Response(JSON.stringify({ error: "creation order_items impossible" }), {
          headers: { ...cors, "Content-Type": "application/json" },
          status: 500,
        });
      }

      await supabase.from("pending_payments").delete().eq("order_id", pending.order_id);

      // 3. Commande et articles reellement enregistres : on previent
      // maintenant la patissiere et Make — jamais avant ce point.
      try {
        await supabase.functions.invoke("notify-order", { body: { orderId: insertedOrder.id } });
      } catch (e) {
        console.error("notify-order :", e);
      }
      try {
        await supabase.functions.invoke("send-make-webhook", { body: { orderId: insertedOrder.id } });
      } catch (e) {
        console.error("send-make-webhook :", e);
      }

      return new Response(
        JSON.stringify({ orderId: insertedOrder.id, state: realState, payment_status: paymentStatus, created: true }),
        { headers: { ...cors, "Content-Type": "application/json" }, status: 200 },
      );
    }

    // ── La commande existe deja : notification suivante (ex. capture) ────
    let orderQuery = await supabase
      .from("orders")
      .select("id, payment_status")
      .eq("postfinance_transaction_id", String(transactionId))
      .maybeSingle();

    if (!orderQuery.data) {
      const metaOrderId = (tx?.metaData as Record<string, string> | undefined)?.order_id;
      if (metaOrderId) {
        orderQuery = await supabase
          .from("orders")
          .select("id, payment_status")
          .eq("id", metaOrderId)
          .maybeSingle();
      }
    }

    const order = orderQuery.data;
    if (!order) {
      console.error("Aucune commande ni pending_payments pour la transaction", transactionId);
      // 200 : inutile que PostFinance reessaie indefiniment pour une
      // transaction qu'on ne retrouve nulle part.
      return new Response(JSON.stringify({ error: "commande introuvable" }), {
        headers: { ...cors, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // On n'ecrase jamais un paiement deja encaisse par un etat anterieur.
    if (order.payment_status === "paid" && paymentStatus === "authorized") {
      return new Response(JSON.stringify({ skipped: "deja encaisse" }), {
        headers: { ...cors, "Content-Type": "application/json" },
        status: 200,
      });
    }

    const update: Record<string, unknown> = {
      payment_status: paymentStatus,
      postfinance_transaction_id: String(transactionId),
    };

    const label = paymentMethodLabel(tx);
    if (label) update.payment_method = label;
    if (paymentStatus === "paid") update.paid_at = new Date().toISOString();

    const { error: updateError } = await supabase
      .from("orders")
      .update(update)
      .eq("id", order.id);

    if (updateError) {
      console.error("Mise a jour de la commande impossible :", updateError);
      return new Response(JSON.stringify({ error: "mise a jour impossible" }), {
        headers: { ...cors, "Content-Type": "application/json" },
        status: 500,
      });
    }

    return new Response(
      JSON.stringify({ orderId: order.id, state: realState, payment_status: paymentStatus }),
      { headers: { ...cors, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (error) {
    console.error("postfinance-webhook :", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Erreur inconnue" }),
      { headers: { ...cors, "Content-Type": "application/json" }, status: 500 },
    );
  }
});
