import { useMemo } from "react";
import { useLang } from "@/context/LanguageContext";
import { computeColourPrep, formatSpoons, type ColourItem, type ColourLine, type ColourPrep, type RibbonLine } from "@/lib/colourPrep";
import { cn } from "@/lib/utils";

// Admin > Production, partie 2 « Préparation des couleurs » (06.11.2026,
// crèmes 14.11.2026) : crème enchantée (bases + décorations) et crème au
// beurre (écritures) en cuillères par couleur (Bento 1, Retro 1,5, Medium 2,
// Large 3, Rectangle 3), rubans par couleur en sets, poches des kits DIY s'il
// y en a. Lecture seule, calculé à partir de colourItems (get-production)
// pour les dates choisies.

const Swatch = ({ hex, dashed }: { hex: string | null; dashed?: boolean }) => (
  <span
    aria-hidden
    className={cn("inline-block w-5 h-5 shrink-0 rounded-full border", hex ? "border-black/20" : "border-dashed border-muted-foreground/60", dashed && "border-dashed")}
    style={hex ? { backgroundColor: hex } : undefined}
  />
);

const Box = ({ title, total, children, testId }: { title: string; total?: string; children: React.ReactNode; testId?: string }) => (
  <section className="border border-border/60 bg-background" data-testid={testId}>
    <h3 className="px-4 py-2.5 border-b border-border/60 text-sm font-semibold uppercase tracking-[0.12em] text-foreground flex items-baseline justify-between gap-3">
      <span>{title}</span>
      {total && <span className="text-xs normal-case tracking-normal font-semibold tabular-nums">{total}</span>}
    </h3>
    <div className="px-4 py-3">{children}</div>
  </section>
);

export const ColourPrepPanel = ({ items }: { items: ColourItem[] }) => {
  const { lang } = useLang();
  const prep = useMemo(() => computeColourPrep(items, lang), [items, lang]);
  return <ColourPrepView prep={prep} />;
};

// Affichage seul — aussi utilisé par la fiche de mise en place (Étiquettes),
// avec les gâteaux cochés. `compact` : sans la phrase d'explication.
export const ColourPrepView = ({ prep, compact = false }: { prep: ColourPrep; compact?: boolean }) => {
  const { t, lang } = useLang();
  const cakes = (n: number) => `${n} ${t(n > 1 ? "cakes" : "cake", n > 1 ? "gâteaux" : "gâteau")}`;
  const empty = <p className="text-xs text-muted-foreground">{t("Nothing in this period.", "Rien sur cette période.")}</p>;

  // Détail sous la couleur : bases / décorations (crème enchantée), roses, bordures.
  const detail = (l: ColourLine, enchanted: boolean) => [
    enchanted && l.baseCakes > 0 ? t(`base ${l.baseCakes}`, `base ${l.baseCakes}`) : "",
    enchanted && l.decoCakes > 0 ? t(`decoration ${l.decoCakes}`, `déco ${l.decoCakes}`) : "",
    l.roses > 0 ? t(`incl. ${l.roses} roses`, `dont ${l.roses} roses`) : "",
    l.border > 0 ? t(`incl. ${l.border} border${l.border > 1 ? "s" : ""}`, `dont ${l.border} bordure${l.border > 1 ? "s" : ""}`) : "",
  ].filter(Boolean).join(" · ");

  const creamList = (lines: ColourLine[], testId: string, enchanted: boolean) => lines.length === 0 ? empty : (
    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6" data-testid={testId}>
      {lines.map((l) => (
        <li key={l.key} className={cn("flex items-center justify-between gap-3 border-b border-border/40 py-1.5 text-sm", l.toCheck && "text-amber-900")}>
          <span className="flex items-center gap-2 min-w-0">
            <Swatch hex={l.hex} />
            <span className="min-w-0">
              {l.label}
              <span className="block text-[11px] text-muted-foreground">
                {cakes(l.cakes)}{detail(l, enchanted) ? ` · ${detail(l, enchanted)}` : ""}
              </span>
            </span>
          </span>
          <span className="font-semibold tabular-nums shrink-0">{formatSpoons(l.spoons, lang)}</span>
        </li>
      ))}
    </ul>
  );

  const kitList = (lines: ColourLine[]) => (
    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6" data-testid="kit-list">
      {lines.map((l) => (
        <li key={l.key} className={cn("flex items-center justify-between gap-3 border-b border-border/40 py-1.5 text-sm", l.toCheck && "text-amber-900")}>
          <span className="flex items-center gap-2 min-w-0"><Swatch hex={l.hex} />{l.label}</span>
          <span className="font-semibold tabular-nums shrink-0">{cakes(l.cakes)}</span>
        </li>
      ))}
    </ul>
  );

  const ribbonList = (lines: RibbonLine[]) => lines.length === 0 ? empty : (
    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6" data-testid="ribbon-list">
      {lines.map((r) => (
        <li key={r.key} className={cn("flex items-center justify-between gap-3 border-b border-border/40 py-1.5 text-sm", r.toCheck && "text-amber-900")}>
          <span className="flex items-center gap-2 min-w-0"><Swatch hex={r.hex} />{r.label}</span>
          <b className="tabular-nums shrink-0">{r.sets} {r.sets > 1 ? "sets" : "set"}</b>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="space-y-4" data-testid="colour-prep">
      {!compact && <p className="text-xs text-muted-foreground">
        {t(
          `Cakes still to decorate in this period: ${prep.counted}. Tablespoons per cake: Bento 1, Retro 1.5, Medium 2, Large 3, Rectangle 3. A cake with several colours counts in each.`,
          `Gâteaux encore à décorer sur cette période : ${prep.counted}. Cuillères à soupe par gâteau : Bento 1, Retro 1,5, Medium 2, Large 3, Rectangle 3. Un gâteau à plusieurs couleurs compte dans chacune.`,
        )}
        {prep.skippedDecorated > 0 && ` ${t(`${prep.skippedDecorated} already decorated, not counted.`, `${prep.skippedDecorated} déjà décoré(s), non compté(s).`)}`}
      </p>}
      {compact && <p className="text-xs text-muted-foreground">{t("Tablespoons per cake: Bento 1, Retro 1.5, Medium 2, Large 3, Rectangle 3.", "Cuillères à soupe par gâteau : Bento 1, Retro 1,5, Medium 2, Large 3, Rectangle 3.")}</p>}
      <Box title={t("Enchanted cream — bases & decorations", "Crème enchantée — bases et décorations")} total={formatSpoons(prep.enchantedSpoons, lang)} testId="enchanted">
        {creamList(prep.enchanted, "enchanted-list", true)}
      </Box>
      <Box title={t("Buttercream — writing", "Crème au beurre — écritures")} total={formatSpoons(prep.butterSpoons, lang)} testId="butter">
        {creamList(prep.butter, "butter-list", false)}
      </Box>
      <Box title={t("🎀 Ribbons", "🎀 Rubans")} total={`${prep.ribbons.reduce((n, r) => n + r.sets, 0)} sets`} testId="ribbons">{ribbonList(prep.ribbons)}</Box>
      {prep.kits.length > 0 && <Box title={t("DIY kit piping bags", "Poches kits DIY")} testId="kits">{kitList(prep.kits)}</Box>}
      <p className="text-[11px] text-muted-foreground">{t("« ref. » = colour from the inspiration photo reference, the order has none.", "« réf. » = couleur de la fiche de la photo d'inspiration, la commande n'en a pas.")}</p>
    </div>
  );
};
