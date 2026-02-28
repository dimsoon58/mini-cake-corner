import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import CartIcon from "@/components/CartIcon";
import logo from "@/assets/logo-new.png";

interface LayoutProps {
  children: React.ReactNode;
  hideNav?: boolean;
}

const navLinks = [
  { to: "/", label: "Home", isHome: true },
  { to: "/catalog", label: "Catalog" },
  { to: "/customize", label: "Custom" },
  { to: "/kit-bento-cake", label: "Kit Bento Cake" },
  { to: "/inspiration", label: "Inspiration" },
  { to: "/community-press", label: "Press" },
  { to: "/corporate-event", label: "Corporate Event" },
  { to: "/faq", label: "FAQ" },
  { to: "/contact", label: "Contact" },
];

const Layout = ({ children, hideNav = false }: LayoutProps) => {
  const location = useLocation();

  const isActive = (to: string) => {
    if (to === "/") return location.pathname === "/";
    return location.pathname === to;
  };

  return (
    <div className="min-h-screen bg-background font-sans">
      {/* Header */}
      <header className="bg-background pt-6 pb-0">
        <div className="container mx-auto px-4 flex items-center justify-between pb-0">
          <div className="w-12" /> {/* Spacer for centering */}
          <Link to="/">
            <img src={logo} alt="Bento Cake Studio" className="h-44 md:h-64 -mb-6 md:-mb-10" style={{ mixBlendMode: 'multiply' }} />
          </Link>
          <CartIcon />
        </div>

        {/* Navigation Bar */}
        {!hideNav && (
          <>
            {/* Desktop Navigation */}
            <nav className="hidden md:flex justify-center gap-8 mt-3 border-b border-border/30 pb-4">
              {navLinks.map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  className={cn(
                    "transition-colors font-medium",
                    isActive(link.to)
                      ? "font-semibold"
                      : "hover:opacity-70"
                  )}
                  style={{ color: '#000000' }}
                >
                  {link.label}
                </Link>
              ))}
            </nav>

            {/* Mobile Navigation */}
            <nav className="md:hidden flex overflow-x-auto gap-4 mt-2 pb-4 px-4 border-b border-border/30" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
              {navLinks.map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  className={cn(
                    "text-sm font-medium transition-colors",
                    isActive(link.to)
                      ? "font-semibold"
                      : "hover:opacity-70"
                  )}
                  style={{ color: '#000000' }}
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </>
        )}
      </header>

      {children}
    </div>
  );
};

export default Layout;
