// F28 — Chargement des workshops pour la production : articles workshop,
// réservations, génoises des places annulées, lots préparés, surplus décidés,
// réglages par type d'atelier. Partagé par get-production (une période) et
// workshop-production (une session) : les deux comptent exactement de la
// même façon (computeWorkshopSessions). Sans F28 appliquée, les workshops
// sont comptés comme avant (1 Bento rond par place, rien de préparé).
import type { ProdWorkshopItem, WorkshopProductionState } from "./production-stats.ts";

// deno-lint-ignore no-explicit-any
type Client = any;

export async function loadWorkshopProduction(
  supabase: Client,
  filter: { from: string; to: string } | { sessionId: string },
): Promise<{ items: ProdWorkshopItem[]; orderIds: string[]; state: WorkshopProductionState; linked: boolean }> {
  let q = supabase
    .from("order_items")
    .select("id, order_id, workshop_session_id, workshop_date, workshop_time, workshop_type, workshop_participants, workshop_sponge_choices")
    .eq("product", "workshop");
  q = "sessionId" in filter ? q.eq("workshop_session_id", filter.sessionId) : q.gte("workshop_date", filter.from).lte("workshop_date", filter.to);
  const { data: wsItems, error: wErr } = await q;
  if (wErr) throw new Error(`Failed to load workshop items: ${wErr.message}`);
  const rows = wsItems ?? [];

  const resByItem = new Map<string, { id: string; status: string; active_seats: number; purchased_seats: number; cancelled_seats: number }>();
  if (rows.length > 0) {
    const { data: reservations, error: rErr } = await supabase
      .from("workshop_reservations")
      .select("id, order_item_id, status, active_seats, purchased_seats, cancelled_seats")
      .in("order_item_id", rows.map((w: { id: string }) => w.id));
    if (rErr) throw new Error(`Failed to load workshop reservations: ${rErr.message}`);
    for (const r of reservations ?? []) resByItem.set(r.order_item_id, r);
  }

  // Génoises des places annulées + état de production (F28). Absents → mode d'avant.
  let linked = true;
  let cancelled: Record<string, { vanilla: number; chocolate: number }> = {};
  const resIds = Array.from(resByItem.values()).map((r) => r.id);
  if (resIds.length > 0) {
    const { data, error } = await supabase.rpc("workshop_cancelled_sponges", { p_reservations: resIds });
    if (error) linked = false; else cancelled = data ?? {};
  }
  const sessionIds = Array.from(new Set(rows.map((w: { workshop_session_id: string | null }) => w.workshop_session_id).filter(Boolean))) as string[];
  if ("sessionId" in filter && !sessionIds.includes(filter.sessionId)) sessionIds.push(filter.sessionId);
  let state: WorkshopProductionState = { settings: {}, preparations: [], surplus: [] };
  if (linked && sessionIds.length > 0) {
    const { data, error } = await supabase.rpc("workshop_production_state", { p_sessions: sessionIds });
    if (error) linked = false; else state = { settings: data?.settings ?? {}, preparations: data?.preparations ?? [], surplus: data?.surplus ?? [] };
  }
  if (sessionIds.length > 0) {
    const { data: sess } = await supabase.from("workshop_sessions").select("id, workshop_type, workshop_date, workshop_time").in("id", sessionIds);
    state.sessions = Object.fromEntries((sess ?? []).map((s: { id: string; workshop_type: string; workshop_date: string; workshop_time: string | null }) =>
      [s.id, { type: s.workshop_type, date: String(s.workshop_date), time: s.workshop_time }]));
  }

  const items: ProdWorkshopItem[] = rows.map((w: {
    id: string; order_id: string; workshop_session_id: string | null; workshop_date: string; workshop_time: string | null;
    workshop_type: string | null; workshop_participants: number | null; workshop_sponge_choices: string[] | null;
  }) => {
    const r = resByItem.get(w.id);
    return {
      id: w.id,
      order_id: w.order_id,
      session_id: w.workshop_session_id,
      workshop_date: w.workshop_date,
      workshop_time: w.workshop_time,
      workshop_type: w.workshop_type,
      workshop_participants: w.workshop_participants,
      workshop_sponge_choices: w.workshop_sponge_choices,
      reservation: r
        ? { id: r.id, status: r.status, active_seats: Number(r.active_seats) || 0, purchased_seats: Number(r.purchased_seats) || 0, cancelled_seats: Number(r.cancelled_seats) || 0 }
        : null,
      cancelledSponges: r ? cancelled[r.id] ?? null : null,
    };
  });
  return { items, orderIds: Array.from(new Set(rows.map((w: { order_id: string }) => w.order_id))), state, linked };
}
