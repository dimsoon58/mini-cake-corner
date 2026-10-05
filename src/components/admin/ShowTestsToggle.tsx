import { useSearchParams } from "react-router-dom";
import { useLang } from "@/context/LanguageContext";

// « Afficher les tests » — commandes de test (orders.is_test) masquées par
// défaut sur les écrans de travail, comme dans Clients et Remboursements.
// État gardé dans l'URL (?tests=1) : un rechargement garde le même choix.
export function useShowTests(): [boolean, (on: boolean) => void] {
  const [params, setParams] = useSearchParams();
  const on = params.get("tests") === "1";
  const set = (next: boolean) => {
    const p = new URLSearchParams(params);
    if (next) p.set("tests", "1"); else p.delete("tests");
    setParams(p, { replace: true });
  };
  return [on, set];
}

export function ShowTestsToggle({ checked, onChange, className }: { checked: boolean; onChange: (on: boolean) => void; className?: string }) {
  const { t } = useLang();
  return (
    <label className={`flex items-center gap-2 text-sm ${className ?? ""}`} data-testid="show-tests">
      <input type="checkbox" className="w-4 h-4" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {t("Show tests", "Afficher les tests")}
    </label>
  );
}
