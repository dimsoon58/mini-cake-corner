import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { User, X, Package, Gift, MapPin, UserCircle, Mail, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";

const AccountMenu = ({ light = false }: { light?: boolean }) => {
  const { t } = useLang();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { user, profile, signOut } = useAuth();
  const signedIn = !!user;
  const firstName = profile?.first_name || t("there", "vous");

  const close = () => setOpen(false);

  const goTo = (path: string) => {
    close();
    navigate(path);
  };

  const handleLogOut = async () => {
    await signOut();
    close();
    navigate("/");
  };

  const menuItems = [
    { icon: Package, label: t("My Orders", "Mes commandes"), to: "/account/orders" },
    { icon: Gift, label: t("Loyalty Rewards", "Programme de fidélité"), to: "/account/rewards" },
    { icon: MapPin, label: t("Saved Addresses", "Adresses enregistrées"), to: "/account" },
    { icon: UserCircle, label: t("Account Details", "Détails du compte"), to: "/account" },
    { icon: Mail, label: t("Newsletter Preferences", "Préférences newsletter"), to: "/account" },
  ];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={t("Account", "Compte")}
        className={cn("p-1 transition-opacity hover:opacity-70", light ? "text-cream" : "text-foreground")}
      >
        <User className="w-5 h-5" strokeWidth={1.5} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[70]" onClick={close} />
          <div className="absolute right-0 top-full mt-3 z-[80] w-72 bg-background border border-border shadow-[0_8px_30px_rgba(0,0,0,0.12)] p-6 text-foreground animate-in fade-in slide-in-from-top-2 duration-200">
            <button onClick={close} aria-label="Close" className="absolute top-2.5 right-2.5 p-1 text-foreground/50 hover:text-foreground transition-colors">
              <X className="w-4 h-4" />
            </button>

            {!signedIn ? (
              <div>
                <h3 className="font-sans uppercase tracking-[0.105em] text-sm font-semibold mb-2">
                  {t("Welcome back", "Bon retour")}
                </h3>
                <p className="text-sm text-foreground/70 leading-relaxed mb-5">
                  {t("Sign in to manage your orders, save your details and enjoy a faster checkout.", "Connectez-vous pour gérer vos commandes, enregistrer vos informations et passer commande plus vite.")}
                </p>
                <Button
                  onClick={() => goTo("/login")}
                  className="w-full rounded-none bg-primary hover:bg-primary/90 text-primary-foreground uppercase tracking-[0.105em] text-[13px] font-medium mb-3"
                >
                  {t("Sign In", "Se connecter")}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => goTo("/signup")}
                  className="w-full rounded-none border-primary text-primary hover:bg-primary/5 uppercase tracking-[0.105em] text-[13px] font-medium"
                >
                  {t("Create an Account", "Créer un compte")}
                </Button>
                <button
                  onClick={close}
                  className="block w-full text-center text-xs text-foreground/50 hover:text-foreground/80 underline mt-4 transition-colors"
                >
                  {t("Continue as Guest", "Continuer sans compte")}
                </button>
              </div>
            ) : (
              <div>
                <h3 className="font-sans uppercase tracking-[0.105em] text-sm font-semibold mb-4">
                  {t("Hi", "Bonjour")}, {firstName}!
                </h3>
                <nav className="space-y-1 mb-3">
                  {menuItems.map((item) => (
                    <Link
                      key={item.label}
                      to={item.to}
                      onClick={close}
                      className="flex items-center gap-3 py-2.5 px-2 text-sm text-foreground hover:bg-secondary/50 transition-colors"
                    >
                      <item.icon className="w-4 h-4 text-primary" strokeWidth={1.5} />
                      {item.label}
                    </Link>
                  ))}
                </nav>
                <button
                  onClick={handleLogOut}
                  className="flex items-center gap-3 py-2.5 px-2 w-full text-sm text-foreground/70 hover:text-foreground border-t border-border/50 transition-colors"
                >
                  <LogOut className="w-4 h-4" strokeWidth={1.5} />
                  {t("Log Out", "Se déconnecter")}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default AccountMenu;
