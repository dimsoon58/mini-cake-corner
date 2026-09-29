import { useRef, useState } from "react";
import { AlertTriangle, ImagePlus, Loader2, Plus, Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/context/LanguageContext";
import { cn } from "@/lib/utils";
import {
  COLOURS,
  type DateGroup,
  type EditorItem,
  emptyItem,
  friendlyMessage,
  labelCandle,
  labelDesign,
  labelExtra,
  labelPiping,
  labelShape,
  labelSize,
  type ManualOrderCatalog,
  PRODUCT_OPTIONS,
  type ProductId,
  type QuoteResult,
} from "@/lib/manualOrders";

// One product of an Admin manual order. Only the fields that apply to the
// chosen product are shown; every option list comes from the server's
// pricing engine (catalog), so nothing can be chosen that the engine would
// refuse.

const field = "w-full border border-input bg-background px-2 py-1.5 text-sm rounded-none";
const label = "block text-xs font-medium text-foreground mb-1";

type Props = {
  index: number;
  item: EditorItem;
  catalog: ManualOrderCatalog;
  dateGroups: DateGroup[];
  quote: QuoteResult["items"][number] | undefined;
  onChange: (next: EditorItem) => void;
  onRemove: () => void;
};

export const ItemEditor = ({ index, item, catalog, dateGroups, quote, onChange, onRemove }: Props) => {
  const { t, lang } = useLang();
  const l = lang === "en" ? "en" : "fr";
  const set = (patch: Partial<EditorItem>) => onChange({ ...item, ...patch });
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const changeProduct = (product: ProductId) => {
    const fresh = emptyItem(product);
    onChange({ ...fresh, key: item.key, dateKey: product === "workshop" ? null : item.dateKey, item_comment: item.item_comment, internal_notes: item.internal_notes, reference_images: item.reference_images });
  };

  const isCake = item.product === "bento_cake" || item.product === "rectangle_cake";
  const size = item.size ?? "";
  const shapes = isCake ? catalog.cake.shapes[size] ?? [] : item.product === "diy_kit" ? catalog.kit.shapes : [];
  const flavours = isCake ? catalog.cake.flavours[size] ?? [] : item.product === "diy_kit" ? catalog.kit.flavours : catalog.dotCakes.flavours;
  const designs = isCake ? [...(catalog.cake.designs[size] ?? []), ...(catalog.cake.inspirationDesigns[size] ?? [])] : [];
  const extras = isCake ? catalog.cake.extras[size] ?? [] : [];
  const pack = item.product === "dot_cakes" ? catalog.dotCakes.packs.find((p) => p.id === item.size) : undefined;
  const session = item.product === "workshop" ? catalog.workshops.find((s) => s.id === item.workshop_session_id) : undefined;

  // When the size changes, drop choices the engine doesn't offer for it.
  const changeCakeSize = (s: string) => {
    const okShapes = catalog.cake.shapes[s] ?? [];
    const okFlavours = (catalog.cake.flavours[s] ?? []).map((f) => f.id);
    const okDesigns = [...(catalog.cake.designs[s] ?? []), ...(catalog.cake.inspirationDesigns[s] ?? [])];
    const okExtras = catalog.cake.extras[s] ?? [];
    set({
      size: s,
      shape: item.shape && okShapes.includes(item.shape) ? item.shape : okShapes[0] ?? null,
      flavors: item.flavors.filter((f) => okFlavours.includes(f)),
      design: item.design && okDesigns.includes(item.design) ? item.design : okDesigns[0] ?? null,
      extras: item.extras.filter((e) => okExtras.includes(e)),
    });
  };

  const setParticipants = (n: number) => {
    const count = Math.max(1, Math.min(n || 1, session?.maxCapacity ?? 20));
    const choices = Array.from({ length: count }, (_, i) => item.workshop_sponge_choices[i] ?? "vanilla");
    set({ workshop_participants: count, workshop_sponge_choices: choices });
  };

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    const urls: string[] = [];
    for (const file of Array.from(files).slice(0, 5)) {
      const { data, error } = await supabase.functions.invoke("manage-manual-order", { body: { action: "upload_url", fileName: file.name } });
      if (error || data?.error) { setUploadError(t("An image could not be uploaded.", "Une image n'a pas pu être envoyée.")); continue; }
      const { error: upErr } = await supabase.storage.from("order-images").uploadToSignedUrl(data.path, data.token, file, { contentType: file.type });
      if (upErr) { setUploadError(t("An image could not be uploaded.", "Une image n'a pas pu être envoyée.")); continue; }
      urls.push(data.publicUrl);
    }
    set({ reference_images: [...item.reference_images, ...urls] });
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  // Plain render helpers (not components), so typing never remounts inputs.
  const renderCandles = () => (
    <div className="space-y-2">
      {item.candles.map((c, ci) => {
        const isNumber = c.id === catalog.candles.numberCandleId;
        return (
          <div key={ci} className="flex flex-wrap items-center gap-2">
            <select
              value={c.id}
              onChange={(e) => {
                const id = e.target.value;
                const next = [...item.candles];
                next[ci] = id === catalog.candles.numberCandleId ? { id, quantity: 1, hasPack: false, digits: ["0"] } : { id, quantity: 1, hasPack: false };
                set({ candles: next });
              }}
              className={cn(field, "w-auto")}
            >
              <option value={catalog.candles.numberCandleId}>{labelCandle(catalog.candles.numberCandleId, l)}</option>
              {catalog.candles.catalogue.map((cc) => <option key={cc.id} value={cc.id}>{labelCandle(cc.id, l)}</option>)}
            </select>
            {isNumber ? (
              <input
                value={(c.digits ?? []).join("")}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, "").slice(0, 4).split("");
                  const next = [...item.candles];
                  next[ci] = { ...c, digits, quantity: Math.max(digits.length, 1) };
                  set({ candles: next });
                }}
                placeholder={t("Digits, e.g. 30", "Chiffres, ex. 30")}
                className={cn(field, "w-28")}
              />
            ) : (
              <input
                type="number"
                min={1}
                value={c.quantity}
                onChange={(e) => {
                  const next = [...item.candles];
                  next[ci] = { ...c, quantity: Math.max(1, Number(e.target.value) || 1) };
                  set({ candles: next });
                }}
                className={cn(field, "w-20")}
                aria-label={t("Quantity", "Quantité")}
              />
            )}
            <button type="button" onClick={() => set({ candles: item.candles.filter((_, j) => j !== ci) })} className="text-muted-foreground hover:text-destructive" aria-label={t("Remove", "Retirer")}>
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => set({ candles: [...item.candles, { id: catalog.candles.catalogue[0]?.id ?? catalog.candles.numberCandleId, quantity: 1, hasPack: false }] })}
        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
      >
        <Plus className="w-3 h-3" /> {t("Add a candle", "Ajouter une bougie")}
      </button>
    </div>
  );

  const renderColourSelect = (id: string, value: string, onPick: (v: string) => void) => (
    <select id={id} value={value} onChange={(e) => onPick(e.target.value)} className={field}>
      <option value="">{t("—", "—")}</option>
      {COLOURS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );

  return (
    <div className="border border-border/60 bg-background">
      <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-border/60 bg-secondary/30">
        <span className="text-xs font-semibold uppercase tracking-[0.1em]">{t("Product", "Produit")} {index + 1}</span>
        <span className="flex items-center gap-3 text-sm">
          {quote?.error ? (
            <span className="inline-flex items-center gap-1 text-xs text-amber-800"><AlertTriangle className="w-3.5 h-3.5" />{friendlyMessage(quote.error, l)}</span>
          ) : quote?.total != null ? (
            <span className="font-semibold">CHF {quote.total.toFixed(2)}</span>
          ) : null}
          <button type="button" onClick={onRemove} className="text-muted-foreground hover:text-destructive" aria-label={t("Remove this product", "Retirer ce produit")}>
            <Trash2 className="w-4 h-4" />
          </button>
        </span>
      </div>

      <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="md:col-span-2">
          <label className={label}>{t("Product type", "Type de produit")}</label>
          <select value={item.product} onChange={(e) => changeProduct(e.target.value as ProductId)} className={field}>
            {PRODUCT_OPTIONS.map((p) => <option key={p.id} value={p.id}>{t(p.en, p.fr)}</option>)}
          </select>
        </div>

        {/* Cakes */}
        {item.product === "bento_cake" && (
          <div>
            <label className={label}>{t("Size", "Taille")}</label>
            <select value={size} onChange={(e) => changeCakeSize(e.target.value)} className={field}>
              {catalog.cake.sizes.filter((s) => s.id !== "rectangle").map((s) => <option key={s.id} value={s.id}>{labelSize(s.id, l)}</option>)}
            </select>
          </div>
        )}
        {(isCake || item.product === "diy_kit") && shapes.length > 0 && (
          <div>
            <label className={label}>{t("Shape", "Forme")}</label>
            <select value={item.shape ?? ""} onChange={(e) => set({ shape: e.target.value })} className={field}>
              {shapes.map((s) => <option key={s} value={s}>{labelShape(s, l)}</option>)}
            </select>
          </div>
        )}
        {(isCake || item.product === "diy_kit") && (
          <div>
            <label className={label}>{t("Flavour", "Parfum")}</label>
            <select value={item.flavors[0] ?? ""} onChange={(e) => set({ flavors: e.target.value ? [e.target.value] : [] })} className={field}>
              <option value="">{t("Choose…", "Choisir…")}</option>
              {flavours.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
        )}
        {isCake && (
          <div>
            <label className={label}>{t("Design", "Design")}</label>
            <select value={item.design ?? ""} onChange={(e) => set({ design: e.target.value })} className={field}>
              {designs.map((d) => <option key={d} value={d}>{labelDesign(d)}</option>)}
            </select>
          </div>
        )}
        {item.product === "diy_kit" && (
          <div>
            <label className={label}>{t("Piping bags", "Poches à douille")}</label>
            <select value={item.extras[0] ?? catalog.kit.piping[0]} onChange={(e) => set({ extras: [e.target.value] })} className={field}>
              {catalog.kit.piping.map((p) => <option key={p} value={p}>{labelPiping(p, l)}</option>)}
            </select>
          </div>
        )}
        {isCake && extras.length > 0 && (
          <div className="md:col-span-2">
            <label className={label}>{t("Extras", "Extras")}</label>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {extras.map((e) => (
                <label key={e} className="inline-flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={item.extras.includes(e)}
                    onChange={(ev) => set({ extras: ev.target.checked ? [...item.extras, e] : item.extras.filter((x) => x !== e) })}
                  />
                  {labelExtra(e)}
                </label>
              ))}
            </div>
          </div>
        )}
        {isCake && (
          <>
            <div>
              <label className={label} htmlFor={`${item.key}-base`}>{t("Base colour", "Couleur de base")}</label>
              {renderColourSelect(`${item.key}-base`, item.base_color, (v) => set({ base_color: v }))}
            </div>
            <div>
              <label className={label} htmlFor={`${item.key}-deco`}>{t("Decoration colour", "Couleur de décoration")}</label>
              {renderColourSelect(`${item.key}-deco`, item.decoration_color, (v) => set({ decoration_color: v }))}
            </div>
            <div>
              <label className={label}>{t("Text on the cake", "Texte sur le gâteau")}</label>
              <input value={item.cake_text} onChange={(e) => set({ cake_text: e.target.value })} className={field} maxLength={60} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={label} htmlFor={`${item.key}-tc`}>{t("Text colour", "Couleur du texte")}</label>
                {renderColourSelect(`${item.key}-tc`, item.text_color, (v) => set({ text_color: v }))}
              </div>
              <div>
                <label className={label}>{t("Text style", "Style du texte")}</label>
                <select value={item.text_style} onChange={(e) => set({ text_style: e.target.value })} className={field}>
                  <option value="normal">{t("Normal", "Normal")}</option>
                  <option value="uppercase">{t("Capitals", "Majuscules")}</option>
                  <option value="cursive">{t("Cursive", "Cursive")}</option>
                </select>
              </div>
            </div>
          </>
        )}

        {/* Dot Cakes */}
        {item.product === "dot_cakes" && (
          <>
            <div>
              <label className={label}>{t("Pack", "Pack")}</label>
              <select
                value={item.size ?? ""}
                onChange={(e) => {
                  const p = catalog.dotCakes.packs.find((x) => x.id === e.target.value);
                  set({ size: e.target.value, flavors: item.flavors.slice(0, p?.flavours ?? 0) });
                }}
                className={field}
              >
                <option value="">{t("Choose…", "Choisir…")}</option>
                {catalog.dotCakes.packs.map((p) => <option key={p.id} value={p.id}>{labelSize(p.id, l)} — {p.flavours} {t("flavours", "parfums")}</option>)}
              </select>
            </div>
            {pack && (
              <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {Array.from({ length: pack.flavours }, (_, fi) => (
                  <select
                    key={fi}
                    value={item.flavors[fi] ?? ""}
                    onChange={(e) => {
                      const next = Array.from({ length: pack.flavours }, (_, j) => item.flavors[j] ?? "");
                      next[fi] = e.target.value;
                      set({ flavors: next.filter(Boolean) });
                    }}
                    className={field}
                    aria-label={`${t("Flavour", "Parfum")} ${fi + 1}`}
                  >
                    <option value="">{t("Flavour", "Parfum")} {fi + 1}…</option>
                    {flavours.map((f) => <option key={f.id} value={f.id} disabled={item.flavors.includes(f.id) && item.flavors[fi] !== f.id}>{f.name}</option>)}
                  </select>
                ))}
              </div>
            )}
          </>
        )}

        {/* Workshop */}
        {item.product === "workshop" && (
          <>
            <div className="md:col-span-2">
              <label className={label}>{t("Session", "Session")}</label>
              <select value={item.workshop_session_id ?? ""} onChange={(e) => set({ workshop_session_id: e.target.value || null })} className={field}>
                <option value="">{t("Choose…", "Choisir…")}</option>
                {catalog.workshops.map((s) => (
                  <option key={s.id} value={s.id} disabled={!s.isOpen}>
                    {s.date} {s.time ?? ""} — {s.type === "paint" ? t("Paint", "Peinture") : "Signature"} — CHF {s.unitPrice} — {s.remainingSeats} {t("seats left", "places restantes")}{!s.isOpen ? ` (${t("closed", "fermée")})` : ""}
                  </option>
                ))}
              </select>
              {quote?.workshop?.nearlyFull && (
                <p className="mt-1 text-xs text-amber-800 inline-flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {t("Session almost full — seats are only reserved when the order is marked as paid.", "Session presque complète — les places ne sont réservées qu'au moment de « Marquer comme payée ».")}
                </p>
              )}
            </div>
            <div>
              <label className={label}>{t("Seats", "Places")}</label>
              <input type="number" min={1} value={item.workshop_participants ?? 1} onChange={(e) => setParticipants(Number(e.target.value))} className={field} />
            </div>
            <div className="md:col-span-2">
              <label className={label}>{t("Sponge per participant", "Génoise par participant")}</label>
              <div className="flex flex-wrap gap-2">
                {item.workshop_sponge_choices.map((c, ci) => (
                  <select
                    key={ci}
                    value={c}
                    onChange={(e) => {
                      const next = [...item.workshop_sponge_choices];
                      next[ci] = e.target.value;
                      set({ workshop_sponge_choices: next });
                    }}
                    className={cn(field, "w-auto")}
                    aria-label={`${t("Participant", "Participant")} ${ci + 1}`}
                  >
                    <option value="vanilla">{ci + 1}. {t("Vanilla", "Vanille")}</option>
                    <option value="chocolate">{ci + 1}. {t("Chocolate", "Chocolat")}</option>
                  </select>
                ))}
              </div>
            </div>
            <div className="md:col-span-2 flex flex-wrap gap-4 text-sm">
              <label className="inline-flex items-center gap-1.5">
                <input type="checkbox" checked={item.workshop_has_minor} onChange={(e) => set({ workshop_has_minor: e.target.checked, workshop_minor_consent_confirmed: e.target.checked && item.workshop_minor_consent_confirmed })} />
                {t("A participant is a minor", "Un participant est mineur")}
              </label>
              {item.workshop_has_minor && (
                <label className="inline-flex items-center gap-1.5">
                  <input type="checkbox" checked={item.workshop_minor_consent_confirmed} onChange={(e) => set({ workshop_minor_consent_confirmed: e.target.checked })} />
                  {t("Legal representative's consent confirmed", "Accord du représentant légal confirmé")}
                </label>
              )}
            </div>
          </>
        )}

        {/* Standalone candle */}
        {item.product === "candles" && (
          <div className="md:col-span-2">
            <label className={label}>{t("Candle", "Bougie")}</label>
            {item.candles.length === 0 ? (
              <button type="button" onClick={() => set({ candles: [{ id: catalog.candles.catalogue[0]?.id ?? catalog.candles.numberCandleId, quantity: 1, hasPack: false }] })} className="text-xs text-primary hover:underline">
                + {t("Choose the candle", "Choisir la bougie")}
              </button>
            ) : renderCandles()}
          </div>
        )}

        {/* Candles on a cake / kit / Dot Cakes */}
        {(isCake || item.product === "diy_kit" || item.product === "dot_cakes") && (
          <div className="md:col-span-2">
            <label className={label}>{t("Candles", "Bougies")}</label>
            {renderCandles()}
          </div>
        )}

        {/* Date group */}
        {item.product !== "workshop" && (
          <div className="md:col-span-2">
            <label className={label}>{t("Date", "Date")}</label>
            <select value={item.dateKey ?? ""} onChange={(e) => set({ dateKey: e.target.value || null })} className={field}>
              <option value="">{t("Choose a date group…", "Choisir une date…")}</option>
              {dateGroups.map((g, gi) => (
                <option key={g.key} value={g.key}>
                  {t("Date", "Date")} {gi + 1} — {g.date ? g.date.split("-").reverse().join(".") : "?"} · {g.deliveryMethod === "delivery" ? t("delivery", "livraison") : t("pickup", "retrait")}{g.slot ? ` · ${g.slot}` : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Notes + images */}
        <div>
          <label className={label}>{t("Note visible to the customer", "Note visible par le client")}</label>
          <textarea value={item.item_comment} onChange={(e) => set({ item_comment: e.target.value })} rows={2} className={field} />
        </div>
        <div>
          <label className={cn(label, "text-primary")}>{t("Internal note (never shown to the customer)", "Note interne (jamais montrée au client)")}</label>
          <textarea value={item.internal_notes} onChange={(e) => set({ internal_notes: e.target.value })} rows={2} className={cn(field, "border-primary/40")} />
        </div>
        <div className="md:col-span-2">
          <label className={label}>{t("Reference images", "Images de référence")}</label>
          <div className="flex flex-wrap gap-2 items-center">
            {item.reference_images.map((url, ii) => (
              <div key={url} className="relative w-16 h-16 border border-border overflow-hidden">
                <img src={url} alt="" className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => set({ reference_images: item.reference_images.filter((_, j) => j !== ii) })}
                  className="absolute top-0 right-0 bg-background/90 p-0.5"
                  aria-label={t("Remove image", "Retirer l'image")}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
            <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="w-16 h-16 border border-dashed border-border flex items-center justify-center text-muted-foreground hover:border-primary/50">
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-5 h-5" />}
            </button>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
          </div>
          {uploadError && <p className="text-xs text-destructive mt-1">{uploadError}</p>}
        </div>
      </div>
    </div>
  );
};
