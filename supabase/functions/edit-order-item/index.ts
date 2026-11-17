import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { requireAdmin } from "../_shared/admin-auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { CAKE_FLAVORS } from "../_shared/pricing.ts";
import { FLAVOUR_BY_ID, resolveFlavour } from "../_shared/production-catalog.ts";
import {
  CHRISTMAS_CLASSIC_FLAVOURS,
  CHRISTMAS_FLAVOUR_NAMES,
  LOG_FLAVOUR_SURCHARGES,
  christmasEditionCakeSurcharge,
  isChristmasCakeDesign,
  type ChristmasSize,
} from "../_shared/christmas.ts";

// F44 (07.11.2026) — modifier un gâteau déjà commandé, depuis Admin > commande.
// Commandes du site et commandes manuelles, payées ou non. Seulement Mel et
// Eli (administratrices), sans code PIN : aucun montant ne change.
//
// Modifiable : goût, couleur de base, couleurs de décoration (avec roses et
// bordure Heart Bomb), couleur et style du texte, texte, rubans, papillon,
// instructions particulières. Jamais : taille, forme, design, extras,
// bougies, prix. Bloqué : gâteau annulé, commande annulée, workshop.
//
// Un goût plus cher est accepté seulement avec une note (« offert », « payé
// en TWINT »…) : le supplément n'est jamais facturé automatiquement.
//
// Actions :
//   - list : historique des modifications de la commande (plus ancien d'abord).
//   - save : enregistre les champs modifiés d'un article + une ligne
//            d'historique par champ. Répond { needsNote, surcharge } sans rien
//            enregistrer quand une note est obligatoire et absente.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADMIN_NAMES: Record<string, string> = { "naglemelodie@gmail.com": "Mel", "e.potapushina@gmail.com": "Eli" };
const TEXT_FIELDS = ["base_color", "decoration_color", "text_color", "cake_text", "text_style", "ribbon_color", "butterfly_color", "item_comment"] as const;
type TextField = typeof TEXT_FIELDS[number];
const MAX_LEN: Record<TextField, number> = {
  base_color: 60, decoration_color: 300, text_color: 60, cake_text: 120, text_style: 20,
  ribbon_color: 60, butterfly_color: 60, item_comment: 2000,
};
const TEXT_STYLES = new Set(["normal", "uppercase", "cursive"]);
const PREFERRED_DESIGN_RE = /^\[Preferred design: Option \d+\]\s*/;

const json = (cors: Record<string, string>, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

class InputError extends Error {}

type Item = {
  id: string; order_id: string; product: string; size: string | null; design: string | null;
  flavors: string[] | null; production_status: string | null; extra: string | null; extra_color: string | null;
} & Record<TextField, string | null>;

// Goûts proposés pour cet article, avec leur supplément (CHF) pour sa taille.
// null = le goût ne se modifie pas pour ce produit.
function flavourSurcharge(item: Item, flavourId: string): number | undefined {
  const size = item.size ?? "";
  if (item.product === "christmas_log") return LOG_FLAVOUR_SURCHARGES[flavourId];
  if (item.product === "bento_cake" && isChristmasCakeDesign(item.design)) {
    return CHRISTMAS_CLASSIC_FLAVOURS.includes(flavourId)
      ? CAKE_FLAVORS[flavourId]?.[size as "bento"]
      : christmasEditionCakeSurcharge(flavourId, size as ChristmasSize);
  }
  if (item.product === "bento_cake" || item.product === "rectangle_cake") {
    return CAKE_FLAVORS[flavourId]?.[size as "bento"];
  }
  return undefined;
}

function flavourName(flavourId: string): string | null {
  return CHRISTMAS_FLAVOUR_NAMES[flavourId] ?? FLAVOUR_BY_ID.get(flavourId)?.names[0] ?? null;
}

// Goût actuel (nom enregistré) → son id, pour comparer les suppléments.
function currentFlavourId(item: Item): string | null {
  const name = (item.flavors ?? [])[0];
  if (!name) return null;
  const christmas = Object.entries(CHRISTMAS_FLAVOUR_NAMES).find(([, n]) => n.toLowerCase() === name.toLowerCase())?.[0];
  if (christmas && flavourSurcharge(item, christmas) !== undefined) return christmas;
  return resolveFlavour(name)?.id ?? null;
}

const clean = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") throw new InputError("Valeur invalide");
  const t = v.trim();
  return t === "" ? null : t;
};

serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json(cors, { error: "Method not allowed" }, 405);
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
    const body = await req.json().catch(() => ({}));
    const admin = await requireAdmin(req, supabase, { body, allowWithoutPinSession: true });
    if (!admin) return json(cors, { error: "Admin sign-in required", reason: "auth" }, 401);

    const action = String(body?.action ?? "");
    const orderId = String(body?.orderId ?? "");
    if (!UUID_RE.test(orderId)) throw new InputError("Commande inconnue");

    if (action === "list") {
      const { data, error } = await supabase
        .from("order_item_changes")
        .select("id, item_id, field, old_value, new_value, note, author_name, author_email, created_at")
        .eq("order_id", orderId)
        .order("created_at", { ascending: true });
      if (error) throw new Error(`Failed to load changes: ${error.message}`);
      return json(cors, { changes: data ?? [] });
    }

    if (action !== "save") throw new InputError("Action inconnue");
    const itemId = String(body?.itemId ?? "");
    if (!UUID_RE.test(itemId)) throw new InputError("Article inconnu");
    const changes = (body?.changes ?? {}) as Record<string, unknown>;
    const note = clean(body?.note);
    if (note && note.length > 1000) throw new InputError("Note trop longue");

    const { data: order, error: oErr } = await supabase.from("orders").select("id, order_validation, order_failure_reason").eq("id", orderId).maybeSingle();
    if (oErr) throw new Error(`Failed to load order: ${oErr.message}`);
    if (!order) throw new InputError("Commande inconnue");
    // Même règle que la page commande (isCancelled).
    if (order.order_validation === "cancelled" || order.order_failure_reason) throw new InputError("Commande annulée : modification impossible");

    const { data: rawItem, error: iErr } = await supabase
      .from("order_items")
      .select("id, order_id, product, size, design, flavors, production_status, extra, extra_color, " + TEXT_FIELDS.join(", "))
      .eq("id", itemId).eq("order_id", orderId).maybeSingle();
    if (iErr) throw new Error(`Failed to load item: ${iErr.message}`);
    if (!rawItem) throw new InputError("Article inconnu");
    const item = rawItem as unknown as Item;
    if (item.product === "workshop") throw new InputError("Un workshop ne se modifie pas ici");
    if (item.production_status === "cancelled") throw new InputError("Gâteau annulé : modification impossible");

    const update: Record<string, unknown> = {};
    const history: { field: string; old_value: string | null; new_value: string | null }[] = [];
    let surcharge = 0;

    // Goût
    if (changes.flavour !== undefined) {
      const id = clean(changes.flavour);
      if (!id) throw new InputError("Goût manquant");
      const next = flavourSurcharge(item, id);
      const name = flavourName(id);
      if (next === undefined || !name) throw new InputError("Ce goût n'est pas disponible pour ce gâteau");
      const oldName = (item.flavors ?? []).join(", ") || null;
      if (oldName !== name) {
        const curId = currentFlavourId(item);
        const cur = curId ? flavourSurcharge(item, curId) ?? 0 : 0;
        surcharge = Math.max(0, Math.round((next - cur) * 100) / 100);
        update.flavors = [name];
        history.push({ field: "flavors", old_value: oldName, new_value: name });
      }
    }

    // Champs texte
    for (const f of TEXT_FIELDS) {
      if (changes[f] === undefined) continue;
      let v = clean(changes[f]);
      if (v && v.length > MAX_LEN[f]) throw new InputError("Valeur trop longue");
      if (f === "text_style" && v && !TEXT_STYLES.has(v)) throw new InputError("Style de texte inconnu");
      if (f === "item_comment") {
        // Garde l'indication interne « [Preferred design: Option N] » du site.
        const tag = (item.item_comment ?? "").match(PREFERRED_DESIGN_RE)?.[0] ?? "";
        v = tag ? `${tag.trim()} ${v ?? ""}`.trim() : v;
      }
      const old = item[f] ?? null;
      if ((old ?? "") === (v ?? "")) continue;
      update[f] = v;
      history.push({ field: f, old_value: old, new_value: v });
      // Rubans / papillon : aussi dans le texte des extras (« Ribbon: Pink »), lu par les étiquettes et les e-mails.
      if ((f === "ribbon_color" || f === "butterfly_color") && old && v) {
        const label = f === "ribbon_color" ? "Ribbon" : "Butterfly";
        const extra = update.extra as string | undefined ?? item.extra;
        if (extra) update.extra = extra.replace(`${label}: ${old}`, `${label}: ${v}`);
        const ec = update.extra_color as string | undefined ?? item.extra_color;
        if (ec) update.extra_color = ec.split(",").map((s) => (s.trim() === old ? v : s.trim())).join(", ");
      }
    }

    if (history.length === 0) return json(cors, { ok: true, changed: 0 });
    if (surcharge > 0 && !note) return json(cors, { ok: false, needsNote: true, surcharge });

    const { error: uErr } = await supabase.from("order_items").update(update).eq("id", itemId).eq("order_id", orderId);
    if (uErr) throw new Error(`Failed to update item: ${uErr.message}`);
    const authorName = ADMIN_NAMES[admin.email] ?? admin.email;
    const fullNote = surcharge > 0 ? `Supplément de goût non facturé : CHF ${surcharge.toFixed(2)}. ${note}` : note;
    const { error: hErr } = await supabase.from("order_item_changes").insert(history.map((h) => ({
      order_id: orderId, item_id: itemId, ...h, note: fullNote, author_email: admin.email, author_name: authorName,
    })));
    if (hErr) console.error("edit-order-item: history insert failed:", hErr);
    return json(cors, { ok: true, changed: history.length, surcharge, historySaved: !hErr });
  } catch (e) {
    if (e instanceof InputError) return json(cors, { error: e.message, reason: "input" }, 400);
    console.error("edit-order-item error:", e);
    return json(cors, { error: "Erreur serveur" }, 500);
  }
});
