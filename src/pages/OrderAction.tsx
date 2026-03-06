import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CheckCircle, XCircle, Loader2, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const OrderAction = () => {
  const [searchParams] = useSearchParams();
  const orderId = searchParams.get("orderId");
  const action = searchParams.get("action");
  const token = searchParams.get("token");

  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!orderId || !action || !token) {
      setStatus("error");
      setMessage("Missing required parameters. Please use the link from the notification email.");
      return;
    }

    if (action !== "approve" && action !== "reject" && action !== "decline") {
      setStatus("error");
      setMessage("Invalid action. Must be 'approve', 'reject', or 'decline'.");
      return;
    }

    const isDecline = action === "reject" || action === "decline";

    const execute = async () => {
      try {
        const { data, error } = await supabase.functions.invoke("manage-order", {
          body: { orderId, action, token },
        });

        if (error) {
          setStatus("error");
          setMessage(error.message || "An error occurred.");
          return;
        }

        if (data?.error) {
          setStatus("error");
          setMessage(data.error);
          return;
        }

        setStatus("success");
        setMessage(
          action === "approve"
            ? "Order approved! Payment has been captured and a calendar event has been created."
            : "Order declined. Payment has been canceled and the customer has been notified."
        );
      } catch (err) {
        setStatus("error");
        setMessage(err instanceof Error ? err.message : "Unknown error occurred.");
      }
    };

    execute();
  }, [orderId, action, token]);

  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl shadow-lg p-8 max-w-md w-full text-center space-y-6">
        <div className="flex justify-center">
          <div className="w-20 h-20 rounded-full flex items-center justify-center" style={{
            background: status === "loading" ? "#f3f4f6" :
              status === "success" && action === "approve" ? "#d1fae5" :
              status === "success" && action === "reject" ? "#fef2f2" :
              "#fef3c7"
          }}>
            {status === "loading" && <Loader2 className="w-10 h-10 animate-spin text-muted-foreground" />}
            {status === "success" && action === "approve" && <CheckCircle className="w-10 h-10 text-emerald-600" />}
            {status === "success" && action === "reject" && <XCircle className="w-10 h-10 text-red-600" />}
            {status === "error" && <AlertTriangle className="w-10 h-10 text-amber-600" />}
          </div>
        </div>

        <h1 className="text-2xl font-serif text-foreground">
          {status === "loading" && "Processing..."}
          {status === "success" && action === "approve" && "Order Accepted ✅"}
          {status === "success" && action === "reject" && "Order Declined ❌"}
          {status === "error" && "Action Failed"}
        </h1>

        <p className="text-muted-foreground text-sm leading-relaxed">{message}</p>

        {status === "success" && (
          <p className="text-xs text-muted-foreground">You can close this page.</p>
        )}

        <div className="pt-4 border-t border-border">
          <p className="text-xs text-muted-foreground">Bento Cake Studio · Order Management</p>
        </div>
      </div>
    </div>
  );
};

export default OrderAction;
