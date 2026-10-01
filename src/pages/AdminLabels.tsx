import { useState, useEffect, useRef, useCallback } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Tag, Calendar, Loader2, Download, Printer, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { isAdminEmail } from "@/lib/adminAccess";
import {
  LabelItem,
  buildLabelItems,
  drawLabelToCanvas,
  downloadLabelAsPng,
  downloadAllLabelsAsPngs,
  formatDateLabel,
} from "@/lib/labelUtils";

// ─── Label canvas preview ─────────────────────────────────────────────────────

const LabelCanvas = ({ label }: { label: LabelItem }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) drawLabelToCanvas(ref.current, label);
  }, [label]);
  return (
    <canvas
      ref={ref}
      // Canvas internal resolution: 400×640 (203 DPI).
      // CSS display at 50% → ~200×320 px on screen (close to real label size).
      style={{ width: 200, height: 320, display: "block", border: "1px solid #e5e7eb" }}
      title={`${label.orderNumber} · ${label.customerName}`}
    />
  );
};

// ─── Print-only HTML label ────────────────────────────────────────────────────
// Used by browser print only (Ctrl+P). Rendered at exact 50 × 80 mm.

const PrintLabel = ({ label }: { label: LabelItem }) => {
  const pf = (v: string | null | undefined) =>
    v ? (
      <p style={{ margin: 0, fontSize: 8, lineHeight: 1.3, color: "#111" }}>{v}</p>
    ) : null;
  const kv = (k: string, v: string | null | undefined) =>
    v ? (
      <div style={{ display: "flex", gap: 4, margin: "1px 0" }}>
        <span style={{ fontSize: 7, color: "#888", textTransform: "uppercase", minWidth: 44, flexShrink: 0 }}>{k}</span>
        <span style={{ fontSize: 8, color: "#111", lineHeight: 1.3 }}>{v}</span>
      </div>
    ) : null;

  return (
    <div
      className="print-label"
      style={{
        width: "50mm",
        height: "80mm",
        padding: "2.5mm 3mm",
        boxSizing: "border-box",
        fontFamily: "Arial, sans-serif",
        border: "0.5pt solid #000",
        overflow: "hidden",
        position: "relative",
        pageBreakAfter: "always",
        breakAfter: "page",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 1 }}>
        <span style={{ fontSize: 7, color: "#777" }}>{label.orderNumber}</span>
        <span style={{ fontSize: 7, color: "#777" }}>{formatDateLabel(label.effectiveDate)}</span>
        {label.quantityTotal > 1 && (
          <span style={{ fontSize: 7, fontWeight: "bold", color: "#555" }}>
            {label.quantityIndex + 1}/{label.quantityTotal}
          </span>
        )}
      </div>
      <p style={{ margin: "0 0 1.5mm", fontSize: 10, fontWeight: "bold", lineHeight: 1.2 }}>
        {label.customerName.toUpperCase()}
      </p>
      <hr style={{ border: "none", borderTop: "0.75pt solid #333", margin: "1mm 0" }} />
      {/* Product */}
      <p style={{ margin: "0 0 0.5mm", fontSize: 8, fontWeight: "bold" }}>
        {[label.productLabel, label.sizeLabel, label.shapeLabel].filter(Boolean).join(" · ")}
      </p>
      {pf(label.flavorLine)}
      <hr style={{ border: "none", borderTop: "0.5pt solid #ccc", margin: "1mm 0" }} />
      {/* Design */}
      {kv("Base", label.baseColorLabel)}
      {kv("Design", label.designLine)}
      {kv("Déco", label.decorationLine)}
      {/* Text */}
      {label.cakeText && (
        <>
          <hr style={{ border: "none", borderTop: "0.5pt solid #ccc", margin: "1mm 0" }} />
          <p style={{ margin: "0 0 0.5mm", fontSize: 8, fontStyle: "italic" }}>"{label.cakeText}"</p>
          {pf([label.textStyle, label.textColorLabel].filter(Boolean).join("  ·  "))}
        </>
      )}
    </div>
  );
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const today = () => new Date().toISOString().split("T")[0];

function groupByDate(labels: LabelItem[]): { date: string; labels: LabelItem[] }[] {
  const map = new Map<string, LabelItem[]>();
  for (const l of labels) {
    if (!map.has(l.effectiveDate)) map.set(l.effectiveDate, []);
    map.get(l.effectiveDate)!.push(l);
  }
  return [...map.entries()].map(([date, labels]) => ({ date, labels }));
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AdminLabels() {
  const { t } = useLang();
  const { user, loading: authLoading } = useAuth();
  const isAdmin = isAdminEmail(user?.email);
  const [searchParams] = useSearchParams();

  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allLabels, setAllLabels] = useState<LabelItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);

  // Pre-fill date from URL params (?date=2026-10-01 or ?orderId=xxx handled via load)
  useEffect(() => {
    const d = searchParams.get("date");
    if (d) { setStartDate(d); setEndDate(d); }
  }, [searchParams]);

  const selectedLabels = allLabels.filter((l) => selected.has(l.labelId));

  // ── Load ────────────────────────────────────────────────────────────────────

  const handleLoad = useCallback(async () => {
    setLoading(true);
    setError(null);
    setAllLabels([]);
    setSelected(new Set());
    setHasLoaded(true);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke(
        "get-orders-for-labels",
        { body: { startDate, endDate } }
      );
      if (fnErr) throw fnErr;
      const items: any[] = data?.items ?? [];
      const labels = items.flatMap(buildLabelItems);
      setAllLabels(labels);
      // Select all by default
      setSelected(new Set(labels.map((l) => l.labelId)));
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  // ── Selection helpers ────────────────────────────────────────────────────────

  const toggleLabel = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleAll = () => {
    if (selected.size === allLabels.length) setSelected(new Set());
    else setSelected(new Set(allLabels.map((l) => l.labelId)));
  };

  const toggleDate = (labels: LabelItem[]) => {
    const ids = labels.map((l) => l.labelId);
    const allChecked = ids.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allChecked) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  };

  // ── Export ───────────────────────────────────────────────────────────────────

  const handlePrint = () => window.print();

  const handleDownloadPngs = async () => {
    if (!selectedLabels.length) return;
    setDownloading(true);
    try {
      await downloadAllLabelsAsPngs(selectedLabels);
    } finally {
      setDownloading(false);
    }
  };

  // ── Auth guard ───────────────────────────────────────────────────────────────

  if (authLoading) return null;
  if (!isAdmin) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-16 text-center text-muted-foreground">
          {t("Access restricted", "Accès restreint")}
        </div>
      </Layout>
    );
  }

  const groups = groupByDate(allLabels);

  const navLink = "text-muted-foreground hover:text-foreground";
  const navActive = "text-foreground font-semibold";

  return (
    <Layout>
      {/* ── Print stylesheet ─────────────────────────────────────────────── */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-area { display: block !important; }
          @page { margin: 4mm; size: 50mm 80mm; }
          body { background: #fff !important; }
        }
        @media screen {
          .print-area { display: none; }
        }
      `}</style>

      {/* ── Hidden print area ───────────────────────────────────────────────── */}
      <div className="print-area">
        {selectedLabels.map((label) => (
          <PrintLabel key={label.labelId} label={label} />
        ))}
      </div>

      {/* ── Main UI ─────────────────────────────────────────────────────────── */}
      <main className="container mx-auto px-4 py-8 max-w-6xl no-print">

        {/* Admin nav */}
        <div className="flex items-center justify-center gap-4 mb-4 text-[11px] uppercase tracking-[0.105em] flex-wrap">
          <Link to="/admin/orders" className={navLink}>{t("Orders", "Commandes")}</Link>
          <Link to="/admin/manual-orders" className={navLink}>{t("Manual orders", "Commandes manuelles")}</Link>
          <Link to="/admin/calendar" className={navLink}>{t("Calendar", "Calendrier")}</Link>
          <Link to="/admin/dashboard" className={navLink}>{t("Dashboard", "Tableau de bord")}</Link>
          <Link to="/admin/production" className={navLink}>{t("Production", "Production")}</Link>
          <span className={navActive}>{t("Labels", "Étiquettes")}</span>
        </div>

        {/* Page header */}
        <h1 className="font-sans uppercase tracking-[0.105em] text-2xl md:text-3xl text-foreground mb-8 text-center font-semibold flex items-center justify-center gap-3">
          <Tag className="w-6 h-6 text-primary" strokeWidth={1.5} />
          {t("Production Labels", "Étiquettes de production")}
        </h1>

        {/* ── Date range picker ──────────────────────────────────────────────── */}
        <div className="flex items-end gap-3 mb-8 flex-wrap">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] uppercase tracking-[0.105em] text-muted-foreground font-semibold">
              {t("From", "Du")}
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="border border-border bg-background text-foreground text-sm px-3 py-2 rounded-none focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] uppercase tracking-[0.105em] text-muted-foreground font-semibold">
              {t("To", "Au")}
            </label>
            <input
              type="date"
              value={endDate}
              min={startDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="border border-border bg-background text-foreground text-sm px-3 py-2 rounded-none focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <Button
            onClick={handleLoad}
            disabled={loading || !startDate || !endDate}
            className="rounded-none"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <Calendar className="w-4 h-4 mr-2" />
            )}
            {t("Load", "Charger")}
          </Button>
        </div>

        {error && (
          <div className="mb-6 p-4 border border-destructive/40 bg-destructive/10 text-destructive text-sm">
            {error}
          </div>
        )}

        {/* ── Content ────────────────────────────────────────────────────────── */}
        {hasLoaded && !loading && (
          <>
            {allLabels.length === 0 ? (
              <p className="text-center text-muted-foreground py-16">
                {t("No orders for this period.", "Aucune commande sur cette période.")}
              </p>
            ) : (
              <div className="flex flex-col lg:flex-row gap-6 items-start">

                {/* ── Left: order list ────────────────────────────────────── */}
                <div className="w-full lg:w-64 flex-shrink-0 border border-border">
                  {/* Select-all header */}
                  <div className="flex items-center gap-2 px-3 py-2 bg-secondary/30 border-b border-border">
                    <input
                      type="checkbox"
                      checked={selected.size === allLabels.length && allLabels.length > 0}
                      onChange={toggleAll}
                      className="accent-primary w-3.5 h-3.5"
                      id="select-all"
                    />
                    <label
                      htmlFor="select-all"
                      className="text-[11px] uppercase tracking-[0.105em] font-semibold text-foreground cursor-pointer flex-1"
                    >
                      {t("All", "Tout")} ({allLabels.length})
                    </label>
                    <span className="text-[11px] text-muted-foreground">
                      {selected.size} {t("sel.", "sél.")}
                    </span>
                  </div>

                  {/* Groups */}
                  <div className="divide-y divide-border max-h-[70vh] overflow-y-auto">
                    {groups.map(({ date, labels: groupLabels }) => {
                      const groupIds = groupLabels.map((l) => l.labelId);
                      const allGroupChecked = groupIds.every((id) => selected.has(id));
                      return (
                        <div key={date}>
                          {/* Date group header */}
                          <div
                            className="flex items-center gap-2 px-3 py-1.5 bg-secondary/20 cursor-pointer hover:bg-secondary/40"
                            onClick={() => toggleDate(groupLabels)}
                          >
                            <input
                              type="checkbox"
                              checked={allGroupChecked}
                              onChange={() => toggleDate(groupLabels)}
                              onClick={(e) => e.stopPropagation()}
                              className="accent-primary w-3.5 h-3.5"
                            />
                            <span className="text-[11px] uppercase tracking-[0.105em] font-semibold text-foreground">
                              {formatDateLabel(date)}
                            </span>
                            <span className="text-[10px] text-muted-foreground ml-auto">
                              {groupLabels.length}
                            </span>
                          </div>
                          {/* Items */}
                          {groupLabels.map((label) => (
                            <div
                              key={label.labelId}
                              className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-secondary/20 ${selected.has(label.labelId) ? "bg-primary/5" : ""}`}
                              onClick={() => toggleLabel(label.labelId)}
                            >
                              <input
                                type="checkbox"
                                checked={selected.has(label.labelId)}
                                onChange={() => toggleLabel(label.labelId)}
                                onClick={(e) => e.stopPropagation()}
                                className="accent-primary w-3.5 h-3.5 flex-shrink-0"
                              />
                              <div className="min-w-0">
                                <p className="text-[12px] font-medium text-foreground truncate">
                                  {label.customerName}
                                </p>
                                <p className="text-[11px] text-muted-foreground truncate">
                                  {[label.productLabel, label.sizeLabel]
                                    .filter(Boolean)
                                    .join(" · ")}
                                  {label.quantityTotal > 1 &&
                                    ` (${label.quantityIndex + 1}/${label.quantityTotal})`}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* ── Right: preview + export ─────────────────────────────── */}
                <div className="flex-1 min-w-0">
                  {/* Export actions */}
                  <div className="flex items-center gap-3 mb-4 flex-wrap">
                    <Button
                      variant="outline"
                      className="rounded-none gap-2"
                      onClick={handlePrint}
                      disabled={selectedLabels.length === 0}
                    >
                      <Printer className="w-4 h-4" />
                      {t("Print (browser)", "Imprimer (navigateur)")}
                    </Button>
                    <Button
                      variant="outline"
                      className="rounded-none gap-2"
                      onClick={handleDownloadPngs}
                      disabled={selectedLabels.length === 0 || downloading}
                    >
                      {downloading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Download className="w-4 h-4" />
                      )}
                      {t(
                        `Download PNG${selectedLabels.length !== 1 ? "s" : ""} (${selectedLabels.length})`,
                        `Télécharger PNG${selectedLabels.length !== 1 ? "s" : ""} (${selectedLabels.length})`
                      )}
                    </Button>
                    {selectedLabels.length > 0 && (
                      <p className="text-[11px] text-muted-foreground">
                        {t(
                          "PNG: 400×640 px · 203 DPI · for NIIMBOT B1 app",
                          "PNG : 400×640 px · 203 DPI · pour l'app NIIMBOT B1"
                        )}
                      </p>
                    )}
                  </div>

                  {/* Label grid */}
                  {selectedLabels.length === 0 ? (
                    <div className="border border-dashed border-border p-12 text-center text-muted-foreground text-sm">
                      {t("Select labels to preview them here.", "Sélectionnez des étiquettes pour les prévisualiser ici.")}
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-4">
                      {selectedLabels.map((label) => (
                        <div key={label.labelId} className="relative group">
                          <LabelCanvas label={label} />
                          {/* Single-label download on hover */}
                          <button
                            title={t("Download this label", "Télécharger cette étiquette")}
                            className="absolute bottom-1 right-1 bg-background/80 border border-border p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => downloadLabelAsPng(label)}
                          >
                            <Download className="w-3 h-3 text-foreground" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* NIIMBOT workflow note */}
                  <div className="mt-6 p-4 bg-secondary/20 border border-border text-[12px] text-muted-foreground space-y-1">
                    <p className="font-semibold text-foreground text-[12px]">
                      {t("NIIMBOT B1 workflow", "Workflow NIIMBOT B1")}
                    </p>
                    <p>
                      {t(
                        "1. Click \"Download PNGs\" — allow multiple downloads if prompted.",
                        "1. Cliquez « Télécharger PNGs » — autorisez les téléchargements multiples si demandé."
                      )}
                    </p>
                    <p>
                      {t(
                        "2. Transfer PNG files to your phone (AirDrop, iCloud, etc.).",
                        "2. Transférez les fichiers PNG sur votre téléphone (AirDrop, iCloud, etc.)."
                      )}
                    </p>
                    <p>
                      {t(
                        "3. Open NIIMBOT app → tap each image → Print (203 DPI, 50×80 mm).",
                        "3. Ouvrez l'app NIIMBOT → appuyez sur chaque image → Imprimer (203 DPI, 50×80 mm)."
                      )}
                    </p>
                    <p className="text-[11px] opacity-70">
                      {t(
                        "Browser print (Ctrl+P) works for any desktop printer — set page size to 50×80 mm.",
                        "Impression navigateur (Ctrl+P) fonctionne pour toute imprimante bureau — réglez le format à 50×80 mm."
                      )}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* First-load placeholder */}
        {!hasLoaded && !loading && (
          <div className="text-center text-muted-foreground py-16">
            <Tag className="w-8 h-8 mx-auto mb-3 opacity-30" strokeWidth={1} />
            <p className="text-sm">
              {t(
                "Choose a date range and click Load.",
                "Choisissez une plage de dates et cliquez sur Charger."
              )}
            </p>
          </div>
        )}
      </main>
    </Layout>
  );
}
