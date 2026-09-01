import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { CartProvider } from "@/context/CartContext";
import { LanguageProvider } from "@/context/LanguageContext";
import { AuthProvider } from "@/context/AuthContext";
import { trackViewItem, onAnalyticsReady } from "@/lib/analytics";

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
import WorkshopBooking from "./pages/WorkshopBooking";
import BookingConfirmation from "./pages/BookingConfirmation";
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

// SPA page_view is NOT sent from here: GA4 Enhanced Measurement ("Page
// changes based on browser history events") already emits exactly one
// page_view per React Router navigation. Adding a manual one would double
// every SPA page view. Verified in production.

// GA4 view_item — the cake/candle/kit/printing configurator pages are the
// product pages. One place, one event per navigation onto such a page.
const PRODUCT_ROUTES: Record<string, string> = {
  "/catalog": "bento_cake",
  "/dot-cakes": "dot_cakes",
  "/candles": "candles",
  "/kit-bento-cake": "diy_kit",
  "/printing": "edible_printing",
};

const ViewItemTracker = () => {
  const { pathname } = useLocation();
  useEffect(() => {
    const product = PRODUCT_ROUTES[pathname];
    if (!product) return;
    // Fires view_item once — now if consent is already granted, or the moment
    // the visitor accepts cookies while still on this page. The returned
    // cleanup cancels it on navigation, so it never fires for a page left.
    return onAnalyticsReady(() => trackViewItem(product));
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
          <ViewItemTracker />
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
            <Route path="/workshop-booking" element={<WorkshopBooking />} />
            <Route path="/workshop-confirmation" element={<BookingConfirmation />} />
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
