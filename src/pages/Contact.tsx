import { useState, useRef } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Upload, X, Plus, Minus } from "lucide-react";
import Layout from "@/components/Layout";
import { useLang } from "@/context/LanguageContext";
import { useFieldError } from "@/lib/formErrors";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { PhoneNumberField } from "@/components/PhoneNumberField";
import { HoneypotField } from "@/components/HoneypotField";
import { submitContactRequest } from "@/lib/contactRequest";
import { combinePhoneNumber } from "@/lib/identity";

const contactSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(100),
  lastName: z.string().trim().min(1, "Last name is required").max(100),
  email: z.string().trim().email("Invalid email address").max(255),
  message: z.string().trim().min(1, "Message is required").max(2000),
});

type ContactFormData = z.infer<typeof contactSchema>;

// Same light rule everywhere phone is now split into country code + local
// part: an "incomplete" number is caught here rather than by a rigid regex
// that would need to know every country's real format.
const MIN_LOCAL_PHONE_DIGITS = 4;

// Accordion item: title pair (en/fr) + content pair (en/fr)
function AccordionItem({
  titleEn,
  titleFr,
  children,
}: {
  titleEn: string;
  titleFr: string;
  children: (lang: string) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { lang } = useLang();
  const title = lang === "fr" ? titleFr : titleEn;
  return (
    <div className="border-b border-border/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between py-3.5 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
        aria-expanded={open}
      >
        <span className="font-sans text-[11px] uppercase tracking-[0.12em] font-semibold text-foreground">
          {title}
        </span>
        {open ? (
          <Minus className="h-3.5 w-3.5 text-primary flex-shrink-0" />
        ) : (
          <Plus className="h-3.5 w-3.5 text-primary flex-shrink-0" />
        )}
      </button>
      <div
        className="overflow-hidden transition-all duration-300"
        style={{ maxHeight: open ? "600px" : "0px" }}
      >
        <div className="pb-4 text-sm text-foreground/80 leading-relaxed space-y-2">
          {children(lang)}
        </div>
      </div>
    </div>
  );
}

const Contact = () => {
  const [submitted, setSubmitted] = useState(false);
  const { t, lang } = useLang();
  const fe = useFieldError();
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [countryCode, setCountryCode] = useState("+41");
  const [localPhone, setLocalPhone] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [honeypot, setHoneypot] = useState("");

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ContactFormData>({
    resolver: zodResolver(contactSchema),
  });

  const onSubmit = async (data: ContactFormData) => {
    if (localPhone.trim().length < MIN_LOCAL_PHONE_DIGITS) {
      setPhoneError(t("Please enter a valid phone number", "Veuillez entrer un numéro de téléphone valide"));
      return;
    }
    setPhoneError(null);
    try {
      await submitContactRequest(
        "contact",
        {
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.email,
          phone: combinePhoneNumber(countryCode, localPhone),
          message: data.message,
        },
        data.email,
        { files: file ? [file] : [], honeypot },
      );
      setSubmitted(true);
    } catch (err) {
      // Deliberately not touched on error: no reset() here, so the customer
      // never has to retype what they already entered.
      toast.error(err instanceof Error ? err.message : t("Something went wrong. Please try again.", "Une erreur s'est produite. Veuillez réessayer."));
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      if (selected.size > 8 * 1024 * 1024) {
        toast.error(t("File size must be under 8 MB.", "Le fichier doit faire moins de 8 Mo."));
        return;
      }
      setFile(selected);
    }
  };

  const handleReset = () => {
    setSubmitted(false);
    setFile(null);
    setCountryCode("+41");
    setLocalPhone("");
    setPhoneError(null);
    reset();
  };

  return (
    <Layout>
      <main className="max-w-4xl mx-auto px-6 py-16">
        <h1 className="font-sans uppercase tracking-[0.105em] text-4xl md:text-5xl text-foreground mb-12 text-center font-semibold">
          {t("Contact Us", "Contactez-nous")}
        </h1>

        <div className="space-y-10 text-foreground leading-relaxed">

          {/* ── CONTACT US ── */}
          <div className="space-y-5">
            <p className="font-sans text-[11px] uppercase tracking-[0.12em] font-semibold text-foreground">
              {t("QUESTIONS? OUR TEAM IS HERE TO HELP.", "QUESTIONS ? NOTRE ÉQUIPE EST LÀ POUR VOUS AIDER.")}
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              {/* WhatsApp */}
              <a
                href="https://wa.me/41783379500"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 border border-border/60 px-4 py-3 hover:border-primary/50 hover:bg-primary/5 transition-all group flex-1"
              >
                {/* WhatsApp icon */}
                <svg className="h-5 w-5 text-primary flex-shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground font-semibold">WhatsApp</p>
                  <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">+41 78 337 95 00</p>
                </div>
              </a>
              {/* Instagram */}
              <a
                href="https://instagram.com/bentocakestudio"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 border border-border/60 px-4 py-3 hover:border-primary/50 hover:bg-primary/5 transition-all group flex-1"
              >
                {/* Instagram icon */}
                <svg className="h-5 w-5 text-primary flex-shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
                </svg>
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground font-semibold">Instagram</p>
                  <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">@bentocakestudio</p>
                </div>
              </a>
              {/* Email */}
              <a
                href="mailto:contact@bentocakestudio.ch"
                className="flex items-center gap-3 border border-border/60 px-4 py-3 hover:border-primary/50 hover:bg-primary/5 transition-all group flex-1"
              >
                {/* Email icon */}
                <svg className="h-5 w-5 text-primary flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <rect x="2" y="4" width="20" height="16" rx="2"/>
                  <polyline points="2,4 12,13 22,4"/>
                </svg>
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground font-semibold">Email</p>
                  <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors truncate">contact@bentocakestudio.ch</p>
                </div>
              </a>
              {/* TikTok */}
              <a
                href="https://www.tiktok.com/@bentocakestudio"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 border border-border/60 px-4 py-3 hover:border-primary/50 hover:bg-primary/5 transition-all group flex-1"
              >
                <svg className="h-5 w-5 text-primary flex-shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.18 8.18 0 004.78 1.52V6.75a4.84 4.84 0 01-1.01-.06z"/>
                </svg>
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground font-semibold">TikTok</p>
                  <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">@bentocakestudio</p>
                </div>
              </a>
              {/* LinkedIn */}
              <a
                href="https://www.linkedin.com/company/bentocakestudio/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 border border-border/60 px-4 py-3 hover:border-primary/50 hover:bg-primary/5 transition-all group flex-1"
              >
                <svg className="h-5 w-5 text-primary flex-shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                </svg>
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground font-semibold">LinkedIn</p>
                  <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">Bento Cake Studio</p>
                </div>
              </a>
            </div>
          </div>

          {/* ── IMPORTANT ORDERING INFORMATION ── */}
          <div className="space-y-0">
            <p className="font-sans text-[11px] uppercase tracking-[0.12em] font-semibold text-foreground mb-4">
              {t("IMPORTANT ORDERING INFORMATION", "INFORMATIONS IMPORTANTES DE COMMANDE")}
            </p>

            <AccordionItem
              titleEn="ORDERING & LEAD TIME"
              titleFr="COMMANDES ET DÉLAIS"
            >
              {(l) =>
                l === "fr" ? (
                  <p>
                    Tous nos gâteaux sont préparés à la commande. La <strong>première date de retrait ou de livraison disponible est 2 jours</strong> après la commande : les commandes pour le jour même et le lendemain ne sont pas possibles. Nous vous recommandons de commander quelques jours à l'avance, en particulier pour les week-ends et les périodes de fêtes.
                  </p>
                ) : (
                  <p>
                    All of our cakes are made fresh to order. The <strong>earliest available pickup or delivery date is 2 days</strong> after your order: same-day and next-day orders are not possible. We recommend ordering a few days ahead, especially for weekends and holidays.
                  </p>
                )
              }
            </AccordionItem>

            <AccordionItem
              titleEn="EXPRESS ORDERS"
              titleFr="COMMANDES EXPRESS"
            >
              {(l) =>
                l === "fr" ? (
                  <>
                    <p>
                      Les commandes passées <strong>4 à 5 jours à l'avance</strong> incluent un <strong>supplément express de 15 %</strong>. Les commandes passées <strong>2 à 3 jours à l'avance</strong> incluent un <strong>supplément express de 20 %</strong>. Le tarif standard s'applique à partir de 6 jours à l'avance.
                    </p>
                    <p className="text-foreground/60 text-xs">
                      Le supplément est calculé sur le montant des produits, hors frais de livraison.
                    </p>
                  </>
                ) : (
                  <>
                    <p>
                      Orders placed <strong>4–5 days in advance</strong> include a <strong>15% express surcharge</strong>. Orders placed <strong>2–3 days in advance</strong> include a <strong>20% express surcharge</strong>. Standard pricing applies from 6 days in advance.
                    </p>
                    <p className="text-foreground/60 text-xs">
                      The surcharge is calculated on the product amount, excluding delivery fees.
                    </p>
                  </>
                )
              }
            </AccordionItem>

            <AccordionItem
              titleEn="PAYMENT, CHANGES & CANCELLATIONS"
              titleFr="PAIEMENT, MODIFICATIONS ET ANNULATIONS"
            >
              {(l) =>
                l === "fr" ? (
                  <p>
                    Les commandes ne sont confirmées qu'à réception du paiement. Si vous souhaitez annuler ou reporter votre commande, vous devez nous prévenir au moins <strong>5 jours à l'avance</strong> pour être remboursé ou changer la date. Sinon, <strong>aucun remboursement ni report ne sera possible</strong>.
                  </p>
                ) : (
                  <p>
                    Orders are confirmed only upon receipt of payment. If you wish to cancel or reschedule your order, you must notify us at least <strong>5 days in advance</strong> to receive a refund or change the date. Otherwise, <strong>no refunds or rescheduling will be possible</strong>.
                  </p>
                )
              }
            </AccordionItem>
          </div>

          {/* ── Need Help Form ── */}
          <div className="border border-border rounded-none p-6 md:p-8 mt-4">
            <h2 className="font-sans uppercase tracking-[0.105em] text-2xl text-foreground mb-2">{t("Need Help?", "Besoin d'aide ?")}</h2>
            <p className="text-muted-foreground mb-6">
              {t("Fill out the form below and we'll get back to you as soon as possible.", "Remplissez le formulaire ci-dessous et nous vous répondrons dès que possible.")}
            </p>

            {submitted ? (
              <div className="text-center py-8">
                <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
                  <span className="text-3xl">✓</span>
                </div>
                <h3 className="font-sans uppercase tracking-[0.105em] text-2xl text-foreground mb-3">{t("Thank You", "Merci")}</h3>
                <p className="text-muted-foreground leading-relaxed mb-6">
                  {t("We've received your message and will get back to you shortly.", "Nous avons bien reçu votre message et vous répondrons sous peu.")}
                </p>
                <Button variant="outline" onClick={handleReset}>
                  {t("Send another message", "Envoyer un autre message")}
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
                <HoneypotField value={honeypot} onChange={setHoneypot} />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="firstName">
                      {t("First Name", "Prénom")} <span className="text-destructive">*</span>
                    </Label>
                    <Input id="firstName" {...register("firstName")} />
                    {errors.firstName && (
                      <p className="text-sm text-destructive">{fe(errors.firstName.message)}</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="lastName">
                      {t("Last Name", "Nom")} <span className="text-destructive">*</span>
                    </Label>
                    <Input id="lastName" {...register("lastName")} />
                    {errors.lastName && (
                      <p className="text-sm text-destructive">{fe(errors.lastName.message)}</p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="email">
                      Email <span className="text-destructive">*</span>
                    </Label>
                    <Input id="email" type="email" {...register("email")} />
                    {errors.email && (
                      <p className="text-sm text-destructive">{fe(errors.email.message)}</p>
                    )}
                  </div>
                  <PhoneNumberField
                    id="phone"
                    label={t("Phone Number", "Numéro de téléphone")}
                    countryCode={countryCode}
                    onCountryCodeChange={setCountryCode}
                    localPhone={localPhone}
                    onLocalPhoneChange={setLocalPhone}
                    error={phoneError ?? undefined}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="message">
                    Message <span className="text-destructive">*</span>
                  </Label>
                  <Textarea
                    id="message"
                    rows={5}
                    placeholder={t("Please include your order number and clearly explain your issue.", "Merci d'indiquer votre numéro de commande et d'expliquer clairement votre problème.")}
                    {...register("message")}
                  />
                  {errors.message && (
                    <p className="text-sm text-destructive">{fe(errors.message.message)}</p>
                  )}
                </div>

                {/* File upload */}
                <div className="space-y-1.5">
                  <Label>{t("Attach an image (optional)", "Joindre une image (optionnel)")}</Label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                  {file ? (
                    <div className="flex items-center gap-3 border border-border rounded-none px-3 py-2 text-sm">
                      <span className="truncate flex-1">{file.name}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setFile(null);
                          if (fileInputRef.current) fileInputRef.current.value = "";
                        }}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full justify-start gap-2 text-muted-foreground"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Upload className="h-4 w-4" />
                      {t("Choose a file…", "Choisir un fichier…")}
                    </Button>
                  )}
                </div>

                <Button type="submit" disabled={isSubmitting} className="w-full rounded-none" size="lg">
                  {isSubmitting ? t("Sending…", "Envoi…") : t("Send Message", "Envoyer le message")}
                </Button>
              </form>
            )}
          </div>
        </div>
      </main>
    </Layout>
  );
};

export default Contact;
