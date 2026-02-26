import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Layout from "@/components/Layout";
import logo from "@/assets/logo-new.png";
import heroBg from "@/assets/hero-bg.jpg";
import cakeHomemade from "@/assets/cake-homemade.png";
import cakeFresh from "@/assets/cake-fresh.png";
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

const customerPhotos = [
  customer3, customer4, customer5,
  customer7, customer9, customer10,
  customer11, customer12, customer13, customer15,
  customer16, customer17, customer18, customer19, customer20,
  customer21, customer22, customer23, customer24, customer25,
  customer26, customer27, customer28, customer29,
  customer30, customer32, customer33, customer34,
];

const features = [
  {
    title: "Homemade goodness",
    description:
      "When you think of warmth, love, and comfort in a bite, think homemade. Our cakes are all about that authentic taste, paired with a cheeky wink.",
    image: cakeHomemade,
  },
  {
    title: "Trendy & personalized",
    description:
      "It's modern, it's unique and it's trendy. Ditch that regular cake and get a personalized piece of art, made with love and passion just for you.",
    image: cakeTrendy,
  },
  {
    title: "Fresh ingredients",
    description:
      "Because we believe that our cakes should be fresh, nutritious and prepared with care, we only use natural & fresh ingredients with no preservatives.",
    image: cakeFresh,
  },
];

const CustomerCarousel = () => {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: "left" | "right") => {
    if (!scrollRef.current) return;
    const scrollAmount = 320;
    scrollRef.current.scrollBy({
      left: direction === "left" ? -scrollAmount : scrollAmount,
      behavior: "smooth",
    });
  };

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
        className="flex gap-4 overflow-x-auto scrollbar-hide scroll-smooth px-4"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {customerPhotos.map((photo, index) => (
          <div
            key={index}
            className="flex-shrink-0 w-72 h-80 rounded-2xl overflow-hidden"
          >
            <img
              src={photo}
              alt={`Happy customer ${index + 1}`}
              className="w-full h-full object-cover"
            />
          </div>
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
            Combining creativity and personalization to bring you unique cakes
            that are not only beautiful, but taste just as good.
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
              <Link to="/customize">Customize Your Cake</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 bg-background">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
            {features.map((feature) => (
              <div key={feature.title} className="text-center">
                <img
                  src={feature.image}
                  alt={feature.title}
                  className="h-32 md:h-40 mx-auto mb-6 object-contain"
                />
                <h3 className="font-serif text-2xl md:text-3xl text-foreground mb-4">
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
          <h2 className="font-serif text-4xl md:text-5xl text-center font-bold mb-16" style={{ color: '#78020E' }}>
            HOW TO ORDER
          </h2>
          <div className="space-y-6">
            <div className="flex items-start gap-4">
              <span className="text-2xl" style={{ color: '#78020E' }}>①</span>
              <div>
                <h3 className="font-medium text-lg" style={{ color: '#78020E' }}>Choose your date</h3>
                <p style={{ color: '#78020E' }} className="opacity-80">Select your pickup date (minimum 4 days in advance)</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <span className="text-2xl" style={{ color: '#78020E' }}>②</span>
              <div>
                <h3 className="font-medium text-lg" style={{ color: '#78020E' }}>Choose size, shape & flavor</h3>
                <p style={{ color: '#78020E' }} className="opacity-80">Pick the cake size, shape, and flavor</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <span className="text-2xl" style={{ color: '#78020E' }}>③</span>
              <div>
                <h3 className="font-medium text-lg" style={{ color: '#78020E' }}>Choose a cake style</h3>
                <p style={{ color: '#78020E' }} className="opacity-80">This is a base style — you can upload a reference image later</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <span className="text-2xl" style={{ color: '#78020E' }}>④</span>
              <div>
                <h3 className="font-medium text-lg" style={{ color: '#78020E' }}>Add text (optional)</h3>
                <p style={{ color: '#78020E' }} className="opacity-80">Choose your message, font, and color</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <span className="text-2xl" style={{ color: '#78020E' }}>⑤</span>
              <div>
                <h3 className="font-medium text-lg" style={{ color: '#78020E' }}>Add extras ✨</h3>
                <p style={{ color: '#78020E' }} className="opacity-80">Customize with extra details and candles</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <span className="text-2xl" style={{ color: '#78020E' }}>⑥</span>
              <div>
                <h3 className="font-medium text-lg" style={{ color: '#78020E' }}>Leave a note 💬</h3>
                <p style={{ color: '#78020E' }} className="opacity-80">Tell us anything important about your order</p>
              </div>
            </div>
          </div>
          <div className="mt-10 p-6 bg-background/50 rounded-2xl">
            <h3 className="font-medium mb-3" style={{ color: '#78020E' }}>Good to know</h3>
            <ul className="space-y-2 text-sm" style={{ color: '#78020E' }}>
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
          <CustomerCarousel />
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
            <Link to="/customize">Customize Your Cake</Link>
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-foreground text-primary-foreground py-12">
        <div className="container mx-auto px-4 text-center">
          <img
            src={logo}
            alt="Bento Cake Studio"
            className="h-16 mx-auto mb-6 brightness-200"
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
