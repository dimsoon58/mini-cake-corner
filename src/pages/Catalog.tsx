import { useState, useRef, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import CustomRequestForm from "@/components/CustomRequestForm";
import { INSPIRATIONS as inspirationItems } from "@/data/inspirations";
import { format, addDays } from "date-fns";
import useEmblaCarousel from "embla-carousel-react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog as Sheet,
  DialogContent as SheetContent,
  DialogHeader as SheetHeader,
  DialogTitle as SheetTitle,
  DialogDescription as SheetDescription,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectGroup, SelectLabel, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { ShoppingBag, Upload, X, Plus, Minus, ChevronDown, ChevronUp, CalendarIcon, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import Layout from "@/components/Layout";
import ExtraImageLightbox from "@/components/ExtraImageLightbox";
import { allergenMap, AllergenNotice } from "@/data/allergens";
import { getExcludedExtras, extraGroups, extraDescriptions } from "@/data/customization";
import { useCart } from "@/context/CartContext";
import type { CandleSelection } from "@/context/CartContext";
import { NUMBER_CANDLE_ID, NUMBER_CANDLE_PRICE, NUMBER_CANDLE_DIGITS, priceCandleSelection, getSimpleCandleQty, changeSimpleCandleQty, upsertCandleSelection, removeCandleSelection } from "@/lib/candleCartHelpers";
import { ColorFamilyCandleCard, FAMILY_CANDLE_COLORS } from "@/components/ColorFamilyCandleCard";
import { useToast } from "@/hooks/use-toast";
import { useLang } from "@/context/LanguageContext";
import { sizeInfo, sizeInfoSummary } from "@/data/sizeInfo";
import { flavorDescMap } from "@/data/flavorDesc";
import { supabase } from "@/integrations/supabase/client";
// @ts-ignore
import "@fontsource/dancing-script";

// Candle images
import candlePuppy from "@/assets/candle-puppy-new.png";
import candlePinkCar from "@/assets/candle-pink-car.png";
import candleSoccer from "@/assets/candle-soccer-new.png";
import candleCherry from "@/assets/candle-cherry-new.png";
import candleTeddyBear from "@/assets/candle-teddy-bear-new.png";
import candleDaisy from "@/assets/candle-daisy.png";
import candleRibbon from "@/assets/candle-ribbon.png";
import candlePinkOmbre from "@/assets/candle-pink-ombre-new.png";
import candleBlueOmbre from "@/assets/candle-blue-ombre-new.png";
import candleThickSpiral from "@/assets/candle-thick-spiral-new.png";
import candleSpiralPastel from "@/assets/candle-spiral-pastel-new.png";
import candleShinySpiral from "@/assets/candle-shiny-spiral-new.png";
import candleRainbow from "@/assets/candle-rainbow.png";
import candleRedCar from "@/assets/candle-red-car-new.png";
import candleBlueCar from "@/assets/candle-blue-car-new.png";
import candleYellowCar from "@/assets/candle-yellow-car-new.png";
import candleHeart from "@/assets/candle-heart-new.png";
import designRetroCake from "@/assets/design-retro-cake-new.jpg";
import retroCake1 from "@/assets/retro-cake-1.jpg";
import retroCake2 from "@/assets/retro-cake-2.jpg";
import retroCake3 from "@/assets/retro-cake-3.jpg";
import designRetroGlitter from "@/assets/design-retro-glitter-new.jpg";
import designRainbowCake from "@/assets/design-rainbow-cake-new.jpg";
import designShagCake from "@/assets/design-shag-cake-new.jpg";
import designShagCake2 from "@/assets/design-shag-cake-2.jpg";
import shagCake1 from "@/assets/shag-cake-1.jpg";
import shagCake2 from "@/assets/shag-cake-2.jpg";
import shagCake3 from "@/assets/shag-cake-3.jpg";
import designGoldLeaves from "@/assets/design-gold-leaves-new.png";
import designGoldenCake from "@/assets/design-golden-cake.jpg";
import designScatteredPearls from "@/assets/design-scattered-pearls-new.jpg";
import designPearlBorders from "@/assets/design-pearl-borders-new.jpg";
import designCherries from "@/assets/design-cherries-new.png";
import designGlitterCherries from "@/assets/design-glitter-cherries-new.jpg";
import designRibbons from "@/assets/design-ribbons-new.jpg";
import retroRibbons1 from "@/assets/retro-ribbons-1.jpg";
import retroRibbons2 from "@/assets/retro-ribbons-2.jpg";
import designGlitterCake from "@/assets/design-glitter-cake-new.jpg";
import extraGlitter from "@/assets/extra-glitter-new.jpg";
import designGlitterInAir from "@/assets/design-glitter-in-air-new.jpg";
import designHeartBomb from "@/assets/design-heart-bomb-new.jpg";
import designGenderReveal from "@/assets/design-gender-reveal-new.jpg";
import genderReveal2 from "@/assets/gender-reveal-2.jpg";
import genderReveal3 from "@/assets/gender-reveal-3.jpg";
import designPrintedPicture from "@/assets/design-printed-picture-new.jpg";
import printedPicture1 from "@/assets/printed-picture-1.jpg";
import designDrawing from "@/assets/design-drawing-new.jpg";
import drawing1 from "@/assets/drawing-1.jpg";
import designRosesPlease from "@/assets/design-roses-please-new.jpg";
import rectangleCake from "@/assets/home-cat-rectangle.jpg";
import rectangleSignature from "@/assets/rectangle-signature.jpg";
import rectangleRaspberries from "@/assets/rectangle-raspberries.jpg";
import rectangleFlowers from "@/assets/rectangle-flowers.jpg";
import designRosesPlease2 from "@/assets/design-roses-please-2.jpg";
import designButterflyGarden from "@/assets/design-butterfly-garden-new.jpg";
import designButterflyGarden2 from "@/assets/design-butterfly-garden-2.jpg";
import designPearlNumber from "@/assets/design-pearl-number-new.jpg";
import styleNormalWithBorder from "@/assets/style-normal-with-border.jpg";
import styleNormalWithoutBorder from "@/assets/style-normal-without-border.jpg";
import extraSprinkles from "@/assets/extra-sprinkles-new2.jpg";
import extraCherries from "@/assets/extra-cherries-new.jpg";
import extraGlitterCherries from "@/assets/extra-glitter-cherries-new.jpg";
import extraGoldLeaves from "@/assets/extra-gold-leaves.png";
import extraHeart from "@/assets/extra-heart.png";
import extraRetro from "@/assets/extra-retro.png";
import extraDrawing from "@/assets/extra-drawing.png";
import extraPrintedPicture from "@/assets/extra-printed-picture.png";
import extraButterfly from "@/assets/extra-butterfly-new.jpg";
import extraRibbons from "@/assets/extra-ribbons-new.jpg";
import designSprinklesWithBorder from "@/assets/design-sprinkles-with-border.jpg";

// Flavor images
import flavorVanilla from "@/assets/flavor-vanilla.png";
import flavorRedVelvet from "@/assets/flavor-red-velvet.png";
import flavorChocolate from "@/assets/flavor-chocolate.png";
import flavorChocolateLovers from "@/assets/flavor-chocolate-lovers.png";
import flavorChocolateLoverBerrylicious from "@/assets/flavor-chocolate-lover-berrylicious.png";
import flavorDarkBerrylicious from "@/assets/flavor-dark-berrylicious.png";
import flavorWhiteBerrylicious from "@/assets/flavor-white-berrylicious.png";
import flavorSaltedCaramel from "@/assets/flavor-salted-caramel-new.png";
import flavorLemonCurd from "@/assets/flavor-lemon-curd.png";
import flavorTiramisu from "@/assets/flavor-tiramisu-new.png";
import flavorPraline from "@/assets/flavor-praline.png";
import flavorPistachio from "@/assets/flavor-pistachio.png";
import flavorPassionFruit from "@/assets/flavor-passion-fruit.png";

// Box images
import boxBento from "@/assets/box-bento.png";
import boxRetro from "@/assets/box-retro.png";
import boxMedium from "@/assets/box-medium.png";
import boxLarge from "@/assets/box-large.png";
import bentoGallery1 from "@/assets/bento-gallery-1.jpg";
import bentoGallery2 from "@/assets/bento-gallery-2.jpg";
import bentoGallery3 from "@/assets/bento-gallery-3.jpg";
import bentoGallery4 from "@/assets/bento-gallery-4.jpg";
import bentoGallery5 from "@/assets/bento-gallery-5.jpg";
import bentoGallery6 from "@/assets/bento-gallery-6.jpg";
import bentoGallery7 from "@/assets/bento-gallery-7.jpg";
import bentoGallery8 from "@/assets/bento-gallery-8.jpg";
import bentoGallery9 from "@/assets/bento-gallery-9.jpg";
import bentoGallery10 from "@/assets/bento-gallery-10.jpg";
import bentoGallery11 from "@/assets/bento-gallery-11.jpg";
import bentoGallery12 from "@/assets/bento-gallery-12.jpg";
import bentoGallery13 from "@/assets/bento-gallery-13.jpg";
import bentoGallery14 from "@/assets/bento-gallery-14.jpg";
import bentoGallery15 from "@/assets/bento-gallery-15.jpg";
import bentoGallery16 from "@/assets/bento-gallery-16.jpg";

const baseColors = [
  { id: "white", name: "White", color: "#FFFFFF" },
  { id: "cream", name: "Cream", color: "#FFF8E7" },
  { id: "pastel-pink", name: "Pastel Pink", color: "#FFE4EC" },
  { id: "pink", name: "Pink", color: "#FFC0CB" },
  { id: "dark-pink", name: "Dark Pink", color: "#DE4489" },
  { id: "dark-red", name: "Red", color: "#CB2A1D" },
  { id: "burgundy", name: "Burgundy", color: "#800020" },
  { id: "pastel-yellow", name: "Pastel Yellow", color: "#FDFD96" },
  { id: "yellow", name: "Yellow", color: "#FFD700" },
  { id: "pastel-orange", name: "Pastel Orange", color: "#F5BE6A" },
  { id: "orange", name: "Orange", color: "#EE7C3A" },
  { id: "mint-green", name: "Pastel Green", color: "#87C895" },
  { id: "green", name: "Green", color: "#429356" },
  { id: "forest-green", name: "Forest Green", color: "#14532D" },
  { id: "baby-blue", name: "Pastel Blue", color: "#C7E4F8" },
  { id: "sky-blue", name: "Sky Blue", color: "#70B8EC" },
  { id: "blue", name: "Blue", color: "#3C88C9" },
  { id: "midnight-blue", name: "Midnight Blue", color: "#122B6D" },
  { id: "lavender", name: "Lavender", color: "#E6E6FA" },
  { id: "plum", name: "Plum", color: "#8E4585" },
  { id: "light-brown", name: "Light Brown", color: "#C4A484" },
  { id: "dark-brown", name: "Dark Brown", color: "#654321" },
  { id: "black", name: "Black", color: "#000000" },
];

const sizes = [
  { id: "bento", name: "Bento Box", price: 40, image: boxBento },
  { id: "retro", name: "Retro Box", price: 45, image: boxRetro },
  { id: "medium", name: "Medium", price: 85, image: boxMedium },
  { id: "large", name: "Large", price: 165, image: boxLarge },
  { id: "rectangle", name: "Rectangle", price: 450, image: rectangleCake },
];

const shapes = [
  { id: "round", name: "Round", extraPrice: { bento: 0, retro: 0, medium: 0, large: 0, rectangle: 0 } },
  { id: "heart", name: "Heart", extraPrice: { bento: 3, retro: 3, medium: 5, large: 5 } },
];

const flavors = [
  { id: "vanilla", name: "Vanilla", image: flavorVanilla, extraPrice: { bento: 0, retro: 0, medium: 0, large: 0, rectangle: 0 } },
  { id: "red-velvet", name: "Red Velvet", image: flavorRedVelvet, extraPrice: { bento: 0, retro: 0, medium: 0, large: 0, rectangle: 0 } },
  { id: "chocolate", name: "Chocolate", image: flavorChocolate, extraPrice: { bento: 0, retro: 0, medium: 0, large: 0, rectangle: 0 } },
  { id: "chocolate-lovers", name: "Chocolate Lovers", image: flavorChocolateLovers, extraPrice: { bento: 2, retro: 2, medium: 5, large: 10, rectangle: 20 } },
  { id: "chocolate-lover-berrylicious", name: "Chocolate Lover x Berrylicious", image: flavorChocolateLoverBerrylicious, extraPrice: { bento: 4, retro: 4, medium: 10, large: 15, rectangle: 30 } },
  { id: "dark-berrylicious", name: "Dark Berrylicious", image: flavorDarkBerrylicious, extraPrice: { bento: 2, retro: 2, medium: 5, large: 10, rectangle: 20 } },
  { id: "white-berrylicious", name: "White Berrylicious", image: flavorWhiteBerrylicious, extraPrice: { bento: 2, retro: 2, medium: 5, large: 10, rectangle: 20 } },
  { id: "salted-caramel", name: "Salted Butter Caramel", image: flavorSaltedCaramel, extraPrice: { bento: 2, retro: 2, medium: 5, large: 10, rectangle: 20 } },
  { id: "lemon-curd", name: "Lemon Curd", image: flavorLemonCurd, extraPrice: { bento: 2, retro: 2, medium: 5, large: 10, rectangle: 20 } },
  { id: "tiramisu", name: "Tiramisu", image: flavorTiramisu, extraPrice: { bento: 4, retro: 4, medium: 10, large: 15, rectangle: 30 } },
  { id: "praline", name: "Praline Obsession", image: flavorPraline, extraPrice: { bento: 4, retro: 4, medium: 10, large: 15, rectangle: 30 } },
  { id: "pistachio-lovers", name: "Pistachio Lovers", image: flavorPistachio, extraPrice: { bento: 4, retro: 4, medium: 10, large: 15, rectangle: 30 } },
  { id: "passion-fruit", name: "Passion Fruit", image: flavorPassionFruit, extraPrice: { bento: 4, retro: 4, medium: 10, large: 15, rectangle: 30 } },
  { id: "vanilla-gf", name: "Vanilla Gluten-Free", image: flavorVanilla, extraPrice: { bento: 4, retro: 4, medium: 10, large: 15, rectangle: 30 } },
  { id: "red-velvet-gf", name: "Red Velvet Gluten-Free", image: flavorRedVelvet, extraPrice: { bento: 4, retro: 4, medium: 10, large: 15, rectangle: 30 } },
  { id: "chocolate-gf", name: "Chocolate Gluten-Free", image: flavorChocolate, extraPrice: { bento: 4, retro: 4, medium: 10, large: 15, rectangle: 30 } },
  { id: "chocolate-gf-berrylicious", name: "Chocolate GF × Berrylicious", image: flavorDarkBerrylicious, extraPrice: { bento: 6, retro: 6, medium: 15, large: 25, rectangle: 50 } },
  { id: "vanilla-gf-berrylicious", name: "Vanilla GF × Berrylicious", image: flavorWhiteBerrylicious, extraPrice: { bento: 6, retro: 6, medium: 15, large: 25, rectangle: 50 } },
  { id: "lemon-curd-gf", name: "Lemon Curd Gluten-free", image: flavorLemonCurd, extraPrice: { bento: 6, retro: 6, medium: 15, large: 25, rectangle: 50 } },
  { id: "chocolate-lovers-gf", name: "Chocolate Lovers Gluten-free", image: flavorChocolateLovers, extraPrice: { bento: 6, retro: 6, medium: 15, large: 25, rectangle: 50 } },
  { id: "orange-blossom-gf", name: "Orange Blossom Gluten-free", image: flavorVanilla, extraPrice: { bento: 8, retro: 8, medium: 20, large: 30, rectangle: 60 } },
  { id: "pistachio-gf", name: "Pistachio Gluten-free", image: flavorPistachio, extraPrice: { bento: 8, retro: 8, medium: 20, large: 30, rectangle: 60 } },
  { id: "tiramisu-gf", name: "Tiramisu Gluten-free", image: flavorTiramisu, extraPrice: { bento: 8, retro: 8, medium: 20, large: 30, rectangle: 60 } },
  { id: "passion-fruit-gf", name: "Passion Fruit Gluten-free", image: flavorPassionFruit, extraPrice: { bento: 8, retro: 8, medium: 20, large: 30, rectangle: 60 } },
  { id: "praline-gf", name: "Praline Gluten-free", image: flavorPraline, extraPrice: { bento: 8, retro: 8, medium: 20, large: 30, rectangle: 60 } },
];

// Menu grouping only — purely a display concern, independent from the
// per-flavor extraPrice values above, which are untouched.
const STANDARD_FLAVOR_IDS = ["vanilla", "red-velvet", "chocolate"];
const PREMIUM_FLAVOR_IDS = ["chocolate-lovers", "dark-berrylicious", "white-berrylicious", "salted-caramel", "lemon-curd"];
const DELUXE_FLAVOR_IDS = ["chocolate-lover-berrylicious", "tiramisu", "praline", "pistachio-lovers", "passion-fruit"];
const GF_STANDARD_FLAVOR_IDS = ["vanilla-gf", "red-velvet-gf", "chocolate-gf"];
const GF_PREMIUM_FLAVOR_IDS = ["chocolate-gf-berrylicious", "vanilla-gf-berrylicious", "lemon-curd-gf", "chocolate-lovers-gf"];
const GF_DELUXE_FLAVOR_IDS = ["orange-blossom-gf", "pistachio-gf", "tiramisu-gf", "passion-fruit-gf", "praline-gf"];

const standardFlavors = flavors.filter((f) => STANDARD_FLAVOR_IDS.includes(f.id));
const premiumFlavors = flavors.filter((f) => PREMIUM_FLAVOR_IDS.includes(f.id));
const deluxeFlavors = flavors.filter((f) => DELUXE_FLAVOR_IDS.includes(f.id));
const glutenFreeStandardFlavors = flavors.filter((f) => GF_STANDARD_FLAVOR_IDS.includes(f.id));
const glutenFreePremiumFlavors = flavors.filter((f) => GF_PREMIUM_FLAVOR_IDS.includes(f.id));
const glutenFreeDeluxeFlavors = flavors.filter((f) => GF_DELUXE_FLAVOR_IDS.includes(f.id));

const candles = [
  // Single ordered list (Blue Ombré, Thick Spiral, Shiny Spiral, Pastel Spiral, Rainbow, Pink Ombré, Daisy, Red Heart, then the rest)
  { id: "blue-ombre", name: "Blue Ombré", image: candleBlueOmbre, unitPrice: 1, hasPack: true, packSize: 6, packPrice: 5 },
  { id: "thick-spiral", name: "Thick Spiral", image: candleThickSpiral, unitPrice: 2, hasPack: true, packSize: 6, packPrice: 10 },
  { id: "pink-gold-spiral", name: "Pink Gold Spiral", image: candleShinySpiral /* TODO: remplacer par une vraie photo produit */, unitPrice: 1, hasPack: true, packSize: 6, packPrice: 5 },
  { id: "silver-spiral", name: "Silver Spiral", image: candleShinySpiral /* TODO: remplacer par une vraie photo produit */, unitPrice: 1, hasPack: true, packSize: 6, packPrice: 5 },
  { id: "gold-spiral", name: "Gold Spiral", image: candleShinySpiral /* TODO: remplacer par une vraie photo produit */, unitPrice: 1, hasPack: true, packSize: 6, packPrice: 5 },
  { id: "spiral-champagne", name: "Spiral Champagne", image: candleShinySpiral /* TODO: remplacer par une vraie photo produit */, unitPrice: 1, hasPack: true, packSize: 6, packPrice: 5 },
  { id: "shiny-spiral", name: "Shiny Spiral", image: candleShinySpiral, unitPrice: 1, hasPack: true, packSize: 6, packPrice: 5 },
  { id: "spiral-pastel", name: "Pastel Spiral", image: candleSpiralPastel, unitPrice: 1, hasPack: true, packSize: 6, packPrice: 5 },
  { id: "rainbow", name: "Rainbow", image: candleRainbow, unitPrice: 1, hasPack: true, packSize: 6, packPrice: 5 },
  { id: "pink-ombre", name: "Pink Ombré", image: candlePinkOmbre, unitPrice: 1, hasPack: true, packSize: 6, packPrice: 5 },
  { id: "daisy", name: "Daisy", image: candleDaisy, unitPrice: 2, hasPack: false },
  { id: "heart", name: "Red Heart", image: candleHeart, unitPrice: 2, hasPack: false },
  { id: "puppy", name: "Puppy", image: candlePuppy, unitPrice: 2, hasPack: false },
  { id: "teddy-bear", name: "Teddy Bear", image: candleTeddyBear, unitPrice: 2, hasPack: false },
  { id: "cherry", name: "Cherry", image: candleCherry, unitPrice: 2, hasPack: false },
  { id: "ribbon", name: "Ribbon", image: candleRibbon, unitPrice: 2, hasPack: false },
  { id: "soccer", name: "Footy Flame", image: candleSoccer, unitPrice: 2, hasPack: false },
  { id: "pink-car", name: "Pink Car", image: candlePinkCar, unitPrice: 2, hasPack: false },
  { id: "red-car", name: "Red Car", image: candleRedCar, unitPrice: 2, hasPack: false },
  { id: "blue-car", name: "Blue Car", image: candleBlueCar, unitPrice: 2, hasPack: false },
  { id: "yellow-car", name: "Yellow Car", image: candleYellowCar, unitPrice: 2, hasPack: false },
];

const catalogExtras = [
  { id: "gold-leaves", name: "Gold Leaves", price: { bento: 3, retro: 4, medium: 5, large: 8, rectangle: 12 }, image: extraGoldLeaves },
  { id: "cherries", name: "Cherries", price: { retro: 4, medium: 8, large: 12, rectangle: 20 }, image: extraCherries },
  { id: "glitter-cherries", name: "Glitter Cherries", price: { retro: 7, medium: 10, large: 15, rectangle: 25 }, image: extraGlitterCherries },
  { id: "scattered-pearl", name: "Scattered Pearls", price: { bento: 2, retro: 4, medium: 6, large: 8, rectangle: 15 }, image: designScatteredPearls },
  { id: "glitter", name: "Glitter", price: { bento: 5, retro: 5, medium: 10, large: 12, rectangle: 25 }, image: extraGlitter },
  { id: "glitter-base", name: "Glitter Base", price: { bento: 8, retro: 8, medium: 10, large: 12, rectangle: 25 }, image: designGlitterCake },
  { id: "glitter-in-the-air", name: "Glitter in the Air", price: { bento: 10, retro: 10, medium: 15, large: 20 }, image: designGlitterInAir },
  { id: "pearl-border", name: "Pearl Border (each)", price: { retro: 10, medium: 17, large: 25, rectangle: 60 }, image: designPearlBorders },
  { id: "retro", name: "Retro", price: { retro: 6, medium: 10, large: 15, rectangle: 30 }, image: extraRetro },
  { id: "ribbons", name: "Ribbons", price: { retro: 5, medium: 8, large: 10, rectangle: 20 }, image: extraRibbons },
  { id: "pearl-number", name: "Pearl Number", price: { bento: 6, retro: 6, medium: 6, large: 6, rectangle: 10 }, image: designPearlNumber },
  { id: "butterfly", name: "Butterfly", price: { retro: 6, medium: 8, large: 10, rectangle: 20 }, image: extraButterfly },
  { id: "sprinkles", name: "Sprinkles", price: { bento: 3, retro: 4, medium: 5, large: 6, rectangle: 10 }, image: extraSprinkles },
  { id: "printed-picture", name: "Printed Picture", price: { bento: 15, retro: 15, medium: 15, large: 15 }, image: extraPrintedPicture },
];

const ribbonColors = [
  { id: "baby-pink", name: "Baby Pink", color: "#F4C2C2" },
  { id: "pink", name: "Pink", color: "#FFC0CB" },
  { id: "orange", name: "Orange", color: "#FFA500" },
  { id: "red", name: "Red", color: "#EF4444" },
  { id: "wine-red", name: "Wine Red", color: "#722F37" },
  { id: "white", name: "White", color: "#FFFFFF" },
  { id: "sky-blue", name: "Sky Blue", color: "#87CEEB" },
  { id: "midnight-blue", name: "Midnight Blue", color: "#191970" },
  { id: "black", name: "Black", color: "#000000" },
];

const genderColors = [
  { id: "pink", name: "Pink", color: "#F9A8D4" },
  { id: "blue", name: "Blue", color: "#93C5FD" },
];

const butterflyColors = [
  { id: "pink", name: "Pink", color: "#FFC0CB" },
  { id: "blue", name: "Blue", color: "#3B82F6" },
  { id: "gold", name: "Gold", color: "#D4AF37" },
];

const glitterColors = [
  { id: "white", name: "White", color: "#FFFFFF" },
  { id: "gold", name: "Gold", color: "#D4AF37" },
  { id: "pink", name: "Pink", color: "#FFC0CB" },
  { id: "red", name: "Red", color: "#EF4444" },
  { id: "blue", name: "Blue", color: "#3B82F6" },
];

const glitterCherriesColors = [
  { id: "white", name: "White", color: "#FFFFFF" },
  { id: "gold", name: "Gold", color: "#D4AF37" },
  { id: "pink", name: "Pink", color: "#FFC0CB" },
  { id: "red", name: "Red", color: "#EF4444" },
  { id: "blue", name: "Blue", color: "#3B82F6" },
];

const catalog = [
  {
    id: "normal-without-border",
    name: "Normal without Border",
    description: "A smooth, clean and elegant finish",
    priceRange: "CHF 40 – 170",
    image: styleNormalWithoutBorder,
    styleId: "normal-without-border",
    styleName: "Normal without border",
    stylePrice: { bento: 0, retro: 0, medium: 0, large: 0 },
    disableText: false,
  },
  {
    id: "normal-with-border",
    name: "Normal with Border",
    description: "Classic cake with elegant piped border",
    priceRange: "CHF 40 – 170",
    image: styleNormalWithBorder,
    styleId: "normal-with-border",
    styleName: "Normal with border",
    stylePrice: { bento: 0, retro: 0, medium: 0, large: 0 },
    disableText: false,
  },
  {
    id: "heart-bomb",
    bestSeller: true,
    name: "Heart Bomb",
    description: "A romantic cake covered in delicate heart decorations",
    image: designHeartBomb,
    styleId: "heart-bomb",
    styleName: "Heart Bomb",
    priceRange: "CHF 43 – 185",
    stylePrice: { bento: 3, retro: 5, medium: 10, large: 15 },
    disableText: false,
  },
  {
    id: "retro-cake",
    name: "Retro Cake",
    description: "Vintage style with elegant decorations",
    image: designRetroCake,
    images: [designRetroCake, retroCake1, retroCake2, retroCake3],
    styleId: "retro-vintage",
    styleName: "Retro / Vintage",
    priceRange: "CHF 51 – 185",
    stylePrice: { retro: 6, medium: 10, large: 15 },
    disableText: false,
  },
  {
    id: "glitter-cherries-retro",
    name: "Glitter Cherries x Retro Cake",
    description: "Sparkling cherry decorations on a retro cake",
    image: designGlitterCherries,
    styleId: "glitter-cherries-retro",
    styleName: "Glitter Cherries on a Retro Cake",
    stylePrice: { retro: 13, medium: 20, large: 30, rectangle: 55 },
    disableText: false,
  },
  {
    id: "pearl-border-retro",
    bestSeller: true,
    name: "Pearl Border × Retro Decoration",
    description: "Three elegant pearl borders on a retro design",
    image: designPearlBorders,
    styleId: "pearl-border-retro",
    styleName: "Pearl Border × Retro Decoration",
    priceRange: "CHF 85 – 268",
    stylePrice: { retro: 40, medium: 67, large: 98 },
    disableText: false,
  },
  {
    id: "retro-ribbons",
    name: "Retro × Ribbons",
    description: "Beautiful ribbon decorations on a retro cake",
    image: designRibbons,
    images: [retroRibbons2, retroRibbons1],
    styleId: "retro-ribbons",
    styleName: "Retro × Ribbons",
    stylePrice: { retro: 11, medium: 18, large: 25, rectangle: 50 },
    disableText: false,
  },
  {
    id: "roses-please",
    name: "Roses Please",
    description: "Elegant cake adorned with beautiful piped roses",
    image: designRosesPlease,
    images: [designRosesPlease, designRosesPlease2],
    styleId: "roses-please",
    styleName: "Roses Please",
    priceRange: "CHF 46 – 190",
    stylePrice: { bento: 6, retro: 8, medium: 15, large: 20 },
    disableText: false,
  },
  {
    id: "retro-glitter-cake",
    name: "Retro Glitter Cake",
    description: "Sparkly glitter finish on a retro cake",
    image: designRetroGlitter,
    styleId: "retro-glitter-cake",
    styleName: "Retro Glitter Cake",
    stylePrice: { retro: 11, medium: 20, large: 27, rectangle: 55 },
    disableText: false,
  },
  {
    id: "printed-picture",
    name: "Printed Pictures / Logo",
    description: "Add a personal touch with a printed photo or logo on the cake",
    image: designPrintedPicture,
    images: [designPrintedPicture, printedPicture1],
    styleId: "printed-picture",
    styleName: "Printed Picture",
    priceRange: "CHF 55 – 185",
    stylePrice: { bento: 15, retro: 15, medium: 15, large: 15 },
    disableText: true,
  },
  {
    id: "shag-cake",
    name: "Shag Cake",
    description: "A retro inspired shag cake with rich texture and colourful details",
    image: designShagCake,
    images: [designShagCake, shagCake1, shagCake2, shagCake3],
    styleId: "shag-cake",
    styleName: "Shag Cake",
    priceRange: "CHF 57 – 200",
    stylePrice: { retro: 12, medium: 20, large: 30 },
    disableText: false,
  },
  {
    id: "rainbow-cake",
    name: "Rainbow Cake",
    description: "A fun retro-style cake with pastel rainbows, sprinkles, and piped borders",
    image: designRainbowCake,
    styleId: "rainbow-cake",
    styleName: "Rainbow Cake",
    priceRange: "CHF 60 – 200",
    stylePrice: { retro: 15, medium: 20, large: 30 },
    disableText: false,
  },
  {
    id: "drawing",
    name: "Drawing",
    description: "A simple, personalised hand-drawn design. Detailed illustrations are available on request.",
    image: designDrawing,
    images: [designDrawing, drawing1],
    styleId: "custom-drawing",
    styleName: "Custom Drawing",
    priceRange: "CHF 48 – 185",
    stylePrice: { bento: 8, retro: 8, medium: 10, large: 15 },
    disableText: false,
  },
  {
    id: "cherries-retro",
    name: "Cherries x Retro Cake",
    description: "Retro cake topped with cherries",
    image: designCherries,
    imagePosition: "object-[center_70%]",
    styleId: "cherries-retro",
    styleName: "Cherries on a Retro Cake",
    stylePrice: { retro: 10, medium: 18, large: 27, rectangle: 50 },
    disableText: false,
  },
  {
    id: "scattered-retro-pearls",
    name: "Scattered Retro Pearls",
    description: "Delicate pearls scattered across the cake, with a pearl border and retro decoration",
    image: designScatteredPearls,
    styleId: "scattered-retro-pearls",
    styleName: "Scattered Retro Pearls",
    stylePrice: { retro: 10, medium: 16, large: 23, rectangle: 45 },
    disableText: false,
  },
  {
    id: "gold-leaves",
    name: "Gold Leaves",
    description: "Elegant cake with gold leaf border",
    image: designGoldLeaves,
    styleId: "gold-leaves-style",
    styleName: "Gold Leaves",
    stylePrice: { bento: 3, retro: 4, medium: 5, large: 8, rectangle: 12 },
    disableText: false,
  },
  {
    id: "golden-cake",
    name: "Golden Cake",
    description: "A luxurious fully golden cake",
    image: designGoldenCake,
    styleId: "golden-cake",
    styleName: "Golden Cake",
    priceRange: "CHF 60 – 210",
    stylePrice: { retro: 15, medium: 25, large: 40 },
    disableText: false,
  },
  {
    id: "pearl-number",
    name: "Pearl Number",
    description: "Customise with a pearl number",
    image: designPearlNumber,
    styleId: "pearl-number",
    styleName: "Pearl Number",
    stylePrice: { bento: 6, retro: 6, medium: 6, large: 6, rectangle: 10 },
    disableText: false,
  },
  {
    id: "retro-ribbons-glitter",
    name: "Retro × Glitter in the Air",
    description: "A retro cake finished with glitter you blow on, for a spectacular effect",
    image: designGlitterInAir,
    styleId: "retro-ribbons-glitter",
    styleName: "Retro × Glitter in the Air",
    priceRange: "CHF 66 – 215",
    stylePrice: { retro: 21, medium: 33, large: 45 },
    disableText: true,
  },
  {
    id: "rectangle-signature",
    name: "Signature Rectangle Cake",
    description: "Our signature rectangle cake, piped by hand.",
    priceRange: "CHF 480",
    image: rectangleSignature,
    styleId: "rectangle-signature",
    styleName: "Signature Rectangle Cake",
    stylePrice: { rectangle: 30 },
    disableText: false,
  },
  {
    id: "rectangle-raspberries",
    name: "Raspberries Rectangle Cake",
    description: "A rectangle cake covered with fresh raspberries.",
    priceRange: "CHF 510",
    image: rectangleRaspberries,
    styleId: "rectangle-raspberries",
    styleName: "Raspberries Rectangle Cake",
    stylePrice: { rectangle: 60 },
    disableText: false,
  },
  {
    id: "rectangle-flowers",
    name: "Flowers Rectangle Cake",
    description: "A rectangle cake dressed with fresh flowers.",
    priceRange: "CHF 495",
    image: rectangleFlowers,
    styleId: "rectangle-flowers",
    styleName: "Flowers Rectangle Cake",
    stylePrice: { rectangle: 45 },
    disableText: false,
  },
  {
    id: "butterfly-garden",
    name: "Butterfly Garden",
    description: "A gradient cake adorned with pearls and edible butterflies",
    image: designButterflyGarden,
    images: [designButterflyGarden, designButterflyGarden2],
    styleId: "butterfly-garden",
    styleName: "Butterfly Garden",
    priceRange: "CHF 55 – 190",
    stylePrice: { retro: 10, medium: 15, large: 20 },
    disableText: false,
  },
  {
    id: "glitter-base",
    name: "Glitter Base",
    description: "Sparkly glitter base surrounded by gold leaf",
    image: designGlitterCake,
    styleId: "glitter-base",
    styleName: "Glitter Base",
    stylePrice: { bento: 8, retro: 8, medium: 10, large: 12, rectangle: 25 },
    disableText: false,
  },
  {
    id: "gender-reveal",
    name: "Gender Reveal",
    description: "Choose the inside colour. Perfect for your special announcement",
    image: designGenderReveal,
    images: [designGenderReveal, genderReveal2, genderReveal3],
    styleId: "gender-reveal",
    styleName: "Gender Reveal",
    priceRange: "CHF 45 – 185",
    stylePrice: { bento: 5, retro: 5, medium: 10, large: 15 },
    disableText: false,
  },
  {
    id: "sprinkles-with-border",
    name: "Sprinkles with Border",
    description: "A classic cake with decorative borders and colourful sprinkles",
    image: designSprinklesWithBorder,
    styleId: "sprinkles-with-border",
    styleName: "Sprinkles with Border",
    stylePrice: { bento: 3, retro: 4, medium: 5, large: 6, rectangle: 10 },
    disableText: false,
  },
];

// Per-design colour section configuration. Designs not listed use the default
// (base colour + "Decoration Colour" with up to 3 picks).
interface ColorSectionConfig {
  showBase: boolean;
  baseNote?: string;
  secondaryLabel: string | null; // null hides the second colour section
  secondaryMax: number;
  roseColor: boolean; // extra single-colour section (Roses Please)
  secondaryOptional: boolean; // second colour section is optional (no validation)
  hideExtras: boolean;
}

const colorSectionOverrides: Record<string, Partial<ColorSectionConfig>> = {
  "normal-with-border": { secondaryLabel: "Border Colour", secondaryMax: 1 },
  "normal-without-border": { secondaryLabel: null },
  "golden-cake": { showBase: false, secondaryLabel: null },
  "roses-please": { secondaryLabel: "Border Colour", secondaryMax: 1, roseColor: true }, // rose section labelled "Roses Colour"
  "butterfly-garden": {
    secondaryLabel: "Second Colour (optional)",
    secondaryMax: 1,
    secondaryOptional: true,
  },
  "custom-drawing": {
    secondaryLabel: "Second Colour (optional)",
    secondaryMax: 1,
    secondaryOptional: true,
  },
  "gender-reveal": { showBase: false, secondaryLabel: null, hideExtras: true },
  "heart-bomb": { secondaryLabel: "Heart Colour", secondaryMax: 1, hideExtras: true },
  "shag-cake": { showBase: false, secondaryLabel: "Choose Your Colours", secondaryMax: 6 },
  "rainbow-cake": { secondaryLabel: null },
  "printed-picture": { secondaryLabel: "Border Colour", secondaryMax: 1 },
  // Inspiration orders: shape, flavour, text and candles only
  inspiration: { showBase: false, secondaryLabel: null, hideExtras: true },
};

const getColorConfig = (styleId?: string): ColorSectionConfig => ({
  showBase: true,
  secondaryLabel: "Decoration Colour",
  secondaryMax: 3,
  roseColor: false,
  secondaryOptional: false,
  hideExtras: false,
  ...(styleId ? colorSectionOverrides[styleId] : undefined),
});

// Per-design extras whitelist: when a design is listed here, ONLY these
// extras are offered ([] hides the extras section entirely).
const designAllowedExtras: Record<string, string[]> = {
  "butterfly-garden": ["printed-picture"],
  "rainbow-cake": [],
  "printed-picture": [],
  "shag-cake": ["cherries", "glitter-cherries"],
  "custom-drawing": ["gold-leaves", "printed-picture"],
};

// Collections: curated groupings shown as separate catalog sections
const collections = [
  { title: "The Best Sellers Collection", anchor: "best-sellers", ids: ["retro-cake", "roses-please", "pearl-border-retro"] },
  { title: "The Iconic Collection", anchor: "iconic", ids: ["shag-cake", "butterfly-garden", "heart-bomb"] },
  { title: "The Minimal Collection", anchor: "minimal", ids: ["normal-with-border", "normal-without-border"] },
  { title: "The Original Collection", anchor: "original", ids: ["golden-cake", "rainbow-cake", "retro-ribbons-glitter"] },
  { title: "The Personalised Collection", anchor: "personalised", ids: ["printed-picture", "gender-reveal", "drawing"] },
  { title: "The Rectangle Cakes", anchor: "rectangle-cakes", ids: ["rectangle-signature", "rectangle-raspberries", "rectangle-flowers"] },
];

// Carousel component for catalog cards with multiple images
const CatalogCarousel = ({ images, name, imagePositions }: { images: string[]; name: string; imagePositions?: string[] }) => {
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: true });
  const [selectedIndex, setSelectedIndex] = useState(0);

  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    setSelectedIndex(emblaApi.selectedScrollSnap());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    onSelect();
    emblaApi.on("select", onSelect);
    return () => { emblaApi.off("select", onSelect); };
  }, [emblaApi, onSelect]);

  return (
    <div className="aspect-square overflow-hidden bg-muted/30 relative group">
      <div ref={emblaRef} className="overflow-hidden h-full">
        <div className="flex h-full">
          {images.map((img, i) => (
            <div key={i} className="flex-[0_0_100%] min-w-0 h-full">
              <img src={img} alt={`${name} ${i + 1}`} className={cn("w-full h-full object-cover", imagePositions?.[i])} />
            </div>
          ))}
        </div>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); emblaApi?.scrollPrev(); }}
        className="absolute left-2 top-1/2 -translate-y-1/2 bg-background/80 rounded-none p-1 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); emblaApi?.scrollNext(); }}
        className="absolute right-2 top-1/2 -translate-y-1/2 bg-background/80 rounded-none p-1 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5">
        {images.map((_, i) => (
          <button
            key={i}
            onClick={(e) => { e.stopPropagation(); emblaApi?.scrollTo(i); }}
            className={cn("w-2 h-2 rounded-full transition-colors", i === selectedIndex ? "bg-foreground" : "bg-foreground/40")}
          />
        ))}
      </div>
    </div>
  );
};

interface CakeSelections {
  orderDate: Date | null;
  orderTime: string;
  size: string;
  shape: string;
  flavor: string;
  baseColor: string;
  decorationColors: string[];
  borderTopColor?: string;
  borderBottomColor?: string;
  roseColor: string;
  wantsText: boolean;
  cakeText: string;
  textColor: string;
  textStyle: string;
  candles: CandleSelection[];
  printedImage: File | null;
  comment: string;
  commentImages: File[];
  extras: string[];
  ribbonColor: string;
  butterflyColor: string;
  genderColor: string;
  glitterColor: string;
  glitterCherriesColor: string;
  shagDesignPreference: number;
}

// Generate time slots from 10:00 to 18:30 in 30-minute intervals
const generateTimeSlots = () => {
  const slots: string[] = [];
  for (let hour = 10; hour <= 18; hour++) {
    slots.push(`${hour.toString().padStart(2, '0')}:00`);
    if (hour < 18 || (hour === 18 && slots[slots.length - 1] !== "18:30")) {
      slots.push(`${hour.toString().padStart(2, '0')}:30`);
    }
  }
  return slots;
};

const TIME_SLOTS = generateTimeSlots();

const textStyles = [
  { id: "normal", name: "Normal" },
  { id: "uppercase", name: "UPPERCASE" },
  { id: "cursive", name: "Cursive" },
];


// French label maps for module-scope data rendered to customers
const collectionTitleFr: Record<string, string> = {
  "The Minimal Collection": "La collection Minimaliste",
  "The Rectangle Cakes": "The Rectangle Cakes",
  "The Best Sellers Collection": "La collection Best Sellers",
  "The Iconic Collection": "La collection Iconique",
  "The Original Collection": "La collection Originale",
  "The Personalised Collection": "La collection Personnalisée",
};
const cakeNameFr: Record<string, string> = {
  "rectangle-signature": "Signature Rectangle Cake",
  "rectangle-raspberries": "Raspberries Rectangle Cake",
  "rectangle-flowers": "Flowers Rectangle Cake",
  "normal-without-border": "Normal without Border",
  "normal-with-border": "Normal with Border",
};
const cakeDescFr: Record<string, string> = {
  "rectangle-signature": "Notre gâteau rectangle signature, poché à la main.",
  "rectangle-raspberries": "Un gâteau rectangle recouvert de framboises fraîches.",
  "rectangle-flowers": "Un gâteau rectangle habillé de fleurs fraîches.",
  "normal-without-border": "Une finition lisse, épurée et élégante",
  "normal-with-border": "Un gâteau classique avec une élégante bordure pochée",
  "heart-bomb": "Un gâteau romantique recouvert de délicates décorations en forme de cœur",
  "retro-cake": "Un style vintage aux décorations élégantes",
  "glitter-cherries-retro": "De pétillantes décorations de cerises sur un gâteau rétro",
  "pearl-border-retro": "Trois élégantes bordures de perles sur un décor rétro",
  "retro-ribbons": "De ravissants rubans sur un gâteau rétro",
  "roses-please": "Un gâteau élégant orné de délicates roses pochées.",
  "retro-glitter-cake": "Une finition pailletée et scintillante sur un gâteau rétro",
  "printed-picture": "Ajoutez une touche personnelle avec une photo ou un logo imprimé sur le gâteau",
  "shag-cake": "Un shag cake d'inspiration rétro, à la texture riche et aux détails colorés",
  "rainbow-cake": "Un gâteau amusant de style rétro, avec des arcs-en-ciel pastel, des vermicelles et des bordures pochées",
  "drawing": "Un dessin simple, personnalisé et réalisé à la main. Les illustrations complexes sont disponibles sur devis.",
  "cherries-retro": "Un gâteau rétro couronné de cerises",
  "scattered-retro-pearls": "De délicates perles éparpillées sur le gâteau, avec une bordure de perles et une décoration rétro",
  "gold-leaves": "Un gâteau élégant avec une bordure de feuilles d'or",
  "golden-cake": "Un gâteau entièrement doré et luxueux",
  "pearl-number": "Personnalisez avec un chiffre en perles",
  "retro-ribbons-glitter": "Un gâteau rétro sublimé de paillettes à souffler pour une finition spectaculaire.",
  "butterfly-garden": "Un gâteau dégradé, orné de perles et de papillons comestibles.",
  "glitter-base": "Une base pailletée et scintillante entourée de feuilles d'or",
  "gender-reveal": "Choisissez la couleur intérieure. Parfait pour votre annonce si spéciale",
  "sprinkles-with-border": "Un gâteau classique avec des bordures décoratives et des vermicelles colorés",
};
const styleNameFr: Record<string, string> = {
  "normal-without-border": "Normal without Border",
  "normal-with-border": "Normal with Border",
  "heart-bomb": "Heart Bomb",
  "retro-vintage": "Retro / Vintage",
  "glitter-cherries-retro": "Glitter Cherries on a Retro Cake",
  "pearl-border-retro": "Pearl Border × Retro Decoration",
  "retro-ribbons": "Retro × Ribbons",
  "roses-please": "Roses Please",
  "retro-glitter-cake": "Retro Glitter Cake",
  "printed-picture": "Printed Picture",
  "shag-cake": "Shag Cake",
  "rainbow-cake": "Rainbow Cake",
  "custom-drawing": "Custom Drawing",
  "cherries-retro": "Cherries on a Retro Cake",
  "scattered-retro-pearls": "Scattered Retro Pearls",
  "gold-leaves-style": "Gold Leaves",
  "golden-cake": "Golden Cake",
  "pearl-number": "Pearl Number",
  "retro-ribbons-glitter": "Retro × Glitter in the Air",
  "butterfly-garden": "Butterfly Garden",
  "glitter-base": "Glitter Base",
  "gender-reveal": "Gender Reveal",
  "sprinkles-with-border": "Sprinkles with Border",
};
const sizeNameFr: Record<string, string> = {
  bento: "Bento Box", retro: "Retro Box", medium: "Moyen", large: "Large", rectangle: "Rectangle",
};

/* Courte explication affichee sous chaque boite */
const sizeDesc: Record<string, { en: string; fr: string }> = {
  bento: {
    en: "Classic bento box for minimal designs.",
    fr: "Boîte bento classique, idéale pour les designs minimalistes.",
  },
  retro: {
    en: "Square cake board, recommended for more detailed side decorations.",
    fr: "Socle carré, recommandé pour les designs avec des décorations plus travaillées sur les côtés.",
  },
};
const shapeNameFr: Record<string, string> = { round: "Rond", heart: "Cœur" };
const flavorNameFr: Record<string, string> = {
  "vanilla": "Vanilla",
  "red-velvet": "Red Velvet",
  "chocolate": "Chocolate",
  "chocolate-lovers": "Chocolate Lovers",
  "chocolate-lover-berrylicious": "Chocolate Lover x Berrylicious",
  "dark-berrylicious": "Dark Berrylicious",
  "white-berrylicious": "White Berrylicious",
  "salted-caramel": "Salted Butter Caramel",
  "lemon-curd": "Lemon Curd",
  "tiramisu": "Tiramisu",
  "praline": "Praline Obsession",
  "pistachio-lovers": "Pistachio Lovers",
  "passion-fruit": "Passion Fruit",
  "vanilla-gf": "Vanilla Gluten-free",
  "red-velvet-gf": "Red Velvet Gluten-free",
  "chocolate-gf": "Chocolate Gluten-free",
  "chocolate-gf-berrylicious": "Chocolate GF × Berrylicious",
  "vanilla-gf-berrylicious": "Vanilla GF × Berrylicious",
  "lemon-curd-gf": "Lemon Curd Gluten-free",
  "chocolate-lovers-gf": "Chocolate Lovers Gluten-free",
  "orange-blossom-gf": "Orange Blossom Gluten-free",
  "pistachio-gf": "Pistachio Gluten-free",
  "tiramisu-gf": "Tiramisu Gluten-free",
  "passion-fruit-gf": "Passion Fruit Gluten-free",
  "praline-gf": "Praline Gluten-free",
};
const extraNameFr: Record<string, string> = {
  "gold-leaves": "Feuilles d'or",
  "cherries": "Cerises",
  "glitter-cherries": "Cerises pailletées",
  "glitter": "Paillettes",
  "glitter-base": "Glitter Base",
  "glitter-in-the-air": "Paillettes dans l'air",
  "scattered-pearl": "Perles éparpillées",
  "pearl-border": "Bordure de perles (chacune)",
  "retro": "Rétro",
  "ribbons": "Rubans",
  "pearl-number": "Pearl Number",
  "butterfly": "Papillon",
  "sprinkles": "Vermicelles",
  "printed-picture": "Printed Picture",
};
const groupLabelFr: Record<string, string> = {
  "Decorations": "Décorations",
  "Pearls": "Perles",
  "Toppings": "Garnitures",
  "Glitter": "Paillettes",
  "Printed Picture": "Photo imprimée",
};
const secondaryLabelFr: Record<string, string> = {
  "Decoration Colour": "Couleur de décoration",
  "Border Colour": "Couleur de bordure",
  "Second Colour (optional)": "Deuxième couleur (optionnel)",
  "Choose Your Colours": "Choisissez vos couleurs",
  "Heart Colour": "Couleur du cœur",
};
const textStyleFr: Record<string, string> = {
  "Normal": "Normal", "UPPERCASE": "MAJUSCULES", "Cursive": "Cursive",
};
const colourFr: Record<string, string> = {
  "White": "Blanc",
  "Cream": "Crème",
  "Pastel Pink": "Rose Pastel",
  "Pink": "Rose",
  "Baby Pink": "Rose Bébé",
  "Dark Pink": "Rose Foncé",
  "Red": "Rouge",
  "Wine Red": "Rouge Vin",
  "Burgundy": "Bordeaux",
  "Pastel Yellow": "Jaune Pastel",
  "Yellow": "Jaune",
  "Pastel Orange": "Orange Pastel",
  "Orange": "Orange",
  "Pastel Green": "Vert Pastel",
  "Green": "Vert",
  "Forest Green": "Vert Forêt",
  "Pastel Blue": "Bleu Pastel",
  "Sky Blue": "Bleu Ciel",
  "Blue": "Bleu",
  "Midnight Blue": "Bleu Nuit",
  "Lavender": "Lavande",
  "Plum": "Prune",
  "Light Brown": "Brun Clair",
  "Dark Brown": "Brun Foncé",
  "Black": "Noir",
  "Gold": "Or",
};
const candleNameFr: Record<string, string> = {
  "blue-ombre": "Dégradé bleu",
  "thick-spiral": "Spirale épaisse",
  "pink-gold-spiral": "Spirale or rose",
  "silver-spiral": "Spirale argent",
  "gold-spiral": "Spirale or",
  "spiral-champagne": "Spirale champagne",
  "shiny-spiral": "Spirale brillante",
  "spiral-pastel": "Spirale pastel",
  "rainbow": "Arc-en-ciel",
  "pink-ombre": "Dégradé rose",
  "daisy": "Marguerite",
  "heart": "Cœur rouge",
  "puppy": "Chiot",
  "teddy-bear": "Nounours",
  "cherry": "Cerise",
  "ribbon": "Ruban",
  "soccer": "Ballon de foot",
  "pink-car": "Voiture rose",
  "red-car": "Voiture rouge",
  "blue-car": "Voiture bleue",
  "yellow-car": "Voiture jaune",
};
const extraDescFr: Record<string, string> = {
  "cherries": "Des cerises confites posées sur le gâteau.",
  "glitter-cherries": "Des cerises confites recouvertes de paillettes comestibles.",
  "sprinkles": "De petits vermicelles colorés parsemés sur le gâteau.",
  "gold-leaves": "De petits morceaux de feuille d'or comestible pour une touche de luxe.",
  "heart": "Des cœurs pochés sur le gâteau.",
  "ribbons": "Des rubans de satin décoratifs placés autour du gâteau.",
  "retro": "Un pochage de gâteau vintage.",
  "butterfly": "Des papillons comestibles posés sur le gâteau.",
  "scattered-pearl": "De petites perles comestibles éparpillées sur le gâteau.",
  "pearl-border": "Une bordure composée de petites perles comestibles.",
  "pearl-number": "Un chiffre réalisé avec des perles comestibles.",
  "glitter": "Des paillettes comestibles parsemées sur tout le gâteau pour un effet scintillant.",
  "glitter-base": "Des paillettes recouvrant le dessus du gâteau.",
  "glitter-in-the-air": "Soufflez sur le gâteau et les paillettes s'envolent.",
  "drawing": "Un dessin réalisé à la main sur le gâteau.",
  "printed-picture": "Une image imprimée comestible posée sur le gâteau.",
};

interface CatalogProps {
  /* Mode integre : on n'affiche que le panneau de personnalisation,
     par-dessus une autre page (la galerie Inspirations par exemple). */
  embedded?: boolean;
  inspirationIndex?: number | null;
  onEmbeddedClose?: () => void;
}

const bentoGallery = [
  bentoGallery1, bentoGallery2, bentoGallery3, bentoGallery4, bentoGallery5, bentoGallery6,
  bentoGallery7, bentoGallery8, bentoGallery9, bentoGallery10, bentoGallery11, bentoGallery12,
  bentoGallery13, bentoGallery14, bentoGallery15, bentoGallery16,
];

/* Bandeau de photos qui defilent, en bas de la page Bento Cakes */
const BentoGallery = () => {
  const { t } = useLang();
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: "left" | "right") => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollBy({ left: direction === "left" ? -288 : 288, behavior: "smooth" });
  };

  return (
    <section className="pb-20">
      <h2 className="font-sans text-2xl md:text-3xl text-center uppercase tracking-[0.105em] text-foreground mb-10">
        {t("Our Creations", "Nos créations")}
      </h2>
      <div className="relative">
        <button
          onClick={() => scroll("left")}
          aria-label={t("Previous", "Precedent")}
          className="absolute left-2 top-1/2 -translate-y-1/2 z-10 bg-background/90 hover:bg-background rounded-none p-2 shadow-md"
        >
          <ChevronLeft className="h-5 w-5 text-foreground" />
        </button>
        <div
          ref={scrollRef}
          className="flex gap-4 overflow-x-auto scroll-smooth px-4 sm:px-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {bentoGallery.map((photo, index) => (
            <div key={index} className="flex-shrink-0 w-64 h-64 overflow-hidden">
              <img
                src={photo}
                alt={`Bento Cake Studio creation ${index + 1}`}
                loading="lazy"
                className="w-full h-full object-cover"
              />
            </div>
          ))}
        </div>
        <button
          onClick={() => scroll("right")}
          aria-label={t("Next", "Suivant")}
          className="absolute right-2 top-1/2 -translate-y-1/2 z-10 bg-background/90 hover:bg-background rounded-none p-2 shadow-md"
        >
          <ChevronRight className="h-5 w-5 text-foreground" />
        </button>
      </div>
    </section>
  );
};


const CakeCardImage = ({ images, name }: { images: string[]; name: string }) => {
  const [idx, setIdx] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const handleEnter = () => {
    if (images.length <= 1) return;
    let i = 0;
    timer.current = setInterval(() => {
      i = (i + 1) % images.length;
      setIdx(i);
    }, 900);
  };
  const handleLeave = () => {
    if (timer.current) clearInterval(timer.current);
    setIdx(0);
  };
  return (
    <div
      className="aspect-square overflow-hidden bg-muted/30 relative cursor-pointer"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      {images.map((src, i) => (
        <img
          key={i}
          src={src}
          alt={name}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${i === idx ? "opacity-100" : "opacity-0"}`}
        />
      ))}
    </div>
  );
};

const Catalog = ({ embedded = false, inspirationIndex = null, onEmbeddedClose }: CatalogProps) => {
  const { addItem, cartOrderDate } = useCart();
  const { toast } = useToast();
  const { t } = useLang();
  const [selectedCake, setSelectedCake] = useState<typeof catalog[0] | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [searchParams] = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const commentFileInputRef = useRef<HTMLInputElement>(null);
  const [showAllCandles, setShowAllCandles] = useState(false);
  const [numberCandleDigit, setNumberCandleDigit] = useState("0");
  const [fullyBookedDates, setFullyBookedDates] = useState<Date[]>([]);
  const [selections, setSelections] = useState<CakeSelections>({
    orderDate: cartOrderDate ? new Date(cartOrderDate) : null,
    orderTime: "",
    size: "bento",
    shape: "round",
    flavor: "vanilla",
    baseColor: "",
    roseColor: "",
    decorationColors: [],
    wantsText: false,
    cakeText: "",
    textColor: "",
    textStyle: "normal",
    candles: [],
    printedImage: null,
    comment: "",
    commentImages: [],
    extras: [],
    ribbonColor: "",
    butterflyColor: "",
    genderColor: "",
    glitterColor: "",
    glitterCherriesColor: "",
    shagDesignPreference: 0,
  });

  // Fetch fully booked dates
  useEffect(() => {
    const fetchBookedDates = async () => {
      const { data, error } = await supabase.rpc('get_fully_booked_dates');
      if (!error && data) {
        setFullyBookedDates(data.map((d: { booked_date: string }) => new Date(d.booked_date)));
      }
    };
    fetchBookedDates();
  }, []);

  const handleSelectCake = (cake: typeof catalog[0]) => {
    setSelectedCake(cake);
    // Pick the first available size for this design
    const availableSizeIds = Object.keys(cake.stylePrice);
    const defaultSize = availableSizeIds.includes("bento") ? "bento" : availableSizeIds[0] || "bento";
    setSelections({
      orderDate: cartOrderDate ? new Date(cartOrderDate) : null,
      orderTime: "",
      size: defaultSize,
      shape: "round",
      flavor: "vanilla",
      baseColor: "",
      decorationColors: [],
      roseColor: "",
      wantsText: false,
      cakeText: "",
      textColor: "",
      textStyle: "normal",
      candles: [],
      printedImage: null,
      comment: "",
      commentImages: [],
      extras: [],
      ribbonColor: "",
      butterflyColor: "",
      genderColor: "",
      glitterColor: cake.styleId === "retro-ribbons-glitter" ? "pink" : "",
      glitterCherriesColor: "",
      shagDesignPreference: 0,
    });
    setSheetOpen(true);
  };

  // Candle helpers
  const handleCandleQuantityChange = (candleId: string, delta: number) =>
    setSelections((prev) => ({ ...prev, candles: changeSimpleCandleQty(prev.candles, candleId, delta) }));

  const getCandleUnitQuantity = (candleId: string) => getSimpleCandleQty(selections.candles, candleId);

  const getCandleTotalPrice = (candleId: string) => {
    const entry = selections.candles.find((c) => c.id === candleId);
    if (!entry) return 0;
    return priceCandleSelection(entry, candles.find((c) => c.id === candleId), candleId === NUMBER_CANDLE_ID);
  };

  const getTotalCandlesPrice = () => {
    return selections.candles.reduce((sum, entry) => sum + getCandleTotalPrice(entry.id), 0);
  };

  const colorCfg = getColorConfig(selectedCake?.styleId);
  const allowedExtras = selectedCake ? designAllowedExtras[selectedCake.styleId] : undefined;
  // Rectangle further restricts whatever the design already allows below —
  // on top of, never instead of, the per-design exclusion/allow-list: an
  // extra with no "rectangle" key in catalogExtras[].price is unavailable
  // for that size regardless of what the design itself would otherwise permit.
  const rectangleIncompatibleExtras = selections.size === "rectangle"
    ? catalogExtras.filter((e) => !("rectangle" in e.price)).map((e) => e.id)
    : [];
  const excludedExtras = colorCfg.hideExtras || (allowedExtras && allowedExtras.length === 0)
    ? catalogExtras.map((e) => e.id)
    : selectedCake
      ? [
          ...getExcludedExtras(selectedCake.styleId).filter(
            (id) => !allowedExtras || !allowedExtras.includes(id)
          ),
          ...rectangleIncompatibleExtras,
        ]
      : [];
  const extrasHiddenForDesign =
    colorCfg.hideExtras || (allowedExtras !== undefined && allowedExtras.length === 0);

  const handleToggleExtra = (extraId: string) => {
    const newExtras = selections.extras.includes(extraId)
      ? selections.extras.filter((e) => e !== extraId)
      : [...selections.extras, extraId];
    const updates: Partial<typeof selections> = { extras: newExtras };
    // Auto-select pink glitter for "Glitter in the Air"
    if (extraId === "glitter-in-the-air" && newExtras.includes("glitter-in-the-air")) {
      updates.glitterColor = "pink";
    }
    setSelections({ ...selections, ...updates });
  };

  const getExtraPriceForSize = (extra: typeof catalogExtras[0]) => {
    return extra.price[selections.size as keyof typeof extra.price] || 0;
  };

  const getTotalExtrasPrice = () => {
    return selections.extras.reduce((acc, extraId) => {
      const extra = catalogExtras.find(e => e.id === extraId);
      if (!extra) return acc;
      return acc + getExtraPriceForSize(extra);
    }, 0);
  };

  // Image upload helpers
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelections({ ...selections, printedImage: file });
    }
  };

  const removeImage = () => {
    setSelections({ ...selections, printedImage: null });
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Comment image upload helpers
  const handleCommentImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const remaining = 5 - selections.commentImages.length;
    if (remaining <= 0) {
      toast({
        title: t("Maximum 5 images", "Maximum 5 images"),
        description: t("You have already reached the maximum number of reference images.", "Vous avez déjà atteint le nombre maximum d'images de référence."),
        variant: "destructive",
      });
      if (commentFileInputRef.current) commentFileInputRef.current.value = "";
      return;
    }
    const oversizedFiles = files.filter(f => f.size > 5 * 1024 * 1024);
    if (oversizedFiles.length > 0) {
      toast({
        title: t("File too large", "Fichier trop volumineux"),
        description: t(`Each image must be under 5 MB. ${oversizedFiles.length} file(s) exceeded the limit.`, `Chaque image doit faire moins de 5 Mo. ${oversizedFiles.length} fichier(s) dépassent la limite.`),
        variant: "destructive",
      });
      if (commentFileInputRef.current) commentFileInputRef.current.value = "";
      return;
    }
    const accepted = files.slice(0, remaining);
    const rejected = files.length - accepted.length;
    setSelections({ ...selections, commentImages: [...selections.commentImages, ...accepted] });
    if (commentFileInputRef.current) commentFileInputRef.current.value = "";
    toast({
      title: t(`${accepted.length} image${accepted.length > 1 ? "s" : ""} added ✓`, `${accepted.length} image${accepted.length > 1 ? "s" : ""} ajoutée${accepted.length > 1 ? "s" : ""} ✓`),
      description: rejected > 0
        ? t(`${rejected} image(s) ignored (max 5 reached).`, `${rejected} image(s) ignorée(s) (maximum de 5 atteint).`)
        : t(`${selections.commentImages.length + accepted.length}/5 reference images.`, `${selections.commentImages.length + accepted.length}/5 images de référence.`),
    });
  };

  const removeCommentImage = (index: number) => {
    setSelections({
      ...selections,
      commentImages: selections.commentImages.filter((_, i) => i !== index),
    });
  };

  const getDisplayText = () => {
    if (!selections.cakeText) return "";
    switch (selections.textStyle) {
      case "uppercase":
        return selections.cakeText.toUpperCase();
      case "cursive":
        return selections.cakeText;
      default:
        return selections.cakeText;
    }
  };

  const calculatePrice = () => {
    if (!selectedCake) return 0;
    
    const sizeObj = sizes.find(s => s.id === selections.size);
    const shapeObj = shapes.find(s => s.id === selections.shape);
    const flavorObj = flavors.find(f => f.id === selections.flavor);
    
    const basePrice = sizeObj?.price || 40;
    const shapeExtra = shapeObj?.extraPrice[selections.size as keyof typeof shapeObj.extraPrice] || 0;
    const flavorExtra = flavorObj?.extraPrice[selections.size as keyof typeof flavorObj.extraPrice] || 0;
    const styleExtra = selectedCake.stylePrice[selections.size as keyof typeof selectedCake.stylePrice] || 0;
    const candlesTotal = getTotalCandlesPrice();
    const extrasTotal = getTotalExtrasPrice();
    
    return basePrice + shapeExtra + flavorExtra + styleExtra + candlesTotal + extrasTotal;
  };

  const handleAddToCart = () => {
    if (!selectedCake) return;

    const cfg = getColorConfig(selectedCake.styleId);

    if (!selections.orderDate) {
      toast({ title: t("Date required", "Date requise"), description: t("Please select a pickup/delivery date.", "Veuillez sélectionner une date de retrait ou de livraison."), variant: "destructive" });
      return;
    }

    if (cfg.showBase && !selections.baseColor) {
      toast({ title: t("Base Colour required", "Couleur de base requise"), description: t("Please select a base colour for your cake.", "Veuillez sélectionner une couleur de base pour votre gâteau."), variant: "destructive" });
      return;
    }

    if (cfg.secondaryLabel && !cfg.secondaryOptional && selections.decorationColors.length === 0) {
      toast({ title: t(`${cfg.secondaryLabel} required`, `${secondaryLabelFr[cfg.secondaryLabel] ?? cfg.secondaryLabel} requise`), description: t("Please select at least one colour for your cake.", "Veuillez sélectionner au moins une couleur pour votre gâteau."), variant: "destructive" });
      return;
    }

    if (selectedCake.styleId === "rainbow-cake" && (!selections.borderTopColor || !selections.borderBottomColor)) {
      toast({ title: t("Border colours required", "Couleurs de bordure requises"), description: t("Please choose a top and a bottom border colour.", "Veuillez choisir une couleur de bordure pour le haut et pour le bas."), variant: "destructive" });
      return;
    }

    if (cfg.roseColor && !selections.roseColor) {
      toast({ title: t("Roses Colour required", "Couleur des roses requise"), description: t("Please select a colour for your roses.", "Veuillez sélectionner une couleur pour vos roses."), variant: "destructive" });
      return;
    }

    if (selections.wantsText && !selections.textColor) {
      toast({ title: t("Text Colour required", "Couleur du texte requise"), description: t("Please select a colour for your text.", "Veuillez sélectionner une couleur pour votre texte."), variant: "destructive" });
      return;
    }

    if (selections.wantsText && !selections.cakeText.trim()) {
      toast({ title: t("Text message required", "Message requis"), description: t("Please enter your message.", "Veuillez saisir votre message."), variant: "destructive" });
      return;
    }

    if ((selectedCake.styleId === "printed-picture" || selections.extras.includes("printed-picture")) && !selections.printedImage) {
      toast({ title: t("Image required", "Image requise"), description: t("Please upload an image for your printed picture cake.", "Veuillez télécharger une image pour votre gâteau avec photo imprimée."), variant: "destructive" });
      return;
    }

    const designNeedsGlitter = ["retro-glitter-cake", "retro-ribbons-glitter"].includes(selectedCake?.styleId || "");
    if ((designNeedsGlitter || selections.extras.includes("glitter") || selections.extras.includes("glitter-base") || selections.extras.includes("glitter-in-the-air")) && !selections.glitterColor) {
      toast({ title: t("Glitter Colour required", "Couleur des paillettes requise"), description: t("Please select a colour for your glitter.", "Veuillez sélectionner une couleur pour vos paillettes."), variant: "destructive" });
      return;
    }

    const designNeedsGlitterCherries = selectedCake?.styleId === "glitter-cherries-retro";
    if ((designNeedsGlitterCherries || selections.extras.includes("glitter-cherries")) && !selections.glitterCherriesColor) {
      toast({ title: t("Glitter Cherries Colour required", "Couleur des cerises pailletées requise"), description: t("Please select a colour for your glitter cherries.", "Veuillez sélectionner une couleur pour vos cerises pailletées."), variant: "destructive" });
      return;
    }

    const designNeedsRibbon = selectedCake?.styleId === "retro-ribbons" || selectedCake?.styleId === "retro-ribbons-glitter";
    if ((designNeedsRibbon || selections.extras.includes("ribbons")) && !selections.ribbonColor) {
      toast({ title: t("Ribbon Colour required", "Couleur des rubans requise"), description: t("Please select a colour for your ribbons.", "Veuillez sélectionner une couleur pour vos rubans."), variant: "destructive" });
      return;
    }

    if (selectedCake?.styleId === "gender-reveal" && !selections.genderColor) {
      toast({ title: t("Inside colour required", "Couleur intérieure requise"), description: t("Please choose blue or pink for the inside of your cake.", "Veuillez choisir bleu ou rose pour l'intérieur de votre gâteau."), variant: "destructive" });
      return;
    }

    const designNeedsButterfly = selectedCake?.styleId === "butterfly-garden";
    if ((designNeedsButterfly || selections.extras.includes("butterfly")) && !selections.butterflyColor) {
      toast({ title: t("Butterfly Colour required", "Couleur du papillon requise"), description: t("Please select a colour for your butterfly.", "Veuillez sélectionner une couleur pour votre papillon."), variant: "destructive" });
      return;
    }
    
    const sizeObj = sizes.find(s => s.id === selections.size);
    const shapeObj = shapes.find(s => s.id === selections.shape);
    const flavorObj = flavors.find(f => f.id === selections.flavor);
    const genderWhite = selectedCake.styleId === "gender-reveal";
    const baseColorObj = baseColors.find(c => c.id === (genderWhite ? "white" : selections.baseColor));
    const decoColorNames = selections.decorationColors.map(id => baseColors.find(c => c.id === id)?.name || "").filter(Boolean);
    if (selectedCake.styleId === "rainbow-cake") {
      const topName = baseColors.find(c => c.id === selections.borderTopColor)?.name;
      const botName = baseColors.find(c => c.id === selections.borderBottomColor)?.name;
      if (topName) decoColorNames.push(`Top border: ${topName}`);
      if (botName) decoColorNames.push(`Bottom border: ${botName}`);
    }
    if (selectedCake.styleId === "gender-reveal") {
      const genderName = genderColors.find(c => c.id === selections.genderColor)?.name;
      if (genderName) decoColorNames.push(`Inside: ${genderName}`);
    }
    const roseColorName = selections.roseColor ? baseColors.find(c => c.id === selections.roseColor)?.name : "";
    if (roseColorName) decoColorNames.push(`Roses: ${roseColorName}`);
    const textColorObj = baseColors.find(c => c.id === selections.textColor);

    // Format the cake text according to style
    let finalText = selections.cakeText;
    if (selections.textStyle === "uppercase") {
      finalText = selections.cakeText.toUpperCase();
    }
    
    const extrasNames = selections.extras.map(id => catalogExtras.find(e => e.id === id)?.name || "");
    const selectedRibbonColor = ribbonColors.find(c => c.id === selections.ribbonColor);
    const selectedButterflyColor = butterflyColors.find(c => c.id === selections.butterflyColor);
    const candlesWithDigit = selections.candles.map((c) =>
      c.id === NUMBER_CANDLE_ID ? { ...c, digit: numberCandleDigit } : c
    );

    // Absolute URL of the catalogue design photo the customer chose. When
    // the design has several option photos, that's the exact one they
    // clicked (selections.shagDesignPreference — the same index behind the
    // "[Preferred design: Option N]" comment); otherwise it's the design's
    // single photo. null only for an inspiration cake, whose photo is a
    // client reference already carried in imageUrls, not a catalogue design.
    const chosenDesignImage =
      selectedCake.images && selectedCake.images.length > 1
        ? selectedCake.images[selections.shagDesignPreference] ?? selectedCake.images[0]
        : selectedCake.styleId === "inspiration"
          ? null
          : selectedCake.image || null;
    const designImageUrl = chosenDesignImage
      ? new URL(chosenDesignImage, window.location.origin).href
      : null;

    const added = addItem({
      id: "",
      product: selections.size === "rectangle" ? "rectangle_cake" : "bento_cake",
      orderDate: selections.orderDate ? format(selections.orderDate, "yyyy-MM-dd") : "",
      orderTime: "",
      size: selections.size,
      sizeName: sizeObj?.name || "",
      shape: selections.shape,
      shapeName: shapeObj?.name || "",
      flavor: selections.flavor,
      flavorName: flavorObj?.name || "",
      style: selectedCake.styleId,
      styleName: selectedCake.styleName,
      baseColor: genderWhite ? "white" : selections.baseColor,
      baseColorName: baseColorObj?.name || "",
      decorationColor: [...selections.decorationColors, ...(selections.roseColor ? [`roses-${selections.roseColor}`] : [])].join(", "),
      decorationColorName: decoColorNames.join(", "),
      cakeText: finalText,
      textColor: selections.textColor,
      textColorName: textColorObj?.name || "",
      textStyle: selections.textStyle,
      extras: selections.extras,
      extrasNames,
      ribbonColor: selections.ribbonColor,
      ribbonColorName: selectedRibbonColor?.name || "",
      butterflyColor: selections.butterflyColor,
      butterflyColorName: selectedButterflyColor?.name || "",
      glitterColorName: glitterColors.find(c => c.id === selections.glitterColor)?.name || "",
      glitterCherriesColorName: glitterCherriesColors.find(c => c.id === selections.glitterCherriesColor)?.name || "",
      candles: candlesWithDigit,
      comment: selectedCake.images && selectedCake.images.length > 1
        ? `[Preferred design: Option ${selections.shagDesignPreference + 1}]${selections.comment ? " " + selections.comment : ""}`
        : selections.comment,
      designImageUrl,
      imageUrls: selectedCake.styleId === "inspiration" ? [selectedCake.image] : [],
      imageFiles: [...selections.commentImages],
      total: calculatePrice(),
    });
    if (!added) {
      toast({
        title: t("Date mismatch", "Date incompatible"),
        description: t(
          "This item's date doesn't match the rest of your cart. Please place a separate order.",
          "La date de cet article ne correspond pas au reste de votre panier. Merci de passer une commande séparée."
        ),
        variant: "destructive",
      });
      return;
    }
    setSheetOpen(false);
    if (embedded) onEmbeddedClose?.();
    // Let the dialog finish its close animation before unmounting its content —
    // clearing it immediately can leave Radix's body pointer-events lock stuck.
    setTimeout(() => setSelectedCake(null), 350);
  };

  // Split candles into packs and individuals
  const packCandles = candles.filter(c => c.hasPack);
  const individualCandles = candles.filter(c => !c.hasPack);

  // Ouvre le panneau pour une photo d'inspiration donnee
  const openInspiration = (index: number) => {
    if (isNaN(index) || index < 0 || index >= inspirationItems.length) return;
    handleSelectCake({
      id: `inspiration-${index + 1}`,
      name: t(`Inspiration Cake #${index + 1}`, `Gâteau d'inspiration n°${index + 1}`),
      description: t("Based on the inspiration photo you selected", "D'après la photo d'inspiration que vous avez sélectionnée"),
      image: inspirationItems[index].src,
      styleId: "inspiration",
      styleName: `Inspiration #${index + 1}`,
      stylePrice: inspirationItems[index].price,
      disableText: false,
    } as (typeof catalog)[number]);
  };

  // Lien direct /catalog?inspiration=N
  useEffect(() => {
    if (embedded) return;
    const param = searchParams.get("inspiration");
    if (param === null) return;
    openInspiration(parseInt(param, 10));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mode integre : la page parente pilote l'ouverture
  useEffect(() => {
    if (!embedded) return;
    if (inspirationIndex === null || inspirationIndex === undefined) return;
    openInspiration(inspirationIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedded, inspirationIndex]);

  // Arrivee depuis l'accueil avec une ancre : on descend jusqu'a la section
  useEffect(() => {
    if (embedded) return;
    const ancre = window.location.hash.replace("#", "");
    if (!ancre) return;
    const cible = document.getElementById(ancre);
    if (cible) {
      requestAnimationFrame(() => cible.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  }, []);

  useEffect(() => {
    if (embedded) return;
    document.title = "Bento Cakes – Bento Cake Studio";
    return () => {
      document.title = "Bento Cake Studio Geneva";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sheetBlock = (
    <>
      {/* Catalog Sheet */}
      <TooltipProvider delayDuration={200}>
      <Sheet open={sheetOpen} onOpenChange={(open) => { setSheetOpen(open); if (!open && embedded) onEmbeddedClose?.(); }}>
        <SheetContent className="w-[95vw] max-w-3xl max-h-[88vh] overflow-y-auto rounded-none p-6 md:p-10">
          <SheetHeader>
            <SheetTitle className="font-sans uppercase tracking-[0.105em] text-lg font-semibold">
              {selectedCake ? t(selectedCake.name, cakeNameFr[selectedCake.id] ?? selectedCake.name) : ""}
            </SheetTitle>
            <SheetDescription>
              {t("Customise your cake options", "Personnalisez les options de votre gâteau")}
            </SheetDescription>
          </SheetHeader>
          
          {selectedCake && (
            <div className="mt-6 space-y-6">
              <div className="aspect-square w-full max-w-[300px] mx-auto rounded-none overflow-hidden bg-muted/30">
                <img
                  src={selectedCake.image}
                  alt={selectedCake.name}
                  className="w-full h-full object-cover"
                />
              </div>

              {/* Pickup Date Selection */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground flex items-center gap-1">
                  {t("Pickup Date", "Date de retrait")} <span className="text-destructive">*</span>
                  <Tooltip>
                    <TooltipTrigger asChild><Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" /></TooltipTrigger>
                    <TooltipContent><p className="text-xs max-w-[200px]">{t("Order preparation date (minimum 4 days in advance)", "Date de préparation de la commande (minimum 4 jours à l'avance)")}</p></TooltipContent>
                  </Tooltip>
                </label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      disabled={!!cartOrderDate}
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !selections.orderDate && "text-muted-foreground",
                        cartOrderDate && "opacity-60 cursor-not-allowed"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {selections.orderDate ? (
                        format(selections.orderDate, "dd.MM.yyyy")
                      ) : (
                        <span>{t("Pick a date", "Choisir une date")}</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={selections.orderDate || undefined}
                      onSelect={(date) => setSelections({ ...selections, orderDate: date || null })}
                      disabled={(date) => {
                        const minDate = addDays(new Date(), 4);
                        minDate.setHours(0, 0, 0, 0);
                        if (date < minDate) return true;
                        return fullyBookedDates.some(
                          (bookedDate) => bookedDate.toDateString() === date.toDateString()
                        );
                      }}
                      initialFocus
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
                {cartOrderDate && (
                  <p className="text-xs text-muted-foreground">
                    {t(
                      `All items in this order will be prepared for ${format(new Date(cartOrderDate), "dd.MM.yyyy")}. To order for another date, please place a separate order.`,
                      `Tous les articles de cette commande seront préparés pour le ${format(new Date(cartOrderDate), "dd.MM.yyyy")}. Pour commander pour une autre date, veuillez passer une commande séparée.`
                    )}
                  </p>
                )}
              </div>

              {/* Size Selection with box images */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground flex items-center gap-1">
                  {t("Size", "Taille")} <span className="text-destructive">*</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs max-w-[260px]">
                        {t("Choose the size of your cake.", "Choisissez la taille de votre gâteau.")}
                        <br />
                        {t(sizeInfoSummary.en, sizeInfoSummary.fr)}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </label>
                <Select
                  value={selections.size}
                  onValueChange={(value) => setSelections({ ...selections, size: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("Select size", "Choisir une taille")} />
                  </SelectTrigger>
                  <SelectContent className="w-[var(--radix-select-trigger-width)] max-w-[95vw]">
                    {sizes.filter((size) => selectedCake && size.id in selectedCake.stylePrice).map((size) => (
                      <SelectItem
                        key={size.id}
                        value={size.id}
                        itemText={`${t(size.name, sizeNameFr[size.id] ?? size.name)} - CHF ${size.price}`}
                      >
                        <div className="flex items-start gap-2 py-0.5 w-full">
                          <img src={size.image} alt={size.name} className="w-8 h-8 object-contain flex-shrink-0 mt-0.5" />
                          <div className="min-w-0 flex-1">
                            <span className="block">{t(size.name, sizeNameFr[size.id] ?? size.name)} - CHF {size.price}</span>
                            {sizeInfo[size.id] && (
                              <span className="block text-xs text-primary/80 whitespace-normal leading-snug mt-0.5">
                                {t(sizeInfo[size.id].en, sizeInfo[size.id].fr)}
                              </span>
                            )}
                            {sizeDesc[size.id] && (
                              <span className="block text-xs text-muted-foreground whitespace-normal leading-snug mt-0.5">
                                {t(sizeDesc[size.id].en, sizeDesc[size.id].fr)}
                              </span>
                            )}
                          </div>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Shape Selection */}
              {!["rectangle-signature","rectangle-raspberries","rectangle-flowers"].includes(selectedCake?.styleId ?? "") && shapes.filter(s => selections.size in s.extraPrice).length > 0 && <div className="space-y-2">
                <label className="text-sm font-medium text-foreground flex items-center gap-1">
                  {t("Shape", "Forme")} <span className="text-destructive">*</span>
                  <Tooltip>
                    <TooltipTrigger asChild><Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" /></TooltipTrigger>
                    <TooltipContent><p className="text-xs max-w-[200px]">{t("Choose the shape of your cake.", "Choisissez la forme de votre gâteau.")}</p></TooltipContent>
                  </Tooltip>
                </label>
                <Select
                  value={selections.shape}
                  onValueChange={(value) => setSelections({ ...selections, shape: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("Select shape", "Choisir une forme")} />
                  </SelectTrigger>
                  <SelectContent>
                    {shapes.filter((shape) => selections.size in shape.extraPrice).map((shape) => {
                      const extra = shape.extraPrice[selections.size as keyof typeof shape.extraPrice] || 0;
                      return (
                        <SelectItem key={shape.id} value={shape.id}>
                          {t(shape.name, shapeNameFr[shape.id] ?? shape.name)} {extra > 0 ? `(+CHF ${extra})` : ""}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>}

              {/* Flavor Selection */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground flex items-center gap-1">
                  {t("Flavour", "Parfum")} <span className="text-destructive">*</span>
                  <Tooltip>
                    <TooltipTrigger asChild><Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" /></TooltipTrigger>
                    <TooltipContent><p className="text-xs max-w-[200px]">{t("Please select the flavour of your cake.", "Veuillez sélectionner le parfum de votre gâteau.")}</p></TooltipContent>
                  </Tooltip>
                </label>
                {(() => {
                  const renderFlavorOption = (flavor: typeof flavors[number]) => {
                    const extra = flavor.extraPrice[selections.size as keyof typeof flavor.extraPrice] || 0;
                    const info = allergenMap[flavor.id];
                    return (
                      <SelectItem
                        key={flavor.id}
                        value={flavor.id}
                        itemText={`${t(flavor.name, flavorNameFr[flavor.id] ?? flavor.name)}${extra > 0 ? ` (+CHF ${extra})` : ""}`}
                      >
                        <div className="flex items-start gap-2">
                          <img src={flavor.image} alt={flavor.name} className="w-8 h-8 object-contain flex-shrink-0 mt-0.5" />
                          <div>
                          <span>{t(flavor.name, flavorNameFr[flavor.id] ?? flavor.name)} {extra > 0 ? `(+CHF ${extra})` : ""}</span>
                          {flavorDescMap[flavor.id] && (
                            <div className="text-[10px] text-foreground/70 leading-tight mt-0.5 whitespace-normal">
                              {t(flavorDescMap[flavor.id].en, flavorDescMap[flavor.id].fr)}
                            </div>
                          )}
                          {info && (
                            <div className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                              {info.warn && <span aria-hidden="true">⚠️ </span>}
                              <span className="font-medium">{t("Contains:", "Contient :")}</span> {t(info.en, info.fr)}
                            </div>
                          )}
                          </div>
                        </div>
                      </SelectItem>
                    );
                  };
                  return (
                    <Select
                      value={selections.flavor}
                      onValueChange={(value) => setSelections({ ...selections, flavor: value })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t("Select flavour", "Choisir un parfum")} />
                      </SelectTrigger>
                      <SelectContent nativeScroll>
                        <SelectGroup>
                          <SelectLabel>{t("Standard", "Standard")}</SelectLabel>
                          {standardFlavors.map(renderFlavorOption)}
                        </SelectGroup>
                        <SelectGroup>
                          <SelectLabel>{t("Premium", "Premium")}</SelectLabel>
                          {premiumFlavors.map(renderFlavorOption)}
                        </SelectGroup>
                        <SelectGroup>
                          <SelectLabel>{t("Deluxe", "Deluxe")}</SelectLabel>
                          {deluxeFlavors.map(renderFlavorOption)}
                        </SelectGroup>
                        <SelectGroup>
                          <SelectLabel>{t("Gluten-Free — Standard", "Sans Gluten — Standard")}</SelectLabel>
                          {glutenFreeStandardFlavors.map(renderFlavorOption)}
                        </SelectGroup>
                        <SelectGroup>
                          <SelectLabel>{t("Gluten-Free — Premium", "Sans Gluten — Premium")}</SelectLabel>
                          {glutenFreePremiumFlavors.map(renderFlavorOption)}
                        </SelectGroup>
                        <SelectGroup>
                          <SelectLabel>{t("Gluten-Free — Deluxe", "Sans Gluten — Deluxe")}</SelectLabel>
                          {glutenFreeDeluxeFlavors.map(renderFlavorOption)}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  );
                })()}
                <AllergenNotice className="pt-1" />
              </div>

              {/* Design Display */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground flex items-center gap-1">
                  {t("Design", "Design")}
                  <Tooltip>
                    <TooltipTrigger asChild><Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" /></TooltipTrigger>
                    <TooltipContent><p className="text-xs max-w-[220px]">{t("You can select any design. You can also add extras and/or inspiration pictures in the next steps.", "Vous pouvez choisir n'importe quel design. Vous pourrez aussi ajouter des extras et/ou des photos d'inspiration aux étapes suivantes.")}</p></TooltipContent>
                  </Tooltip>
                </label>
                <div className="bg-secondary/50 rounded-lg p-4">
                  <p className="font-medium text-foreground">{t(selectedCake.styleName, styleNameFr[selectedCake.styleId] ?? selectedCake.styleName)}</p>
                  <p className="text-sm text-primary mt-1">
                    +CHF {selectedCake.stylePrice[selections.size as keyof typeof selectedCake.stylePrice]}
                  </p>
                </div>
              </div>

              {/* Shag Cake Design Preference */}
              {selectedCake?.images && selectedCake.images.length > 1 && !["retro-vintage", "shag-cake", "printed-picture", "custom-drawing", "roses-please", "butterfly-garden", "gender-reveal"].includes(selectedCake.styleId) && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">{t("Choose your preferred design", "Choisissez votre design préféré")}</label>
                  <div className="grid grid-cols-2 gap-3">
                    {selectedCake.images.map((img, i) => (
                      <button
                        key={i}
                        onClick={() => setSelections(prev => ({ ...prev, shagDesignPreference: i }))}
                        className={cn(
                          "rounded-none overflow-hidden border-2 transition-all aspect-square",
                          selections.shagDesignPreference === i
                            ? "border-primary ring-2 ring-primary/30"
                            : "border-transparent hover:border-muted-foreground/30"
                        )}
                      >
                        <img src={img} alt={`Design option ${i + 1}`} className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Base Colour Selection */}
              {colorCfg.showBase && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground flex items-center gap-1">
                  {t("Base Colour", "Couleur de base")} <span className="text-destructive">*</span>
                  <Tooltip>
                    <TooltipTrigger asChild><Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" /></TooltipTrigger>
                    <TooltipContent><p className="text-xs max-w-[200px]">{t("The base colour is essential to personalise your cake.", "La couleur de base est essentielle pour personnaliser votre gâteau.")}</p></TooltipContent>
                  </Tooltip>
                </label>
                {colorCfg.baseNote && (
                  <p className="text-xs text-muted-foreground italic">{colorCfg.baseNote}</p>
                )}
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5 flex items-center gap-1.5">
                  <span>⚠️</span> {t("We recommend choosing light colours, as dark colours may temporarily stain lips.", "Nous vous recommandons de choisir des couleurs claires, car les couleurs foncées peuvent temporairement colorer les lèvres.")}
                </p>
                <div className="grid grid-cols-6 gap-2">
                  {baseColors.map((color) => (
                    <button
                      key={color.id}
                      onClick={() => setSelections({ ...selections, baseColor: color.id })}
                      className={cn(
                        "flex flex-col items-center gap-1 p-1 rounded-lg border transition-all",
                        selections.baseColor === color.id
                          ? "ring-2 ring-primary border-primary"
                          : "border-border hover:border-primary/50"
                      )}
                    >
                      <div
                        className={cn(
                          "w-6 h-6 rounded-full border",
                          color.id === "white" || color.id === "cream"
                            ? "border-muted-foreground/30"
                            : "border-transparent"
                        )}
                        style={{ backgroundColor: color.color }}
                      />
                      <span className="text-[10px] text-foreground text-center leading-tight truncate w-full">{t(color.name, colourFr[color.name] ?? color.name)}</span>
                    </button>
                  ))}
                </div>
              </div>
              )}

              {/* Secondary colour section, label and limit depend on the design */}
              {colorCfg.secondaryLabel && (() => {
                const maxColors = colorCfg.secondaryMax;
                return (
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground flex items-center gap-1">
                  {t(colorCfg.secondaryLabel, secondaryLabelFr[colorCfg.secondaryLabel] ?? colorCfg.secondaryLabel)} <span className="text-destructive cursor-help">
                    <Tooltip>
                      <TooltipTrigger asChild><span>*</span></TooltipTrigger>
                      <TooltipContent><p className="text-xs max-w-[200px]">{t(`Select up to ${maxColors} ${maxColors === 1 ? "colour" : "colours"} for your design.`, `Sélectionnez jusqu'à ${maxColors} ${maxColors === 1 ? "couleur" : "couleurs"} pour votre design.`)}</p></TooltipContent>
                    </Tooltip>
                  </span>
                  <Tooltip>
                    <TooltipTrigger asChild><Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" /></TooltipTrigger>
                    <TooltipContent><p className="text-xs max-w-[200px]">{t("Choose the colours for this part of your cake.", "Choisissez les couleurs pour cette partie de votre gâteau.")}</p></TooltipContent>
                  </Tooltip>
                </label>
                {maxColors > 1 && (
                <p className="text-xs text-muted-foreground">
                  {t(`You can choose up to ${maxColors} colours. You can also explain how you would like them to be arranged in the comment section.`, `Vous pouvez choisir jusqu'à ${maxColors} couleurs. Vous pouvez aussi préciser dans la zone de commentaire comment vous souhaitez qu'elles soient disposées.`)}
                </p>
                )}
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5 flex items-center gap-1.5">
                  <span>⚠️</span> {t("We recommend choosing light colours, as dark colours may temporarily stain lips.", "Nous vous recommandons de choisir des couleurs claires, car les couleurs foncées peuvent temporairement colorer les lèvres.")}
                </p>
                <div className="grid grid-cols-6 gap-2">
                  {baseColors.map((color) => {
                    const isSelected = selections.decorationColors.includes(color.id);
                    const isDisabled = !isSelected && selections.decorationColors.length >= maxColors;
                    return (
                    <button
                      key={color.id}
                      onClick={() => {
                        if (isSelected) {
                          setSelections({ ...selections, decorationColors: selections.decorationColors.filter(c => c !== color.id) });
                        } else if (!isDisabled) {
                          setSelections({ ...selections, decorationColors: [...selections.decorationColors, color.id] });
                        }
                      }}
                      disabled={isDisabled}
                      className={cn(
                        "flex flex-col items-center gap-1 p-1 rounded-lg border transition-all",
                        isSelected
                          ? "ring-2 ring-primary border-primary"
                          : isDisabled
                            ? "border-border opacity-40 cursor-not-allowed"
                            : "border-border hover:border-primary/50"
                      )}
                    >
                      <div
                        className={cn(
                          "w-6 h-6 rounded-full border",
                          color.id === "white" || color.id === "cream"
                            ? "border-muted-foreground/30"
                            : "border-transparent"
                        )}
                        style={{ backgroundColor: color.color }}
                      />
                      <span className="text-[10px] text-foreground text-center leading-tight truncate w-full">{t(color.name, colourFr[color.name] ?? color.name)}</span>
                    </button>
                    );
                  })}
                </div>
                {selections.decorationColors.length > 0 && (
                  <p className="text-xs text-primary font-medium">{selections.decorationColors.length}/{maxColors} {t("colours selected", "couleurs sélectionnées")}</p>
                )}
              </div>
                );
              })()}

              {/* Rose Colour, Roses Please only */}
              {colorCfg.roseColor && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground flex items-center gap-1">
                  {t("Roses Colour", "Couleur des roses")} <span className="text-destructive">*</span>
                  <Tooltip>
                    <TooltipTrigger asChild><Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" /></TooltipTrigger>
                    <TooltipContent><p className="text-xs max-w-[200px]">{t("Choose one colour for the piped roses.", "Choisissez une couleur pour les roses pochées.")}</p></TooltipContent>
                  </Tooltip>
                </label>
                <div className="grid grid-cols-6 gap-2">
                  {baseColors.map((color) => (
                    <button
                      key={color.id}
                      onClick={() => setSelections({ ...selections, roseColor: color.id })}
                      className={cn(
                        "flex flex-col items-center gap-1 p-1 rounded-lg border transition-all",
                        selections.roseColor === color.id
                          ? "ring-2 ring-primary border-primary"
                          : "border-border hover:border-primary/50"
                      )}
                    >
                      <div
                        className={cn(
                          "w-6 h-6 rounded-full border",
                          color.id === "white" || color.id === "cream"
                            ? "border-muted-foreground/30"
                            : "border-transparent"
                        )}
                        style={{ backgroundColor: color.color }}
                      />
                      <span className="text-[10px] text-foreground text-center leading-tight truncate w-full">{t(color.name, colourFr[color.name] ?? color.name)}</span>
                    </button>
                  ))}
                </div>
              </div>
              )}

              {/* Rainbow: top & bottom border colours */}
              {selectedCake?.styleId === "rainbow-cake" && (
                <div className="space-y-4">
                  {([
                    { key: "borderTopColor", label: t("Top Border Colour", "Couleur de la bordure du haut") },
                    { key: "borderBottomColor", label: t("Bottom Border Colour", "Couleur de la bordure du bas") },
                  ] as const).map(({ key, label }) => (
                    <div key={key} className="space-y-2">
                      <label className="text-sm font-medium text-foreground flex items-center gap-1">
                        {label} <span className="text-destructive">*</span>
                      </label>
                      <div className="grid grid-cols-6 gap-2">
                        {baseColors.map((color) => (
                          <button
                            key={color.id}
                            onClick={() => setSelections({ ...selections, [key]: color.id })}
                            className={cn(
                              "flex flex-col items-center gap-1 p-1 rounded-lg border transition-all",
                              selections[key] === color.id
                                ? "ring-2 ring-primary border-primary"
                                : "border-border hover:border-primary/50"
                            )}
                          >
                            <div
                              className={cn(
                                "w-6 h-6 rounded-full border",
                                color.id === "white" || color.id === "cream"
                                  ? "border-muted-foreground/30"
                                  : "border-transparent"
                              )}
                              style={{ backgroundColor: color.color }}
                            />
                            <span className="text-[10px] text-foreground text-center leading-tight truncate w-full">{t(color.name, colourFr[color.name] ?? color.name)}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Text Toggle - hidden for printed-picture */}
              {!selectedCake?.disableText && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground flex items-center gap-1">
                  {t("Add Text", "Ajouter un texte")}
                  <Tooltip>
                    <TooltipTrigger asChild><Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" /></TooltipTrigger>
                    <TooltipContent><p className="text-xs max-w-[220px]">{t("If you would like to add text, you can choose the typography.", "Si vous souhaitez ajouter un texte, vous pouvez choisir la typographie.")}</p></TooltipContent>
                  </Tooltip>
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setSelections({ ...selections, wantsText: false, cakeText: "", textColor: "", textStyle: "normal" })}
                    className={cn(
                      "flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all",
                      !selections.wantsText
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    )}
                  >
                    {t("No Text", "Sans texte")}
                  </button>
                  <button
                    onClick={() => setSelections({ ...selections, wantsText: true })}
                    className={cn(
                      "flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all",
                      selections.wantsText
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    )}
                  >
                    {t("Add Text", "Ajouter un texte")}
                  </button>
                </div>
              </div>
              )}

              {selections.wantsText && (
                <>
                  {/* Text Style Selection */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">{t("Text Style", "Style du texte")}</label>
                    <div className="flex gap-2">
                      {textStyles.map((style) => (
                        <button
                          key={style.id}
                          onClick={() => setSelections({ ...selections, textStyle: style.id })}
                          className={cn(
                            "flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all",
                            selections.textStyle === style.id
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground hover:bg-muted/80",
                            style.id === "cursive" && "font-normal",
                          )}
                          style={style.id === "cursive" ? { fontFamily: "'Dancing Script', cursive" } : undefined}
                        >
                          {t(style.name, textStyleFr[style.name] ?? style.name)}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Text Input */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">{t("Your Message", "Votre message")}</label>
                    <input
                      type="text"
                      value={selections.cakeText}
                      onChange={(e) => setSelections({ ...selections, cakeText: e.target.value })}
                      placeholder={t("e.g., Happy Birthday!", "ex. Joyeux anniversaire !")}
                      maxLength={30}
                      className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    <p className="text-xs text-muted-foreground text-right">{selections.cakeText.length}/30</p>
                    {/* Live text preview */}
                    {selections.cakeText && (
                      <div className="bg-muted/30 rounded-lg p-3 text-center">
                        <p className="text-xs text-muted-foreground mb-1">{t("Preview:", "Aperçu :")}</p>
                        <p
                          className={cn(
                            "text-lg text-foreground",
                            selections.textStyle === "cursive" ? "" : "font-medium"
                          )}
                          style={selections.textStyle === "cursive" ? { fontFamily: "'Dancing Script', cursive", fontSize: "1.25rem" } : undefined}
                        >
                          {getDisplayText()}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Text Colour Selection */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">{t("Text Colour", "Couleur du texte")}</label>
                    <div className="grid grid-cols-6 gap-2">
                      {baseColors.map((color) => (
                        <button
                          key={color.id}
                          onClick={() => setSelections({ ...selections, textColor: color.id })}
                          className={cn(
                            "flex flex-col items-center gap-1 p-1 rounded-lg border transition-all",
                            selections.textColor === color.id
                              ? "ring-2 ring-primary border-primary"
                              : "border-border hover:border-primary/50"
                          )}
                        >
                          <div
                            className={cn(
                              "w-6 h-6 rounded-full border",
                              color.id === "white" || color.id === "cream"
                                ? "border-muted-foreground/30"
                                : "border-transparent"
                            )}
                            style={{ backgroundColor: color.color }}
                          />
                          <span className="text-[10px] text-foreground text-center leading-tight truncate w-full">{t(color.name, colourFr[color.name] ?? color.name)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
               )}

              {/* Extras Section */}
              <div className="space-y-3">
                {!extrasHiddenForDesign && (
                <label className="text-sm font-medium text-foreground flex items-center gap-1">
                  ✨ {t("Extra", "Extras")}
                  <Tooltip>
                    <TooltipTrigger asChild><Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" /></TooltipTrigger>
                    <TooltipContent><p className="text-xs max-w-[220px]">{t("You can add any additional elements to personalise your design.", "Vous pouvez ajouter tous les éléments supplémentaires que vous souhaitez pour personnaliser votre design.")}</p></TooltipContent>
                  </Tooltip>
                </label>
                )}
                {!extrasHiddenForDesign && extraGroups.map((group) => {
                  const visibleExtras = group.ids
                    .map(id => catalogExtras.find(e => e.id === id))
                    .filter((extra): extra is typeof catalogExtras[0] => !!extra && !excludedExtras.includes(extra.id))
                    .filter(extra => !allowedExtras || allowedExtras.includes(extra.id))
                    .filter(extra => {
                      const price = extra.price[selections.size as keyof typeof extra.price];
                      return price !== undefined && price > 0;
                    });
                  if (visibleExtras.length === 0) return null;
                  return (
                    <div key={group.label} className="space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t(group.label, groupLabelFr[group.label] ?? group.label)}</p>
                      <div className="grid grid-cols-2 gap-2">
                        {visibleExtras.map((extra) => {
                          const isSelected = selections.extras.includes(extra.id);
                          const price = getExtraPriceForSize(extra);
                          return (
                            <button
                              key={extra.id}
                              onClick={() => handleToggleExtra(extra.id)}
                              className={cn(
                                "flex items-center gap-2 p-2 rounded-lg border transition-all text-left",
                                isSelected
                                  ? "ring-2 ring-primary border-primary bg-secondary/50"
                                  : "border-border hover:border-primary/50"
                              )}
                            >
                              <ExtraImageLightbox src={extra.image} alt={extra.name} className="w-10 h-10 object-cover rounded flex-shrink-0" />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1">
                                  <p className="text-xs font-medium text-foreground truncate">{extra.id === "pearl-border" && selectedCake?.styleId === "retro-ribbons-glitter" ? t("Full border of pearls", "Bordure complète de perles") : t(extra.name, extraNameFr[extra.id] ?? extra.name)}</p>
                                  {extraDescriptions[extra.id] && (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Info className="w-3 h-3 text-muted-foreground cursor-help flex-shrink-0" />
                                      </TooltipTrigger>
                                      <TooltipContent side="top">
                                        <p className="text-xs max-w-[200px]">{t(extraDescriptions[extra.id], extraDescFr[extra.id] ?? extraDescriptions[extra.id])}</p>
                                      </TooltipContent>
                                    </Tooltip>
                                  )}
                                </div>
                                <p className="text-[10px] text-primary">+CHF {price}</p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}

                {/* Glitter Colour */}
                {(selections.extras.includes("glitter") || selections.extras.includes("glitter-base") || selections.extras.includes("glitter-in-the-air") || ["retro-glitter-cake", "retro-ribbons-glitter"].includes(selectedCake?.styleId || "")) && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-foreground">{t("Glitter Colour", "Couleur des paillettes")} <span className="text-destructive">*</span></p>
                    <div className="flex flex-wrap gap-2">
                      {(() => {
                        const isGlitterInTheAir = selections.extras.includes("glitter-in-the-air") || selectedCake?.styleId === "retro-ribbons-glitter";
                        const availableColors = isGlitterInTheAir ? glitterColors.filter(c => c.id === "pink") : glitterColors;
                        return availableColors.map((color) => (
                          <button
                            key={color.id}
                            onClick={() => setSelections({ ...selections, glitterColor: color.id })}
                            className={cn(
                              "flex flex-col items-center gap-1 p-1 rounded-lg transition-all",
                              selections.glitterColor === color.id ? "ring-2 ring-primary" : ""
                            )}
                          >
                            <div className={cn("w-6 h-6 rounded-full border", color.id === "white" ? "border-muted-foreground/30" : "border-transparent")} style={{ backgroundColor: color.color }} />
                            <span className="text-[10px] text-foreground">{t(color.name, colourFr[color.name] ?? color.name)}</span>
                          </button>
                        ));
                      })()}
                    </div>
                  </div>
                )}

                {/* Glitter Cherries Colour */}
                {(selections.extras.includes("glitter-cherries") || selectedCake?.styleId === "glitter-cherries-retro") && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-foreground">{t("Glitter Cherries Colour", "Couleur des cerises pailletées")}</p>
                    <div className="flex flex-wrap gap-2">
                      {glitterCherriesColors.map((color) => (
                        <button
                          key={color.id}
                          onClick={() => setSelections({ ...selections, glitterCherriesColor: color.id })}
                          className={cn(
                            "flex flex-col items-center gap-1 p-1 rounded-lg transition-all",
                            selections.glitterCherriesColor === color.id ? "ring-2 ring-primary" : ""
                          )}
                        >
                          <div className={cn("w-6 h-6 rounded-full border", color.id === "white" ? "border-muted-foreground/30" : "border-transparent")} style={{ backgroundColor: color.color }} />
                          <span className="text-[10px] text-foreground">{t(color.name, colourFr[color.name] ?? color.name)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Ribbon Colour */}
                {(selections.extras.includes("ribbons") || selectedCake?.styleId === "retro-ribbons" || selectedCake?.styleId === "retro-ribbons-glitter") && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-foreground">{t("Ribbon Colour", "Couleur des rubans")} <span className="text-destructive">*</span></p>
                    <div className="flex flex-wrap gap-2">
                      {ribbonColors.map((color) => (
                        <button
                          key={color.id}
                          onClick={() => setSelections({ ...selections, ribbonColor: color.id })}
                          className={cn(
                            "flex flex-col items-center gap-1 p-1 rounded-lg transition-all",
                            selections.ribbonColor === color.id ? "ring-2 ring-primary" : ""
                          )}
                        >
                          <div className={cn("w-6 h-6 rounded-full border", color.id === "white" ? "border-muted-foreground/30" : "border-transparent")} style={{ backgroundColor: color.color }} />
                          <span className="text-[10px] text-foreground">{t(color.name, colourFr[color.name] ?? color.name)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Gender Reveal, couleur interieure */}
                {selectedCake?.styleId === "gender-reveal" && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-foreground">{t("Inside Colour", "Couleur intérieure")} <span className="text-destructive">*</span></p>
                    <div className="flex flex-wrap gap-2">
                      {genderColors.map((color) => (
                        <button
                          key={color.id}
                          onClick={() => setSelections({ ...selections, genderColor: color.id })}
                          className={cn(
                            "flex flex-col items-center gap-1 p-1 rounded-lg transition-all",
                            selections.genderColor === color.id ? "ring-2 ring-primary" : ""
                          )}
                        >
                          <div className="w-6 h-6 rounded-full border border-muted" style={{ backgroundColor: color.color }} />
                          <span className="text-[10px] text-foreground">{t(color.name, colourFr[color.name] ?? color.name)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Butterfly Colour */}
                {(selections.extras.includes("butterfly") || selectedCake?.styleId === "butterfly-garden") && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-foreground">{t("Butterfly Colour", "Couleur du papillon")} <span className="text-destructive">*</span></p>
                    <div className="flex flex-wrap gap-2">
                      {butterflyColors.map((color) => (
                        <button
                          key={color.id}
                          onClick={() => setSelections({ ...selections, butterflyColor: color.id })}
                          className={cn(
                            "flex flex-col items-center gap-1 p-1 rounded-lg transition-all",
                            selections.butterflyColor === color.id ? "ring-2 ring-primary" : ""
                          )}
                        >
                          <div className="w-6 h-6 rounded-full border border-muted" style={{ backgroundColor: color.color }} />
                          <span className="text-[10px] text-foreground">{t(color.name, colourFr[color.name] ?? color.name)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

               {/* Printed Picture Upload - for printed-picture style or extra */}
              {(selectedCake?.styleId === "printed-picture" || selections.extras.includes("printed-picture")) && (
                <div className="space-y-3">
                  <label className="text-sm font-medium text-foreground">{t("Upload Your Image", "Téléchargez votre image")}</label>
                  <p className="text-xs text-muted-foreground">
                    {t("Upload the image or logo you want printed on your cake (JPG, PNG, WEBP)", "Téléchargez l'image ou le logo que vous souhaitez faire imprimer sur votre gâteau (JPG, PNG, WEBP)")}
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handleImageUpload}
                    className="hidden"
                  />
                  {!selections.printedImage ? (
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full border-2 border-dashed border-border rounded-lg p-6 flex flex-col items-center gap-2 hover:border-primary/50 transition-colors"
                    >
                      <Upload className="w-8 h-8 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">{t("Click to upload image", "Cliquez pour télécharger une image")}</span>
                    </button>
                  ) : (
                    <div className="relative">
                      <img
                        src={URL.createObjectURL(selections.printedImage)}
                        alt="Uploaded preview"
                        className="w-full h-32 object-contain rounded-lg bg-muted/30"
                      />
                      <button
                        onClick={removeImage}
                        className="absolute top-2 right-2 bg-destructive text-destructive-foreground rounded-none p-1 hover:bg-destructive/80"
                      >
                        <X className="w-4 h-4" />
                      </button>
                      <p className="text-xs text-muted-foreground mt-1 truncate">{selections.printedImage.name}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Comment & Image Upload Section */}
              <div className="space-y-3">
                <label className="text-sm font-medium text-foreground flex items-center gap-1">
                  💬 {t("Comment", "Commentaire")}
                  <Tooltip>
                    <TooltipTrigger asChild><Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" /></TooltipTrigger>
                    <TooltipContent><p className="text-xs max-w-[240px]">{t("Write any guidelines you would like to clarify. Please note that if you request decorations or extras that were not selected, the price may change.", "Notez toutes les précisions que vous souhaitez apporter. Veuillez noter que si vous demandez des décorations ou des extras qui n'ont pas été sélectionnés, le prix peut changer.")}</p></TooltipContent>
                  </Tooltip>
                </label>
                <Textarea
                  value={selections.comment}
                  onChange={(e) => setSelections({ ...selections, comment: e.target.value })}
                  placeholder={t("Any special requests or details about your cake...", "Toute demande particulière ou tout détail concernant votre gâteau...")}
                  className="min-h-[80px]"
                />
                {selectedCake?.styleId !== "printed-picture" && (
                <div>
                  <label className="text-xs font-medium text-foreground flex items-center gap-1 mb-2">
                    {t("Upload", "Télécharger")}
                    <Tooltip>
                      <TooltipTrigger asChild><Info className="w-3 h-3 text-muted-foreground cursor-help" /></TooltipTrigger>
                      <TooltipContent><p className="text-xs max-w-[200px]">{t("Upload an inspiration picture if you would like.", "Téléchargez une photo d'inspiration si vous le souhaitez.")}</p></TooltipContent>
                    </Tooltip>
                  </label>
                  <p className="text-xs text-muted-foreground mb-2">
                    {t("Upload reference images (max 5, 5 MB per image, JPG, PNG, WEBP)", "Téléchargez des images de référence (max. 5, 5 Mo par image, JPG, PNG, WEBP)")}
                  </p>
                  <input
                    ref={commentFileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    onChange={handleCommentImageUpload}
                    className="hidden"
                  />
                  {selections.commentImages.length < 5 && (
                    <button
                      onClick={() => commentFileInputRef.current?.click()}
                      className="w-full border-2 border-dashed border-border rounded-lg p-4 flex flex-col items-center gap-1 hover:border-primary/50 transition-colors"
                    >
                      <Upload className="w-6 h-6 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">{t("Click to upload images", "Cliquez pour télécharger des images")}</span>
                    </button>
                  )}
                  {selections.commentImages.length > 0 && (
                    <>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {selections.commentImages.map((file, index) => (
                          <div key={index} className="relative w-16 h-16">
                            <img
                              src={URL.createObjectURL(file)}
                              alt={`Reference ${index + 1}`}
                              className="w-full h-full object-cover rounded-lg"
                            />
                            <button
                              onClick={() => removeCommentImage(index)}
                              className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-none p-0.5 hover:bg-destructive/80"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                      <p className="text-[10px] text-muted-foreground/80 italic mt-2 leading-tight">
                        {t("When a client provides an inspiration photo, it is for reference only. Bento Cake Studio SNC will create a design inspired by it and aim to respect the colours and style, but an identical reproduction is not guaranteed.", "Lorsqu'une cliente fournit une photo d'inspiration, celle-ci sert uniquement de référence. Bento Cake Studio SNC créera un design inspiré de cette photo en veillant à en respecter les couleurs et le style, mais une reproduction à l'identique n'est pas garantie.")}
                      </p>
                    </>
                  )}
                </div>
                )}
              </div>

              {/* Candles Section - Packs first, then individual */}
              <div className="space-y-3 p-4">
                <label className="text-sm font-medium text-foreground">🕯️ {t("Candles (Optional)", "Bougies (optionnel)")}</label>
                
                {/* All candles in one ordered list */}
                <div className="space-y-2">
                  <div className="flex flex-wrap justify-center gap-3">
                    {candles.slice(0, showAllCandles ? undefined : 4).map((candle) => {
                      const family = FAMILY_CANDLE_COLORS[candle.id];
                      if (family) {
                        return (
                          <div key={candle.id} className="w-[calc(50%-6px)] min-w-0">
                            <ColorFamilyCandleCard
                              candle={candle}
                              colors={family}
                              existing={selections.candles.find((c) => c.id === candle.id)}
                              onCommit={(entry) => setSelections((prev) => ({ ...prev, candles: upsertCandleSelection(prev.candles, entry) }))}
                              onRemove={() => setSelections((prev) => ({ ...prev, candles: removeCandleSelection(prev.candles, candle.id) }))}
                              imageClassName="h-24 w-24"
                              compact
                            />
                          </div>
                        );
                      }

                      const unitQty = getCandleUnitQuantity(candle.id);
                      const totalPrice = getCandleTotalPrice(candle.id);
                      const isPackApplied = candle.hasPack && unitQty >= (candle.packSize || 6);

                      return (
                        <div key={candle.id} className="w-[calc(50%-6px)] min-w-0">
                          <div className={cn("w-full flex flex-col overflow-hidden rounded-lg bg-white/60 hover:bg-white/80 transition-all", unitQty > 0 && "ring-2 ring-primary")}>
                          <div className="flex items-center justify-center bg-secondary/20 p-2">
                            <img src={candle.image} alt={candle.name} className="h-32 w-32 object-contain" />
                          </div>
                          <div className="p-2 text-center">
                            <p className="text-xs font-medium text-foreground">{t(candle.name, candleNameFr[candle.id] ?? candle.name)}</p>
                            {candle.hasPack ? (
                              <p className="text-[10px] text-muted-foreground mb-1">CHF {candle.unitPrice}{t("/ea", "/pièce")} · {t("Pack", "Pack")} {candle.packSize} = CHF {candle.packPrice}</p>
                            ) : (
                              <p className="text-[10px] text-muted-foreground mb-1">CHF {candle.unitPrice} {t("each", "/ pièce")}</p>
                            )}
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                onClick={() => handleCandleQuantityChange(candle.id, -1)}
                                disabled={unitQty === 0}
                                className={cn(
                                  "w-6 h-6 rounded-none flex items-center justify-center text-xs font-bold transition-all",
                                  unitQty === 0
                                    ? "bg-muted text-muted-foreground cursor-not-allowed"
                                    : "bg-primary text-primary-foreground hover:bg-primary/90"
                                )}
                              >−</button>
                              <span className="w-5 text-center font-medium text-foreground text-sm">{unitQty}</span>
                              <button
                                onClick={() => handleCandleQuantityChange(candle.id, 1)}
                                className="w-6 h-6 rounded-none bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold hover:bg-primary/90 transition-all"
                              >+</button>
                            </div>
                            {isPackApplied && (
                              <p className="text-[10px] text-primary font-semibold mt-1">✓ {t("Pack applied", "Pack appliqué")}</p>
                            )}
                            {totalPrice > 0 && (
                              <p className="text-[10px] text-primary font-medium mt-0.5">+CHF {totalPrice}</p>
                            )}
                          </div>
                          </div>
                        </div>
                      );
                    })}

                    {/* Number Candle — digit picker, no product photo, flat rate */}
                    <div className="w-[calc(50%-6px)] min-w-0">
                      <div className={cn("w-full flex flex-col overflow-hidden rounded-lg bg-white/60 hover:bg-white/80 transition-all", getCandleUnitQuantity(NUMBER_CANDLE_ID) > 0 && "ring-2 ring-primary")}>
                      <div className="h-32 flex items-center justify-center bg-secondary/20 p-2">
                        <span className="text-4xl font-bold text-primary" aria-hidden="true">{numberCandleDigit}</span>
                      </div>
                      <div className="p-2 text-center">
                        <p className="text-xs font-medium text-foreground">{t("Number Candle", "Bougie chiffre")}</p>
                        <p className="text-[10px] text-muted-foreground mb-1">CHF {NUMBER_CANDLE_PRICE} {t("each", "/ pièce")}</p>
                        <Select value={numberCandleDigit} onValueChange={setNumberCandleDigit}>
                          <SelectTrigger className="h-7 text-xs mb-1.5" aria-label={t("Choose a digit", "Choisir un chiffre")}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {NUMBER_CANDLE_DIGITS.map((digit) => (
                              <SelectItem key={digit} value={digit}>{digit}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => handleCandleQuantityChange(NUMBER_CANDLE_ID, -1)}
                            disabled={getCandleUnitQuantity(NUMBER_CANDLE_ID) === 0}
                            className={cn(
                              "w-6 h-6 rounded-none flex items-center justify-center text-xs font-bold transition-all",
                              getCandleUnitQuantity(NUMBER_CANDLE_ID) === 0
                                ? "bg-muted text-muted-foreground cursor-not-allowed"
                                : "bg-primary text-primary-foreground hover:bg-primary/90"
                            )}
                          >−</button>
                          <span className="w-5 text-center font-medium text-foreground text-sm">{getCandleUnitQuantity(NUMBER_CANDLE_ID)}</span>
                          <button
                            onClick={() => handleCandleQuantityChange(NUMBER_CANDLE_ID, 1)}
                            className="w-6 h-6 rounded-none bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold hover:bg-primary/90 transition-all"
                          >+</button>
                        </div>
                        {getCandleUnitQuantity(NUMBER_CANDLE_ID) > 0 && (
                          <p className="text-[10px] text-primary font-medium mt-0.5">+CHF {getCandleTotalPrice(NUMBER_CANDLE_ID)}</p>
                        )}
                      </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* See more / See less toggle */}
                <button
                  onClick={() => setShowAllCandles(!showAllCandles)}
                  className="w-full flex items-center justify-center gap-1 text-xs text-primary font-medium py-2 hover:underline"
                >
                  {showAllCandles ? (
                    <>{t("See less", "Voir moins")} <ChevronUp className="w-3 h-3" /></>
                  ) : (
                    <>{t("See more", "Voir plus")} <ChevronDown className="w-3 h-3" /></>
                  )}
                </button>
              </div>

              {/* Price */}
              <div className="flex justify-between items-center py-4 bg-secondary/50 rounded-lg px-4">
                <span className="font-medium text-foreground">{t("Total", "Total")}</span>
                <span className="text-xl font-bold text-primary">
                  CHF {calculatePrice()}
                </span>
              </div>

              <Button
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground py-2.5 text-lg rounded-none"
                onClick={handleAddToCart}
              >
                <ShoppingBag className="w-5 h-5 mr-2" />
                {t("Add to Cart", "Ajouter au panier")}
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
      </TooltipProvider>
    </>
  );

  if (embedded) return sheetBlock;

  return (
    <Layout>
      <div className="container mx-auto px-4 py-16">
        <h1 className="font-sans text-4xl md:text-5xl text-center tracking-[0.105em] uppercase text-foreground mb-6 font-semibold">
          BENTO CAKES
        </h1>
        <p className="text-center text-muted-foreground mb-16 max-w-2xl mx-auto">
          {t("Choose a signature design and personalise the size, flavour, colours and message.", "Découvrez nos créations signature, choisissez votre design préféré et personnalisez chaque détail pour créer un gâteau à votre image.")}
        </p>

        <div className="max-w-6xl mx-auto space-y-20">
          {collections.map((collection) => {
            const cakes = collection.ids
              .map((id) => catalog.find((c) => c.id === id))
              .filter(Boolean) as typeof catalog;
            if (cakes.length === 0) return null;
            return (
              <section key={collection.title} id={collection.anchor}>
                <div className="bg-primary text-primary-foreground uppercase tracking-[0.105em] text-sm font-medium px-6 py-2.5 mb-10">
                  {t(collection.title, collectionTitleFr[collection.title] ?? collection.title)}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                  {cakes.map((cake) => (
                    <div
                      key={cake.id}
                      className="relative rounded-none overflow-hidden border border-transparent hover:border-foreground/25 transition-colors duration-300 flex flex-col"
                    >
                      {(cake as any).bestSeller && (
                        <span className="absolute top-3 right-3 z-20 bg-primary text-cream text-[10px] font-semibold uppercase tracking-[0.14em] px-3 py-1.5 shadow-sm">
                          {t("Best Seller", "Best-seller")}
                        </span>
                      )}
                      {cake.images && cake.images.length > 1 ? (
                        <CakeCardImage images={cake.images} name={cake.name} />
                      ) : (
                        <div className="aspect-square overflow-hidden bg-muted/30">
                          <img
                            src={cake.image}
                            alt={cake.name}
                            className={cn("w-full h-full object-cover hover:scale-105 transition-transform duration-300", cake.imagePosition)}
                          />
                        </div>
                      )}
                      <div className="p-6 text-center flex flex-col flex-1">
                        <h3 className="font-sans text-[13px] tracking-[0.105em] font-semibold uppercase text-foreground mb-2">
                          {t(cake.name, cakeNameFr[cake.id] ?? cake.name)}
                        </h3>
                        <p className="text-muted-foreground text-sm mb-2 flex-1">
                          {t(cake.description, cakeDescFr[cake.id] ?? cake.description)}
                        </p>
                        {(cake as any).priceRange && (
                          <p className="text-xs font-light tracking-[0.12em] text-primary uppercase mb-4">
                            {(cake as any).priceRange}
                          </p>
                        )}
                        <div className="mt-auto">
                          <Button
                            className="rounded-none bg-primary hover:bg-primary/90 text-primary-foreground tracking-[0.105em] px-8"
                            onClick={() => handleSelectCake(cake)}
                          >
                            {t("CHOOSE THIS STYLE", "CHOISIR CE MODÈLE")}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}

          {/* Custom Request */}
          <section>
            <div className="bg-primary text-primary-foreground uppercase tracking-[0.105em] text-sm font-medium px-6 py-2.5 mb-10">
              {t("CUSTOM REQUEST", "CRÉATION SUR MESURE")}
            </div>
            <div className="text-center max-w-2xl mx-auto py-6">
              <h3 className="font-sans text-[13px] tracking-[0.105em] font-semibold uppercase text-foreground mb-4">
                {t("Can't find what you're looking for?", "Vous ne trouvez pas ce que vous cherchez ?")}
              </h3>
              <p className="text-muted-foreground text-sm mb-10">
                {t("Every cake in our collections can be personalised, but if you're dreaming of something completely different, we'd love to create a fully bespoke design just for you. Tell us about your idea, your colours and your occasion, and we'll bring it to life.", "Tous nos gâteaux sont personnalisables. Si vous avez une idée particulière, nous serons ravies de créer un gâteau entièrement sur mesure pour vous.")}
              </p>
              <p className="text-muted-foreground text-sm italic mb-10">
                {t("Please note: We aim to respond within 48 hours. For the best availability, please submit your request at least one week before your desired date.", "À noter : Nous répondons à votre demande sous 48 heures. Pour une meilleure disponibilité, nous vous recommandons de nous contacter au moins une semaine à l'avance.")}
              </p>
              {!showRequestForm ? (
                <Button
                  className="rounded-none bg-primary hover:bg-primary/90 text-primary-foreground uppercase tracking-[0.105em] px-10 py-2.5 text-[14px] font-medium"
                  onClick={() => setShowRequestForm(true)}
                >
                  {t("REQUEST A CUSTOM CAKE", "Demander une création sur mesure")}
                </Button>
              ) : (
                <div className="animate-in fade-in slide-in-from-top-4 duration-500">
                  <CustomRequestForm />
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      <BentoGallery />

      {sheetBlock}
    </Layout>
  );
};

export default Catalog;
