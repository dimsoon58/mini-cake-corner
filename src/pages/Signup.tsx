import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";

const Signup = () => {
  const { t } = useLang();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { signUp, user } = useAuth();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [birthDate, setBirthDate] = useState<Date | undefined>(undefined);
  const [password, setPassword] = useState("");
  const [newsletterSubscription, setNewsletterSubscription] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    document.title = "Create Account – Bento Cake Studio";
    return () => { document.title = "Bento Cake Studio Geneva"; };
  }, []);

  useEffect(() => {
    if (user) navigate("/account");
  }, [user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!birthDate) {
      toast({
        title: t("Date of birth required", "Date de naissance requise"),
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    const { error } = await signUp({
      firstName,
      lastName,
      email,
      phone,
      birthDate: format(birthDate, "yyyy-MM-dd"),
      password,
      newsletterSubscription,
    });
    setIsSubmitting(false);

    if (error) {
      toast({
        title: t("Could not create account", "Impossible de créer le compte"),
        description: error,
        variant: "destructive",
      });
      return;
    }

    setSubmitted(true);
  };

  if (submitted) {
    return (
      <Layout>
        <main className="max-w-md mx-auto px-6 py-24 text-center">
          <h1 className="font-sans uppercase tracking-[0.105em] text-2xl text-foreground mb-4">
            {t("Check your email", "Vérifiez votre email")}
          </h1>
          <p className="text-sm text-foreground/75 leading-relaxed">
            {t(
              "We've sent a confirmation link to your email address. Please confirm it before signing in.",
              "Nous avons envoyé un lien de confirmation à votre adresse email. Merci de le confirmer avant de vous connecter."
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
          {t("Create an Account", "Créer un compte")}
        </h1>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="firstName">{t("First Name", "Prénom")}</Label>
              <Input id="firstName" required value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="lastName">{t("Last Name", "Nom")}</Label>
              <Input id="lastName" required value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>

          <div>
            <Label htmlFor="email">{t("Email", "Email")}</Label>
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>

          <div>
            <Label htmlFor="phone">{t("Phone", "Téléphone")}</Label>
            <Input id="phone" type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>

          <div className="flex flex-col">
            <Label>{t("Date of Birth", "Date de naissance")}</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className={cn(
                    "justify-start text-left font-normal rounded-none mt-1",
                    !birthDate && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {birthDate ? format(birthDate, "dd.MM.yyyy") : t("Pick a date", "Choisir une date")}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={birthDate}
                  onSelect={setBirthDate}
                  captionLayout="dropdown"
                  fromYear={1920}
                  toYear={new Date().getFullYear()}
                  disabled={(date) => date > new Date()}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
          </div>

          <div>
            <Label htmlFor="password">{t("Password", "Mot de passe")}</Label>
            <Input id="password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>

          <div className="flex items-start gap-3">
            <Checkbox
              id="newsletter"
              checked={newsletterSubscription}
              onCheckedChange={(c) => setNewsletterSubscription(c === true)}
            />
            <Label htmlFor="newsletter" className="text-sm font-normal cursor-pointer">
              {t("Subscribe to our newsletter", "S'abonner à notre newsletter")}
            </Label>
          </div>

          <Button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-none bg-primary hover:bg-primary/90 text-primary-foreground uppercase tracking-[0.105em] text-[13px] font-medium"
          >
            {isSubmitting ? t("Creating account...", "Création du compte...") : t("Create Account", "Créer le compte")}
          </Button>
        </form>

        <p className="text-sm text-center mt-6">
          <span className="text-foreground/60">{t("Already have an account?", "Vous avez déjà un compte ?")} </span>
          <Link to="/login" className="text-primary hover:text-primary/80 underline">
            {t("Sign in", "Se connecter")}
          </Link>
        </p>
      </main>
    </Layout>
  );
};

export default Signup;
