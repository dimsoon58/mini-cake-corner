import { useState, useRef } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Upload, X } from "lucide-react";
import Layout from "@/components/Layout";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const contactSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(100),
  lastName: z.string().trim().min(1, "Last name is required").max(100),
  email: z.string().trim().email("Invalid email address").max(255),
  phone: z.string().trim().min(1, "Phone number is required").max(30),
  message: z.string().trim().min(1, "Message is required").max(2000),
});

type ContactFormData = z.infer<typeof contactSchema>;

const Contact = () => {
  const [submitted, setSubmitted] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ContactFormData>({
    resolver: zodResolver(contactSchema),
  });

  const onSubmit = (_data: ContactFormData) => {
    setSubmitted(true);
    toast.success("Your message has been sent. We'll get back to you soon!");
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      if (selected.size > 10 * 1024 * 1024) {
        toast.error("File size must be under 10 MB.");
        return;
      }
      setFile(selected);
    }
  };

  const handleReset = () => {
    setSubmitted(false);
    setFile(null);
    reset();
  };

  return (
    <Layout>
      <main className="max-w-4xl mx-auto px-6 py-16">
        <h1 className="font-sans uppercase tracking-[0.105em] text-4xl md:text-5xl text-foreground mb-12 text-center">
          Contact Us
        </h1>

        <div className="space-y-8 text-foreground leading-relaxed">
          <p className="text-justify">
            For your custom cake, we take many considerations for the price. This includes the cake size and the amount of labor & time required to make your cake.
          </p>

          <p className="text-justify">
            If the cake is minimal in the design, the price will remain the same as the starting price. You can send us your idea for customization and we will happily quote you the price.
          </p>

          <div className="space-y-2">
            <p className="font-semibold">
              Questions? Our team is here to help. Contact us on WhatsApp:{" "}
              <a
                href="https://wa.me/41783379500"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                +41 78 337 95 00
              </a>
            </p>
            <p className="font-semibold">
              Instagram:{" "}
              <a
                href="https://instagram.com/bentocakestudio"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                @bentocakestudio
              </a>
            </p>
            <p className="font-semibold">
              Email:{" "}
              <a
                href="mailto:contact@bentocakestudio.ch"
                className="text-primary hover:underline"
              >
                contact@bentocakestudio.ch
              </a>
            </p>
          </div>

          {/* Ordering info */}
          <div className="bg-muted/50 border border-border rounded-lg p-6 space-y-3">
            <h2 className="text-lg font-sans font-semibold text-foreground">
              Important Ordering Information
            </h2>
            <p className="text-justify">
              All of our cakes are made fresh upon order, which means we don't have any ready cakes. To place an order, a <strong>minimum of 4 days advance notice</strong> is required. However, we <strong>strongly recommend ordering at least 1 week in advance</strong> to ensure availability.
            </p>
            <p className="text-justify">
              We receive a <strong>high volume of orders</strong> and have <strong>limited availability</strong>. Orders are processed on a <strong>first come, first served basis</strong>. Even with 4 days' notice, <strong>availability is not guaranteed</strong>.
            </p>
            <p className="text-justify">
              Orders are confirmed only upon receipt of payment. If you wish to cancel or reschedule your order, you must notify us at least{" "}
              <strong>5 days in advance</strong> to receive a refund or change the date. Otherwise,{" "}
              <strong>no refunds or rescheduling will be possible</strong>.
            </p>
          </div>

          {/* Need Help Form */}
          <div className="border border-border rounded-lg p-6 md:p-8 mt-12">
            <h2 className="text-2xl font-serif text-foreground mb-2">Need Help?</h2>
            <p className="text-muted-foreground mb-6">
              Fill out the form below and we'll get back to you as soon as possible.
            </p>

            {submitted ? (
              <div className="text-center py-8">
                <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
                  <span className="text-3xl">✓</span>
                </div>
                <h3 className="font-serif text-2xl text-foreground mb-3">Thank You</h3>
                <p className="text-muted-foreground leading-relaxed mb-6">
                  We've received your message and will get back to you shortly.
                </p>
                <Button variant="outline" onClick={handleReset}>
                  Send another message
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
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

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="email">
                      Email <span className="text-destructive">*</span>
                    </Label>
                    <Input id="email" type="email" {...register("email")} />
                    {errors.email && (
                      <p className="text-sm text-destructive">{errors.email.message}</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="phone">
                      Phone Number <span className="text-destructive">*</span>
                    </Label>
                    <Input id="phone" type="tel" {...register("phone")} />
                    {errors.phone && (
                      <p className="text-sm text-destructive">{errors.phone.message}</p>
                    )}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="message">
                    Message <span className="text-destructive">*</span>
                  </Label>
                  <Textarea
                    id="message"
                    rows={5}
                    placeholder="Please include your order number and clearly explain your issue."
                    {...register("message")}
                  />
                  {errors.message && (
                    <p className="text-sm text-destructive">{errors.message.message}</p>
                  )}
                </div>

                {/* File upload */}
                <div className="space-y-1.5">
                  <Label>Attach an image (optional)</Label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                  {file ? (
                    <div className="flex items-center gap-3 border border-border rounded-md px-3 py-2 text-sm">
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
                      Choose a file…
                    </Button>
                  )}
                </div>

                <Button type="submit" className="w-full rounded-full" size="lg">
                  Send Message
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
