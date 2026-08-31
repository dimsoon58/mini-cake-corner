import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { useLang } from "@/context/LanguageContext";
import type { CandleSelection } from "@/context/CartContext";

export interface FamilyColor { id: string; en: string; fr: string; }

// The 4 validated colour lists — single source, was previously duplicated
// only inside Candles.tsx. Reused by every screen that offers these
// families (Candles, Catalog, DotCakes, KitBentoCake, Cart).
export const FAMILY_CANDLE_COLORS: Record<string, FamilyColor[]> = {
  "thick-spiral": [
    { id: "green", en: "Green", fr: "Vert" },
    { id: "blue", en: "Blue", fr: "Bleu" },
    { id: "purple", en: "Purple", fr: "Violet" },
    { id: "pink", en: "Pink", fr: "Rose" },
    { id: "yellow", en: "Yellow", fr: "Jaune" },
  ],
  "shiny-spiral": [
    { id: "red", en: "Red", fr: "Rouge" },
    { id: "purple", en: "Purple", fr: "Violet" },
    { id: "green", en: "Green", fr: "Vert" },
    { id: "gold", en: "Gold", fr: "Or" },
    { id: "pink", en: "Pink", fr: "Rose" },
    { id: "blue", en: "Blue", fr: "Bleu" },
  ],
  "spiral-pastel": [
    { id: "blue", en: "Blue", fr: "Bleu" },
    { id: "purple", en: "Purple", fr: "Violet" },
    { id: "dark-pink", en: "Dark Pink", fr: "Rose foncé" },
    { id: "light-pink", en: "Light Pink", fr: "Rose clair" },
    { id: "yellow", en: "Yellow", fr: "Jaune" },
    { id: "green", en: "Green", fr: "Vert" },
  ],
  rainbow: [
    { id: "turquoise", en: "Turquoise", fr: "Turquoise" },
    { id: "dark-blue", en: "Dark Blue", fr: "Bleu foncé" },
    { id: "blue", en: "Blue", fr: "Bleu" },
    { id: "green", en: "Green", fr: "Vert" },
    { id: "purple", en: "Purple", fr: "Violet" },
    { id: "light-pink", en: "Light Pink", fr: "Rose clair" },
    { id: "dark-pink", en: "Dark Pink", fr: "Rose foncé" },
    { id: "yellow", en: "Yellow", fr: "Jaune" },
    { id: "orange", en: "Orange", fr: "Orange" },
  ],
};

// Approximate representative swatch colours for the colour picker UI only —
// a visual reference for the customer, not product data. Covers every
// colour id used across the 4 families above.
const CANDLE_COLOR_SWATCH: Record<string, string> = {
  green: "#4CAF50",
  blue: "#3B82F6",
  purple: "#8B5CF6",
  pink: "#EC4899",
  yellow: "#FBBF24",
  red: "#EF4444",
  gold: "#C9A227",
  "dark-pink": "#DB2777",
  "light-pink": "#F9A8D4",
  turquoise: "#14B8A6",
  "dark-blue": "#1E3A8A",
  orange: "#F97316",
};

export interface FamilyCandle {
  id: string;
  name: string;
  nameFr?: string;
  image: string;
  unitPrice: number;
  packPrice?: number;
  packSize?: number;
}

export const ColorFamilyCandleCard = ({
  candle, colors, existing, onCommit, onRemove, imageClassName = "h-40 w-40", compact = false,
}: {
  candle: FamilyCandle;
  colors: FamilyColor[];
  existing?: CandleSelection;
  onCommit: (entry: CandleSelection) => void;
  onRemove: () => void;
  // Lets each screen match this card's photo to its own reference size for
  // a plain (non-coloured) candle — defaults to the size Candles.tsx has
  // always used, so that page renders exactly as before.
  imageClassName?: string;
  // Tighter padding/spacing and drops the two pure-explanation helper lines
  // (no control removed) — for screens where this card sits next to a much
  // simpler plain-candle card and needs to be as close to it in height as
  // possible. Defaults to false, so Candles.tsx is completely unaffected.
  compact?: boolean;
}) => {
  const { t } = useLang();
  const packSize = candle.packSize || 6;
  const maxPieceQty = packSize - 1;

  const [mode, setMode] = useState<"pack" | "piece">(existing?.colors ? "piece" : "pack");
  const [packCount, setPackCount] = useState(existing?.hasPack ? Math.max(1, Math.round(existing.quantity / packSize)) : 1);
  const [pieceQty, setPieceQty] = useState(existing?.colors ? existing.colors.length : 1);
  const [selectedColors, setSelectedColors] = useState<string[]>(existing?.colors ?? []);

  const toggleColor = (colorId: string) => setSelectedColors((prev) =>
    prev.includes(colorId) ? prev.filter((c) => c !== colorId)
      : prev.length >= pieceQty ? prev : [...prev, colorId]
  );

  const changePieceQty = (delta: number) => {
    const next = Math.min(maxPieceQty, Math.max(1, pieceQty + delta));
    setSelectedColors((prev) => (prev.length <= next ? prev : prev.slice(0, next)));
    setPieceQty(next);
  };

  const isPieceValid = selectedColors.length === pieceQty;

  const handleCommit = () => {
    if (mode === "pack") onCommit({ id: candle.id, quantity: packCount * packSize, hasPack: true });
    else if (isPieceValid) onCommit({ id: candle.id, quantity: pieceQty, hasPack: false, colors: selectedColors });
  };

  return (
    <Card className={cn("overflow-hidden", existing && "ring-2 ring-primary")}>
      {/* aspect-square ties this box's height to the CARD's width — on a
          narrow flex column that's fine, but if the card is ever forced
          wider than intended (e.g. by content overflow below), the square
          balloons into a huge blank area above the photo. compact mode
          drops aspect-square entirely so the box is only ever as tall as
          the photo itself, regardless of the card's width. Non-compact
          (Candles.tsx) keeps the original square behaviour unchanged. */}
      <div className={cn("flex items-center justify-center bg-secondary/20", compact ? "p-2" : "aspect-square p-4")}>
        <img src={candle.image} alt={t(candle.name, candle.nameFr || candle.name)} className={cn(imageClassName, "object-contain")} />
      </div>
      <CardContent className={cn("text-center", compact ? "p-2 space-y-1.5" : "p-4 space-y-3")}>
        <h3 className={cn("font-sans tracking-[0.105em] font-semibold uppercase text-foreground", compact ? "text-[11px]" : "text-[13px]")}>
          {t(candle.name, candle.nameFr || candle.name)}
        </h3>
        <p className={cn("text-muted-foreground", compact ? "text-[10px]" : "text-[11px]")}>
          CHF {candle.unitPrice}/pièce · Pack {packSize} = CHF {candle.packPrice}
        </p>

        {existing && (
          <p className="text-xs text-primary font-medium">
            ✓ {existing.colors
              ? `${existing.colors.map((c) => { const fc = colors.find((x) => x.id === c); return fc ? t(fc.en, fc.fr) : c; }).join(", ")} (×${existing.quantity})`
              : `${existing.quantity / packSize} ${t("pack(s)", "pack(s)")} (${existing.quantity} ${t("pcs", "pièces")})`}
          </p>
        )}

        <RadioGroup value={mode} onValueChange={(v) => setMode(v as "pack" | "piece")} className={cn("flex flex-wrap justify-center", compact ? "gap-2" : "gap-4")}>
          <div className="flex items-center space-x-1.5">
            <RadioGroupItem value="pack" id={`${candle.id}-mode-pack`} />
            <Label htmlFor={`${candle.id}-mode-pack`} className={cn("cursor-pointer", compact ? "text-[11px]" : "text-xs")}>{t("Pack (assorted)", "Pack (assorti)")}</Label>
          </div>
          <div className="flex items-center space-x-1.5">
            <RadioGroupItem value="piece" id={`${candle.id}-mode-piece`} />
            <Label htmlFor={`${candle.id}-mode-piece`} className={cn("cursor-pointer", compact ? "text-[11px]" : "text-xs")}>{t("By the piece", "À la pièce")}</Label>
          </div>
        </RadioGroup>

        {mode === "pack" ? (
          <>
            {!compact && (
              <p className="text-[10px] text-muted-foreground">
                {t("Fixed colour assortment — no colour choice.", "Assortiment de couleurs fixe — pas de choix de couleur.")}
              </p>
            )}
            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setPackCount((p) => Math.max(1, p - 1))}
                disabled={packCount <= 1}
                className={cn(
                  "rounded-none flex items-center justify-center font-bold transition-all",
                  compact ? "w-6 h-6 text-xs" : "w-7 h-7 text-sm",
                  packCount <= 1 ? "bg-muted text-muted-foreground cursor-not-allowed" : "bg-primary text-primary-foreground hover:bg-primary/90"
                )}
              >−</button>
              <span className={cn("flex-1 min-w-0 text-center font-medium text-foreground", compact ? "text-xs" : "text-sm")}>
                {packCount} {t("pack(s)", "pack(s)")} ({packCount * packSize} {t("pcs", "pièces")})
              </span>
              <button
                type="button"
                onClick={() => setPackCount((p) => p + 1)}
                className={cn(
                  "rounded-none bg-primary text-primary-foreground flex items-center justify-center font-bold hover:bg-primary/90",
                  compact ? "w-6 h-6 text-xs" : "w-7 h-7 text-sm"
                )}
              >+</button>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-wrap justify-center gap-2">
              {colors.map((color) => {
                const isSelected = selectedColors.includes(color.id);
                const isDisabled = !isSelected && selectedColors.length >= pieceQty;
                return (
                  <button
                    key={color.id}
                    type="button"
                    onClick={() => toggleColor(color.id)}
                    disabled={isDisabled}
                    aria-pressed={isSelected}
                    aria-label={t(color.en, color.fr)}
                    title={t(color.en, color.fr)}
                    className={cn(
                      "rounded-full border-2 transition-all",
                      compact ? "h-6 w-6" : "h-8 w-8",
                      isSelected ? "border-primary ring-2 ring-primary ring-offset-1" : "border-border",
                      isDisabled && "opacity-30 cursor-not-allowed"
                    )}
                    style={{ backgroundColor: CANDLE_COLOR_SWATCH[color.id] }}
                  />
                );
              })}
            </div>
            <p className="text-[10px] text-muted-foreground">
              {t(`${selectedColors.length}/${pieceQty} colours selected`, `${selectedColors.length}/${pieceQty} couleurs sélectionnées`)}
            </p>
            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => changePieceQty(-1)}
                disabled={pieceQty <= 1}
                className={cn(
                  "rounded-none flex items-center justify-center font-bold transition-all",
                  compact ? "w-6 h-6 text-xs" : "w-7 h-7 text-sm",
                  pieceQty <= 1 ? "bg-muted text-muted-foreground cursor-not-allowed" : "bg-primary text-primary-foreground hover:bg-primary/90"
                )}
              >−</button>
              <span className="w-6 text-center font-medium text-foreground text-sm">{pieceQty}</span>
              <button
                type="button"
                onClick={() => changePieceQty(1)}
                disabled={pieceQty >= maxPieceQty}
                className={cn(
                  "rounded-none flex items-center justify-center font-bold transition-all",
                  compact ? "w-6 h-6 text-xs" : "w-7 h-7 text-sm",
                  pieceQty >= maxPieceQty ? "bg-muted text-muted-foreground cursor-not-allowed" : "bg-primary text-primary-foreground hover:bg-primary/90"
                )}
              >+</button>
            </div>
            {!compact && (
              <p className="text-[10px] text-muted-foreground">
                {t(`Max ${maxPieceQty} loose pieces — add a full pack beyond that.`, `Maximum ${maxPieceQty} pièces à l'unité — au-delà, ajoutez un pack complet.`)}
              </p>
            )}
          </>
        )}

        <div className="flex gap-2">
          <Button
            onClick={handleCommit}
            disabled={mode === "piece" && !isPieceValid}
            className={cn(
              "flex-1 rounded-none bg-primary hover:bg-primary/90 text-primary-foreground tracking-[0.105em] uppercase",
              compact ? "text-[11px] h-8" : "text-[12px]"
            )}
          >
            {existing ? t("Update", "Mettre à jour") : t("Add to Cart", "Ajouter au panier")}
          </Button>
          {existing && (
            <Button
              variant="outline"
              onClick={onRemove}
              className={cn("rounded-none tracking-[0.105em] uppercase", compact ? "text-[11px] h-8" : "text-[12px]")}
            >
              {t("Remove", "Retirer")}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
