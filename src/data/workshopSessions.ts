export type WorkshopType = "signature" | "paint" | "piping";

export interface WorkshopSession {
  id: string;
  workshopType: WorkshopType;
  date: string; // "YYYY-MM-DD"
  time: string; // "HH:MM"
  capacity: number;
  booked: number;
  pricePerPerson: number;
  currency: string;
  theme?: string | null;
}

// ── Pricing & booking limits ────────────────────────────────────────────────
// SINGLE frontend source of truth. Must stay identical to the server-side
// values in supabase/functions/_shared/workshops.ts (WORKSHOP_PRICE /
// WORKSHOP_MAX_PARTICIPANTS) — the backend re-validates every price and
// participant count; it never trusts the value sent by the browser.
export const WORKSHOP_PRICE_PER_PERSON: Record<WorkshopType, number> = {
  signature: 120,
  piping: 85,
  paint: 65,
};

export const WORKSHOP_MAX_PARTICIPANTS: Record<WorkshopType, number> = {
  signature: 8,
  piping: 8,
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
    titleFr: "Workshop Signature",
    description: "Learn the art of assembling, frosting and decorating your own Bento Cake in this hands-on 3-hour workshop.",
    descriptionFr: "Apprenez à assembler, glacer et décorer votre propre Bento Cake lors de ce workshop pratique de 3 heures.",
    duration: "3 hours",
    durationFr: "3 heures",
    maxParticipants: WORKSHOP_MAX_PARTICIPANTS.signature,
    pricePerPerson: WORKSHOP_PRICE_PER_PERSON.signature,
    currency: "CHF",
    features: [
      "Assemble your cake",
      "Frost your cake",
      "Learn piping techniques",
      "Buttercream basics",
      "Decorate your own cake",
      "Take it home",
    ],
    featuresFr: [
      "Assemblez votre gâteau",
      "Glacez votre gâteau",
      "Apprenez les techniques de pochage",
      "Les bases de la crème au beurre",
      "Décorez votre propre gâteau",
      "Repartez avec votre création",
    ],
    includes: ["All materials provided", "Apron included", "Refreshments", "Recipe card to take home"],
    includesFr: ["Tous les matériaux fournis", "Tablier inclus", "Rafraîchissements", "Fiche recette à emporter"],
  },
  piping: {
    title: "Piping Workshop",
    titleFr: "Workshop Pochage",
    description: "Master the art of piping and decorate your own Bento Cake.",
    descriptionFr: "Maîtrisez l'art du pochage et décorez votre propre Bento Cake.",
    duration: "1h30",
    durationFr: "1h30",
    maxParticipants: WORKSHOP_MAX_PARTICIPANTS.piping,
    pricePerPerson: WORKSHOP_PRICE_PER_PERSON.piping,
    currency: "CHF",
    features: [
      "Ready-to-decorate frosted cake",
      "Learn piping techniques",
      "Explore different piping tips",
      "Create decorative borders and patterns",
      "Decorate your own cake",
      "Take it home",
    ],
    featuresFr: [
      "Gâteau glacé prêt à décorer",
      "Apprenez les techniques de pochage",
      "Explorez différentes douilles",
      "Créez des bordures et motifs décoratifs",
      "Décorez votre propre gâteau",
      "Repartez avec votre création",
    ],
    includes: ["Ready-to-decorate frosted cake", "Piping bags & tips", "Apron included", "Refreshments"],
    includesFr: ["Gâteau glacé prêt à décorer", "Poches à douille & embouts", "Tablier inclus", "Rafraîchissements"],
  },
  paint: {
    title: "Paint Workshop",
    titleFr: "Workshop Peinture",
    description: "Turn your cake into edible art with our creative painting workshop.",
    descriptionFr: "Transformez votre gâteau en œuvre d'art comestible lors de notre workshop de peinture.",
    duration: "1h30",
    durationFr: "1h30",
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

// Current sessions on offer — this list defines which sessions exist and their
// date / time / price. LIVE availability (remaining seats, is_open) now comes
// from the server: public.workshop_sessions + the get_workshop_availability()
// RPC, read via useWorkshopAvailability(). `capacity` / `booked` below are a
// static fallback only (capacity = the per-booking max, booked = 0) for when
// that RPC has not resolved yet. Session ids MUST stay identical to
// supabase/functions/_shared/workshops.ts and the workshop_sessions seed.
export const workshopSessions: WorkshopSession[] = [
  { id: "sig-2026-10-03",   workshopType: "signature", date: "2026-10-03", time: "13:00", capacity: WORKSHOP_MAX_PARTICIPANTS.signature, booked: 0, pricePerPerson: WORKSHOP_PRICE_PER_PERSON.signature, currency: "CHF" },
  { id: "paint-2026-10-07", workshopType: "paint",     date: "2026-10-07", time: "14:00", capacity: WORKSHOP_MAX_PARTICIPANTS.paint,     booked: 0, pricePerPerson: WORKSHOP_PRICE_PER_PERSON.paint,     currency: "CHF" },
  { id: "paint-2026-10-10", workshopType: "paint",     date: "2026-10-10", time: "14:00", capacity: WORKSHOP_MAX_PARTICIPANTS.paint,     booked: 0, pricePerPerson: WORKSHOP_PRICE_PER_PERSON.paint,     currency: "CHF" },
  { id: "paint-2026-10-14", workshopType: "paint",     date: "2026-10-14", time: "14:00", capacity: WORKSHOP_MAX_PARTICIPANTS.paint,     booked: 0, pricePerPerson: WORKSHOP_PRICE_PER_PERSON.paint,     currency: "CHF" },
];

// F24 (2026-10-05) : les sessions viennent de la base (public.workshop_sessions,
// gérées dans Admin > Workshops) via get_workshop_availability(). La liste
// ci-dessus ne sert plus que de remplacement pendant le chargement ou si la
// base ne répond pas.
export interface SessionRow { id: string; workshop_type: string; workshop_date: string; workshop_time: string; unit_price: number; max_capacity: number; active_reserved_seats?: number; is_open?: boolean; theme?: string | null }
export function sessionFromRow(r: SessionRow): WorkshopSession {
  return { id: r.id, workshopType: r.workshop_type as WorkshopType, date: String(r.workshop_date).slice(0, 10), time: r.workshop_time,
    capacity: Number(r.max_capacity), booked: Number(r.active_reserved_seats ?? 0), pricePerPerson: Number(r.unit_price), currency: "CHF", theme: r.theme ?? null };
}
/**
 * Sessions proposées sur le site pour un type : uniquement celles de la base,
 * à venir et ouvertes. Une session fermée dans Admin > Workshops disparaît du
 * site (ses réservations restent valables). Tant que la base n'a pas répondu :
 * aucune session (la page affiche « Chargement des dates »), jamais l'ancienne
 * liste écrite ci-dessus, qui pourrait montrer des dates retirées.
 */
export function upcomingSessions(type: WorkshopType, rows: SessionRow[] | null): WorkshopSession[] {
  if (!rows) return [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return rows.filter((r) => r.is_open !== false).map(sessionFromRow)
    .filter((s) => s.workshopType === type && new Date(`${s.date}T00:00:00`) >= today)
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

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
