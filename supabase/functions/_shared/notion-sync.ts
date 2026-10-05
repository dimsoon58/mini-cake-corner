// Interrupteur de la synchronisation Notion / Make (F24, 2026-10-05).
//
// Lu dans public.app_settings (clé notion_sync_enabled) par la fonction SQL
// app_setting_bool. ACTIVÉ par défaut : clé absente, base illisible ou
// fonction pas encore déployée = « actif », donc exactement le comportement
// d'avant. Désactivé (false) :
//   - une commande n'attend plus la confirmation de Make pour être
//     « terminée » (make_notified_at, workshop_make_notified_at) ;
//   - plus aucun envoi vers les scénarios Notion (commandes 7026183,
//     réparation 7323863, workshops 7319889, statuts et remboursements) ;
//   - les e-mails, factures, reprises et marqueurs ne changent pas.
// Valeur gardée 30 s par instance (évite une lecture par commande pendant
// une reprise).

const TTL_MS = 30_000;
let cached: { value: boolean; at: number } | null = null;

// deno-lint-ignore no-explicit-any
export async function notionSyncEnabled(supabase: any): Promise<boolean> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  let value = true;
  try {
    const { data, error } = await supabase.rpc("app_setting_bool", { p_key: "notion_sync_enabled", p_default: true });
    if (!error && data === false) value = false;
  } catch {
    value = true;
  }
  cached = { value, at: Date.now() };
  return value;
}

/** Tests uniquement : oublie la valeur gardée. */
export function resetNotionSyncCache() {
  cached = null;
}
