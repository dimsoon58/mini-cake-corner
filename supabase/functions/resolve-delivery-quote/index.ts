import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { resolveDeliveryForPlaceId } from "../_shared/google-maps.ts";
import { resolveDeliveryFeeByDistance } from "../_shared/delivery-pricing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Checkout-time delivery quote for a selected Google place id.
//
// Resolves the address + coordinates (Place Details) and the driving
// distance from the fixed origin (Compute Routes), then applies the tariff
// grid from _shared/delivery-pricing.ts. This is DISPLAY ONLY — the real
// charge is recomputed independently in create-postfinance-payment from the
// same place id, so a tampered response here changes nothing that is billed.
//
// Passing the autocomplete `sessionToken` through to Place Details closes
// that billing session (one session instead of N keystroke requests).
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { placeId, sessionToken } = await req.json();

    if (typeof placeId !== "string" || !placeId) {
      return new Response(JSON.stringify({ error: "invalid_request" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    const resolved = await resolveDeliveryForPlaceId(
      placeId,
      typeof sessionToken === "string" && sessionToken ? sessionToken : undefined,
    );

    const tier = resolveDeliveryFeeByDistance(resolved.distanceKm);

    if (!tier.deliverable) {
      // Out of range — an explicit, non-error outcome. No fee is returned.
      return new Response(
        JSON.stringify({
          deliverable: false,
          address: {
            formattedAddress: resolved.formattedAddress,
            street: resolved.street,
            streetNumber: resolved.streetNumber,
            postalCode: resolved.postalCode,
            city: resolved.city,
            country: resolved.country,
            lat: resolved.lat,
            lng: resolved.lng,
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    return new Response(
      JSON.stringify({
        deliverable: true,
        fee: tier.fee,
        // Kept to two decimals for storage/analytics; the customer never sees it.
        distanceKm: Math.round(resolved.distanceKm * 100) / 100,
        address: {
          formattedAddress: resolved.formattedAddress,
          street: resolved.street,
          streetNumber: resolved.streetNumber,
          postalCode: resolved.postalCode,
          city: resolved.city,
          country: resolved.country,
          lat: resolved.lat,
          lng: resolved.lng,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (error) {
    console.error("resolve-delivery-quote error:", error);
    // Never invent a price when Google is unreachable or the route fails.
    return new Response(JSON.stringify({ error: "distance_unavailable" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 502,
    });
  }
});
