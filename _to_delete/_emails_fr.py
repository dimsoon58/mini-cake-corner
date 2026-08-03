# -*- coding: utf-8 -*-
import io, os, sys

ROOT = "/sessions/rcw-01d8yvniirrtjcjqoatid7yj/mnt/mini-cake-corner"

def read(p):
    return io.open(p, "r", encoding="utf-8").read()

def write(p, s):
    tmp = p + ".tmp"
    io.open(tmp, "w", encoding="utf-8").write(s)
    os.replace(tmp, p)

def rep(s, old, new, tag, n=1):
    c = s.count(old)
    if c != n:
        print("MISMATCH [%s] expected %d got %d: %r" % (tag, n, c, old[:110]))
        sys.exit(1)
    return s.replace(old, new)

# ===================================================================
# 1. Checkout.tsx — store the customer's language in order_details_json
# ===================================================================
p = os.path.join(ROOT, "src/pages/Checkout.tsx")
s = read(p)
if "lang," not in s.split("\n")[181]:
    s = rep(s, u"  const { t } = useLang();", u"  const { t, lang } = useLang();", "checkout-hook")
s = rep(s,
        u'        deliveryTime: deliveryOption === "delivery" ? deliveryTime : "",\n      };',
        u'        deliveryTime: deliveryOption === "delivery" ? deliveryTime : "",\n'
        u'        lang,\n      };',
        "checkout-lang")
write(p, s)
print("Checkout.tsx OK")

# ===================================================================
# 2. notify-order — admin only, translate outright to French
# ===================================================================
p = os.path.join(ROOT, "supabase/functions/notify-order/index.ts")
s = read(p)

N = [
    (u'${row("Size", item.sizeName)}', u'${row("Taille", item.sizeName)}'),
    (u'${row("Shape", item.shapeName)}', u'${row("Forme", item.shapeName)}'),
    (u'${row("Flavor", item.flavorName)}', u'${row("Parfum", item.flavorName)}'),
    (u'${row("Design", item.styleName)}', u'${row("Design", item.styleName)}'),
    (u'${row("Base Color", item.baseColorName)}', u'${row("Couleur de base", item.baseColorName)}'),
    (u'${row("Deco Color", item.decorationColorName)}', u'${row("Couleur de déco", item.decorationColorName)}'),
    (u'${row("Text on Cake", item.cakeText', u'${row("Texte sur le gâteau", item.cakeText'),
    (u'${row("Extras", item.extrasNames', u'${row("Suppléments", item.extrasNames'),
    (u'${row("Ribbon", item.ribbonColorName)}', u'${row("Ruban", item.ribbonColorName)}'),
    (u'${row("Butterfly", item.butterflyColorName)}', u'${row("Papillon", item.butterflyColorName)}'),
    (u'${row("Candles", candlesList || null)}', u'${row("Bougies", candlesList || null)}'),
    (u'${row("Instructions", item.comment', u'${row("Instructions", item.comment'),
    (u'>📎 Reference images</h3>', u'>📎 Images de référence</h3>'),
    (u'>Image ${j + 1}</td>', u'>Image ${j + 1}</td>'),
    (u'>Open image</a>', u'>Ouvrir l’image</a>'),
    (u'alt="Reference image ${j + 1}"', u'alt="Image de référence ${j + 1}"'),
    (u'🎂 New Bento Cake Order</h1>', u'🎂 Nouvelle commande Bento Cake</h1>'),
    (u'Order <strong style="color:#fff;">${order.order_number || order.id.slice(0, 8).toUpperCase()}</strong> needs your review',
     u'La commande <strong style="color:#fff;">${order.order_number || order.id.slice(0, 8).toUpperCase()}</strong> attend votre validation'),
    (u'>👤 Customer Information</h3>', u'>👤 Informations client</h3>'),
    (u'${row("Name", order.customer_name)}', u'${row("Nom", order.customer_name)}'),
    (u'${row("Phone", order.customer_phone)}', u'${row("Téléphone", order.customer_phone)}'),
    (u'>📦 Pickup / Delivery</h3>', u'>📦 Retrait / Livraison</h3>'),
    (u'${row("Date", formatDateCH(order.order_date))}', u'${row("Date", formatDateCH(order.order_date))}'),
    (u'${row("Time", details.pickupTime || "—")}', u'${row("Heure", details.pickupTime || "—")}'),
    (u'${row("Option", order.delivery_option === "delivery" ? "🚚 Delivery" : "🏪 Pickup at store")}',
     u'${row("Option", order.delivery_option === "delivery" ? "🚚 Livraison" : "🏪 Retrait sur place")}'),
    (u'${row("Address", order.delivery_option', u'${row("Adresse", order.delivery_option'),
    (u'${row("Notes", details.deliveryComment || null)}', u'${row("Remarques", details.deliveryComment || null)}'),
    (u'🍰 Order Items (${items.length})</h3>', u'🍰 Articles commandés (${items.length})</h3>'),
    (u'>💳 Payment Summary</h3>', u'>💳 Récapitulatif du paiement</h3>'),
    (u'${row("Order №", order.order_number', u'${row("Commande №", order.order_number'),
    (u'${row("Invoice №", order.invoice_number || "—")}', u'${row("Facture №", order.invoice_number || "—")}'),
    (u'${row("Total", `CHF ${order.total_amount}`)}', u'${row("Total", `CHF ${order.total_amount}`)}'),
    (u'${row("Status", "⏳ Funds authorized — awaiting your approval")}',
     u'${row("Statut", "⏳ Fonds autorisés — en attente de votre validation")}'),
    (u'Click a button to instantly process this order. No login required.',
     u'Cliquez sur un bouton pour traiter immédiatement cette commande. Aucune connexion requise.'),
    (u'✅ Accept Order', u'✅ Accepter la commande'),
    (u'❌ Decline Order', u'❌ Refuser la commande'),
    (u'Each button can only be used once.', u'Chaque bouton ne peut être utilisé qu’une seule fois.'),
    (u'View full order details →', u'Voir le détail complet de la commande →'),
    (u'Bento Cake Studio · Order Notification System', u'Bento Cake Studio · Système de notification des commandes'),
    (u'🍰 Cake ${i + 1} — CHF ${item.total}', u'🍰 Gâteau ${i + 1} — CHF ${item.total}'),
    (u'subject: `🎂 New Bento Cake Order ${order.order_number', u'subject: `🎂 Nouvelle commande Bento Cake ${order.order_number'),
]
for old, new in N:
    s = rep(s, old, new, "notify:" + old[:45])
write(p, s)
print("notify-order OK")

# ===================================================================
# 3. manage-order — customer emails follow the customer's language
# ===================================================================
p = os.path.join(ROOT, "supabase/functions/manage-order/index.ts")
s = read(p)

# --- 3a. language helper ------------------------------------------------
HELPER = u'''// ── Customer language helper ────────────────────────────────────────
// The language the customer used on the website is stored in
// order_details_json.lang by the checkout page. Customer-facing emails and
// the invoice follow that language; French is the default.
function getCustomerLang(order: any): "fr" | "en" {
  const l = order?.order_details_json?.lang;
  return l === "en" ? "en" : "fr";
}

// ── Approval confirmation email ─────────────────────────────────────'''
s = rep(s, u'// ── Approval confirmation email ─────────────────────────────────────', HELPER, "mo-helper")

# --- 3b. approval email -------------------------------------------------
s = rep(s,
        u'  const details = order.order_details_json || {};\n'
        u'  const items = details.items || [];\n'
        u'  const pickupTime = details.pickupTime || "—";\n'
        u'  const orderNumber = order.order_number || order.id.slice(0, 8).toUpperCase();\n'
        u'\n'
        u'  const deliveryInfo = order.delivery_option === "delivery"\n'
        u'    ? `Delivery to: ${order.delivery_address || "—"}`\n'
        u'    : "Pickup at store";',
        u'  const lang = getCustomerLang(order);\n'
        u'  const tr = (en: string, fr: string) => (lang === "fr" ? fr : en);\n'
        u'\n'
        u'  const details = order.order_details_json || {};\n'
        u'  const items = details.items || [];\n'
        u'  const pickupTime = details.pickupTime || "—";\n'
        u'  const orderNumber = order.order_number || order.id.slice(0, 8).toUpperCase();\n'
        u'\n'
        u'  const deliveryInfo = order.delivery_option === "delivery"\n'
        u'    ? `${tr("Delivery to", "Livraison à")}: ${order.delivery_address || "—"}`\n'
        u'    : tr("Pickup at store", "Retrait sur place");',
        "mo-approval-head")

A = [
    (u'if (item.sizeName) rows.push(row("Size", item.sizeName));',
     u'if (item.sizeName) rows.push(row(tr("Size", "Taille"), item.sizeName));'),
    (u'if (item.flavorName) rows.push(row("Flavor", item.flavorName));',
     u'if (item.flavorName) rows.push(row(tr("Flavour", "Parfum"), item.flavorName));'),
    (u'if (item.shapeName) rows.push(row("Shape", item.shapeName));',
     u'if (item.shapeName) rows.push(row(tr("Shape", "Forme"), item.shapeName));'),
    (u'if (item.styleName) rows.push(row("Design", item.styleName));',
     u'if (item.styleName) rows.push(row(tr("Design", "Design"), item.styleName));'),
    (u'if (item.baseColorName) rows.push(row("Base color", item.baseColorName));',
     u'if (item.baseColorName) rows.push(row(tr("Base colour", "Couleur de base"), item.baseColorName));'),
    (u'if (item.decorationColorName) rows.push(row("Decoration color", item.decorationColorName));',
     u'if (item.decorationColorName) rows.push(row(tr("Decoration colour", "Couleur de décoration"), item.decorationColorName));'),
    (u'if (item.textColorName) rows.push(row("Text color", item.textColorName));',
     u'if (item.textColorName) rows.push(row(tr("Text colour", "Couleur du texte"), item.textColorName));'),
    (u'if (item.textStyle) rows.push(row("Text style", item.textStyle));',
     u'if (item.textStyle) rows.push(row(tr("Text style", "Style du texte"), item.textStyle));'),
    (u'if (item.cakeText) rows.push(row("Text on cake", item.cakeText));',
     u'if (item.cakeText) rows.push(row(tr("Text on cake", "Texte sur le gâteau"), item.cakeText));'),
    (u'if (item.extrasNames?.length) rows.push(row("Extras", item.extrasNames.join(", ")));',
     u'if (item.extrasNames?.length) rows.push(row(tr("Extras", "Suppléments"), item.extrasNames.join(", ")));'),
    (u'if (item.ribbonColorName) rows.push(row("Ribbon color", item.ribbonColorName));',
     u'if (item.ribbonColorName) rows.push(row(tr("Ribbon colour", "Couleur du ruban"), item.ribbonColorName));'),
    (u'if (item.butterflyColorName) rows.push(row("Butterfly color", item.butterflyColorName));',
     u'if (item.butterflyColorName) rows.push(row(tr("Butterfly colour", "Couleur du papillon"), item.butterflyColorName));'),
    (u'if (candleStr) rows.push(row("Candles", candleStr));',
     u'if (candleStr) rows.push(row(tr("Candles", "Bougies"), candleStr));'),
    (u'if (item.comment?.trim()) rows.push(row("Additional note", item.comment.trim()));',
     u'if (item.comment?.trim()) rows.push(row(tr("Additional note", "Remarque complémentaire"), item.comment.trim()));'),
    (u'🎂 Cake ${items.length > 1 ? (i + 1) : "details"}</h3>',
     u'${tr("🎂 Cake", "🎂 Gâteau")} ${items.length > 1 ? (i + 1) : tr("details", "— détails")}</h3>'),
    (u'>📎 Reference images</h3>',
     u'>${tr("📎 Reference images", "📎 Images de référence")}</h3>'),
    (u'vertical-align:top;">Image ${j + 1}</td>',
     u'vertical-align:top;">Image ${j + 1}</td>'),
    (u'target="_blank">Open image</a>',
     u'target="_blank">${tr("Open image", "Ouvrir l’image")}</a>'),
    (u'alt="Reference image ${j + 1}"', u'alt="${tr("Reference image", "Image de référence")} ${j + 1}"'),
    (u'<h1 style="color:#333;font-size:24px;margin:0;font-weight:700;">Order Confirmation</h1>',
     u'<h1 style="color:#333;font-size:24px;margin:0;font-weight:700;">${tr("Order Confirmation", "Confirmation de commande")}</h1>'),
    (u'          Dear ${order.customer_name},\n',
     u'          ${tr("Dear", "Bonjour")} ${order.customer_name},\n'),
    (u'          Thank you for choosing Bento Cake Studio. Your order <strong>#${orderNumber}</strong> has been confirmed and will be prepared for you on the selected date.\n',
     u'          ${tr(\n'
     u'            `Thank you for choosing Bento Cake Studio. Your order <strong>#${orderNumber}</strong> has been confirmed and will be prepared for you on the selected date.`,\n'
     u'            `Merci d’avoir choisi Bento Cake Studio. Votre commande <strong>n° ${orderNumber}</strong> est confirmée et sera préparée pour la date choisie.`\n'
     u'          )}\n'),
    (u'>Pickup details</h3>', u'>${tr("Pickup details", "Détails du retrait")}</h3>'),
    (u'${row("Date", formatDateCH(order.order_date))}', u'${row(tr("Date", "Date"), formatDateCH(order.order_date))}'),
    (u'${pickupTime ? row("Time", pickupTime) : ""}', u'${pickupTime ? row(tr("Time", "Heure"), pickupTime) : ""}'),
    (u'${row("Pickup option", deliveryInfo)}', u'${row(tr("Pickup option", "Mode de retrait"), deliveryInfo)}'),
    (u'${row("Payment method", paymentMethodLabel)}', u'${row(tr("Payment method", "Moyen de paiement"), paymentMethodLabel)}'),
    (u'>Order summary</h3>', u'>${tr("Order summary", "Récapitulatif de la commande")}</h3>'),
    (u'font-weight:500;">Item</th>', u'font-weight:500;">${tr("Item", "Article")}</th>'),
    (u'font-weight:500;">Price</th>', u'font-weight:500;">${tr("Price", "Prix")}</th>'),
    (u'color:#333;">Total</td>', u'color:#333;">${tr("Total", "Total")}</td>'),
    (u'          If any of these details are incorrect or if you need to make a small change, please contact us as soon as possible.\n',
     u'          ${tr(\n'
     u'            "If any of these details are incorrect or if you need to make a small change, please contact us as soon as possible.",\n'
     u'            "Si l’une de ces informations est incorrecte ou si vous souhaitez apporter une petite modification, merci de nous contacter au plus vite."\n'
     u'          )}\n'),
    (u'          Thank you again for your order. We look forward to preparing your cake.\n',
     u'          ${tr(\n'
     u'            "Thank you again for your order. We look forward to preparing your cake.",\n'
     u'            "Merci encore pour votre commande. Nous avons hâte de préparer votre gâteau."\n'
     u'          )}\n'),
]
for old, new in A:
    s = rep(s, old, new, "approval:" + old[:45])

# shared footer / sign-off (appears in both customer emails)
s = rep(s,
        u'          Warm regards,<br>\n'
        u'          <strong>The Bento Cake Studio Team</strong> 🤍',
        u'          ${tr("Warm regards", "Bien chaleureusement")},<br>\n'
        u'          <strong>${tr("The Bento Cake Studio Team", "L’équipe Bento Cake Studio")}</strong> 🤍',
        "signoff", 2)

s = rep(s,
        u'subject: `Order Confirmation — #${orderNumber}`,',
        u'subject: tr(`Order Confirmation — #${orderNumber}`, `Confirmation de commande — n° ${orderNumber}`),',
        "approval-subject")

# --- 3c. decline email --------------------------------------------------
s = rep(s,
        u'async function sendDeclineEmail(resendApiKey: string, order: any) {\n'
        u'  const orderNumber = order.order_number || order.id.slice(0, 8).toUpperCase();',
        u'async function sendDeclineEmail(resendApiKey: string, order: any) {\n'
        u'  const lang = getCustomerLang(order);\n'
        u'  const tr = (en: string, fr: string) => (lang === "fr" ? fr : en);\n'
        u'  const orderNumber = order.order_number || order.id.slice(0, 8).toUpperCase();',
        "decline-head")

D = [
    (u'<h2 style="color:#333;font-size:20px;margin:0 0 20px;">Dear ${order.customer_name},</h2>',
     u'<h2 style="color:#333;font-size:20px;margin:0 0 20px;">${tr("Dear", "Bonjour")} ${order.customer_name},</h2>'),
    (u'          Thank you for choosing Bento Cake Studio. We truly appreciate your support.\n',
     u'          ${tr(\n'
     u'            "Thank you for choosing Bento Cake Studio. We truly appreciate your support.",\n'
     u'            "Merci d’avoir choisi Bento Cake Studio. Votre confiance nous touche beaucoup."\n'
     u'          )}\n'),
    (u'          Unfortunately, we are unable to accept your order <strong>#${orderNumber}</strong> scheduled for \n'
     u'          <strong>${formatDateCH(order.order_date)}</strong> because we have already reached our maximum production capacity for that day.\n',
     u'          ${tr(\n'
     u'            `Unfortunately, we are unable to accept your order <strong>#${orderNumber}</strong> scheduled for <strong>${formatDateCH(order.order_date)}</strong> because we have already reached our maximum production capacity for that day.`,\n'
     u'            `Malheureusement, nous ne pouvons pas accepter votre commande <strong>n° ${orderNumber}</strong> prévue le <strong>${formatDateCH(order.order_date)}</strong>, car notre capacité de production maximale est déjà atteinte pour cette journée.`\n'
     u'          )}\n'),
    (u'          Your payment has been fully refunded, and the amount should appear back in your account within a few business days.\n',
     u'          ${tr(\n'
     u'            "Your payment has been fully refunded, and the amount should appear back in your account within a few business days.",\n'
     u'            "Votre paiement a été intégralement remboursé ; le montant devrait apparaître sur votre compte sous quelques jours ouvrables."\n'
     u'          )}\n'),
    (u'>Order details</h3>', u'>${tr("Order details", "Détails de la commande")}</h3>'),
    (u'font-size:14px;">Order</td>', u'font-size:14px;">${tr("Order", "Commande")}</td>'),
    (u'font-size:14px;">Amount</td>', u'font-size:14px;">${tr("Amount", "Montant")}</td>'),
    (u'font-size:14px;">Status</td>', u'font-size:14px;">${tr("Status", "Statut")}</td>'),
    (u'font-weight:600;">Refunded</td>', u'font-weight:600;">${tr("Refunded", "Remboursé")}</td>'),
    (u'          We sincerely apologize for the inconvenience. If you\'d like, you are welcome to place a new order for another available date. We would love to create something special for you.\n',
     u'          ${tr(\n'
     u'            "We sincerely apologise for the inconvenience. If you\'d like, you are welcome to place a new order for another available date. We would love to create something special for you.",\n'
     u'            "Nous sommes sincèrement désolées pour la gêne occasionnée. Si vous le souhaitez, vous pouvez passer une nouvelle commande pour une autre date disponible. Ce sera un plaisir de créer quelque chose de spécial pour vous."\n'
     u'          )}\n'),
    (u'            Browse Our Catalog\n', u'            ${tr("Browse Our Catalogue", "Découvrir notre catalogue")}\n'),
    (u'subject: `Update Regarding Your Order #${orderNumber}`,',
     u'subject: tr(`Update Regarding Your Order #${orderNumber}`, `Mise à jour concernant votre commande n° ${orderNumber}`),'),
]
for old, new in D:
    s = rep(s, old, new, "decline:" + old[:45])

# --- 3d. shared footer address (Genève, per the legal page) --------------
s = rep(s,
        u'<p style="color:#aaa;font-size:11px;margin:0;">Bento Cake Studio · Lausanne, Switzerland</p>',
        u'<p style="color:#aaa;font-size:11px;margin:0;">${tr("Bento Cake Studio · Geneva, Switzerland", "Bento Cake Studio · Genève, Suisse")}</p>',
        "footer", 2)

# --- 3e. invoice PDF ----------------------------------------------------
s = rep(s,
        u'async function generateInvoicePdf(order: any): Promise<string> {\n'
        u'  const pdfDoc = await PDFDocument.create();',
        u'async function generateInvoicePdf(order: any): Promise<string> {\n'
        u'  const lang = getCustomerLang(order);\n'
        u'  const tr = (en: string, fr: string) => (lang === "fr" ? fr : en);\n'
        u'\n'
        u'  const pdfDoc = await PDFDocument.create();',
        "pdf-head")

P = [
    (u'page.drawText("Facture acquittée", { x: margin, y, size: 16, font: fontBold, color: black });',
     u'page.drawText(tr("Paid invoice", "Facture acquittée"), { x: margin, y, size: 16, font: fontBold, color: black });'),
    (u'{ text: "Adresse : 58 Chemin de la Gradelle, 1224 Genève", font: fontRegular },',
     u'{ text: tr("Address: 58 Chemin de la Gradelle, 1224 Geneva", "Adresse : 58 Chemin de la Gradelle, 1224 Genève"), font: fontRegular },'),
    (u'{ text: "Téléphone : +41 78 927 59 97", font: fontRegular },',
     u'{ text: tr("Phone: +41 78 927 59 97", "Téléphone : +41 78 927 59 97"), font: fontRegular },'),
    (u'{ text: "Email : Contact@bentocakestudio.ch", font: fontRegular },',
     u'{ text: tr("Email: Contact@bentocakestudio.ch", "Email : Contact@bentocakestudio.ch"), font: fontRegular },'),
    (u'{ text: "IDE : CHE-425.048.539", font: fontRegular },',
     u'{ text: tr("Business ID: CHE-425.048.539", "IDE : CHE-425.048.539"), font: fontRegular },'),
    (u'{ text: "TVA : Non assujetti TVA", font: fontRegular },',
     u'{ text: tr("VAT: not subject to VAT", "TVA : Non assujetti TVA"), font: fontRegular },'),
    (u'drawRight(`Facture n° : ${invoiceNumber}`, fontBold, ry);',
     u'drawRight(tr(`Invoice no.: ${invoiceNumber}`, `Facture n° : ${invoiceNumber}`), fontBold, ry);'),
    (u'drawRight(`Date de facture : ${invoiceDate}`, fontRegular, ry);',
     u'drawRight(tr(`Invoice date: ${invoiceDate}`, `Date de facture : ${invoiceDate}`), fontRegular, ry);'),
    (u'drawRight(`Date commande : ${orderDateFormatted}`, fontRegular, ry);',
     u'drawRight(tr(`Order date: ${orderDateFormatted}`, `Date commande : ${orderDateFormatted}`), fontRegular, ry);'),
    (u'page.drawText("Client", { x: margin, y, size: 11, font: fontBold, color: black });',
     u'page.drawText(tr("Customer", "Client"), { x: margin, y, size: 11, font: fontBold, color: black });'),
    (u'page.drawText(`Nom : ${order.customer_name}`,',
     u'page.drawText(tr(`Name: ${order.customer_name}`, `Nom : ${order.customer_name}`),'),
    (u'page.drawText(`Adresse : ${order.delivery_address}`,',
     u'page.drawText(tr(`Address: ${order.delivery_address}`, `Adresse : ${order.delivery_address}`),'),
    (u'page.drawText(`Email : ${order.customer_email}`,',
     u'page.drawText(tr(`Email: ${order.customer_email}`, `Email : ${order.customer_email}`),'),
    (u'page.drawText("Description", { x: col1 + 5,',
     u'page.drawText(tr("Description", "Description"), { x: col1 + 5,'),
    (u'page.drawText("Quantité", { x: col2 + 5,',
     u'page.drawText(tr("Quantity", "Quantité"), { x: col2 + 5,'),
    (u'page.drawText("Prix unitaire (CHF)", { x: col3 + 5,',
     u'page.drawText(tr("Unit price (CHF)", "Prix unitaire (CHF)"), { x: col3 + 5,'),
    (u'page.drawText("Total (CHF)", { x: col4 + 5,',
     u'page.drawText(tr("Total (CHF)", "Total (CHF)"), { x: col4 + 5,'),
    (u'const rowItems = items.length > 0 ? items : [{ styleName: "Gâteau personnalisé", total: order.total_amount }];',
     u'const rowItems = items.length > 0 ? items : [{ styleName: tr("Custom cake", "Gâteau personnalisé"), total: order.total_amount }];'),
    (u': (item.styleName || "Gâteau personnalisé");',
     u': (item.styleName || tr("Custom cake", "Gâteau personnalisé"));'),
    (u'page.drawText(`Total payé : CHF ${formatPrice(order.total_amount)}`,',
     u'page.drawText(tr(`Total paid: CHF ${formatPrice(order.total_amount)}`, `Total payé : CHF ${formatPrice(order.total_amount)}`),'),
    (u'page.drawText("Commande payée avant réalisation. Gâteau personnalisé non repris, non échangé.", {',
     u'page.drawText(tr("Order paid before production. Custom cakes cannot be returned or exchanged.", "Commande payée avant réalisation. Gâteau personnalisé non repris, non échangé."), {'),
    (u'page.drawText("Merci pour votre confiance", { x: margin, y, size: 10, font: fontRegular, color: black });',
     u'page.drawText(tr("Thank you for your trust", "Merci pour votre confiance"), { x: margin, y, size: 10, font: fontRegular, color: black });'),
]
for old, new in P:
    s = rep(s, old, new, "pdf:" + old[:45])

# invoice attachment filename
s = rep(s,
        u'filename: `Facture_${invoiceNum}.pdf`,',
        u'filename: tr(`Invoice_${invoiceNum}.pdf`, `Facture_${invoiceNum}.pdf`),',
        "pdf-filename")

write(p, s)
print("manage-order OK")
print("ALL DONE")
