/**
 * Cree une transaction PostFinance Checkout et renvoie l'URL de la page de
 * paiement. Le client est ensuite redirige dessus.
 *
 * L'argent n'est pas encaisse ici : la transaction est creee en
 * COMPLETE_DEFERRED, donc seulement autorisee. L'encaissement a lieu quand la
 * commande est acceptee (fonction manage-order).
 *
 * Aucune ligne orders/order_items n'existe encore a ce stade. order/orderItems
 * (fournis par le navigateur, deja au format des tables Supabase) sont
 * simplement stages dans pending_payments, la commande n'est reellement
 * creee que par postfinance-webhook une fois l'autorisation confirmee — cree
 * une fausse commande ici, avant meme de savoir si le paiement aboutit,
 * gacherait un order_number pour rien a chaque panier abandonne ou refuse.
 * Consequence assumee : le montant vient du navigateur, pas d'une ligne
 * Supabase deja verifiee ; c'est le meme modele de confiance que l'ancien
 * flux valide (create-postfinance-payment / confirm-postfinance-payment).
 */
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { PF } from "../_shared/postfinance.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface CartItem {
  sizeName: string;
  shapeName: string;
  flavorName: string;
  styleName?: string;
  extrasNames: string[];
  total: number;
}

interface PaymentRequest {
  orderId: string;
  order: Record<string, unknown>;
  orderItems: Record<string, unknown>[];
  items?: CartItem[];
  deliveryOption?: string;
  deliveryAddress?: string;
  deliveryFee?: number;
  language?: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: PaymentRequest = await req.json();
    const { orderId, order, orderItems, items = [], deliveryOption, deliveryAddress, deliveryFee = 0, language } = body;

    if (!orderId) throw new Error("orderId manquant");
    if (!order) throw new Error("order manquant");
    if (!orderItems || orderItems.length === 0) throw new Error("orderItems manquant");
    if (!order.email) throw new Error("Email du client manquant");

    const orderTotal = round2(Number(order.total_amount));
    if (!(orderTotal > 0)) throw new Error("Montant de commande invalide");

    // 1. Lignes de la commande, pour l'affichage sur la page de paiement.
    const lineItems = items.map((item, i) => ({
      uniqueId: `item-${i + 1}`,
      name: [`${item.sizeName} ${item.shapeName}`.trim(), item.flavorName, item.styleName]
        .filter(Boolean)
        .join(" • ")
        .slice(0, 150),
      quantity: 1,
      amountIncludingTax: round2(Number(item.total) || 0),
      type: "PRODUCT",
      shippingRequired: false,
    }));

    if (deliveryOption === "delivery" && deliveryFee > 0) {
      lineItems.push({
        uniqueId: "delivery",
        name: (deliveryAddress ? `Livraison — ${deliveryAddress}` : "Livraison").slice(0, 150),
        quantity: 1,
        amountIncludingTax: round2(Number(deliveryFee)),
        type: "SHIPPING",
        shippingRequired: false,
      });
    }

    // PostFinance exige que la somme des lignes soit exactement le montant du.
    const sum = round2(lineItems.reduce((a, l) => a + l.amountIncludingTax, 0));
    let finalLineItems = lineItems;
    if (lineItems.length === 0 || Math.abs(sum - orderTotal) > 0.005) {
      console.warn(
        `Lignes (${sum}) differentes du total de la commande (${orderTotal}) : on utilise une ligne unique.`,
      );
      finalLineItems = [
        {
          uniqueId: "order",
          name: `Commande ${orderId}`.slice(0, 150),
          quantity: 1,
          amountIncludingTax: orderTotal,
          type: "PRODUCT",
          shippingRequired: false,
        },
      ];
    }

    const origin = req.headers.get("origin") || "https://dimsoon58.github.io/mini-cake-corner";

    // 2. Creation de la transaction, autorisation seule. merchantReference
    // utilise orderId : order_number n'existe pas encore, la vraie commande
    // n'est pas encore creee.
    const created = await PF.createTransaction({
      currency: "CHF",
      lineItems: finalLineItems,
      merchantReference: String(orderId).slice(0, 100),
      customerEmailAddress: String(order.email),
      customerId: String(orderId),
      language: language === "fr" ? "fr-CH" : "en-GB",
      completionBehavior: "COMPLETE_DEFERRED",
      autoConfirmationEnabled: true,
      successUrl: `${origin}/payment-success?order=${encodeURIComponent(orderId)}`,
      failedUrl: `${origin}/payment-failed?order=${encodeURIComponent(orderId)}`,
      metaData: { order_id: String(orderId) },
    });

    if (!created.ok) {
      throw new Error(`PostFinance a refuse la creation de la transaction (${created.status}) : ${created.raw.slice(0, 400)}`);
    }

    const transaction = created.body as { id?: number | string };
    const transactionId = transaction?.id;
    if (!transactionId) {
      throw new Error(`Reponse PostFinance sans identifiant de transaction : ${created.raw.slice(0, 400)}`);
    }

    // 3. On met en attente la commande complete — postfinance-webhook la
    // recreera dans orders/order_items des la premiere autorisation
    // confirmee, jamais avant.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { error: stagingError } = await supabase.from("pending_payments").insert({
      order_id: orderId,
      postfinance_transaction_id: String(transactionId),
      payload: { order, orderItems },
    });

    if (stagingError) {
      console.error("Impossible de mettre la commande en attente :", stagingError);
      throw new Error("Erreur d'enregistrement de la commande en attente");
    }

    // 4. URL de la page de paiement hebergee par PostFinance.
    const page = await PF.paymentPageUrl(transactionId);
    if (!page.ok) {
      throw new Error(`Impossible d'obtenir la page de paiement (${page.status}) : ${page.raw.slice(0, 400)}`);
    }

    const url = typeof page.body === "string" ? page.body : String(page.body ?? "").replace(/^"|"$/g, "");
    if (!url.startsWith("http")) {
      throw new Error(`URL de paiement inattendue : ${page.raw.slice(0, 200)}`);
    }

    console.log("Transaction PostFinance", transactionId, "pour la commande (en attente)", orderId);

    return new Response(JSON.stringify({ url, transactionId: String(transactionId) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("create-payment :", error);
    const message = error instanceof Error ? error.message : "Erreur inconnue";
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
