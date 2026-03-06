import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle, XCircle, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";

const AdminOrder = () => {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [pin, setPin] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [result, setResult] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    const fetchOrder = async () => {
      if (!id) return;
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .eq("id", id)
        .single();

      if (error) {
        console.error("Error fetching order:", error);
      }
      setOrder(data);
      setLoading(false);
    };
    fetchOrder();
  }, [id]);

  const handleAction = async (action: "approve" | "reject") => {
    if (!pin.trim()) {
      setResult({ type: "error", message: "Please enter the admin PIN" });
      return;
    }

    setActionLoading(action);
    setResult(null);

    try {
      const { data, error } = await supabase.functions.invoke("manage-order", {
        body: { orderId: id, action, pin },
      });

      if (error) {
        setResult({ type: "error", message: error.message });
        return;
      }

      if (data?.error) {
        setResult({ type: "error", message: data.error });
        return;
      }

      setResult({
        type: "success",
        message: action === "approve"
          ? "✅ Order approved! Payment has been captured."
          : "❌ Order rejected. Payment has been canceled.",
      });
      setOrder({ ...order, status: data.status });
    } catch (err) {
      setResult({ type: "error", message: err instanceof Error ? err.message : "Unknown error" });
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <Layout>
        <main className="container mx-auto px-4 py-16 text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
        </main>
      </Layout>
    );
  }

  if (!order) {
    return (
      <Layout>
        <main className="container mx-auto px-4 py-16 text-center">
          <p className="text-muted-foreground">Order not found.</p>
        </main>
      </Layout>
    );
  }

  const details = order.order_details_json || {};
  const items = details.items || [];
  const isResolved = order.status !== "pending";

  return (
    <Layout>
      <main className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="bg-card rounded-lg shadow-md p-6 space-y-6">
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-6 h-6 text-primary" />
            <h1 className="text-xl font-serif text-foreground">
              Order #{order.id.slice(0, 8).toUpperCase()}
            </h1>
            <span className={`ml-auto text-xs font-medium px-3 py-1 rounded-full ${
              order.status === "pending" ? "bg-amber-100 text-amber-800" :
              order.status === "approved" ? "bg-emerald-100 text-emerald-800" :
              "bg-red-100 text-red-800"
            }`}>
              {order.status.toUpperCase()}
            </span>
          </div>

          {/* Customer Info */}
          <div className="bg-muted/30 rounded-lg p-4 space-y-1">
            <h3 className="font-medium text-foreground">Customer</h3>
            <p className="text-sm text-muted-foreground">{order.customer_name}</p>
            <p className="text-sm text-muted-foreground">📧 {order.customer_email}</p>
            <p className="text-sm text-muted-foreground">📱 {order.customer_phone}</p>
          </div>

          {/* Order Details */}
          <div className="bg-muted/30 rounded-lg p-4 space-y-1">
            <h3 className="font-medium text-foreground">Delivery</h3>
            <p className="text-sm text-muted-foreground">📅 {order.order_date}</p>
            <p className="text-sm text-muted-foreground">
              📦 {order.delivery_option === "delivery" ? `Delivery: ${order.delivery_address}` : "Pickup at store"}
            </p>
          </div>

          {/* Items */}
          {items.length > 0 && (
            <div className="space-y-3">
              <h3 className="font-medium text-foreground">Items</h3>
              {items.map((item: any, i: number) => (
                <div key={i} className="rounded-lg border border-border p-3 space-y-1">
                  <div className="flex justify-between">
                    <span className="font-medium text-sm">{item.sizeName} {item.shapeName} Cake</span>
                    <span className="font-semibold text-sm text-primary">CHF {item.total}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Flavor: {item.flavorName}</p>
                  {item.styleName && <p className="text-xs text-muted-foreground">Style: {item.styleName}</p>}
                  {item.extrasNames?.length > 0 && (
                    <p className="text-xs text-muted-foreground">Extras: {item.extrasNames.join(", ")}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Total */}
          <div className="flex justify-between items-center pt-4 border-t border-border">
            <span className="text-lg font-semibold">Total</span>
            <span className="text-lg font-semibold text-primary">CHF {order.total_amount}</span>
          </div>

          {/* Admin Actions */}
          {!isResolved ? (
            <div className="border-t border-border pt-6 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="pin">Admin PIN</Label>
                <Input
                  id="pin"
                  type="password"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="Enter your admin PIN"
                  className="max-w-xs"
                />
              </div>

              {result && (
                <div className={`p-3 rounded-lg text-sm ${
                  result.type === "success" ? "bg-emerald-50 text-emerald-800 border border-emerald-200" :
                  "bg-destructive/10 text-destructive border border-destructive/20"
                }`}>
                  {result.message}
                </div>
              )}

              <div className="flex gap-3">
                <Button
                  onClick={() => handleAction("approve")}
                  disabled={!!actionLoading}
                  className="flex-1"
                >
                  {actionLoading === "approve" ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <CheckCircle className="w-4 h-4 mr-2" />
                  )}
                  Approve & Capture Payment
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => handleAction("reject")}
                  disabled={!!actionLoading}
                  className="flex-1"
                >
                  {actionLoading === "reject" ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <XCircle className="w-4 h-4 mr-2" />
                  )}
                  Reject & Cancel Payment
                </Button>
              </div>
            </div>
          ) : (
            <div className={`p-4 rounded-lg text-center ${
              order.status === "approved" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"
            }`}>
              <p className="font-medium">
                {order.status === "approved" ? "✅ This order has been approved and payment captured." : "❌ This order has been rejected and payment canceled."}
              </p>
            </div>
          )}
        </div>
      </main>
    </Layout>
  );
};

export default AdminOrder;
