import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";

const COOKIE_CONSENT_KEY = "cookie-consent";

const CookieConsent = () => {
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    const consent = localStorage.getItem(COOKIE_CONSENT_KEY);
    if (!consent) {
      setShowBanner(true);
    }
  }, []);

  const handleAccept = () => {
    localStorage.setItem(COOKIE_CONSENT_KEY, "accepted");
    setShowBanner(false);
  };

  const handleRefuse = () => {
    localStorage.setItem(COOKIE_CONSENT_KEY, "refused");
    setShowBanner(false);
  };

  if (!showBanner) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border shadow-lg p-4 md:p-6">
      <div className="container mx-auto max-w-4xl flex flex-col md:flex-row items-center justify-between gap-4">
        <p className="text-sm text-foreground text-center md:text-left">
          Ce site utilise des cookies afin d'assurer son bon fonctionnement et d'améliorer l'expérience utilisateur.
        </p>
        <div className="flex gap-3 shrink-0">
          <Button variant="outline" onClick={handleRefuse}>
            Refuser
          </Button>
          <Button onClick={handleAccept}>
            Accepter
          </Button>
        </div>
      </div>
    </div>
  );
};

export default CookieConsent;
