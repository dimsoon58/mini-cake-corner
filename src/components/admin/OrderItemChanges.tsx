import { History } from "lucide-react";
import { useLang } from "@/context/LanguageContext";
import { colourSwatches } from "@/lib/orderLabels";

// F44 — historique des modifications d'un gâteau (edit-order-item, action list).
export type ItemChange = {
  id: string; item_id: string; field: string; old_value: string | null; new_value: string | null;
  note: string | null; author_name: string | null; author_email: string; created_at: string;
};

const FIELD_LABELS: Record<string, { en: string; fr: string }> = {
  flavors: { en: "Flavour", fr: "Goût" },
  base_color: { en: "Base", fr: "Base" },
  decoration_color: { en: "Decoration", fr: "Décoration" },
  text_color: { en: "Text colour", fr: "Couleur du texte" },
  cake_text: { en: "Text", fr: "Texte" },
  text_style: { en: "Text style", fr: "Style du texte" },
  ribbon_color: { en: "Ribbons", fr: "Rubans" },
  butterfly_color: { en: "Butterfly", fr: "Papillon" },
  item_comment: { en: "Instructions", fr: "Instructions" },
};
const COLOUR_FIELDS = new Set(["base_color", "decoration_color", "text_color"]);

export function OrderItemChanges({ changes }: { changes: ItemChange[] }) {
  const { t, lang } = useLang();
  const l = lang === "fr" ? "fr" : "en";
  if (changes.length === 0) return null;
  const show = (field: string, v: string | null) => {
    if (!v) return "—";
    return COLOUR_FIELDS.has(field) ? colourSwatches(v, l).map((s) => s.label).join(", ") : v;
  };
  const date = (iso: string) => new Date(iso).toLocaleDateString("fr-CH", { day: "2-digit", month: "2-digit", timeZone: "Europe/Zurich" });
  return (
    <div className="mt-2 border-t border-border/40 pt-2 space-y-1" data-testid="item-changes">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground flex items-center gap-1">
        <History className="w-3 h-3" /> {t("Changes", "Modifications")}
      </p>
      {changes.map((c) => (
        <p key={c.id} className="text-xs text-foreground/80">
          <span className="font-medium">{FIELD_LABELS[c.field]?.[l] ?? c.field}</span> : {show(c.field, c.old_value)} → {show(c.field, c.new_value)}
          <span className="text-muted-foreground">, {t("by", "par")} {c.author_name ?? c.author_email} {t("on", "le")} {date(c.created_at)}</span>
          {c.note && <span className="block text-muted-foreground italic">{c.note}</span>}
        </p>
      ))}
    </div>
  );
}
