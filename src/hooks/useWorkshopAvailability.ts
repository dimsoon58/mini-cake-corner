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

// One short automatic retry — covers a transient network-level blip (the RPC
// call itself throwing: a failed fetch, a CORS hiccup, a cold connection)
// so the page doesn't get stuck forever on a one-off glitch. Deliberately
// NOT applied to a normal PostgREST {error} response (bad RLS, unknown
// function, etc.) — that's handled exactly as before, no retry, since a
// real backend error is just as likely to fail identically a second time.
// Never more than one retry: a genuinely persistent failure must surface to
// the UI, not loop.
const NETWORK_RETRY_DELAY_MS = 800;

// A request that never settles at all (no resolve, no reject — a silently
// dropped connection, a hung proxy) is NOT caught by try/catch/finally: an
// `await` on a promise that never settles never returns control, so
// `finally` never runs either. Confirmed live: supabase-js normalises a
// failed fetch into a resolved {error} (handled below, no throw at all in
// that case) rather than rejecting — so the one real danger for a stuck
// "loading" forever is a hang, not a rejection. This timeout forces such a
// call to fail after a bounded wait so `finally` is always eventually
// reached. 6s per attempt: generous for a same-project RPC, short enough
// that two timed-out attempts (with the short retry delay) still resolve
// in well under 15s.
const RPC_TIMEOUT_MS = 6000;

function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Request timed out")), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

export function useWorkshopAvailability(): UseWorkshopAvailability {
  const [rows, setRows] = useState<WorkshopAvailabilityRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let result: Awaited<ReturnType<typeof supabase.rpc>>;
      try {
        result = await withTimeout(supabase.rpc("get_workshop_availability"), RPC_TIMEOUT_MS);
      } catch (networkErr) {
        // The call itself threw (or timed out) instead of resolving to
        // {data, error} — a genuine transport-level failure, not a
        // PostgREST error. Wait a beat and try exactly once more before
        // giving up.
        await new Promise((resolve) => setTimeout(resolve, NETWORK_RETRY_DELAY_MS));
        result = await withTimeout(supabase.rpc("get_workshop_availability"), RPC_TIMEOUT_MS);
      }

      const { data, error: rpcError } = result;
      if (rpcError) {
        setError(rpcError.message);
        return null;
      }
      const next = (data ?? []) as WorkshopAvailabilityRow[];
      setRows(next);
      return next;
    } catch (e) {
      // Either the retry above threw again, or something else unexpected
      // happened — always leaves a readable message in state instead of
      // leaving the caller with no idea why nothing arrived.
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      // Always reached — success, PostgREST error, or an exception that
      // survived the retry — so the UI can never get stuck on "loading"
      // indefinitely.
      setLoading(false);
    }
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
