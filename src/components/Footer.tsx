import { Link } from "react-router-dom";
import { useLang } from "@/context/LanguageContext";
import logoCream from "@/assets/logo-cream.png";

/* Pied de page bordeaux, affiche sur toutes les pages via Layout */
const Footer = () => {
  const { t } = useLang();

  return (
    <footer className="bg-primary text-primary-foreground py-12">
      <div className="container mx-auto px-4 text-center">
        <img
          src={logoCream}
          alt="Bento Cake Studio"
          className="h-12 md:h-14 w-auto mx-auto mb-6"
        />
        <p className="text-sm opacity-90 mb-4">
          {t("© 2026 Bento Cake Studio SNC. All rights reserved.", "© 2026 Bento Cake Studio SNC. Tous droits réservés.")}
        </p>
        <p className="text-sm opacity-70 mb-4">
          <Link to="/legal" className="underline hover:opacity-100">
            {t("Terms and Conditions & Privacy Policy", "Conditions générales et politique de confidentialité")}
          </Link>
        </p>
        <p className="text-sm opacity-70">
          <Link to="/newsletter" className="underline hover:opacity-100">
            {t("Subscribe to newsletter", "S'abonner à la newsletter")}
          </Link>
        </p>
      </div>
    </footer>
  );
};

export default Footer;
