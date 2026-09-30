import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useLang } from "@/context/LanguageContext";

// The photos a customer uploaded with an item (order_items.reference_images),
// shown as thumbnails under that item — in addition to the design photo
// (design_image_url), never instead of it. Used by Mes commandes and the
// Admin order page. Clicking a thumbnail opens the photo full size.
export const ReferencePhotos = ({ urls }: { urls: string[] | null | undefined }) => {
  const { t } = useLang();
  const [open, setOpen] = useState<string | null>(null);
  const photos = (urls ?? []).filter((u): u is string => typeof u === "string" && u.length > 0);
  if (photos.length === 0) return null;

  const title = t("Customer reference photos", "Photos de référence du client");
  return (
    <div className="mt-2">
      <p className="text-xs font-semibold text-foreground/80 mb-1.5">
        {title} ({photos.length})
      </p>
      <div className="flex flex-wrap gap-2">
        {photos.map((url, i) => (
          <button
            key={url}
            type="button"
            onClick={() => setOpen(url)}
            className="w-16 h-16 border border-border/60 bg-secondary/40 overflow-hidden hover:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            aria-label={`${title} ${i + 1}`}
          >
            <img src={url} alt="" loading="lazy" className="w-full h-full object-cover" />
          </button>
        ))}
      </div>

      <Dialog open={open !== null} onOpenChange={(o) => { if (!o) setOpen(null); }}>
        <DialogContent className="max-w-3xl p-3 sm:p-4">
          <DialogTitle className="text-sm font-semibold pr-8">{title}</DialogTitle>
          {open && (
            <>
              <img src={open} alt="" className="w-full max-h-[75vh] object-contain bg-secondary/20" />
              <a
                href={open}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <ExternalLink className="w-3.5 h-3.5" /> {t("Open the original", "Ouvrir l'original")}
              </a>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
