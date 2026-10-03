import { useCallback, useEffect, useState, type ReactNode } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { useLang } from "@/context/LanguageContext";
import { clearAdminSession, getAdminSession, setAdminSession, useAdminSessionActive } from "@/lib/adminSession";

// Admin > écran « Code PIN » (F16) : après la connexion par email, le PIN
// est demandé une fois ; ensuite tout le dashboard est accessible sans le
// ressaisir, jusqu'à la déconnexion ou l'expiration de l'autorisation.
// La vérification est faite par le serveur (fonction admin-pin) ; ce
// composant n'est qu'un écran. Tant que admin-pin n'est pas déployée, le
// dashboard fonctionne comme avant (PIN saisi action par action).

type GateState = "checking" | "locked" | "open" | "legacy";
let verified: { token: string; until: number } | null = null;   // déjà vérifié côté serveur pendant cette visite

export function AdminPinGate({ children }: { children: ReactNode }) {
  const { t } = useLang();
  const { user } = useAuth();
  const active = useAdminSessionActive(user?.id);
  const [state, setState] = useState<GateState>("checking");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    const s = getAdminSession(user?.id);
    if (s && verified?.token === s.token && verified.until > Date.now()) { setState("open"); return; }
    const { data, error: err } = await supabase.functions.invoke("admin-pin", { body: { action: "status" } });
    if (err) {
      const status = (err as { context?: Response }).context?.status;
      if (status === 404) { setState("legacy"); return; }            // fonction pas encore déployée
      setState(s ? "open" : "locked");                                // erreur passagère : le serveur revérifie à chaque appel
      return;
    }
    if (data?.data?.active && s) {
      verified = { token: s.token, until: Math.min(Date.parse(s.expiresAt), Date.now() + 10 * 60_000) };
      setState("open");
    } else {
      if (s) clearAdminSession();
      setState("locked");
    }
  }, [user?.id]);

  useEffect(() => { check(); }, [check, active]);

  const unlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !pin.trim() || !user) return;
    setBusy(true); setError(null);
    const { data, error: err } = await supabase.functions.invoke("admin-pin", { body: { action: "unlock", pin } });
    let message: string | null = data?.error ?? null;
    if (err) { try { message = (await (err as { context?: Response }).context?.json())?.error ?? null; } catch { /* ignore */ } }
    setBusy(false);
    setPin("");
    if (err || !data?.data?.token) {
      setError(message ?? t("The PIN could not be checked. Please try again.", "Le PIN n'a pas pu être vérifié. Réessayez."));
      return;
    }
    setAdminSession(user.id, data.data.token, data.data.expiresAt);
    verified = { token: data.data.token, until: Math.min(Date.parse(data.data.expiresAt), Date.now() + 10 * 60_000) };
    setState("open");
  };

  if (state === "open" || state === "legacy") return <>{children}</>;
  if (state === "checking") return <main className="py-16 text-center"><Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" /></main>;
  return (
    <main className="max-w-sm mx-auto px-6 py-20 text-center" data-testid="admin-pin-gate">
      <KeyRound className="w-8 h-8 mx-auto text-primary mb-4" />
      <h1 className="font-sans uppercase tracking-[0.105em] text-2xl text-foreground mb-2">{t("Admin PIN", "Code PIN administrateur")}</h1>
      <p className="text-sm text-muted-foreground mb-6">
        {t("Asked once per session. Then every admin action works without typing it again.", "Demandé une seule fois par session. Ensuite, toutes les actions admin fonctionnent sans le ressaisir.")}
      </p>
      <form onSubmit={unlock} className="space-y-3">
        <Input type="password" inputMode="numeric" autoComplete="off" autoFocus value={pin} onChange={(e) => setPin(e.target.value)}
          aria-label={t("Admin PIN", "Code PIN administrateur")} className="rounded-none text-center text-lg tracking-[0.3em]" />
        {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
        <Button type="submit" className="w-full rounded-none" disabled={busy || !pin.trim()}>
          {busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}{t("Unlock", "Déverrouiller")}
        </Button>
      </form>
    </main>
  );
}
