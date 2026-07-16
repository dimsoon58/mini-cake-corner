import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import Layout from "@/components/Layout";
import dotCakesImage from "@/assets/home-cat-dots.png";

const DotCakes = () => {
  useEffect(() => {
    document.title = "Dot Cakes – Bento Cake Studio";
    return () => {
      document.title = "Bento Cake Studio Geneva";
    };
  }, []);

  return (
    <Layout>
      <div className="container mx-auto px-4 py-16">
        <h1 className="font-sans text-4xl md:text-5xl text-center tracking-[0.105em] uppercase text-foreground mb-6">
          DOT CAKES
        </h1>
        <p className="text-center text-muted-foreground mb-16 max-w-2xl mx-auto">
          Bite-sized cakes topped with a cloud of colourful sprinkles — perfect
          for parties, gifts and moments when one cake just isn't enough.
        </p>

        <div className="max-w-3xl mx-auto">
          <div className="aspect-[16/9] overflow-hidden mb-10">
            <img
              src={dotCakesImage}
              alt="Dot cakes with colourful sprinkles"
              className="w-full h-full object-cover"
            />
          </div>
          <div className="text-center">
            <h2 className="font-sans text-[13px] tracking-[0.105em] font-semibold uppercase text-foreground mb-4">
              Coming soon
            </h2>
            <p className="text-muted-foreground text-sm mb-8 max-w-md mx-auto">
              Our dot cakes collection is on its way. In the meantime, get in
              touch to order them directly, or explore our bento cakes.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button
                className="rounded-none bg-primary hover:bg-primary/90 text-primary-foreground tracking-[0.105em] px-8"
                asChild
              >
                <Link to="/contact">ORDER DOT CAKES</Link>
              </Button>
              <Button
                variant="outline"
                className="rounded-none border-primary text-primary hover:bg-primary hover:text-primary-foreground tracking-[0.105em] px-8"
                asChild
              >
                <Link to="/catalog">EXPLORE BENTO CAKES</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default DotCakes;
