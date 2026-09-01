import { useState, FormEvent } from "react";
import { Link } from "react-router-dom";
import { useLang } from "@/context/LanguageContext";
import { supabase } from "@/integrations/supabase/client";
import logoCream from "@/assets/logo-cream.png";

const CONTACT_EMAIL = "contact@bentocakestudio.ch";

const FooterNewsletter = () => {
  const { t } = useLang();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return;
    setSubmitting(true);
    try {
      await supabase.functions.invoke("subscribe-newsletter", {
        body: { email: trimmed, firstName: "", lastName: "", source: "footer" },
      });
    } catch {
      /* non bloquant */
    }
    setSubmitting(false);
    setSubmitted(true);
    setEmail("");
  };

  if (submitted) {
    return (
      <p className="text-sm opacity-90">
        {t("Thank you! Check your inbox.", "Merci ! Consultez votre boîte mail.")}
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-3 border-b border-primary-foreground/40 pb-2 max-w-[320px]">
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={t("Your email", "Votre email")}
        aria-label={t("Your email", "Votre email")}
        className="flex-1 min-w-0 bg-transparent text-sm text-primary-foreground placeholder:text-primary-foreground/50 outline-none"
      />
      <button
        type="submit"
        disabled={submitting}
        className="flex-shrink-0 uppercase tracking-[0.105em] text-[11px] font-medium hover:opacity-70 transition-opacity disabled:opacity-40"
      >
        {submitting ? "..." : t("SUBSCRIBE", "S'INSCRIRE")}
      </button>
    </form>
  );
};

/* Pied de page bordeaux, affiche sur toutes les pages via Layout */
const Footer = () => {
  const { t } = useLang();

  const headingClass = "font-sans uppercase tracking-[0.105em] text-xs font-medium opacity-80 mb-5";
  const linkClass = "block text-sm opacity-90 hover:opacity-100 transition-opacity mb-3";

  return (
    <footer className="bg-primary text-primary-foreground pt-14 pb-10">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-10 lg:gap-12">
          {/* Contact */}
          <div>
            <p className={headingClass}>{t("CONTACT US", "NOUS CONTACTER")}</p>
            <a href={`mailto:${CONTACT_EMAIL}`} className="block text-sm opacity-90 hover:opacity-100 transition-opacity mb-3 break-all">
              {CONTACT_EMAIL}
            </a>
            <p className="text-sm opacity-90 leading-relaxed">
              Rue Prévost-Martin 8
              <br />
              1205 Genève
            </p>
          </div>

          {/* Liens */}
          <div>
            <p className={headingClass}>{t("COMPANY", "L'ENTREPRISE")}</p>
            <Link to="/about" className={linkClass}>
              {t("About Us", "À propos")}
            </Link>
            <Link to="/contact" className={linkClass}>
              {t("Contact", "Contact")}
            </Link>
            <Link to="/faq" className={linkClass}>
              {t("FAQ", "FAQ")}
            </Link>
            <Link to="/legal" className={linkClass}>
              {t("Terms and Conditions & Privacy Policy", "Conditions générales et confidentialité")}
            </Link>
          </div>

          {/* Newsletter */}
          <div>
            <p className={headingClass}>{t("NEWSLETTER", "NEWSLETTER")}</p>
            <FooterNewsletter />
          </div>
        </div>

        {/* Bas de page */}
        <div className="border-t border-primary-foreground/20 mt-12 pt-8 text-center">
          <img
            src={logoCream}
            alt="Bento Cake Studio"
            className="h-10 md:h-12 w-auto mx-auto mb-5"
          />
          <p className="text-xs opacity-70">
            {t("© 2026 Bento Cake Studio SNC. All rights reserved.", "© 2026 Bento Cake Studio SNC. Tous droits réservés.")}
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
