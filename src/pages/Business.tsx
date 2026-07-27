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

import cardCelebrations from "@/assets/corporate-event-5.png";
import cardEvents from "@/assets/corporate-event-8.png";
import cardHospitality from "@/assets/corporate-event-11.png";

const phoneRegex = /^[+\d][\d\s().\-/]{6,}$/;

/* ─────────────────────────  Shared UI bits  ───────────────────────── */

const RequiredMark = () => <span className="text-destructive">*</span>;

const SuccessPanel = ({ message }: { message: string }) => (
  <div className="text-center py-10">
    <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
      <span className="text-3xl text-primary">✓</span>
    </div>
    <h3 className="font-sans uppercase tracking-[0.105em] text-xl font-semibold text-foreground mb-3">
      Thank you
    </h3>
    <p className="text-muted-foreground leading-relaxed max-w-md mx-auto">{message}</p>
  </div>
);

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
        { subject: "Corporate Celebrations enquiry — Bento Cake Studio" }
      );
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-2 text-left">
      <p className="text-sm text-muted-foreground leading-relaxed">
        Tell us more about your company and what you are looking for. We will get back to you with a
        personalised proposal.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="cc-firstName">First name <RequiredMark /></Label>
          <Input id="cc-firstName" {...register("firstName")} />
          {errors.firstName && <p className="text-sm text-destructive">{errors.firstName.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cc-lastName">Last name <RequiredMark /></Label>
          <Input id="cc-lastName" {...register("lastName")} />
          {errors.lastName && <p className="text-sm text-destructive">{errors.lastName.message}</p>}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="cc-phone">Phone number <RequiredMark /></Label>
          <Input id="cc-phone" type="tel" {...register("phone")} />
          {errors.phone && <p className="text-sm text-destructive">{errors.phone.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cc-email">Email address <RequiredMark /></Label>
          <Input id="cc-email" type="email" {...register("email")} />
          {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="cc-company">Company name <RequiredMark /></Label>
          <Input id="cc-company" {...register("companyName")} />
          {errors.companyName && <p className="text-sm text-destructive">{errors.companyName.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cc-employees">Number of employees <RequiredMark /></Label>
          <Input id="cc-employees" {...register("numberOfEmployees")} />
          {errors.numberOfEmployees && (
            <p className="text-sm text-destructive">{errors.numberOfEmployees.message}</p>
          )}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="cc-looking">Tell us what you are looking for <RequiredMark /></Label>
        <Textarea id="cc-looking" rows={4} {...register("lookingFor")} />
        {errors.lookingFor && <p className="text-sm text-destructive">{errors.lookingFor.message}</p>}
      </div>
      <Button
        type="submit"
        disabled={isSubmitting}
        className="w-full bg-primary hover:bg-primary/90 text-primary-foreground py-6 text-[13px] font-medium uppercase tracking-[0.105em] rounded-none"
      >
        {isSubmitting ? "Sending…" : "Send my enquiry"}
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
          "Company / Agency": data.companyAgency || "—",
          "Email address": data.email,
          "Phone number": data.phone,
          "Event date": format(data.eventDate, "dd.MM.yyyy"),
          "Estimated number of guests": data.estimatedGuests,
          "Project description": data.projectDescription,
        },
        { subject: "Event Quote Request — Bento Cake Studio", files }
      );
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-2 text-left">
      <p className="text-sm text-muted-foreground leading-relaxed">
        Planning an event and looking for a personalised proposal? Tell us about your idea, even if it
        is not yet fully defined. The more information you share about your needs, inspiration and
        budget, the better we can tailor our proposal to your event.
      </p>

      <div className="space-y-1.5">
        <Label htmlFor="ev-name">First and last name <RequiredMark /></Label>
        <Input id="ev-name" {...register("fullName")} />
        {errors.fullName && <p className="text-sm text-destructive">{errors.fullName.message}</p>}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ev-company">Company / Agency <span className="text-muted-foreground">(optional)</span></Label>
        <Input id="ev-company" {...register("companyAgency")} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="ev-email">Email address <RequiredMark /></Label>
          <Input id="ev-email" type="email" {...register("email")} />
          {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ev-phone">Phone number <RequiredMark /></Label>
          <Input id="ev-phone" type="tel" {...register("phone")} />
          {errors.phone && <p className="text-sm text-destructive">{errors.phone.message}</p>}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Event date <RequiredMark /></Label>
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
                {eventDate ? format(eventDate, "dd.MM.yyyy") : "Select a date"}
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
          {errors.eventDate && <p className="text-sm text-destructive">{errors.eventDate.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ev-guests">Estimated number of guests <RequiredMark /></Label>
          <Input id="ev-guests" {...register("estimatedGuests")} />
          {errors.estimatedGuests && (
            <p className="text-sm text-destructive">{errors.estimatedGuests.message}</p>
          )}
        </div>
      </div>

      {/* Description */}
      <div className="space-y-1.5">
        <Label htmlFor="ev-desc">Tell us about your project <RequiredMark /></Label>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Describe what you have in mind for your event and what you may need. To help us prepare a
          suitable proposal, you can include:
        </p>
        <ul className="text-xs text-muted-foreground list-disc pl-5 space-y-0.5">
          <li>the type of event</li>
          <li>the products and quantities you are considering</li>
          <li>your preferred style, colours or theme</li>
          <li>any logo, edible print, wording or specific detail you would like to add</li>
          <li>your approximate budget</li>
          <li>whether delivery is required</li>
        </ul>
        <Textarea id="ev-desc" rows={5} {...register("projectDescription")} />
        {errors.projectDescription && (
          <p className="text-sm text-destructive">{errors.projectDescription.message}</p>
        )}
      </div>

      {/* Upload */}
      <div className="space-y-2">
        <Label>Add your inspiration <span className="text-muted-foreground">(optional)</span></Label>
        <p className="text-xs text-muted-foreground">
          You can upload photos, a moodboard, a logo or any other useful visual references.
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
          <span className="text-sm text-muted-foreground">Upload one or several files</span>
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
                  aria-label="Remove file"
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
        {isSubmitting ? "Sending…" : "Send my enquiry"}
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
        { subject: "Hospitality Partners enquiry — Bento Cake Studio" }
      );
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-2 text-left">
      <p className="text-sm text-muted-foreground leading-relaxed">
        Interested in offering Bento Cake Studio cakes to your clients? Tell us more about your
        establishment and what you are looking for. We will get back to you with our partner offer and
        pricing.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="hp-firstName">First name <RequiredMark /></Label>
          <Input id="hp-firstName" {...register("firstName")} />
          {errors.firstName && <p className="text-sm text-destructive">{errors.firstName.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hp-lastName">Last name <RequiredMark /></Label>
          <Input id="hp-lastName" {...register("lastName")} />
          {errors.lastName && <p className="text-sm text-destructive">{errors.lastName.message}</p>}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="hp-phone">Phone number <RequiredMark /></Label>
          <Input id="hp-phone" type="tel" {...register("phone")} />
          {errors.phone && <p className="text-sm text-destructive">{errors.phone.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hp-email">Email address <RequiredMark /></Label>
          <Input id="hp-email" type="email" {...register("email")} />
          {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="hp-establishment">Establishment name <RequiredMark /></Label>
        <Input id="hp-establishment" {...register("establishmentName")} />
        {errors.establishmentName && (
          <p className="text-sm text-destructive">{errors.establishmentName.message}</p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="hp-looking">Tell us what you are looking for <RequiredMark /></Label>
        <Textarea id="hp-looking" rows={4} {...register("lookingFor")} />
        {errors.lookingFor && <p className="text-sm text-destructive">{errors.lookingFor.message}</p>}
      </div>
      <Button
        type="submit"
        disabled={isSubmitting}
        className="w-full bg-primary hover:bg-primary/90 text-primary-foreground py-6 text-[13px] font-medium uppercase tracking-[0.105em] rounded-none"
      >
        {isSubmitting ? "Sending…" : "Send my enquiry"}
      </Button>
    </form>
  );
};

/* ─────────────────────────  CARD DATA  ─────────────────────────────── */

type CategoryId = "celebrations" | "events" | "hospitality";

const cards: {
  id: CategoryId;
  title: string;
  subtitle: string;
  checks: string[];
  cta: string;
  image: string;
}[] = [
  {
    id: "celebrations",
    title: "Corporate Celebrations",
    subtitle: "We take care of every employee celebration.",
    checks: [
      "Share your calendar with us once",
      "Design and flavour selected by Bento Cake Studio",
      "Production and delivery included",
      "One-month trial with no commitment",
    ],
    cta: "Discover",
    image: cardCelebrations,
  },
  {
    id: "events",
    title: "Corporate Events",
    subtitle: "Bespoke creations designed to elevate your event.",
    checks: [
      "Custom cakes",
      "Brand logos and colours",
      "Individual formats or large quantities",
      "Delivery and set-up available",
    ],
    cta: "Request a Quote",
    image: cardEvents,
  },
  {
    id: "hospitality",
    title: "Hospitality Partners",
    subtitle: "Custom cakes for your clients' birthdays and celebrations.",
    checks: [
      "Designed for bars, restaurants, hotels and event venues",
      "Simple selection and ordering process",
      "Professional partner pricing",
      "Opportunity to earn a margin",
    ],
    cta: "Discover",
    image: cardHospitality,
  },
];

/* ─────────────────────────  PAGE  ──────────────────────────────────── */

type View = "info" | "form" | "done";

const Business = () => {
  const [openId, setOpenId] = useState<CategoryId | null>(null);
  // Celebrations & Hospitality start on "info"; Events opens straight to "form".
  const [view, setView] = useState<View>("info");

  useEffect(() => {
    document.title = "Business & Press – Bento Cake Studio";
    return () => {
      document.title = "Bento Cake Studio Geneva";
    };
  }, []);

  const openCategory = (id: CategoryId) => {
    setView(id === "events" ? "form" : "info");
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
          Business &amp; Press
        </h1>
        <p className="text-center text-muted-foreground mb-16 max-w-2xl mx-auto">
          Partner with Bento Cake Studio — from employee celebrations to bespoke events and
          hospitality collaborations.
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
                  alt={card.title}
                  className="w-full h-full object-cover hover:scale-105 transition-transform duration-300"
                />
              </div>
              <div className="flex flex-col flex-1 p-6">
                <h2 className="font-sans text-[15px] tracking-[0.105em] font-semibold uppercase text-foreground mb-2">
                  {card.title}
                </h2>
                <p className="text-sm text-muted-foreground mb-5">{card.subtitle}</p>
                <ul className="space-y-2.5 mb-6">
                  {card.checks.map((check) => (
                    <li key={check} className="flex items-start gap-2.5 text-sm text-foreground/90">
                      <Check className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" strokeWidth={2} />
                      <span>{check}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-auto">
                  <Button
                    onClick={() => openCategory(card.id)}
                    className="w-full bg-primary hover:bg-primary/90 text-primary-foreground py-6 text-[13px] font-medium uppercase tracking-[0.105em] rounded-none"
                  >
                    {card.cta}
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
            <SuccessPanel message="Thank you for your enquiry. We will get back to you with a personalised proposal based on your company's needs." />
          ) : view === "form" ? (
            <>
              <DialogHeader>
                <DialogTitle className="font-sans uppercase tracking-[0.105em] text-xl text-foreground">
                  Corporate Celebrations
                </DialogTitle>
              </DialogHeader>
              <CelebrationsForm onSuccess={() => setView("done")} />
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="font-sans uppercase tracking-[0.105em] text-xl text-foreground">
                  Corporate Celebrations
                </DialogTitle>
                <DialogDescription className="text-muted-foreground leading-relaxed pt-1">
                  A simple, fully managed way to celebrate your employees throughout the year.
                </DialogDescription>
              </DialogHeader>
              <div className="pt-2">
                <InfoList
                  items={[
                    "Send us your employee birthday calendar once",
                    "We plan each celebration in advance",
                    "We choose the cake design and flavour",
                    "Available in vanilla or chocolate",
                    "We personalise, prepare and deliver every cake",
                    "Dietary requirements can be shared in advance",
                    "Start with a one-month trial",
                    "Continue with a 12-month programme and prepaid celebration budget",
                  ]}
                />
                <Button
                  onClick={() => setView("form")}
                  className="w-full mt-6 bg-primary hover:bg-primary/90 text-primary-foreground py-6 text-[13px] font-medium uppercase tracking-[0.105em] rounded-none"
                >
                  Complete the Form
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
            <SuccessPanel message="Thank you for your enquiry. We will get back to you with a personalised proposal based on your requirements, our availability and the feasibility of the project." />
          ) : (
            <>
              <DialogHeader>
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Events</p>
                <DialogTitle className="font-sans uppercase tracking-[0.105em] text-xl text-foreground">
                  Event Quote Request
                </DialogTitle>
              </DialogHeader>
              <EventsForm onSuccess={() => setView("done")} />
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ───────── Hospitality Partners dialog ───────── */}
      <Dialog open={openId === "hospitality"} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          {view === "done" ? (
            <SuccessPanel message="Thank you for your enquiry. We will get back to you with more information about our partner offer, pricing and ordering process." />
          ) : view === "form" ? (
            <>
              <DialogHeader>
                <DialogTitle className="font-sans uppercase tracking-[0.105em] text-xl text-foreground">
                  Hospitality Partners
                </DialogTitle>
              </DialogHeader>
              <HospitalityForm onSuccess={() => setView("done")} />
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="font-sans uppercase tracking-[0.105em] text-xl text-foreground">
                  Hospitality Partners
                </DialogTitle>
                <DialogDescription className="text-muted-foreground leading-relaxed pt-1">
                  Offer personalised cakes to your clients through a simple partner programme. We
                  supply selected cakes at a professional partner price. Each establishment remains
                  free to choose its final resale price and set its own margin.
                </DialogDescription>
              </DialogHeader>
              <div className="pt-2 space-y-5">
                <div>
                  <h4 className="font-sans text-[13px] uppercase tracking-[0.105em] font-semibold text-foreground mb-3">
                    How it works
                  </h4>
                  <InfoList
                    items={[
                      "Available for restaurants, hotels, bars and event venues",
                      "Cakes are supplied at a professional partner price",
                      "The establishment chooses its own resale price",
                      "Only round cakes are available through the partner selection",
                      "Any additional or fully bespoke personalisation must be ordered directly from Bento Cake Studio",
                    ]}
                  />
                </div>
                <div>
                  <h4 className="font-sans text-[13px] uppercase tracking-[0.105em] font-semibold text-foreground mb-3">
                    Your clients can choose
                  </h4>
                  <InfoList
                    items={[
                      "Cake size",
                      "Flavour",
                      "Design from the partner selection",
                      "Base colour",
                      "Text",
                      "Text colour",
                      "Decoration colour",
                    ]}
                  />
                </div>
                <Button
                  onClick={() => setView("form")}
                  className="w-full bg-primary hover:bg-primary/90 text-primary-foreground py-6 text-[13px] font-medium uppercase tracking-[0.105em] rounded-none"
                >
                  Complete the Form
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
