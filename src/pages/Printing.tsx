import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format, addDays } from "date-fns";
import { CalendarIcon, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import Layout from "@/components/Layout";
import { useCart } from "@/context/CartContext";
import { useLang } from "@/context/LanguageContext";

/* ─── Adjust the price of an edible print here (CHF) ─── */
const PRINTING_PRICE = 15;

const Printing = () => {
  const navigate = useNavigate();
  const { addItem } = useCart();
  const { t } = useLang();
  const [orderDate, setOrderDate] = useState<Date | undefined>(undefined);
  const [files, setFiles] = useState<File[]>([]);
  const [comment, setComment] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const minDate = addDays(new Date(), 4);

  useEffect(() => {
    document.title = t("Printing – Bento Cake Studio", "Impression – Bento Cake Studio");
    return () => {
      document.title = "Bento Cake Studio Geneva";
    };
  }, [t]);

  const handleAddToCart = () => {
    if (!orderDate) {
      toast.error(t("Please choose your pick-up date (minimum 4 days' notice).", "Veuillez choisir votre date de retrait (minimum 4 jours à l'avance)."));
      return;
    }
    if (files.length === 0) {
      toast.error(t("Please upload the image you would like printed.", "Veuillez importer l'image que vous souhaitez faire imprimer."));
      return;
    }

    addItem({
      id: "",
      product: "edible_printing",
      orderDate: format(orderDate, "yyyy-MM-dd"),
      orderTime: "",
      size: "printing",
      sizeName: "Edible Printing",
      shape: "",
      shapeName: "",
      flavor: "",
      flavorName: "",
      style: "printing",
      styleName: "Edible Printing",
      baseColor: "",
      baseColorName: "",
      decorationColor: "",
      decorationColorName: "",
      cakeText: "",
      textColor: "",
      textColorName: "",
      textStyle: "normal",
      extras: [],
      extrasNames: [],
      ribbonColor: "",
      ribbonColorName: "",
      butterflyColor: "",
      butterflyColorName: "",
      candles: [],
      comment: comment.trim(),
      imageUrls: [],
      imageFiles: files,
      total: PRINTING_PRICE,
    });

    toast.success(t("Edible printing added to your cart!", "Impression alimentaire ajoutée à votre panier !"), {
      action: { label: t("View cart", "Voir le panier"), onClick: () => navigate("/cart") },
    });
    setFiles([]);
    setComment("");
    setOrderDate(undefined);
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-16 max-w-3xl">
        <h1 className="font-sans text-4xl md:text-5xl text-center tracking-[0.105em] uppercase text-foreground mb-6">
          {t("Printing", "Impression")}
        </h1>
        <p className="text-center text-muted-foreground mb-4 max-w-2xl mx-auto">
          {t(
            "Turn your favourite photo, logo or drawing into an edible image, printed with food-safe ink on a fine sugar sheet, ready to top your cake.",
            "Transformez votre photo, logo ou dessin préféré en une image comestible, imprimée à l'encre alimentaire sur une fine feuille de sucre."
          )}
        </p>
        <p className="text-center text-muted-foreground mb-12 max-w-2xl mx-auto text-sm">
          {t(
            "Perfect for birthdays, brand events and celebrations. Upload your image, choose your date, and we take care of the rest.",
            "Idéale pour les anniversaires, les événements de marque et les célébrations. Importez votre image, choisissez votre date, et nous nous occupons du reste."
          )}
        </p>

        <div className="space-y-8">
          {/* Date */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              {t("Pick-up Date", "Date de retrait")} <span className="text-destructive">*</span>
            </label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal rounded-none",
                    !orderDate && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {orderDate ? format(orderDate, "dd.MM.yyyy") : t("Select a date", "Sélectionnez une date")}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={orderDate}
                  onSelect={setOrderDate}
                  disabled={(date) => date < minDate}
                  initialFocus
                  className="p-3 pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
            <p className="text-xs text-muted-foreground">{t("Minimum 4 days' notice.", "Minimum 4 jours à l'avance.")}</p>
          </div>

          {/* Upload */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              {t("Upload your image", "Importer votre image")} <span className="text-destructive">*</span>
            </label>
            <p className="text-xs text-muted-foreground">
              {t(
                "The photo, logo or drawing you would like printed (JPG, PNG, WEBP).",
                "La photo, le logo ou le dessin que vous souhaitez faire imprimer (JPG, PNG, WEBP)."
              )}
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              onChange={(e) => {
                const picked = Array.from(e.target.files || []);
                setFiles((prev) => [...prev, ...picked].slice(0, 5));
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full border-2 border-dashed border-border p-6 flex flex-col items-center gap-2 hover:border-primary/50 transition-colors"
            >
              <Upload className="w-6 h-6 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">{t("Click to upload your image", "Cliquez pour importer votre image")}</span>
            </button>
            {files.length > 0 && (
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {files.map((file, i) => (
                  <div key={i} className="relative aspect-square border border-border bg-muted/20 overflow-hidden">
                    <img src={URL.createObjectURL(file)} alt={file.name} className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => setFiles(files.filter((_, idx) => idx !== i))}
                      className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-none p-0.5 hover:bg-destructive/80"
                      aria-label={t("Remove image", "Supprimer l'image")}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Comment */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">{t("Notes (optional)", "Notes (optionnel)")}</label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              placeholder={t("Anything we should know about your print (size, placement, colours)…", "Tout ce que nous devrions savoir sur votre impression (taille, emplacement, couleurs)…")}
              className="w-full border border-input bg-background px-3 py-2 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Total + add */}
          <div className="flex items-center justify-between border-t border-border pt-5">
            <span className="text-sm uppercase tracking-[0.105em] text-foreground">{t("Total", "Total")}</span>
            <span className="text-xl font-bold text-primary">CHF {PRINTING_PRICE}</span>
          </div>
          <Button
            onClick={handleAddToCart}
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground py-6 text-[14px] font-medium uppercase tracking-[0.105em] rounded-none"
          >
            {t("Add to Cart", "Ajouter au panier")}
          </Button>
        </div>
      </div>
    </Layout>
  );
};

export default Printing;
