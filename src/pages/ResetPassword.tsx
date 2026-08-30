import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";

// Reached via the link Supabase sends from resetPasswordForEmail(). Clicking
// that link signs the browser into a temporary recovery session, so this
// page never needs the old password — supabase.auth.updateUser() with just
// the new password is enough to complete the reset.
const ResetPassword = () => {
  const { t } = useLang();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { updatePassword, session } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    document.title = "Reset Password – Bento Cake Studio";
    return () => { document.title = "Bento Cake Studio Geneva"; };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      toast({
        title: t("Passwords don't match", "Les mots de passe ne correspondent pas"),
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    const { error } = await updatePassword(password);
    setIsSubmitting(false);

    if (error) {
      toast({
        title: t("Could not update password", "Impossible de mettre à jour le mot de passe"),
        description: error,
        variant: "destructive",
      });
      return;
    }

    toast({
      title: t("Password updated", "Mot de passe mis à jour"),
      description: t("You can now sign in with your new password.", "Vous pouvez maintenant vous connecter avec votre nouveau mot de passe."),
    });
    navigate("/account");
  };

  if (!session) {
    return (
      <Layout>
        <main className="max-w-md mx-auto px-6 py-24 text-center">
          <p className="text-sm text-foreground/75 leading-relaxed">
            {t(
              "This password reset link is invalid or has expired. Please request a new one.",
              "Ce lien de réinitialisation est invalide ou a expiré. Merci d'en demander un nouveau."
            )}
          </p>
        </main>
      </Layout>
    );
  }

  return (
    <Layout>
      <main className="max-w-md mx-auto px-6 py-16">
        <h1 className="font-sans uppercase tracking-[0.105em] text-3xl text-foreground mb-10 text-center">
          {t("Reset Password", "Réinitialiser le mot de passe")}
        </h1>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <Label htmlFor="password">{t("New Password", "Nouveau mot de passe")}</Label>
            <Input id="password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="confirmPassword">{t("Confirm Password", "Confirmer le mot de passe")}</Label>
            <Input id="confirmPassword" type="password" required minLength={6} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
          </div>

          <Button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-none bg-primary hover:bg-primary/90 text-primary-foreground uppercase tracking-[0.105em] text-[13px] font-medium"
          >
            {isSubmitting ? t("Updating...", "Mise à jour...") : t("Update Password", "Mettre à jour")}
          </Button>
        </form>
      </main>
    </Layout>
  );
};

export default ResetPassword;
