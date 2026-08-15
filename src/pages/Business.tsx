import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { Check, CalendarIcon, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { submitToWeb3Forms } from "@/lib/web3forms";
import { useLang } from "@/context/LanguageContext";
import { useFieldError } from "@/lib/formErrors";

import cardCelebrations from "@/assets/corporate-event-5.png";
import cardEvents from "@/assets/corporate-event-8.png";
import cardHospitality from "@/assets/corporate-event-11.png";

const phoneRegex = /^[+\d][\d\s().\-/]{6,}$/;

/* ─────────────────────────  Shared UI bits  ───────────────────────── */

const RequiredMark = () => <span className="text-destructive">*</span>;

const SuccessPanel = ({ message }: { message: string }) => {
  const { t } = useLang();
  const fe = useFieldError();
  return (
  <div className="text-center py-10">
    <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
      <span className="text-3xl text-primary">✓</span>
    </div>
    <h3 className="font-sans uppercase tracking-[0.105em] text-xl font-semibold text-foreground mb-3">
      {t("Thank you", "Merci")}
    </h3>
    <p className="text-muted-foreground leading-relaxed max-w-md mx-auto">{message}</p>
  </div>
  );
};

const InfoList = ({ items }: { items: string[] }) => (
  <ul className="space-y-2.5">
    {items.map((item) => (
      <li key={item} className="flex items-start gap-2.5 text-sm text-foreground/90">
        <Check className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" strokeWidth={2} />
        <span>{item}</span>
      </li>
    ))}
  </ul>
);

/* ─────────────────────────  1. CELEBRATIONS  ───────────────────────── */

const celebrationsSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(100),
  lastName: z.string().trim().min(1, "Last name is required").max(100),
  phone: z.string().trim().regex(phoneRegex, "Please enter a valid phone number"),
  email: z.string().trim().email("Please enter a valid email address").max(255),
  companyName: z.string().trim().min(1, "Company name is required").max(200),
  numberOfEmployees: z.string().trim().min(1, "Number of employees is required").max(50),
  lookingFor: z.string().trim().min(1, "This field is required").max(2000),
});
type CelebrationsData = z.infer<typeof celebrationsSchema>;

const CelebrationsForm = ({ onSuccess }: { onSuccess: () => void }) => {
  const { t } = useLang();
  const fe = useFieldError();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CelebrationsData>({ resolver: zodResolver(celebrationsSchema) });

  const onSubmit = async (data: CelebrationsData) => {
    try {
      await submitToWeb3Forms(
        {
          "First name": data.firstName,
          "Last name": data.lastName,
          "Phone number": data.phone,
          "Email address": data.email,
          "Company name": data.companyName,
          "Number of employees": data.numberOfEmployees,
          "Looking for": data.lookingFor,
        },
        { subject: "Corporate Celebrations enquiry, Bento Cake Studio" }
      );
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("Something went wrong. Please try again.", "Une erreur s'est produite. Veuillez réessayer."));
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-2 text-left">
      <p className="text-sm text-muted-foreground leading-relaxed">
        {t("Interested in working with us or want to learn more? Fill out the form below and we'll get back to you with more information.", "Envie de travailler avec nous ou d'en savoir plus ? Remplissez le formulaire ci-dessous et nous reviendrons vers vous avec plus d'informations.")}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="cc-firstName">{t("First name", "Prénom")} <RequiredMark /></Label>
          <Input id="cc-firstName" {...register("firstName")} />
          {errors.firstName && <p className="text-sm text-destructive">{fe(errors.firstName.message)}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cc-lastName">{t("Last name", "Nom")} <RequiredMark /></Label>
          <Input id="cc-lastName" {...register("lastName")} />
          {errors.lastName && <p className="text-sm text-destructive">{fe(errors.lastName.message)}</p>}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="cc-phone">{t("Phone number", "Numéro de téléphone")} <RequiredMark /></Label>
          <Input id="cc-phone" type="tel" {...register("phone")} />
          {errors.phone && <p className="text-sm text-destructive">{fe(errors.phone.message)}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cc-email">{t("Email address", "Adresse e-mail")} <RequiredMark /></Label>
          <Input id="cc-email" type="email" {...register("email")} />
          {errors.email && <p className="text-sm text-destructive">{fe(errors.email.message)}</p>}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="cc-company">{t("Company name", "Nom de l'entreprise")} <RequiredMark /></Label>
          <Input id="cc-company" {...register("companyName")} />
          {errors.companyName && <p className="text-sm text-destructive">{fe(errors.companyName.message)}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cc-employees">{t("Number of employees", "Nombre d'employés")}</Label>
          <Input id="cc-employees" {...register("numberOfEmployees")} />
          {errors.numberOfEmployees && (
            <p className="text-sm text-destructive">{fe(errors.numberOfEmployees.message)}</p>
          )}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="cc-looking">{t("Tell us what you are looking for", "Dites-nous ce que vous recherchez")} <RequiredMark /></Label>
        <Textarea id="cc-looking" rows={4} {...register("lookingFor")} />
        {errors.lookingFor && <p className="text-sm text-destructive">{fe(errors.lookingFor.message)}</p>}
      </div>
      <Button
        type="submit"
        disabled={isSubmitting}
        className="w-full bg-primary hover:bg-primary/90 text-primary-foreground py-6 text-[13px] font-medium uppercase tracking-[0.105em] rounded-none"
      >
        {isSubmitting ? t("Sending…", "Envoi…") : t("Send my enquiry", "Envoyer ma demande")}
      </Button>
    </form>
  );
};

/* ─────────────────────────  2. CORPORATE EVENTS  ───────────────────── */

const eventsSchema = z.object({
  fullName: z.string().trim().min(1, "Name is required").max(150),
  companyAgency: z.string().trim().max(200).optional(),
  email: z.string().trim().email("Please enter a valid email address").max(255),
  phone: z.string().trim().regex(phoneRegex, "Please enter a valid phone number"),
  eventDate: z.date({ required_error: "Please select a date" }),
  estimatedGuests: z.string().trim().min(1, "Estimated number of guests is required").max(50),
  projectDescription: z.string().trim().min(1, "Please tell us about your project").max(3000),
});
type EventsData = z.infer<typeof eventsSchema>;

const EventsForm = ({ onSuccess }: { onSuccess: () => void }) => {
  const { t } = useLang();
  const fe = useFieldError();
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<EventsData>({ resolver: zodResolver(eventsSchema) });

  const eventDate = watch("eventDate");

  const onSubmit = async (data: EventsData) => {
    try {
      await submitToWeb3Forms(
        {
          "First and last name": data.fullName,
          "Company / Agency": data.companyAgency || "(not provided)",
          "Email address": data.email,
          "Phone number": data.phone,
          "Event date": format(data.eventDate, "dd.MM.yyyy"),
          "Estimated number of guests": data.estimatedGuests,
          "Project description": data.projectDescription,
        },
        { subject: "Event Quote Request, Bento Cake Studio", files }
      );
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("Something went wrong. Please try again.", "Une erreur s'est produite. Veuillez réessayer."));
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-2 text-left">
      <div className="space-y-1.5">
        <Label htmlFor="ev-name">{t("First and last name", "Prénom et nom")} <RequiredMark /></Label>
        <Input id="ev-name" {...register("fullName")} />
        {errors.fullName && <p className="text-sm text-destructive">{fe(errors.fullName.message)}</p>}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ev-company">{t("Company / Agency", "Société / Agence")} <span className="text-muted-foreground">{t("(optional)", "(optionnel)")}</span></Label>
        <Input id="ev-company" {...register("companyAgency")} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="ev-email">{t("Email address", "Adresse e-mail")} <RequiredMark /></Label>
          <Input id="ev-email" type="email" {...register("email")} />
          {errors.email && <p className="text-sm text-destructive">{fe(errors.email.message)}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ev-phone">{t("Phone number", "Numéro de téléphone")} <RequiredMark /></Label>
          <Input id="ev-phone" type="tel" {...register("phone")} />
          {errors.phone && <p className="text-sm text-destructive">{fe(errors.phone.message)}</p>}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>{t("Event date", "Date de l'événement")} <RequiredMark /></Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className={cn(
                  "w-full justify-start text-left font-normal rounded-none",
                  !eventDate && "text-muted-foreground"
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {eventDate ? format(eventDate, "dd.MM.yyyy") : t("Select a date", "Sélectionner une date")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={eventDate}
                onSelect={(date) => date && setValue("eventDate", date, { shouldValidate: true })}
                disabled={(date) => date < new Date()}
                initialFocus
                className="p-3 pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
          {errors.eventDate && <p className="text-sm text-destructive">{fe(errors.eventDate.message)}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ev-guests">{t("Estimated number of guests", "Nombre d'invités estimé")} <RequiredMark /></Label>
          <Input id="ev-guests" {...register("estimatedGuests")} />
          {errors.estimatedGuests && (
            <p className="text-sm text-destructive">{fe(errors.estimatedGuests.message)}</p>
          )}
        </div>
      </div>

      {/* Description */}
      <div className="space-y-1.5">
        <Label htmlFor="ev-desc">{t("Tell us about your project", "Parlez-nous de votre projet")} <RequiredMark /></Label>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {t("Describe what you have in mind for your event and what you may need. To help us prepare a suitable proposal, you can include:", "Décrivez ce que vous imaginez pour votre événement et ce dont vous pourriez avoir besoin. Pour nous aider à préparer une proposition adaptée, vous pouvez inclure :")}
        </p>
        <ul className="text-xs text-muted-foreground list-disc pl-5 space-y-0.5">
          <li>{t("the type of event", "le type d'événement")}</li>
          <li>{t("the products and quantities you are considering", "les produits et quantités que vous envisagez")}</li>
          <li>{t("your preferred style, colours or theme", "votre style, couleurs ou thème préférés")}</li>
          <li>{t("any logo, edible print, wording or specific detail you would like to add", "tout logo, impression comestible, texte ou détail spécifique que vous souhaitez ajouter")}</li>
          <li>{t("your approximate budget", "votre budget approximatif")}</li>
          <li>{t("whether delivery is required", "si une livraison est nécessaire")}</li>
        </ul>
        <Textarea id="ev-desc" rows={5} {...register("projectDescription")} />
        {errors.projectDescription && (
          <p className="text-sm text-destructive">{fe(errors.projectDescription.message)}</p>
        )}
      </div>

      {/* Upload */}
      <div className="space-y-2">
        <Label>{t("Add your inspiration", "Ajoutez votre inspiration")} <span className="text-muted-foreground">{t("(optional)", "(optionnel)")}</span></Label>
        <p className="text-xs text-muted-foreground">
          {t("You can upload photos, a moodboard, a logo or any other useful visual references.", "Vous pouvez télécharger des photos, un moodboard, un logo ou toute autre référence visuelle utile.")}
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            const picked = Array.from(e.target.files || []);
            setFiles((prev) => [...prev, ...picked].slice(0, 6));
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="w-full border-2 border-dashed border-border p-6 flex flex-col items-center gap-2 hover:border-primary/50 transition-colors"
        >
          <Upload className="w-5 h-5 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">{t("Upload one or several files", "Téléchargez un ou plusieurs fichiers")}</span>
        </button>
        {files.length > 0 && (
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {files.map((file, i) => (
              <div key={i} className="relative aspect-square border border-border bg-muted/20 flex items-center justify-center overflow-hidden">
                {file.type.startsWith("image/") ? (
                  <img src={URL.createObjectURL(file)} alt={file.name} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-[9px] text-muted-foreground px-1 text-center break-all">{file.name}</span>
                )}
                <button
                  type="button"
                  onClick={() => setFiles(files.filter((_, idx) => idx !== i))}
                  className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-none p-0.5 hover:bg-destructive/80"
                  aria-label={t("Remove file", "Supprimer le fichier")}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <Button
        type="submit"
        disabled={isSubmitting}
        className="w-full bg-primary hover:bg-primary/90 text-primary-foreground py-6 text-[13px] font-medium uppercase tracking-[0.105em] rounded-none"
      >
        {isSubmitting ? t("Sending…", "Envoi…") : t("Send my enquiry", "Envoyer ma demande")}
      </Button>
    </form>
  );
};

/* ─────────────────────────  3. HOSPITALITY PARTNERS  ───────────────── */

const hospitalitySchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(100),
  lastName: z.string().trim().min(1, "Last name is required").max(100),
  phone: z.string().trim().regex(phoneRegex, "Please enter a valid phone number"),
  email: z.string().trim().email("Please enter a valid email address").max(255),
  establishmentName: z.string().trim().min(1, "Establishment name is required").max(200),
  lookingFor: z.string().trim().min(1, "This field is required").max(2000),
});
type HospitalityData = z.infer<typeof hospitalitySchema>;

const HospitalityForm = ({ onSuccess }: { onSuccess: () => void }) => {
  const { t } = useLang();
  const fe = useFieldError();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<HospitalityData>({ resolver: zodResolver(hospitalitySchema) });

  const onSubmit = async (data: HospitalityData) => {
    try {
      await submitToWeb3Forms(
        {
          "First name": data.firstName,
          "Last name": data.lastName,
          "Phone number": data.phone,
          "Email address": data.email,
          "Establishment name": data.establishmentName,
          "Looking for": data.lookingFor,
        },
        { subject: "Hospitality Partners enquiry, Bento Cake Studio" }
      );
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("Something went wrong. Please try again.", "Une erreur s'est produite. Veuillez réessayer."));
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-2 text-left">
      <p className="text-sm text-muted-foreground leading-relaxed">
        {t("Interested in offering Bento Cake Studio cakes to your clients? Tell us more about your establishment and what you are looking for. We will get back to you with our partner offer and pricing.", "Vous souhaitez proposer les gâteaux Bento Cake Studio à vos clients ? Parlez-nous de votre établissement et de ce que vous recherchez. Nous reviendrons vers vous avec notre offre partenaire et nos tarifs.")}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="hp-firstName">{t("First name", "Prénom")} <RequiredMark /></Label>
          <Input id="hp-firstName" {...register("firstName")} />
          {errors.firstName && <p className="text-sm text-destructive">{fe(errors.firstName.message)}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hp-lastName">{t("Last name", "Nom")} <RequiredMark /></Label>
          <Input id="hp-lastName" {...register("lastName")} />
          {errors.lastName && <p className="text-sm text-destructive">{fe(errors.lastName.message)}</p>}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="hp-phone">{t("Phone number", "Numéro de téléphone")} <RequiredMark /></Label>
          <Input id="hp-phone" type="tel" {...register("phone")} />
          {errors.phone && <p className="text-sm text-destructive">{fe(errors.phone.message)}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hp-email">{t("Email address", "Adresse e-mail")} <RequiredMark /></Label>
          <Input id="hp-email" type="email" {...register("email")} />
          {errors.email && <p className="text-sm text-destructive">{fe(errors.email.message)}</p>}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="hp-establishment">{t("Establishment name", "Nom de l'établissement")} <RequiredMark /></Label>
        <Input id="hp-establishment" {...register("establishmentName")} />
        {errors.establishmentName && (
          <p className="text-sm text-destructive">{fe(errors.establishmentName.message)}</p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="hp-looking">{t("Tell us what you are looking for", "Dites-nous ce que vous recherchez")} <RequiredMark /></Label>
        <Textarea id="hp-looking" rows={4} {...register("lookingFor")} />
        {errors.lookingFor && <p className="text-sm text-destructive">{fe(errors.lookingFor.message)}</p>}
      </div>
      <Button
        type="submit"
        disabled={isSubmitting}
        className="w-full bg-primary hover:bg-primary/90 text-primary-foreground py-6 text-[13px] font-medium uppercase tracking-[0.105em] rounded-none"
      >
        {isSubmitting ? t("Sending…", "Envoi…") : t("Send my enquiry", "Envoyer ma demande")}
      </Button>
    </form>
  );
};

/* ─────────────────────────  CARD DATA  ─────────────────────────────── */

type CategoryId = "celebrations" | "events" | "hospitality";

const cards: {
  id: CategoryId;
  title: string;
  titleFr: string;
  subtitle: string;
  subtitleFr: string;
  checks: string[];
  checksFr: string[];
  cta: string;
  ctaFr: string;
  image: string;
}[] = [
  {
    id: "celebrations",
    title: "Corporate Celebrations",
    titleFr: "Célébrations d'entreprise",
    subtitle: "Make every employee birthday one to remember.",
    subtitleFr: "Faites de chaque anniversaire de vos employés un moment mémorable.",
    checks: [
      "Share your calendar with us once",
      "Design and flavour selected by Bento Cake Studio",
      "Production and delivery included",
      "One-month trial with no commitment",
    ],
    checksFr: [
      "Partagez votre calendrier avec nous une seule fois",
      "Design et parfum sélectionnés par Bento Cake Studio",
      "Production et livraison incluses",
      "Essai d'un mois sans engagement",
    ],
    cta: "Discover",
    ctaFr: "Découvrir",
    image: cardCelebrations,
  },
  {
    id: "events",
    title: "Corporate Events",
    titleFr: "Événements d'entreprise",
    subtitle: "Bespoke creations designed to elevate your event.",
    subtitleFr: "Des créations sur mesure conçues pour sublimer votre événement.",
    checks: [
      "Custom cakes",
      "Brand logos and colours",
      "Individual formats or large quantities",
      "Delivery and set-up available",
    ],
    checksFr: [
      "Gâteaux personnalisés",
      "Logos et couleurs de marque",
      "Formats individuels ou grandes quantités",
      "Livraison et installation disponibles",
    ],
    cta: "Discover",
    ctaFr: "Découvrir",
    image: cardEvents,
  },
  {
    id: "hospitality",
    title: "Hospitality Partners",
    titleFr: "Partenaires professionnels",
    subtitle: "Custom cakes for your clients' birthdays and celebrations.",
    subtitleFr: "Des gâteaux personnalisés pour les anniversaires et célébrations de vos clients.",
    checks: [
      "Designed for bars, restaurants, hotels and event venues",
      "Simple selection and ordering process",
      "Professional partner pricing",
      "Opportunity to earn a margin",
    ],
    checksFr: [
      "Conçu pour les bars, restaurants, hôtels et lieux d'événements",
      "Processus de sélection et de commande simple",
      "Tarifs partenaires professionnels",
      "Possibilité de réaliser une marge",
    ],
    cta: "Discover",
    ctaFr: "Découvrir",
    image: cardHospitality,
  },
];

/* ─────────────────────────  PAGE  ──────────────────────────────────── */

type View = "info" | "form" | "done";

const Business = () => {
  const { t } = useLang();
  const fe = useFieldError();
  const [openId, setOpenId] = useState<CategoryId | null>(null);
  // Celebrations & Hospitality start on "info"; Events opens straight to "form".
  const [view, setView] = useState<View>("info");

  useEffect(() => {
    document.title = t("Partnerships & Press – Bento Cake Studio", "Partenariats & Presse – Bento Cake Studio");
    return () => {
      document.title = "Bento Cake Studio Geneva";
    };
  }, []);

  const openCategory = (id: CategoryId) => {
    setView("info");
    setOpenId(id);
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setOpenId(null);
      // reset after the close animation
      setTimeout(() => setView("info"), 250);
    }
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-16">
        <h1 className="font-sans text-4xl md:text-5xl text-center tracking-[0.105em] uppercase text-foreground mb-4">
          {t("Partnership", "Partenariat")}
        </h1>
        <p className="text-center text-muted-foreground mb-16 max-w-2xl mx-auto">
          {t("Bespoke cakes for corporate celebrations, events and hospitality partners.", "Des créations sur mesure pour vos équipes, vos événements et votre établissement.")}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto items-stretch">
          {cards.map((card) => (
            <div
              key={card.id}
              className="flex flex-col h-full border border-border/60 bg-card overflow-hidden hover:border-foreground/25 transition-colors duration-300"
            >
              <div className="aspect-[4/3] overflow-hidden bg-muted/30">
                <img
                  src={card.image}
                  alt={t(card.title, card.titleFr)}
                  className="w-full h-full object-cover hover:scale-105 transition-transform duration-300"
                />
              </div>
              <div className="flex flex-col flex-1 p-6">
                <h2 className="font-sans text-[15px] tracking-[0.105em] font-semibold uppercase text-foreground mb-2">
                  {t(card.title, card.titleFr)}
                </h2>
                <p className="text-sm text-muted-foreground mb-5">{t(card.subtitle, card.subtitleFr)}</p>
                <ul className="space-y-2.5 mb-6">
                  {card.checks.map((check, i) => (
                    <li key={check} className="flex items-start gap-2.5 text-sm text-foreground/90">
                      <Check className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" strokeWidth={2} />
                      <span>{t(check, card.checksFr[i])}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-auto">
                  <Button
                    onClick={() => openCategory(card.id)}
                    className="w-full bg-primary hover:bg-primary/90 text-primary-foreground py-6 text-[13px] font-medium uppercase tracking-[0.105em] rounded-none"
                  >
                    {t(card.cta, card.ctaFr)}
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ───────── Corporate Celebrations dialog ───────── */}
      <Dialog open={openId === "celebrations"} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          {view === "done" ? (
            <SuccessPanel message={t("Thank you for your enquiry. We will get back to you with a personalised proposal based on your company's needs.", "Merci pour votre demande. Nous reviendrons vers vous avec une proposition personnalisée adaptée aux besoins de votre entreprise.")} />
          ) : view === "form" ? (
            <>
              <DialogHeader>
                <DialogTitle className="font-sans uppercase tracking-[0.105em] text-xl text-foreground">
                  {t("Corporate Celebrations", "Célébrations d'entreprise")}
                </DialogTitle>
              </DialogHeader>
              <CelebrationsForm onSuccess={() => setView("done")} />
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="font-sans uppercase tracking-[0.105em] text-xl text-foreground">
                  {t("Corporate Celebrations", "Célébrations d'entreprise")}
                </DialogTitle>
                <DialogDescription className="text-muted-foreground leading-relaxed pt-1">
                  {t("Share your team's birthday calendar once, and we take care of the rest.", "Partagez une seule fois le calendrier des anniversaires de votre équipe, nous nous occupons du reste.")}
                </DialogDescription>
              </DialogHeader>
              <div className="pt-2">
                <InfoList
                  items={[
                    t("Send us your employee birthday calendar once", "Envoyez-nous une fois le calendrier des anniversaires de vos employés"),
                    t("We plan each celebration in advance", "Nous planifions chaque célébration à l'avance"),
                    t("We choose the cake design and flavour", "Nous choisissons le design et le parfum du gâteau"),
                    t("Available in vanilla or chocolate", "Disponible en vanille ou chocolat"),
                    t("We personalise, prepare and deliver every cake", "Nous personnalisons, préparons et livrons chaque gâteau"),
                    t("Dietary requirements can be shared in advance", "Les régimes particuliers peuvent être communiqués à l'avance"),
                    t("Start with a one-month trial", "Commencez par un essai d'un mois"),
                    t("Continue with a 12-month programme and prepaid celebration budget", "Poursuivez avec un programme de 12 mois et un budget de célébration prépayé"),
                  ]}
                />
                <Button
                  onClick={() => setView("form")}
                  className="w-full mt-6 bg-primary hover:bg-primary/90 text-primary-foreground py-6 text-[13px] font-medium uppercase tracking-[0.105em] rounded-none"
                >
                  {t("Complete the Form", "Remplir le formulaire")}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ───────── Corporate Events dialog ───────── */}
      <Dialog open={openId === "events"} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          {view === "done" ? (
            <SuccessPanel message={t("Thank you for your enquiry. We will get back to you with a personalised proposal based on your requirements, our availability and the feasibility of the project.", "Merci pour votre demande. Nous reviendrons vers vous avec une proposition personnalisée selon vos besoins, nos disponibilités et la faisabilité du projet.")} />
          ) : view === "form" ? (
            <>
              <DialogHeader>
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{t("Events", "Événements")}</p>
                <DialogTitle className="font-sans uppercase tracking-[0.105em] text-xl text-foreground">
                  {t("Event Quote Request", "Demande de devis")}
                </DialogTitle>
              </DialogHeader>
              <EventsForm onSuccess={() => setView("done")} />
            </>
          ) : (
            <>
              <DialogHeader>
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{t("Events", "Événements")}</p>
                <DialogTitle className="font-sans uppercase tracking-[0.105em] text-xl text-foreground">
                  {t("Event Quote Request", "Demande de devis")}
                </DialogTitle>
              </DialogHeader>
              <div className="pt-2">
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {t("Planning an event and looking for a personalised proposal? Tell us about your idea, even if it is not yet fully defined. The more information you share about your needs, inspiration and budget, the better we can tailor our proposal to your event.", "Vous organisez un événement et recherchez une proposition personnalisée ? Parlez-nous de votre idée, même si elle n'est pas encore entièrement définie. Plus vous partagez d'informations sur vos besoins, votre inspiration et votre budget, mieux nous pourrons adapter notre proposition à votre événement.")}
                </p>
                <Button
                  onClick={() => setView("form")}
                  className="w-full mt-6 bg-primary hover:bg-primary/90 text-primary-foreground py-6 text-[13px] font-medium uppercase tracking-[0.105em] rounded-none"
                >
                  {t("Request a Quote", "Demander un devis")}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ───────── Hospitality Partners dialog ───────── */}
      <Dialog open={openId === "hospitality"} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          {view === "done" ? (
            <SuccessPanel message={t("Thank you for your enquiry. We will get back to you with more information about our partner offer, pricing and ordering process.", "Merci pour votre demande. Nous reviendrons vers vous avec plus d'informations sur notre offre partenaire, nos tarifs et le processus de commande.")} />
          ) : view === "form" ? (
            <>
              <DialogHeader>
                <DialogTitle className="font-sans uppercase tracking-[0.105em] text-xl text-foreground">
                  {t("Hospitality Partners", "Partenaires professionnels")}
                </DialogTitle>
              </DialogHeader>
              <HospitalityForm onSuccess={() => setView("done")} />
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="font-sans uppercase tracking-[0.105em] text-xl text-foreground">
                  {t("Hospitality Partners", "Partenaires professionnels")}
                </DialogTitle>
                <DialogDescription className="text-muted-foreground leading-relaxed pt-1">
                  {t("Offer personalised cakes to your clients through a simple partner programme. We supply selected cakes at a professional partner price. Each establishment remains free to choose its final resale price and set its own margin.", "Proposez à vos clients des gâteaux personnalisés grâce à un programme partenaire simple. Nous fournissons une sélection de gâteaux à un tarif partenaire professionnel. Chaque établissement reste libre de fixer son prix de revente final et sa propre marge.")}
                </DialogDescription>
              </DialogHeader>
              <div className="pt-2 space-y-5">
                <div>
                  <h4 className="font-sans text-[13px] uppercase tracking-[0.105em] font-semibold text-foreground mb-3">
                    {t("How it works", "Comment ça fonctionne")}
                  </h4>
                  <InfoList
                    items={[
                      t("Available for restaurants, hotels, bars and event venues", "Disponible pour les restaurants, hôtels, bars et lieux d'événements"),
                      t("Cakes are supplied at a professional partner price", "Les gâteaux sont fournis à un tarif partenaire professionnel"),
                      t("The establishment chooses its own resale price", "L'établissement fixe son propre prix de revente"),
                      t("Only round cakes are available through the partner selection", "Seuls les gâteaux ronds sont disponibles via la sélection partenaire"),
                      t("Any additional or fully bespoke personalisation must be ordered directly from Bento Cake Studio", "Toute personnalisation supplémentaire ou entièrement sur mesure doit être commandée directement auprès de Bento Cake Studio"),
                    ]}
                  />
                </div>
                <div>
                  <h4 className="font-sans text-[13px] uppercase tracking-[0.105em] font-semibold text-foreground mb-3">
                    {t("Your clients can choose", "Vos clients peuvent choisir")}
                  </h4>
                  <InfoList
                    items={[
                      t("Cake size", "Taille du gâteau"),
                      t("Flavour", "Parfum"),
                      t("Design from the partner selection", "Design de la sélection partenaire"),
                      t("Base colour", "Couleur de base"),
                      t("Text", "Texte"),
                      t("Text colour", "Couleur du texte"),
                      t("Decoration colour", "Couleur de la décoration"),
                    ]}
                  />
                </div>
                <Button
                  onClick={() => setView("form")}
                  className="w-full bg-primary hover:bg-primary/90 text-primary-foreground py-6 text-[13px] font-medium uppercase tracking-[0.105em] rounded-none"
                >
                  {t("Complete the Form", "Remplir le formulaire")}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Layout>
  );
};

export default Business;
