import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { placesAutocomplete } from "../_shared/google-maps.ts";
import { corsHeaders } from "../_shared/cors.ts";


// Thin proxy in front of Places API (New) Autocomplete. Keeps
// GOOGLE_MAPS_SERVER_KEY server-side. The browser sends the raw input plus a
// session token it manages for the lifetime of one address lookup.
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(req) });
  }

  try {
    const { input, sessionToken, languageCode } = await req.json();

    if (typeof input !== "string" || typeof sessionToken !== "string" || !sessionToken) {
      return new Response(JSON.stringify({ error: "invalid_request" }), {
        headers: { ...corsHeaders(req), "Content-Type": "application/json" },
        status: 400,
      });
    }

    const trimmed = input.trim();
    // Mirror the client-side guard (min 4 chars) so a stray call can't reach
    // Google, and cap the length defensively.
    if (trimmed.length < 4 || trimmed.length > 200) {
      return new Response(JSON.stringify({ suggestions: [] }), {
        headers: { ...corsHeaders(req), "Content-Type": "application/json" },
        status: 200,
      });
    }

    const suggestions = await placesAutocomplete(
      trimmed,
      sessionToken,
      languageCode === "en" ? "en" : "fr",
    );

    return new Response(JSON.stringify({ suggestions }), {
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("google-places-autocomplete error:", error);
    return new Response(JSON.stringify({ error: "autocomplete_unavailable" }), {
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      status: 502,
    });
  }
});
