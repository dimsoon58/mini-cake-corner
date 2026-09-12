import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { PhoneNumberField } from "@/components/PhoneNumberField";
import { HoneypotField } from "@/components/HoneypotField";
import { submitContactRequest } from "@/lib/contactRequest";
import { combinePhoneNumber } from "@/lib/identity";
// Reused as a plain Europe/Zurich "days until this date" utility — NOT the
// cake-order lead-time/express rule itself (that stays 2 days + a J+2/J+3
// surcharge, untouched, and lives only in Checkout.tsx / create-postfinance-
// payment). Workshops need their own, longer, surcharge-free minimum below.
import { calendarDaysUntil } from "@/lib/orderDates";
import { cn } from "@/lib/utils";
import { useLang } from "@/context/LanguageContext";
import { useFieldError } from "@/lib/formErrors";

// Extracted verbatim from Workshop.tsx so the same quote-request flow can be
// reused elsewhere (e.g. the "larger group" case in the workshop booking
// stepper). Behaviour is unchanged.
//
// Phone: same two-part country-code + local-number field as the checkout
// page (src/components/PhoneNumberField.tsx) — no separate free-text phone
// regex any more; the full international number is only assembled at
// submit time via combinePhoneNumber(), same helper checkout uses.

const privateSchema = z.object({
  fullName: z.string().trim().min(1, "Name is required").max(150),
  email: z.string().trim().email("Please enter a valid email address").max(255),
  occasion: z.string().trim().max(150).optional(),
  participants: z.string().trim().min(1, "Number of participants is required").max(50),
  preferredDate: z.date().optional(),
  message: z.string().trim().min(1, "Please tell us about your event").max(2000),
});
type PrivateData = z.infer<typeof privateSchema>;

// Same light rule everywhere phone is now split into country code + local
// part: an "incomplete" number is caught here rather than by a rigid regex
// that would need to know every country's real format.
const MIN_LOCAL_PHONE_DIGITS = 4;

// A private/custom workshop needs organisation time — a longer, FLAT minimum
// lead time than a cake order, and no express surcharge to skip it (the
// cake-order 2-day lead + J+2/J+3 surcharge in src/lib/orderDates.ts is a
// separate rule and is untouched by this constant).
const WORKSHOP_MIN_LEAD_DAYS = 4;

export const PrivateWorkshopDialog = ({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) => {
  const { t } = useLang();
  const fe = useFieldError();
  const [submitted, setSubmitted] = useState(false);
  const [countryCode, setCountryCode] = useState("+41");
  const [localPhone, setLocalPhone] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [honeypot, setHoneypot] = useState("");
  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<PrivateData>({ resolver: zodResolver(privateSchema) });

  const preferredDate = watch("preferredDate");

  const handleClose = (v: boolean) => {
    if (!v) setTimeout(() => { setSubmitted(false); reset(); setCountryCode("+41"); setLocalPhone(""); setPhoneError(null); }, 250);
    onOpenChange(v);
  };

  const onSubmit = async (data: PrivateData) => {
    if (localPhone.trim().length < MIN_LOCAL_PHONE_DIGITS) {
      setPhoneError(t("Please enter a valid phone number", "Veuillez entrer un numéro de téléphone valide"));
      return;
    }
    setPhoneError(null);

    try {
      await submitContactRequest(
        "private_workshop",
        {
          fullName: data.fullName,
          email: data.email,
          phone: combinePhoneNumber(countryCode, localPhone),
          occasion: data.occasion || "(not provided)",
          participants: data.participants,
          preferredDate: data.preferredDate ? format(data.preferredDate, "dd.MM.yyyy") : "(not provided)",
          message: data.message,
        },
        data.email,
        { honeypot },
      );
      setSubmitted(true);
    } catch (err) {
      // Form data is deliberately left untouched here — reset() is only
      // called on success or on closing the dialog, never on a failed
      // submit, so the customer never has to retype anything.
      toast.error(err instanceof Error ? err.message : t("Something went wrong. Please try again.", "Une erreur s'est produite. Veuillez réessayer."));
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        {submitted ? (
          <div className="text-center py-10">
            <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
              <span className="text-3xl text-primary">✓</span>
            </div>
            <h3 className="font-sans uppercase tracking-[0.105em] text-xl font-semibold text-foreground mb-3">{t("Thank you", "Merci")}</h3>
            <p className="text-muted-foreground leading-relaxed max-w-md mx-auto">
              {t("Thank you for your enquiry. We will get back to you shortly with a personalised proposal for your private workshop.", "Merci pour votre demande. Nous reviendrons vers vous très prochainement avec une proposition personnalisée pour votre atelier privé.")}
            </p>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="font-sans uppercase tracking-[0.105em] text-xl text-foreground">
                {t("Private & Custom Workshops", "Ateliers privés et sur mesure")}
              </DialogTitle>
              <DialogDescription className="text-muted-foreground leading-relaxed pt-1">
                {t("Tell us about your event and we will get back to you with a personalised proposal.", "Parlez-nous de votre événement et nous reviendrons vers vous avec une proposition personnalisée.")}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-2 text-left">
              <HoneypotField value={honeypot} onChange={setHoneypot} />
              <div className="space-y-1.5">
                <Label htmlFor="pw-name">{t("First and last name", "Prénom et nom")} <span className="text-destructive">*</span></Label>
                <Input id="pw-name" {...register("fullName")} />
                {errors.fullName && <p className="text-sm text-destructive">{fe(errors.fullName.message)}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pw-email">{t("Email address", "Adresse e-mail")} <span className="text-destructive">*</span></Label>
                <Input id="pw-email" type="email" {...register("email")} />
                {errors.email && <p className="text-sm text-destructive">{fe(errors.email.message)}</p>}
              </div>
              {/* Phone gets its own full-width row (not squeezed into a
                  2-column grid next to email) — at dialog width, a shared
                  column left too little room to see the whole number while
                  typing. Standard-width selector (no "compact" override
                  needed any more now that the input has the full row). */}
              <PhoneNumberField
                id="pw-phone"
                label={t("Phone number", "Numéro de téléphone")}
                countryCode={countryCode}
                onCountryCodeChange={setCountryCode}
                localPhone={localPhone}
                onLocalPhoneChange={setLocalPhone}
                error={phoneError ?? undefined}
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="pw-occasion">{t("Occasion", "Occasion")} <span className="text-muted-foreground">{t("(optional)", "(optionnel)")}</span></Label>
                  <Input id="pw-occasion" placeholder={t("Birthday, team building…", "Anniversaire, team building…")} {...register("occasion")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pw-participants">{t("Number of participants", "Nombre de participants")} <span className="text-destructive">*</span></Label>
                  <Input id="pw-participants" {...register("participants")} />
                  {errors.participants && <p className="text-sm text-destructive">{fe(errors.participants.message)}</p>}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pw-date">{t("Preferred date", "Date souhaitée")} <span className="text-muted-foreground">{t("(optional)", "(optionnel)")}</span></Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      id="pw-date"
                      type="button"
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal rounded-none",
                        !preferredDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {preferredDate ? format(preferredDate, "dd.MM.yyyy") : t("Select a date", "Sélectionner une date")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={preferredDate}
                      onSelect={(date) => setValue("preferredDate", date ?? undefined, { shouldValidate: true })}
                      // Workshop-specific: minimum 4 calendar days out (Europe/
                      // Zurich, recomputed on every render — never a fixed
                      // date), no express-style shortcut. calendarDaysUntil()
                      // is the same Zurich-day-difference helper the cake
                      // calendar uses, just compared to a different, longer
                      // minimum — the cake 2-day rule itself is untouched.
                      disabled={(date) => calendarDaysUntil(date) < WORKSHOP_MIN_LEAD_DAYS}
                      initialFocus
                      className="p-3 pointer-events-auto"
                    />
                    {preferredDate && (
                      <div className="p-2 pt-0">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="w-full"
                          onClick={() => setValue("preferredDate", undefined, { shouldValidate: true })}
                        >
                          {t("Clear date", "Effacer la date")}
                        </Button>
                      </div>
                    )}
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pw-message">{t("Tell us about your event", "Parlez-nous de votre événement")} <span className="text-destructive">*</span></Label>
                <Textarea id="pw-message" rows={4} {...register("message")} />
                {errors.message && <p className="text-sm text-destructive">{fe(errors.message.message)}</p>}
              </div>
              <Button type="submit" disabled={isSubmitting} className="w-full bg-primary hover:bg-primary/90 text-primary-foreground py-2.5 text-[13px] font-medium uppercase tracking-[0.105em] rounded-none">
                {isSubmitting ? t("Sending…", "Envoi…") : t("Send my enquiry", "Envoyer ma demande")}
              </Button>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default PrivateWorkshopDialog;
