import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Layout from "@/components/Layout";
import logo from "@/assets/logo-new.png";
import heroBg from "@/assets/hero-bg.jpg";
import cakeWhippedCream from "@/assets/cake-whipped-cream-new.png";
import cakeFresh from "@/assets/cake-fresh-new.png";
import cakeTrendy from "@/assets/cake-trendy.png";
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
];

const features = [
  {
    title: "Personalized",
    description: "Your perfect cake, from flavors to decoration.",
    image: cakeTrendy,
    scaleClass: "scale-100",
  },
  {
    title: "Whipped Cream Cakes",
    description: "Light, fluffy and delicious.",
    image: cakeWhippedCream,
    scaleClass: "scale-[2.2]",
  },
  {
    title: "Fresh ingredients",
    description: "Made with fresh ingredients. No preservatives.",
    image: cakeFresh,
    scaleClass: "scale-[1.8]",
  },
];

const PhotoCarousel = ({ photos, altPrefix, contain }: { photos: string[]; altPrefix: string; contain?: boolean }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: "left" | "right") => {
    if (!scrollRef.current) return;
    const scrollAmount = contain ? scrollRef.current.clientWidth : 320;
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
        className="absolute left-0 top-1/2 -translate-y-1/2 z-10 bg-background/80 hover:bg-background rounded-full p-2 shadow-md -ml-4"
      >
        <ChevronLeft className="h-6 w-6 text-foreground" />
      </button>
      <div
        ref={scrollRef}
        className={`flex gap-4 overflow-x-auto scrollbar-hide scroll-smooth px-4 ${contain ? 'snap-x snap-mandatory' : ''}`}
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {photos.map((photo, index) => (
          contain ? (
            <div
              key={index}
              className="flex-shrink-0 w-full flex items-center justify-center snap-center"
            >
              <img
                src={photo}
                alt={`${altPrefix} ${index + 1}`}
                className="max-w-full max-h-[500px] object-contain rounded-2xl"
              />
            </div>
          ) : (
            <div
              key={index}
              className="flex-shrink-0 w-72 h-80 rounded-2xl overflow-hidden"
            >
              <img
                src={photo}
                alt={`${altPrefix} ${index + 1}`}
                className="w-full h-full object-cover"
              />
            </div>
          )
        ))}
      </div>
      <button
        onClick={() => scroll("right")}
        className="absolute right-0 top-1/2 -translate-y-1/2 z-10 bg-background/80 hover:bg-background rounded-full p-2 shadow-md -mr-4"
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
        <div className="relative container mx-auto px-4 py-24 md:py-32 text-center">
          <h1 className="font-serif text-4xl md:text-6xl lg:text-7xl font-light tracking-wide mb-6">
            NOT YOUR TRADITIONAL CAKES
          </h1>
          <p className="text-lg md:text-xl max-w-3xl mx-auto opacity-90 mb-10 font-light">
            Signature whipped cream cakes, delicately crafted, beautifully designed, and irresistibly light.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button
              size="lg"
              className="bg-primary hover:bg-primary/90 text-primary-foreground px-8 py-6 text-lg rounded-full font-medium tracking-wide"
              asChild
            >
              <Link to="/catalog">Shop the Catalog</Link>
            </Button>
            <Button
              size="lg"
              className="bg-primary hover:bg-primary/90 text-primary-foreground px-8 py-6 text-lg rounded-full font-medium tracking-wide"
              asChild
            >
              <Link to="/catalog">Customize Your Cake</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 bg-background">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
            {features.map((feature) => (
              <div key={feature.title} className="text-center flex flex-col items-center">
                <div className="w-[240px] h-[240px] flex items-center justify-center mb-6 overflow-hidden">
                  <img
                    src={feature.image}
                    alt={feature.title}
                    className={`max-w-full max-h-full object-contain ${feature.scaleClass}`}
                  />
                </div>
                <h3 className="font-serif text-2xl md:text-3xl text-foreground mb-4 whitespace-nowrap min-h-[3rem] flex items-center justify-center">
                  {feature.title}
                </h3>
                <p className="text-muted-foreground leading-relaxed">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How to Order Section */}
      <section className="py-20" style={{ backgroundColor: '#FFE4EC' }}>
        <div className="container mx-auto px-4 max-w-3xl">
          <h2 className="font-serif text-4xl md:text-5xl text-center font-bold mb-16" style={{ color: '#000000' }}>
            HOW TO ORDER
          </h2>
          <div className="space-y-6">
            <div className="flex items-start gap-4">
              <span className="text-2xl" style={{ color: '#000000' }}>①</span>
              <div>
                <h3 className="font-medium text-lg" style={{ color: '#000000' }}>Choose your date</h3>
                <p style={{ color: '#000000' }} className="opacity-80">Select your pickup date (minimum 4 days in advance)</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <span className="text-2xl" style={{ color: '#000000' }}>②</span>
              <div>
                <h3 className="font-medium text-lg" style={{ color: '#000000' }}>Choose size, shape & flavor</h3>
                <p style={{ color: '#000000' }} className="opacity-80">Pick the cake size, shape, and flavor</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <span className="text-2xl" style={{ color: '#000000' }}>③</span>
              <div>
                <h3 className="font-medium text-lg" style={{ color: '#000000' }}>Choose a cake style</h3>
                <p style={{ color: '#000000' }} className="opacity-80">This is a base style — you can upload a reference image later</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <span className="text-2xl" style={{ color: '#000000' }}>④</span>
              <div>
                <h3 className="font-medium text-lg" style={{ color: '#000000' }}>Add text (optional)</h3>
                <p style={{ color: '#000000' }} className="opacity-80">Choose your message, font, and color</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <span className="text-2xl" style={{ color: '#000000' }}>⑤</span>
              <div>
                <h3 className="font-medium text-lg" style={{ color: '#000000' }}>Add extras ✨</h3>
                <p style={{ color: '#000000' }} className="opacity-80">Customize with extra details and candles</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <span className="text-2xl" style={{ color: '#000000' }}>⑥</span>
              <div>
                <h3 className="font-medium text-lg" style={{ color: '#000000' }}>Leave a note 💬</h3>
                <p style={{ color: '#000000' }} className="opacity-80">Tell us anything important about your order</p>
              </div>
            </div>
          </div>
          <div className="mt-10 p-6 bg-background/50 rounded-2xl">
            <h3 className="font-medium mb-3" style={{ color: '#000000' }}>Good to know</h3>
            <ul className="space-y-2 text-sm" style={{ color: '#000000' }}>
              <li>Fully booked dates cannot be selected</li>
              <li>Complex designs may require additional fees</li>
            </ul>
          </div>
        </div>
      </section>


      {/* Customers Section */}
      <section className="py-20 bg-cream">
        <div className="container mx-auto px-4">
          <h2 className="font-serif text-4xl md:text-5xl text-center text-foreground mb-16">
            OUR CUSTOMERS
          </h2>
          <PhotoCarousel photos={customerPhotos} altPrefix="Happy customer" />
        </div>
      </section>

      {/* Customer Comments Section */}
      <section className="py-20 bg-background">
        <div className="container mx-auto px-4">
          <h2 className="font-serif text-4xl md:text-5xl text-center text-foreground mb-16">
            CUSTOMER COMMENTS
          </h2>
          <PhotoCarousel photos={customerCommentPhotos} altPrefix="Customer comment" contain />
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 bg-background">
        <div className="container mx-auto px-4 text-center">
          <h2 className="font-serif text-3xl md:text-4xl text-foreground mb-6">
            Ready to create your perfect cake?
          </h2>
          <p className="text-muted-foreground mb-8 max-w-2xl mx-auto">
            Choose your size, shape, flavor, and extras to design a cake that's
            uniquely yours.
          </p>
          <Button
            size="lg"
            className="bg-primary hover:bg-primary/90 text-primary-foreground px-8 py-6 text-lg rounded-none font-medium tracking-wide"
            asChild
          >
            <Link to="/catalog">Customize Your Cake</Link>
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-foreground text-primary-foreground py-12">
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
          <p className="text-xs opacity-50">
            Website powered by{" "}
            <a 
              href="https://lovable.dev" 
              target="_blank" 
              rel="noopener noreferrer"
              className="underline hover:opacity-100"
            >
              Lovable
            </a>
          </p>
        </div>
      </footer>
    </Layout>
  );
};

export default Index;
