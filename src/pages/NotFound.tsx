import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import { useLang } from "@/context/LanguageContext";

const NotFound = () => {
  const location = useLocation();
  const { t } = useLang();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted">
      <div className="text-center">
        <h1 className="mb-4 text-4xl font-bold">404</h1>
        <p className="mb-4 text-xl text-muted-foreground">{t("Oops! Page not found", "Oups ! Page introuvable")}</p>
        <a href="/" className="text-primary underline hover:text-primary/90">
          {t("Return to Home", "Retour \u00e0 l'accueil")}
        </a>
      </div>
    </div>
  );
};

export default NotFound;
