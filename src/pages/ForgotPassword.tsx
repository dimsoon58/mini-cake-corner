import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";

const ForgotPassword = () => {
  const { t } = useLang();
  const { toast } = useToast();
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    document.title = "Forgot Password – Bento Cake Studio";
    return () => { document.title = "Bento Cake Studio Geneva"; };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    const { error } = await resetPassword(email);
    setIsSubmitting(false);

    if (error) {
      console.error("resetPasswordForEmail error:", error);

      const isRateLimited = /rate limit/i.test(error);
      toast({
        title: t("Something went wrong", "Une erreur est survenue"),
        description: isRateLimited
          ? t("Too many attempts. Please wait a few minutes before trying again.", "Trop de tentatives. Veuillez patienter quelques minutes avant de réessayer.")
          : error,
        variant: "destructive",
      });
      return;
    }

    setSent(true);
  };

  return (
    <Layout>
      <main className="max-w-md mx-auto px-6 py-16">
        <h1 className="font-sans uppercase tracking-[0.105em] text-3xl text-foreground mb-10 text-center">
          {t("Forgot Password", "Mot de passe oublié")}
        </h1>

        {sent ? (
          <p className="text-sm text-foreground/75 leading-relaxed text-center">
            {t(
              "If an account exists for this email, a reset link has been sent.",
              "Si un compte existe pour cet email, un lien de réinitialisation a été envoyé."
            )}
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <Label htmlFor="email">{t("Email", "Email")}</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>

            <Button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-none bg-primary hover:bg-primary/90 text-primary-foreground uppercase tracking-[0.105em] text-[13px] font-medium"
            >
              {isSubmitting ? t("Sending...", "Envoi...") : t("Send Reset Link", "Envoyer le lien")}
            </Button>
          </form>
        )}

        <p className="text-sm text-center mt-6">
          <Link to="/login" className="text-foreground/60 hover:text-foreground underline">
            {t("Back to sign in", "Retour à la connexion")}
          </Link>
        </p>
      </main>
    </Layout>
  );
};

export default ForgotPassword;
