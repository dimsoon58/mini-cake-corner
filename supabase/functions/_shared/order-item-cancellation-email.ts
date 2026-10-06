// E-mail « Annulation partielle de votre commande » (un seul article) —
// modèle EXISTANT, copié tel quel (texte, style, langues) depuis la fonction
// de production cancel-order-item-make (export du 2026-10-04). Seul le code
// a été déplacé ici pour être réutilisé par l'admin (cancel-order-item) ; un
// test vérifie que le message envoyé est identique, octet pour octet, à
// celui de la fonction de production. Ne pas modifier le modèle ici sans
// décision explicite.

export function esc(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function humanize(value: unknown): string {
  const s = String(value ?? "").trim();
  if (!s) return "";
  const mapped: Record<string, string> = {
    bento_cake: "Bento Cake",
    dot_cakes: "Dot Cakes",
    dot_cake: "Dot Cake",
    diy_kit: "DIY Kit",
    printing: "Printing",
    bento: "Bento",
    retro: "Retro Box",
    medium: "Medium",
    large: "Large",
    rectangle: "Rectangle",
    round: "Round",
    heart: "Heart",
  };
  if (mapped[s]) return mapped[s];
  return s
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function formatDate(value: unknown): string {
  const s = String(value ?? "").slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : s;
}

function formatFlavors(value: unknown): string {
  if (Array.isArray(value)) return value.map(humanize).filter(Boolean).join(", ");
  return humanize(value);
}

function formatExtras(value: unknown): string {
  if (Array.isArray(value)) return value.map(humanize).filter(Boolean).join(", ");
  return humanize(value);
}

function detailRow(label: string, value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return `<tr><td style="padding:6px 8px;color:#7A6540;font-size:14px;width:40%;">${esc(label)}</td><td style="padding:6px 8px;color:#351E13;font-size:14px;">${esc(text)}</td></tr>`;
}

export type ItemCancellationEmail = { from: string; subject: string; html: string; text: string; orderNumber: string; product: string };

export function buildOrderItemCancellationEmail(
  order: Record<string, unknown>,
  item: Record<string, unknown>,
  fulfillment: Record<string, unknown> | null,
): ItemCancellationEmail {
  const lang = String(order.lang ?? "en").toLowerCase().startsWith("fr") ? "fr" : "en";
  const orderNumber = String(order.order_number ?? item.order_number ?? "").trim();
  const firstName = String(order.first_name ?? "").trim();
  const product = humanize(item.product);
  const size = humanize(item.size);
  const flavor = formatFlavors(item.flavors);
  const shape = humanize(item.shape);
  const design = humanize(item.design);
  const baseColor = humanize(item.base_color);
  const decorationColor = humanize(item.decoration_color);
  const extras = formatExtras(item.extras);
  const date = formatDate(fulfillment?.pickup_delivery_date);
  const slot = String(fulfillment?.pickup_delivery_slot ?? "").trim();
  const imageUrl = String(item.design_image_url ?? "").trim();

  const labels = lang === "fr"
    ? { size: "Taille", flavor: "Parfum", shape: "Forme", design: "Design", base: "Couleur de base", deco: "Couleur décoration", extras: "Extras", date: "Date", slot: "Créneau" }
    : { size: "Size", flavor: "Flavour", shape: "Shape", design: "Design", base: "Base colour", deco: "Decoration colour", extras: "Extras", date: "Date", slot: "Time slot" };

  const details = [
    detailRow(labels.size, size),
    detailRow(labels.flavor, flavor),
    detailRow(labels.shape, shape),
    detailRow(labels.design, design),
    detailRow(labels.base, baseColor),
    detailRow(labels.deco, decorationColor),
    detailRow(labels.extras, extras),
    detailRow(labels.date, date),
    detailRow(labels.slot, slot),
  ].join("");

  const subject = lang === "fr"
    ? `Annulation partielle de votre commande — n° ${orderNumber}`
    : `Partial cancellation — #${orderNumber}`;

  const greeting = lang === "fr" ? `Bonjour ${firstName || ""},` : `Hello ${firstName || ""},`;
  const intro = lang === "fr"
    ? `Suite à votre demande, nous confirmons l’annulation d’un article de votre commande <strong>n° ${esc(orderNumber)}</strong>.`
    : `Following your request, we confirm the cancellation of one item from your order <strong>#${esc(orderNumber)}</strong>.`;
  const itemHeading = lang === "fr" ? "Article annulé" : "Cancelled item";
  const remaining = lang === "fr"
    ? "Les autres articles de votre commande restent confirmés."
    : "The other items in your order remain confirmed.";
  const signoff = lang === "fr" ? "À bientôt," : "See you soon,";
  const team = lang === "fr" ? "L’équipe Bento Cake Studio" : "The Bento Cake Studio Team";

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet"></head>
<body style="margin:0;padding:0;background:#78020C;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;">
    <div style="background:#FDF8E1;margin:0 20px;">
      <div style="padding:36px 40px 0;text-align:center;">
        <img src="https://dimsoon58.github.io/mini-cake-corner/logo-red-email.png" alt="Bento Cake Studio" style="width:240px;height:auto;display:block;margin:0 auto 28px;" />
      </div>
      <div style="padding:0 40px 36px;">
        <p style="color:#351E13;font-size:15px;line-height:1.8;margin:0 0 12px;">${esc(greeting)}</p>
        <div style="border-left:3px solid #78020C;background:#F5EDCC;padding:14px 18px;margin:0 0 20px;">
          <p style="color:#351E13;font-size:14px;line-height:1.7;margin:0;">${intro}</p>
        </div>
        <p style="color:#78020C;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;margin:24px 0 8px;">${esc(itemHeading)}</p>
        <div style="background:#FDF8E1;border:1px solid #78020C;border-radius:12px;padding:20px;margin:12px 0 20px;">
          <h3 style="margin:0 0 12px;color:#351E13;font-size:15px;font-weight:600;">${esc(product)}</h3>
          ${imageUrl ? `<img src="${esc(imageUrl)}" alt="Chosen design" style="max-width:220px;width:100%;height:auto;border-radius:8px;border:1px solid #78020C;display:block;margin:0 0 12px;" />` : ""}
          <table style="border-collapse:collapse;width:100%;">${details}</table>
        </div>
        <p style="color:#351E13;font-size:15px;line-height:1.8;margin:0 0 20px;">${esc(remaining)}</p>
        <p style="color:#351E13;font-size:15px;line-height:1.8;margin:0;">${esc(signoff)}<br><strong>${esc(team)}</strong> 🤍</p>
      </div>
    </div>
    <div style="height:24px;background:#78020C;"></div>
  </div>
</body>
</html>`;

  const text = lang === "fr"
    ? `${greeting}\n\nSuite à votre demande, nous confirmons l’annulation d’un article de votre commande n° ${orderNumber}.\n\n${itemHeading}\n${product}${size ? ` — ${size}` : ""}${flavor ? ` — ${flavor}` : ""}${design ? ` — ${design}` : ""}${date ? `\n${date}${slot ? ` · ${slot}` : ""}` : ""}\n\n${remaining}\n\n${signoff}\n${team} 🤍`
    : `${greeting}\n\nFollowing your request, we confirm the cancellation of one item from your order #${orderNumber}.\n\n${itemHeading}\n${product}${size ? ` — ${size}` : ""}${flavor ? ` — ${flavor}` : ""}${design ? ` — ${design}` : ""}${date ? `\n${date}${slot ? ` · ${slot}` : ""}` : ""}\n\n${remaining}\n\n${signoff}\n${team} 🤍`;

  return { from: "Bento Cake Studio <contact@bentocakestudio.ch>", subject, html, text, orderNumber, product };
}

/** Same Resend idempotency key as the production function. */
export const itemCancellationIdempotencyKey = (orderItemId: string) => `order-item-cancellation-${orderItemId}`;
