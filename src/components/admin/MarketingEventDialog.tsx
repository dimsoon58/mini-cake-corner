import { useEffect, useState } from "react";
import { AlertTriangle, Check, Copy, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { isLate, longDate, marketingApi, shiftYear, type MarketingEvent, type MarketingTask } from "@/lib/marketingEvents";

// F32 — fiche d'un événement du Planning : nom, date ou période, idées,
// tâches datées (« Fait »), dupliquer, supprimer. Les tâches s'enregistrent
// tout de suite ; le reste avec « Enregistrer ».

type Draft = { id: string | null; title: string; start: string; end: string; indicative: boolean; note: string; ideas: string; datesToCheck: boolean };
const toDraft = (e: MarketingEvent): Draft => ({
  id: e.id, title: e.title, start: e.start_date, end: e.end_date, indicative: e.indicative,
  note: e.note ?? "", ideas: e.ideas ?? "", datesToCheck: e.dates_to_check,
});

export function MarketingEventDialog({ eventId, newDate, today, onClose, onChanged }: {
  eventId: string | null; newDate?: string; today: string; onClose: () => void; onChanged: () => void;
}) {
  const [v, setV] = useState<Draft | null>(eventId ? null : { id: null, title: "", start: newDate ?? today, end: newDate ?? today, indicative: false, note: "", ideas: "", datesToCheck: false });
  const [tasks, setTasks] = useState<MarketingTask[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [newTask, setNewTask] = useState({ title: "", due: "" });
  const [editTask, setEditTask] = useState<{ id: string; title: string; due: string } | null>(null);
  const [dup, setDup] = useState<{ start: string; end: string } | null>(null);

  const load = async (id: string) => {
    const e = await marketingApi<MarketingEvent>({ action: "get", id });
    setV(toDraft(e));
    setTasks(e.tasks);
  };
  useEffect(() => {
    if (!eventId) return;
    load(eventId).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [eventId]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try { await fn(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  const save = () => run(async () => {
    if (!v) return;
    const r = await marketingApi<{ id: string }>({ action: "save_event", id: v.id, title: v.title, start: v.start, end: v.end,
      indicative: v.indicative, note: v.note, ideas: v.ideas, datesToCheck: v.datesToCheck });
    await load(r.id);
    setMsg(v.id ? "Enregistré." : "Événement créé : vous pouvez maintenant ajouter les tâches.");
    onChanged();
  });
  const remove = () => {
    if (!v?.id || !window.confirm(`Supprimer « ${v.title} » et ses tâches ?`)) return;
    run(async () => {
      await marketingApi({ action: "delete_event", id: v.id });
      onChanged();
      onClose();
    });
  };
  const duplicate = () => run(async () => {
    if (!v?.id || !dup) return;
    const r = await marketingApi<{ id: string }>({ action: "duplicate_event", id: v.id, start: dup.start, end: dup.end });
    setDup(null);
    await load(r.id);
    setMsg(`Copie créée pour le ${longDate(dup.start)} : c'est elle qui est ouverte.`);
    onChanged();
  });

  const addTask = () => run(async () => {
    if (!v?.id) return;
    await marketingApi({ action: "save_task", eventId: v.id, title: newTask.title, due: newTask.due || null });
    setNewTask({ title: "", due: "" });
    await load(v.id);
    onChanged();
  });
  const saveTask = () => run(async () => {
    if (!v?.id || !editTask) return;
    await marketingApi({ action: "save_task", id: editTask.id, title: editTask.title, due: editTask.due || null });
    setEditTask(null);
    await load(v.id);
    onChanged();
  });
  const toggleTask = (t: MarketingTask) => run(async () => {
    await marketingApi({ action: "set_task_done", id: t.id, done: !t.done });
    setTasks((ts) => ts.map((x) => (x.id === t.id ? { ...x, done: !t.done } : x)));
    onChanged();
  });
  const deleteTask = (t: MarketingTask) => {
    if (!v?.id || !window.confirm(`Supprimer la tâche « ${t.title} » ?`)) return;
    run(async () => {
      await marketingApi({ action: "delete_task", id: t.id });
      await load(v.id!);
      onChanged();
    });
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto rounded-none" data-testid="marketing-event-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-violet-500 shrink-0" />
            {v?.id ? v.title || "Événement" : "Nouvel événement"}
          </DialogTitle>
          <DialogDescription>Pour préparer les produits, les photos, la communication et la vitrine. Le site et les commandes ne changent pas.</DialogDescription>
        </DialogHeader>

        {!v ? (
          err ? null : <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
        ) : (
          <>
            {v.datesToCheck && (
              <div className="border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 flex gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>Copié de l'année précédente à la même date : vérifiez les dates (certaines fêtes changent chaque année), puis décochez « Dates à vérifier ».</span>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1 col-span-2">
                <Label htmlFor="mk-title" className="text-xs">Nom</Label>
                <Input id="mk-title" value={v.title} maxLength={120} onChange={(e) => setV({ ...v, title: e.target.value })} placeholder="Ex. Noël" className="rounded-none h-9" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="mk-start" className="text-xs">Du</Label>
                <Input id="mk-start" type="date" value={v.start} onChange={(e) => setV({ ...v, start: e.target.value, end: !v.end || e.target.value > v.end ? e.target.value : v.end })} className="rounded-none h-9" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="mk-end" className="text-xs">Au (inclus)</Label>
                <Input id="mk-end" type="date" value={v.end} min={v.start} onChange={(e) => setV({ ...v, end: e.target.value })} className="rounded-none h-9" />
              </div>
              <label className="col-span-2 flex items-start gap-2 text-sm">
                <input type="checkbox" className="w-4 h-4 mt-0.5" checked={v.indicative} onChange={(e) => setV({ ...v, indicative: e.target.checked })} />
                <span>Période indicative<span className="block text-xs text-muted-foreground">Ex. « fin mai – juin » : affichée en pointillés dans le calendrier.</span></span>
              </label>
              {v.id && (
                <label className="col-span-2 flex items-center gap-2 text-sm">
                  <input type="checkbox" className="w-4 h-4" checked={v.datesToCheck} onChange={(e) => setV({ ...v, datesToCheck: e.target.checked })} />
                  Dates à vérifier
                </label>
              )}
              <div className="space-y-1 col-span-2">
                <Label htmlFor="mk-note" className="text-xs">Note courte (facultatif)</Label>
                <Input id="mk-note" value={v.note} maxLength={500} onChange={(e) => setV({ ...v, note: e.target.value })} placeholder="Ex. Public : 18–20 avril" className="rounded-none h-9" />
              </div>
              <div className="space-y-1 col-span-2">
                <Label htmlFor="mk-ideas" className="text-xs">Idées : gâteaux, collections, visuels</Label>
                <Textarea id="mk-ideas" value={v.ideas} maxLength={10000} rows={5} onChange={(e) => setV({ ...v, ideas: e.target.value })}
                  placeholder="Ex. collection sapin et bonhomme de neige, coffret cadeau, photos avec la vitrine…" className="rounded-none text-sm" />
              </div>
            </div>

            <section className="space-y-2 border-t border-border/60 pt-3" data-testid="marketing-tasks">
              <h3 className="text-[11px] uppercase tracking-[0.105em] font-semibold text-foreground">Tâches</h3>
              {!v.id ? (
                <p className="text-xs text-muted-foreground">Enregistrez d'abord l'événement pour ajouter des tâches.</p>
              ) : (
                <>
                  {tasks.length === 0 && <p className="text-xs text-muted-foreground">Aucune tâche pour l'instant.</p>}
                  <ul className="space-y-1">
                    {tasks.map((t) => editTask?.id === t.id ? (
                      <li key={t.id} className="flex flex-wrap items-center gap-2">
                        <Input value={editTask.title} maxLength={200} onChange={(e) => setEditTask({ ...editTask, title: e.target.value })} className="rounded-none h-8 flex-1 min-w-[10rem] text-sm" />
                        <Input type="date" value={editTask.due} onChange={(e) => setEditTask({ ...editTask, due: e.target.value })} className="rounded-none h-8 w-[9.5rem] text-sm" />
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={saveTask} disabled={busy || !editTask.title.trim()} aria-label="Enregistrer la tâche"><Check className="w-4 h-4" /></Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditTask(null)} aria-label="Annuler"><X className="w-4 h-4" /></Button>
                      </li>
                    ) : (
                      <li key={t.id} className="flex items-center gap-2 text-sm group">
                        <input type="checkbox" className="w-4 h-4 shrink-0" checked={t.done} onChange={() => toggleTask(t)} disabled={busy} aria-label={`Fait : ${t.title}`} />
                        <span className={cn("flex-1 min-w-0", t.done && "line-through text-muted-foreground")}>{t.title}</span>
                        <span className={cn("text-xs whitespace-nowrap", isLate(t, today) ? "text-red-700 font-semibold" : "text-muted-foreground")}>
                          {t.due_date ? longDate(t.due_date) : "sans date"}
                        </span>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditTask({ id: t.id, title: t.title, due: t.due_date ?? "" })} aria-label="Modifier la tâche"><Pencil className="w-3.5 h-3.5" /></Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-red-700" onClick={() => deleteTask(t)} disabled={busy} aria-label="Supprimer la tâche"><Trash2 className="w-3.5 h-3.5" /></Button>
                      </li>
                    ))}
                  </ul>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Input value={newTask.title} maxLength={200} onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                      onKeyDown={(e) => { if (e.key === "Enter" && newTask.title.trim()) addTask(); }}
                      placeholder="Nouvelle tâche (ex. shooting photo)" className="rounded-none h-8 flex-1 min-w-[10rem] text-sm" aria-label="Nouvelle tâche" />
                    <Input type="date" value={newTask.due} onChange={(e) => setNewTask({ ...newTask, due: e.target.value })} className="rounded-none h-8 w-[9.5rem] text-sm" aria-label="Date prévue" />
                    <Button size="sm" variant="outline" className="rounded-none h-8" onClick={addTask} disabled={busy || !newTask.title.trim()}><Plus className="w-4 h-4 mr-1" />Ajouter</Button>
                  </div>
                </>
              )}
            </section>

            {dup && (
              <section className="space-y-2 border border-violet-200 bg-violet-50/60 p-3">
                <p className="text-sm">Dupliquer « {v.title} » à de nouvelles dates. Les idées, la note et les tâches sont copiées ; les tâches sont décalées d'autant et décochées.</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1"><Label className="text-xs">Du</Label>
                    <Input type="date" value={dup.start} onChange={(e) => setDup({ start: e.target.value, end: e.target.value > dup.end ? e.target.value : dup.end })} className="rounded-none h-9" /></div>
                  <div className="space-y-1"><Label className="text-xs">Au (inclus)</Label>
                    <Input type="date" value={dup.end} min={dup.start} onChange={(e) => setDup({ ...dup, end: e.target.value })} className="rounded-none h-9" /></div>
                </div>
                <div className="flex gap-2 justify-end">
                  <Button variant="outline" size="sm" className="rounded-none" onClick={() => setDup(null)} disabled={busy}>Annuler</Button>
                  <Button size="sm" className="rounded-none" onClick={duplicate} disabled={busy || !dup.start || !dup.end}>Créer la copie</Button>
                </div>
              </section>
            )}
          </>
        )}

        {msg && <p className="border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900" role="status">{msg}</p>}
        {err && <p className="border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">{err}</p>}
        <div className="flex flex-wrap items-center gap-2">
          {v?.id && <Button variant="ghost" size="sm" className="text-red-700" onClick={remove} disabled={busy}><Trash2 className="w-4 h-4 mr-1" /> Supprimer</Button>}
          {v?.id && !dup && (
            <Button variant="ghost" size="sm" onClick={() => setDup({ start: shiftYear(v.start, 1), end: shiftYear(v.end, 1) })} disabled={busy}>
              <Copy className="w-4 h-4 mr-1" /> Dupliquer
            </Button>
          )}
          <span className="flex-1" />
          <Button variant="outline" className="rounded-none" onClick={onClose} disabled={busy}>Fermer</Button>
          {v && <Button className="rounded-none" onClick={save} disabled={busy || !v.title.trim() || !v.start || !v.end}>{busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Enregistrer</Button>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
