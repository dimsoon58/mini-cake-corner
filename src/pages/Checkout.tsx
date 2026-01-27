import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { CalendarIcon, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useCart } from "@/context/CartContext";
import { useToast } from "@/hooks/use-toast";
import Layout from "@/components/Layout";

const WHATSAPP_NUMBER = "41799531317";

// Delivery zones configuration with postal codes for auto-detection
const DELIVERY_ZONES = [
  {
    id: "zone1",
    name: "Zone 1 (≤ 5 km)",
    price: 15,
    postalCodes: ["1207", "1206", "1208", "1225", "1224", "1223"],
  },
  {
    id: "zone2",
    name: "Zone 2 (5-10 km)",
    price: 20,
    postalCodes: ["1227", "1226", "1205", "1201", "1204"],
  },
  {
    id: "zone3",
    name: "Zone 3 (10-15 km)",
    price: 25,
    postalCodes: ["1203", "1202", "1209"],
  },
  {
    id: "zone4",
    name: "Zone 4 (15-20 km)",
    price: 35,
    postalCodes: ["74100", "74240", "1217", "1214", "1219", "1212"],
  },
  {
    id: "zone5",
    name: "Zone 5 (20+ km)",
    price: 40,
    postalCodes: ["1213", "1228", "1233", "1234", "1232", "1290", "1292", "1293", "1294"],
  },
];

// Function to detect zone from address using postal codes
const detectZoneFromAddress = (address: string): typeof DELIVERY_ZONES[0] | null => {
  // Extract potential postal codes from the address (4-5 digit numbers)
  const postalCodeMatches = address.match(/\b\d{4,5}\b/g);
  
  if (!postalCodeMatches) return null;
  
  for (const postalCode of postalCodeMatches) {
    for (const zone of DELIVERY_ZONES) {
      if (zone.postalCodes.includes(postalCode)) {
        return zone;
      }
    }
  }
  return null;
};

const Checkout = () => {
  const { items, clearCart } = useCart();
  const { toast } = useToast();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [deliveryDate, setDeliveryDate] = useState<Date>();
  const [deliveryOption, setDeliveryOption] = useState("pickup");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryComment, setDeliveryComment] = useState("");

  const itemsTotal = items.reduce((sum, item) => sum + item.total, 0);
  
  const detectedZone = useMemo(() => {
    if (deliveryOption !== "delivery" || !deliveryAddress.trim()) return null;
    return detectZoneFromAddress(deliveryAddress);
  }, [deliveryOption, deliveryAddress]);

  const deliveryPrice = detectedZone?.price || 0;
  const totalPrice = itemsTotal + (deliveryOption === "delivery" ? deliveryPrice : 0);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!deliveryDate) {
      toast({
        title: "Please select a delivery date",
        variant: "destructive",
      });
      return;
    }

    if (deliveryOption === "delivery" && !deliveryAddress.trim()) {
      toast({
        title: "Please enter your delivery address",
        variant: "destructive",
      });
      return;
    }

    if (deliveryOption === "delivery" && !detectedZone) {
      toast({
        title: "Delivery zone not recognized",
        description: "Please make sure your address includes a recognized area name (e.g., Carouge, Champel, Meyrin...)",
        variant: "destructive",
      });
      return;
    }

    // Build order details message
    const orderItems = items
      .map(
        (item) =>
          `- ${item.sizeName} ${item.shapeName} Cake (${item.flavorName}${item.styleName ? `, ${item.styleName}` : ""}${item.extrasNames.length > 0 ? `, Extras: ${item.extrasNames.join(", ")}` : ""}) - CHF ${item.total}`
      )
      .join("\n");

    const deliveryInfo = deliveryOption === "pickup" 
      ? "Option: Pickup"
      : `Option: Delivery
Address: ${deliveryAddress}
Zone: ${detectedZone?.name} (+CHF ${detectedZone?.price})${deliveryComment ? `\nNotes: ${deliveryComment}` : ""}`;

    const message = `🎂 *New Cake Order*

*Customer Information:*
Name: ${firstName} ${lastName}
Phone: ${phone}
Email: ${email}

*Order Details:*
${orderItems}

*Delivery:*
Date: ${format(deliveryDate, "PPP")}
${deliveryInfo}

*Subtotal: CHF ${itemsTotal}*${deliveryPrice > 0 && deliveryOption === "delivery" ? `\n*Delivery Fee: CHF ${deliveryPrice}*` : ""}
*Total: CHF ${totalPrice}*`;

    // Encode message for URL
    const encodedMessage = encodeURIComponent(message);
    const whatsappUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodedMessage}`;

    // Open WhatsApp
    window.open(whatsappUrl, "_blank");

    toast({
      title: "Order sent!",
      description: "WhatsApp will open with your order details.",
    });
  };

  return (
    <Layout>
      <main className="container mx-auto px-4 py-8 max-w-2xl">
        <Link
          to="/cart"
          className="inline-flex items-center text-muted-foreground hover:text-primary mb-6"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Cart
        </Link>

        <div className="bg-card rounded-lg shadow-md p-6">
          <h2 className="text-xl font-serif text-foreground mb-6">
            Contact Information
          </h2>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Name Fields */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name</Label>
                <Input
                  id="firstName"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="Enter your first name"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name</Label>
                <Input
                  id="lastName"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Enter your last name"
                  required
                />
              </div>
            </div>

            {/* Phone */}
            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number</Label>
              <Input
                id="phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Enter your phone number"
                required
              />
            </div>

            {/* Email */}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email address"
                required
              />
            </div>

            {/* Delivery Date */}
            <div className="space-y-2">
              <Label>Desired Delivery Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !deliveryDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {deliveryDate ? (
                      format(deliveryDate, "PPP")
                    ) : (
                      <span>Pick a date</span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={deliveryDate}
                    onSelect={setDeliveryDate}
                    disabled={(date) => date < new Date()}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* Delivery Option */}
            <div className="space-y-3">
              <Label>Delivery Option</Label>
              <RadioGroup
                value={deliveryOption}
                onValueChange={(value) => {
                  setDeliveryOption(value);
                  if (value === "pickup") {
                    setDeliveryAddress("");
                    setDeliveryComment("");
                  }
                }}
                className="flex flex-col space-y-2"
              >
                <div className="flex items-center space-x-3 p-3 border border-border rounded-lg hover:bg-muted/50 cursor-pointer">
                  <RadioGroupItem value="pickup" id="pickup" />
                  <Label htmlFor="pickup" className="cursor-pointer flex-1">
                    <span className="font-medium">Pickup</span>
                    <p className="text-sm text-muted-foreground">
                      Pick up your order at our store
                    </p>
                  </Label>
                </div>
                <div className="flex items-center space-x-3 p-3 border border-border rounded-lg hover:bg-muted/50 cursor-pointer">
                  <RadioGroupItem value="delivery" id="delivery" />
                  <Label htmlFor="delivery" className="cursor-pointer flex-1">
                    <span className="font-medium">Delivery</span>
                    <p className="text-sm text-muted-foreground">
                      We deliver to your address
                    </p>
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {/* Delivery Details - Only shown when delivery is selected */}
            {deliveryOption === "delivery" && (
              <div className="space-y-4 p-4 bg-muted/30 rounded-lg border border-border">
                <h3 className="font-medium text-foreground">Delivery Details</h3>
                
                {/* Address Input */}
                <div className="space-y-2">
                  <Label htmlFor="deliveryAddress">Delivery Address</Label>
                  <Input
                    id="deliveryAddress"
                    value={deliveryAddress}
                    onChange={(e) => setDeliveryAddress(e.target.value)}
                    placeholder="Enter your full address (e.g., Rue de Carouge 12, 1205 Genève)"
                    required={deliveryOption === "delivery"}
                  />
                  {deliveryAddress.trim() && (
                    <div className="text-sm">
                      {detectedZone ? (
                        <p className="text-green-600">
                          ✓ {detectedZone.name} detected - Delivery fee: CHF {detectedZone.price}
                        </p>
                      ) : (
                        <p className="text-amber-600">
                          Zone not detected. Please include area name (e.g., Carouge, Champel, Meyrin...)
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Preferred Delivery Time & Complementary Indications */}
                <div className="space-y-2">
                  <Label htmlFor="deliveryComment">Preferred Delivery Time & Complementary Indications (optional)</Label>
                  <Textarea
                    id="deliveryComment"
                    value={deliveryComment}
                    onChange={(e) => setDeliveryComment(e.target.value)}
                    placeholder="e.g., Between 2pm and 4pm, ring doorbell twice, code: 1234..."
                    rows={2}
                  />
                </div>
              </div>
            )}

            {/* Order Summary */}
            <div className="border-t border-border pt-6 mt-6">
              <div className="flex justify-between items-center mb-2">
                <span className="text-muted-foreground">
                  Items ({items.length})
                </span>
                <span className="font-medium">CHF {itemsTotal}</span>
              </div>
              {deliveryOption === "delivery" && deliveryPrice > 0 && (
                <div className="flex justify-between items-center mb-2">
                  <span className="text-muted-foreground">Delivery Fee ({detectedZone?.name})</span>
                  <span className="font-medium">CHF {deliveryPrice}</span>
                </div>
              )}
              <div className="flex justify-between items-center text-lg font-semibold pt-2 border-t border-border">
                <span>Total</span>
                <span className="text-primary">CHF {totalPrice}</span>
              </div>
            </div>

            {/* Submit Button */}
            <Button type="submit" className="w-full" size="lg">
              Place Order
            </Button>
          </form>
        </div>
      </main>
    </Layout>
  );
};

export default Checkout;
