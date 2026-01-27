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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useCart } from "@/context/CartContext";
import { useToast } from "@/hooks/use-toast";
import Layout from "@/components/Layout";

const WHATSAPP_NUMBER = "41799531317";

// Delivery zones configuration
const DELIVERY_ZONES = [
  {
    id: "zone1",
    name: "Zone 1 - Eaux-Vives et alentours (≤ 5 km)",
    price: 15,
    areas: "Eaux-Vives, Champel, Florissant, Malagnou, Chêne-Bourg, Chêne-Bougeries, Cologny",
  },
  {
    id: "zone2",
    name: "Zone 2 - Genève rive gauche (5-10 km)",
    price: 20,
    areas: "Carouge, Thônex, Plainpalais, Jonction, Centre-ville",
  },
  {
    id: "zone3",
    name: "Zone 3 - Genève centre & proche périphérie (10-15 km)",
    price: 25,
    areas: "Pâquis, Cornavin, Saint-Gervais, Servette, Nations, Petit-Saconnex",
  },
  {
    id: "zone4",
    name: "Zone 4 - France voisine & grande périphérie (15-20 km)",
    price: 35,
    areas: "Annemasse, Gaillard, Ville-la-Grand, Étrembières, Meyrin, Vernier, Lancy",
  },
];

const Checkout = () => {
  const { items, clearCart } = useCart();
  const { toast } = useToast();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [deliveryDate, setDeliveryDate] = useState<Date>();
  const [deliveryOption, setDeliveryOption] = useState("pickup");
  const [deliveryZone, setDeliveryZone] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryTimeComment, setDeliveryTimeComment] = useState("");

  const itemsTotal = items.reduce((sum, item) => sum + item.total, 0);
  
  const deliveryPrice = useMemo(() => {
    if (deliveryOption !== "delivery" || !deliveryZone) return 0;
    const zone = DELIVERY_ZONES.find((z) => z.id === deliveryZone);
    return zone?.price || 0;
  }, [deliveryOption, deliveryZone]);

  const totalPrice = itemsTotal + deliveryPrice;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!deliveryDate) {
      toast({
        title: "Please select a delivery date",
        variant: "destructive",
      });
      return;
    }

    if (deliveryOption === "delivery" && !deliveryZone) {
      toast({
        title: "Please select a delivery zone",
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

    // Build order details message
    const orderItems = items
      .map(
        (item) =>
          `- ${item.sizeName} ${item.shapeName} Cake (${item.flavorName}${item.styleName ? `, ${item.styleName}` : ""}${item.extrasNames.length > 0 ? `, Extras: ${item.extrasNames.join(", ")}` : ""}) - CHF ${item.total}`
      )
      .join("\n");

    const selectedZone = DELIVERY_ZONES.find((z) => z.id === deliveryZone);

    const deliveryInfo = deliveryOption === "pickup" 
      ? "Option: Pickup"
      : `Option: Delivery
Address: ${deliveryAddress}
Zone: ${selectedZone?.name} (+CHF ${selectedZone?.price})${deliveryTimeComment ? `\nPreferred Time: ${deliveryTimeComment}` : ""}`;

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

*Subtotal: CHF ${itemsTotal}*${deliveryPrice > 0 ? `\n*Delivery Fee: CHF ${deliveryPrice}*` : ""}
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
                    setDeliveryZone("");
                    setDeliveryAddress("");
                    setDeliveryTimeComment("");
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
                
                {/* Zone Selection */}
                <div className="space-y-2">
                  <Label htmlFor="deliveryZone">Select your zone</Label>
                  <Select value={deliveryZone} onValueChange={setDeliveryZone}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Choose a delivery zone" />
                    </SelectTrigger>
                    <SelectContent>
                      {DELIVERY_ZONES.map((zone) => (
                        <SelectItem key={zone.id} value={zone.id}>
                          <div className="flex flex-col">
                            <span>{zone.name} - CHF {zone.price}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {deliveryZone && (
                    <p className="text-xs text-muted-foreground">
                      {DELIVERY_ZONES.find((z) => z.id === deliveryZone)?.areas}
                    </p>
                  )}
                </div>

                {/* Address Input */}
                <div className="space-y-2">
                  <Label htmlFor="deliveryAddress">Delivery Address</Label>
                  <Input
                    id="deliveryAddress"
                    value={deliveryAddress}
                    onChange={(e) => setDeliveryAddress(e.target.value)}
                    placeholder="Enter your full address"
                    required={deliveryOption === "delivery"}
                  />
                </div>

                {/* Preferred Delivery Time Comment */}
                <div className="space-y-2">
                  <Label htmlFor="deliveryTimeComment">Preferred Delivery Time (optional)</Label>
                  <Textarea
                    id="deliveryTimeComment"
                    value={deliveryTimeComment}
                    onChange={(e) => setDeliveryTimeComment(e.target.value)}
                    placeholder="e.g., Between 2pm and 4pm"
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
                  <span className="text-muted-foreground">Delivery Fee</span>
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
