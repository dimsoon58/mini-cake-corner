import {
  LABEL_DPI, LABEL_H, LABEL_W, NIIMBOT_COLUMNS, fontCss, niimbotRow,
  type CakeLabel, type FontSpec, type LabelPage, type Measure,
} from "@/lib/productionLabels";

// Admin > Étiquettes de production — rendu et exports (navigateur).
//
// L'aperçu affiche exactement les images exportées : chaque étiquette est
// dessinée en 384 × 640 points (203 dpi, résolution de la NIIMBOT B1),
// puis passée en noir et blanc pur, comme l'imprimante thermique l'imprime.
// Exports : images PNG (ZIP), PDF 50 × 80 mm (contrôle de mise en page),
// tableau Excel pour la « source de données » de l'app NIIMBOT. Aucun
// export n'écrit en base ni n'envoie quoi que ce soit.

// Mesure et dessin se font TOUJOURS sur des canvas hors de la page : un
// canvas inséré dans la page peut choisir une autre police de repli et
// mesurer autrement (constaté : 83 px contre 71 px pour le même texte).
// L'aperçu recopie l'image ainsi produite, pixel pour pixel.
let measureCtx: CanvasRenderingContext2D | null = null;
export const canvasMeasure: Measure = (text: string, font: FontSpec) => {
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  measureCtx!.font = fontCss(font);
  return measureCtx!.measureText(text).width;
};

/** Dessine une étiquette. Par défaut 1 point = 1 pixel, noir et blanc pur :
 *  exactement ce que l'imprimante thermique (203 dpi) imprimera. Avec
 *  { scale, mono: false } (PDF de contrôle), même mise en page dessinée en
 *  plus haute définition et lissée, pour un texte net à l'écran et à
 *  l'impression. Si une cible est donnée (aperçu), l'image y est recopiée. */
export function renderPage(page: LabelPage, target?: HTMLCanvasElement, opts: { scale?: number; mono?: boolean } = {}): HTMLCanvasElement {
  const scale = opts.scale ?? 1;
  const mono = opts.mono ?? true;
  const canvas = document.createElement("canvas");
  canvas.width = LABEL_W * scale;
  canvas.height = LABEL_H * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, LABEL_W, LABEL_H);
  ctx.fillStyle = "#000";
  ctx.strokeStyle = "#000";
  ctx.textBaseline = "top";
  for (const op of page.ops) {
    if (op.type === "text") {
      ctx.font = fontCss(op.font);
      ctx.textAlign = op.align === "right" ? "right" : "left";
      ctx.fillStyle = op.white ? "#fff" : "#000";
      ctx.fillText(op.text, op.x, op.y);
      ctx.fillStyle = "#000";
    } else if (op.type === "fill") {
      ctx.fillRect(Math.round(op.x), Math.round(op.y), Math.round(op.w), Math.round(op.h));
    } else if (op.type === "warn") {
      // Triangle « attention » dessiné (blanc sur le bandeau noir), « ! » noir.
      const { x, y, size } = op;
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.moveTo(x + size / 2, y); ctx.lineTo(x + size, y + size); ctx.lineTo(x, y + size); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#000";
      ctx.fillRect(Math.round(x + size / 2 - 1.5), Math.round(y + size * 0.35), 3, Math.round(size * 0.35));
      ctx.fillRect(Math.round(x + size / 2 - 1.5), Math.round(y + size * 0.8), 3, 3);
    } else if (op.type === "rule") {
      ctx.fillRect(16, Math.round(op.y), LABEL_W - 32, op.thick ? 3 : 1);
    } else {
      ctx.lineWidth = 2;
      ctx.strokeRect(Math.round(op.x) + 1, Math.round(op.y) + 1, Math.round(op.w) - 2, Math.round(op.h) - 2);
    }
  }
  // Seuil 1 bit : ce qui sera réellement imprimé (pas de gris en thermique).
  if (mono) {
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 < 150 ? 0 : 255;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }
  if (!target) return canvas;
  target.width = canvas.width;
  target.height = canvas.height;
  target.getContext("2d")!.drawImage(canvas, 0, 0);
  return target;
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Image impossible à créer"))), type, quality));

const safe = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");

/** Nom de fichier : ordre d'impression, date, commande, repère, suite. */
export function pageFileName(page: LabelPage, n: number, ext: string): string {
  const c = page.cake;
  return [
    String(n).padStart(3, "0"),
    c.date ?? "sans-date",
    safe(c.orderNumber ?? "sans-numero"),
    safe(c.customer || "client"),
    c.marker ? `gateau-${c.marker.replace("/", "-sur-")}` : "",
    page.count > 1 ? `etiquette-${page.index}-sur-${page.count}` : "",
  ].filter(Boolean).join("_") + `.${ext}`;
}

export function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
}

const PRINT_GUIDE = [
  "Étiquettes de production — Bento Cake Studio",
  "",
  "Format : NIIMBOT B1, étiquette 50 × 80 mm verticale, 384 × 640 points à 203 dpi (48 mm imprimables).",
  "Une image = une étiquette, dans l'ordre d'impression (numéro au début du nom de fichier).",
  "",
  "Impression avec l'app NIIMBOT (téléphone) :",
  "1. Copier les images sur le téléphone (AirDrop, Fichiers, Google Drive…).",
  "2. Dans l'app NIIMBOT, créer une étiquette 50 × 80 mm, orientation verticale.",
  "3. Insérer > Image : choisir l'image, l'étirer sur toute l'étiquette.",
  "4. Imprimer. Recommencer pour l'image suivante.",
  "",
  "Pour plusieurs commandes d'un coup, préférer le fichier Excel (source de données de l'app).",
  "La mise en page doit être validée une première fois sur l'imprimante (marges, densité).",
].join("\n");

export async function exportPngZip(pages: LabelPage[], zipName: string) {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  let n = 0;
  for (const p of pages) zip.file(pageFileName(p, ++n, "png"), await toBlob(renderPage(p), "image/png"));
  zip.file("LISEZMOI.txt", PRINT_GUIDE);
  download(await zip.generateAsync({ type: "blob" }), zipName);
}

export async function exportOnePng(page: LabelPage) {
  download(await toBlob(renderPage(page), "image/png"), pageFileName(page, 1, "png"));
}

// ── PDF 50 × 80 mm, une page par étiquette (images JPEG, sans dépendance) ─
// Pages dessinées en 4× (1536 × 2560) et lissées : le texte reste net quand
// on zoome ou qu'on imprime le PDF (avant : image 384 × 640 en noir et blanc
// pur, crénelée et tachée par la compression JPEG). Mise en page identique.
const PDF_SCALE = 4;
const MM = 72 / 25.4;
export async function exportPdf(pages: LabelPage[], name: string) {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let size = 0;
  const put = (x: string | Uint8Array) => { const b = typeof x === "string" ? enc.encode(x) : x; chunks.push(b); size += b.length; };
  const obj = (id: number, body: () => void) => { offsets[id] = size; put(`${id} 0 obj\n`); body(); put("\nendobj\n"); };

  const pageW = 50 * MM, pageH = 80 * MM;
  const imgW = (LABEL_W / LABEL_DPI) * 25.4 * MM;      // 48,05 mm
  const imgX = (pageW - imgW) / 2;
  const n = pages.length;
  const pageIds = pages.map((_, i) => 3 + i * 3);
  put("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  obj(1, () => put("<< /Type /Catalog /Pages 2 0 R >>"));
  obj(2, () => put(`<< /Type /Pages /Count ${n} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`));
  for (let i = 0; i < n; i++) {
    const [pid, cid, iid] = [3 + i * 3, 4 + i * 3, 5 + i * 3];
    const jpeg = new Uint8Array(await (await toBlob(renderPage(pages[i], undefined, { scale: PDF_SCALE, mono: false }), "image/jpeg", 0.92)).arrayBuffer());
    const content = `q ${imgW.toFixed(3)} 0 0 ${pageH.toFixed(3)} ${imgX.toFixed(3)} 0 cm /Im0 Do Q`;
    obj(pid, () => put(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW.toFixed(3)} ${pageH.toFixed(3)}] /Resources << /XObject << /Im0 ${iid} 0 R >> >> /Contents ${cid} 0 R >>`));
    obj(cid, () => { put(`<< /Length ${content.length} >>\nstream\n`); put(content); put("\nendstream"); });
    obj(iid, () => {
      put(`<< /Type /XObject /Subtype /Image /Width ${LABEL_W * PDF_SCALE} /Height ${LABEL_H * PDF_SCALE} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
      put(jpeg); put("\nendstream");
    });
  }
  const xref = size;
  const count = 3 + n * 3;
  put(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let id = 1; id < count; id++) put(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  put(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  download(new Blob(chunks, { type: "application/pdf" }), name);
}

// ── Excel pour la source de données de l'app NIIMBOT ─────────────────────
// Une ligne d'en-tête, une ligne par gâteau, aucune cellule fusionnée,
// tout en texte (règles d'import NIIMBOT).
export async function exportNiimbotXlsx(cakes: CakeLabel[], name: string) {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Etiquettes");
  ws.columns = NIIMBOT_COLUMNS.map((h) => ({ header: h, key: h, width: h === "Détails" ? 60 : h === "Texte" || h === "Couleur déco" || h === "Déco" ? 36 : 18, style: { numFmt: "@" } }));
  for (const c of cakes) ws.addRow(niimbotRow(c));
  ws.getColumn("Détails").alignment = { wrapText: true, vertical: "top" };
  ws.getRow(1).font = { bold: true };
  download(new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), name);
}
