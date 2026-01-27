import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { CartProvider } from "@/context/CartContext";
import Index from "./pages/Index";
import ProductDetail from "./pages/ProductDetail";
import Customize from "./pages/Customize";
import Cart from "./pages/Cart";
import FAQ from "./pages/FAQ";
import Contact from "./pages/Contact";
import Checkout from "./pages/Checkout";
import CommunityPress from "./pages/CommunityPress";
import Catalog from "./pages/Catalog";
import Inspiration from "./pages/Inspiration";
import KitBentoCake from "./pages/KitBentoCake";
import NotFound from "./pages/NotFound";

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
            <Route path="/customize" element={<Customize />} />
            <Route path="/cart" element={<Cart />} />
            <Route path="/community-press" element={<CommunityPress />} />
            <Route path="/catalog" element={<Catalog />} />
            <Route path="/kit-bento-cake" element={<KitBentoCake />} />
            <Route path="/inspiration" element={<Inspiration />} />
            <Route path="/faq" element={<FAQ />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/checkout" element={<Checkout />} />
            <Route path="/product/:id" element={<ProductDetail />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </CartProvider>
  </QueryClientProvider>
);

export default App;
