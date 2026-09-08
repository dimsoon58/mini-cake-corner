export type WorkshopType = "signature" | "paint";

export interface WorkshopSession {
  id: string;
  workshopType: WorkshopType;
  date: string; // "YYYY-MM-DD"
  time: string; // "HH:MM"
  capacity: number;
  booked: number;
  pricePerPerson: number;
  currency: string;
}

// ── Pricing & booking limits ────────────────────────────────────────────────
// SINGLE frontend source of truth. Must stay identical to the server-side
// values in supabase/functions/_shared/workshops.ts (WORKSHOP_PRICE /
// WORKSHOP_MAX_PARTICIPANTS) — the backend re-validates every price and
// participant count; it never trusts the value sent by the browser.
export const WORKSHOP_PRICE_PER_PERSON: Record<WorkshopType, number> = {
  signature: 85,
  paint: 65,
};

export const WORKSHOP_MAX_PARTICIPANTS: Record<WorkshopType, number> = {
  signature: 8,
  paint: 10,
};

export const workshopInfo: Record<
  WorkshopType,
  {
    title: string;
    titleFr: string;
    description: string;
    descriptionFr: string;
    duration: string;
    durationFr: string;
    maxParticipants: number;
    pricePerPerson: number;
    currency: string;
    features: string[];
    featuresFr: string[];
    includes: string[];
    includesFr: string[];
  }
> = {
  signature: {
    title: "Signature Workshop",
    titleFr: "Atelier Signature",
    description: "Learn the basics of Bento Cake decorating in this hands-on 2-hour workshop.",
    descriptionFr: "Découvrez les bases de la décoration du Bento Cake lors de cet atelier pratique de 2 heures.",
    duration: "2 hours",
    durationFr: "2 heures",
    maxParticipants: WORKSHOP_MAX_PARTICIPANTS.signature,
    pricePerPerson: WORKSHOP_PRICE_PER_PERSON.signature,
    currency: "CHF",
    features: [
      "Frost your cake",
      "Learn piping techniques",
      "Buttercream basics",
      "Decorate your own cake",
      "Take it home",
    ],
    featuresFr: [
      "Glacez votre gâteau",
      "Apprenez les techniques de pochage",
      "Les bases de la crème au beurre",
      "Décorez votre propre gâteau",
      "Repartez avec votre création",
    ],
    includes: ["All materials provided", "Apron included", "Refreshments", "Recipe card to take home"],
    includesFr: ["Tous les matériaux fournis", "Tablier inclus", "Rafraîchissements", "Fiche recette à emporter"],
  },
  paint: {
    title: "Paint Workshop",
    titleFr: "Atelier Peinture",
    description: "Turn your cake into edible art with our creative painting workshop.",
    descriptionFr: "Transformez votre gâteau en œuvre d'art comestible lors de notre atelier de peinture.",
    duration: "2 hours",
    durationFr: "2 heures",
    maxParticipants: WORKSHOP_MAX_PARTICIPANTS.paint,
    pricePerPerson: WORKSHOP_PRICE_PER_PERSON.paint,
    currency: "CHF",
    features: [
      "Ready-to-decorate cake",
      "Edible paint",
      "Creative designs",
      "Perfect for beginners",
    ],
    featuresFr: [
      "Gâteau prêt à décorer",
      "Peinture comestible",
      "Créations originales",
      "Idéal pour les débutants",
    ],
    includes: ["Ready-to-decorate cake", "Edible paints & brushes", "Apron included", "Refreshments"],
    includesFr: ["Gâteau prêt à décorer", "Peintures comestibles & pinceaux", "Tablier inclus", "Rafraîchissements"],
  },
};

// Current sessions on offer. `capacity` / `booked` are kept for the existing
// date-picker UI only: there is NO server-side total-capacity enforcement
// across separate customers (see notes at the end of the implementation).
// The only hard limit is WORKSHOP_MAX_PARTICIPANTS per single booking.
export const workshopSessions: WorkshopSession[] = [
  { id: "sig-2026-10-03",   workshopType: "signature", date: "2026-10-03", time: "13:00", capacity: WORKSHOP_MAX_PARTICIPANTS.signature, booked: 0, pricePerPerson: WORKSHOP_PRICE_PER_PERSON.signature, currency: "CHF" },
  { id: "paint-2026-10-07", workshopType: "paint",     date: "2026-10-07", time: "14:00", capacity: WORKSHOP_MAX_PARTICIPANTS.paint,     booked: 0, pricePerPerson: WORKSHOP_PRICE_PER_PERSON.paint,     currency: "CHF" },
  { id: "paint-2026-10-10", workshopType: "paint",     date: "2026-10-10", time: "14:00", capacity: WORKSHOP_MAX_PARTICIPANTS.paint,     booked: 0, pricePerPerson: WORKSHOP_PRICE_PER_PERSON.paint,     currency: "CHF" },
  { id: "paint-2026-10-14", workshopType: "paint",     date: "2026-10-14", time: "14:00", capacity: WORKSHOP_MAX_PARTICIPANTS.paint,     booked: 0, pricePerPerson: WORKSHOP_PRICE_PER_PERSON.paint,     currency: "CHF" },
];

export function getSessionsForType(type: WorkshopType): WorkshopSession[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return workshopSessions.filter(
    (s) => s.workshopType === type && new Date(s.date) >= today
  );
}

export function spotsLeft(session: WorkshopSession): number {
  return session.capacity - session.booked;
}

export function formatSessionDate(dateStr: string, lang: "en" | "fr"): string {
  const d = new Date(dateStr + "T00:00:00");
  if (lang === "fr") {
    return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}
