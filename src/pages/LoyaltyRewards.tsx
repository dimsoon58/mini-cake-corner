import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "@/components/Layout";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";

const LoyaltyRewards = () => {
  const { t } = useLang();
  const navigate = useNavigate();
  const { user, profile, loading } = useAuth();

  useEffect(() => {
    document.title = "Loyalty Rewards – Bento Cake Studio";
    return () => { document.title = "Bento Cake Studio Geneva"; };
  }, []);

  useEffect(() => {
    if (!loading && !user) navigate("/login");
  }, [loading, user, navigate]);

  const rules = [
    t("Earn 3.5% back on every order, credited to your reward balance.", "Gagnez 3,5% de cagnotte sur chaque commande."),
    t("Calculated on the amount actually paid for products, excluding delivery fees.", "Calculée sur le montant réellement payé pour les produits, hors frais de livraison."),
    t("Reward earned on an order can only be used on a later order, never the same one.", "La cagnotte gagnée sur une commande ne peut être utilisée que sur une commande suivante."),
    t("Each amount earned is valid for 12 months.", "Chaque montant gagné est valable 12 mois."),
  ];

  if (loading || !user || !profile) {
    return (
      <Layout>
        <main className="max-w-2xl mx-auto px-6 py-24 text-center text-sm text-muted-foreground">
          {t("Loading...", "Chargement...")}
        </main>
      </Layout>
    );
  }

  const voucherAvailable =
    profile.welcome_discount_available &&
    !profile.welcome_discount_used_at &&
    (!profile.welcome_discount_expires_at || new Date(profile.welcome_discount_expires_at) > new Date());

  const balance = profile.reward_balance ?? 0;

  return (
    <Layout>
      <main className="max-w-2xl mx-auto px-6 py-16">
        <h1 className="font-sans uppercase tracking-[0.105em] text-3xl md:text-4xl text-foreground mb-12 text-center">
          {t("Loyalty Rewards", "Programme de fidélité")}
        </h1>

        <div className="border border-border/60 p-8 mb-10 text-center">
          <p className="text-sm uppercase tracking-[0.105em] text-muted-foreground mb-2">
            {t("Reward Balance", "Solde cagnotte")}
          </p>
          <p className="font-sans text-4xl md:text-5xl font-semibold text-primary">
            CHF {balance.toFixed(2)}
          </p>
        </div>

        {voucherAvailable && (
          <div className="border border-primary bg-secondary/40 p-6 mb-10 text-center">
            <p className="font-sans uppercase tracking-[0.105em] text-sm font-semibold text-primary mb-2">
              {t("Welcome Voucher Available", "Voucher de bienvenue disponible")}
            </p>
            <p className="text-sm text-foreground/80 leading-relaxed">
              {t("-10% off your next order — automatically applied once at checkout.", "-10% sur votre prochaine commande — appliqué automatiquement, une seule fois, au paiement.")}
            </p>
          </div>
        )}

        <div>
          <h2 className="font-sans uppercase tracking-[0.105em] text-sm font-semibold text-foreground mb-4">
            {t("How it works", "Comment ça marche")}
          </h2>
          <ul className="space-y-3">
            {rules.map((rule) => (
              <li key={rule} className="flex items-start gap-3 text-sm text-foreground/80">
                <span className="mt-1 w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
                <span>{rule}</span>
              </li>
            ))}
          </ul>
        </div>
      </main>
    </Layout>
  );
};

export default LoyaltyRewards;
