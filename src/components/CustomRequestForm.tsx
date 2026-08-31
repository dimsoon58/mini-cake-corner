import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { CalendarIcon, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useLang } from "@/context/LanguageContext";
import { useFieldError } from "@/lib/formErrors";

const requestSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(100),
  lastName: z.string().trim().min(1, "Last name is required").max(100),
  email: z.string().trim().email("Please enter a valid email address").max(255),
  phone: z
    .string()
    .trim()
    .min(1, "Phone number is required")
    .regex(/^[+\d][\d\s().\-/]{6,}$/, "Please enter a valid phone number"),
  eventDate: z.date({ required_error: "Please select a date" }),
  numberOfGuests: z
    .number({ required_error: "Please enter the number of guests" })
    .int()
    .min(1, "Minimum 1 guest")
    .max(100, "Maximum 100 guests"),
  description: z
    .string()
    .trim()
    .min(1, "Please describe your dream cake")
    .max(3000),
});

type RequestFormData = z.infer<typeof requestSchema>;

const CustomRequestForm = () => {
  const { t } = useLang();
  const fe = useFieldError();
  const [submitted, setSubmitted] = useState(false);
  const [photos, setPhotos] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<RequestFormData>({
    resolver: zodResolver(requestSchema),
    defaultValues: { numberOfGuests: 1 },
  });

  const eventDate = watch("eventDate");
  const numberOfGuests = watch("numberOfGuests") ?? 1;
  const guestsRaw = watch("numberOfGuests");

  const changeGuests = (delta: number) => {
    const next = Math.min(100, Math.max(1, numberOfGuests + delta));
    setValue("numberOfGuests", next, { shouldValidate: true });
  };

  const onSubmit = (_data: RequestFormData) => {
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="text-center max-w-xl mx-auto py-14">
        <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
          <span className="text-3xl text-primary">✓</span>
        </div>
        <h3 className="font-sans uppercase tracking-[0.105em] text-2xl font-semibold text-foreground mb-4">
          {t("THANK YOU!", "MERCI !")}
        </h3>
        <p className="text-muted-foreground leading-relaxed">
          {t(
            "We've received your request and will get back to you within 24 hours with availability and a personalised quote.",
            "Nous avons bien reçu votre demande et nous reviendrons vers vous sous 24 heures avec nos disponibilités et un devis personnalisé."
          )}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="max-w-2xl mx-auto space-y-5 text-left">
      {/* Name row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="cr-firstName">
            {t("First Name", "Prénom")} <span className="text-destructive">*</span>
          </Label>
          <Input id="cr-firstName" {...register("firstName")} />
          {errors.firstName && <p className="text-sm text-destructive">{fe(errors.firstName.message)}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cr-lastName">
            {t("Last Name", "Nom")} <span className="text-destructive">*</span>
          </Label>
          <Input id="cr-lastName" {...register("lastName")} />
          {errors.lastName && <p className="text-sm text-destructive">{fe(errors.lastName.message)}</p>}
        </div>
      </div>

      {/* Contact row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="cr-email">
            {t("Email", "E-mail")} <span className="text-destructive">*</span>
          </Label>
          <Input id="cr-email" type="email" {...register("email")} />
          {errors.email && <p className="text-sm text-destructive">{fe(errors.email.message)}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cr-phone">
            {t("Phone Number", "Numéro de téléphone")} <span className="text-destructive">*</span>
          </Label>
          <Input id="cr-phone" type="tel" {...register("phone")} />
          {errors.phone && <p className="text-sm text-destructive">{fe(errors.phone.message)}</p>}
        </div>
      </div>

      {/* Date */}
      <div className="space-y-1.5">
        <Label>
          {t("Event / Pick-up Date", "Date de l'événement / retrait")} <span className="text-destructive">*</span>
        </Label>
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
              {eventDate ? format(eventDate, "dd.MM.yyyy") : t("Select a date", "Choisir une date")}
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

      {/* Number of Guests */}
      <div className="space-y-1.5">
        <Label>
          {t("Number of Guests", "Nombre d'invités")} <span className="text-destructive">*</span>
        </Label>
        <div className="flex items-center">
          <button
            type="button"
            onClick={() => changeGuests(-1)}
            disabled={numberOfGuests <= 1}
            className="h-10 w-12 flex items-center justify-center border border-input bg-background text-lg leading-none text-foreground transition-colors hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label={t("Decrease number of guests", "Diminuer le nombre d'invités")}
          >
            −
          </button>
          <input
            type="text"
            inputMode="numeric"
            value={guestsRaw ?? ""}
            onChange={(e) => {
              const digits = e.target.value.replace(/[^0-9]/g, "");
              if (digits === "") {
                setValue("numberOfGuests", undefined as unknown as number, { shouldValidate: false });
                return;
              }
              const n = Math.min(100, parseInt(digits, 10));
              setValue("numberOfGuests", n, { shouldValidate: true });
            }}
            onBlur={() => {
              const v = watch("numberOfGuests");
              if (v === undefined || Number.isNaN(v) || v < 1) {
                setValue("numberOfGuests", 1, { shouldValidate: true });
              }
            }}
            className="h-10 w-16 text-center border-y border-input bg-background text-sm font-medium text-foreground focus:outline-none"
            aria-label={t("Number of guests", "Nombre d'invités")}
          />
          <button
            type="button"
            onClick={() => changeGuests(1)}
            disabled={numberOfGuests >= 100}
            className="h-10 w-12 flex items-center justify-center border border-input bg-background text-lg leading-none text-foreground transition-colors hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label={t("Increase number of guests", "Augmenter le nombre d'invités")}
          >
            +
          </button>
        </div>
        {errors.numberOfGuests && (
          <p className="text-sm text-destructive">{fe(errors.numberOfGuests.message)}</p>
        )}
      </div>

      {/* Description */}
      <div className="space-y-1.5">
        <Label htmlFor="cr-description">
          {t("Design Description", "Description du design")} <span className="text-destructive">*</span>
        </Label>
        <Textarea
          id="cr-description"
          rows={6}
          placeholder={t(
            "Describe your dream cake: design, colours, theme, decorations, message to write on the cake, flavours and any other important details...",
            "Décrivez le gâteau de vos rêves : design, couleurs, thème, décorations, message à inscrire sur le gâteau, saveurs et tout autre détail important..."
          )}
          {...register("description")}
        />
        {errors.description && <p className="text-sm text-destructive">{fe(errors.description.message)}</p>}
      </div>

      {/* Photo upload */}
      <div className="space-y-2">
        <Label>{t("Inspiration Photos", "Photos d'inspiration")}</Label>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            setPhotos((prev) => [...prev, ...files].slice(0, 6));
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="w-full border-2 border-dashed border-border p-6 flex flex-col items-center gap-2 hover:border-primary/50 transition-colors"
        >
          <Upload className="w-5 h-5 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">{t("Upload one or several photos", "Importez une ou plusieurs photos")}</span>
        </button>
        {photos.length > 0 && (
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {photos.map((file, i) => (
              <div key={i} className="relative aspect-square">
                <img
                  src={URL.createObjectURL(file)}
                  alt={t(`Inspiration ${i + 1}`, `Inspiration ${i + 1}`)}
                  className="w-full h-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => setPhotos(photos.filter((_, idx) => idx !== i))}
                  className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-none p-0.5 hover:bg-destructive/80"
                  aria-label={t("Remove photo", "Supprimer la photo")}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {t(
            "Photos are for inspiration only, the final design may be adapted to the Bento Cake Studio style.",
            "Les photos sont fournies à titre d'inspiration uniquement ; le design final pourra être adapté au style Bento Cake Studio."
          )}
        </p>
      </div>

      <Button
        type="submit"
        className="w-full bg-primary hover:bg-primary/90 text-primary-foreground py-3 text-[14px] font-medium uppercase tracking-[0.105em] rounded-none"
      >
        {t("SEND MY REQUEST", "ENVOYER MA DEMANDE")}
      </Button>
    </form>
  );
};

export default CustomRequestForm;
