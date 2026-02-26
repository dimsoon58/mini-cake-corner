import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const quoteSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(100),
  lastName: z.string().trim().min(1, "Last name is required").max(100),
  companyName: z.string().trim().max(200).optional(),
  phone: z.string().trim().min(1, "Phone number is required").max(30),
  email: z.string().trim().email("Invalid email address").max(255),
  eventDate: z.date().optional(),
  estimatedQuantity: z.string().optional(),
  deliveryOption: z.enum(["pickup", "delivery"]).default("pickup"),
  deliveryAddress: z.string().optional(),
  description: z.string().trim().min(1, "Description is required").max(2000),
});

type QuoteFormData = z.infer<typeof quoteSchema>;

interface CorporateQuoteFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CorporateQuoteForm = ({ open, onOpenChange }: CorporateQuoteFormProps) => {
  const [submitted, setSubmitted] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<QuoteFormData>({
    resolver: zodResolver(quoteSchema),
    defaultValues: { deliveryOption: "pickup" },
  });

  const deliveryOption = watch("deliveryOption");
  const eventDate = watch("eventDate");

  const onSubmit = (_data: QuoteFormData) => {
    setSubmitted(true);
  };

  const handleClose = (value: boolean) => {
    if (!value) {
      setTimeout(() => {
        setSubmitted(false);
        reset();
      }, 300);
    }
    onOpenChange(value);
  };

  if (submitted) {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-md">
          <div className="text-center py-8">
            <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
              <span className="text-3xl">✓</span>
            </div>
            <h3 className="font-serif text-2xl text-foreground mb-3">
              Thank You
            </h3>
            <p className="text-muted-foreground leading-relaxed">
              Thank you for your inquiry. Our team will be in touch within 48 hours.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl text-foreground">
            Get a Quote
          </DialogTitle>
          <DialogDescription className="text-muted-foreground leading-relaxed pt-2">
            Share the details of your event with us, and our team will carefully review your request. You will receive a personalized quote within 48 hours.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 pt-2">
          {/* Name row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="firstName">
                First Name <span className="text-destructive">*</span>
              </Label>
              <Input id="firstName" {...register("firstName")} />
              {errors.firstName && (
                <p className="text-sm text-destructive">{errors.firstName.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lastName">
                Last Name <span className="text-destructive">*</span>
              </Label>
              <Input id="lastName" {...register("lastName")} />
              {errors.lastName && (
                <p className="text-sm text-destructive">{errors.lastName.message}</p>
              )}
            </div>
          </div>

          {/* Company */}
          <div className="space-y-1.5">
            <Label htmlFor="companyName">Company Name</Label>
            <Input id="companyName" {...register("companyName")} />
            {errors.companyName && (
              <p className="text-sm text-destructive">{errors.companyName.message}</p>
            )}
          </div>

          {/* Contact row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="phone">
                Phone Number <span className="text-destructive">*</span>
              </Label>
              <Input id="phone" type="tel" {...register("phone")} />
              {errors.phone && (
                <p className="text-sm text-destructive">{errors.phone.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">
                Email Address <span className="text-destructive">*</span>
              </Label>
              <Input id="email" type="email" {...register("email")} />
              {errors.email && (
                <p className="text-sm text-destructive">{errors.email.message}</p>
              )}
            </div>
          </div>

          {/* Date & Quantity row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Event Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !eventDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {eventDate ? format(eventDate, "PPP") : "Select a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={eventDate}
                    onSelect={(date) => setValue("eventDate", date)}
                    disabled={(date) => date < new Date()}
                    initialFocus
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="estimatedQuantity">Estimated Quantity</Label>
              <Input
                id="estimatedQuantity"
                placeholder="e.g. 50 mini cakes"
                {...register("estimatedQuantity")}
              />
            </div>
          </div>

          {/* Pickup / Delivery */}
          <div className="space-y-2">
            <Label>Pickup or Delivery</Label>
            <RadioGroup
              defaultValue="pickup"
              onValueChange={(val) =>
                setValue("deliveryOption", val as "pickup" | "delivery")
              }
              className="flex gap-6"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="pickup" id="pickup" />
                <Label htmlFor="pickup" className="font-normal cursor-pointer">
                  Pickup
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="delivery" id="delivery" />
                <Label htmlFor="delivery" className="font-normal cursor-pointer">
                  Delivery
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* Delivery address (conditional) */}
          {deliveryOption === "delivery" && (
            <div className="space-y-1.5">
              <Label htmlFor="deliveryAddress">Delivery Address</Label>
              <Input id="deliveryAddress" {...register("deliveryAddress")} />
            </div>
          )}

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="description">
              Description of your request <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="description"
              rows={4}
              placeholder="Tell us about your event, theme, branding requirements..."
              {...register("description")}
            />
            {errors.description && (
              <p className="text-sm text-destructive">{errors.description.message}</p>
            )}
          </div>

          <Button type="submit" className="w-full rounded-full" size="lg">
            Submit Request
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default CorporateQuoteForm;
