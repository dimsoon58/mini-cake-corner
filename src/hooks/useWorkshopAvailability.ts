import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// Live workshop seat availability, straight from the server-authoritative
// get_workshop_availability() RPC (workshop_sessions minus the active seats of
// occupying reservations). No Realtime — a fresh read is enough.
export interface WorkshopAvailabilityRow {
  id: string;
  workshop_type: "signature" | "paint";
  workshop_date: string; // "YYYY-MM-DD"
  workshop_time: string; // "HH:MM"
  unit_price: number;
  max_capacity: number;
  is_open: boolean;
  active_reserved_seats: number;
  remaining_seats: number;
}

interface UseWorkshopAvailability {
  rows: WorkshopAvailabilityRow[] | null;
  bySession: Record<string, WorkshopAvailabilityRow>;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<WorkshopAvailabilityRow[] | null>;
}

export function useWorkshopAvailability(): UseWorkshopAvailability {
  const [rows, setRows] = useState<WorkshopAvailabilityRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data, error: rpcError } = await supabase.rpc("get_workshop_availability");
    if (rpcError) {
      setError(rpcError.message);
      setLoading(false);
      return null;
    }
    const next = (data ?? []) as WorkshopAvailabilityRow[];
    setError(null);
    setRows(next);
    setLoading(false);
    return next;
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const bySession = (rows ?? []).reduce<Record<string, WorkshopAvailabilityRow>>((acc, r) => {
    acc[r.id] = r;
    return acc;
  }, {});

  return { rows, bySession, loading, error, refresh };
}
