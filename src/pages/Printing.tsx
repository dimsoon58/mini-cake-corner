import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { isOrderDateDisabled, expressCalendarNotice } from "@/lib/orderDates";
import { expressCalendarProps, ExpressDateNotice } from "@/components/ExpressDateNotice";
import { CalendarIcon, Upload, X, ChevronLeft, ChevronRight } from "lucide-react";
import printingGallery1 from "@/assets/printing-gallery-1.jpg";
import printingGallery2 from "@/assets/printing-gallery-2.jpg";
import printingGallery3 from "@/assets/printing-gallery-3.jpg";
import printingGallery4 from "@/assets/printing-gallery-4.jpg";
import printingGallery5 from "@/assets/printing-gallery-5.jpg";
import printingGallery6 from "@/assets/printing-gallery-6.jpg";

const printingGallery = [
  printingGallery1, printingGallery2, printingGallery3,
  printingGallery4, printingGallery5, printingGallery6,
];
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
  const [calOpen, setCalOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [comment, setComment] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);


  useEffect(() => {
    document.title = t("Printing – Bento Cake Studio", "Impression – Bento Cake Studio");
    return () => {
      document.title = "Bento Cake Studio Geneva";
    };
  }, [t]);

  const handleAddToCart = () => {
    if (!orderDate) {
      toast.error(t("Please choose your pick-up date (minimum 2 days' notice).", "Veuillez choisir votre date de retrait (minimum 2 jours à l'avance)."));
      return;
    }
    if (files.length === 0) {
      toast.error(t("Please upload the image you would like printed.", "Veuillez importer l'image que vous souhaitez faire imprimer."));
      return;
    }

    const added = addItem({
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

    if (!added.ok) {
      toast.error(t("This item's date doesn't match the rest of your cart. Please place a separate order.", "La date de cet article ne correspond pas au reste de votre panier. Merci de passer une commande séparée."));
      return;
    }

    toast.success(t("Edible printing added to your cart!", "Impression alimentaire ajoutée à votre panier !"), {
      action: { label: t("View cart", "Voir le panier"), onClick: () => navigate("/cart") },
    });
    setFiles([]);
    setComment("");
    setOrderDate(undefined);
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12 max-w-3xl">
        {/* Same title style as the other product pages. md:-mx-16 lets it use a
            little more than this page's narrow (max-w-3xl) column on desktop,
            so "IMPRESSION COMESTIBLE" fits on one line like the English title. */}
        <h1 className="font-sans text-4xl md:text-5xl text-center tracking-[0.105em] uppercase text-foreground mb-6 font-semibold md:-mx-16">
          {t("Edible Printing", "Impression Comestible")}
        </h1>
        {/* Intro — makes clear up front that the print can be ordered on its
            own (no cake), and points cake customers to the cake options. */}
        <div className="text-center max-w-2xl mx-auto space-y-4 mb-10">
          <p className="text-foreground font-medium">
            {t(
              "Have your photo, logo or drawing printed on an edible sugar sheet.",
              "Votre photo, logo ou dessin imprimé sur une feuille de sucre comestible."
            )}
          </p>
          <p className="text-muted-foreground">
            {t("You can order ", "Commandez ")}
            <strong className="font-semibold text-foreground">{t("the print on its own, without a cake", "l'impression seule")}</strong>
            {t(
              ": upload your image, choose your pick-up date and collect your print, ready to place on your own cake.",
              ", prête à poser sur votre propre gâteau."
            )}
          </p>
          <p className="text-sm text-muted-foreground">
            <strong className="font-semibold text-foreground">{t("Already ordering a Bento Cake Studio cake?", "Vous commandez déjà un gâteau chez nous ?")}</strong>
            <br />
            {t("Add the edible print directly in the options when ", "Ajoutez l'impression dans les options de ")}
            <Link to="/catalog" className="text-primary underline underline-offset-4 hover:text-primary/80">
              {t("ordering your cake", "votre gâteau")}
            </Link>
            .
          </p>
        </div>

        {/* "Print only" block — discreet, bordered like the rest of the site */}
        <div className="border border-foreground/20 px-6 py-5 mb-10 text-center space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            {t("Print only", "Impression seule")}
          </h2>
          <p className="text-sm font-semibold text-foreground">
            {t("No need to order a cake from us.", "Pas besoin de commander un gâteau chez nous.")}
          </p>
          <p className="text-sm text-muted-foreground">
            {t(
              "Send us your image, we print it on an edible sheet, then you come and collect it.",
              "Envoyez-nous votre image, nous l'imprimons, vous venez la chercher."
            )}
          </p>
          <p className="text-sm font-semibold text-foreground">
            {t(
              "This order includes the edible print only. The cake is not included.",
              "Seule l'impression est incluse, pas le gâteau."
            )}
          </p>
        </div>

        {/* How it works — in a row on desktop, stacked on mobile */}
        <div className="mb-12">
          <h2 className="text-center text-sm font-semibold uppercase tracking-[0.14em] text-foreground mb-6">
            {t("How does it work?", "Comment ça marche ?")}
          </h2>
          <ol className="grid grid-cols-1 md:grid-cols-4 gap-5 md:gap-6">
            {[
              t("Upload your image.", "Envoyez votre image"),
              t("Choose your pick-up date.", "Choisissez la date"),
              t("We print it on an edible sugar sheet.", "Nous l'imprimons"),
              t("Collect it and place it on your own cake.", "Récupérez-la"),
            ].map((step, i) => (
              <li key={i} className="flex md:flex-col items-center md:text-center gap-3 md:gap-2">
                <span className="shrink-0 w-7 h-7 flex items-center justify-center border border-primary text-primary text-xs font-semibold">
                  {i + 1}
                </span>
                <span className="text-sm text-muted-foreground leading-snug">{step}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="space-y-8">
          {/* Date */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              {t("Pick-up Date", "Date de retrait")} <span className="text-destructive">*</span>
            </label>
            <Popover open={calOpen} onOpenChange={setCalOpen}>
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
                  {orderDate ? format(orderDate, "dd.MM.yyyy") : t("Select a date", "Choisir une date")}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={orderDate}
                  onSelect={(d) => { setOrderDate(d); setCalOpen(false); }}
                  disabled={(date) => isOrderDateDisabled(date)}
                  initialFocus
                  className="p-3 pointer-events-auto"
                  {...expressCalendarProps}
                />
              </PopoverContent>
            </Popover>
            <p className="text-xs text-muted-foreground">{t("Minimum 2 days' notice.", "Minimum 2 jours à l'avance.")}</p>
            <ExpressDateNotice date={orderDate} />
          </div>

          {/* Upload */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              {t("Your image to print", "Votre image à imprimer")} <span className="text-destructive">*</span>
            </label>
            <p className="text-xs text-muted-foreground">
              {t(
                "Upload the photo, logo or drawing you would like printed on an edible sheet (JPG, PNG, WEBP).",
                "La photo, le logo ou le dessin à imprimer (JPG, PNG, WEBP)."
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
            <label className="text-sm font-medium text-foreground">{t("Special instructions (optional)", "Instructions particulières (optionnel)")}</label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              placeholder={t("Desired size, cropping, placement, colours or any other detail about your print…", "Taille souhaitée, recadrage, emplacement, couleurs ou autre précision concernant votre impression…")}
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
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground py-2.5 text-[14px] font-medium uppercase tracking-[0.105em] rounded-none"
          >
            {t("Add to Cart", "Ajouter au panier")}
          </Button>
        </div>
      </div>

      {/* ── PRINTED MOMENTS gallery ── */}
      <section className="pb-20 pt-10">
        <h2 className="font-sans text-2xl md:text-3xl text-center uppercase tracking-[0.105em] text-foreground mb-10">
          {t("PRINTED MOMENTS", "PRINTED MOMENTS")}
        </h2>
        <div className="relative">
          <button
            onClick={() => {
              const el = document.getElementById("printing-gallery-scroll");
              el?.scrollBy({ left: -288, behavior: "smooth" });
            }}
            aria-label={t("Previous", "Précédent")}
            className="absolute left-2 top-1/2 -translate-y-1/2 z-10 bg-background/90 hover:bg-background rounded-none p-2 shadow-md"
          >
            <ChevronLeft className="h-5 w-5 text-foreground" />
          </button>
          <div
            id="printing-gallery-scroll"
            className="flex gap-4 overflow-x-auto scroll-smooth px-4 sm:px-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {printingGallery.map((photo, index) => (
              <div key={index} className="flex-shrink-0 w-80 h-52 overflow-hidden">
                <img
                  src={photo}
                  alt={`Printed cake ${index + 1}`}
                  loading="lazy"
                  className="w-full h-full object-cover"
                />
              </div>
            ))}
          </div>
          <button
            onClick={() => {
              const el = document.getElementById("printing-gallery-scroll");
              el?.scrollBy({ left: 288, behavior: "smooth" });
            }}
            aria-label={t("Next", "Suivant")}
            className="absolute right-2 top-1/2 -translate-y-1/2 z-10 bg-background/90 hover:bg-background rounded-none p-2 shadow-md"
          >
            <ChevronRight className="h-5 w-5 text-foreground" />
          </button>
        </div>
      </section>
    </Layout>
  );
};

export default Printing;
