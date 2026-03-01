// Shared customization data used by Customize page, Cart, and Checkout

// Box images
import boxBento from "@/assets/box-bento.png";
import boxRetro from "@/assets/box-retro.png";
import boxMedium from "@/assets/box-medium.png";
import boxLarge from "@/assets/box-large.png";

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

// Style images
import styleNormalWithBorder from "@/assets/style-normal-with-border.jpg";
import styleNormalWithoutBorder from "@/assets/style-normal-without-border.jpg";
import designHeartBomb from "@/assets/design-heart-bomb-new.jpg";
import designPearlBorders from "@/assets/design-pearl-borders-new.jpg";
import designPearlNumber from "@/assets/design-pearl-number-new.jpg";
import designRainbowCake from "@/assets/design-rainbow-cake-new.jpg";
import designRosesPlease from "@/assets/design-roses-please-new.jpg";
import designShagCake from "@/assets/design-shag-cake-new.jpg";
import designShagCake2 from "@/assets/design-shag-cake-2.jpg";
import designRetroCake from "@/assets/design-retro-cake-new.jpg";
import designButterflyGarden from "@/assets/design-butterfly-garden-new.jpg";
import designDrawing from "@/assets/design-drawing-new.jpg";
import designPrintedPicture from "@/assets/design-printed-picture-new.jpg";
import designGoldLeaves from "@/assets/design-gold-leaves-new.png";
import designGlitterCake from "@/assets/design-glitter-cake-new.jpg";
import designGlitterInAir from "@/assets/design-glitter-in-air-new.jpg";
import designGenderReveal from "@/assets/design-gender-reveal-new.jpg";
import designCherries from "@/assets/design-cherries-new.png";
import designScatteredPearls from "@/assets/design-scattered-pearls-new.jpg";
import designRibbons from "@/assets/design-ribbons-new.jpg";
import designGlitterCherries from "@/assets/design-glitter-cherries-new.jpg";
import extraSprinkles from "@/assets/extra-sprinkles.jpg";

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

export const baseColors = [
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

export const textColors = baseColors;

export const sizes = [
  { id: "bento", name: "Bento", description: "Perfect for up to 4 people", price: 40, image: boxBento },
  { id: "medium", name: "Medium", description: "Great for up to 8 people", price: 80, image: boxMedium },
  { id: "large", name: "Large", description: "Ideal for up to 16 people", price: 160, image: boxLarge },
];

export const shapes = [
  { id: "round", name: "Round", extraPrice: { bento: 0, medium: 0, large: 0 } },
  { id: "heart", name: "Heart", extraPrice: { bento: 3, medium: 5, large: 10 } },
];

export const flavorCategories = [
  {
    name: "Standard Flavors",
    extraPrice: { bento: 0, medium: 0, large: 0 },
    flavors: [
      { id: "vanilla", name: "Vanilla", description: "Fluffy vanilla sponge with whipped cream", image: flavorVanilla },
      { id: "red-velvet", name: "Red Velvet", description: "Fluffy vanilla and chocolate sponge with whipped cream", image: flavorRedVelvet },
      { id: "chocolate", name: "Chocolate", description: "Fluffy chocolate sponge with whipped cream", image: flavorChocolate },
    ],
  },
  {
    name: "Special Flavors",
    extraPrice: { bento: 2, medium: 4, large: 8 },
    flavors: [
      { id: "chocolate-lovers", name: "Chocolate Lovers", description: "Moist chocolate sponge with rich chocolate ganache", image: flavorChocolateLovers },
      { id: "chocolate-lover-berrylicious", name: "Chocolate Lover x Berrylicious", description: "Chocolate sponge with raspberry coulis and chocolate ganache", image: flavorChocolateLoverBerrylicious },
      { id: "dark-berrylicious", name: "Dark Berrylicious", description: "Fluffy chocolate sponge filled with a generous raspberry coulis and whipped cream", image: flavorDarkBerrylicious },
      { id: "white-berrylicious", name: "White Berrylicious", description: "Fluffy vanilla sponge filled with a generous raspberry coulis and whipped cream", image: flavorWhiteBerrylicious },
      { id: "salted-caramel", name: "Salted Butter Caramel", description: "Fluffy vanilla sponge filled with caramel and whipped cream", image: flavorSaltedCaramel },
      { id: "lemon-curd", name: "Lemon Curd", description: "Fluffy vanilla sponge filled with lemon curd and whipped cream", image: flavorLemonCurd },
    ],
  },
  {
    name: "Deluxe Flavors",
    extraPrice: { bento: 4, medium: 8, large: 16 },
    flavors: [
      { id: "tiramisu", name: "Tiramisu", description: "Fluffy vanilla sponge filled with fresh coffee and whipped cream", image: flavorTiramisu },
      { id: "praline", name: "Praline Obsession", description: "Fluffy vanilla sponge filled with caramelized almond, hazelnut and whipped cream", image: flavorPraline },
      { id: "passion-fruit", name: "Passion Fruit", description: "Fluffy vanilla sponge filled with fresh passion fruit curd and whipped cream", image: flavorPassionFruit },
      { id: "vanilla-gf", name: "Vanilla Gluten-free", description: "Fluffy gluten-free vanilla sponge with whipped cream", image: flavorVanilla },
      { id: "red-velvet-gf", name: "Red Velvet Gluten-free", description: "Fluffy gluten-free vanilla & chocolate sponge with whipped cream", image: flavorRedVelvet },
      { id: "chocolate-gf", name: "Chocolate Gluten-free", description: "Fluffy gluten-free chocolate sponge with whipped cream", image: flavorChocolate },
    ],
  },
];

export const allFlavors = flavorCategories.flatMap(c => c.flavors);

export const styles = [
  { id: "normal-with-border", name: "Normal with border", price: { bento: 0, medium: 0, large: 0 }, image: styleNormalWithBorder },
  { id: "normal-without-border", name: "Normal without border", price: { bento: 0, medium: 0, large: 0 }, image: styleNormalWithoutBorder },
  { id: "retro-vintage", name: "Retro / Vintage", price: { bento: 5, medium: 15, large: 20 }, image: designRetroCake },
  { id: "heart-bomb", name: "Heart Bomb", price: { bento: 5, medium: 10, large: 15 }, image: designHeartBomb },
  { id: "shag-cake", name: "Shag Cake", price: { bento: 8, medium: 20, large: 30 }, image: designShagCake, secondImage: designShagCake2 },
  { id: "rainbow-cake", name: "Rainbow Cake", price: { bento: 7, medium: 17, large: 30 }, image: designRainbowCake },
  { id: "roses-please", name: "Roses Please", price: { bento: 7, medium: 15, large: 20 }, image: designRosesPlease },
  { id: "butterfly-garden", name: "Butterfly Garden", price: { bento: 7, medium: 15, large: 20 }, image: designButterflyGarden },
  { id: "custom-drawing", name: "Custom Drawing", price: { bento: 5, medium: 5, large: 5 }, image: designDrawing },
  { id: "printed-picture", name: "Printed Picture", price: { bento: 20, medium: 20, large: 20 }, image: designPrintedPicture },
  { id: "gold-leaves-style", name: "Gold Leaves", price: { bento: 2, medium: 4, large: 6 }, image: designGoldLeaves },
  { id: "glitter-cake", name: "Glitter Cake", price: { bento: 6, medium: 8, large: 12 }, image: designGlitterCake },
  { id: "glitter-in-the-air", name: "Glitter in the Air", price: { bento: 5, medium: 7, large: 10 }, image: designGlitterInAir },
  { id: "gender-reveal", name: "Gender Reveal", price: { bento: 5, medium: 10, large: 20 }, image: designGenderReveal },
  { id: "scattered-pearls", name: "Scattered Pearls", price: { bento: 2, medium: 5, large: 7 }, image: designScatteredPearls },
  { id: "pearl-borders", name: "Pearl Borders", price: { bento: 8, medium: 15, large: 20 }, image: designPearlBorders },
  { id: "pearl-number", name: "Pearl Number", price: { bento: 5, medium: 5, large: 5 }, image: designPearlNumber },
  { id: "ribbons", name: "Ribbons", price: { bento: 10, medium: 20, large: 30 }, image: designRibbons },
];

export const extras = [
  { id: "gold-leaves", name: "Gold Leaves", price: { bento: 2, medium: 4, large: 6 }, image: designGoldLeaves },
  { id: "cherries", name: "Cherries", price: { bento: 4, medium: 8, large: 10 }, image: designCherries },
  { id: "glitter-cherries", name: "Glitter Cherries", price: { bento: 6, medium: 9, large: 12 }, image: designGlitterCherries },
  { id: "glitter", name: "Glitter", price: { bento: 6, medium: 8, large: 12 }, image: designGlitterCake },
  { id: "ribbons", name: "Ribbons", price: { bento: 5, medium: 5, large: 5 }, image: designRibbons },
  { id: "butterfly", name: "Butterfly", price: { bento: 5, medium: 5, large: 5 }, image: designButterflyGarden },
  { id: "pearl-number", name: "Pearl Number", price: { bento: 5, medium: 5, large: 5 }, image: designPearlNumber },
  { id: "printed-picture", name: "Printed Picture", price: { bento: 20, medium: 20, large: 20 }, image: designPrintedPicture },
  { id: "sprinkles", name: "Sprinkles", price: { bento: 2, medium: 2, large: 2 }, image: extraSprinkles },
];

export const candles = [
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
  { id: "pink-ombre", name: "Pink Ombré", image: candlePinkOmbre, unitPrice: 1, hasPack: true, packSize: 6, packPrice: 5 },
  { id: "blue-ombre", name: "Blue Ombré", image: candleBlueOmbre, unitPrice: 1, hasPack: true, packSize: 6, packPrice: 5 },
  { id: "rainbow", name: "Rainbow", image: candleRainbow, unitPrice: 1, hasPack: true, packSize: 6, packPrice: 5 },
  { id: "spiral-pastel", name: "Pastel Spiral", image: candleSpiralPastel, unitPrice: 1, hasPack: true, packSize: 6, packPrice: 5 },
  { id: "shiny-spiral", name: "Shiny Spiral", image: candleShinySpiral, unitPrice: 1, hasPack: true, packSize: 6, packPrice: 5 },
  { id: "thick-spiral", name: "Thick Spiral", image: candleThickSpiral, unitPrice: 2, hasPack: true, packSize: 6, packPrice: 10 },
];

export const ribbonColors = [
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

export const butterflyColors = [
  { id: "pink", name: "Pink", color: "#FFC0CB" },
  { id: "blue", name: "Blue", color: "#3B82F6" },
  { id: "gold", name: "Gold", color: "#D4AF37" },
];

export const glitterColors = [
  { id: "white", name: "White", color: "#FFFFFF" },
  { id: "gold", name: "Gold", color: "#D4AF37" },
  { id: "pink", name: "Pink", color: "#FFC0CB" },
  { id: "red", name: "Red", color: "#EF4444" },
  { id: "blue", name: "Blue", color: "#3B82F6" },
];

export const glitterCherriesColors = [
  { id: "white", name: "White", color: "#FFFFFF" },
  { id: "gold", name: "Gold", color: "#D4AF37" },
  { id: "pink", name: "Pink", color: "#FFC0CB" },
  { id: "red", name: "Red", color: "#EF4444" },
  { id: "blue", name: "Blue", color: "#3B82F6" },
];

// Price calculation helpers
export const getStylePrice = (styleId: string, sizeId: string): number => {
  const style = styles.find(s => s.id === styleId);
  if (!style || !sizeId) return 0;
  return style.price[sizeId as keyof typeof style.price] || 0;
};

export const getExtraPrice = (extraId: string, sizeId: string): number => {
  const extra = extras.find(e => e.id === extraId);
  if (!extra || !sizeId) return 0;
  return extra.price[sizeId as keyof typeof extra.price] || 0;
};

const flavorPriceOverrides: Record<string, Record<string, number>> = {
  "chocolate-lover-berrylicious": { bento: 3, retro: 3, medium: 6, large: 10 },
};

export const getFlavorCategoryExtra = (flavorId: string, sizeId: string): number => {
  const override = flavorPriceOverrides[flavorId];
  if (override && sizeId) return override[sizeId] || 0;
  const category = flavorCategories.find(cat =>
    cat.flavors.some(f => f.id === flavorId)
  );
  if (!category || !sizeId) return 0;
  return category.extraPrice[sizeId as keyof typeof category.extraPrice] || 0;
};

export interface CandleSelection {
  id: string;
  quantity: number;
  hasPack: boolean;
}

export const getCandleTotalPrice = (candleId: string, candleSelections: CandleSelection[]): number => {
  const candle = candles.find(c => c.id === candleId);
  if (!candle) return 0;
  const unitSelection = candleSelections.find(c => c.id === candleId && !c.hasPack);
  const unitQty = unitSelection?.quantity || 0;
  if (unitQty === 0) return 0;
  if (candle.hasPack && unitQty >= (candle.packSize || 6)) {
    const packs = Math.floor(unitQty / (candle.packSize || 6));
    const remaining = unitQty % (candle.packSize || 6);
    return packs * (candle.packPrice || 0) + remaining * candle.unitPrice;
  }
  return candle.unitPrice * unitQty;
};

export const calculateCartItemTotal = (
  sizeId: string,
  shapeId: string,
  flavorId: string,
  styleId: string,
  selectedExtras: string[],
  candleSelections: CandleSelection[]
): number => {
  const sizePrice = sizes.find(s => s.id === sizeId)?.price || 0;
  const selectedShape = shapes.find(s => s.id === shapeId);
  const shapeExtra = selectedShape && sizeId
    ? selectedShape.extraPrice[sizeId as keyof typeof selectedShape.extraPrice] || 0
    : 0;
  const flavorExtra = getFlavorCategoryExtra(flavorId, sizeId);
  const styleExtra = getStylePrice(styleId, sizeId);
  const extrasPrice = selectedExtras.reduce((acc, extraId) => acc + getExtraPrice(extraId, sizeId), 0);
  const candlesPrice = candles.reduce((acc, candle) => acc + getCandleTotalPrice(candle.id, candleSelections), 0);
  return sizePrice + shapeExtra + flavorExtra + styleExtra + extrasPrice + candlesPrice;
};
