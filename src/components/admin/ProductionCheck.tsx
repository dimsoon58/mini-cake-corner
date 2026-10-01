import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/context/LanguageContext";
import { cn } from "@/lib/utils";

// "À préparer" / "Fait" tick box for one cake (order_items.production_status),
// used on Admin > Aujourd'hui and the Admin order page. Writes through
// update-production-status, which re-checks every rule server-side.
// Updates the screen at once and rolls back if the server refuses.

export const DONE_STATUSES = ["completed", "ready_for_pickup", "delivered", "picked_up"];
export const isProductionDone = (status: string | null | undefined) => !!status && DONE_STATUSES.includes(status);

type Props = {
  itemId: string;
  status: string | null | undefined;
  // When set, the box is shown but can't be ticked; the reason is shown on tap.
  disabledReason?: string | null;
  onChange: (next: string) => void;
  className?: string;
};

export const ProductionCheck = ({ itemId, status, disabledReason, onChange, className }: Props) => {
  const { t } = useLang();
  const [saving, setSaving] = useState(false);
  const done = isProductionDone(status);

  const toggle = async () => {
    if (saving) return;
    if (disabledReason) {
      toast.error(disabledReason);
      return;
    }
    const previous = status ?? "to_assign";
    const optimistic = done ? "to_assign" : "completed";
    onChange(optimistic);
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("update-production-status", { body: { itemId, done: !done } });
      let reason: string | undefined = data?.reason;
      if (error) {
        try { reason = (await (error as { context?: Response }).context?.json())?.reason; } catch { /* ignore */ }
      }
      if (error || data?.error) {
        onChange(previous);
        toast.error(
          reason === "to_accept" ? t("Accept the order first.", "Acceptez d'abord la commande.")
            : reason === "cancelled" ? t("This cake is cancelled.", "Ce gâteau est annulé.")
            : reason === "inactive" ? t("This order is no longer active.", "Cette commande n'est plus active.")
            : (error as { context?: Response } | null)?.context?.status === 404 && !reason
              ? t("Not available yet: the update-production-status function must be deployed.", "Pas encore disponible : la fonction update-production-status doit être déployée.")
              : t("Not saved. Please try again.", "Non enregistré. Réessayez."),
        );
        return;
      }
      if (data?.productionStatus) onChange(data.productionStatus);
    } catch (e) {
      console.error("update-production-status threw:", e);
      onChange(previous);
      toast.error(t("Not saved. Please try again.", "Non enregistré. Réessayez."));
    } finally {
      setSaving(false);
    }
  };

  const label = done ? t("Done — tap to undo", "Fait — appuyer pour annuler") : t("To prepare — tap when done", "À préparer — appuyer quand c'est fait");
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={disabledReason ? `${label} (${disabledReason})` : label}
      title={disabledReason ?? label}
      onClick={toggle}
      className={cn(
        "w-7 h-7 shrink-0 border-2 flex items-center justify-center transition-colors",
        done ? "border-emerald-600 bg-emerald-600 text-white" : "border-foreground/40 bg-background hover:border-primary",
        disabledReason && "opacity-40 cursor-not-allowed hover:border-foreground/40",
        className,
      )}
    >
      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : done ? <Check className="w-4 h-4" strokeWidth={3} /> : null}
    </button>
  );
};
