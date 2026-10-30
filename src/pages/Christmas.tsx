import { useEffect, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { format } from "date-fns";
import { CalendarIcon, Check, ChevronLeft, ChevronRight, ImageIcon } from "lucide-react";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { OrderCalendar, ExpressDateNotice } from "@/components/ExpressDateNotice";
import { isOrderDateDisabled, expressSurcharge, expressSurchargeRate } from "@/lib/orderDates";
import { useLang } from "@/context/LanguageContext";
import { useSeo } from "@/hooks/useSeo";
import { useChristmasVisible } from "@/hooks/useChristmasVisible";
import { cn } from "@/lib/utils";
import {
  CHRISTMAS_CAKES, CHRISTMAS_LOGS, CHRISTMAS_LOG_PRICE, CAKE_FLAVOURS, LOG_FLAVOURS, SPONGES, LOG_INTRO, CLASSIC_FILLING,
  CHRISTMAS_SIZE_LABELS, CHRISTMAS_SIZE_ORDER, fromPrice, cakePhotos, CHRISTMAS_MOMENTS,
  type ChristmasSize, type ChristmasFlavour,
} from "@/data/christmas";

// Page « Noël / Christmas » : on choisit un design (gâteau ou bûche), la
// taille (gâteaux seulement), la génoise, la garniture et la date. Pas
// d'extras ; supplément express habituel selon la date.
// Tant que CHRISTMAS_PUBLIC est éteint, visible seulement par les admins
// connectées (useChristmasVisible) ; l'ajout au panier reste désactivé tant
// que le serveur de paiement ne connaît pas ces articles.

type Selection = { kind: "cake" | "log"; id: string };

// Cadre réservé à une photo pas encore fournie.
function PhotoSlot({ image, alt, className }: { image: string | null; alt: string; className?: string }) {
  const { t } = useLang();
  if (image) return <img src={image} alt={alt} className={cn("w-full h-full object-cover", className)} />;
  return (
    <div className={cn("w-full h-full flex flex-col items-center justify-center gap-2 bg-muted/60 border border-dashed border-foreground/20 text-muted-foreground", className)}>
      <ImageIcon className="w-7 h-7" strokeWidth={1.25} />
      <span className="text-[11px] uppercase tracking-[0.15em]">{t("Photo coming soon", "Photo à venir")}</span>
    </div>
  );
}

// Tuile de choix de taille : titre + une ligne.
function OptionTile({ title, detail, selected, onClick }: { title: string; detail?: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "border px-3 py-3 text-left transition-colors flex flex-col justify-start",
        selected ? "border-primary bg-primary/5" : "border-border hover:border-foreground/40",
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold uppercase tracking-[0.08em]">{title}</span>
        {selected && <Check className="w-4 h-4 text-primary flex-shrink-0" />}
      </span>
      {detail && <span className="block text-xs text-muted-foreground mt-1 leading-snug">{detail}</span>}
    </button>
  );
}

// Several photos: arrows to scroll them (clicking an arrow never selects
// the card). One photo or none: the plain PhotoSlot.
function PhotoCarousel({ images, alt, className }: { images: string[]; alt: string; className?: string }) {
  const { t } = useLang();
  const [index, setIndex] = useState(0);
  if (images.length <= 1) return <PhotoSlot image={images[0] ?? null} alt={alt} className={className} />;
  const go = (e: React.MouseEvent, step: number) => {
    e.stopPropagation();
    setIndex((i) => (i + step + images.length) % images.length);
  };
  const arrow = "absolute top-1/2 -translate-y-1/2 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-background/90 hover:bg-background shadow-md";
  return (
    <div className="relative w-full h-full">
      <img src={images[index]} alt={`${alt} ${index + 1}`} className={cn("w-full h-full object-cover", className)} />
      <button type="button" onClick={(e) => go(e, -1)} aria-label={t("Previous photo", "Photo précédente")} className={cn(arrow, "left-2")}>
        <ChevronLeft className="w-4 h-4 text-foreground" />
      </button>
      <button type="button" onClick={(e) => go(e, 1)} aria-label={t("Next photo", "Photo suivante")} className={cn(arrow, "right-2")}>
        <ChevronRight className="w-4 h-4 text-foreground" />
      </button>
    </div>
  );
}

function ProductCard({ name, price, images, selected, onClick }: {
  name: string; price: string; images: string[]; selected: boolean; onClick: () => void;
}) {
  return (
    // A div, not a button: the photo arrows inside are buttons themselves.
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      // Double bordeaux frame, same as the Catalog cards.
      className={cn(
        "group flex flex-col justify-start text-left bg-background border-[3px] border-primary transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
        selected ? "ring-2 ring-primary ring-offset-2" : "hover:shadow-md",
      )}
    >
      <div className="border border-primary m-1.5 flex flex-col flex-1 overflow-hidden">
        <div className="aspect-square overflow-hidden">
          <PhotoCarousel images={images} alt={name} className="transition-transform duration-500 group-hover:scale-105" />
        </div>
        <div className="px-3 py-3">
          <p className="uppercase tracking-[0.12em] text-sm font-semibold text-foreground">{name}</p>
          <p className="text-sm text-foreground/70 mt-1">{price}</p>
        </div>
      </div>
    </div>
  );
}

// Bandeau de photos en bas de page, même présentation que « Dot Cake Moments ».
function ChristmasMoments() {
  const { t } = useLang();
  const scrollRef = useRef<HTMLDivElement>(null);
  const scroll = (direction: "left" | "right") => {
    scrollRef.current?.scrollBy({ left: direction === "left" ? -320 : 320, behavior: "smooth" });
  };
  if (CHRISTMAS_MOMENTS.length === 0) return null;
  return (
    <section className="space-y-6">
      <h2 className="font-sans text-xl font-semibold text-center uppercase tracking-[0.105em] text-foreground">
        Christmas Moments
      </h2>
      <div className="relative overflow-hidden">
        <button onClick={() => scroll("left")} aria-label={t("Previous", "Précédent")}
          className="absolute left-2 top-1/2 -translate-y-1/2 z-10 bg-background/80 hover:bg-background rounded-none p-2 shadow-md">
          <ChevronLeft className="h-5 w-5 text-foreground" />
        </button>
        <div ref={scrollRef} className="flex gap-4 overflow-x-auto scroll-smooth px-3" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
          {CHRISTMAS_MOMENTS.map((photo, index) => (
            <div key={index} className="flex-shrink-0 w-64 h-64 overflow-hidden">
              <img src={photo} alt={`Christmas Moment ${index + 1}`} loading="lazy" className="w-full h-full object-cover" />
            </div>
          ))}
        </div>
        <button onClick={() => scroll("right")} aria-label={t("Next", "Suivant")}
          className="absolute right-2 top-1/2 -translate-y-1/2 z-10 bg-background/80 hover:bg-background rounded-none p-2 shadow-md">
          <ChevronRight className="h-5 w-5 text-foreground" />
        </button>
      </div>
    </section>
  );
}

const Christmas = () => {
  useSeo({
    title: "Gâteaux et bûches de Noël Genève — Bento Cake Studio",
    description: "La collection de Noël de Bento Cake Studio : bento cakes et bûches de Noël à la crème fouettée, à commander en ligne à Genève.",
    canonical: "https://bentocakestudio.ch/noel",
  });
  const { t, lang } = useLang();
  const l = lang === "fr" ? "fr" : "en";
  const { visible, preview, loading } = useChristmasVisible();

  const [selection, setSelection] = useState<Selection | null>(null);
  const [size, setSize] = useState<ChristmasSize | null>(null);
  const [sponge, setSponge] = useState<string>("");
  const [flavour, setFlavour] = useState<string>("");
  const [orderDate, setOrderDate] = useState<Date | undefined>(undefined);
  const [calOpen, setCalOpen] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  // Page cachée aux moteurs de recherche tant qu'elle n'est pas publique.
  useEffect(() => {
    if (!preview) return;
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => { meta.remove(); };
  }, [preview]);

  useEffect(() => {
    if (selection) setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
  }, [selection]);

  if (loading) return <Layout><div className="min-h-[60vh]" /></Layout>;
  if (!visible) return <Navigate to="/" replace />;

  const cake = selection?.kind === "cake" ? CHRISTMAS_CAKES.find((c) => c.id === selection.id) ?? null : null;
  const log = selection?.kind === "log" ? CHRISTMAS_LOGS.find((b) => b.id === selection.id) ?? null : null;
  const flavours: ChristmasFlavour[] = log ? LOG_FLAVOURS : CAKE_FLAVOURS;
  const availableSizes = cake ? CHRISTMAS_SIZE_ORDER.filter((s) => cake.prices[s] !== undefined) : [];
  const sponges = log ? SPONGES.filter((g) => !g.cakeOnly) : SPONGES;
  const price = log ? CHRISTMAS_LOG_PRICE : cake && size ? cake.prices[size] ?? null : null;
  // Même règle express que les autres gâteaux (J+2/J+3 : 20 %, J+4/J+5 : 15 %).
  const expressRate = expressSurchargeRate(orderDate);
  const express = price !== null ? expressSurcharge(price, orderDate) : 0;
  const total = price !== null ? price + express : null;
  const flavourName = (f: ChristmasFlavour) => (l === "fr" ? f.nameFr : f.nameEn);
  const flavourDescription = (f: ChristmasFlavour) => (l === "fr" ? f.descriptionFr : f.descriptionEn);
  const step = (n: number) => (cake ? n : n - 1);
  // Red velvet : pas de garniture au choix (garniture classique d'office).
  const classicOnly = !!sponges.find((g) => g.id === sponge)?.classicOnly;

  const choose = (next: Selection) => {
    setSelection(next);
    setFlavour("");
    setSponge("");
    if (next.kind === "cake") {
      const c = CHRISTMAS_CAKES.find((x) => x.id === next.id)!;
      const sizes = CHRISTMAS_SIZE_ORDER.filter((s) => c.prices[s] !== undefined);
      setSize(sizes.length === 1 ? sizes[0] : null);
    } else {
      setSize(null);
    }
  };

  return (
    <Layout>
      {preview && (
        <div className="bg-foreground text-cream text-center text-xs tracking-[0.12em] uppercase px-4 py-2">
          {t("Preview — visible to the team only, not online yet", "Aperçu — visible uniquement par l’équipe, pas encore en ligne")}
        </div>
      )}

      {/* En-tête */}
      <section className="relative">
        <div className="w-full aspect-[16/9] md:aspect-[16/5]">
          <PhotoSlot image={null} alt="Noël" />
        </div>
        <div className="container mx-auto px-4 py-10 md:py-14 text-center">
          <h1 className="font-script font-normal text-[44px] md:text-[64px] leading-tight text-foreground">
            {t("Christmas", "Noël")}
          </h1>
          <p className="mt-3 max-w-2xl mx-auto text-sm md:text-base text-foreground/80 leading-relaxed">
            {t(
              "This year, Christmas is all about sweetness. Discover our Christmas bento cakes and, for the very first time, our Christmas logs: choose your design, your sponge and your filling.",
              "Cette année, Noël se fête en douceur. Découvrez nos bento cakes de Noël et, pour la première fois, nos bûches : choisissez votre design, votre génoise et votre garniture.",
            )}
          </p>
        </div>
      </section>

      {/* Gâteaux */}
      <section className="container mx-auto px-4 pb-12">
        <h2 className="uppercase tracking-[0.18em] text-sm font-semibold text-foreground mb-6 text-center">
          {t("Christmas cakes", "Gâteaux de Noël")}
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
          {CHRISTMAS_CAKES.map((c) => (
            <ProductCard
              key={c.id}
              name={l === "fr" ? c.nameFr : c.nameEn}
              price={t(`from CHF ${fromPrice(c)}`, `dès CHF ${fromPrice(c)}`)}
              images={cakePhotos(c)}
              selected={selection?.kind === "cake" && selection.id === c.id}
              onClick={() => choose({ kind: "cake", id: c.id })}
            />
          ))}
        </div>
      </section>

      {/* Bûches */}
      <section className="bg-cream py-12">
        <div className="container mx-auto px-4">
          <h2 className="uppercase tracking-[0.18em] text-sm font-semibold text-foreground mb-2 text-center">
            {t("Christmas logs", "Bûches de Noël")}
          </h2>
          <p className="text-center text-xs uppercase tracking-[0.15em] text-primary mb-3">{t("New", "Nouveauté")}</p>
          <p className="text-center text-sm text-foreground/80 max-w-xl mx-auto mb-6 leading-relaxed">{LOG_INTRO[l]}</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-6 max-w-4xl mx-auto">
            {CHRISTMAS_LOGS.map((b) => (
              <ProductCard
                key={b.id}
                name={l === "fr" ? b.nameFr : b.nameEn}
                price={`CHF ${CHRISTMAS_LOG_PRICE}`}
                images={cakePhotos(b)}
                selected={selection?.kind === "log" && selection.id === b.id}
                onClick={() => choose({ kind: "log", id: b.id })}
              />
            ))}
          </div>
        </div>
      </section>

      {/* Choix : taille, parfum, date */}
      {(cake || log) && (
        <section ref={formRef} className="container mx-auto px-4 py-12 scroll-mt-24">
          <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
            <div className="aspect-square">
              <PhotoCarousel
                key={(cake ?? log)!.id}
                images={cakePhotos((cake ?? log)!)}
                alt={l === "fr" ? (cake ?? log)!.nameFr : (cake ?? log)!.nameEn}
              />
            </div>

            <div className="space-y-8">
              <div>
                <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">
                  {log ? t("Christmas log", "Bûche de Noël") : t("Christmas cake", "Gâteau de Noël")}
                </p>
                <h3 className="uppercase tracking-[0.12em] text-xl font-semibold text-foreground mt-1">
                  {l === "fr" ? (cake ?? log)!.nameFr : (cake ?? log)!.nameEn}
                </h3>
                {log && <p className="text-sm text-foreground/80 mt-2 leading-relaxed">{LOG_INTRO[l]}</p>}
              </div>

              {cake && (
                <div>
                  <p className="uppercase tracking-[0.15em] text-xs font-semibold text-foreground mb-3">{t("1. Size", "1. Taille")}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {availableSizes.map((s) => (
                      <OptionTile
                        key={s}
                        title={CHRISTMAS_SIZE_LABELS[s][l]}
                        detail={`CHF ${cake.prices[s]} · ${l === "fr" ? CHRISTMAS_SIZE_LABELS[s].peopleFr : CHRISTMAS_SIZE_LABELS[s].peopleEn}`}
                        selected={size === s}
                        onClick={() => setSize(s)}
                      />
                    ))}
                  </div>
                </div>
              )}

              <div>
                <p className="uppercase tracking-[0.15em] text-xs font-semibold text-foreground mb-3">
                  {step(2)}. {t("Sponge", "Génoise")}
                </p>
                <Select
                  value={sponge}
                  onValueChange={(v) => {
                    setSponge(v);
                    if (SPONGES.find((g) => g.id === v)?.classicOnly) setFlavour(CLASSIC_FILLING.id);
                  }}
                >
                  <SelectTrigger className="rounded-none">
                    <SelectValue placeholder={t("Choose a sponge", "Choisir une génoise")} />
                  </SelectTrigger>
                  <SelectContent>
                    {sponges.map((g) => (
                      <SelectItem key={g.id} value={g.id}>{g[l]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {classicOnly && (
                  <p className="text-xs text-muted-foreground mt-2">
                    {t("Red velvet comes with our signature whipped cream only, no other filling.", "Le red velvet se fait uniquement avec notre crème fouettée signature, sans autre garniture.")}
                  </p>
                )}
              </div>

              {!classicOnly && (
              <div>
                <p className="uppercase tracking-[0.15em] text-xs font-semibold text-foreground mb-3">
                  {step(3)}. {t("Filling", "Garniture")}
                </p>
                <Select value={flavour} onValueChange={setFlavour}>
                  <SelectTrigger className="rounded-none">
                    <SelectValue placeholder={t("Choose a filling", "Choisir une garniture")} />
                  </SelectTrigger>
                  <SelectContent>
                    {flavours.map((f) => (
                      <SelectItem key={f.id} value={f.id} itemText={flavourName(f)}>
                        <div className="min-w-0 flex-1 py-0.5">
                          <span className="block whitespace-normal leading-snug">{flavourName(f)}</span>
                          {flavourDescription(f) && (
                            <span className="block text-[11px] text-foreground/70 leading-tight mt-0.5 whitespace-normal">{flavourDescription(f)}</span>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {flavours.find((f) => f.id === flavour) && flavourDescription(flavours.find((f) => f.id === flavour)!) && (
                  <p className="text-xs text-muted-foreground mt-2">{flavourDescription(flavours.find((f) => f.id === flavour)!)}</p>
                )}
              </div>
              )}

              <div>
                <p className="uppercase tracking-[0.15em] text-xs font-semibold text-foreground mb-3">
                  {classicOnly ? step(3) : step(4)}. {t("Date", "Date")}
                </p>
                <Popover open={calOpen} onOpenChange={setCalOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("w-full justify-start text-left font-normal rounded-none", !orderDate && "text-muted-foreground")}>
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {orderDate ? format(orderDate, "dd.MM.yyyy") : t("Choose a date", "Choisir une date")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <OrderCalendar
                      selected={orderDate}
                      onSelect={(d) => { setOrderDate(d); setCalOpen(false); }}
                      disabled={(date) => isOrderDateDisabled(date)}
                      initialFocus
                      className="p-3 pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
                <ExpressDateNotice date={orderDate} />
              </div>

              <div className="border-t border-border pt-6">
                {express > 0 && price !== null && (
                  <div className="space-y-1 mb-2 text-sm text-foreground/80">
                    <div className="flex justify-between"><span>{l === "fr" ? (cake ?? log)!.nameFr : (cake ?? log)!.nameEn}</span><span>CHF {price}</span></div>
                    <div className="flex justify-between"><span>{t(`Express surcharge (${Math.round(expressRate * 100)} %)`, `Supplément express (${Math.round(expressRate * 100)} %)`)}</span><span>CHF {express.toFixed(2)}</span></div>
                  </div>
                )}
                <div className="flex items-baseline justify-between mb-4">
                  <span className="uppercase tracking-[0.15em] text-xs font-semibold">{t("Total", "Total")}</span>
                  <span className="text-xl font-semibold">{total !== null ? `CHF ${Number.isInteger(total) ? total : total.toFixed(2)}` : "—"}</span>
                </div>
                <Button disabled className="w-full rounded-none uppercase tracking-[0.105em]">
                  {t("Add to cart", "Ajouter au panier")}
                </Button>
                {preview && (
                  <p className="text-xs text-muted-foreground mt-2 text-center">
                    {t("Online ordering will be switched on before the launch.", "La commande en ligne sera activée avant la mise en ligne.")}
                  </p>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      <div className="container mx-auto px-6 py-8 md:py-16">
        <ChristmasMoments />
      </div>
    </Layout>
  );
};

export default Christmas;
