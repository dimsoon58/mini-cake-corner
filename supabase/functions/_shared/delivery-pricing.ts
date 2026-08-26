// Independent from pricing.ts on purpose — delivery tariffs can change
// without touching product prices, loyalty math, or vice versa.

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
