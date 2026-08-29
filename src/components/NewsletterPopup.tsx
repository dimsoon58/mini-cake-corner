import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLang } from "@/context/LanguageContext";

const NewsletterPopup = () => {
  const { t } = useLang();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem("cakeClubDismissed")) return;
    const timer = setTimeout(() => setOpen(true), 4000);
    return () => clearTimeout(timer);
  }, []);

  const dismiss = () => {
    setOpen(false);
    if (typeof window !== "undefined") window.localStorage.setItem("cakeClubDismissed", "1");
  };

  if (!open) return null;

  return (
    <div className="fixed z-[80] bottom-4 right-4 left-4 sm:left-auto sm:bottom-6 sm:right-6 sm:w-[360px] animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="relative bg-secondary border border-primary shadow-[0_8px_30px_rgba(0,0,0,0.12)] p-6 sm:p-7">
        <button
          onClick={dismiss}
          aria-label="Close"
          className="absolute top-2.5 right-2.5 p-1 text-foreground/50 hover:text-foreground transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <h3 className="font-sans uppercase tracking-[0.105em] text-base font-semibold text-foreground mb-2 pr-5">
          {t("10% OFF YOUR FIRST ORDER", "-10 % SUR VOTRE PREMIÈRE COMMANDE")}
        </h3>
        <p className="text-sm text-foreground/75 mb-4 leading-relaxed">
          {t(
            "Create an account and subscribe to our newsletter to unlock your welcome offer.",
            "Créez votre compte et inscrivez-vous à notre newsletter pour débloquer votre offre de bienvenue."
          )}
        </p>
        <Button
          asChild
          className="w-full rounded-none bg-primary hover:bg-primary/90 text-primary-foreground uppercase tracking-[0.105em] text-[13px] font-medium"
        >
          <Link to="/signup" onClick={dismiss}>
            {t("CREATE MY ACCOUNT", "CRÉER MON COMPTE")}
          </Link>
        </Button>
      </div>
    </div>
  );
};

export default NewsletterPopup;
