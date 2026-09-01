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
    maxParticipants: 8,
    pricePerPerson: 120,
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
    maxParticipants: 10,
    pricePerPerson: 100,
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

export const workshopSessions: WorkshopSession[] = [
  // Signature Workshop sessions
  { id: "sig-2026-09-13", workshopType: "signature", date: "2026-09-13", time: "10:00", capacity: 8, booked: 5, pricePerPerson: 120, currency: "CHF" },
  { id: "sig-2026-09-20", workshopType: "signature", date: "2026-09-20", time: "14:00", capacity: 8, booked: 8, pricePerPerson: 120, currency: "CHF" },
  { id: "sig-2026-10-04", workshopType: "signature", date: "2026-10-04", time: "10:00", capacity: 8, booked: 2, pricePerPerson: 120, currency: "CHF" },
  { id: "sig-2026-10-18", workshopType: "signature", date: "2026-10-18", time: "14:00", capacity: 8, booked: 0, pricePerPerson: 120, currency: "CHF" },
  { id: "sig-2026-11-08", workshopType: "signature", date: "2026-11-08", time: "10:00", capacity: 8, booked: 4, pricePerPerson: 120, currency: "CHF" },
  { id: "sig-2026-11-22", workshopType: "signature", date: "2026-11-22", time: "14:00", capacity: 8, booked: 1, pricePerPerson: 120, currency: "CHF" },
  { id: "sig-2026-12-06", workshopType: "signature", date: "2026-12-06", time: "10:00", capacity: 8, booked: 6, pricePerPerson: 120, currency: "CHF" },
  { id: "sig-2026-12-13", workshopType: "signature", date: "2026-12-13", time: "14:00", capacity: 8, booked: 3, pricePerPerson: 120, currency: "CHF" },

  // Paint Workshop sessions
  { id: "paint-2026-09-19", workshopType: "paint", date: "2026-09-19", time: "14:00", capacity: 10, booked: 7, pricePerPerson: 100, currency: "CHF" },
  { id: "paint-2026-10-03", workshopType: "paint", date: "2026-10-03", time: "10:00", capacity: 10, booked: 3, pricePerPerson: 100, currency: "CHF" },
  { id: "paint-2026-10-17", workshopType: "paint", date: "2026-10-17", time: "14:00", capacity: 10, booked: 0, pricePerPerson: 100, currency: "CHF" },
  { id: "paint-2026-11-07", workshopType: "paint", date: "2026-11-07", time: "10:00", capacity: 10, booked: 10, pricePerPerson: 100, currency: "CHF" },
  { id: "paint-2026-11-21", workshopType: "paint", date: "2026-11-21", time: "14:00", capacity: 10, booked: 5, pricePerPerson: 100, currency: "CHF" },
  { id: "paint-2026-12-05", workshopType: "paint", date: "2026-12-05", time: "10:00", capacity: 10, booked: 8, pricePerPerson: 100, currency: "CHF" },
  { id: "paint-2026-12-12", workshopType: "paint", date: "2026-12-12", time: "14:00", capacity: 10, booked: 2, pricePerPerson: 100, currency: "CHF" },
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
