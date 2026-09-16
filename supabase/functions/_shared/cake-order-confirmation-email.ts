import { DARKMODE_META_TAGS, brandDarkModeStyle } from "./email-darkmode.ts";

// Shared confirmation-email renderer for a "cake / product" order at its
// CONFIRMED stage — the exact same visual template and information a
// website order gets once the admin accepts it. Handles cake-only AND
// mixed (workshop + cake) orders exactly as the website always has: a
// mixed order gets ONE email with both the cake details block and a
// workshop details block.
//
// 2026-09-15: extracted verbatim from manage-order/index.ts's own
// sendApprovalEmail (which used to build this HTML inline) so a manually-
// created order's confirmation email is genuinely IDENTICAL to a website
// order's — not a second, separately-maintained copy of the same template
// (see send-manual-order-confirmation/index.ts, the other caller). A future
// change to the website confirmation email only ever needs to happen here.
//
// Pure rendering only — no network call, no Resend, no attachment/BCC
// handling, no invoice generation. Every caller builds its own email
// payload (from/to/bcc/attachments) around the returned { subject, html }.
// Nothing here changes any payment, workshop-reservation, or cancellation
// logic — this file only ever reads order/item/fulfillment data already
// decided elsewhere.

// ── Helpers (moved here from manage-order/index.ts, 2026-09-15 — a single
// shared copy instead of being duplicated a third time. manage-order's own
// sendDeclineEmail and its local invoice PDF renderer now import the ones
// they still need from here instead of keeping their own definitions;
// their behaviour is unchanged, only the source of these functions moved.)

export function formatDateCH(dateValue?: string): string {
  if (!dateValue) return "—";
  const [year, month, day] = dateValue.split("-");
  return year && month && day ? `${day}.${month}.${year}` : dateValue;
}

// Display only — a Dot Cakes pack's flavors can carry a trailing category
// annotation baked in at add-to-cart time ("Red Velvet (Standard Flavours)"),
// needed exactly as stored in order_items.flavors (Notion, kitchen ops) —
// never touched here, only how it's shown/printed. Strips the trailing
// "(...)" off each entry, preserving order and duplicates. An entry with no
// annotation (every non-Dot-Cakes product) passes through unchanged. Same
// behaviour as src/lib/orderLabels.ts's flavorLabel() (frontend cart) and
// _shared/invoice-pdf.ts's copy — kept as a local copy here too (Deno
// function, can't import from src/).
export function flavorsLabel(flavors: string[] | null | undefined): string {
  if (!flavors?.length) return "";
  return flavors.map((f) => f.trim().replace(/\s*\([^)]*\)\s*$/, "")).filter(Boolean).join(", ");
}

// Bilingual, customer-facing labels for the fixed product/size/shape id
// sets — same mapping as src/lib/orderLabels.ts's PRODUCT_LABELS/sizeLabel/
// shapeLabel (frontend cart + My Orders), kept as a local copy here (Deno
// function, can't import from src/) — keep both in sync if this ever
// changes. Design/style ids (30+, free-text marketing names with no French
// catalogue copy yet) are only de-hyphenated/Title-Cased via prettifyId —
// never translated, never shown as a raw id either.
const PRODUCT_LABELS: Record<string, { en: string; fr: string }> = {
  bento_cake: { en: "Bento Cake", fr: "Bento Cake" },
  rectangle_cake: { en: "Rectangle Cake", fr: "Gâteau Rectangle" },
  dot_cakes: { en: "Dot Cakes", fr: "Dot Cakes" },
  diy_kit: { en: "DIY Kit", fr: "Kit DIY" },
  candles: { en: "Candles", fr: "Bougies" },
  edible_printing: { en: "Printing", fr: "Impression" },
  workshop: { en: "Workshop", fr: "Atelier" },
};
const SIZE_LABELS_FR: Record<string, string> = {
  bento: "Bento", retro: "Retro Box", medium: "Medium", large: "Large", rectangle: "Rectangle", "kit-bento": "Kit Bento",
};
const SIZE_LABELS_EN: Record<string, string> = {
  bento: "Bento", retro: "Retro Box", medium: "Medium", large: "Large", rectangle: "Rectangle", "kit-bento": "DIY Kit",
};
const SHAPE_LABELS_FR: Record<string, string> = { round: "Rond", heart: "Cœur" };
const SHAPE_LABELS_EN: Record<string, string> = { round: "Round", heart: "Heart" };
const DOT_CAKES_PACK_RE = /^dot-cakes-(\d+)$/;

function prettifyId(id: string): string {
  return id.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
export function productLabel(product: string, lang: "en" | "fr"): string {
  return PRODUCT_LABELS[product]?.[lang] || prettifyId(product);
}
export function sizeLabel(sizeId: string, lang: "en" | "fr"): string {
  const packMatch = sizeId.match(DOT_CAKES_PACK_RE);
  if (packMatch) return lang === "fr" ? `Dot Cakes ${packMatch[1]} pièces` : `Dot Cakes pack of ${packMatch[1]}`;
  const table = lang === "fr" ? SIZE_LABELS_FR : SIZE_LABELS_EN;
  return table[sizeId] || prettifyId(sizeId);
}
export function shapeLabel(shapeId: string, lang: "en" | "fr"): string {
  const table = lang === "fr" ? SHAPE_LABELS_FR : SHAPE_LABELS_EN;
  return table[shapeId] || prettifyId(shapeId);
}
export function designLabel(designId: string): string {
  return prettifyId(designId);
}
// Dot Cakes/DIY Kit/Printing/Candles: "design" is a fixed internal id,
// never a real customer choice — showing it would just repeat the product
// name for no new information (e.g. "Design: Dot Cakes"). Only bento_cake
// and rectangle_cake have a genuine design pick worth a row of its own.
const PRODUCTS_WITHOUT_MEANINGFUL_DESIGN = new Set(["dot_cakes", "diy_kit", "edible_printing", "candles"]);

// One-line item description for a summary table (payment recap, invoice) —
// used wherever a full field-by-field card isn't shown. Never a raw id:
// size/shape resolved through sizeLabel/shapeLabel, "round" (the default
// shape) omitted as uninformative, edible_printing/diy_kit collapsed to
// just their product name since neither has a meaningful size/shape of
// its own to add.
export function physicalItemDescription(item: any, lang: "en" | "fr"): string {
  if (item.product === "edible_printing") return productLabel("edible_printing", lang);
  if (item.product === "diy_kit") {
    return item.flavors?.length ? `${productLabel("diy_kit", lang)} — ${flavorsLabel(item.flavors)}` : productLabel("diy_kit", lang);
  }
  // A standalone candle line's "size" is always the fixed "candles" id —
  // never a real choice. Its own candle_name is the meaningful detail.
  if (item.product === "candles") {
    return item.candle_name ? `${productLabel("candles", lang)} — ${item.candle_name}` : productLabel("candles", lang);
  }
  const sizePart = item.size ? sizeLabel(item.size, lang) : "";
  const shapePart = item.shape && item.shape !== "round" ? ` ${shapeLabel(item.shape, lang)}` : "";
  const flavourPart = item.flavors?.length ? ` — ${flavorsLabel(item.flavors)}` : "";
  return `${sizePart}${shapePart}${flavourPart}`.trim() || productLabel(item.product, lang);
}

export function customerName(order: any): string {
  return `${order.first_name || ""} ${order.last_name || ""}`.trim();
}

// Reference images live per-item, on order_items.reference_images.
export function getOrderImageUrls(items: any[]): string[] {
  return items.flatMap((item: any) =>
    Array.isArray(item?.reference_images)
      ? item.reference_images.filter((u: unknown): u is string => typeof u === "string" && u.length > 0)
      : []
  );
}

// ── Customer language helper ────────────────────────────────────────
// orders.lang is written by Checkout.tsx directly (top-level column, no
// longer nested in JSON). Customer-facing emails and the invoice follow
// that language; French is the default. A manually-created order that
// never went through Checkout.tsx simply has no lang set, so this falls
// back to French for it too — exactly the same rule, no special case.
export function getCustomerLang(order: any): "fr" | "en" {
  return order?.lang === "en" ? "en" : "fr";
}

// Catalog.tsx embeds this exact tag into item_comment for a Shag-Cake-style
// design with two option photos ("[Preferred design: Option N]"), purely so
// the design photo actually picked survives as data — never something the
// customer typed, and never written back to Supabase differently; this only
// cleans the value at display time. Same regex/behaviour as
// notify-order/index.ts's realComment() and src/lib/orderLabels.ts's
// splitComment() — kept as a local copy here too (Deno function, can't
// import from src/); update all three if this tag format ever changes.
const PREFERRED_DESIGN_RE = /^\[Preferred design: Option (\d+)\]\s*/;
export function realComment(comment: string | null | undefined): string | null {
  if (!comment) return null;
  const stripped = comment.replace(PREFERRED_DESIGN_RE, "").trim();
  return stripped || null;
}

export interface RenderedEmail {
  subject: string;
  html: string;
}

// order: the orders row. items: every order_items row for this order
// (workshop AND physical lines together — this function separates them
// itself, exactly as sendApprovalEmail always has). fulfillments: every
// order_fulfillments row for this order (id, pickup_delivery_date,
// pickup_delivery_slot, delivery_method, delivery_address) — pass [] (or
// omit) when the caller has none; every item with no matching
// fulfillment_id (or no fulfillment_id at all) already falls back to the
// order-level pickup_delivery_date/slot/delivery_method/delivery_address
// columns, so a caller that never populates order_fulfillments (e.g. a
// manually-created order) still renders correctly with zero extra work.
export function renderCakeOrderConfirmationEmail(
  order: any,
  items: any[],
  fulfillments: any[] = [],
): RenderedEmail {
  const lang = getCustomerLang(order);
  const tr = (en: string, fr: string) => (lang === "fr" ? fr : en);

  const orderNumber = order.order_number || order.id.slice(0, 8).toUpperCase();

  // Order shape — drives which wording / blocks appear. Never changes any
  // payment, capture, void or order_validation logic.
  const workshopItems = items.filter((it: any) => it.product === "workshop");
  const physicalItems = items.filter((it: any) => it.product !== "workshop");
  const workshopOnly = workshopItems.length > 0 && physicalItems.length === 0;
  const mixed = workshopItems.length > 0 && physicalItems.length > 0;

  // Multi-date fulfillment: each physical order_item carries its own
  // fulfillment_id (one order_fulfillments row per distinct pickup/delivery
  // date) — resolved per item so every cake/product shows ITS OWN date,
  // slot and mode instead of one order-wide block that's only ever correct
  // when every item happens to share the same date. Falls back to the
  // order-level columns for an item with no fulfillment_id (legacy single-
  // fulfillment orders, and every manually-created order) — never a second
  // source of truth, just the one already-authoritative date resolved per
  // item.
  const fulfillmentById = new Map<string, any>((fulfillments || []).map((f: any) => [f.id, f]));
  const STORE_ADDRESS = "Rue Prévost-Martin 8, 1205 Genève";
  function resolveItemFulfillment(item: any): { date: string | null; slot: string | null; method: string | null; address: string | null } {
    const f = item.fulfillment_id ? fulfillmentById.get(item.fulfillment_id) : null;
    if (f) {
      return {
        date: f.pickup_delivery_date ?? null,
        slot: f.pickup_delivery_slot ?? null,
        method: f.delivery_method ?? null,
        address: f.delivery_address ?? null,
      };
    }
    return {
      date: order.pickup_delivery_date ?? null,
      slot: order.pickup_delivery_slot ?? null,
      method: order.delivery_method ?? null,
      address: order.delivery_address ?? null,
    };
  }
  // Pickup/delivery date, slot, mode and address now live ONLY in the one
  // consolidated "Pickup & delivery" recap block built below (pickupDeliveryBlock) —
  // no longer repeated inside every single item's own card.

  // Groups physical items that share the same date + slot + mode (+ address,
  // for a delivery) into one recap line, so an order with several items on
  // the same pickup/delivery date shows that date once, not once per item.
  // Sorted chronologically (undated groups — e.g. a "to be confirmed" case —
  // sort last).
  function groupKey(f: { date: string | null; slot: string | null; method: string | null; address: string | null }): string {
    return [f.date ?? "", f.slot ?? "", f.method ?? "", f.method === "delivery" ? (f.address ?? "") : ""].join("|");
  }
  type PickupDeliveryGroup = { date: string | null; slot: string | null; method: string | null; address: string | null; itemIndexes: number[] };
  function buildPickupDeliveryGroups(): PickupDeliveryGroup[] {
    const groups = new Map<string, PickupDeliveryGroup>();
    physicalItems.forEach((item: any, i: number) => {
      const f = resolveItemFulfillment(item);
      const key = groupKey(f);
      if (!groups.has(key)) groups.set(key, { ...f, itemIndexes: [] });
      groups.get(key)!.itemIndexes.push(i);
    });
    return Array.from(groups.values()).sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1; // undated ("to be confirmed") groups sort last
      if (!b.date) return -1;
      return a.date.localeCompare(b.date);
    });
  }
  // Same "Item N — Product" numbering as each item's own card title below —
  // sharing this one function keeps the recap's item references and the
  // card headers always in sync. No numbering at all when there's only one
  // physical item (nothing to disambiguate).
  function itemLabel(i: number): string {
    const item = physicalItems[i];
    const name = productLabel(item.product, lang);
    return physicalItems.length > 1 ? `${tr("Item", "Article")} ${i + 1} — ${name}` : name;
  }

  // Bento identity: bordeaux #78020C (accents, section titles, borders,
  // banners) + cream #FDF8E1 (main background). Running text uses the SAME
  // browns already used for this in send-order-received-email: #351E13 for
  // body copy / row values / card titles, #7A6540 for the muted label side
  // of a row. Lighter typography pass: labels AND values are normal weight
  // — bold is reserved for section titles, item titles, the pickup/delivery
  // recap's dates, and the total, so those actually stand out instead of
  // every single field competing for attention.
  const row = (label: string, value: string) =>
    `<tr><td class="bcs-label" style="padding:6px 8px;color:#7A6540;font-size:14px;width:40%;">${label}</td><td class="bcs-text" style="padding:6px 8px;color:#351E13;font-size:14px;">${value}</td></tr>`;

  // Physical items only — workshops render in their own block below.
  const cakeDetailsRows = physicalItems.map((item: any, i: number) => {
    const candleStr = item.candle_name
      ? `${item.candle_name}${item.candle_quantity ? ` ×${item.candle_quantity}` : ""}`
      : "";

    // Edible Printing has none of a cake's own attributes (no size, shape,
    // design, colours, text or candles — Printing.tsx never sets any of
    // them to a real value). Shown as its own minimal card — title +
    // pickup/delivery info + note — never the cake fields below, which
    // stay completely untouched for every other product.
    const isPrinting = item.product === "edible_printing";

    // Date/time/mode/address are no longer repeated here — they live once
    // each in the "Pickup & delivery" recap block above (pickupDeliveryBlock).
    // This card only carries the product's own characteristics.
    const rows: string[] = [];
    if (!isPrinting) {
      // diy_kit's size is always the same fixed "kit-bento" id — never a
      // real choice, and resolving it would just repeat the product name
      // ("DIY Kit — DIY Kit" in English). Dot Cakes' size IS meaningful
      // (the pack count), kept.
      if (item.product !== "diy_kit" && item.product !== "candles" && item.size) rows.push(row(tr("Size", "Taille"), sizeLabel(item.size, lang)));
      if (item.flavors?.length) rows.push(row(tr("Flavour", "Parfum"), flavorsLabel(item.flavors)));
      if (item.shape) rows.push(row(tr("Shape", "Forme"), shapeLabel(item.shape, lang)));
      // Dot Cakes/DIY Kit/Candles: "design" is a fixed internal id, never a
      // real customer choice — showing it would just repeat the product
      // name for no new information (edible_printing is already excluded
      // above via isPrinting).
      if (item.design && !PRODUCTS_WITHOUT_MEANINGFUL_DESIGN.has(item.product)) rows.push(row(tr("Design", "Design"), designLabel(item.design)));
      if (item.base_color) rows.push(row(tr("Base colour", "Couleur de base"), item.base_color));
      if (item.decoration_color) rows.push(row(tr("Decoration colour", "Couleur de décoration"), item.decoration_color));
      if (item.text_color) rows.push(row(tr("Text colour", "Couleur du texte"), item.text_color));
      // "normal" is the default text style, never a real customer choice —
      // only show this row when they picked something else (e.g. uppercase).
      if (item.text_style && item.text_style !== "normal") rows.push(row(tr("Text style", "Style du texte"), item.text_style));
      if (item.cake_text) rows.push(row(tr("Text on cake", "Texte sur le gâteau"), item.cake_text));
      if (item.extra) rows.push(row(tr("Extras", "Suppléments"), item.extra));
      if (candleStr) rows.push(row(tr("Candles", "Bougies"), candleStr));
    }
    const cakeComment = realComment(item.item_comment);
    if (cakeComment) {
      rows.push(isPrinting
        ? row(tr("Additional comment", "Commentaire complémentaire"), cakeComment)
        : row(tr("Additional note", "Remarque complémentaire"), cakeComment));
    }

    // The exact design photo the customer picked on the site — never
    // reconstructed from item.design (the slug/text), only order_items.
    // design_image_url (already an absolute URL, set by Catalog.tsx at
    // checkout). Shown only when present; kept entirely separate from
    // reference_images (the client's own uploaded photos), which stay in
    // orderImagesBlock below, unchanged. Same approach as the equivalent
    // fix in notify-order/index.ts.
    const designImageBlock = item.design_image_url
      ? `<img src="${item.design_image_url}" alt="${tr("Chosen design", "Design choisi")}" style="max-width:220px;width:100%;height:auto;border-radius:8px;border:1px solid #78020C;display:block;margin:0 0 12px;" />`
      : "";

    return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FDF8E1" class="bcs-card" style="background-color:#FDF8E1;background-image:linear-gradient(#FDF8E1,#FDF8E1);border:1px solid #78020C;border-radius:12px;margin:12px 0;">
        <tr><td style="padding:20px;">
        <h3 class="bcs-text" style="margin:0 0 12px;color:#351E13;font-size:15px;font-weight:600;">${itemLabel(i)}</h3>
        ${designImageBlock}
        <table style="border-collapse:collapse;width:100%;">
          ${rows.join("")}
        </table>
        </td></tr>
      </table>`;
  }).join("");

  // Section label + the cards above — only when the order actually has a
  // physical/cake part.
  const cakeDetailsBlock = physicalItems.length > 0
    ? `
        <p class="bcs-title" style="color:#78020C;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;margin:24px 0 8px;">
          ${tr("Order details", "Détails de la commande")}
        </p>
        ${cakeDetailsRows}`
    : "";

  // One consolidated "Pickup & delivery" recap, shown once near the top of
  // the email, before the item cards. Items sharing the exact same date +
  // slot + mode (+ address, for a delivery) are merged into a single line
  // via buildPickupDeliveryGroups. The store address is shown at most ONCE
  // for the whole recap, below the table, whenever at least one group is a
  // pickup — never repeated per pickup date/line.
  const pickupDeliveryGroups = physicalItems.length > 0 ? buildPickupDeliveryGroups() : [];
  const hasPickupGroup = pickupDeliveryGroups.some((g) => g.method !== "delivery");
  const pickupDeliveryRowsHtml = pickupDeliveryGroups.map((g) => {
    const modeLabel = g.method === "delivery" ? tr("Delivery", "Livraison") : tr("Pickup at store", "Retrait sur place");
    const itemsLine = g.itemIndexes.map(itemLabel).join(", ");
    return `<tr style="border-bottom:1px solid #78020C;">
      <td class="bcs-text" style="padding:12px 14px;color:#351E13;font-size:14px;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">
        <p style="margin:0 0 4px;">${itemsLine}</p>
        <p style="margin:0;">
          <strong style="font-weight:700;">${g.date ? formatDateCH(g.date) : tr("Date to be confirmed", "Date à confirmer")}</strong>${g.slot ? ` · ${g.slot}` : ""} — ${modeLabel}
        </p>
        ${g.method === "delivery" && g.address ? `<p class="bcs-label" style="margin:4px 0 0;color:#7A6540;font-size:13px;">${g.address}</p>` : ""}
      </td>
    </tr>`;
  }).join("");
  const pickupDeliveryBlock = pickupDeliveryGroups.length > 0
    ? `
        <p class="bcs-title" style="color:#78020C;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;margin:0 0 8px;">
          ${tr("Pickup & delivery", "Retrait et livraison")}
        </p>
        <table style="border-collapse:collapse;width:100%;border:1px solid #78020C;margin:0 0 8px;">
          ${pickupDeliveryRowsHtml}
        </table>
        ${hasPickupGroup
          ? `<p class="bcs-label" style="color:#7A6540;font-size:12px;margin:0 0 20px;">${tr("Store address for pickups", "Adresse de la boutique pour les retraits")}: ${STORE_ADDRESS}</p>`
          : ""}`
    : "";

  // Workshop detail block — one card per workshop line, shown only when the
  // order actually contains a workshop. Never presented as a cake.
  const workshopDetailsRows = workshopItems.map((item: any, i: number) => {
    const wsName = item.workshop_type === "paint" ? tr("Paint Workshop", "Atelier Peinture") : tr("Signature Workshop", "Atelier Signature");
    const wsRows = [
      item.workshop_reference ? row(tr("Booking reference", "Référence de réservation"), item.workshop_reference) : "",
      row(tr("Workshop", "Atelier"), wsName),
      item.workshop_date ? row(tr("Date", "Date"), formatDateCH(item.workshop_date)) : "",
      item.workshop_time ? row(tr("Time", "Horaire"), item.workshop_time) : "",
      item.workshop_participants != null ? row(tr("Participants", "Participants"), String(item.workshop_participants)) : "",
      item.workshop_unit_price != null ? row(tr("Price per person", "Prix par personne"), `CHF ${Number(item.workshop_unit_price).toFixed(2)}`) : "",
      item.total != null ? row(tr("Workshop total", "Total du workshop"), `CHF ${Number(item.total).toFixed(2)}`) : "",
      item.item_comment?.trim() ? row(tr("Notes", "Notes"), item.item_comment.trim()) : "",
    ].join("");
    return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FDF8E1" class="bcs-card" style="background-color:#FDF8E1;background-image:linear-gradient(#FDF8E1,#FDF8E1);border:1px solid #78020C;border-radius:12px;margin:12px 0;">
        <tr><td style="padding:20px;">
        <h3 class="bcs-text" style="margin:0 0 12px;color:#351E13;font-size:15px;font-weight:600;">${wsName}${workshopItems.length > 1 ? ` ${i + 1}` : ""}</h3>
        <table style="border-collapse:collapse;width:100%;">${wsRows}</table>
        </td></tr>
      </table>`;
  }).join("");

  const workshopDetailsBlock = workshopItems.length > 0
    ? `
        <p class="bcs-title" style="color:#78020C;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;margin:24px 0 8px;">
          ${tr("Workshop details", "Détails du workshop")}
        </p>
        ${workshopDetailsRows}`
    : "";

  // Reference images block, from order_items.reference_images
  const orderImageUrls = getOrderImageUrls(items);
  const orderImagesBlock = orderImageUrls.length
    ? `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FDF8E1" class="bcs-card" style="background-color:#FDF8E1;background-image:linear-gradient(#FDF8E1,#FDF8E1);border:1px solid #78020C;border-radius:12px;margin:12px 0;">
        <tr><td style="padding:20px;">
        <h3 class="bcs-text" style="margin:0 0 12px;color:#351E13;font-size:15px;font-weight:600;">${tr("Reference images", "Images de référence")}</h3>
        <table style="border-collapse:collapse;width:100%;">
          ${orderImageUrls.map((url: string, j: number) =>
            `<tr><td class="bcs-label" style="padding:8px;color:#7A6540;font-size:14px;vertical-align:top;">Image ${j + 1}</td><td style="padding:8px;"><a href="${url}" class="bcs-title" style="color:#78020C;font-size:14px;display:inline-block;margin-bottom:6px;font-weight:600;text-decoration:underline;" target="_blank">${tr("Open image", "Ouvrir l’image")}</a><br/><img src="${url}" alt="${tr("Reference image", "Image de référence")} ${j + 1}" style="max-width:220px;width:100%;height:auto;border-radius:8px;border:1px solid #78020C;display:block;" /></td></tr>`
          ).join("")}
        </table>
        </td></tr>
      </table>`
    : "";

  const itemSummaryRows = items.map((item: any) => {
    const label = item.product === "workshop"
      ? `${item.workshop_type === "paint" ? tr("Paint Workshop", "Atelier Peinture") : tr("Signature Workshop", "Atelier Signature")}`
        + `${item.workshop_date ? " — " + formatDateCH(item.workshop_date) : ""}`
        + `${item.workshop_time ? " · " + item.workshop_time : ""}`
        + `${item.workshop_participants ? ` — ${item.workshop_participants} ${tr("participant(s)", "participant(s)")}` : ""}`
      : physicalItemDescription(item, lang);
    return `
    <tr>
      <td class="bcs-text" style="padding:12px;border-bottom:1px solid #78020C;font-size:14px;color:#351E13;">${label}</td>
      <td class="bcs-text" style="padding:12px;border-bottom:1px solid #78020C;font-size:14px;color:#351E13;text-align:right;white-space:nowrap;">CHF ${item.total}</td>
    </tr>`;
  }).join("");

  // Same wordmark asset + size as every other Bento Cake Studio decision
  // email (240px, auto height).
  const logoUrl = "https://dimsoon58.github.io/mini-cake-corner/logo-red-email.png";
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${DARKMODE_META_TAGS}<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet">
${brandDarkModeStyle()}
</head>
<body bgcolor="#78020C" style="margin:0;padding:0;background-color:#78020C;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#78020C" class="bcs-outer" style="background-color:#78020C;background-image:linear-gradient(#78020C,#78020C);">
  <tr><td align="center" style="padding:0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;margin:0 auto;">
  <tr><td style="padding:0 20px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FDF8E1" class="bcs-card" style="background-color:#FDF8E1;background-image:linear-gradient(#FDF8E1,#FDF8E1);">
  <tr><td>
      <div style="padding:36px 40px 0;text-align:center;">
        <img src="${logoUrl}" alt="Bento Cake Studio" style="width:240px;height:auto;display:block;margin:0 auto 28px;" />
      </div>

      <div class="bcs-text" style="padding:0 40px 36px;">
        <p class="bcs-text" style="color:#351E13;font-size:15px;line-height:1.8;margin:0 0 12px;">
          ${tr("Dear", "Bonjour")} ${customerName(order)},
        </p>

        <p class="bcs-text" style="color:#351E13;font-size:15px;line-height:1.8;margin:0 0 12px;">
          ${tr("Thank you for choosing Bento Cake Studio.", "Merci d'avoir choisi Bento Cake Studio.")}
        </p>
        <p class="bcs-text" style="color:#351E13;font-size:15px;line-height:1.8;margin:0 0 20px;">
          ${workshopOnly
            ? tr(
                "Your workshop booking is now confirmed.",
                "Votre réservation de workshop est maintenant confirmée."
              )
            : tr(
                `Your order <strong>#${orderNumber}</strong> is now confirmed.`,
                `Votre commande <strong>n° ${orderNumber}</strong> est maintenant confirmée.`
              )}
        </p>

        ${pickupDeliveryBlock}

        ${cakeDetailsBlock}

        ${workshopDetailsBlock}

        ${orderImagesBlock}

        <p class="bcs-title" style="color:#78020C;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;margin:24px 0 8px;">
          ${tr("Order summary", "Récapitulatif de la commande")}
        </p>
        <table style="width:100%;border-collapse:collapse;border:1px solid #78020C;margin-bottom:24px;">
          <thead>
            <tr bgcolor="#78020C" class="bcs-accent-bg" style="background-color:#78020C;background-image:linear-gradient(#78020C,#78020C);">
              <th class="bcs-accent-text" style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#FDF8E1;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">${tr("Item", "Article")}</th>
              <th class="bcs-accent-text" style="padding:10px 14px;text-align:right;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#FDF8E1;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">${tr("Price", "Prix")}</th>
            </tr>
          </thead>
          <tbody>
            ${itemSummaryRows}
            ${(Number(order.express_surcharge_amount) || 0) > 0 ? `<tr>
              <td class="bcs-text" style="padding:12px 14px;border-bottom:1px solid #78020C;font-size:14px;color:#351E13;">${tr("Express surcharge", "Supplément express")}</td>
              <td class="bcs-text" style="padding:12px 14px;border-bottom:1px solid #78020C;font-size:14px;color:#351E13;text-align:right;white-space:nowrap;">CHF ${Number(order.express_surcharge_amount).toFixed(2)}</td>
            </tr>` : ""}
            ${(Number(order.welcome_discount_amount) || 0) > 0 ? `<tr>
              <td class="bcs-text" style="padding:12px 14px;border-bottom:1px solid #78020C;font-size:14px;color:#351E13;">${tr("Welcome discount", "Réduction de bienvenue")}</td>
              <td class="bcs-text" style="padding:12px 14px;border-bottom:1px solid #78020C;font-size:14px;color:#351E13;text-align:right;white-space:nowrap;">- CHF ${Number(order.welcome_discount_amount).toFixed(2)}</td>
            </tr>` : ""}
            ${(Number(order.reward_amount_used) || 0) > 0 ? `<tr>
              <td class="bcs-text" style="padding:12px 14px;border-bottom:1px solid #78020C;font-size:14px;color:#351E13;">${tr("Reward used", "Cagnotte utilisée")}</td>
              <td class="bcs-text" style="padding:12px 14px;border-bottom:1px solid #78020C;font-size:14px;color:#351E13;text-align:right;white-space:nowrap;">- CHF ${Number(order.reward_amount_used).toFixed(2)}</td>
            </tr>` : ""}
            ${(Number(order.delivery_fee) || 0) > 0 ? `<tr>
              <td class="bcs-text" style="padding:12px 14px;border-bottom:1px solid #78020C;font-size:14px;color:#351E13;">${tr("Delivery", "Livraison")}</td>
              <td class="bcs-text" style="padding:12px 14px;border-bottom:1px solid #78020C;font-size:14px;color:#351E13;text-align:right;white-space:nowrap;">CHF ${Number(order.delivery_fee).toFixed(2)}</td>
            </tr>` : ""}
          </tbody>
          <tfoot>
            <tr bgcolor="#78020C" class="bcs-accent-bg" style="background-color:#78020C;background-image:linear-gradient(#78020C,#78020C);">
              <td class="bcs-accent-text" style="padding:10px 14px;font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#FDF8E1;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">${tr("Total", "Total")}</td>
              <td class="bcs-accent-text" style="padding:10px 14px;font-size:15px;font-weight:700;color:#FDF8E1;text-align:right;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">CHF ${order.total_amount}</td>
            </tr>
          </tfoot>
        </table>

        <p class="bcs-text" style="color:#351E13;font-size:13px;line-height:1.7;margin:0 0 20px;border-top:1px solid #78020C;padding-top:20px;">
          ${tr(
            "If any of these details are incorrect or if you need to make a small change, please contact us as soon as possible.",
            "Si l'une de ces informations est incorrecte ou si vous souhaitez apporter une petite modification, merci de nous contacter au plus vite."
          )}
        </p>

        <p class="bcs-text" style="color:#351E13;font-size:15px;line-height:1.8;margin:0;">
          ${workshopOnly
            ? `${tr(
                "Thank you again for your order. We look forward to welcoming you to the workshop!",
                "Merci encore pour votre commande. Nous avons hâte de vous accueillir au workshop !"
              )}<br><br>${tr("Warm regards", "Bien chaleureusement")},<br><strong>Bento Cake Studio</strong> 🤍`
            : mixed
              ? `${tr(
                  "Thank you again for your order. We look forward to preparing your order and welcoming you to Bento Cake Studio.",
                  "Merci encore pour votre commande. Nous avons hâte de préparer votre commande et de vous accueillir chez Bento Cake Studio."
                )}<br><br>${tr("Warm regards", "Bien chaleureusement")},<br><strong>Bento Cake Studio</strong> 🤍`
              : `${tr(
                  "We can't wait to prepare your cake!",
                  "Nous avons hâte de préparer votre gâteau !"
                )}<br><br>${tr("See you soon", "À bientôt")},<br><strong>Bento Cake Studio</strong> 🤍`}
        </p>
      </div>
  </td></tr>
  </table>
  </td></tr>
  <tr><td bgcolor="#78020C" class="bcs-spacer" style="height:24px;line-height:24px;font-size:1px;background-color:#78020C;background-image:linear-gradient(#78020C,#78020C);">&nbsp;</td></tr>
  </table>
  </td></tr>
  </table>
</body>
</html>`;

  const subject = tr(`Order Confirmation — #${orderNumber}`, `Confirmation de commande — n° ${orderNumber}`);
  return { subject, html };
}
