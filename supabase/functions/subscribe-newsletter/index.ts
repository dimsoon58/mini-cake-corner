import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BREVO_BASE_URL = "https://api.brevo.com/v3";

interface SubscribeRequest {
  email: string;
  firstName?: string;
  lastName?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const brevoApiKey = Deno.env.get("BREVO_API_KEY");
    if (!brevoApiKey) {
      throw new Error("BREVO_API_KEY is not configured");
    }

    const brevoListId = Deno.env.get("BREVO_LIST_ID");
    if (!brevoListId) {
      throw new Error("BREVO_LIST_ID is not configured");
    }

    const listId = parseInt(brevoListId, 10);
    if (isNaN(listId)) {
      throw new Error("BREVO_LIST_ID must be a numeric value");
    }

    const body: SubscribeRequest = await req.json();
    const { email, firstName, lastName } = body;

    if (!email || !email.includes("@")) {
      throw new Error("A valid email is required");
    }

    const attributes: Record<string, string> = {};
    if (firstName) attributes.FIRSTNAME = firstName;
    if (lastName) attributes.LASTNAME = lastName;

    const brevoPayload = {
      email: email.trim().toLowerCase(),
      attributes,
      listIds: [listId],
      updateEnabled: true,
    };

    console.log("Subscribing to Brevo newsletter:", { email: brevoPayload.email, listId });

    const response = await fetch(`${BREVO_BASE_URL}/contacts`, {
      method: "POST",
      headers: {
        "api-key": brevoApiKey,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(brevoPayload),
    });

    if (response.status === 201 || response.status === 204) {
      console.log("Brevo subscription successful:", response.status);
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    const errorData = await response.text();
    console.error("Brevo API error:", response.status, errorData);

    if (response.status === 400 && errorData.includes("Contact already exist")) {
      console.log("Contact already exists, treating as success");
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    throw new Error(`Brevo API error [${response.status}]: ${errorData}`);
  } catch (error) {
    console.error("Newsletter subscription error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
