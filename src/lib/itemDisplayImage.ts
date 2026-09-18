// Shared "what photo represents this order item" resolution — extracted
// from MyOrders.tsx's local itemDisplayImage() (kept there unchanged, this
// is a parallel copy for the admin calendar/order list, which only ever
// have the lean summary fields below, not the full CustomerOrderItem shape
// MyOrders.tsx works with). Same priority order, same fallback images:
//   1. design_image_url — the exact photo the customer picked/was assigned,
//      set at checkout time for every physical product type.
//   2. reference_images[0] — edible_printing's own uploaded artwork.
//   3. A real, representative static photo for that product line — never
//      an emoji standing in for a missing image.
import dotCakesFallback from "@/assets/dot-gallery-1.jpg";
import diyKitFallback from "@/assets/diy-kit-box.jpg";
import bentoCakeFallback from "@/assets/bento-gallery-1.jpg";
import rectangleCakeFallback from "@/assets/rectangle-signature.jpg";
import workshopSignatureFallback from "@/assets/workshop-signature.jpg";
import workshopPaintFallback from "@/assets/workshop-paint.png";
import printingFallback from "@/assets/printing-gallery-1.jpg";

// Every candle model's own photo — same assets as the catalogue picker
// (KitBentoCake.tsx's `candles` array / Candles.tsx's Number Candle picker)
// — so an order line shows the ACTUAL candle the customer chose instead of
// one hardcoded heart image for every "candles" product line regardless of
// what was picked.
import candlePuppy from "@/assets/candle-puppy-new.png";
import candleTeddyBear from "@/assets/candle-teddy-bear-new.png";
import candleCherry from "@/assets/candle-cherry-new.png";
import candleHeart from "@/assets/candle-heart-new.png";
import candleSoccer from "@/assets/candle-soccer-new.png";
import candleBlueCar from "@/assets/candle-blue-car-new.png";
import candleRedCar from "@/assets/candle-red-car-new.png";
import candleYellowCar from "@/assets/candle-yellow-car-new.png";
import candleBlueOmbre from "@/assets/candle-blue-ombre-new.png";
import candlePinkOmbre from "@/assets/candle-pink-ombre-new.png";
import candleSpiralPastel from "@/assets/candle-spiral-pastel-new.png";
import candleShinySpiral from "@/assets/candle-shiny-spiral-new.png";
import candlePinkGoldSpiral from "@/assets/candle-pink-gold-spiral.png";
import candleSilverSpiral from "@/assets/candle-silver-spiral.png";
import candleGoldSpiral from "@/assets/candle-gold-spiral.png";
import candleChampagneSpiral from "@/assets/candle-champagne-spiral.png";
import candleThickSpiral from "@/assets/candle-thick-spiral-new.png";
import candleDaisy from "@/assets/candle-daisy.png";
import candleRibbon from "@/assets/candle-ribbon.png";
import candlePinkCar from "@/assets/candle-pink-car.png";
import candleRainbow from "@/assets/candle-rainbow.png";
import candleNum0 from "@/assets/candle-number-0.png";
import candleNum1 from "@/assets/candle-number-1.png";
import candleNum2 from "@/assets/candle-number-2.png";
import candleNum3 from "@/assets/candle-number-3.png";
import candleNum4 from "@/assets/candle-number-4.png";
import candleNum5 from "@/assets/candle-number-5.png";
import candleNum6 from "@/assets/candle-number-6.png";
import candleNum7 from "@/assets/candle-number-7.png";
import candleNum8 from "@/assets/candle-number-8.png";
import candleNum9 from "@/assets/candle-number-9.png";

// Fallback for a "candles" line with no candle_name at all (very old orders
// predating this column) or a name that matches no known model.
export const candlesFallback = candleHeart;

// order_items.candle_name's BASE name (before composeCandleName's " – "
// suffix) -> that candle model's own photo. Must stay in sync with the
// `candles` catalogue array in KitBentoCake.tsx (its English `name` field —
// composeCandleName always persists the English name, never the French one,
// see Checkout.tsx).
const CANDLE_NAME_IMAGE: Record<string, string> = {
  "Silver Spiral": candleSilverSpiral,
  "Blue Ombré": candleBlueOmbre,
  "Thick Spiral": candleThickSpiral,
  "Pink Gold Spiral": candlePinkGoldSpiral,
  "Gold Spiral": candleGoldSpiral,
  "Spiral Champagne": candleChampagneSpiral,
  "Shiny Spiral": candleShinySpiral,
  "Pastel Spiral": candleSpiralPastel,
  "Rainbow": candleRainbow,
  "Pink Ombré": candlePinkOmbre,
  "Daisy": candleDaisy,
  "Red Heart": candleHeart,
  "Puppy": candlePuppy,
  "Teddy Bear": candleTeddyBear,
  "Cherry": candleCherry,
  "Ribbon": candleRibbon,
  "Footy Flame": candleSoccer,
  "Pink Car": candlePinkCar,
  "Red Car": candleRedCar,
  "Blue Car": candleBlueCar,
  "Yellow Car": candleYellowCar,
};

const NUMBER_CANDLE_IMAGE: Record<string, string> = {
  "0": candleNum0, "1": candleNum1, "2": candleNum2, "3": candleNum3, "4": candleNum4,
  "5": candleNum5, "6": candleNum6, "7": candleNum7, "8": candleNum8, "9": candleNum9,
};

// candle_name is persisted as "<Base Name>" or "<Base Name> – <suffix>"
// (digits or colours appended by composeCandleName — see
// src/lib/candleCartHelpers.ts). Only the base name identifies which model's
// photo to show; a multi-digit Number Candle line ("Number Candle – 1, 8")
// shows its first digit as the one representative thumbnail.
export function candleImageFromName(candleName: string | null | undefined): string | null {
  if (!candleName) return null;
  const baseName = candleName.split(" – ")[0].trim();
  if (baseName === "Number Candle") {
    const digit = candleName.match(/\d/)?.[0];
    return digit ? NUMBER_CANDLE_IMAGE[digit] ?? null : null;
  }
  return CANDLE_NAME_IMAGE[baseName] ?? null;
}

export interface DisplayImageItem {
  product: string;
  designImageUrl?: string | null;
  referenceImages?: string[] | null;
  workshopType?: string | null;
  candleName?: string | null;
}

export function itemDisplayImage(item: DisplayImageItem): string | null {
  if (item.designImageUrl) return item.designImageUrl;
  if (item.product === "edible_printing" && item.referenceImages?.length) {
    return item.referenceImages[0];
  }
  switch (item.product) {
    case "dot_cakes": return dotCakesFallback;
    case "diy_kit": return diyKitFallback;
    case "candles": return candleImageFromName(item.candleName) ?? candlesFallback;
    case "bento_cake": return bentoCakeFallback;
    case "rectangle_cake": return rectangleCakeFallback;
    case "edible_printing": return printingFallback;
    case "workshop": return item.workshopType === "paint" ? workshopPaintFallback : workshopSignatureFallback;
    default: return null;
  }
}
