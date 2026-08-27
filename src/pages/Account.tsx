import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { CalendarIcon, Package, Gift } from "lucide-react";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  COUNTRY_CODES,
  normalizeName,
  sanitizePhoneLocalInput,
  combinePhoneNumber,
  splitPhoneNumber,
  formatPhoneForDisplay,
} from "@/lib/identity";

function formatDateCH(dateValue?: string | null): string {
  if (!dateValue) return "—";
  const [year, month, day] = dateValue.split("-");
  return year && month && day ? `${day}.${month}.${year}` : dateValue;
}

const Account = () => {
  const { t } = useLang();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, profile, loading, profileError, refreshProfile } = useAuth();

  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [countryCode, setCountryCode] = useState("+41");
  const [phone, setPhone] = useState("");
  const [birthDate, setBirthDate] = useState<Date | undefined>(undefined);
  const [newsletterSubscription, setNewsletterSubscription] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    document.title = "My Account – Bento Cake Studio";
    return () => { document.title = "Bento Cake Studio Geneva"; };
  }, []);

  useEffect(() => {
    if (!loading && !user) navigate("/login");
  }, [loading, user, navigate]);

  const startEditing = () => {
    if (!profile) return;
    setFirstName(profile.first_name ? normalizeName(profile.first_name) : "");
    setLastName(profile.last_name ? normalizeName(profile.last_name) : "");
    if (profile.phone) {
      const parsed = splitPhoneNumber(profile.phone);
      if (parsed.countryCode) setCountryCode(parsed.countryCode);
      setPhone(parsed.localPhone);
    } else {
      setPhone("");
    }
    setBirthDate(profile.birth_date ? new Date(profile.birth_date) : undefined);
    setNewsletterSubscription(!!profile.newsletter_subscription);
    setEditing(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setIsSaving(true);
    // Only the fields a customer is allowed to change — reward_balance and
    // welcome_discount_* are never sent from here (and are now protected
    // server-side by a trigger even if they were).
    const { error } = await supabase
      .from("profiles")
      .update({
        first_name: normalizeName(firstName),
        last_name: normalizeName(lastName),
        phone: combinePhoneNumber(countryCode, phone),
        birth_date: birthDate ? format(birthDate, "yyyy-MM-dd") : null,
        newsletter_subscription: newsletterSubscription,
      })
      .eq("id", user.id);
    setIsSaving(false);

    if (error) {
      toast({
        title: t("Could not save changes", "Impossible d'enregistrer les modifications"),
        description: error.message,
        variant: "destructive",
      });
      return;
    }

    await refreshProfile();
    setEditing(false);
    toast({
      title: t("Profile updated", "Profil mis à jour"),
    });
  };

  // profileError means fetchProfile actually failed (not just "still in
  // flight") — showing "Loading..." forever here was the bug: this branch
  // now breaks out with a retry instead of spinning indefinitely.
  if (!loading && user && !profile && profileError) {
    return (
      <Layout>
        <main className="max-w-2xl mx-auto px-6 py-24 text-center space-y-4">
          <p className="text-sm text-muted-foreground">
            {t("We couldn't load your account. Please try again.", "Impossible de charger votre compte. Veuillez réessayer.")}
          </p>
          <Button variant="outline" onClick={() => refreshProfile()} className="rounded-none">
            {t("Retry", "Réessayer")}
          </Button>
        </main>
      </Layout>
    );
  }

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

  const row = (label: string, value: string) => (
    <div className="flex items-center justify-between py-3 border-b border-border/50 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground font-medium">{value}</span>
    </div>
  );

  return (
    <Layout>
      <main className="max-w-2xl mx-auto px-6 py-16">
        <h1 className="font-sans uppercase tracking-[0.105em] text-3xl md:text-4xl text-foreground mb-12 text-center">
          {t("My Account", "Mon compte")}
        </h1>

        <section className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-sans uppercase tracking-[0.105em] text-sm font-semibold text-foreground">
              {t("My Details", "Mes coordonnées")}
            </h2>
            {!editing && (
              <button
                onClick={startEditing}
                className="text-xs text-primary hover:text-primary/80 underline"
              >
                {t("Edit", "Modifier")}
              </button>
            )}
          </div>

          {editing ? (
            <form onSubmit={handleSave} className="border border-border/60 p-5 space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="firstName">{t("First Name", "Prénom")}</Label>
                  <Input
                    id="firstName"
                    required
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    onBlur={() => setFirstName((prev) => normalizeName(prev))}
                  />
                </div>
                <div>
                  <Label htmlFor="lastName">{t("Last Name", "Nom")}</Label>
                  <Input
                    id="lastName"
                    required
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    onBlur={() => setLastName((prev) => normalizeName(prev))}
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="phone">{t("Phone", "Téléphone")}</Label>
                <div className="flex gap-2">
                  <Select value={countryCode} onValueChange={setCountryCode}>
                    <SelectTrigger className="w-[100px] shrink-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {COUNTRY_CODES.map((cc) => (
                        <SelectItem key={cc.code} value={cc.code}>
                          {cc.flag} {cc.code}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    id="phone"
                    type="tel"
                    inputMode="numeric"
                    required
                    value={phone}
                    onChange={(e) => setPhone(sanitizePhoneLocalInput(e.target.value, countryCode))}
                  />
                </div>
              </div>

              <div className="flex flex-col">
                <Label>{t("Date of Birth", "Date de naissance")}</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className={cn("justify-start text-left font-normal rounded-none mt-1", !birthDate && "text-muted-foreground")}
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

              <div className="flex gap-3 pt-2">
                <Button
                  type="submit"
                  disabled={isSaving}
                  className="rounded-none bg-primary hover:bg-primary/90 text-primary-foreground uppercase tracking-[0.105em] text-[12px] font-medium"
                >
                  {isSaving ? t("Saving...", "Enregistrement...") : t("Save Changes", "Enregistrer")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditing(false)}
                  className="rounded-none uppercase tracking-[0.105em] text-[12px] font-medium"
                >
                  {t("Cancel", "Annuler")}
                </Button>
              </div>
            </form>
          ) : (
            <div className="border border-border/60 px-5">
              {row(
                t("Name", "Nom"),
                `${profile.first_name ? normalizeName(profile.first_name) : ""} ${profile.last_name ? normalizeName(profile.last_name) : ""}`.trim() || "—"
              )}
              {row(t("Email", "Email"), profile.email ?? user.email ?? "—")}
              {row(t("Phone", "Téléphone"), profile.phone ? formatPhoneForDisplay(profile.phone) : "—")}
              {row(t("Date of Birth", "Date de naissance"), formatDateCH(profile.birth_date))}
              {row(t("Newsletter", "Newsletter"), profile.newsletter_subscription ? t("Subscribed", "Abonné(e)") : t("Not subscribed", "Non abonné(e)"))}
            </div>
          )}
        </section>

        <section className="mb-10">
          <h2 className="font-sans uppercase tracking-[0.105em] text-sm font-semibold text-foreground mb-4">
            {t("Rewards", "Fidélité")}
          </h2>
          <div className="border border-border/60 px-5">
            {row(t("Reward balance", "Solde cagnotte"), `CHF ${(profile.reward_balance ?? 0).toFixed(2)}`)}
          </div>
          {voucherAvailable && (
            <div className="border border-primary bg-secondary/40 p-5 mt-4 text-center">
              <p className="font-sans uppercase tracking-[0.105em] text-sm font-semibold text-primary mb-1">
                {t("Welcome Voucher Available", "Voucher de bienvenue disponible")}
              </p>
              <p className="text-sm text-foreground/80">
                {t("-10% off your next order", "-10% sur votre prochaine commande")}
              </p>
            </div>
          )}
        </section>

        <section className="grid grid-cols-2 gap-4">
          <Button asChild variant="outline" className="rounded-none border-primary text-primary hover:bg-primary/5 uppercase tracking-[0.105em] text-[12px] font-medium">
            <Link to="/account/orders">
              <Package className="w-4 h-4 mr-2" strokeWidth={1.5} />
              {t("My Orders", "Mes commandes")}
            </Link>
          </Button>
          <Button asChild variant="outline" className="rounded-none border-primary text-primary hover:bg-primary/5 uppercase tracking-[0.105em] text-[12px] font-medium">
            <Link to="/account/rewards">
              <Gift className="w-4 h-4 mr-2" strokeWidth={1.5} />
              {t("Loyalty Rewards", "Programme de fidélité")}
            </Link>
          </Button>
        </section>
      </main>
    </Layout>
  );
};

export default Account;
