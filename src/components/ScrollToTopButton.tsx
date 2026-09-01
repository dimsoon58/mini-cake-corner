import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";
import { useLang } from "@/context/LanguageContext";

/**
 * Mobile-only floating button that scrolls the page back to the top.
 * Appears once the visitor has scrolled past one screen height.
 */
const ScrollToTopButton = () => {
  const { t } = useLang();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 600);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!visible) return null;

  return (
    <button
      type="button"
      aria-label={t("Back to top", "Remonter en haut")}
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className="md:hidden fixed bottom-6 right-5 z-[60] h-12 w-12 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center transition-opacity duration-300 active:opacity-70"
    >
      <ArrowUp className="h-5 w-5" strokeWidth={1.75} />
    </button>
  );
};

export default ScrollToTopButton;
