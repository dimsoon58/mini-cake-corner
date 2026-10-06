import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { isAdminEmail } from "@/lib/adminAccess";

// Rôle de la personne connectée dans l'admin (F23) : « admin » (Mel, Eli —
// même liste qu'avant, sans aucun appel réseau), « employee » (accès
// staff_access, lu par la fonction staff-access) ou aucun. Uniquement pour
// l'affichage : chaque fonction serveur revérifie le rôle et les droits, et
// ne renvoie jamais de montant à l'employée.

export type StaffPermission =
  | "today.view" | "production.view" | "production.update" | "orders.view" | "planning.view"
  | "team.self" | "leave.self" | "manual_orders.draft";
export interface StaffRole {
  loading: boolean;
  role: "admin" | "employee" | null;
  permissions: StaffPermission[];
  memberName: string | null;
  isAdmin: boolean;
  isEmployee: boolean;
  /** Administratrice : tout ; employée : seulement ses droits. */
  can: (p: StaffPermission) => boolean;
}

const cache = new Map<string, { role: "employee" | null; permissions: StaffPermission[]; memberName: string | null }>();

export function useStaffRole(): StaffRole {
  const { user, loading: authLoading } = useAuth();
  const admin = isAdminEmail(user?.email);
  const key = user?.id ?? "";
  const [state, setState] = useState(() => (key ? cache.get(key) ?? null : null));
  const [loading, setLoading] = useState(!admin && !!key && !cache.has(key));

  useEffect(() => {
    if (authLoading || admin || !key) { setLoading(false); return; }
    const hit = cache.get(key);
    if (hit) { setState(hit); setLoading(false); return; }
    let alive = true;
    setLoading(true);
    supabase.functions.invoke("staff-access", { body: { action: "me" } }).then(({ data, error }) => {
      const d = !error ? data?.data : null;
      const v = d?.role === "employee"
        ? { role: "employee" as const, permissions: (d.permissions ?? []) as StaffPermission[], memberName: d.memberName ?? null }
        : { role: null, permissions: [], memberName: null };
      if (!error) cache.set(key, v);
      if (alive) { setState(v); setLoading(false); }
    });
    return () => { alive = false; };
  }, [authLoading, admin, key]);

  const role = admin ? "admin" : state?.role ?? null;
  const permissions = admin ? [] : state?.permissions ?? [];
  return {
    loading: authLoading || loading,
    role,
    permissions,
    memberName: state?.memberName ?? null,
    isAdmin: admin,
    isEmployee: role === "employee",
    can: (p) => admin || permissions.includes(p),
  };
}
