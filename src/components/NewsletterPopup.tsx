import { useState, useEffect, FormEvent } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/context/LanguageContext";

const NewsletterPopup = () => {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

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

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return;
    setSubmitting(true);
    try {
      await supabase.functions.invoke("subscribe-newsletter", {
        body: { email: trimmed, firstName: "", lastName: "", source: "cake-club-popup" },
      });
    } catch {
      /* non-blocking */
    }
    setSubmitting(false);
    setSubmitted(true);
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

        {submitted ? (
          <div className="text-center py-4">
            <p className="font-sans uppercase tracking-[0.105em] text-sm font-semibold text-foreground mb-2">
              {t("Welcome to the Cake Club!", "Bienvenue au Cake Club !")}
            </p>
            <p className="text-sm text-foreground/75">
              {t("Check your inbox for your 10% off code.", "Consultez votre boîte mail pour votre code de 10%.")}
            </p>
          </div>
        ) : (
          <>
            <h3 className="font-sans uppercase tracking-[0.105em] text-base font-semibold text-foreground mb-2 pr-5">
              {t("JOIN THE CAKE CLUB", "REJOIGNEZ LE CAKE CLUB")}
            </h3>
            <p className="text-sm text-foreground/75 mb-2 leading-relaxed">
              {t("Be the first to discover new collections, workshops and exclusive offers.", "Soyez la première informée de nos nouvelles collections, ateliers et offres exclusives.")}
            </p>
            <p className="text-sm text-primary font-medium mb-4">
              {t("Enjoy 10% off your first online order.", "Profitez de 10% de réduction sur votre première commande en ligne.")}
            </p>
            <form onSubmit={handleSubmit} className="space-y-3">
              <Input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("Enter your email", "Entrez votre email")}
                className="rounded-none bg-background"
              />
              <Button
                type="submit"
                disabled={submitting}
                className="w-full rounded-none bg-primary hover:bg-primary/90 text-primary-foreground uppercase tracking-[0.105em] text-[13px] font-medium"
              >
                {submitting ? "..." : t("GET 10% OFF", "OBTENIR 10%")}
              </Button>
            </form>
            <p className="text-[10px] text-foreground/50 mt-3 leading-relaxed">
              {t("By subscribing, you agree to receive occasional emails from Bento Cake Studio. You can unsubscribe at any time.", "En vous inscrivant, vous acceptez de recevoir occasionnellement des emails de Bento Cake Studio. Vous pouvez vous désinscrire à tout moment.")}
            </p>
          </>
        )}
      </div>
    </div>
  );
};

export default NewsletterPopup;
