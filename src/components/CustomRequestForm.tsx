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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const requestSchema = z
  .object({
    firstName: z.string().trim().min(1, "First name is required").max(100),
    lastName: z.string().trim().min(1, "Last name is required").max(100),
    email: z.string().trim().email("Please enter a valid email address").max(255),
    phone: z
      .string()
      .trim()
      .min(1, "Phone number is required")
      .regex(/^[+\d][\d\s().\-/]{6,}$/, "Please enter a valid phone number"),
    eventDate: z.date({ required_error: "Please select a date" }),
    cakeSize: z.string().optional(),
    guests: z.string().trim().optional(),
    description: z
      .string()
      .trim()
      .min(1, "Please describe your dream cake")
      .max(3000),
  })
  .refine((data) => data.cakeSize || (data.guests && data.guests.length > 0), {
    message: "Please select a size or tell us the number of guests",
    path: ["cakeSize"],
  });

type RequestFormData = z.infer<typeof requestSchema>;

const cakeSizes = ["Bento (1-2 people)", "Retro Box (2-4 people)", "Medium (6-8 people)", "Large (10-15 people)"];

const CustomRequestForm = () => {
  const [submitted, setSubmitted] = useState(false);
  const [photos, setPhotos] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<RequestFormData>({ resolver: zodResolver(requestSchema) });

  const eventDate = watch("eventDate");
  const cakeSize = watch("cakeSize");

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
          THANK YOU!
        </h3>
        <p className="text-muted-foreground leading-relaxed">
          We've received your request and will get back to you within 24 hours
          with availability and a personalised quote.
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
            First Name <span className="text-destructive">*</span>
          </Label>
          <Input id="cr-firstName" {...register("firstName")} />
          {errors.firstName && <p className="text-sm text-destructive">{errors.firstName.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cr-lastName">
            Last Name <span className="text-destructive">*</span>
          </Label>
          <Input id="cr-lastName" {...register("lastName")} />
          {errors.lastName && <p className="text-sm text-destructive">{errors.lastName.message}</p>}
        </div>
      </div>

      {/* Contact row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="cr-email">
            Email <span className="text-destructive">*</span>
          </Label>
          <Input id="cr-email" type="email" {...register("email")} />
          {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cr-phone">
            Phone Number <span className="text-destructive">*</span>
          </Label>
          <Input id="cr-phone" type="tel" {...register("phone")} />
          {errors.phone && <p className="text-sm text-destructive">{errors.phone.message}</p>}
        </div>
      </div>

      {/* Date */}
      <div className="space-y-1.5">
        <Label>
          Event / Pick-up Date <span className="text-destructive">*</span>
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

      {/* Size or guests */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>
            Cake Size <span className="text-destructive">*</span>
          </Label>
          <Select value={cakeSize} onValueChange={(v) => setValue("cakeSize", v, { shouldValidate: true })}>
            <SelectTrigger>
              <SelectValue placeholder="Select a size" />
            </SelectTrigger>
            <SelectContent>
              {cakeSizes.map((size) => (
                <SelectItem key={size} value={size}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.cakeSize && <p className="text-sm text-destructive">{errors.cakeSize.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cr-guests">Number of Guests</Label>
          <Input id="cr-guests" type="number" min="1" placeholder="e.g. 12" {...register("guests")} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground -mt-2">
        Not sure which size to choose? Simply tell us the number of guests.
      </p>

      {/* Description */}
      <div className="space-y-1.5">
        <Label htmlFor="cr-description">
          Design Description <span className="text-destructive">*</span>
        </Label>
        <Textarea
          id="cr-description"
          rows={6}
          placeholder="Describe your dream cake: design, colours, theme, decorations, message to write on the cake, flavours and any other important details..."
          {...register("description")}
        />
        {errors.description && <p className="text-sm text-destructive">{errors.description.message}</p>}
      </div>

      {/* Photo upload */}
      <div className="space-y-2">
        <Label>Inspiration Photos</Label>
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
          <span className="text-sm text-muted-foreground">Upload one or several photos</span>
        </button>
        {photos.length > 0 && (
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {photos.map((file, i) => (
              <div key={i} className="relative aspect-square">
                <img
                  src={URL.createObjectURL(file)}
                  alt={`Inspiration ${i + 1}`}
                  className="w-full h-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => setPhotos(photos.filter((_, idx) => idx !== i))}
                  className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-none p-0.5 hover:bg-destructive/80"
                  aria-label="Remove photo"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Photos are for inspiration only — the final design may be adapted to
          the Bento Cake Studio style.
        </p>
      </div>

      <Button
        type="submit"
        className="w-full bg-primary hover:bg-primary/90 text-primary-foreground py-6 text-[14px] font-medium uppercase tracking-[0.105em] rounded-none"
      >
        SEND MY REQUEST
      </Button>
    </form>
  );
};

export default CustomRequestForm;
