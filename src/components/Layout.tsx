import { useState, useRef, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { ChevronDown, Menu, X } from "lucide-react";
import CartIcon from "@/components/CartIcon";
import logoBrown from "@/assets/logo-brown.png";
import logoCream from "@/assets/logo-cream.png";

interface LayoutProps {
  children: React.ReactNode;
  hideNav?: boolean;
  /** Home page: transparent header over the hero, yellow after scrolling */
  overlayHero?: boolean;
}

type NavItem = { to: string; label: string } | { label: string; children: { to: string; label: string }[] };

const navLinks: NavItem[] = [
  { to: "/", label: "Home" },
  { to: "/catalog", label: "Bento Cakes" },
  { to: "/dot-cakes", label: "Dot Cakes" },

  { to: "/kit-bento-cake", label: "DIY Kit" },
  { to: "/inspiration", label: "Inspiration" },
  {
    label: "Corporate & Press",
    children: [
      { to: "/corporate-event", label: "Corporate Event" },
      { to: "/community-press", label: "Press" },
    ],
  },
  { to: "/faq", label: "FAQ" },
  { to: "/contact", label: "Contact" },
];

/* Flat list for the mobile menu — every page reachable, Workshop included */
const mobileLinks: { to: string; label: string }[] = [
  { to: "/", label: "Home" },
  { to: "/catalog", label: "Bento Cakes" },
  { to: "/dot-cakes", label: "Dot Cakes" },
  { to: "/kit-bento-cake", label: "DIY Kit" },
  { to: "/inspiration", label: "Inspiration" },
  { to: "/workshop", label: "Workshop" },
  { to: "/corporate-event", label: "Corporate & Press" },
  { to: "/faq", label: "FAQ" },
  { to: "/contact", label: "Contact" },
];

const navLinkClass = (light: boolean) =>
  cn(
    "uppercase tracking-[0.18em] text-xs font-medium transition-colors",
    light ? "text-cream" : "text-foreground"
  );

const DropdownNav = ({
  item,
  isActive,
  light,
}: {
  item: Extract<NavItem, { children: any[] }>;
  isActive: (to: string) => boolean;
  light: boolean;
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const anyActive = item.children.some((c) => isActive(c.to));

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "inline-flex items-center gap-1",
          navLinkClass(light),
          anyActive ? "font-semibold" : "hover:opacity-70"
        )}
      >
        {item.label}
        <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 bg-background border border-border rounded-lg shadow-lg py-1 min-w-[180px] z-50">
          {item.children.map((child) => (
            <Link
              key={child.to}
              to={child.to}
              onClick={() => setOpen(false)}
              className={cn(
                "block px-4 py-2 text-xs uppercase tracking-[0.15em] text-foreground transition-colors",
                isActive(child.to) ? "font-semibold bg-muted" : "hover:bg-muted"
              )}
            >
              {child.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
};

const Layout = ({ children, hideNav = false, overlayHero = false }: LayoutProps) => {
  const location = useLocation();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

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
    if ("children" in item) {
      return <DropdownNav key={item.label} item={item} isActive={isActive} light={light} />;
    }
    return (
      <Link
        key={item.to}
        to={item.to}
        className={cn(
          navLinkClass(light),
          isActive(item.to) ? "font-semibold" : "hover:opacity-70"
        )}
      >
        {item.label}
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
        <div className="container mx-auto px-4 flex items-center justify-between py-3">
          {/* Mobile: hamburger left */}
          {!hideNav && (
            <button
              onClick={() => setMenuOpen(true)}
              className="md:hidden p-2 -ml-2"
              aria-label="Open menu"
            >
              <Menu className={cn("w-6 h-6", light ? "text-cream" : "text-foreground")} strokeWidth={1.5} />
            </button>
          )}

          {/* Logo: centred on mobile, left on desktop */}
          <Link
            to="/"
            className="flex-shrink-0 absolute left-1/2 -translate-x-1/2 md:static md:translate-x-0"
          >
            <img
              src={light ? logoCream : logoBrown}
              alt="Bento Cake Studio"
              className="h-9 md:h-14 w-auto"
            />
          </Link>

          {/* Desktop nav */}
          {!hideNav && (
            <nav className="hidden md:flex items-center gap-7">
              {navLinks.map((link) => renderNavItem(link))}
            </nav>
          )}

          <div className={light ? "[&_svg]:text-cream" : ""}>
            <CartIcon />
          </div>
        </div>
      </header>

      {/* Mobile menu — full-screen brand-yellow panel */}
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
            <img src={logoBrown} alt="Bento Cake Studio" className="h-9 w-auto absolute left-1/2 -translate-x-1/2" />
            <div className="w-6" />
          </div>
          <nav className="flex-1 overflow-y-auto py-8 px-6">
            {mobileLinks.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                onClick={() => setMenuOpen(false)}
                className={cn(
                  "block py-4 border-b border-border/30 uppercase tracking-[0.105em] text-base font-medium",
                  isActive(link.to) ? "text-primary font-semibold" : "text-foreground"
                )}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      )}

      {children}
    </div>
  );
};

export default Layout;
