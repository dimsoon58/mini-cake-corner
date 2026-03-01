import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { CartProvider } from "@/context/CartContext";
import CookieConsent from "@/components/CookieConsent";
import Index from "./pages/Index";
import ProductDetail from "./pages/ProductDetail";

import Cart from "./pages/Cart";
import FAQ from "./pages/FAQ";
import Contact from "./pages/Contact";
import Checkout from "./pages/Checkout";
import CommunityPress from "./pages/CommunityPress";
import CorporateEvent from "./pages/CorporateEvent";
import Catalog from "./pages/Catalog";
import Inspiration from "./pages/Inspiration";
import KitBentoCake from "./pages/KitBentoCake";
import PaymentSuccess from "./pages/PaymentSuccess";
import NotFound from "./pages/NotFound";
import Legal from "./pages/Legal";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <CartProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            
            <Route path="/cart" element={<Cart />} />
            <Route path="/community-press" element={<CommunityPress />} />
            <Route path="/corporate-event" element={<CorporateEvent />} />
            <Route path="/catalog" element={<Catalog />} />
            <Route path="/kit-bento-cake" element={<KitBentoCake />} />
            <Route path="/inspiration" element={<Inspiration />} />
            <Route path="/faq" element={<FAQ />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/checkout" element={<Checkout />} />
            <Route path="/payment-success" element={<PaymentSuccess />} />
            <Route path="/product/:id" element={<ProductDetail />} />
            <Route path="/legal" element={<Legal />} />
            <Route path="/terms-and-conditions" element={<Legal />} />
            <Route path="/privacy-policy" element={<Legal />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
          <CookieConsent />
        </BrowserRouter>
      </TooltipProvider>
    </CartProvider>
  </QueryClientProvider>
);

export default App;
