import { useState, useRef, useEffect, useCallback } from "react";
import Layout from "@/components/Layout";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

const PINTEREST_URL = "https://ch.pinterest.com/bentocakestudiosnc/_saved/";
const IMAGES_PER_PAGE = 12;

import img1 from "@/assets/inspiration-1.jpg";
import img2 from "@/assets/inspiration-2.jpg";
import img3 from "@/assets/inspiration-3.jpg";
import img4 from "@/assets/inspiration-4.jpg";
import img5 from "@/assets/inspiration-5.jpg";
import img6 from "@/assets/inspiration-6.jpg";
import img7 from "@/assets/inspiration-7.jpg";
import img8 from "@/assets/inspiration-8.jpg";
import img9 from "@/assets/inspiration-9.jpg";
import img10 from "@/assets/inspiration-10.jpg";
import img11 from "@/assets/inspiration-11.jpg";
import img12 from "@/assets/inspiration-12.jpg";
import img13 from "@/assets/inspiration-13.jpg";
import img14 from "@/assets/inspiration-14.jpg";
import img15 from "@/assets/inspiration-15.jpg";

const ALL_IMAGES = [
  img1, img2, img3, img4, img5, img6, img7, img8,
  img9, img10, img11, img12, img13, img14, img15,
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
    <a
      href={PINTEREST_URL}
      target="_blank"
      rel="noopener noreferrer"
      ref={ref as any}
      className="block aspect-square rounded-md overflow-hidden bg-muted group"
    >
      {isVisible && (
        <img
          src={src}
          alt={`Bento Cake creation ${index + 1}`}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          className={`w-full h-full object-cover transition-all duration-500 group-hover:scale-105 group-hover:shadow-lg ${
            loaded ? "opacity-100" : "opacity-0"
          }`}
        />
      )}
    </a>
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
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="font-serif text-4xl md:text-5xl text-foreground mb-4">
            Inspiration
          </h1>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Explore our creations and find inspiration for your next cake
          </p>
        </div>

        {/* Pinterest CTA */}
        <div className="flex justify-center mb-14">
          <a
            href={PINTEREST_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex flex-col items-center gap-4 p-8 rounded-2xl border border-border/50 hover:border-primary/50 bg-secondary/20 hover:bg-secondary/40 transition-all duration-300 max-w-md w-full"
          >
            <svg viewBox="0 0 24 24" className="w-10 h-10 text-[#E60023]" fill="currentColor">
              <path d="M12 0C5.373 0 0 5.373 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 01.083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.632-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0z"/>
            </svg>
            <div className="text-center">
              <h2 className="font-serif text-xl text-foreground mb-1 group-hover:text-primary transition-colors">
                Our Pinterest Board
              </h2>
              <p className="text-muted-foreground text-sm">
                Discover all our creations and inspirations
              </p>
            </div>
          </a>
        </div>

        {/* Gallery Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
          {visibleImages.map((src, i) => (
            <LazyImage key={i} src={src} index={i} />
          ))}
        </div>

        {/* Load More / View on Pinterest */}
        {hasMore ? (
          <div className="flex justify-center mt-12">
            <Button
              onClick={loadMore}
              size="lg"
              className="bg-primary hover:bg-primary/90 text-primary-foreground px-10"
            >
              Load More
            </Button>
          </div>
        ) : (
          <div className="flex justify-center mt-12">
            <a href={PINTEREST_URL} target="_blank" rel="noopener noreferrer">
              <Button
                size="lg"
                className="bg-primary hover:bg-primary/90 text-primary-foreground px-10"
              >
                View on Pinterest <ExternalLink className="w-4 h-4 ml-1" />
              </Button>
            </a>
          </div>
        )}
      </main>
    </Layout>
  );
};

export default Inspiration;
