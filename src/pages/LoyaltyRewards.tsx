import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "@/components/Layout";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";

type ActiveReservation = {
  order_id: string;
  amount: number;
  expires_at: string | null;
  order_exists: boolean;
  payment_status: string | null;
  order_validation: string | null;
};

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

  // All of the customer's own live reward reservations (2026-09-13
  // payment-resilience fix) — profile.reward_balance already reflects the
  // AVAILABLE amount (total minus every live reservation, whatever its
  // cause), so this is only the BREAKDOWN of what's currently held back and
  // why: a payment genuinely still in progress, or a payment already
  // succeeded and simply awaiting admin validation (reward_reservations.
  // status stays 'reserved' at the SQL level until then — finalize_reward_
  // for_order only fires once an admin approves — but the customer must
  // never see that as "payment in progress"). list_active_reward_
  // reservations() is read-only and scoped server-side to auth.uid(); never
  // used here to apply anything to a cart.
  const [reservations, setReservations] = useState<ActiveReservation[]>([]);
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc("list_active_reward_reservations" as any);
      if (cancelled || error || !Array.isArray(data)) return;
      setReservations(data as ActiveReservation[]);
    })();
    return () => { cancelled = true; };
  }, [user]);

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

  // Split the breakdown: a reservation whose order is already paid is
  // "awaiting validation", never "payment in progress" — same distinction
  // Checkout.tsx makes, driven by the same payment_status field, never by
  // reward_reservations.status alone (which stays 'reserved' in both cases).
  const paidPendingAdmin = reservations.filter((r) => r.order_exists && r.payment_status === "paid");
  const paymentInProgress = reservations.filter((r) => !(r.order_exists && r.payment_status === "paid"));
  const totalReserved = reservations.reduce((sum, r) => sum + Number(r.amount || 0), 0);

  return (
    <Layout>
      <main className="max-w-2xl mx-auto px-6 py-16">
        <h1 className="font-sans uppercase tracking-[0.105em] text-3xl md:text-4xl text-foreground mb-12 text-center font-semibold">
          {t("Loyalty Rewards", "Programme de fidélité")}
        </h1>

        <div className="border border-border/60 p-8 mb-10 text-center">
          <p className="text-sm uppercase tracking-[0.105em] text-muted-foreground mb-2">
            {t("Available", "Disponible")}
          </p>
          <p className="font-sans text-4xl md:text-5xl font-semibold text-primary">
            CHF {balance.toFixed(2)}
          </p>
        </div>

        {totalReserved > 0 && (
          <div className="border border-border/60 bg-muted/20 p-6 mb-10 space-y-4">
            {paymentInProgress.length > 0 && (
              <div>
                <p className="text-sm font-medium text-foreground">
                  {t(
                    `CHF ${paymentInProgress.reduce((s, r) => s + Number(r.amount || 0), 0).toFixed(2)} reserved for a payment in progress.`,
                    `CHF ${paymentInProgress.reduce((s, r) => s + Number(r.amount || 0), 0).toFixed(2)} réservés pour un paiement en cours.`,
                  )}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {t(
                    "These points are held so they can't be used twice. They become available again automatically if that payment doesn't go through.",
                    "Ces points sont bloqués pour éviter qu'ils ne soient utilisés deux fois. Ils redeviennent disponibles automatiquement si ce paiement n'aboutit pas.",
                  )}
                </p>
              </div>
            )}
            {paidPendingAdmin.length > 0 && (
              <div>
                <p className="text-sm font-medium text-foreground">
                  {t(
                    `CHF ${paidPendingAdmin.reduce((s, r) => s + Number(r.amount || 0), 0).toFixed(2)} used on a paid order, awaiting validation.`,
                    `CHF ${paidPendingAdmin.reduce((s, r) => s + Number(r.amount || 0), 0).toFixed(2)} utilisés sur une commande payée, en attente de validation.`,
                  )}
                </p>
              </div>
            )}
          </div>
        )}

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
