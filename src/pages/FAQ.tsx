import { Link } from "react-router-dom";
import CartIcon from "@/components/CartIcon";
import logo from "@/assets/logo.png";

const FAQ = () => {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-6 py-4 md:px-12">
        <Link to="/">
          <img src={logo} alt="Bento Cake Studio" className="h-16 md:h-20" />
        </Link>
        
        {/* Navigation */}
        <nav className="hidden md:flex items-center gap-8">
          <Link to="/" className="text-foreground/80 hover:text-foreground transition-colors font-medium">
            Home
          </Link>
          <Link to="/customize" className="text-foreground/80 hover:text-foreground transition-colors font-medium">
            Custom
          </Link>
          <Link to="/faq" className="text-primary font-medium">
            FAQ
          </Link>
          <Link to="/contact" className="text-foreground/80 hover:text-foreground transition-colors font-medium">
            Contact
          </Link>
        </nav>
        
        <CartIcon />
      </header>

      {/* Mobile Navigation */}
      <nav className="md:hidden flex justify-center gap-6 pb-4 border-b border-border/30">
        <Link to="/" className="text-foreground/80 hover:text-foreground transition-colors text-sm font-medium">
          Home
        </Link>
        <Link to="/customize" className="text-foreground/80 hover:text-foreground transition-colors text-sm font-medium">
          Custom
        </Link>
        <Link to="/faq" className="text-primary text-sm font-medium">
          FAQ
        </Link>
        <Link to="/contact" className="text-foreground/80 hover:text-foreground transition-colors text-sm font-medium">
          Contact
        </Link>
      </nav>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-6 py-16">
        <h1 className="text-4xl md:text-5xl font-serif text-foreground mb-8 text-center">
          Frequently Asked Questions
        </h1>
        <p className="text-center text-muted-foreground">
          Content coming soon...
        </p>
      </main>
    </div>
  );
};

export default FAQ;
