import { useState, useRef, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Menu, X, ChevronDown } from "lucide-react";
import CartIcon from "@/components/CartIcon";
import { useLang } from "@/context/LanguageContext";
import NewsletterPopup from "@/components/NewsletterPopup";
import ScrollToTopButton from "@/components/ScrollToTopButton";
import Footer from "@/components/Footer";
import AccountMenu from "@/components/AccountMenu";
import logoBrown from "@/assets/logo-brown.png";
import logoCream from "@/assets/logo-cream.png";

interface LayoutProps {
  children: React.ReactNode;
  hideNav?: boolean;
  /** Home page: transparent header over the hero, yellow after scrolling */
  overlayHero?: boolean;
}

type NavItem = { to?: string; label: string; children?: { to: string; label: string }[] };

const navFr: Record<string, string> = {
  "Home": "Accueil",
  "Cakes": "Gâteaux",
  "DIY Kit": "Kit DIY",
  "Candles": "Bougies",
  "Workshop": "Atelier",
  "Partnerships & Press": "Partenariats & Presse",
  "Partnerships": "Partenariats",
  "Inspirations": "Inspirations",
  "Printing": "Impression",
  "Corporate": "Corporate",
  "Press": "Presse",
  "About Us": "À propos",
};

const navLinks: NavItem[] = [
  { to: "/", label: "Home" },
  { label: "Cakes", children: [
    { to: "/catalog", label: "Bento Cakes" },
    { to: "/dot-cakes", label: "Dot Cakes" },
    { to: "/kit-bento-cake", label: "DIY Kit" },
    { to: "/candles", label: "Candles" },
  ] },
  { to: "/printing", label: "Printing" },
  { to: "/inspiration", label: "Inspirations" },
  { to: "/workshop", label: "Workshop" },
  { label: "Partnerships & Press", children: [
    { to: "/business", label: "Partnerships" },
    { to: "/community-press", label: "Press" },
  ] },
  { label: "About Us", children: [
    { to: "/about", label: "About Us" },
    { to: "/faq", label: "FAQ" },
    { to: "/contact", label: "Contact" },
  ] },
];

const navLinkClass = (light: boolean) =>
  cn(
    "uppercase tracking-[0.18em] text-xs font-medium transition-colors",
    light ? "text-cream" : "text-foreground"
  );

const Layout = ({ children, hideNav = false, overlayHero = false }: LayoutProps) => {
  const location = useLocation();
  const { lang, setLang, t } = useLang();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<string[]>([]);

  useEffect(() => {
    if (!overlayHero) return;
    const onScroll = () => setScrolled(window.scrollY > window.innerHeight * 0.55);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [overlayHero]);

  // Lock the page behind the mobile menu
  useEffect(() => {
    if (menuOpen) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [menuOpen]);

  // Close the menu on navigation
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  const light = overlayHero && !scrolled;

  const isActive = (to: string) => {
    if (to === "/") return location.pathname === "/";
    return location.pathname === to;
  };

  const renderNavItem = (item: NavItem) => {
    if (item.children) {
      return (
        <div key={t(item.label, navFr[item.label] ?? item.label)} className="relative group">
          <button className={cn(navLinkClass(light), "hover:opacity-70 flex items-center gap-1")}>
            {t(item.label, navFr[item.label] ?? item.label)}
            <ChevronDown className="w-3 h-3" strokeWidth={1.5} />
          </button>
          <div className="absolute left-0 top-full pt-3 hidden group-hover:block z-50">
            <div className="bg-background border border-border/40 shadow-md min-w-[170px] py-2">
              {item.children.map((child) => (
                <Link
                  key={child.to}
                  to={child.to}
                  className={cn(
                    "block px-4 py-2 uppercase tracking-[0.18em] text-xs text-foreground hover:bg-secondary/50 transition-colors",
                    isActive(child.to) ? "font-semibold" : ""
                  )}
                >
                  {t(child.label, navFr[child.label] ?? child.label)}
                </Link>
              ))}
            </div>
          </div>
        </div>
      );
    }
    return (
      <Link
        key={item.to}
        to={item.to!}
        className={cn(
          navLinkClass(light),
          isActive(item.to!) ? "font-semibold" : "hover:opacity-70"
        )}
      >
        {t(item.label, navFr[item.label] ?? item.label)}
      </Link>
    );
  };

  return (
    <div className="min-h-screen bg-background font-sans">
      <header
        className={cn(
          "z-50 transition-all duration-300",
          overlayHero ? "fixed top-0 inset-x-0" : "sticky top-0",
          light
            ? "bg-transparent border-b border-transparent"
            : "bg-background border-b border-border/40 shadow-sm"
        )}
      >
        <div className="container mx-auto px-4 grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-3 md:flex md:items-center md:justify-between md:gap-0">
          {/* Mobile: hamburger left */}
          <div className="flex items-center justify-start min-w-0 md:contents">
            {!hideNav && (
              <button
                onClick={() => setMenuOpen(true)}
                className="md:hidden p-2 -ml-2"
                aria-label="Open menu"
              >
                <Menu className={cn("w-6 h-6", light ? "text-cream" : "text-foreground")} strokeWidth={1.5} />
              </button>
            )}
          </div>

          {/* Logo: centred on mobile, left on desktop */}
          <Link
            to="/"
            className="justify-self-center min-w-0 md:flex-shrink-0 md:justify-self-auto"
          >
            <img
              src={light ? logoCream : logoBrown}
              alt="Bento Cake Studio"
              className="h-6 md:h-8 w-auto max-w-full object-contain"
            />
          </Link>

          {/* Desktop nav */}
          {!hideNav && (
            <nav className="hidden md:flex items-center gap-7">
              {navLinks.map((link) => renderNavItem(link))}
            </nav>
          )}

          <div className="flex items-center justify-end gap-1.5 md:gap-4 justify-self-end">
            <div className={cn("flex items-center gap-1 md:gap-1.5 text-xs font-medium tracking-[0.1em] uppercase", light ? "text-cream" : "text-foreground")}>
              <button onClick={() => setLang("en")} className={lang === "en" ? "font-bold" : "opacity-50 hover:opacity-80 transition-opacity"} aria-label="English">EN</button>
              <span className="opacity-40">|</span>
              <button onClick={() => setLang("fr")} className={lang === "fr" ? "font-bold" : "opacity-50 hover:opacity-80 transition-opacity"} aria-label="Francais">FR</button>
            </div>
            <div className="flex items-center">
              <AccountMenu light={light} />
            </div>
            <div className={cn("flex items-center", light ? "[&_svg]:text-cream" : "")}>
              <CartIcon />
            </div>
          </div>
        </div>
      </header>

      {/* Mobile menu, full-screen brand-yellow panel */}
      {menuOpen && (
        <div className="fixed inset-0 z-[70] bg-background flex flex-col md:hidden animate-in fade-in slide-in-from-left-4 duration-300">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
            <button
              onClick={() => setMenuOpen(false)}
              className="p-2 -ml-2"
              aria-label="Close menu"
            >
              <X className="w-6 h-6 text-foreground" strokeWidth={1.5} />
            </button>
            <img src={logoBrown} alt="Bento Cake Studio" className="h-7 w-auto absolute left-1/2 -translate-x-1/2" />
            <div className="w-6" />
          </div>
          <nav className="flex-1 overflow-y-auto py-8 px-6">
            {navLinks.map((item) =>
              item.children ? (
                <div key={item.label} className="border-b border-border/30">
                  <button
                    onClick={() =>
                      setOpenGroups((groups) =>
                        groups.includes(item.label)
                          ? groups.filter((g) => g !== item.label)
                          : [...groups, item.label]
                      )
                    }
                    className="w-full flex items-center justify-between py-4 uppercase tracking-[0.105em] text-base font-medium text-foreground"
                  >
                    <span>{t(item.label, navFr[item.label] ?? item.label)}</span>
                    <ChevronDown
                      className={cn(
                        "w-4 h-4 transition-transform duration-200",
                        openGroups.includes(item.label) ? "rotate-180" : ""
                      )}
                      strokeWidth={1.5}
                    />
                  </button>
                  {openGroups.includes(item.label) && (
                    <div className="pb-3">
                      {item.children.map((child) => (
                        <Link
                          key={child.to}
                          to={child.to}
                          onClick={() => setMenuOpen(false)}
                          className={cn(
                            "block py-3 pl-4 uppercase tracking-[0.105em] text-sm",
                            isActive(child.to) ? "text-primary font-semibold" : "text-foreground/80"
                          )}
                        >
                          {t(child.label, navFr[child.label] ?? child.label)}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <Link
                  key={item.to}
                  to={item.to!}
                  onClick={() => setMenuOpen(false)}
                  className={cn(
                    "block py-4 border-b border-border/30 uppercase tracking-[0.105em] text-base font-medium",
                    isActive(item.to!) ? "text-primary font-semibold" : "text-foreground"
                  )}
                >
                  {t(item.label, navFr[item.label] ?? item.label)}
                </Link>
              )
            )}
          </nav>
        </div>
      )}

      {children}
      <Footer />
      <NewsletterPopup />
      <ScrollToTopButton />
    </div>
  );
};

export default Layout;
