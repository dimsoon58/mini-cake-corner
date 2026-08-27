import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { CartProvider } from "@/context/CartContext";
import { LanguageProvider } from "@/context/LanguageContext";
import { AuthProvider } from "@/context/AuthContext";

import Index from "./pages/Index";
import ProductDetail from "./pages/ProductDetail";

import Cart from "./pages/Cart";
import FAQ from "./pages/FAQ";
import Contact from "./pages/Contact";
import Checkout from "./pages/Checkout";
import CommunityPress from "./pages/CommunityPress";
import Catalog from "./pages/Catalog";
import Business from "./pages/Business";
import Printing from "./pages/Printing";
import Candles from "./pages/Candles";
import DotCakes from "./pages/DotCakes";
import Workshop from "./pages/Workshop";
import Inspiration from "./pages/Inspiration";
import KitBentoCake from "./pages/KitBentoCake";
import PaymentSuccess from "./pages/PaymentSuccess";
import AdminOrder from "./pages/AdminOrder";
import OrderAction from "./pages/OrderAction";
import NotFound from "./pages/NotFound";
import Legal from "./pages/Legal";
import OurStory from "./pages/OurStory";
import MyOrders from "./pages/MyOrders";
import LoyaltyRewards from "./pages/LoyaltyRewards";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import AuthConfirm from "./pages/AuthConfirm";
import Account from "./pages/Account";

const queryClient = new QueryClient();

// Every route change starts the new page from the very top and clears any
// stuck body pointer-events lock left behind by an abruptly closed dialog.
const ScrollToTop = () => {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
    document.body.style.removeProperty("pointer-events");
  }, [pathname]);
  return null;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <LanguageProvider>
    <AuthProvider>
    <CartProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter basename={import.meta.env.BASE_URL}>
          <ScrollToTop />
          <Routes>
            <Route path="/" element={<Index />} />
            
            <Route path="/cart" element={<Cart />} />
            <Route path="/community-press" element={<CommunityPress />} />
            <Route path="/business" element={<Business />} />
            <Route path="/corporate-event" element={<Business />} />
            <Route path="/catalog" element={<Catalog />} />
            <Route path="/dot-cakes" element={<DotCakes />} />
            <Route path="/candles" element={<Candles />} />
            <Route path="/printing" element={<Printing />} />
            <Route path="/workshop" element={<Workshop />} />
            <Route path="/kit-bento-cake" element={<KitBentoCake />} />
            <Route path="/inspiration" element={<Inspiration />} />
            <Route path="/about" element={<OurStory />} />
            <Route path="/our-story" element={<OurStory />} />
            <Route path="/faq" element={<FAQ />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/checkout" element={<Checkout />} />
            <Route path="/payment-success" element={<PaymentSuccess />} />
            <Route path="/admin/order/:id" element={<AdminOrder />} />
            <Route path="/order-action" element={<OrderAction />} />
            <Route path="/product/:id" element={<ProductDetail />} />
            <Route path="/legal" element={<Legal />} />
            <Route path="/terms-and-conditions" element={<Legal />} />
            <Route path="/privacy-policy" element={<Legal />} />
            <Route path="/account/orders" element={<MyOrders />} />
            <Route path="/account/rewards" element={<LoyaltyRewards />} />
            <Route path="/account" element={<Account />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/auth/confirm" element={<AuthConfirm />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
          
        </BrowserRouter>
      </TooltipProvider>
    </CartProvider>
    </AuthProvider>
    </LanguageProvider>
  </QueryClientProvider>
);

export default App;
