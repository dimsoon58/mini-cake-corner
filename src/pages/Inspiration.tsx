import { useState, useRef, useEffect, useCallback } from "react";
import Layout from "@/components/Layout";
import { ExternalLink, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import Catalog from "@/pages/Catalog";
import { useLang } from "@/context/LanguageContext";
import { ALL_IMAGES } from "@/data/inspirations";

const PINTEREST_URL = "https://ch.pinterest.com/bentocakestudiosnc/_saved/";
const IMAGES_PER_PAGE = 12;


// Chaque inspiration porte son supplement de prix par taille.
// Une taille absente n'est pas proposee pour cette creation.

const LazyImage = ({ src, index, onOpen }: { src: string; index: number; onOpen: (index: number) => void }) => {
  const { t } = useLang();
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
      <button type="button" onClick={() => onOpen(index)} className="block w-full h-full" aria-label={t("Order this cake", "Commander ce gâteau")}>
        {isVisible && (
          <img
            src={src}
            alt={t(`Bento Cake creation ${index + 1}`, `Création Bento Cake ${index + 1}`)}
            loading="lazy"
            decoding="async"
            onLoad={() => setLoaded(true)}
            className={`w-full h-full object-cover transition-all duration-500 group-hover:scale-105 group-hover:shadow-lg ${
              loaded ? "opacity-100" : "opacity-0"
            }`}
          />
        )}
      </button>
      <button
        type="button"
        onClick={() => onOpen(index)}
        aria-label={t("Order this cake", "Commander ce gâteau")}
        title={t("Order this cake", "Commander ce gâteau")}
        className="absolute bottom-2 right-2 bg-background/90 hover:bg-primary text-foreground hover:text-primary-foreground p-2.5 rounded-none shadow-md transition-colors"
      >
        <ShoppingBag className="w-4 h-4" strokeWidth={1.5} />
      </button>
    </div>
  );
};

const Inspiration = () => {
  const { t } = useLang();
  const [selected, setSelected] = useState<number | null>(null);
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
          <h1 className="font-sans text-3xl sm:text-4xl md:text-6xl uppercase tracking-[0.105em] text-foreground leading-tight mb-4">
            {t("Inspirations", "Inspirations")}
          </h1>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            {t(
              "A gallery of our favourite creations to inspire your next celebration.",
              "Une galerie de nos créations préférées pour inspirer votre prochaine célébration."
            )}
          </p>
        </div>

        {/* Pinterest CTA */}
        <div className="flex justify-center mb-14">
          <a
            href={PINTEREST_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-center gap-2 px-5 py-2.5 rounded-none bg-[#E60023] hover:bg-[#c7001f] text-white font-medium text-sm shadow-md hover:shadow-lg transition-all duration-300"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4 flex-shrink-0" fill="currentColor">
              <path d="M12 0C5.373 0 0 5.373 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 01.083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.632-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0z"/>
            </svg>
            {t("Follow us on Pinterest", "Suivez-nous sur Pinterest")}
            <ExternalLink className="w-3.5 h-3.5 opacity-80 flex-shrink-0" />
          </a>
        </div>

        {/* Gallery Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
          {visibleImages.map((src, i) => (
            <LazyImage key={i} src={src} index={i} onOpen={setSelected} />
          ))}
        </div>

        {/* Load More / View on Pinterest */}
        {hasMore ? (
          <div className="flex justify-center mt-12">
            <Button
              onClick={loadMore}
              size="lg"
              className="bg-primary hover:bg-primary/90 text-primary-foreground px-10 py-2.5 text-base font-medium tracking-wide rounded-full"
            >
              {t("Load More", "Voir plus")}
            </Button>
          </div>
        ) : (
          <div className="flex justify-center mt-12">
            <a href={PINTEREST_URL} target="_blank" rel="noopener noreferrer">
              <Button
                size="lg"
                className="bg-primary hover:bg-primary/90 text-primary-foreground px-10"
              >
                {t("View on Pinterest", "Voir sur Pinterest")} <ExternalLink className="w-4 h-4 ml-1" />
              </Button>
            </a>
          </div>
        )}
      </main>

      {/* Panneau de personnalisation, ouvert par-dessus la page Inspirations */}
      {selected !== null && (
        <Catalog
          embedded
          inspirationIndex={selected}
          onEmbeddedClose={() => setSelected(null)}
        />
      )}
    </Layout>
  );
};

export default Inspiration;
