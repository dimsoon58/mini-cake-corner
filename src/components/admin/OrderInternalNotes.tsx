import { useEffect, useRef, useState } from "react";
import { ExternalLink, ImagePlus, Loader2, MessageSquare, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/context/LanguageContext";
import { extractFunctionErrorMessage } from "@/lib/functionErrors";

// F36 (03.11.2026) — « Notes internes » on the Admin order page, for every
// order (manual and website): dated comments from the team, with optional
// photos (e.g. extra pictures a customer sent on WhatsApp). Never shown to
// the customer. Photos go to the private order-notes bucket through
// manage-order-notes and come back as signed URLs (valid 1 h).

type Note = { id: string; body: string | null; photos: string[]; authorName: string; createdAt: string; canDelete: boolean };
type Draft = { file: File; preview: string };

const MAX_PHOTOS = 10;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

const formatWhen = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} · ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function OrderInternalNotes({ orderId }: { orderId: string }) {
  const { t } = useLang();
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const call = async (body: Record<string, unknown>) => {
    const { data, error: fnError } = await supabase.functions.invoke("manage-order-notes", { body: { orderId, ...body } });
    if (fnError) throw new Error(await extractFunctionErrorMessage(fnError, t("Something went wrong. Please try again.", "Une erreur est survenue. Réessayez.")));
    if (data?.error) throw new Error(String(data.error));
    return data?.data;
  };

  useEffect(() => {
    let alive = true;
    setNotes(null);
    setLoadError(null);
    call({ action: "list" })
      .then((d) => { if (alive) setNotes(d as Note[]); })
      .catch((e) => { if (alive) setLoadError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  // Free the local previews when the page is left.
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  useEffect(() => () => draftsRef.current.forEach((d) => URL.revokeObjectURL(d.preview)), []);

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    const picked = Array.from(files).filter((f) => IMAGE_TYPES.includes(f.type));
    if (picked.length < files.length) setError(t("Photos must be JPG, PNG or WebP.", "Les photos doivent être en JPG, PNG ou WebP."));
    else setError(null);
    const room = Math.max(MAX_PHOTOS - drafts.length, 0);
    setDrafts((cur) => [...cur, ...picked.slice(0, room).map((file) => ({ file, preview: URL.createObjectURL(file) }))]);
    if (fileRef.current) fileRef.current.value = "";
  };

  const removeDraft = (i: number) => {
    URL.revokeObjectURL(drafts[i].preview);
    setDrafts((cur) => cur.filter((_, j) => j !== i));
  };

  const save = async () => {
    if (saving || (!text.trim() && drafts.length === 0)) return;
    setSaving(true);
    setError(null);
    try {
      const paths: string[] = [];
      for (const d of drafts) {
        const up = await call({ action: "upload_url", fileName: d.file.name, contentType: d.file.type }) as { path: string; token: string };
        const { error: upErr } = await supabase.storage.from("order-notes").uploadToSignedUrl(up.path, up.token, d.file, { contentType: d.file.type });
        if (upErr) throw new Error(t("A photo could not be uploaded.", "Une photo n'a pas pu être envoyée."));
        paths.push(up.path);
      }
      setNotes(await call({ action: "add", body: text, imagePaths: paths }) as Note[]);
      setText("");
      drafts.forEach((d) => URL.revokeObjectURL(d.preview));
      setDrafts([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (note: Note) => {
    if (!window.confirm(t("Delete this note?", "Supprimer cette note ?"))) return;
    setError(null);
    try {
      setNotes(await call({ action: "delete", noteId: note.id }) as Note[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="border border-primary/40 bg-background p-4" data-testid="order-internal-notes">
      <h3 className="font-sans text-[12px] tracking-[0.105em] font-semibold uppercase text-primary mb-1 flex items-center gap-2">
        <MessageSquare className="w-3.5 h-3.5" strokeWidth={1.5} />
        {t("Internal notes", "Notes internes")}
      </h3>
      <p className="text-xs text-muted-foreground mb-3">{t("Team only — never shown to the customer.", "Pour l'équipe uniquement — jamais montrées au client.")}</p>

      {loadError && <p className="text-sm text-destructive mb-3">{loadError}</p>}
      {notes === null && !loadError && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground mb-3" />}
      {notes && notes.length === 0 && <p className="text-sm text-muted-foreground mb-3">{t("No note yet.", "Aucune note pour l'instant.")}</p>}

      {notes && notes.length > 0 && (
        <ul className="space-y-3 mb-4">
          {notes.map((n) => (
            <li key={n.id} className="border-l-2 border-primary/50 bg-muted/30 px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs text-muted-foreground"><span className="font-semibold text-foreground">{n.authorName}</span> · {formatWhen(n.createdAt)}</p>
                {n.canDelete && (
                  <button type="button" onClick={() => remove(n)} className="text-muted-foreground hover:text-destructive" aria-label={t("Delete this note", "Supprimer cette note")}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              {n.body && <p className="text-sm text-foreground whitespace-pre-line mt-1">{n.body}</p>}
              {n.photos.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {n.photos.map((url, i) => (
                    <button
                      key={url}
                      type="button"
                      onClick={() => setOpen(url)}
                      className="w-16 h-16 border border-border/60 bg-secondary/40 overflow-hidden hover:border-primary"
                      aria-label={`${t("Photo", "Photo")} ${i + 1}`}
                    >
                      <img src={url} alt="" loading="lazy" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          maxLength={4000}
          placeholder={t("Add a note for the team…", "Ajouter une note pour l'équipe…")}
          className="w-full border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-primary"
        />
        {drafts.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {drafts.map((d, i) => (
              <div key={d.preview} className="relative w-16 h-16 border border-border/60 overflow-hidden">
                <img src={d.preview} alt="" className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => removeDraft(i)}
                  className="absolute top-0.5 right-0.5 bg-background/90 rounded-full p-0.5"
                  aria-label={t("Remove this photo", "Retirer cette photo")}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept={IMAGE_TYPES.join(",")} multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
          <Button type="button" variant="outline" size="sm" className="rounded-none" disabled={saving || drafts.length >= MAX_PHOTOS} onClick={() => fileRef.current?.click()}>
            <ImagePlus className="w-4 h-4 mr-1" /> {t("Add photos", "Ajouter des photos")}
          </Button>
          <Button type="button" size="sm" className="rounded-none" disabled={saving || (!text.trim() && drafts.length === 0)} onClick={save}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : t("Save the note", "Enregistrer la note")}
          </Button>
        </div>
      </div>

      <Dialog open={open !== null} onOpenChange={(o) => { if (!o) setOpen(null); }}>
        <DialogContent className="max-w-3xl p-3 sm:p-4">
          <DialogTitle className="text-sm font-semibold pr-8">{t("Internal note photo", "Photo de la note interne")}</DialogTitle>
          {open && (
            <>
              <img src={open} alt="" className="w-full max-h-[75vh] object-contain bg-secondary/20" />
              <a href={open} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                <ExternalLink className="w-3.5 h-3.5" /> {t("Open the original", "Ouvrir l'original")}
              </a>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
