import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { normalizeEmail } from "@/lib/identity";

const RESEND_COOLDOWN_SECONDS = 120;

function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

const Login = () => {
  const { t } = useLang();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { signIn, user } = useAuth();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Shown only when Supabase reliably reports email_not_confirmed (i.e. the
  // password was correct but the address is still unverified).
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendNotice, setResendNotice] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    document.title = "Sign In – Bento Cake Studio";
    return () => { document.title = "Bento Cake Studio Geneva"; };
  }, []);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const id = setInterval(() => setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [resendCooldown]);

  const handleResendConfirmation = async () => {
    setIsResending(true);
    setResendNotice(null);
    // Same normalized address used for the sign-in attempt. Reuses the exact
    // existing resend action — no new endpoint, no account recreation.
    const { error } = await supabase.auth.resend({ type: "signup", email: normalizeEmail(email) });
    setIsResending(false);
    if (error) {
      setResendNotice({ type: "error", message: error.message });
      return;
    }
    setResendNotice({
      type: "success",
      message: t("Confirmation email sent again.", "Email de confirmation renvoyé."),
    });
    setResendCooldown(RESEND_COOLDOWN_SECONDS);
  };

  useEffect(() => {
    if (searchParams.get("confirmed") === "true") {
      toast({
        title: t("Email confirmed", "Email confirmé"),
        description: t("Your email is confirmed — you can now sign in.", "Votre email est confirmé — vous pouvez maintenant vous connecter."),
      });
    }
  }, [searchParams, t, toast]);

  useEffect(() => {
    if (user) navigate("/account");
  }, [user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setResendNotice(null);
    const { error, code } = await signIn(normalizeEmail(email), password);
    setIsSubmitting(false);

    if (error) {
      if (code === "email_not_confirmed") {
        setNeedsConfirmation(true);
        toast({
          title: t("Email not confirmed", "Email non confirmé"),
          description: t(
            "Your email address has not been confirmed yet. Check your inbox or resend the confirmation email.",
            "Votre adresse email n'a pas encore été confirmée. Consultez votre boîte de réception ou renvoyez l'email de confirmation."
          ),
          variant: "destructive",
        });
        return;
      }
      // Supabase deliberately does not distinguish an unknown email from a
      // wrong password — keep it that way with one message.
      setNeedsConfirmation(false);
      toast({
        title: t("Sign in failed", "Connexion impossible"),
        description: t(
          "Email or password incorrect. Please check your details or reset your password.",
          "Email ou mot de passe incorrect. Vérifiez vos informations ou réinitialisez votre mot de passe."
        ),
        variant: "destructive",
      });
      return;
    }

    navigate("/account");
  };

  return (
    <Layout>
      <main className="max-w-md mx-auto px-6 py-16">
        <h1 className="font-sans uppercase tracking-[0.105em] text-3xl text-foreground mb-10 text-center">
          {t("Sign In", "Se connecter")}
        </h1>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <Label htmlFor="email">{t("Email", "Email")}</Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setEmail((prev) => normalizeEmail(prev))}
            />
          </div>
          <div>
            <Label htmlFor="password">{t("Password", "Mot de passe")}</Label>
            <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>

          <Button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-none bg-primary hover:bg-primary/90 text-primary-foreground uppercase tracking-[0.105em] text-[13px] font-medium"
          >
            {isSubmitting ? t("Signing in...", "Connexion...") : t("Sign In", "Se connecter")}
          </Button>
        </form>

        {needsConfirmation && (
          <div className="mt-6 rounded-none border border-border bg-muted/30 p-4 text-sm">
            <p className="text-foreground/75 leading-relaxed">
              {t(
                "Your email address has not been confirmed yet. Check your inbox or resend the confirmation email.",
                "Votre adresse email n'a pas encore été confirmée. Consultez votre boîte de réception ou renvoyez l'email de confirmation."
              )}
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={resendCooldown > 0 || isResending}
              onClick={handleResendConfirmation}
              className="mt-3 rounded-none uppercase tracking-[0.105em] text-[12px] font-medium"
            >
              {resendCooldown > 0
                ? `${t("Resend in", "Renvoyer dans")} ${formatCountdown(resendCooldown)}`
                : isResending
                  ? t("Sending...", "Envoi...")
                  : t("Resend confirmation email", "Renvoyer l'email de confirmation")}
            </Button>
            {resendNotice && (
              <p className={cn("mt-2", resendNotice.type === "error" ? "text-destructive" : "text-foreground/75")}>
                {resendNotice.message}
              </p>
            )}
          </div>
        )}

        <div className="flex items-center justify-between mt-6 text-sm">
          <Link to="/forgot-password" className="text-foreground/60 hover:text-foreground underline">
            {t("Forgot password?", "Mot de passe oublié ?")}
          </Link>
          <Link to="/signup" className="text-primary hover:text-primary/80 underline">
            {t("Create an account", "Créer un compte")}
          </Link>
        </div>
      </main>
    </Layout>
  );
};

export default Login;
