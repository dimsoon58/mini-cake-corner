import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { addDays, eachDay, longDate } from "@/lib/team";

// F32 — événements du Planning (fêtes et marketing) : types, appels à la
// fonction marketing-events et petites aides d'affichage. Mel et Eli
// seulement ; l'employée ne les charge jamais.

export interface MarketingTask { id: string; event_id: string; title: string; due_date: string | null; done: boolean; event_title?: string }
export interface MarketingEvent {
  id: string; title: string; start_date: string; end_date: string; indicative: boolean;
  note: string | null; ideas: string | null; dates_to_check: boolean; tasks: MarketingTask[];
}
export interface MarketingPlanning { today: string; events: MarketingEvent[]; tasks: MarketingTask[]; todo: MarketingTask[]; unavailable?: boolean }

export class MarketingError extends Error {
  constructor(message: string, public reason: string | null) { super(message); }
}

export async function marketingApi<T = unknown>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("marketing-events", { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    let j: { error?: string; reason?: string } | null = null;
    try { j = await ctx?.json(); } catch { /* not JSON */ }
    if (ctx?.status === 404 && !j?.reason) throw new MarketingError("La fonction marketing-events n'est pas encore déployée.", "not_deployed");
    throw new MarketingError(j?.error || "Erreur inattendue. Réessayez.", j?.reason ?? null);
  }
  if (data?.error) throw new MarketingError(String(data.error), data.reason ?? null);
  return (data?.data ?? null) as T;
}

/** « Afficher les événements » : retenu dans ce navigateur (affiché par défaut). */
const SHOW_KEY = "admin.planning.showEvents";
export function useShowEvents(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    try { return localStorage.getItem(SHOW_KEY) !== "0"; } catch { return true; }
  });
  return [on, (v: boolean) => {
    setOn(v);
    try { localStorage.setItem(SHOW_KEY, v ? "1" : "0"); } catch { /* stockage indisponible */ }
  }];
}

/** Jour → événements qui le couvrent (entre from et to inclus). */
export function eventsByDay(events: MarketingEvent[], from: string, to: string): Record<string, MarketingEvent[]> {
  const map: Record<string, MarketingEvent[]> = {};
  for (const e of events) {
    const a = e.start_date > from ? e.start_date : from;
    const z = e.end_date < to ? e.end_date : to;
    if (a > z) continue;
    for (const d of eachDay(a, z)) (map[d] ??= []).push(e);
  }
  return map;
}

/** Jour → tâches prévues ce jour-là. */
export function tasksByDay(tasks: MarketingTask[]): Record<string, MarketingTask[]> {
  const map: Record<string, MarketingTask[]> = {};
  for (const t of tasks) if (t.due_date) (map[t.due_date] ??= []).push(t);
  return map;
}

const MONTHS_SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
/** « 14 févr. », « 14–20 avr. », « 25 mai – 30 juin » */
export function eventWhen(e: Pick<MarketingEvent, "start_date" | "end_date">): string {
  const d = (s: string) => String(+s.slice(8, 10));
  const m = (s: string) => MONTHS_SHORT[+s.slice(5, 7) - 1];
  if (e.start_date === e.end_date) return `${d(e.start_date)} ${m(e.start_date)}`;
  if (e.start_date.slice(0, 7) === e.end_date.slice(0, 7)) return `${d(e.start_date)}–${d(e.end_date)} ${m(e.end_date)}`;
  const y = e.start_date.slice(0, 4) !== e.end_date.slice(0, 4);
  return `${d(e.start_date)} ${m(e.start_date)}${y ? ` ${e.start_date.slice(0, 4)}` : ""} – ${d(e.end_date)} ${m(e.end_date)}${y ? ` ${e.end_date.slice(0, 4)}` : ""}`;
}

/** Tâche en retard (non faite, date passée). */
export const isLate = (t: MarketingTask, today: string) => !t.done && !!t.due_date && t.due_date < today;

/** Même jour et mois, une autre année (29 février → 28). */
export function shiftYear(d: string, years: number): string {
  const y = +d.slice(0, 4) + years;
  const md = d.slice(5);
  if (md === "02-29" && !(y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0))) return `${y}-02-28`;
  return `${y}-${md}`;
}

export { addDays, longDate };
