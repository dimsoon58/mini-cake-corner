// Server-side source of truth for workshops. The browser sends a session id,
// a workshop type and a participant count; NOTHING here trusts a price or a
// max sent by the client. Keep these values identical to the frontend copy in
// src/data/workshopSessions.ts.

export type WorkshopType = "signature" | "paint";

export const WORKSHOP_PRICE: Record<WorkshopType, number> = {
  signature: 85,
  paint: 65,
};

export const WORKSHOP_MAX_PARTICIPANTS: Record<WorkshopType, number> = {
  signature: 8,
  paint: 10,
};

export interface WorkshopSessionDef {
  id: string;
  type: WorkshopType;
  date: string; // "YYYY-MM-DD"
  time: string; // "HH:MM"
}

export const WORKSHOP_SESSIONS: WorkshopSessionDef[] = [
  { id: "sig-2026-10-03",   type: "signature", date: "2026-10-03", time: "13:00" },
  { id: "paint-2026-10-07", type: "paint",     date: "2026-10-07", time: "14:00" },
  { id: "paint-2026-10-10", type: "paint",     date: "2026-10-10", time: "14:00" },
  { id: "paint-2026-10-14", type: "paint",     date: "2026-10-14", time: "14:00" },
];

export function getWorkshopSession(id: string | null | undefined): WorkshopSessionDef | undefined {
  if (!id) return undefined;
  return WORKSHOP_SESSIONS.find((s) => s.id === id);
}

export function workshopTitle(type: WorkshopType, lang: "fr" | "en"): string {
  if (type === "signature") return lang === "fr" ? "Atelier Signature" : "Signature Workshop";
  return lang === "fr" ? "Atelier Peinture" : "Paint Workshop";
}

// "DD.MM.YYYY" from an ISO date string — matches formatDateCH used elsewhere.
export function formatWorkshopDate(dateValue?: string | null): string {
  if (!dateValue) return "—";
  const [year, month, day] = String(dateValue).split("-");
  return year && month && day ? `${day}.${month}.${year}` : String(dateValue);
}
