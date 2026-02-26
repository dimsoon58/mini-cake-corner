import { useState, useRef, useEffect, useCallback } from "react";
import Layout from "@/components/Layout";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

const PINTEREST_URL = "https://ch.pinterest.com/bentocakestudiosnc/_saved/";
const IMAGES_PER_PAGE = 12;

// Import all gallery images
import img1 from "@/assets/customer-1.jpg";
import img2 from "@/assets/customer-2.jpg";
import img3 from "@/assets/customer-3.jpg";
import img4 from "@/assets/customer-4.jpg";
import img5 from "@/assets/customer-5.jpg";
import img6 from "@/assets/customer-6.jpg";
import img7 from "@/assets/customer-7.jpg";
import img8 from "@/assets/customer-8.jpg";
import img9 from "@/assets/customer-9.jpg";
import img10 from "@/assets/customer-10.jpg";
import img11 from "@/assets/customer-11.jpg";
import img12 from "@/assets/customer-12.jpg";
import img13 from "@/assets/customer-13.jpg";
import img14 from "@/assets/customer-14.jpg";
import img15 from "@/assets/customer-15.jpg";
import img16 from "@/assets/customer-16.jpg";
import img17 from "@/assets/customer-17.jpg";
import img18 from "@/assets/customer-18.jpg";
import img19 from "@/assets/customer-19.jpg";
import img20 from "@/assets/customer-20.jpg";
import img21 from "@/assets/customer-21.jpg";
import img22 from "@/assets/customer-22.jpg";
import img23 from "@/assets/customer-23.jpg";
import img24 from "@/assets/customer-24.jpg";
import img25 from "@/assets/customer-25.jpg";
import img26 from "@/assets/customer-26.jpg";
import img27 from "@/assets/customer-27.jpg";
import img28 from "@/assets/customer-28.jpg";
import img29 from "@/assets/customer-29.jpg";
import img30 from "@/assets/customer-30.jpg";
import img31 from "@/assets/customer-31.jpg";
import img32 from "@/assets/customer-32.jpg";
import img33 from "@/assets/customer-33.jpg";
import img34 from "@/assets/customer-34.jpg";

const ALL_IMAGES = [
  img1, img2, img3, img4, img5, img6, img7, img8, img9, img10,
  img11, img12, img13, img14, img15, img16, img17, img18, img19, img20,
  img21, img22, img23, img24, img25, img26, img27, img28, img29, img30,
  img31, img32, img33, img34,
];

const LazyImage = ({ src, index }: { src: string; index: number }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className="aspect-square rounded-lg overflow-hidden bg-muted"
    >
      {isVisible && (
        <img
          src={src}
          alt={`Création Bento Cake ${index + 1}`}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          className={`w-full h-full object-cover transition-all duration-500 hover:scale-105 ${
            loaded ? "opacity-100" : "opacity-0"
          }`}
        />
      )}
    </div>
  );
};

const Inspiration = () => {
  const [visibleCount, setVisibleCount] = useState(IMAGES_PER_PAGE);
  const visibleImages = ALL_IMAGES.slice(0, visibleCount);
  const hasMore = visibleCount < ALL_IMAGES.length;

  const loadMore = useCallback(() => {
    setVisibleCount((prev) => Math.min(prev + IMAGES_PER_PAGE, ALL_IMAGES.length));
  }, []);

  return (
    <Layout>
      <main className="container mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <h1 className="font-serif text-4xl md:text-5xl text-foreground mb-4">
            Inspiration
          </h1>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Explorez nos créations et trouvez l'inspiration pour votre prochain gâteau
          </p>
        </div>

        {/* Gallery Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
          {visibleImages.map((src, i) => (
            <LazyImage key={i} src={src} index={i} />
          ))}
        </div>

        {/* Load More */}
        {hasMore && (
          <div className="flex justify-center mt-12">
            <Button
              variant="outline"
              size="lg"
              onClick={loadMore}
              className="px-10"
            >
              Voir plus
            </Button>
          </div>
        )}

        {/* Pinterest Link */}
        <div className="flex justify-center mt-16 mb-4">
          <a
            href={PINTEREST_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex flex-col items-center gap-6 p-10 rounded-2xl border border-border/50 hover:border-primary/50 bg-secondary/20 hover:bg-secondary/40 transition-all duration-300 max-w-lg w-full"
          >
            <svg viewBox="0 0 24 24" className="w-12 h-12 text-[#E60023]" fill="currentColor">
              <path d="M12 0C5.373 0 0 5.373 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 01.083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.632-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0z"/>
            </svg>
            <div className="text-center">
              <h2 className="font-serif text-2xl text-foreground mb-2 group-hover:text-primary transition-colors">
                Notre Board Pinterest
              </h2>
              <p className="text-muted-foreground text-sm mb-4">
                Découvrez toutes nos créations et inspirations
              </p>
              <span className="inline-flex items-center gap-2 text-sm font-medium text-primary">
                Voir sur Pinterest <ExternalLink className="w-4 h-4" />
              </span>
            </div>
          </a>
        </div>
      </main>
    </Layout>
  );
};

export default Inspiration;
