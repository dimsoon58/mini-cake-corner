import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";

const Login = () => {
  const { t } = useLang();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { signIn, user } = useAuth();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    document.title = "Sign In – Bento Cake Studio";
    return () => { document.title = "Bento Cake Studio Geneva"; };
  }, []);

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
    const { error } = await signIn(email, password);
    setIsSubmitting(false);

    if (error) {
      toast({
        title: t("Sign in failed", "Connexion impossible"),
        description: t("Incorrect email or password.", "Email ou mot de passe incorrect."),
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
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
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
