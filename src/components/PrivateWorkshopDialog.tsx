import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { submitToWeb3Forms } from "@/lib/web3forms";
import { useLang } from "@/context/LanguageContext";
import { useFieldError } from "@/lib/formErrors";

// Extracted verbatim from Workshop.tsx so the same quote-request flow can be
// reused elsewhere (e.g. the "larger group" case in the workshop booking
// stepper). Behaviour is unchanged.

const pwPhoneRegex = /^[+\d][\d\s().\-/]{6,}$/;

const privateSchema = z.object({
  fullName: z.string().trim().min(1, "Name is required").max(150),
  email: z.string().trim().email("Please enter a valid email address").max(255),
  phone: z.string().trim().regex(pwPhoneRegex, "Please enter a valid phone number"),
  occasion: z.string().trim().max(150).optional(),
  participants: z.string().trim().min(1, "Number of participants is required").max(50),
  preferredDate: z.string().trim().max(100).optional(),
  message: z.string().trim().min(1, "Please tell us about your event").max(2000),
});
type PrivateData = z.infer<typeof privateSchema>;

export const PrivateWorkshopDialog = ({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) => {
  const { t } = useLang();
  const fe = useFieldError();
  const [submitted, setSubmitted] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PrivateData>({ resolver: zodResolver(privateSchema) });

  const handleClose = (v: boolean) => {
    if (!v) setTimeout(() => { setSubmitted(false); reset(); }, 250);
    onOpenChange(v);
  };

  const onSubmit = async (data: PrivateData) => {
    try {
      await submitToWeb3Forms(
        {
          "First and last name": data.fullName,
          "Email address": data.email,
          "Phone number": data.phone,
          "Occasion": data.occasion || "(not provided)",
          "Number of participants": data.participants,
          "Preferred date": data.preferredDate || "(not provided)",
          "Message": data.message,
        },
        { subject: "Private Workshop enquiry, Bento Cake Studio" }
      );
      setSubmitted(true);
    } catch (err) {
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
              <div className="space-y-1.5">
                <Label htmlFor="pw-name">{t("First and last name", "Prénom et nom")} <span className="text-destructive">*</span></Label>
                <Input id="pw-name" {...register("fullName")} />
                {errors.fullName && <p className="text-sm text-destructive">{fe(errors.fullName.message)}</p>}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="pw-email">{t("Email address", "Adresse e-mail")} <span className="text-destructive">*</span></Label>
                  <Input id="pw-email" type="email" {...register("email")} />
                  {errors.email && <p className="text-sm text-destructive">{fe(errors.email.message)}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pw-phone">{t("Phone number", "Numéro de téléphone")} <span className="text-destructive">*</span></Label>
                  <Input id="pw-phone" type="tel" {...register("phone")} />
                  {errors.phone && <p className="text-sm text-destructive">{fe(errors.phone.message)}</p>}
                </div>
              </div>
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
                <Input id="pw-date" placeholder={t("e.g. mid-March, a weekend…", "ex. mi-mars, un week-end…")} {...register("preferredDate")} />
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
