// Google Maps Platform helpers — server-side only.
//
// Uses exactly two products:
//   • Places API (New) — Autocomplete + Place Details
//   • Routes API       — Compute Routes (DRIVE, TRAFFIC_UNAWARE)
//
// The API key lives ONLY in the GOOGLE_MAPS_SERVER_KEY Supabase secret and
// is never sent to the browser. Field masks are kept as tight as possible so
// every call stays in the cheapest ("Essentials") SKU tier.

import { DELIVERY_ORIGIN } from "./delivery-pricing.ts";

const PLACES_HOST = "https://places.googleapis.com/v1";
const ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";

// Suggestions are limited to Switzerland + France (border communes such as
// Annemasse / Saint-Julien are legitimate < 20 km destinations) and biased
// to a circle around the kitchen.
const AUTOCOMPLETE_REGION_CODES = ["ch", "fr"];
const AUTOCOMPLETE_RADIUS_M = 35000;

function apiKey(): string {
  const key = Deno.env.get("GOOGLE_MAPS_SERVER_KEY");
  if (!key) throw new Error("GOOGLE_MAPS_SERVER_KEY is not configured");
  return key;
}

export interface AutocompleteSuggestion {
  placeId: string;
  primaryText: string;
  secondaryText: string;
  fullText: string;
}

// Places API (New) — Autocomplete. `sessionToken` groups every keystroke of
// one lookup (plus the follow-up Place Details call) into a single billed
// session. Field mask returns only the id + display text.
export async function placesAutocomplete(
  input: string,
  sessionToken: string,
  languageCode = "fr",
): Promise<AutocompleteSuggestion[]> {
  const res = await fetch(`${PLACES_HOST}/places:autocomplete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey(),
      "X-Goog-FieldMask": [
        "suggestions.placePrediction.placeId",
        "suggestions.placePrediction.structuredFormat.mainText.text",
        "suggestions.placePrediction.structuredFormat.secondaryText.text",
        "suggestions.placePrediction.text.text",
      ].join(","),
    },
    body: JSON.stringify({
      input,
      sessionToken,
      languageCode,
      includedPrimaryTypes: ["street_address", "premise", "subpremise"],
      includedRegionCodes: AUTOCOMPLETE_REGION_CODES,
      locationBias: {
        circle: {
          center: { latitude: DELIVERY_ORIGIN.lat, longitude: DELIVERY_ORIGIN.lng },
          radius: AUTOCOMPLETE_RADIUS_M,
        },
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`places_autocomplete_failed:${res.status}:${detail.slice(0, 300)}`);
  }

  const data = await res.json();
  const suggestions = Array.isArray(data?.suggestions) ? data.suggestions : [];
  return suggestions
    .map((s: any) => s?.placePrediction)
    .filter((p: any) => p?.placeId)
    .map((p: any) => ({
      placeId: p.placeId as string,
      primaryText: p.structuredFormat?.mainText?.text ?? p.text?.text ?? "",
      secondaryText: p.structuredFormat?.secondaryText?.text ?? "",
      fullText: p.text?.text ?? p.structuredFormat?.mainText?.text ?? "",
    }));
}

export interface ResolvedAddress {
  placeId: string;
  formattedAddress: string;
  street: string;
  streetNumber: string;
  postalCode: string;
  city: string;
  country: string;
  lat: number;
  lng: number;
}

function pickComponent(
  components: any[],
  type: string,
  field: "longText" | "shortText" = "longText",
): string {
  const match = components.find((c) => Array.isArray(c?.types) && c.types.includes(type));
  return (match?.[field] ?? match?.longText ?? "") as string;
}

// Places API (New) — Place Details. Passing the same `sessionToken` used for
// autocomplete closes that session (billed once). Field mask is limited to
// what we persist: id, formatted address, location, address components.
export async function placeDetails(
  placeId: string,
  sessionToken?: string,
  languageCode = "fr",
): Promise<ResolvedAddress> {
  const url = new URL(`${PLACES_HOST}/places/${encodeURIComponent(placeId)}`);
  url.searchParams.set("languageCode", languageCode);
  if (sessionToken) url.searchParams.set("sessionToken", sessionToken);

  const res = await fetch(url.toString(), {
    headers: {
      "X-Goog-Api-Key": apiKey(),
      "X-Goog-FieldMask": "id,formattedAddress,location,addressComponents",
    },
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`place_details_failed:${res.status}:${detail.slice(0, 300)}`);
  }

  const data = await res.json();
  const components = Array.isArray(data?.addressComponents) ? data.addressComponents : [];
  const lat = Number(data?.location?.latitude);
  const lng = Number(data?.location?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error("place_details_missing_location");
  }

  return {
    placeId: data?.id ?? placeId,
    formattedAddress: data?.formattedAddress ?? "",
    street: pickComponent(components, "route"),
    streetNumber: pickComponent(components, "street_number"),
    postalCode: pickComponent(components, "postal_code"),
    city:
      pickComponent(components, "locality") ||
      pickComponent(components, "postal_town") ||
      pickComponent(components, "administrative_area_level_2"),
    country: pickComponent(components, "country", "shortText"),
    lat,
    lng,
  };
}

// Routes API — Compute Routes. DRIVE + TRAFFIC_UNAWARE (no real-time traffic
// = Essentials pricing). Field mask returns only the distance in metres.
export async function drivingDistanceMeters(dest: { lat: number; lng: number }): Promise<number> {
  const res = await fetch(ROUTES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey(),
      "X-Goog-FieldMask": "routes.distanceMeters",
    },
    body: JSON.stringify({
      origin: {
        location: {
          latLng: { latitude: DELIVERY_ORIGIN.lat, longitude: DELIVERY_ORIGIN.lng },
        },
      },
      destination: {
        location: { latLng: { latitude: dest.lat, longitude: dest.lng } },
      },
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_UNAWARE",
      units: "METRIC",
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`compute_routes_failed:${res.status}:${detail.slice(0, 300)}`);
  }

  const data = await res.json();
  const meters = data?.routes?.[0]?.distanceMeters;
  if (typeof meters !== "number" || !Number.isFinite(meters)) {
    throw new Error("compute_routes_no_route");
  }
  return meters;
}

export interface DeliveryResolution extends ResolvedAddress {
  distanceKm: number;
}

// One authoritative resolution for a Google place id: address components +
// coordinates (from Place Details) and the driving distance from the fixed
// origin (from Compute Routes). Callers then apply the tariff grid from
// delivery-pricing.ts. Used both by resolve-delivery-quote (checkout
// display) and by create-postfinance-payment (the real charge) so the two
// can never diverge.
export async function resolveDeliveryForPlaceId(
  placeId: string,
  sessionToken?: string,
): Promise<DeliveryResolution> {
  const address = await placeDetails(placeId, sessionToken);
  const meters = await drivingDistanceMeters({ lat: address.lat, lng: address.lng });
  return { ...address, distanceKm: meters / 1000 };
}
