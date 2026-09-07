// Independent from pricing.ts on purpose — delivery tariffs can change
// without touching product prices, loyalty math, or vice versa.

// ═══════════════════════════════════════════════════════════════════════════
//  DELIVERY TARIFF — SINGLE SOURCE OF TRUTH (edit here, nowhere else)
// ═══════════════════════════════════════════════════════════════════════════
//
//  This block is the ONLY place delivery limits and prices are defined for
//  the whole system (checkout display + PostFinance charge). Both read it
//  through resolveDeliveryFeeByDistance() below.
//
//  ⚠️ PROVISOIRE — grille à confirmer avec Ped'allô (méthode de calcul des
//     kilomètres). Pour changer les paliers plus tard : modifier UNIQUEMENT
//     le tableau DELIVERY_DISTANCE_TIERS ci-dessous. Rien d'autre à toucher.
//
//  How a tier is read: the driving distance (car, TRAFFIC_UNAWARE) is
//  compared, NOT rounded, against each tier's `maxKm` in order. The first
//  tier whose `maxKm >= distance` wins. Anything beyond the last tier =
//  delivery unavailable (never a guessed price).
//
//  Boundaries are inclusive of maxKm:
//    3.00 km → 15 · 3.01 km → 18
//    5.00 km → 18 · 5.01 km → 20
//    7.00 km → 20 · 7.01 km → 25
//    9.00 km → 25 · 9.01 km → 48
//   14.00 km → 48 · 14.01 km → 55
//   20.00 km → 55 · > 20 km → unavailable
//
export const DELIVERY_DISTANCE_TIERS: { maxKm: number; fee: number }[] = [
  { maxKm: 3, fee: 15 },
  { maxKm: 5, fee: 18 },
  { maxKm: 7, fee: 20 },
  { maxKm: 9, fee: 25 },
  { maxKm: 14, fee: 48 },
  { maxKm: 20, fee: 55 },
];

// Fixed departure point (our kitchen). Used as the Routes API origin and as
// the centre of the address-autocomplete location bias.
// Address: Rue Prévost-Martin 8, 1205 Genève, Suisse.
// ⚠️ Coordinates below are approximate (Plainpalais). Verify once against
//    Google Maps (right-click the exact building → the first line is
//    "latitude, longitude") and correct if needed — a small offset only
//    shifts the computed distance by a few dozen metres.
export const DELIVERY_ORIGIN = {
  address: "Rue Prévost-Martin 8, 1205 Genève, Suisse",
  lat: 46.19715,
  lng: 6.14099,
};

export interface DistanceFeeResult {
  deliverable: boolean;
  // Only meaningful when deliverable === true.
  fee: number;
  // Internal ops label for orders.delivery_zone (e.g. "≤ 3 km"). Never shown
  // to the customer — the checkout only ever displays the fee.
  label: string | null;
}

// The one function the rest of the system calls. `distanceKm` is the raw,
// un-rounded driving distance in kilometres. Returns { deliverable:false }
// beyond the last tier — callers must then block the delivery payment and
// never fall back to a price.
export function resolveDeliveryFeeByDistance(distanceKm: number): DistanceFeeResult {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) {
    return { deliverable: false, fee: 0, label: null };
  }
  let prevMax = 0;
  for (const tier of DELIVERY_DISTANCE_TIERS) {
    if (distanceKm <= tier.maxKm) {
      const label = prevMax === 0 ? `≤ ${tier.maxKm} km` : `${prevMax}–${tier.maxKm} km`;
      return { deliverable: true, fee: tier.fee, label };
    }
    prevMax = tier.maxKm;
  }
  return { deliverable: false, fee: 0, label: null };
}

// Largest distance we still deliver to — derived from the grid above, not a
// second constant to keep in sync.
export const MAX_DELIVERY_KM =
  DELIVERY_DISTANCE_TIERS[DELIVERY_DISTANCE_TIERS.length - 1]?.maxKm ?? 0;

// ═══════════════════════════════════════════════════════════════════════════
//  Legacy postal-code zones — kept for backward compatibility only.
//  No longer used to price new orders (superseded by the distance grid
//  above). Left in place so historic data / any external reference that
//  still maps these names keeps resolving. Do not extend.
// ═══════════════════════════════════════════════════════════════════════════

export interface DeliveryZone {
  id: string;
  name: string;
  price: number;
  postalCodes: string[];
}

export const DELIVERY_ZONES: DeliveryZone[] = [
  { id: "zone1", name: "Zone 1 – Eaux-Vives & alentours", price: 15, postalCodes: ["1207", "1206", "1208", "1225", "1224", "1223"] },
  { id: "zone2", name: "Zone 2 – Carouge, Thônex, Plainpalais", price: 20, postalCodes: ["1227", "1226", "1205", "1201", "1204"] },
  { id: "zone3", name: "Zone 3 – Pâquis, Servette, Nations", price: 25, postalCodes: ["1203", "1202", "1209"] },
  { id: "zone4", name: "Zone 4 – Meyrin, Vernier, Lancy", price: 35, postalCodes: ["1217", "1214", "1219", "1212", "1213", "1228"] },
  { id: "zone5", name: "Zone 5 – Bernex, Versoix, Bellevue…", price: 40, postalCodes: ["1233", "1234", "1232", "1290", "1292", "1293", "1294"] },
];

export interface DeliveryFeeResult {
  fee: number;
  zone: string | null;
}

// Same postal-code auto-detection Checkout.tsx already does client-side
// (DELIVERY_ZONES / detectZoneFromAddress) — reimplemented here as the
// server-authoritative version, so delivery_fee is never trusted from the
// client. An address whose postal code matches no zone resolves to fee 0,
// matching today's client-side behaviour exactly — deliberately NOT
// tightened here; that's a separate decision to make later.
export function resolveDeliveryFee(address: string): DeliveryFeeResult {
  const postalCodeMatches = address.match(/\b\d{4,5}\b/g);
  if (!postalCodeMatches) return { fee: 0, zone: null };
  for (const code of postalCodeMatches) {
    for (const zone of DELIVERY_ZONES) {
      if (zone.postalCodes.includes(code)) return { fee: zone.price, zone: zone.name };
    }
  }
  return { fee: 0, zone: null };
}
