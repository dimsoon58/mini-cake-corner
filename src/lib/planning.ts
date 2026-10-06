// Planning (/admin/calendar) = ce qui reste à faire. Une commande annulée en
// entier (status « cancelled ») ou un article annulé seul (itemCancelled :
// gâteau annulé, places de workshop toutes annulées) n'y apparaît plus.
// Le tableau de bord, qui lit le même service list-orders-by-date, garde
// tous ses chiffres : ce filtre ne s'applique qu'au Planning.
export interface PlanningEntryState { status: string; itemCancelled?: boolean }

export const stillToDo = (e: PlanningEntryState) => e.status !== "cancelled" && !e.itemCancelled;

/** Jours du mois sans les entrées annulées ; un jour sans rien à faire disparaît. */
export function planningDays<T extends PlanningEntryState>(days: Record<string, T[]>): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const [d, list] of Object.entries(days ?? {})) {
    const kept = list.filter(stillToDo);
    if (kept.length) out[d] = kept;
  }
  return out;
}
