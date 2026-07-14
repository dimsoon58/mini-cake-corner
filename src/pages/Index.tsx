import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Layout from "@/components/Layout";
import logo from "@/assets/logo-new.png";
import heroBg from "@/assets/hero-bg.jpg";
import featureCake from "@/assets/feature-cake.png";
import featurePipingBag from "@/assets/feature-piping-bag.png";
import featureWhisk from "@/assets/feature-whisk.png";
import customer1 from "@/assets/customer-1.jpg";
import customer2 from "@/assets/customer-2.jpg";
import customer3 from "@/assets/customer-3.jpg";
import customer4 from "@/assets/customer-4.jpg";
import customer5 from "@/assets/customer-5.jpg";
import customer6 from "@/assets/customer-6.jpg";
import customer7 from "@/assets/customer-7.jpg";
import customer8 from "@/assets/customer-8.jpg";
import customer9 from "@/assets/customer-9.jpg";
import customer10 from "@/assets/customer-10.jpg";
import customer11 from "@/assets/customer-11.jpg";
import customer12 from "@/assets/customer-12.jpg";
import customer13 from "@/assets/customer-13.jpg";
import customer14 from "@/assets/customer-14.jpg";
import customer15 from "@/assets/customer-15.jpg";
import customer16 from "@/assets/customer-16.jpg";
import customer17 from "@/assets/customer-17.jpg";
import customer18 from "@/assets/customer-18.jpg";
import customer19 from "@/assets/customer-19.jpg";
import customer20 from "@/assets/customer-20.jpg";
import customer21 from "@/assets/customer-21.jpg";
import customer22 from "@/assets/customer-22.jpg";
import customer23 from "@/assets/customer-23.jpg";
import customer24 from "@/assets/customer-24.jpg";
import customer25 from "@/assets/customer-25.jpg";
import customer26 from "@/assets/customer-26.jpg";
import customer27 from "@/assets/customer-27.jpg";
import customer28 from "@/assets/customer-28.jpg";
import customer29 from "@/assets/customer-29.jpg";
import customer30 from "@/assets/customer-30.jpg";
import customer31 from "@/assets/customer-31.jpg";
import customer32 from "@/assets/customer-32.jpg";
import customer33 from "@/assets/customer-33.jpg";
import customer34 from "@/assets/customer-34.jpg";
import comment7 from "@/assets/comment-7.jpg";
import comment8 from "@/assets/comment-8.jpg";
import comment9 from "@/assets/comment-9.jpg";
import comment10 from "@/assets/comment-10.jpg";
import comment11 from "@/assets/comment-11.jpg";
import comment12 from "@/assets/comment-12.jpg";
import comment13 from "@/assets/comment-13.jpg";
import comment14 from "@/assets/comment-14.jpg";
import comment15 from "@/assets/comment-15.jpg";
import comment16 from "@/assets/comment-16.jpg";
import comment17 from "@/assets/comment-17.jpg";
import comment18 from "@/assets/comment-18.jpg";
import comment19 from "@/assets/comment-19.jpg";
import comment20 from "@/assets/comment-20.jpg";
import comment21 from "@/assets/comment-21.jpg";
import comment22 from "@/assets/comment-22.jpg";
import comment23 from "@/assets/comment-23.jpg";
import comment24 from "@/assets/comment-24.jpg";
import comment25 from "@/assets/comment-25.jpg";

const customerPhotos = [
  customer3, customer4, customer5,
  customer7, customer9, customer10,
  customer11, customer12, customer13, customer15,
  customer16, customer17, customer18, customer19, customer20,
  customer21, customer22, customer23, customer24, customer25,
  customer26, customer27, customer28, customer29,
  customer30, customer32, customer33, customer34,
];

// Placeholder array for customer comment images — add imports here later
const customerCommentPhotos: string[] = [
  comment7, comment8, comment9, comment10, comment11,
  comment12, comment13, comment14, comment15,
  comment16, comment17, comment18, comment19, comment20,
  comment21, comment22, comment23, comment24, comment25,
];

/* Original hand-drawn brand illustrations, cropped from the Canva design */
const features = [
  {
    title: "Personalised",
    description: "Your perfect cake, from flavors to decoration.",
    image: featureCake,
  },
  {
    title: "Whipped Cream Cakes",
    description: "Light, fluffy and delicious.",
    image: featurePipingBag,
  },
  {
    title: "Fresh ingredients",
    description: "Made with fresh ingredients. No preservatives.",
    image: featureWhisk,
  },
];

const PhotoCarousel = ({ photos, altPrefix }: { photos: string[]; altPrefix: string }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: "left" | "right") => {
    if (!scrollRef.current) return;
    const scrollAmount = 320;
    scrollRef.current.scrollBy({
      left: direction === "left" ? -scrollAmount : scrollAmount,
      behavior: "smooth",
    });
  };

  if (photos.length === 0) {
    return (
      <p className="text-center text-muted-foreground italic">Coming soon...</p>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => scroll("left")}
        className="absolute left-0 top-1/2 -translate-y-1/2 z-10 bg-background/80 hover:bg-background rounded-none p-2 shadow-md -ml-4"
      >
        <ChevronLeft className="h-6 w-6 text-foreground" />
      </button>
      <div
        ref={scrollRef}
        className="flex gap-4 overflow-x-auto scrollbar-hide scroll-smooth px-4"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {photos.map((photo, index) => (
            <div
              key={index}
              className="flex-shrink-0 w-72 h-80 overflow-hidden"
            >
              <img
                src={photo}
                alt={`${altPrefix} ${index + 1}`}
                className="w-full h-full object-cover"
              />
            </div>
        ))}
      </div>
      <button
        onClick={() => scroll("right")}
        className="absolute right-0 top-1/2 -translate-y-1/2 z-10 bg-background/80 hover:bg-background rounded-none p-2 shadow-md -mr-4"
      >
        <ChevronRight className="h-6 w-6 text-foreground" />
      </button>
    </div>
  );
};

const Index = () => {
  return (
    <Layout>
      {/* Hero Section */}
      <section className="relative text-primary-foreground overflow-hidden min-h-[80vh]">
        <div
          className="absolute inset-0 bg-cover"
          style={{ backgroundImage: `url(${heroBg})`, backgroundPosition: 'center 60%' }}
        />
        <div className="absolute inset-0 bg-foreground/20" />
        <div className="relative container mx-auto px-4 py-24 md:py-32 text-center text-cream">
          <h1 className="font-serif text-[32px] md:text-[50px] tracking-[0.15em] leading-tight mb-6 max-w-4xl mx-auto">
            NOT YOUR TRADITIONAL CAKES
          </h1>
          <p className="text-base md:text-lg max-w-2xl mx-auto opacity-95 mb-10 font-light tracking-wide">
            Signature whipped cream cakes, Delicately crafted,
            <br className="hidden md:block" />
            Beautifully designed, And irresistibly light.
          </p>
          <Button
            size="lg"
            className="bg-primary hover:bg-primary/90 text-primary-foreground px-10 py-6 text-base font-medium tracking-wide rounded-full"
            asChild
          >
            <Link to="/catalog">Shop the Catalog</Link>
          </Button>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 bg-background">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
            {features.map((feature) => (
              <div key={feature.title} className="text-center flex flex-col items-center">
                <div className="h-[180px] md:h-[210px] flex items-end justify-center mb-6">
                  <img
                    src={feature.image}
                    alt={feature.title}
                    className="max-h-full w-auto object-contain"
                  />
                </div>
                <h3 className="font-script text-[32px] md:text-[40px] leading-normal text-foreground mb-3 whitespace-nowrap">
                  {feature.title}
                </h3>
                <p className="text-sm text-foreground/80 leading-relaxed max-w-[230px]">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How to Order Section */}
      <section
        className="py-20"
        style={{
          background:
            "radial-gradient(ellipse at 20% 30%, hsl(49 90% 97%) 0%, transparent 55%), radial-gradient(ellipse at 80% 70%, hsl(46 70% 90%) 0%, transparent 55%), hsl(49 88% 94%)",
        }}
      >
        <div className="container mx-auto px-4 max-w-5xl">
          <h2 className="font-serif text-4xl md:text-5xl text-center tracking-[0.15em] text-foreground mb-16">
            HOW TO ORDER
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-12 items-start">
            <div className="space-y-7">
              {[
                { step: "1", title: "Choose your date", text: "Select your pickup date (minimum 4 days in advance)" },
                { step: "2", title: "Choose size, shape & flavor", text: "Pick the cake size, shape, and flavor" },
                { step: "3", title: "Choose a cake style", text: "This is a base style — you can upload a reference image later" },
                { step: "4", title: "Add text (optional)", text: "Choose your message, font, and color" },
                { step: "5", title: "Add extras", text: "Customize with extra details and candles" },
                { step: "6", title: "Leave a note", text: "Tell us anything important about your order" },
              ].map(({ step, title, text }) => (
                <div key={step} className="flex items-start gap-5">
                  <span className="font-serif italic text-4xl text-foreground/60 leading-none w-8 text-center flex-shrink-0">
                    {step}
                  </span>
                  <div>
                    <h3 className="font-semibold text-foreground">{title}</h3>
                    <p className="text-sm text-foreground/75">{text}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="text-center lg:pt-8">
              <img src={featureCake} alt="" className="w-16 mx-auto mb-4" />
              <h3 className="font-serif text-2xl text-foreground mb-4">Good to know</h3>
              <ul className="space-y-3 text-sm text-foreground/80">
                <li>Fully booked dates cannot be selected</li>
                <li>Complex designs may require additional fees</li>
              </ul>
            </div>
          </div>
        </div>
      </section>


      {/* Customers Section */}
      <section className="py-20 bg-cream">
        <div className="container mx-auto px-4">
          <h2 className="font-serif text-4xl md:text-5xl text-center tracking-[0.15em] text-foreground mb-16">
            OUR CUSTOMERS
          </h2>
          <PhotoCarousel photos={customerPhotos} altPrefix="Happy customer" />
        </div>
      </section>

      {/* Customer Comments Section */}
      <section className="py-16 bg-background">
        <div className="container mx-auto px-4">
          <h2 className="font-serif text-4xl md:text-5xl text-center tracking-[0.15em] text-foreground mb-6">
            CUSTOMERS COMMENTS
          </h2>
          <PhotoCarousel photos={customerCommentPhotos} altPrefix="Customer comment" />
        </div>
      </section>

      {/* CTA Section — lace doily style */}
      <section className="py-16 bg-background">
        <div className="container mx-auto px-4">
          <div
            className="max-w-3xl mx-auto text-center rounded-[2rem] border-4 border-double border-primary/25 px-8 py-14 md:px-16"
            style={{
              background:
                "radial-gradient(circle at 15% 20%, hsl(0 0% 100% / 0.7) 0%, transparent 40%), radial-gradient(circle at 85% 80%, hsl(0 0% 100% / 0.5) 0%, transparent 40%), hsl(40 25% 92%)",
            }}
          >
            <h2 className="font-script text-4xl md:text-5xl text-foreground mb-6">
              Ready to create your perfect cake?
            </h2>
            <p className="text-sm md:text-base text-foreground/80 mb-10 max-w-md mx-auto">
              Choose your size, shape, flavor, and extras to design a cake
              that's uniquely yours.
            </p>
            <Button
              size="lg"
              className="bg-primary hover:bg-primary/90 text-primary-foreground px-10 py-6 text-sm uppercase tracking-[0.2em] font-medium rounded-full"
              asChild
            >
              <Link to="/catalog">Customize Your Cake</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-primary text-primary-foreground py-12">
        <div className="container mx-auto px-4 text-center">
          <img
            src={logo}
            alt="Bento Cake Studio"
            className="h-32 mx-auto mb-6 brightness-0 invert"
          />
          <p className="text-sm opacity-90 mb-4">
            © 2026 Bento Cake Studio SNC. All rights reserved.
          </p>
          <p className="text-sm opacity-70 mb-4">
            <Link to="/legal" className="underline hover:opacity-100">
              Terms and Conditions & Privacy Policy
            </Link>
          </p>
          <p className="text-sm opacity-70 mb-6">
            <Link to="/newsletter" className="underline hover:opacity-100">
              Subscribe to newsletter
            </Link>
          </p>
        </div>
      </footer>
    </Layout>
  );
};

export default Index;
