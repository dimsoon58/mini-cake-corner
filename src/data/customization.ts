// Shared customisation data used by Customise page, Cart, and Checkout
import { NUMBER_CANDLE_ID, NUMBER_CANDLE_PRICE } from "@/pages/KitBentoCake";

// Box images
import boxBento from "@/assets/box-bento.png";
import boxRetro from "@/assets/box-retro.png";
import boxMedium from "@/assets/box-medium.png";
import boxLarge from "@/assets/box-large.png";
import boxRectangle from "@/assets/home-cat-rectangle.jpg";

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
// Style images
import styleNormalWithBorder from "@/assets/style-normal-with-border.jpg";
import styleNormalWithoutBorder from "@/assets/style-normal-without-border.jpg";
import designSprinklesWithBorder from "@/assets/design-sprinkles-with-border.jpg";
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
import designGoldenCake from "@/assets/design-golden-cake.jpg";
import designGlitterCake from "@/assets/design-glitter-cake-new.jpg";
import extraGlitter from "@/assets/extra-glitter-new.jpg";
import designGlitterInAir from "@/assets/design-glitter-in-air-new.jpg";
import designGenderReveal from "@/assets/design-gender-reveal-new.jpg";
import designCherries from "@/assets/design-cherries-new.png";
import designScatteredPearls from "@/assets/design-scattered-pearls-new.jpg";
import designRibbons from "@/assets/design-ribbons-new.jpg";
import designGlitterCherries from "@/assets/design-glitter-cherries-new.jpg";
import designRetroGlitter from "@/assets/design-retro-glitter-new.jpg";
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

export const textColors = baseColors;

export const sizes = [
  { id: "bento", name: "Bento", description: "Perfect for up to 4 people", price: 40, image: boxBento },
  { id: "retro", name: "Retro Box", description: "Perfect for up to 4 people", price: 45, image: boxRetro },
  { id: "medium", name: "Medium", description: "Great for up to 8 people", price: 85, image: boxMedium },
  { id: "large", name: "Large", description: "Ideal for up to 16 people", price: 165, image: boxLarge },
  { id: "rectangle", name: "Rectangle", description: "Perfect for larger gatherings", price: 450, image: boxRectangle },
];

export const shapes = [
  { id: "round", name: "Round", extraPrice: { bento: 0, retro: 0, medium: 0, large: 0 } },
  { id: "heart", name: "Heart", extraPrice: { bento: 3, retro: 3, medium: 5, large: 5 } },
];

export const flavorCategories = [
  {
    name: "Standard Flavors",
    extraPrice: { bento: 0, retro: 0, medium: 0, large: 0, rectangle: 0 },
    flavors: [
      { id: "vanilla", name: "Vanilla", description: "Fluffy vanilla sponge with whipped cream", image: flavorVanilla },
      { id: "red-velvet", name: "Red Velvet", description: "Fluffy vanilla and chocolate sponge with whipped cream", image: flavorRedVelvet },
      { id: "chocolate", name: "Chocolate", description: "Fluffy chocolate sponge with whipped cream", image: flavorChocolate },
    ],
  },
  {
    name: "Special Flavors",
    extraPrice: { bento: 2, retro: 2, medium: 5, large: 10, rectangle: 20 },
    flavors: [
      { id: "chocolate-lovers", name: "Chocolate Lovers", description: "Moist chocolate sponge with rich chocolate ganache", image: flavorChocolateLovers },
      { id: "dark-berrylicious", name: "Dark Berrylicious", description: "Fluffy chocolate sponge filled with a generous raspberry coulis and whipped cream", image: flavorDarkBerrylicious },
      { id: "white-berrylicious", name: "White Berrylicious", description: "Fluffy vanilla sponge filled with a generous raspberry coulis and whipped cream", image: flavorWhiteBerrylicious },
      { id: "salted-caramel", name: "Salted Butter Caramel", description: "Fluffy vanilla sponge filled with caramel and whipped cream", image: flavorSaltedCaramel },
      { id: "lemon-curd", name: "Lemon Curd", description: "Fluffy vanilla sponge filled with lemon curd and whipped cream", image: flavorLemonCurd },
    ],
  },
  {
    name: "Deluxe Flavors",
    extraPrice: { bento: 4, retro: 4, medium: 10, large: 15, rectangle: 30 },
    flavors: [
      { id: "chocolate-lover-berrylicious", name: "Chocolate Lover x Berrylicious", description: "Chocolate sponge with raspberry coulis and chocolate ganache", image: flavorChocolateLoverBerrylicious },
      { id: "tiramisu", name: "Tiramisu", description: "Fluffy vanilla sponge filled with fresh coffee and whipped cream", image: flavorTiramisu },
      { id: "praline", name: "Praline Obsession", description: "Fluffy vanilla sponge filled with caramelised almond, hazelnut and whipped cream", image: flavorPraline },
      { id: "pistachio-lovers", name: "Pistachio Lovers", description: "Fluffy vanilla sponge filled with caramelised pistachio and whipped cream", image: flavorPistachio },
      { id: "passion-fruit", name: "Passion Fruit", description: "Fluffy vanilla sponge filled with fresh passion fruit curd and whipped cream", image: flavorPassionFruit },
      { id: "vanilla-gf", name: "Vanilla Gluten-free", description: "Fluffy gluten-free vanilla sponge with whipped cream", image: flavorVanilla },
      { id: "red-velvet-gf", name: "Red Velvet Gluten-free", description: "Fluffy gluten-free vanilla & chocolate sponge with whipped cream", image: flavorRedVelvet },
      { id: "chocolate-gf", name: "Chocolate Gluten-free", description: "Fluffy gluten-free chocolate sponge with whipped cream", image: flavorChocolate },
    ],
  },
  {
    name: "Gluten-Free Premium",
    extraPrice: { bento: 6, retro: 6, medium: 15, large: 25, rectangle: 50 },
    flavors: [
      { id: "chocolate-gf-berrylicious", name: "Chocolate GF × Berrylicious", image: flavorDarkBerrylicious /* TODO: real product photo */ },
      { id: "vanilla-gf-berrylicious", name: "Vanilla GF × Berrylicious", image: flavorWhiteBerrylicious /* TODO: real product photo */ },
      { id: "lemon-curd-gf", name: "Lemon Curd Gluten-free", image: flavorLemonCurd /* TODO: real product photo */ },
      { id: "chocolate-lovers-gf", name: "Chocolate Lovers Gluten-free", image: flavorChocolateLovers /* TODO: real product photo */ },
    ],
  },
  {
    name: "Gluten-Free Deluxe",
    extraPrice: { bento: 8, retro: 8, medium: 20, large: 30, rectangle: 60 },
    flavors: [
      { id: "orange-blossom-gf", name: "Orange Blossom Gluten-free", image: flavorVanilla /* TODO: no equivalent photo exists — needs a real one */ },
      { id: "pistachio-gf", name: "Pistachio Gluten-free", image: flavorPistachio /* TODO: real product photo */ },
      { id: "tiramisu-gf", name: "Tiramisu Gluten-free", image: flavorTiramisu /* TODO: real product photo */ },
      { id: "passion-fruit-gf", name: "Passion Fruit Gluten-free", image: flavorPassionFruit /* TODO: real product photo */ },
      { id: "praline-gf", name: "Praline Gluten-free", image: flavorPraline /* TODO: real product photo */ },
    ],
  },
];

export const allFlavors = flavorCategories.flatMap(c => c.flavors);

export const styles = [
  { id: "normal-without-border", name: "Normal without border", price: { bento: 0, retro: 0, medium: 0, large: 0, rectangle: 0 } as Record<string, number>, image: styleNormalWithoutBorder },
  { id: "normal-with-border", name: "Normal with border", price: { bento: 0, retro: 0, medium: 0, large: 0, rectangle: 0 } as Record<string, number>, image: styleNormalWithBorder },
  { id: "heart-bomb", name: "Heart Bomb", price: { bento: 3, retro: 5, medium: 10, large: 15, rectangle: 20 } as Record<string, number>, image: designHeartBomb },
  { id: "retro-vintage", name: "Retro / Vintage", price: { retro: 6, medium: 10, large: 15, rectangle: 30 } as Record<string, number>, image: designRetroCake },
  { id: "glitter-cherries-retro", name: "Glitter Cherries × Retro", price: { retro: 13, medium: 20, large: 30, rectangle: 55 } as Record<string, number>, image: designGlitterCherries },
  { id: "pearl-border-retro", name: "Pearl Border × Retro", price: { retro: 40, medium: 67, large: 98, rectangle: 225 } as Record<string, number>, image: designPearlBorders },
  { id: "retro-ribbons", name: "Retro × Ribbons", price: { retro: 11, medium: 18, large: 25, rectangle: 50 } as Record<string, number>, image: designRibbons },
  { id: "roses-please", name: "Roses Please", price: { bento: 6, retro: 8, medium: 15, large: 20, rectangle: 40 } as Record<string, number>, image: designRosesPlease },
  { id: "retro-glitter-cake", name: "Retro Glitter Cake", price: { retro: 11, medium: 20, large: 27, rectangle: 55 } as Record<string, number>, image: designRetroGlitter },
  { id: "printed-picture", name: "Printed Picture", price: { bento: 15, retro: 15, medium: 15, large: 15 } as Record<string, number>, image: designPrintedPicture },
  { id: "shag-cake", name: "Shag Cake", price: { retro: 12, medium: 20, large: 30, rectangle: 50 } as Record<string, number>, image: designShagCake, secondImage: designShagCake2 },
  { id: "rainbow-cake", name: "Rainbow Cake", price: { retro: 15, medium: 20, large: 30, rectangle: 50 } as Record<string, number>, image: designRainbowCake },
  { id: "custom-drawing", name: "Custom Drawing", price: { bento: 8, retro: 8, medium: 10, large: 15 } as Record<string, number>, image: designDrawing },
  { id: "cherries-retro", name: "Cherries × Retro", price: { retro: 10, medium: 18, large: 27, rectangle: 50 } as Record<string, number>, image: designCherries },
  { id: "scattered-retro-pearls", name: "Scattered Retro Pearls", price: { retro: 10, medium: 16, large: 23, rectangle: 45 } as Record<string, number>, image: designScatteredPearls },
  { id: "gold-leaves-style", name: "Gold Leaves", price: { bento: 3, retro: 4, medium: 5, large: 8, rectangle: 12 } as Record<string, number>, image: designGoldLeaves },
  { id: "golden-cake", name: "Golden Cake", price: { retro: 15, medium: 25, large: 40, rectangle: 70 } as Record<string, number>, image: designGoldenCake },
  { id: "pearl-number", name: "Pearl Number", price: { bento: 6, retro: 6, medium: 6, large: 6, rectangle: 10 } as Record<string, number>, image: designPearlNumber },
  { id: "retro-ribbons-glitter", name: "Retro × Ribbons Glitter in the Air", price: { retro: 21, medium: 33, large: 45 } as Record<string, number>, image: designGlitterInAir },
  { id: "butterfly-garden", name: "Butterfly Garden", price: { retro: 10, medium: 15, large: 20, rectangle: 35 } as Record<string, number>, image: designButterflyGarden },
  { id: "glitter-base", name: "Glitter Base", price: { bento: 8, retro: 8, medium: 10, large: 12, rectangle: 25 } as Record<string, number>, image: designGlitterCake },
  { id: "gender-reveal", name: "Gender Reveal", price: { bento: 5, retro: 5, medium: 10, large: 15, rectangle: 40 } as Record<string, number>, image: designGenderReveal },
  { id: "sprinkles-with-border", name: "Sprinkles with Border", price: { bento: 3, retro: 4, medium: 5, large: 6, rectangle: 10 } as Record<string, number>, image: designSprinklesWithBorder },
];

export const extraDescriptions: Record<string, string> = {
  "cherries": "Candied cherries placed on top of the cake.",
  "glitter-cherries": "Candied cherries covered with edible glitter.",
  "sprinkles": "Small colourful sprinkles scattered over the cake.",
  "gold-leaves": "Small pieces of edible gold leaf for a luxury touch.",
  "heart": "Heart shapes piped on the cake.",
  "ribbons": "Decorative satin ribbons placed around the cake.",
  "retro": "Vintage cake piping.",
  "butterfly": "Edible butterflies placed on the cake.",
  "scattered-pearl": "Small edible pearls scattered across the cake.",
  "pearl-border": "A border made of small edible pearls.",
  "pearl-number": "A number created using edible pearls.",
  "glitter": "Edible glitter sprinkled all over the cake for a sparkly effect.",
  "glitter-base": "Glitter covering the top of the cake.",
  "glitter-in-the-air": "Blow on the cake and the glitter flies.",
  "drawing": "Hand-drawn design on the cake.",
  "printed-picture": "Edible printed image placed on top of the cake.",
};

export const extras = [
  { id: "gold-leaves", name: "Gold Leaves", price: { bento: 3, retro: 4, medium: 5, large: 8, rectangle: 12 } as Record<string, number>, image: extraGoldLeaves },
  { id: "cherries", name: "Cherries", price: { retro: 4, medium: 8, large: 12, rectangle: 20 } as Record<string, number>, image: extraCherries },
  { id: "glitter-cherries", name: "Glitter Cherries", price: { retro: 7, medium: 10, large: 15, rectangle: 25 } as Record<string, number>, image: extraGlitterCherries },
  { id: "scattered-pearl", name: "Scattered Pearls", price: { bento: 2, retro: 4, medium: 6, large: 8, rectangle: 15 } as Record<string, number>, image: designScatteredPearls },
  { id: "glitter", name: "Glitter", price: { bento: 5, retro: 5, medium: 10, large: 12, rectangle: 25 } as Record<string, number>, image: extraGlitter },
  { id: "glitter-base", name: "Glitter Base", price: { bento: 8, retro: 8, medium: 10, large: 12, rectangle: 25 } as Record<string, number>, image: designGlitterCake },
  { id: "glitter-in-the-air", name: "Glitter in the Air", price: { bento: 10, retro: 10, medium: 15, large: 20 } as Record<string, number>, image: designGlitterInAir },
  { id: "pearl-border", name: "Pearl Border (each)", price: { retro: 10, medium: 17, large: 25, rectangle: 60 } as Record<string, number>, image: designPearlBorders },
  { id: "retro", name: "Retro", price: { retro: 6, medium: 10, large: 15, rectangle: 30 } as Record<string, number>, image: extraRetro },
  { id: "ribbons", name: "Ribbons", price: { retro: 5, medium: 8, large: 10, rectangle: 20 } as Record<string, number>, image: extraRibbons },
  { id: "drawing", name: "Drawing", price: { bento: 5, retro: 5, medium: 8, large: 10 } as Record<string, number>, image: extraDrawing },
  { id: "heart", name: "Heart", price: { bento: 3, retro: 5, medium: 10, large: 15 } as Record<string, number>, image: extraHeart },
  { id: "butterfly", name: "Butterfly", price: { retro: 6, medium: 8, large: 10, rectangle: 20 } as Record<string, number>, image: extraButterfly },
  { id: "pearl-number", name: "Pearl Number", price: { bento: 6, retro: 6, medium: 6, large: 6, rectangle: 10 } as Record<string, number>, image: designPearlNumber },
  { id: "printed-picture", name: "Printed Picture", price: { bento: 15, retro: 15, medium: 15, large: 15 } as Record<string, number>, image: extraPrintedPicture },
  { id: "sprinkles", name: "Sprinkles", price: { bento: 3, retro: 4, medium: 5, large: 6, rectangle: 10 } as Record<string, number>, image: extraSprinkles },
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
  { id: "pink-gold-spiral", name: "Pink Gold Spiral", image: candleShinySpiral /* TODO: remplacer par une vraie photo produit */, unitPrice: 1, hasPack: true, packSize: 6, packPrice: 5 },
  { id: "silver-spiral", name: "Silver Spiral", image: candleShinySpiral /* TODO: remplacer par une vraie photo produit */, unitPrice: 1, hasPack: true, packSize: 6, packPrice: 5 },
  { id: "gold-spiral", name: "Gold Spiral", image: candleShinySpiral /* TODO: remplacer par une vraie photo produit */, unitPrice: 1, hasPack: true, packSize: 6, packPrice: 5 },
  { id: "spiral-champagne", name: "Spiral Champagne", image: candleShinySpiral /* TODO: remplacer par une vraie photo produit */, unitPrice: 1, hasPack: true, packSize: 6, packPrice: 5 },
];

export const extraGroups = [
  {
    label: "Decorations",
    ids: ["cherries", "glitter-cherries", "butterfly", "ribbons"],
  },
  {
    label: "Pearls",
    ids: ["scattered-pearl", "pearl-border", "pearl-number"],
  },
  {
    label: "Toppings",
    ids: ["sprinkles", "gold-leaves", "retro"],
  },
  {
    label: "Glitter",
    ids: ["glitter", "glitter-base", "glitter-in-the-air"],
  },
  {
    label: "Printed Picture",
    ids: ["printed-picture"],
  },
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
  return style.price[sizeId] || 0;
};

export const getExtraPrice = (extraId: string, sizeId: string): number => {
  const extra = extras.find(e => e.id === extraId);
  if (!extra || !sizeId) return 0;
  return extra.price[sizeId] || 0;
};

export const getFlavorCategoryExtra = (flavorId: string, sizeId: string): number => {
  // The DIY Kit is a single fixed-size product priced on the same flavour
  // tier as the Bento cake size — its cart item stores size "kit-bento",
  // which isn't a key in any category's size-keyed extraPrice map, so this
  // alias makes the cart/checkout display line up with what KitBentoCake.tsx
  // actually charges (computed entirely separately from this function).
  // Display-only — never affects the real charge.
  const normalizedSizeId = sizeId === "kit-bento" ? "bento" : sizeId;
  const category = flavorCategories.find(cat =>
    cat.flavors.some(f => f.id === flavorId)
  );
  if (!category || !normalizedSizeId) return 0;
  return category.extraPrice[normalizedSizeId as keyof typeof category.extraPrice] || 0;
};

export interface CandleSelection {
  id: string;
  quantity: number;
  hasPack: boolean;
  digit?: string;
}

export const getCandleTotalPrice = (candleId: string, candleSelections: CandleSelection[]): number => {
  if (candleId === NUMBER_CANDLE_ID) {
    const qty = candleSelections.filter(c => c.id === NUMBER_CANDLE_ID).reduce((sum, c) => sum + c.quantity, 0);
    return qty * NUMBER_CANDLE_PRICE;
  }
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
  const candlesPrice = candles.reduce((acc, candle) => acc + getCandleTotalPrice(candle.id, candleSelections), 0)
    + getCandleTotalPrice(NUMBER_CANDLE_ID, candleSelections);
  return sizePrice + shapeExtra + flavorExtra + styleExtra + extrasPrice + candlesPrice;
};

// Helper to get available size IDs for a given style
export const getAvailableSizesForStyle = (styleId: string): string[] => {
  const style = styles.find(s => s.id === styleId);
  if (!style) return sizes.map(s => s.id);
  return Object.keys(style.price);
};

// Design → excluded extra IDs mapping (keyed by styleId)
export const designExcludedExtras: Record<string, string[]> = {
  "normal-without-border": ["cherries", "glitter-cherries", "ribbons", "glitter-in-the-air", "glitter-base", "sprinkles", "printed-picture"],
  "normal-with-border": [],
  "sprinkles-with-border": ["sprinkles"],
  "retro-vintage": ["retro", "pearl-border"],
  "golden-cake": ["retro", "pearl-border", "glitter", "glitter-base", "glitter-cherries", "glitter-in-the-air", "sprinkles"],
  "rainbow-cake": ["retro", "sprinkles", "printed-picture"],
  "shag-cake": ["retro", "heart", "printed-picture"],
  "gold-leaves-style": ["gold-leaves"],
  "scattered-retro-pearls": ["retro", "scattered-pearl"],
  "pearl-border-retro": ["retro", "scattered-pearl", "pearl-border"],
  "glitter-cherries-retro": ["retro", "glitter-cherries"],
  "cherries-retro": ["retro", "cherries"],
  "retro-ribbons": ["retro", "ribbons"],
  "retro-glitter-cake": ["retro", "glitter"],
  "glitter-base": ["glitter-base", "printed-picture"],
  "retro-ribbons-glitter": ["retro", "ribbons", "glitter-in-the-air", "sprinkles", "glitter-base", "printed-picture"],
  "printed-picture": ["printed-picture", "glitter-base", "glitter-in-the-air"],
  "custom-drawing": ["drawing", "glitter-in-the-air"],
  "butterfly-garden": ["butterfly", "scattered-pearl"],
  "roses-please": ["retro", "pearl-border"],
  "heart-bomb": ["heart"],
  "pearl-number": ["pearl-number"],
  "gender-reveal": [],
};

export const getExcludedExtras = (styleId: string): string[] => {
  return designExcludedExtras[styleId] || [];
};
