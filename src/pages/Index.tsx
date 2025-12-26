import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import logo from "@/assets/logo.png";
import heroBg from "@/assets/hero-bg.jpg";
import cakeHomemade from "@/assets/cake-homemade.png";
import cakeFresh from "@/assets/cake-fresh.png";
import cakeTrendy from "@/assets/cake-trendy.png";
import cakeMiniBento from "@/assets/cake-mini-bento.png";

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

const sizes = [
  {
    name: "Mini Bento Cake",
    size: "10 cm",
    servings: "2-4 servings",
    price: "From CHF 40",
    extra: "+CHF 3 Heart shape",
    image: cakeMiniBento,
  },
  {
    name: "Medium Cake",
    size: "15 cm",
    servings: "5-8 servings",
    price: "From CHF 80",
    extra: "+CHF 5 Heart shape",
    image: null,
  },
  {
    name: "Large Cake",
    size: "20 cm",
    servings: "12-16 servings",
    price: "From CHF 160",
    extra: "+CHF 10 Heart shape",
    image: null,
  },
];

const Index = () => {
  return (
    <div className="min-h-screen bg-background font-sans">
      {/* Header */}
      <header className="bg-background py-8">
        <div className="container mx-auto px-4 flex justify-center">
          <Link to="/">
            <img src={logo} alt="Bento Cake Studio" className="h-20 md:h-28" />
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative text-primary-foreground overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${heroBg})` }}
        />
        <div className="absolute inset-0 bg-foreground/50" />
        <div className="relative container mx-auto px-4 py-24 md:py-32 text-center">
          <h1 className="font-serif text-4xl md:text-6xl lg:text-7xl font-light tracking-wide mb-6">
            NOT YOUR TRADITIONAL CAKES
          </h1>
          <p className="text-lg md:text-xl max-w-3xl mx-auto opacity-90 mb-10 font-light">
            Combining creativity and personalization to bring you unique cakes
            that are not only beautiful, but taste just as good.
          </p>
          <Button
            size="lg"
            className="bg-primary hover:bg-primary/90 text-primary-foreground px-8 py-6 text-lg rounded-full font-medium tracking-wide"
            asChild
          >
            <Link to="/customize">Customize Your Cake</Link>
          </Button>
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

      {/* Sizes Section */}
      <section className="py-20 bg-cream">
        <div className="container mx-auto px-4">
          <h2 className="font-serif text-4xl md:text-5xl text-center text-foreground mb-16">
            SIZES
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {sizes.map((size) => (
              <div
                key={size.name}
                className="p-8 text-center shadow-sm rounded-2xl flex flex-col"
                style={{ backgroundColor: '#C9A8D3' }}
              >
                {size.image && (
                  <img
                    src={size.image}
                    alt={size.name}
                    className="h-32 md:h-40 mx-auto mb-4 object-contain"
                  />
                )}
                <h3 className="font-serif text-2xl text-foreground mb-4">
                  {size.name}
                </h3>
                <p className="text-muted-foreground mb-1">{size.size}</p>
                <p className="text-muted-foreground mb-4">{size.servings}</p>
                <p className="text-xl font-medium text-foreground mb-2">
                  {size.price}
                </p>
                <p className="text-sm text-primary mb-6">{size.extra}</p>
                <Link to="/customize">
                  <Button variant="outline" className="w-full rounded-full border-foreground text-foreground hover:bg-foreground hover:text-background">
                    Choose option
                  </Button>
                </Link>
              </div>
            ))}
          </div>
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
          <p className="text-sm opacity-70">
            © 2024 Bento Cake Studio. Made with love.
          </p>
        </div>
      </footer>
    </div>
  );
};

export default Index;
