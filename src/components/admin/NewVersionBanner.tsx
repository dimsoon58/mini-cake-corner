import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLang } from "@/context/LanguageContext";

// Une page admin ouverte AVANT une publication garde l'ancien code tant
// qu'elle n'est pas rechargée (ex. 04.10.2026 : « Annuler cet article »
// publié à 12:52, une page ouverte avant ne montrait que « Annuler toute la
// commande »). On compare la version de la page à dist/version.json au
// chargement, au retour sur l'onglet et toutes les 5 minutes.

const CHECK_EVERY_MS = 5 * 60 * 1000;

export function NewVersionBanner() {
  const { t } = useLang();
  const [stale, setStale] = useState(false);

  useEffect(() => {
    if (import.meta.env.DEV) return;
    let stopped = false;
    const check = async () => {
      try {
        const r = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: "no-store" });
        if (!r.ok) return;
        const { build } = await r.json();
        if (!stopped && build && build !== __APP_BUILD__) setStale(true);
      } catch { /* hors ligne : on réessaiera */ }
    };
    check();
    const id = window.setInterval(check, CHECK_EVERY_MS);
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { stopped = true; window.clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  if (!stale) return null;
  return (
    <div role="alert" data-testid="new-version" className="sticky top-0 z-50 border-b border-amber-400 bg-amber-50 text-amber-900 px-4 py-2 text-sm flex flex-wrap items-center gap-2 justify-center">
      <span>{t("A new version of the admin is available. Reload to see the latest buttons and figures.", "Une nouvelle version de l'admin est disponible. Rechargez pour voir les derniers boutons et chiffres.")}</span>
      <Button size="sm" className="rounded-none h-8" onClick={() => window.location.reload()}>
        <RefreshCw className="w-3.5 h-3.5 mr-1" /> {t("Reload", "Recharger")}
      </Button>
    </div>
  );
}
