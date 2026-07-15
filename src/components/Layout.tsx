import { useState, useRef, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import CartIcon from "@/components/CartIcon";
import logo from "@/assets/logo-brown.png";

interface LayoutProps {
  children: React.ReactNode;
  hideNav?: boolean;
}

type NavItem = { to: string; label: string } | { label: string; children: { to: string; label: string }[] };

const navLinks: NavItem[] = [
  { to: "/", label: "Home" },
  { to: "/catalog", label: "Shop Cakes" },

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

const navLinkClass =
  "uppercase tracking-[0.18em] text-xs font-medium text-foreground transition-colors";

const DropdownNav = ({ item, isActive }: { item: Extract<NavItem, { children: any[] }>; isActive: (to: string) => boolean }) => {
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
          navLinkClass,
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

const Layout = ({ children, hideNav = false }: LayoutProps) => {
  const location = useLocation();

  const isActive = (to: string) => {
    if (to === "/") return location.pathname === "/";
    return location.pathname === to;
  };

  const renderNavItem = (item: NavItem, mobile = false) => {
    if ("children" in item) {
      return <DropdownNav key={item.label} item={item} isActive={isActive} />;
    }
    return (
      <Link
        key={item.to}
        to={item.to}
        className={cn(
          navLinkClass,
          mobile && "text-[11px]",
          isActive(item.to) ? "font-semibold" : "hover:opacity-70"
        )}
      >
        {item.label}
      </Link>
    );
  };

  return (
    <div className="min-h-screen bg-background font-sans">
      <header className="bg-background border-b border-border/40">
        <div className="container mx-auto px-4 flex items-center justify-between py-3">
          <Link to="/" className="flex-shrink-0">
            <img
              src={logo}
              alt="Bento Cake Studio"
              className="h-10 md:h-14 w-auto"
            />
          </Link>

          {!hideNav && (
            <nav className="hidden md:flex items-center gap-7">
              {navLinks.map((link) => renderNavItem(link))}
            </nav>
          )}

          <CartIcon />
        </div>

        {!hideNav && (
          <nav className="md:hidden flex flex-wrap justify-center gap-x-4 gap-y-2 px-4 pb-3">
            {navLinks.map((link) => renderNavItem(link, true))}
          </nav>
        )}
      </header>

      {children}
    </div>
  );
};

export default Layout;
