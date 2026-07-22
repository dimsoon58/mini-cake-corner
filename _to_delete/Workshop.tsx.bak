import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Clock, GraduationCap, Users, Gift, PartyPopper, Cake, Building2, Heart, Sparkles } from "lucide-react";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import workshopHero from "@/assets/home-cat-workshops.png";

/* Set a date string (e.g. "Saturday 14 September 2026, 14:00") to announce
   the next workshop; leave null to show the waiting list instead. */
const NEXT_WORKSHOP_DATE: string | null = null;

const included = [
  { icon: GraduationCap, title: "Workshop Format", text: "Details coming soon." },
  { icon: Clock, title: "Duration", text: "Details coming soon." },
  { icon: Sparkles, title: "What You'll Learn", text: "Details coming soon." },
  { icon: Users, title: "Participants", text: "Details coming soon." },
  { icon: Gift, title: "What's Included", text: "Materials, tasting, drinks — details coming soon." },
];

const audiences = [
  { icon: GraduationCap, label: "Beginners" },
  { icon: Users, label: "Groups of friends" },
  { icon: PartyPopper, label: "Hen parties" },
  { icon: Cake, label: "Birthdays" },
  { icon: Building2, label: "Team building" },
  { icon: Gift, label: "Private events" },
  { icon: Heart, label: "Anyone discovering cake decorating" },
];

/* Add real workshop photos here as they become available. */
const galleryPhotos: string[] = [workshopHero];

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <h2 className="font-sans uppercase tracking-[0.105em] text-2xl md:text-4xl text-center text-foreground mb-14">
    {children}
  </h2>
);

const Workshop = () => {
  const galleryRef = useRef<HTMLDivElement>(null);
  const [email, setEmail] = useState("");
  const [joined, setJoined] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    document.title = "Workshop – Bento Cake Studio";
    return () => {
      document.title = "Bento Cake Studio Geneva";
    };
  }, []);

  const scrollGallery = (direction: "left" | "right") => {
    galleryRef.current?.scrollBy({
      left: direction === "left" ? -400 : 400,
      behavior: "smooth",
    });
  };

  const handleJoinWaitingList = async () => {
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      toast.error("Please enter a valid email address.");
      return;
    }
    setSubmitting(true);
    try {
      await supabase.functions.invoke("subscribe-newsletter", {
        body: { email: trimmed, firstName: "", lastName: "", source: "workshop-waiting-list" },
      });
    } catch {
      // non-blocking — we still confirm; the address is logged by the function
    }
    setSubmitting(false);
    setJoined(true);
  };

  return (
    <Layout overlayHero>
      {/* Hero — full width, full screen */}
      <section className="relative h-screen min-h-[560px] w-full overflow-hidden">
        <img
          src={workshopHero}
          alt="Cake decorating workshop at Bento Cake Studio"
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-foreground/40" />
        <div className="relative h-full flex flex-col items-center justify-center text-center px-4">
          <h1 className="font-sans uppercase tracking-[0.105em] text-3xl md:text-5xl text-cream leading-tight mb-6">
            WORKSHOP
          </h1>
          <p className="text-cream/95 text-base md:text-lg font-light max-w-2xl mb-10">
            Learn to decorate your own bento cake in our Geneva studio — a
            hands-on, sweet and unforgettable experience.
          </p>
          <Button
            onClick={() =>
              document.getElementById("next-workshop")?.scrollIntoView({ behavior: "smooth" })
            }
            className="bg-primary hover:bg-primary/90 text-primary-foreground px-10 py-6 text-[14px] font-medium uppercase tracking-[0.105em] rounded-none"
          >
            NEXT WORKSHOP
          </Button>
        </div>
      </section>

      {/* What's included */}
      <section className="py-20 bg-background">
        <div className="container mx-auto px-4">
          <SectionTitle>WHAT'S INCLUDED?</SectionTitle>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-10 max-w-6xl mx-auto">
            {included.map((item) => (
              <div key={item.title} className="text-center flex flex-col items-center">
                <item.icon className="w-9 h-9 text-primary mb-4" strokeWidth={1.25} />
                <h3 className="font-sans text-[13px] font-semibold uppercase tracking-[0.105em] text-foreground mb-2">
                  {item.title}
                </h3>
                <p className="text-sm text-foreground/70 leading-relaxed max-w-[200px]">
                  {item.text}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Who is it for */}
      <section className="py-20 bg-cream">
        <div className="container mx-auto px-4">
          <SectionTitle>WHO IS IT FOR?</SectionTitle>
          <div className="flex flex-wrap justify-center gap-4 max-w-4xl mx-auto">
            {audiences.map((audience) => (
              <div
                key={audience.label}
                className="flex items-center gap-2.5 border border-primary/30 px-6 py-3"
              >
                <audience.icon className="w-4 h-4 text-primary" strokeWidth={1.5} />
                <span className="text-sm text-foreground">{audience.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Gallery */}
      <section className="py-20 bg-background">
        <div className="container mx-auto px-4">
          <SectionTitle>PREVIOUS WORKSHOPS</SectionTitle>
        </div>
        <div className="relative px-4">
          <button
            onClick={() => scrollGallery("left")}
            className="absolute left-4 top-1/2 -translate-y-1/2 z-10 bg-background/80 hover:bg-background rounded-none p-2 shadow-md"
            aria-label="Scroll gallery left"
          >
            <ChevronLeft className="h-6 w-6 text-foreground" />
          </button>
          <div
            ref={galleryRef}
            className="flex gap-4 overflow-x-auto scroll-smooth px-4"
            style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
          >
            {galleryPhotos.map((photo, index) => (
              <div key={index} className="flex-shrink-0 w-[480px] max-w-[85vw] h-80 overflow-hidden">
                <img
                  src={photo}
                  alt={`Workshop ${index + 1}`}
                  className="w-full h-full object-cover"
                />
              </div>
            ))}
            {/* Placeholder slots until more workshop photos are added */}
            {[1, 2].map((slot) => (
              <div
                key={`slot-${slot}`}
                className="flex-shrink-0 w-[480px] max-w-[85vw] h-80 border border-dashed border-border/70 flex items-center justify-center"
              >
                <span className="text-[10px] uppercase tracking-[0.105em] text-muted-foreground/50">
                  Photo coming soon
                </span>
              </div>
            ))}
          </div>
          <button
            onClick={() => scrollGallery("right")}
            className="absolute right-4 top-1/2 -translate-y-1/2 z-10 bg-background/80 hover:bg-background rounded-none p-2 shadow-md"
            aria-label="Scroll gallery right"
          >
            <ChevronRight className="h-6 w-6 text-foreground" />
          </button>
        </div>
      </section>

      {/* Next workshop / waiting list */}
      <section id="next-workshop" className="py-20 bg-cream">
        <div className="container mx-auto px-4">
          <SectionTitle>NEXT WORKSHOP</SectionTitle>
          <div className="max-w-xl mx-auto text-center">
            {NEXT_WORKSHOP_DATE ? (
              <>
                <p className="font-serif text-2xl text-foreground mb-8">{NEXT_WORKSHOP_DATE}</p>
                <Button
                  asChild
                  className="bg-primary hover:bg-primary/90 text-primary-foreground px-10 py-6 text-[14px] font-medium uppercase tracking-[0.105em] rounded-none"
                >
                  <a href="/contact">RESERVE MY SPOT</a>
                </Button>
              </>
            ) : joined ? (
              <div className="py-6">
                <div className="w-14 h-14 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-5">
                  <span className="text-2xl text-primary">✓</span>
                </div>
                <h3 className="font-sans uppercase tracking-[0.105em] text-lg font-semibold text-foreground mb-3">
                  YOU'RE ON THE LIST!
                </h3>
                <p className="text-muted-foreground text-sm">
                  We'll email you as soon as the next workshop date opens.
                </p>
              </div>
            ) : (
              <>
                <p className="text-muted-foreground text-sm mb-8">
                  No workshop dates are currently available.
                  <br />
                  Leave your email below and be the first to know when the next
                  workshop opens.
                </p>
                <div className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
                  <Input
                    type="email"
                    placeholder="Your email address"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="rounded-none"
                  />
                  <Button
                    onClick={handleJoinWaitingList}
                    disabled={submitting}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground px-8 text-[13px] font-medium uppercase tracking-[0.105em] rounded-none whitespace-nowrap"
                  >
                    {submitting ? "..." : "JOIN WAITING LIST"}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </section>
    </Layout>
  );
};

export default Workshop;
