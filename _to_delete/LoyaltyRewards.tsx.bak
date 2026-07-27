import { useEffect } from "react";
import Layout from "@/components/Layout";
import { useLang } from "@/context/LanguageContext";

/* UI-only. Balance/target are placeholders for design preview;
   real points will come from the backend once accounts are connected. */
const BALANCE = 125;
const TARGET = 200;

const LoyaltyRewards = () => {
  const { t } = useLang();
  const remaining = Math.max(TARGET - BALANCE, 0);
  const pct = Math.min(Math.round((BALANCE / TARGET) * 100), 100);

  useEffect(() => {
    document.title = "Loyalty Rewards – Bento Cake Studio";
    return () => { document.title = "Bento Cake Studio Geneva"; };
  }, []);

  const rules = [
    t("Earn 1 point for every CHF 1 spent.", "Gagnez 1 point pour chaque CHF 1 dépensé."),
    t("100 points = CHF 5 discount on your next order.", "100 points = CHF 5 de réduction sur votre prochaine commande."),
    t("Redeem your points directly at checkout.", "Utilisez vos points directement au paiement."),
    t("The more you order, the more you save.", "Plus vous commandez, plus vous économisez."),
  ];

  return (
    <Layout>
      <main className="max-w-2xl mx-auto px-6 py-16">
        <h1 className="font-sans uppercase tracking-[0.105em] text-3xl md:text-4xl text-foreground mb-12 text-center">
          {t("Loyalty Rewards", "Programme de fidélité")}
        </h1>

        <div className="border border-border/60 p-8 mb-10 text-center">
          <p className="text-sm uppercase tracking-[0.105em] text-muted-foreground mb-2">
            {t("Current Balance", "Solde actuel")}
          </p>
          <p className="font-sans text-4xl md:text-5xl font-semibold text-primary mb-6">
            {BALANCE} {t("Points", "Points")}
          </p>

          <div className="w-full h-2.5 bg-secondary overflow-hidden mb-2">
            <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-sm text-foreground/75 mb-1">{BALANCE} / {TARGET} {t("Points", "Points")}</p>
          <p className="text-sm text-primary font-medium">
            {t(`Only ${remaining} points until your next reward!`, `Plus que ${remaining} points avant votre prochaine récompense !`)}
          </p>
        </div>

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
