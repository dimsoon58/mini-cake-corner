import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import CartIcon from "@/components/CartIcon";
import logo from "@/assets/logo.png";

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
  { to: "/community-press", label: "Community & Press" },
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
      <header className="bg-background py-6">
        <div className="container mx-auto px-4 flex items-center justify-between">
          <div className="w-12" /> {/* Spacer for centering */}
          <Link to="/">
            <img src={logo} alt="Bento Cake Studio" className="h-20 md:h-28" />
          </Link>
          <CartIcon />
        </div>

        {/* Navigation Bar */}
        {!hideNav && (
          <>
            {/* Desktop Navigation */}
            <nav className="hidden md:flex justify-center gap-8 mt-6 border-b border-border/30 pb-4">
              {navLinks.map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  className={cn(
                    "transition-colors font-medium",
                    isActive(link.to)
                      ? "text-primary"
                      : "text-foreground/80 hover:text-primary"
                  )}
                >
                  {link.label}
                </Link>
              ))}
            </nav>

            {/* Mobile Navigation */}
            <nav className="md:hidden flex justify-center gap-6 mt-4 pb-4 border-b border-border/30">
              {navLinks.map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  className={cn(
                    "text-sm font-medium transition-colors",
                    isActive(link.to)
                      ? "text-primary"
                      : "text-foreground/80 hover:text-primary"
                  )}
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
