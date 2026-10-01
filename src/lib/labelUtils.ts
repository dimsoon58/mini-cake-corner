import { baseColors, sizes, shapes, styles } from "@/data/customization";
import { designLabel, sizeLabel, shapeLabel, flavorLabel } from "@/lib/orderLabels";
import { PRODUCT_LABELS } from "@/lib/orderLabels";

// ─── Types ────────────────────────────────────────────────────────────────────

export type LabelItem = {
  labelId: string;           // item.id + "-" + quantityIndex
  itemId: string;            // order_items.id
  orderId: string;
  orderNumber: string;
  customerName: string;
  effectiveDate: string;     // "yyyy-MM-dd"
  productLabel: string;
  sizeLabel: string | null;
  shapeLabel: string | null;
  flavorLine: string;
  baseColorLabel: string | null;
  designLine: string | null;
  decorationLine: string | null;
  cakeText: string | null;
  textStyle: string | null;
  textColorLabel: string | null;
  quantityTotal: number;
  quantityIndex: number;     // 0-based
};

// ─── Colour helpers ───────────────────────────────────────────────────────────

export function resolveColorName(colorId: string | null | undefined): string | null {
  if (!colorId) return null;
  const found = baseColors.find((c) => c.id === colorId);
  return found?.name ?? colorId;
}

export function resolveColorNames(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Handles comma-separated IDs ("baby-blue,pink") and JSON arrays
  let ids: string[] = [];
  if (raw.startsWith("[")) {
    try {
      ids = JSON.parse(raw);
    } catch {
      ids = [raw];
    }
  } else {
    ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
  }
  if (ids.length === 0) return null;
  return ids.map((id) => resolveColorName(id) ?? id).join(", ");
}

// ─── Build label items from a raw API item ────────────────────────────────────

export function buildLabelItems(raw: any): LabelItem[] {
  const order = raw.orders ?? {};
  const qty = typeof raw.quantity === "number" && raw.quantity > 1 ? raw.quantity : 1;

  const base: Omit<LabelItem, "labelId" | "quantityIndex" | "quantityTotal"> = {
    itemId: raw.id,
    orderId: raw.order_id,
    orderNumber: order.order_number ?? `#${String(order.id ?? raw.order_id).slice(0, 8).toUpperCase()}`,
    customerName: `${order.first_name ?? ""} ${order.last_name ?? ""}`.trim(),
    effectiveDate: raw.effectiveDate ?? "",
    productLabel:
      (PRODUCT_LABELS[raw.product]?.en ?? raw.product ?? "").trim(),
    sizeLabel: raw.size ? sizeLabel(raw.size) : null,
    shapeLabel:
      raw.shape && raw.shape !== "round" ? shapeLabel(raw.shape) : null,
    flavorLine: raw.flavors?.length
      ? (raw.flavors as string[])
          .map((f: string) => flavorLabel(f) || f)
          .join(" · ")
      : "",
    baseColorLabel: resolveColorName(raw.base_color),
    designLine: raw.design ? designLabel(raw.design) : null,
    decorationLine: (() => {
      const parts: (string | null)[] = [
        resolveColorNames(raw.decoration_color),
        resolveColorName(raw.ribbon_color)
          ? `Ribbons: ${resolveColorName(raw.ribbon_color)}`
          : null,
        resolveColorName(raw.butterfly_color)
          ? `Butterfly: ${resolveColorName(raw.butterfly_color)}`
          : null,
      ].filter(Boolean);
      return parts.length ? parts.join(" · ") : null;
    })(),
    cakeText: raw.cake_text ?? null,
    textStyle: raw.text_style ?? null,
    textColorLabel: resolveColorName(raw.text_color),
  };

  return Array.from({ length: qty }, (_, i) => ({
    ...base,
    labelId: `${raw.id}-${i}`,
    quantityIndex: i,
    quantityTotal: qty,
  }));
}

// ─── Date formatting ──────────────────────────────────────────────────────────

export function formatDateLabel(dateStr: string): string {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-");
  if (!y || !m || !d) return dateStr;
  return `${d}.${m}.${y}`;
}

// ─── Canvas drawing (203 DPI, 50 × 80 mm → 400 × 640 px) ─────────────────────

const W = 400;
const H = 640;
const MARGIN = 14;
const LINE_COLOR = "#ccc";

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

/** Draw one label onto canvas. Returns the final Y so callers can detect overflow. */
export function drawLabelToCanvas(
  canvas: HTMLCanvasElement,
  label: LabelItem
): number {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const mx = MARGIN;
  const mw = W - mx * 2;
  let y = mx;

  // White background
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);

  // Outer border
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, W - 2, H - 2);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const drawText = (
    text: string,
    font: string,
    color: string,
    indent = 0
  ): number => {
    ctx.font = font;
    ctx.fillStyle = color;
    const lines = wrapText(ctx, text, mw - indent);
    const [, sizeStr] = font.match(/(\d+)px/) ?? ["", "12"];
    const size = parseInt(sizeStr, 10);
    for (const line of lines) {
      ctx.fillText(line, mx + indent, y + size * 0.85);
      y += size + 4;
    }
    return y;
  };

  const separator = (thick = false, color = LINE_COLOR) => {
    y += 6;
    ctx.strokeStyle = thick ? "#333" : color;
    ctx.lineWidth = thick ? 1.5 : 0.75;
    ctx.beginPath();
    ctx.moveTo(mx, y);
    ctx.lineTo(W - mx, y);
    ctx.stroke();
    y += 8;
  };

  // ── Section 1: Header ──────────────────────────────────────────────────────

  // Quantity badge top-right
  if (label.quantityTotal > 1) {
    const badge = `${label.quantityIndex + 1}/${label.quantityTotal}`;
    ctx.font = "bold 14px Arial";
    ctx.fillStyle = "#555";
    ctx.fillText(badge, W - mx - ctx.measureText(badge).width, y + 12);
  }

  // Date (right-aligned) + order number (left)
  ctx.font = "11px Arial";
  ctx.fillStyle = "#777";
  const dateStr = formatDateLabel(label.effectiveDate);
  ctx.fillText(dateStr, W - mx - ctx.measureText(dateStr).width, y + 10);
  ctx.fillText(label.orderNumber, mx, y + 10);
  y += 18;

  // Customer name — large, all caps
  ctx.font = "bold 20px Arial";
  ctx.fillStyle = "#000";
  const nameLines = wrapText(ctx, label.customerName.toUpperCase(), mw);
  for (const line of nameLines) {
    ctx.fillText(line, mx, y + 17);
    y += 24;
  }

  separator(true, "#555");

  // ── Section 2: Product + Flavour ──────────────────────────────────────────

  const productParts = [
    label.productLabel,
    label.sizeLabel,
    label.shapeLabel,
  ].filter(Boolean).join("  ·  ");
  drawText(productParts, "bold 13px Arial", "#000");

  if (label.flavorLine) {
    drawText(label.flavorLine, "13px Arial", "#222");
  }

  separator();

  // ── Section 3: Design details ──────────────────────────────────────────────

  const kw = 86; // key column width (px)

  const drawKeyValue = (key: string, value: string, valueFont = "12px Arial") => {
    ctx.font = "bold 10px Arial";
    ctx.fillStyle = "#777";
    ctx.fillText(key.toUpperCase(), mx, y + 9);
    ctx.font = valueFont;
    ctx.fillStyle = "#111";
    const valLines = wrapText(ctx, value, mw - kw);
    for (const line of valLines) {
      ctx.fillText(line, mx + kw, y + 11);
      y += 15;
    }
    y += 1;
  };

  if (label.baseColorLabel) drawKeyValue("Base", label.baseColorLabel);
  if (label.designLine) drawKeyValue("Design", label.designLine);
  if (label.decorationLine) drawKeyValue("Décoration", label.decorationLine);

  // ── Section 4: Text on cake (conditional) ─────────────────────────────────

  if (label.cakeText) {
    separator();
    drawText(`"${label.cakeText}"`, "italic 13px Arial", "#111");
    const textDetails = [
      label.textStyle ? `Style: ${label.textStyle}` : null,
      label.textColorLabel ? `Couleur texte: ${label.textColorLabel}` : null,
    ]
      .filter(Boolean)
      .join("    ");
    if (textDetails) {
      ctx.font = "11px Arial";
      ctx.fillStyle = "#555";
      ctx.fillText(textDetails, mx, y + 10);
      y += 16;
    }
  }

  return y;
}

/** Download a single label as PNG. */
export function downloadLabelAsPng(label: LabelItem, filename?: string): void {
  const canvas = document.createElement("canvas");
  drawLabelToCanvas(canvas, label);
  const a = document.createElement("a");
  a.download =
    filename ??
    `label-${String(label.quantityIndex + 1).padStart(2, "0")}-${label.orderNumber}.png`;
  a.href = canvas.toDataURL("image/png");
  a.click();
}

/** Download all labels as individual PNGs (sequential, ~200ms apart). */
export async function downloadAllLabelsAsPngs(
  labels: LabelItem[]
): Promise<void> {
  for (let i = 0; i < labels.length; i++) {
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        downloadLabelAsPng(
          labels[i],
          `label-${String(i + 1).padStart(3, "0")}-${labels[i].orderNumber}${labels[i].quantityTotal > 1 ? `-${labels[i].quantityIndex + 1}of${labels[i].quantityTotal}` : ""}.png`
        );
        resolve();
      }, i * 250);
    });
  }
}
