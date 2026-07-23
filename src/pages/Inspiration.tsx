import { useState, useRef, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import Layout from "@/components/Layout";
import { ExternalLink, ShoppingBag } from "lucide-react";
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
import img16 from "@/assets/inspiration-16.jpg";
import img17 from "@/assets/inspiration-17.jpg";
import img18 from "@/assets/inspiration-18.jpg";
import img19 from "@/assets/inspiration-19.jpg";
import img20 from "@/assets/inspiration-20.jpg";
import img21 from "@/assets/inspiration-21.jpg";
import img22 from "@/assets/inspiration-22.jpg";
import img23 from "@/assets/inspiration-23.jpg";
import img24 from "@/assets/inspiration-24.jpg";
import img25 from "@/assets/inspiration-25.jpg";
import img26 from "@/assets/inspiration-26.jpg";
import img27 from "@/assets/inspiration-27.jpg";
import img28 from "@/assets/inspiration-28.jpg";
import img29 from "@/assets/inspiration-29.jpg";
import img30 from "@/assets/inspiration-30.jpg";
import img31 from "@/assets/inspiration-31.jpg";
import img32 from "@/assets/inspiration-32.jpg";
import img33 from "@/assets/inspiration-33.jpg";
import img34 from "@/assets/inspiration-34.jpg";
import img35 from "@/assets/inspiration-35.jpg";
import img36 from "@/assets/inspiration-36.jpg";
import img37 from "@/assets/inspiration-37.jpg";
import img38 from "@/assets/inspiration-38.jpg";
import img39 from "@/assets/inspiration-39.jpg";
import img40 from "@/assets/inspiration-40.jpg";
import img41 from "@/assets/inspiration-41.jpg";
import img42 from "@/assets/inspiration-42.jpg";
import img43 from "@/assets/inspiration-43.jpg";
import img44 from "@/assets/inspiration-44.jpg";
import img45 from "@/assets/inspiration-45.jpg";
import img46 from "@/assets/inspiration-46.jpg";
import img47 from "@/assets/inspiration-47.jpg";
import img48 from "@/assets/inspiration-48.jpg";
import img49 from "@/assets/inspiration-49.jpg";
import img50 from "@/assets/inspiration-50.jpg";
import img51 from "@/assets/inspiration-51.jpg";
import img52 from "@/assets/inspiration-52.jpg";
import img53 from "@/assets/inspiration-53.jpg";
import img54 from "@/assets/inspiration-54.jpg";
import img55 from "@/assets/inspiration-55.jpg";
import img56 from "@/assets/inspiration-56.jpg";
import img57 from "@/assets/inspiration-57.jpg";
import img58 from "@/assets/inspiration-58.jpg";
import img59 from "@/assets/inspiration-59.jpg";
import img60 from "@/assets/inspiration-60.jpg";
import img61 from "@/assets/inspiration-61.jpg";
import img62 from "@/assets/inspiration-62.jpg";
import img63 from "@/assets/inspiration-63.jpg";
import img64 from "@/assets/inspiration-64.jpg";
import img65 from "@/assets/inspiration-65.jpg";
import img66 from "@/assets/inspiration-66.jpg";
import img67 from "@/assets/inspiration-67.jpg";
import img68 from "@/assets/inspiration-68.jpg";
import img69 from "@/assets/inspiration-69.jpg";
import img70 from "@/assets/inspiration-70.jpg";
import img71 from "@/assets/inspiration-71.jpg";
import img72 from "@/assets/inspiration-72.jpg";
import img73 from "@/assets/inspiration-73.jpg";
import img74 from "@/assets/inspiration-74.jpg";
import img75 from "@/assets/inspiration-75.jpg";
import img76 from "@/assets/inspiration-76.jpg";
import img77 from "@/assets/inspiration-77.jpg";
import img78 from "@/assets/inspiration-78.jpg";
import img79 from "@/assets/inspiration-79.jpg";
import img80 from "@/assets/inspiration-80.jpg";
import img81 from "@/assets/inspiration-81.jpg";
import img82 from "@/assets/inspiration-82.jpg";
import img83 from "@/assets/inspiration-83.jpg";

export const ALL_IMAGES = [
  img1, img2, img3, img4, img5, img6, img7, img8,
  img9, img10, img11, img12, img13, img14, img15,
  img16, img17, img18, img19, img20, img21, img22,
  img23, img24, img25, img26, img27, img28, img29,
  img30, img31, img32, img33, img34, img35, img36,
  img37, img38, img39, img40, img41, img42, img43, img44,
  img45, img46, img47, img48, img49, img50, img51, img52,
  img53, img54, img55, img56, img57, img58, img59, img60,
  img61, img62, img63, img64, img65, img66, img67, img68,
  img69, img70, img71, img72, img73, img74, img75, img76,
  img77, img78, img79, img80, img81, img82, img83,
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
    <div ref={ref} className="relative aspect-square rounded-none overflow-hidden bg-muted group">
      <a href={PINTEREST_URL} target="_blank" rel="noopener noreferrer" className="block w-full h-full">
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
      <Link
        to={`/catalog?inspiration=${index}`}
        aria-label="Order this cake"
        title="Order this cake"
        className="absolute bottom-2 right-2 bg-background/90 hover:bg-primary text-foreground hover:text-primary-foreground p-2.5 rounded-none shadow-md transition-colors"
      >
        <ShoppingBag className="w-4 h-4" strokeWidth={1.5} />
      </Link>
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
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="font-sans uppercase tracking-[0.105em] text-4xl md:text-5xl text-foreground mb-4">
            Inspiration
          </h1>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            A gallery of our favourite creations to inspire your next
            celebration.<br />More ideas?
          </p>
        </div>

        {/* Pinterest CTA */}
        <div className="flex justify-center mb-14">
          <a
            href={PINTEREST_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-center gap-3 px-8 py-4 rounded-none bg-[#E60023] hover:bg-[#c7001f] text-white font-semibold text-lg shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105"
          >
            <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor">
              <path d="M12 0C5.373 0 0 5.373 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 01.083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.632-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0z"/>
            </svg>
            Follow us on Pinterest
            <ExternalLink className="w-5 h-5 opacity-80" />
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
              className="bg-primary hover:bg-primary/90 text-primary-foreground px-10 py-6 text-base font-medium tracking-wide rounded-full"
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
