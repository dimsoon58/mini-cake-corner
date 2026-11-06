import { useMemo } from "react";
import { useLang } from "@/context/LanguageContext";
import { computeColourPrep, type ColourItem, type ColourLine, type RibbonLine } from "@/lib/colourPrep";
import { cn } from "@/lib/utils";

// Admin > Production, partie 2 « Préparation des couleurs » (06.11.2026) :
// rubans par couleur et taille, couleurs des bases, des décorations, des
// écritures (et poches des kits DIY s'il y en a). Lecture seule, calculé à
// partir de colourItems (get-production) pour les dates choisies.

const Swatch = ({ hex, dashed }: { hex: string | null; dashed?: boolean }) => (
  <span
    aria-hidden
    className={cn("inline-block w-4 h-4 shrink-0 rounded-full border", hex ? "border-black/20" : "border-dashed border-muted-foreground/60", dashed && "border-dashed")}
    style={hex ? { backgroundColor: hex } : undefined}
  />
);

const Box = ({ title, children, testId }: { title: string; children: React.ReactNode; testId?: string }) => (
  <section className="border border-border/60 bg-background" data-testid={testId}>
    <h3 className="px-4 py-2.5 border-b border-border/60 text-sm font-semibold uppercase tracking-[0.12em] text-foreground">{title}</h3>
    <div className="px-4 py-3">{children}</div>
  </section>
);

export const ColourPrepPanel = ({ items }: { items: ColourItem[] }) => {
  const { t, lang } = useLang();
  const prep = useMemo(() => computeColourPrep(items, lang), [items, lang]);
  const cakes = (n: number) => `${n} ${t(n > 1 ? "cakes" : "cake", n > 1 ? "gâteaux" : "gâteau")}`;
  const empty = <p className="text-xs text-muted-foreground">{t("Nothing in this period.", "Rien sur cette période.")}</p>;

  const colourList = (lines: ColourLine[], testId: string) => lines.length === 0 ? empty : (
    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6" data-testid={testId}>
      {lines.map((l) => (
        <li key={l.key} className={cn("flex items-center justify-between gap-3 border-b border-border/40 py-1.5 text-sm", l.toCheck && "text-amber-900")}>
          <span className="flex items-center gap-2 min-w-0">
            <Swatch hex={l.hex} />
            <span className="min-w-0">
              {l.label}
              {(l.roses > 0 || l.border > 0) && (
                <span className="block text-[11px] text-muted-foreground">
                  {[l.roses > 0 ? t(`incl. ${l.roses} roses`, `dont ${l.roses} roses`) : "", l.border > 0 ? t(`incl. ${l.border} border${l.border > 1 ? "s" : ""}`, `dont ${l.border} bordure${l.border > 1 ? "s" : ""}`) : ""].filter(Boolean).join(" · ")}
                </span>
              )}
            </span>
          </span>
          <span className="font-semibold tabular-nums shrink-0">{cakes(l.cakes)}</span>
        </li>
      ))}
    </ul>
  );

  const ribbonList = (lines: RibbonLine[]) => lines.length === 0 ? empty : (
    <ul data-testid="ribbon-list">
      {lines.map((r) => (
        <li key={`${r.key}|${r.size}`} className={cn("flex items-center justify-between gap-3 border-b border-border/40 py-1.5 text-sm last:border-b-0", r.toCheck && "text-amber-900")}>
          <span className="flex items-center gap-2 min-w-0">
            <Swatch hex={r.hex} />
            <span><b className="tabular-nums">{r.sets} {t(r.sets > 1 ? "sets" : "set", r.sets > 1 ? "sets" : "set")}</b> · {r.label}</span>
          </span>
          <span className="shrink-0 px-2 py-0.5 text-xs font-semibold bg-secondary/60 text-foreground">{r.sizeLabel}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="space-y-4" data-testid="colour-prep">
      <p className="text-xs text-muted-foreground">
        {t(
          `Cakes still to decorate in this period: ${prep.counted}. A cake with several colours counts once in each.`,
          `Gâteaux encore à décorer sur cette période : ${prep.counted}. Un gâteau à plusieurs couleurs compte une fois dans chacune.`,
        )}
        {prep.skippedDecorated > 0 && ` ${t(`${prep.skippedDecorated} already decorated, not counted.`, `${prep.skippedDecorated} déjà décoré(s), non compté(s).`)}`}
      </p>
      <Box title={t("🎀 Ribbons", "🎀 Rubans")} testId="ribbons">{ribbonList(prep.ribbons)}</Box>
      <Box title={t("Base colours", "Couleurs des bases")} testId="bases">{colourList(prep.bases, "base-list")}</Box>
      <Box title={t("Decoration colours", "Couleurs des décorations")} testId="decorations">{colourList(prep.decorations, "decoration-list")}</Box>
      <Box title={t("Writing colours", "Couleurs des écritures")} testId="writing">{colourList(prep.writing, "writing-list")}</Box>
      {prep.kits.length > 0 && <Box title={t("DIY kit piping bags", "Poches kits DIY")} testId="kits">{colourList(prep.kits, "kit-list")}</Box>}
      <p className="text-[11px] text-muted-foreground">{t("« ref. » = colour from the inspiration photo reference, the order has none.", "« réf. » = couleur de la fiche de la photo d'inspiration, la commande n'en a pas.")}</p>
    </div>
  );
};
