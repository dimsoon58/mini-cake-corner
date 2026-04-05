import { useState, useRef, useEffect, useCallback } from "react";
import { format, addDays } from "date-fns";
import useEmblaCarousel from "embla-carousel-react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { ShoppingBag, Upload, X, Plus, Minus, ChevronDown, ChevronUp, CalendarIcon, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import Layout from "@/components/Layout";
import ExtraImageLightbox from "@/components/ExtraImageLightbox";
import { allergenMap } from "@/data/allergens";
import { getExcludedExtras, extraGroups, extraDescriptions } from "@/data/customization";
import { useCart } from "@/context/CartContext";
import { useToast } from "@/hooks/use-toast";
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
import retroCake4 from "@/assets/retro-cake-4.jpg";
import designRetroGlitter from "@/assets/design-retro-glitter-new.jpg";
import designRainbowCake from "@/assets/design-rainbow-cake-new.jpg";
import designShagCake from "@/assets/design-shag-cake-new.jpg";
import designShagCake2 from "@/assets/design-shag-cake-2.jpg";
import shagCake1 from "@/assets/shag-cake-1.jpg";
import shagCake2 from "@/assets/shag-cake-2.jpg";
import shagCake3 from "@/assets/shag-cake-3.jpg";
import designGoldLeaves from "@/assets/design-gold-leaves-new.png";
import designScatteredPearls from "@/assets/design-scattered-pearls-new.jpg";
import designPearlBorders from "@/assets/design-pearl-borders-new.jpg";
import designCherries from "@/assets/design-cherries-new.png";
import designGlitterCherries from "@/assets/design-glitter-cherries-new.jpg";
import designRibbons from "@/assets/design-ribbons-new.jpg";
import retroRibbons1 from "@/assets/retro-ribbons-1.jpg";
import retroRibbons2 from "@/assets/retro-ribbons-2.jpg";
import designGlitterCake from "@/assets/design-glitter-cake-new.jpg";
import designGlitterInAir from "@/assets/design-glitter-in-air-new.jpg";
import designHeartBomb from "@/assets/design-heart-bomb-new.jpg";
import designGenderReveal from "@/assets/design-gender-reveal-new.jpg";
import designPrintedPicture from "@/assets/design-printed-picture-new.jpg";
import printedPicture1 from "@/assets/printed-picture-1.jpg";
import printedPicture2 from "@/assets/printed-picture-2.jpg";
import designDrawing from "@/assets/design-drawing-new.jpg";
import drawing1 from "@/assets/drawing-1.jpg";
import drawing2 from "@/assets/drawing-2.jpg";
import drawing3 from "@/assets/drawing-3.jpg";
import drawing4 from "@/assets/drawing-4.jpg";
import designRosesPlease from "@/assets/design-roses-please-new.jpg";
import designButterflyGarden from "@/assets/design-butterfly-garden-new.jpg";
import designPearlNumber from "@/assets/design-pearl-number-new.jpg";
import styleNormalWithBorder from "@/assets/style-normal-with-border.jpg";
import styleNormalWithoutBorder from "@/assets/style-normal-without-border.jpg";
import extraSprinkles from "@/assets/extra-sprinkles-new.jpg";
import extraCherries from "@/assets/extra-cherries.png";
import extraGlitterCherries from "@/assets/extra-glitter-cherries.png";
import extraGoldLeaves from "@/assets/extra-gold-leaves.png";
import extraHeart from "@/assets/extra-heart.png";
import extraRetro from "@/assets/extra-retro.png";
import extraDrawing from "@/assets/extra-drawing.png";
import extraPrintedPicture from "@/assets/extra-printed-picture.png";
import extraButterfly from "@/assets/extra-butterfly.png";
import extraRibbons from "@/assets/extra-ribbons.png";
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
import flavorPassionFruit from "@/assets/flavor-passion-fruit.png";
import flavorOrangeBlossom from "@/assets/flavor-orange-blossom.png";

// Box images
import boxBento from "@/assets/box-bento.png";
import boxRetro from "@/assets/box-retro.png";
import boxMedium from "@/assets/box-medium.png";
import boxLarge from "@/assets/box-large.png";

const baseColors = [
  { id: "white", name: "White", color: "#FFFFFF" },
  { id: "cream", name: "Cream", color: "#FFF8E7" },
  { id: "pastel-pink", name: "Pastel Pink", color: "#FFE4EC" },
  { id: "pink", name: "Pink", color: "#FFC0CB" },
  { id: "dark-pink", name: "Dark Pink", color: "#E75480" },
  { id: "dark-red", name: "Dark Red", color: "#DC143C" },
  { id: "burgundy", name: "Burgundy", color: "#800020" },
  { id: "pastel-yellow", name: "Pastel Yellow", color: "#FDFD96" },
  { id: "yellow", name: "Yellow", color: "#FFD700" },
  { id: "orange", name: "Orange", color: "#FFA500" },
  { id: "pastel-orange", name: "Pastel Orange", color: "#FFB347" },
  { id: "mint-green", name: "Mint Green", color: "#B8F5C8" },
  { id: "green", name: "Green", color: "#3CB371" },
  { id: "forest-green", name: "Forest Green", color: "#228B22" },
  { id: "baby-blue", name: "Baby Blue", color: "#D4F1F9" },
  { id: "sky-blue", name: "Sky Blue", color: "#87CEEB" },
  { id: "midnight-blue", name: "Midnight Blue", color: "#191970" },
  { id: "lavender", name: "Lavender", color: "#E6E6FA" },
  { id: "plum", name: "Plum", color: "#8E4585" },
  { id: "light-brown", name: "Light Brown", color: "#C4A484" },
  { id: "dark-brown", name: "Dark Brown", color: "#654321" },
  { id: "black", name: "Black", color: "#000000" },
];

const sizes = [
  { id: "bento", name: "Bento", price: 40, image: boxBento },
  { id: "retro", name: "Retro Box", price: 40, image: boxRetro },
  { id: "medium", name: "Medium", price: 80, image: boxMedium },
  { id: "large", name: "Large", price: 160, image: boxLarge },
];

const shapes = [
  { id: "round", name: "Round", extraPrice: { bento: 0, retro: 0, medium: 0, large: 0 } },
  { id: "heart", name: "Heart", extraPrice: { bento: 3, retro: 3, medium: 5, large: 10 } },
];

const flavors = [
  { id: "vanilla", name: "Vanilla", image: flavorVanilla, extraPrice: { bento: 0, retro: 0, medium: 0, large: 0 } },
  { id: "red-velvet", name: "Red Velvet", image: flavorRedVelvet, extraPrice: { bento: 0, retro: 0, medium: 0, large: 0 } },
  { id: "chocolate", name: "Chocolate", image: flavorChocolate, extraPrice: { bento: 0, retro: 0, medium: 0, large: 0 } },
  { id: "chocolate-lovers", name: "Chocolate Lovers", image: flavorChocolateLovers, extraPrice: { bento: 2, retro: 2, medium: 4, large: 8 } },
  { id: "chocolate-lover-berrylicious", name: "Chocolate Lover x Berrylicious", image: flavorChocolateLoverBerrylicious, extraPrice: { bento: 3, retro: 3, medium: 6, large: 10 } },
  { id: "dark-berrylicious", name: "Dark Berrylicious", image: flavorDarkBerrylicious, extraPrice: { bento: 2, retro: 2, medium: 4, large: 8 } },
  { id: "white-berrylicious", name: "White Berrylicious", image: flavorWhiteBerrylicious, extraPrice: { bento: 2, retro: 2, medium: 4, large: 8 } },
  { id: "salted-caramel", name: "Salted Butter Caramel", image: flavorSaltedCaramel, extraPrice: { bento: 2, retro: 2, medium: 4, large: 8 } },
  { id: "lemon-curd", name: "Lemon Curd", image: flavorLemonCurd, extraPrice: { bento: 2, retro: 2, medium: 4, large: 8 } },
  { id: "orange-blossom", name: "Orange Blossom", image: flavorOrangeBlossom, extraPrice: { bento: 2, retro: 2, medium: 4, large: 8 } },
  { id: "tiramisu", name: "Tiramisu", image: flavorTiramisu, extraPrice: { bento: 4, retro: 4, medium: 8, large: 16 } },
  { id: "praline", name: "Praline Obsession", image: flavorPraline, extraPrice: { bento: 4, retro: 4, medium: 8, large: 16 } },
  { id: "passion-fruit", name: "Passion Fruit", image: flavorPassionFruit, extraPrice: { bento: 4, retro: 4, medium: 8, large: 16 } },
  { id: "vanilla-gf", name: "Vanilla Gluten-Free", image: flavorVanilla, extraPrice: { bento: 0, retro: 0, medium: 0, large: 0 } },
  { id: "red-velvet-gf", name: "Red Velvet Gluten-Free", image: flavorRedVelvet, extraPrice: { bento: 0, retro: 0, medium: 0, large: 0 } },
  { id: "chocolate-gf", name: "Chocolate Gluten-Free", image: flavorChocolate, extraPrice: { bento: 0, retro: 0, medium: 0, large: 0 } },
];

const candles = [
  // Ombré & Spirals - packs first
  { id: "pink-ombre", name: "Pink Ombré", image: candlePinkOmbre, unitPrice: 1, hasPack: true, packSize: 6, packPrice: 5 },
  { id: "blue-ombre", name: "Blue Ombré", image: candleBlueOmbre, unitPrice: 1, hasPack: true, packSize: 6, packPrice: 5 },
  { id: "rainbow", name: "Rainbow", image: candleRainbow, unitPrice: 1, hasPack: true, packSize: 6, packPrice: 5 },
  { id: "spiral-pastel", name: "Pastel Spiral", image: candleSpiralPastel, unitPrice: 1, hasPack: true, packSize: 6, packPrice: 5 },
  { id: "shiny-spiral", name: "Shiny Spiral", image: candleShinySpiral, unitPrice: 1, hasPack: true, packSize: 6, packPrice: 5 },
  { id: "thick-spiral", name: "Thick Spiral", image: candleThickSpiral, unitPrice: 2, hasPack: true, packSize: 6, packPrice: 10 },
  // Individual candles
  { id: "puppy", name: "Puppy", image: candlePuppy, unitPrice: 2, hasPack: false },
  { id: "teddy-bear", name: "Teddy Bear", image: candleTeddyBear, unitPrice: 2, hasPack: false },
  { id: "cherry", name: "Cherry", image: candleCherry, unitPrice: 2, hasPack: false },
  { id: "heart", name: "Red Heart", image: candleHeart, unitPrice: 2, hasPack: false },
  { id: "daisy", name: "Daisy", image: candleDaisy, unitPrice: 2, hasPack: false },
  { id: "ribbon", name: "Ribbon", image: candleRibbon, unitPrice: 2, hasPack: false },
  { id: "soccer", name: "Footy Flame", image: candleSoccer, unitPrice: 2, hasPack: false },
  { id: "pink-car", name: "Pink Car", image: candlePinkCar, unitPrice: 2, hasPack: false },
  { id: "red-car", name: "Red Car", image: candleRedCar, unitPrice: 2, hasPack: false },
  { id: "blue-car", name: "Blue Car", image: candleBlueCar, unitPrice: 2, hasPack: false },
  { id: "yellow-car", name: "Yellow Car", image: candleYellowCar, unitPrice: 2, hasPack: false },
];

const catalogExtras = [
  { id: "gold-leaves", name: "Gold Leaves", price: { bento: 2, retro: 4, medium: 5, large: 8 }, image: extraGoldLeaves },
  { id: "cherries", name: "Cherries", price: { retro: 4, medium: 8, large: 12 }, image: extraCherries },
  { id: "glitter-cherries", name: "Glitter Cherries", price: { retro: 7, medium: 10, large: 15 }, image: extraGlitterCherries },
  { id: "scattered-pearl", name: "Scattered Pearl", price: { bento: 2, retro: 4, medium: 5, large: 6 }, image: designScatteredPearls },
  { id: "glitter", name: "Glitter", price: { bento: 4, retro: 4, medium: 8, large: 10 }, image: designGlitterCake },
  { id: "glitter-base", name: "Glitter Base", price: { bento: 6, retro: 8, medium: 10, large: 12 }, image: designGlitterCake },
  { id: "glitter-in-the-air", name: "Glitter in the Air", price: { bento: 10, retro: 12, medium: 15, large: 20 }, image: designGlitterInAir },
  { id: "pearl-border", name: "Pearl Border (each)", price: { retro: 8, medium: 15, large: 20 }, image: designPearlBorders },
  { id: "retro", name: "Retro", price: { retro: 5, medium: 15, large: 20 }, image: extraRetro },
  { id: "ribbons", name: "Ribbons", price: { retro: 5, medium: 8, large: 10 }, image: extraRibbons },
  { id: "drawing", name: "Drawing", price: { bento: 5, retro: 5, medium: 8, large: 10 }, image: extraDrawing },
  { id: "heart", name: "Heart", price: { bento: 3, retro: 5, medium: 10, large: 15 }, image: extraHeart },
  { id: "butterfly", name: "Butterfly", price: { bento: 4, retro: 6, medium: 8, large: 10 }, image: extraButterfly },
  { id: "pearl-number", name: "Pearl Number", price: { bento: 5, retro: 5, medium: 5, large: 5 }, image: designPearlNumber },
  { id: "printed-picture", name: "Printed Picture", price: { bento: 15, retro: 15, medium: 15, large: 15 }, image: extraPrintedPicture },
  { id: "sprinkles", name: "Sprinkles", price: { bento: 2, retro: 4, medium: 4, large: 6 }, image: extraSprinkles },
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
    description: "Clean and simple smooth finish",
    image: styleNormalWithoutBorder,
    styleId: "normal-without-border",
    styleName: "Normal without border",
    stylePrice: { bento: 0, retro: 2, medium: 0, large: 0 },
    disableText: false,
  },
  {
    id: "normal-with-border",
    name: "Normal with Border",
    description: "Classic cake with elegant piped border",
    image: styleNormalWithBorder,
    styleId: "normal-with-border",
    styleName: "Normal with border",
    stylePrice: { bento: 0, retro: 2, medium: 0, large: 0 },
    disableText: false,
  },
  {
    id: "heart-bomb",
    name: "Heart Bomb",
    description: "A romantic cake covered in delicate heart decorations",
    image: designHeartBomb,
    styleId: "heart-bomb",
    styleName: "Heart Bomb",
    stylePrice: { bento: 3, retro: 5, medium: 10, large: 15 },
    disableText: false,
  },
  {
    id: "retro-cake",
    name: "Retro Cake",
    description: "Vintage style with elegant decorations",
    image: designRetroCake,
    images: [designRetroCake, retroCake1, retroCake2, retroCake3, retroCake4],
    styleId: "retro-vintage",
    styleName: "Retro / Vintage",
    stylePrice: { retro: 5, medium: 15, large: 20 },
    disableText: false,
  },
  {
    id: "glitter-cherries-retro",
    name: "Glitter Cherries x Retro Cake",
    description: "Sparkling cherry decorations on a retro cake",
    image: designGlitterCherries,
    styleId: "glitter-cherries-retro",
    styleName: "Glitter Cherries on a Retro Cake",
    stylePrice: { retro: 12, medium: 25, large: 35 },
    disableText: false,
  },
  {
    id: "pearl-border-retro",
    name: "Pearl Border × Retro Decoration",
    description: "Three elegant pearl borders with a retro decoration",
    image: designPearlBorders,
    styleId: "pearl-border-retro",
    styleName: "Pearl Border × Retro Decoration",
    stylePrice: { retro: 25, medium: 50, large: 75 },
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
    stylePrice: { retro: 10, medium: 20, large: 30 },
    disableText: false,
  },
  {
    id: "roses-please",
    name: "Roses Please",
    description: "Elegant cake adorned with beautiful piped roses",
    image: designRosesPlease,
    styleId: "roses-please",
    styleName: "Roses Please",
    stylePrice: { retro: 7, medium: 15, large: 20 },
    disableText: false,
  },
  {
    id: "retro-glitter-cake",
    name: "Retro Glitter Cake",
    description: "Sparkly glitter finish on a retro cake",
    image: designRetroGlitter,
    styleId: "retro-glitter-cake",
    styleName: "Retro Glitter Cake",
    stylePrice: { bento: 10, retro: 12, medium: 20, large: 30 },
    disableText: false,
  },
  {
    id: "printed-picture",
    name: "Printed Pictures / Logo",
    description: "Add a personal touch with a printed photo or logo on the cake",
    image: designPrintedPicture,
    images: [designPrintedPicture, printedPicture1, printedPicture2],
    styleId: "printed-picture",
    styleName: "Printed Picture",
    stylePrice: { bento: 15, retro: 17, medium: 15, large: 15 },
    disableText: true,
  },
  {
    id: "shag-cake",
    name: "Shag Cake",
    description: "A retro inspired shag cake with rich texture and colorful details",
    image: designShagCake,
    images: [designShagCake, shagCake1, shagCake2, shagCake3],
    styleId: "shag-cake",
    styleName: "Shag Cake",
    stylePrice: { retro: 10, medium: 20, large: 30 },
    disableText: false,
  },
  {
    id: "rainbow-cake",
    name: "Rainbow Cake",
    description: "A fun retro-style cake with pastel rainbows, sprinkles, and piped borders",
    image: designRainbowCake,
    styleId: "rainbow-cake",
    styleName: "Rainbow Cake",
    stylePrice: { retro: 10, medium: 20, large: 30 },
    disableText: false,
  },
  {
    id: "drawing",
    name: "Drawing",
    description: "Hand-drawn custom design",
    image: designDrawing,
    images: [designDrawing, drawing1, drawing2, drawing3, drawing4],
    styleId: "custom-drawing",
    styleName: "Custom Drawing",
    stylePrice: { bento: 5, retro: 6, medium: 8, large: 10 },
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
    stylePrice: { retro: 8, medium: 20, large: 30 },
    disableText: false,
  },
  {
    id: "scattered-retro-pearls",
    name: "Scattered Retro Pearls",
    description: "Delicate pearls scattered across the cake, with a pearl border and retro decoration",
    image: designScatteredPearls,
    styleId: "scattered-retro-pearls",
    styleName: "Scattered Retro Pearls",
    stylePrice: { retro: 15, medium: 30, large: 45 },
    disableText: false,
  },
  {
    id: "gold-leaves",
    name: "Gold Leaves",
    description: "Elegant cake with gold leaf border",
    image: designGoldLeaves,
    styleId: "gold-leaves-style",
    styleName: "Gold Leaves",
    stylePrice: { bento: 2, retro: 4, medium: 5, large: 8 },
    disableText: false,
  },
  {
    id: "pearl-number",
    name: "Pearl Number",
    description: "Customize with a pearl number",
    image: designPearlNumber,
    styleId: "pearl-number",
    styleName: "Pearl Number",
    stylePrice: { bento: 5, retro: 7, medium: 5, large: 5 },
    disableText: false,
  },
  {
    id: "retro-ribbons-glitter",
    name: "Retro × Ribbons Glitter in the Air",
    description: "A retro cake with ribbons and glitter in the center, blow on it and the glitter flies into the air",
    image: designGlitterInAir,
    imagePosition: "object-[center_70%]",
    styleId: "retro-ribbons-glitter",
    styleName: "Retro × Ribbons Glitter in the Air",
    stylePrice: { retro: 20, medium: 30, large: 40 },
    disableText: false,
  },
  {
    id: "butterfly-garden",
    name: "Butterfly Garden",
    description: "A beautiful gradient cake adorned with pearls and edible butterfly",
    image: designButterflyGarden,
    styleId: "butterfly-garden",
    styleName: "Butterfly Garden",
    stylePrice: { bento: 6, retro: 8, medium: 15, large: 20 },
    disableText: false,
  },
  {
    id: "glitter-base",
    name: "Glitter Base",
    description: "Sparkly glitter base surrounded by gold leaf",
    image: designGlitterCake,
    styleId: "glitter-base",
    styleName: "Glitter Base",
    stylePrice: { bento: 8, retro: 10, medium: 12, large: 14 },
    disableText: false,
  },
  {
    id: "gender-reveal",
    name: "Gender Reveal",
    description: "Choose the inside color. Perfect for your special announcement",
    image: designGenderReveal,
    styleId: "gender-reveal",
    styleName: "Gender Reveal",
    stylePrice: { bento: 5, retro: 7, medium: 10, large: 20 },
    disableText: false,
  },
  {
    id: "sprinkles-with-border",
    name: "Sprinkles with Border",
    description: "A classic cake with decorative borders and colorful sprinkles",
    image: designSprinklesWithBorder,
    styleId: "sprinkles-with-border",
    styleName: "Sprinkles with Border",
    stylePrice: { bento: 2, retro: 4, medium: 4, large: 6 },
    disableText: false,
  },
];

interface CandleSelection {
  id: string;
  quantity: number;
  hasPack: boolean;
}

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
        className="absolute left-2 top-1/2 -translate-y-1/2 bg-background/80 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); emblaApi?.scrollNext(); }}
        className="absolute right-2 top-1/2 -translate-y-1/2 bg-background/80 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
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

const Catalog = () => {
  const { addItem } = useCart();
  const { toast } = useToast();
  const [selectedCake, setSelectedCake] = useState<typeof catalog[0] | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const commentFileInputRef = useRef<HTMLInputElement>(null);
  const [showAllCandles, setShowAllCandles] = useState(false);
  const [fullyBookedDates, setFullyBookedDates] = useState<Date[]>([]);
  const [selections, setSelections] = useState<CakeSelections>({
    orderDate: null,
    orderTime: "",
    size: "bento",
    shape: "round",
    flavor: "vanilla",
    baseColor: "",
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
      orderDate: null,
      orderTime: "",
      size: defaultSize,
      shape: "round",
      flavor: "vanilla",
      baseColor: "",
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
      glitterColor: cake.styleId === "retro-ribbons-glitter" ? "pink" : "",
      glitterCherriesColor: "",
      shagDesignPreference: 0,
    });
    setSheetOpen(true);
  };

  // Candle helpers
  const handleCandleQuantityChange = (candleId: string, delta: number) => {
    const existingIndex = selections.candles.findIndex((c) => c.id === candleId && !c.hasPack);
    let newCandles = [...selections.candles];
    
    if (existingIndex >= 0) {
      const newQty = newCandles[existingIndex].quantity + delta;
      if (newQty <= 0) {
        newCandles = newCandles.filter((_, i) => i !== existingIndex);
      } else {
        newCandles[existingIndex] = { ...newCandles[existingIndex], quantity: newQty };
      }
    } else if (delta > 0) {
      newCandles.push({ id: candleId, quantity: 1, hasPack: false });
    }
    setSelections({ ...selections, candles: newCandles });
  };

  const handleToggleCandlePack = (candleId: string) => {
    const existingIndex = selections.candles.findIndex((c) => c.id === candleId && c.hasPack);
    let newCandles = [...selections.candles];
    
    if (existingIndex >= 0) {
      newCandles = newCandles.filter((_, i) => i !== existingIndex);
    } else {
      newCandles.push({ id: candleId, quantity: 1, hasPack: true });
    }
    setSelections({ ...selections, candles: newCandles });
  };

  const getCandleUnitQuantity = (candleId: string) => {
    const selection = selections.candles.find((c) => c.id === candleId && !c.hasPack);
    return selection?.quantity || 0;
  };

  const isCandlePackSelected = (candleId: string) => {
    return selections.candles.some((c) => c.id === candleId && c.hasPack);
  };

  const getCandleTotalPrice = (candleId: string) => {
    const candle = candles.find((c) => c.id === candleId);
    if (!candle) return 0;
    
    const unitSelection = selections.candles.find((c) => c.id === candleId && !c.hasPack);
    const unitQty = unitSelection?.quantity || 0;
    
    if (unitQty === 0) return 0;
    
    if (candle.hasPack && unitQty >= (candle.packSize || 6)) {
      const packs = Math.floor(unitQty / (candle.packSize || 6));
      const remaining = unitQty % (candle.packSize || 6);
      return packs * (candle.packPrice || 0) + remaining * candle.unitPrice;
    }
    
    return candle.unitPrice * unitQty;
  };

  const getTotalCandlesPrice = () => {
    return candles.reduce((acc, candle) => acc + getCandleTotalPrice(candle.id), 0);
  };

  const excludedExtras = selectedCake ? getExcludedExtras(selectedCake.styleId) : [];

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
        title: "Maximum 5 images",
        description: "You have already reached the maximum number of reference images.",
        variant: "destructive",
      });
      if (commentFileInputRef.current) commentFileInputRef.current.value = "";
      return;
    }
    const oversizedFiles = files.filter(f => f.size > 5 * 1024 * 1024);
    if (oversizedFiles.length > 0) {
      toast({
        title: "File too large",
        description: `Each image must be under 5 MB. ${oversizedFiles.length} file(s) exceeded the limit.`,
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
      title: `${accepted.length} image${accepted.length > 1 ? "s" : ""} added ✓`,
      description: rejected > 0
        ? `${rejected} image(s) ignored (max 5 reached).`
        : `${selections.commentImages.length + accepted.length}/5 reference images.`,
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
    
    if (!selections.orderDate) {
      toast({ title: "Date required", description: "Please select a pickup/delivery date.", variant: "destructive" });
      return;
    }

    if (!selections.baseColor) {
      toast({ title: "Base Color required", description: "Please select a base color for your cake.", variant: "destructive" });
      return;
    }
    
    if (selections.decorationColors.length === 0 && selectedCake.styleId !== "normal-without-border") {
      toast({ title: "Decoration Color required", description: "Please select at least one decoration color for your cake.", variant: "destructive" });
      return;
    }

    if (selections.wantsText && !selections.textColor) {
      toast({ title: "Text Color required", description: "Please select a color for your text.", variant: "destructive" });
      return;
    }

    if (selections.wantsText && !selections.cakeText.trim()) {
      toast({ title: "Text message required", description: "Please enter your message.", variant: "destructive" });
      return;
    }

    if ((selectedCake.styleId === "printed-picture" || selections.extras.includes("printed-picture")) && !selections.printedImage) {
      toast({ title: "Image required", description: "Please upload an image for your printed picture cake.", variant: "destructive" });
      return;
    }

    const designNeedsGlitter = ["retro-glitter-cake", "retro-ribbons-glitter"].includes(selectedCake?.styleId || "");
    if ((designNeedsGlitter || selections.extras.includes("glitter") || selections.extras.includes("glitter-base") || selections.extras.includes("glitter-in-the-air")) && !selections.glitterColor) {
      toast({ title: "Glitter Color required", description: "Please select a color for your glitter.", variant: "destructive" });
      return;
    }

    const designNeedsGlitterCherries = selectedCake?.styleId === "glitter-cherries-retro";
    if ((designNeedsGlitterCherries || selections.extras.includes("glitter-cherries")) && !selections.glitterCherriesColor) {
      toast({ title: "Glitter Cherries Color required", description: "Please select a color for your glitter cherries.", variant: "destructive" });
      return;
    }

    const designNeedsRibbon = selectedCake?.styleId === "retro-ribbons" || selectedCake?.styleId === "retro-ribbons-glitter";
    if ((designNeedsRibbon || selections.extras.includes("ribbons")) && !selections.ribbonColor) {
      toast({ title: "Ribbon Color required", description: "Please select a color for your ribbons.", variant: "destructive" });
      return;
    }

    const designNeedsButterfly = selectedCake?.styleId === "butterfly-garden";
    if ((designNeedsButterfly || selections.extras.includes("butterfly")) && !selections.butterflyColor) {
      toast({ title: "Butterfly Color required", description: "Please select a color for your butterfly.", variant: "destructive" });
      return;
    }
    
    const sizeObj = sizes.find(s => s.id === selections.size);
    const shapeObj = shapes.find(s => s.id === selections.shape);
    const flavorObj = flavors.find(f => f.id === selections.flavor);
    const baseColorObj = baseColors.find(c => c.id === selections.baseColor);
    const decoColorNames = selections.decorationColors.map(id => baseColors.find(c => c.id === id)?.name || "").filter(Boolean);
    const textColorObj = baseColors.find(c => c.id === selections.textColor);

    // Format the cake text according to style
    let finalText = selections.cakeText;
    if (selections.textStyle === "uppercase") {
      finalText = selections.cakeText.toUpperCase();
    }
    
    const extrasNames = selections.extras.map(id => catalogExtras.find(e => e.id === id)?.name || "");
    const selectedRibbonColor = ribbonColors.find(c => c.id === selections.ribbonColor);
    const selectedButterflyColor = butterflyColors.find(c => c.id === selections.butterflyColor);

    addItem({
      id: "",
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
      baseColor: selections.baseColor,
      baseColorName: baseColorObj?.name || "",
      decorationColor: selections.decorationColors.join(", "),
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
      candles: selections.candles,
      comment: selectedCake.images && selectedCake.images.length > 1
        ? `[Preferred design: Option ${selections.shagDesignPreference + 1}]${selections.comment ? " " + selections.comment : ""}`
        : selections.comment,
      imageUrls: [],
      imageFiles: [...selections.commentImages],
      total: calculatePrice(),
    });
    setSheetOpen(false);
    setSelectedCake(null);
  };

  // Split candles into packs and individuals
  const packCandles = candles.filter(c => c.hasPack);
  const individualCandles = candles.filter(c => !c.hasPack);

  return (
    <Layout>
      <div className="container mx-auto px-4 py-16">
        <h1 className="font-serif text-4xl md:text-5xl text-center text-foreground mb-6">
          CATALOG
        </h1>
        <p className="text-center text-muted-foreground mb-16 max-w-2xl mx-auto">
          Get inspired by our pre-designed creations. Pick your favorite and customize it to make it yours.
        </p>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 max-w-6xl mx-auto">
          {catalog.map((cake) => (
            <div
              key={cake.id}
              className="bg-card rounded-2xl overflow-hidden shadow-sm hover:shadow-lg transition-shadow"
            >
              {cake.images && cake.images.length > 1 ? (
                <CatalogCarousel images={cake.images} name={cake.name} imagePositions={(cake as any).imagePositions} />
              ) : (
                <div className="aspect-square overflow-hidden bg-muted/30">
                  <img
                    src={cake.image}
                    alt={cake.name}
                    className={cn("w-full h-full object-cover hover:scale-105 transition-transform duration-300", cake.imagePosition)}
                  />
                </div>
              )}
              <div className="p-6 text-center">
                <h3 className="font-serif text-xl font-bold text-foreground mb-2">
                  {cake.name}
                </h3>
                <p className="text-muted-foreground text-sm mb-4">
                  {cake.description}
                </p>
                <Button 
                  variant="outline" 
                  className="w-full rounded-full border-foreground text-foreground hover:bg-foreground hover:text-background"
                  onClick={() => handleSelectCake(cake)}
                >
                  Choose this style
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Catalog Sheet */}
      <TooltipProvider delayDuration={200}>
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="font-serif text-2xl">
              {selectedCake?.name}
            </SheetTitle>
            <SheetDescription>
              Customize your cake options
            </SheetDescription>
          </SheetHeader>
          
          {selectedCake && (
            <div className="mt-6 space-y-6">
              <div className="aspect-square rounded-lg overflow-hidden bg-muted/30">
                <img
                  src={selectedCake.image}
                  alt={selectedCake.name}
                  className="w-full h-full object-cover"
                />
              </div>

              {/* Pickup Date Selection */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground flex items-center gap-1">
                  Pickup Date <span className="text-destructive">*</span>
                  <Tooltip>
                    <TooltipTrigger asChild><Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" /></TooltipTrigger>
                    <TooltipContent><p className="text-xs max-w-[200px]">Order preparation date (minimum 4 days in advance)</p></TooltipContent>
                  </Tooltip>
                </label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !selections.orderDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {selections.orderDate ? (
                        format(selections.orderDate, "dd.MM.yyyy")
                      ) : (
                        <span>Pick a date</span>
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
              </div>

              {/* Size Selection with box images */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground flex items-center gap-1">
                  Size <span className="text-destructive">*</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs max-w-[200px]">Choose the size of your cake.</p>
                    </TooltipContent>
                  </Tooltip>
                </label>
                <Select
                  value={selections.size}
                  onValueChange={(value) => setSelections({ ...selections, size: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select size" />
                  </SelectTrigger>
                  <SelectContent>
                    {sizes.filter((size) => selectedCake && size.id in selectedCake.stylePrice).map((size) => (
                      <SelectItem key={size.id} value={size.id}>
                        <div className="flex items-center gap-2">
                          <img src={size.image} alt={size.name} className="w-8 h-8 object-contain flex-shrink-0" />
                          <span>{size.name} - CHF {size.price}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Shape Selection */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground flex items-center gap-1">
                  Shape <span className="text-destructive">*</span>
                  <Tooltip>
                    <TooltipTrigger asChild><Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" /></TooltipTrigger>
                    <TooltipContent><p className="text-xs max-w-[200px]">Choose the shape of your cake.</p></TooltipContent>
                  </Tooltip>
                </label>
                <Select
                  value={selections.shape}
                  onValueChange={(value) => setSelections({ ...selections, shape: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select shape" />
                  </SelectTrigger>
                  <SelectContent>
                    {shapes.map((shape) => {
                      const extra = shape.extraPrice[selections.size as keyof typeof shape.extraPrice] || 0;
                      return (
                        <SelectItem key={shape.id} value={shape.id}>
                          {shape.name} {extra > 0 ? `(+CHF ${extra})` : ""}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>

              {/* Flavor Selection */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground flex items-center gap-1">
                  Flavor <span className="text-destructive">*</span>
                  <Tooltip>
                    <TooltipTrigger asChild><Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" /></TooltipTrigger>
                    <TooltipContent><p className="text-xs max-w-[200px]">Please select the flavor of your cake.</p></TooltipContent>
                  </Tooltip>
                </label>
                <Select
                  value={selections.flavor}
                  onValueChange={(value) => setSelections({ ...selections, flavor: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select flavor" />
                  </SelectTrigger>
                  <SelectContent>
                    {flavors.map((flavor) => {
                      const extra = flavor.extraPrice[selections.size as keyof typeof flavor.extraPrice] || 0;
                      const info = allergenMap[flavor.id];
                      return (
                        <SelectItem key={flavor.id} value={flavor.id}>
                          <div className="flex items-start gap-2">
                            <img src={flavor.image} alt={flavor.name} className="w-8 h-8 object-contain flex-shrink-0 mt-0.5" />
                            <div>
                            <span>{flavor.name} {extra > 0 ? `(+CHF ${extra})` : ""}</span>
                            {info && flavor.id.endsWith("-gf") ? (
                              <div className="text-[10px] text-muted-foreground leading-tight mt-0.5 space-y-0.5">
                                <p><span className="font-medium">Contains:</span> Eggs, Milk</p>
                                <p><span className="font-medium">May contain:</span> Gluten, Nuts</p>
                                <p className="text-muted-foreground/70 italic">Prepared in a kitchen that processes gluten.</p>
                              </div>
                            ) : info && (
                              <div className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                                {info.warning && <span className="text-destructive font-medium">⚠️ {info.warning} · </span>}
                                Contains: {info.contains}
                              </div>
                            )}
                            </div>
                          </div>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>

              {/* Design Display */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground flex items-center gap-1">
                  Design
                  <Tooltip>
                    <TooltipTrigger asChild><Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" /></TooltipTrigger>
                    <TooltipContent><p className="text-xs max-w-[220px]">You can select any design. You can also add extras and/or inspiration pictures in the next steps.</p></TooltipContent>
                  </Tooltip>
                </label>
                <div className="bg-secondary/50 rounded-lg p-4">
                  <p className="font-medium text-foreground">{selectedCake.styleName}</p>
                  <p className="text-sm text-primary mt-1">
                    +CHF {selectedCake.stylePrice[selections.size as keyof typeof selectedCake.stylePrice]}
                  </p>
                </div>
              </div>

              {/* Shag Cake Design Preference */}
              {selectedCake?.images && selectedCake.images.length > 1 && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Choose your preferred design</label>
                  <div className="grid grid-cols-2 gap-3">
                    {selectedCake.images.map((img, i) => (
                      <button
                        key={i}
                        onClick={() => setSelections(prev => ({ ...prev, shagDesignPreference: i }))}
                        className={cn(
                          "rounded-lg overflow-hidden border-2 transition-all aspect-square",
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

              {/* Base Color Selection */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground flex items-center gap-1">
                  Base Color <span className="text-destructive">*</span>
                  <Tooltip>
                    <TooltipTrigger asChild><Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" /></TooltipTrigger>
                    <TooltipContent><p className="text-xs max-w-[200px]">The base color is essential to personalize your cake.</p></TooltipContent>
                  </Tooltip>
                </label>
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5 flex items-center gap-1.5">
                  <span>⚠️</span> We recommend choosing light colors, as dark colors may temporarily stain lips.
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
                      <span className="text-[10px] text-foreground text-center leading-tight truncate w-full">{color.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Decoration Color Selection - hidden for normal-without-border */}
              {selectedCake?.styleId !== "normal-without-border" && (() => {
                const maxColors = (selectedCake?.styleId === "roses-please" || selectedCake?.styleId === "shag-cake") ? 4 : 3;
                return (
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground flex items-center gap-1">
                  Decoration Color <span className="text-destructive cursor-help">
                    <Tooltip>
                      <TooltipTrigger asChild><span>*</span></TooltipTrigger>
                      <TooltipContent><p className="text-xs max-w-[200px]">Select up to {maxColors} decoration colors for your design.</p></TooltipContent>
                    </Tooltip>
                  </span>
                  <Tooltip>
                    <TooltipTrigger asChild><Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" /></TooltipTrigger>
                    <TooltipContent><p className="text-xs max-w-[200px]">Choose the colors for the decorative elements of your cake.</p></TooltipContent>
                  </Tooltip>
                </label>
                <p className="text-xs text-muted-foreground">
                  You can choose up to {maxColors} colors for your design decorations. You can also explain how you would like them to be arranged in the comment section.
                </p>
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5 flex items-center gap-1.5">
                  <span>⚠️</span> We recommend choosing light colors, as dark colors may temporarily stain lips.
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
                      <span className="text-[10px] text-foreground text-center leading-tight truncate w-full">{color.name}</span>
                    </button>
                    );
                  })}
                </div>
                {selections.decorationColors.length > 0 && (
                  <p className="text-xs text-primary font-medium">{selections.decorationColors.length}/{maxColors} colors selected</p>
                )}
              </div>
                );
              })()}

              {/* Text Toggle - hidden for printed-picture */}
              {!selectedCake?.disableText && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground flex items-center gap-1">
                  Add Text
                  <Tooltip>
                    <TooltipTrigger asChild><Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" /></TooltipTrigger>
                    <TooltipContent><p className="text-xs max-w-[220px]">If you would like to add text, you can choose the typography.</p></TooltipContent>
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
                    No Text
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
                    Add Text
                  </button>
                </div>
              </div>
              )}

              {selections.wantsText && (
                <>
                  {/* Text Style Selection */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Text Style</label>
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
                          {style.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Text Input */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Your Message</label>
                    <input
                      type="text"
                      value={selections.cakeText}
                      onChange={(e) => setSelections({ ...selections, cakeText: e.target.value })}
                      placeholder="e.g., Happy Birthday!"
                      maxLength={30}
                      className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    <p className="text-xs text-muted-foreground text-right">{selections.cakeText.length}/30</p>
                    {/* Live text preview */}
                    {selections.cakeText && (
                      <div className="bg-muted/30 rounded-lg p-3 text-center">
                        <p className="text-xs text-muted-foreground mb-1">Preview:</p>
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

                  {/* Text Color Selection */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Text Color</label>
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
                          <span className="text-[10px] text-foreground text-center leading-tight truncate w-full">{color.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
               )}

              {/* Extras Section */}
              <div className="space-y-3">
                <label className="text-sm font-medium text-foreground flex items-center gap-1">
                  ✨ Extra
                  <Tooltip>
                    <TooltipTrigger asChild><Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" /></TooltipTrigger>
                    <TooltipContent><p className="text-xs max-w-[220px]">You can add any additional elements to personalize your design.</p></TooltipContent>
                  </Tooltip>
                </label>
                {extraGroups.map((group) => {
                  const visibleExtras = group.ids
                    .map(id => catalogExtras.find(e => e.id === id))
                    .filter((extra): extra is typeof catalogExtras[0] => !!extra && !excludedExtras.includes(extra.id));
                  if (visibleExtras.length === 0) return null;
                  return (
                    <div key={group.label} className="space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{group.label}</p>
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
                                  <p className="text-xs font-medium text-foreground truncate">{extra.name}</p>
                                  {extraDescriptions[extra.id] && (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Info className="w-3 h-3 text-muted-foreground cursor-help flex-shrink-0" />
                                      </TooltipTrigger>
                                      <TooltipContent side="top">
                                        <p className="text-xs max-w-[200px]">{extraDescriptions[extra.id]}</p>
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

                {/* Glitter Color */}
                {(selections.extras.includes("glitter") || selections.extras.includes("glitter-base") || selections.extras.includes("glitter-in-the-air") || ["retro-glitter-cake", "retro-ribbons-glitter"].includes(selectedCake?.styleId || "")) && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-foreground">Glitter Color <span className="text-destructive">*</span></p>
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
                            <span className="text-[10px] text-foreground">{color.name}</span>
                          </button>
                        ));
                      })()}
                    </div>
                  </div>
                )}

                {/* Glitter Cherries Color */}
                {(selections.extras.includes("glitter-cherries") || selectedCake?.styleId === "glitter-cherries-retro") && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-foreground">Glitter Cherries Color</p>
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
                          <span className="text-[10px] text-foreground">{color.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Ribbon Color */}
                {(selections.extras.includes("ribbons") || selectedCake?.styleId === "retro-ribbons" || selectedCake?.styleId === "retro-ribbons-glitter") && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-foreground">Ribbon Color <span className="text-destructive">*</span></p>
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
                          <span className="text-[10px] text-foreground">{color.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Butterfly Color */}
                {(selections.extras.includes("butterfly") || selectedCake?.styleId === "butterfly-garden") && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-foreground">Butterfly Color <span className="text-destructive">*</span></p>
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
                          <span className="text-[10px] text-foreground">{color.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

               {/* Printed Picture Upload - for printed-picture style or extra */}
              {(selectedCake?.styleId === "printed-picture" || selections.extras.includes("printed-picture")) && (
                <div className="space-y-3">
                  <label className="text-sm font-medium text-foreground">Upload Your Image</label>
                  <p className="text-xs text-muted-foreground">
                    Upload the image or logo you want printed on your cake (JPG, PNG, WEBP)
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
                      <span className="text-sm text-muted-foreground">Click to upload image</span>
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
                        className="absolute top-2 right-2 bg-destructive text-destructive-foreground rounded-full p-1 hover:bg-destructive/80"
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
                  💬 Comment
                  <Tooltip>
                    <TooltipTrigger asChild><Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" /></TooltipTrigger>
                    <TooltipContent><p className="text-xs max-w-[240px]">Write any guidelines you would like to clarify. Please note that if you request decorations or extras that were not selected, the price may change.</p></TooltipContent>
                  </Tooltip>
                </label>
                <Textarea
                  value={selections.comment}
                  onChange={(e) => setSelections({ ...selections, comment: e.target.value })}
                  placeholder="Any special requests or details about your cake..."
                  className="min-h-[80px]"
                />
                <div>
                  <label className="text-xs font-medium text-foreground flex items-center gap-1 mb-2">
                    Upload
                    <Tooltip>
                      <TooltipTrigger asChild><Info className="w-3 h-3 text-muted-foreground cursor-help" /></TooltipTrigger>
                      <TooltipContent><p className="text-xs max-w-[200px]">Upload an inspiration picture if you would like.</p></TooltipContent>
                    </Tooltip>
                  </label>
                  <p className="text-xs text-muted-foreground mb-2">
                    Upload reference images (max 5 — 5 MB per image — JPG, PNG, WEBP)
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
                      <span className="text-xs text-muted-foreground">Click to upload images</span>
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
                              className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 hover:bg-destructive/80"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                      <p className="text-[10px] text-muted-foreground/80 italic mt-2 leading-tight">
                        When a client provides an inspiration photo, it is for reference only. Bento Cake Studio SNC will create a design inspired by it and aim to respect the colors and style, but an identical reproduction is not guaranteed.
                      </p>
                    </>
                  )}
                </div>
              </div>

              {/* Candles Section - Packs first, then individual */}
              <div className="space-y-3 rounded-xl p-4" style={{ backgroundColor: '#FFE4EC' }}>
                <label className="text-sm font-medium text-foreground">🕯️ Candles (Optional)</label>
                
                {/* Ombré & Spirals (Packs) - shown first */}
                <div className="space-y-2">
                  <div className="flex flex-wrap justify-center gap-3">
                    {packCandles.slice(0, showAllCandles ? undefined : 4).map((candle) => {
                      const unitQty = getCandleUnitQuantity(candle.id);
                      const totalPrice = getCandleTotalPrice(candle.id);
                      const isPackApplied = candle.hasPack && unitQty >= (candle.packSize || 6);
                      
                      return (
                        <div key={candle.id} className="flex flex-col items-center w-[calc(50%-6px)]">
                          <img
                            src={candle.image}
                            alt={candle.name}
                            className="h-28 w-28 object-contain mb-1"
                          />
                          <div className={cn(
                            "w-full rounded-lg p-2 text-center transition-all",
                            unitQty > 0 ? "bg-white/90 ring-2 ring-primary" : "bg-white/60"
                          )}>
                            <p className="text-xs font-medium text-foreground">{candle.name}</p>
                            <p className="text-[10px] text-muted-foreground mb-1">CHF {candle.unitPrice}/pièce · Pack {candle.packSize} = CHF {candle.packPrice}</p>
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                onClick={() => handleCandleQuantityChange(candle.id, -1)}
                                disabled={unitQty === 0}
                                className={cn(
                                  "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all",
                                  unitQty === 0
                                    ? "bg-muted text-muted-foreground cursor-not-allowed"
                                    : "bg-primary text-primary-foreground hover:bg-primary/90"
                                )}
                              >−</button>
                              <span className="w-5 text-center font-medium text-foreground text-sm">{unitQty}</span>
                              <button
                                onClick={() => handleCandleQuantityChange(candle.id, 1)}
                                className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold hover:bg-primary/90 transition-all"
                              >+</button>
                            </div>
                            {isPackApplied && (
                              <p className="text-[10px] text-primary font-semibold mt-1">✓ Pack appliqué</p>
                            )}
                            {totalPrice > 0 && (
                              <p className="text-[10px] text-primary font-medium mt-0.5">+CHF {totalPrice}</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Individual candles - shown after packs */}
                {showAllCandles && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-foreground/70 text-center mt-3">Individual Candles</p>
                    <div className="flex flex-wrap justify-center gap-3">
                      {individualCandles.map((candle) => {
                        const unitQty = getCandleUnitQuantity(candle.id);
                        const totalPrice = getCandleTotalPrice(candle.id);
                        
                        return (
                          <div key={candle.id} className="flex flex-col items-center w-[calc(50%-6px)]">
                            <img
                              src={candle.image}
                              alt={candle.name}
                              className="h-28 w-28 object-contain mb-1"
                            />
                            <div className={cn(
                              "w-full rounded-lg p-2 text-center transition-all",
                              unitQty > 0 ? "bg-white/90 ring-2 ring-primary" : "bg-white/60"
                            )}>
                              <p className="text-xs font-medium text-foreground">{candle.name}</p>
                              <p className="text-[10px] text-muted-foreground mb-1">CHF {candle.unitPrice} / pièce</p>
                              <div className="flex items-center justify-center gap-1.5">
                                <button
                                  onClick={() => handleCandleQuantityChange(candle.id, -1)}
                                  disabled={unitQty === 0}
                                  className={cn(
                                    "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all",
                                    unitQty === 0
                                      ? "bg-muted text-muted-foreground cursor-not-allowed"
                                      : "bg-primary text-primary-foreground hover:bg-primary/90"
                                  )}
                                >−</button>
                                <span className="w-5 text-center font-medium text-foreground text-sm">{unitQty}</span>
                                <button
                                  onClick={() => handleCandleQuantityChange(candle.id, 1)}
                                  className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold hover:bg-primary/90 transition-all"
                                >+</button>
                              </div>
                              {totalPrice > 0 && (
                                <p className="text-[10px] text-primary font-medium mt-1">+CHF {totalPrice}</p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* See more / See less toggle */}
                <button
                  onClick={() => setShowAllCandles(!showAllCandles)}
                  className="w-full flex items-center justify-center gap-1 text-xs text-primary font-medium py-2 hover:underline"
                >
                  {showAllCandles ? (
                    <>See less <ChevronUp className="w-3 h-3" /></>
                  ) : (
                    <>See more <ChevronDown className="w-3 h-3" /></>
                  )}
                </button>
              </div>

              {/* Price */}
              <div className="flex justify-between items-center py-4 bg-secondary/50 rounded-lg px-4">
                <span className="font-medium text-foreground">Total</span>
                <span className="text-xl font-bold text-primary">
                  CHF {calculatePrice()}
                </span>
              </div>

              <Button
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground py-6 text-lg rounded-full"
                onClick={handleAddToCart}
              >
                <ShoppingBag className="w-5 h-5 mr-2" />
                Add to Cart
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
      </TooltipProvider>
    </Layout>
  );
};

export default Catalog;
