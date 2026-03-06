import { useState, useEffect } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { CheckCircle, XCircle, Loader2, ShieldCheck, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";

const DetailRow = ({ label, value }: { label: string; value?: string | null }) => {
  if (!value) return null;
  return (
    <div className="flex gap-2 text-sm">
      <span className="text-muted-foreground min-w-[140px]">{label}:</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
};

const formatDateFromIso = (dateValue?: string | null) => {
  if (!dateValue) return dateValue;
  const [year, month, day] = dateValue.split("-");
  return year && month && day ? `${day}.${month}.${year}` : dateValue;
};

const AdminOrder = () => {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [pin, setPin] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [result, setResult] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    const fetchOrder = async () => {
      if (!id) return;
      const { data, error } = await supabase
        .from("orders").select("*").eq("id", id).single();
      if (error) console.error("Error fetching order:", error);
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
    if (!token) {
      setResult({ type: "error", message: "Missing action token. Please use the link from the notification email." });
      return;
    }
    setActionLoading(action);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("manage-order", {
        body: { orderId: id, action, pin, token },
      });
      if (error) { setResult({ type: "error", message: error.message }); return; }
      if (data?.error) { setResult({ type: "error", message: data.error }); return; }
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
          {/* Header */}
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

          {/* Missing token warning */}
          {!token && !isResolved && (
            <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-50 border border-amber-200">
              <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
              <div className="text-sm text-amber-800">
                <p className="font-medium">Secure token missing</p>
                <p>Please use the link from the notification email to manage this order. Direct access without a token is not permitted.</p>
              </div>
            </div>
          )}

          {/* Customer Info */}
          <div className="bg-muted/30 rounded-lg p-4 space-y-1">
            <h3 className="font-medium text-foreground mb-2">👤 Customer Information</h3>
            <DetailRow label="Name" value={order.customer_name} />
            <DetailRow label="Email" value={order.customer_email} />
            <DetailRow label="Phone" value={order.customer_phone} />
          </div>

          {/* Pickup / Delivery */}
          <div className="bg-muted/30 rounded-lg p-4 space-y-1">
            <h3 className="font-medium text-foreground mb-2">📦 Pickup / Delivery</h3>
            <DetailRow label="Date" value={formatDateFromIso(order.order_date)} />
            <DetailRow label="Time" value={details.pickupTime} />
            <DetailRow label="Option" value={order.delivery_option === "delivery" ? "Delivery" : "Pickup at store"} />
            {order.delivery_option === "delivery" && (
              <DetailRow label="Address" value={order.delivery_address} />
            )}
            <DetailRow label="Delivery Notes" value={details.deliveryComment} />
          </div>

          {/* Cake Items */}
          {items.length > 0 && (
            <div className="space-y-3">
              <h3 className="font-medium text-foreground">🍰 Order Items ({items.length})</h3>
              {items.map((item: any, i: number) => {
                const candlesList = (item.candles || [])
                  .filter((c: any) => c.quantity > 0)
                  .map((c: any) => `${c.id}${c.hasPack ? " (pack)" : ""} ×${c.quantity}`)
                  .join(", ");

                return (
                  <div key={i} className="rounded-lg border border-border p-4 space-y-1">
                    <div className="flex justify-between mb-2">
                      <span className="font-medium text-sm">Cake {i + 1}</span>
                      <span className="font-semibold text-sm text-primary">CHF {item.total}</span>
                    </div>
                    <DetailRow label="Size" value={item.sizeName} />
                    <DetailRow label="Shape" value={item.shapeName} />
                    <DetailRow label="Flavor" value={item.flavorName} />
                    <DetailRow label="Design / Style" value={item.styleName} />
                    <DetailRow label="Base Color" value={item.baseColorName} />
                    <DetailRow label="Decoration Color" value={item.decorationColorName} />
                    {item.cakeText && (
                      <DetailRow
                        label="Text on Cake"
                        value={`"${item.cakeText}" (${item.textStyle || "normal"}, ${item.textColorName || "default"})`}
                      />
                    )}
                    {item.extrasNames?.length > 0 && (
                      <DetailRow label="Extras" value={item.extrasNames.join(", ")} />
                    )}
                    <DetailRow label="Ribbon Color" value={item.ribbonColorName} />
                    <DetailRow label="Butterfly Color" value={item.butterflyColorName} />
                    {candlesList && <DetailRow label="Candles" value={candlesList} />}
                    <DetailRow label="Special Instructions" value={item.comment} />
                  </div>
                );
              })}
            </div>
          )}

          {/* Payment Summary */}
          <div className="bg-amber-50 rounded-lg p-4 space-y-1">
            <h3 className="font-medium text-foreground mb-2">💳 Payment</h3>
            <DetailRow label="Order ID" value={order.id.slice(0, 8).toUpperCase()} />
            <DetailRow label="Total" value={`CHF ${order.total_amount}`} />
            <DetailRow label="Status" value={
              order.status === "pending" ? "⏳ Pending Approval (funds authorized)" :
              order.status === "approved" ? "✅ Approved (payment captured)" :
              "❌ Rejected (payment canceled)"
            } />
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
                <Button onClick={() => handleAction("approve")} disabled={!!actionLoading || !token} className="flex-1">
                  {actionLoading === "approve" ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle className="w-4 h-4 mr-2" />}
                  Approve & Capture Payment
                </Button>
                <Button variant="destructive" onClick={() => handleAction("reject")} disabled={!!actionLoading || !token} className="flex-1">
                  {actionLoading === "reject" ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <XCircle className="w-4 h-4 mr-2" />}
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
