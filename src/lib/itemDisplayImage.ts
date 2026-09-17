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
import candlesFallback from "@/assets/candle-heart-new.png";
import bentoCakeFallback from "@/assets/bento-gallery-1.jpg";
import rectangleCakeFallback from "@/assets/rectangle-signature.jpg";
import workshopSignatureFallback from "@/assets/workshop-signature.jpg";
import workshopPaintFallback from "@/assets/workshop-paint.png";
import printingFallback from "@/assets/printing-gallery-1.jpg";

export interface DisplayImageItem {
  product: string;
  designImageUrl?: string | null;
  referenceImages?: string[] | null;
  workshopType?: string | null;
}

export function itemDisplayImage(item: DisplayImageItem): string | null {
  if (item.designImageUrl) return item.designImageUrl;
  if (item.product === "edible_printing" && item.referenceImages?.length) {
    return item.referenceImages[0];
  }
  switch (item.product) {
    case "dot_cakes": return dotCakesFallback;
    case "diy_kit": return diyKitFallback;
    case "candles": return candlesFallback;
    case "bento_cake": return bentoCakeFallback;
    case "rectangle_cake": return rectangleCakeFallback;
    case "edible_printing": return printingFallback;
    case "workshop": return item.workshopType === "paint" ? workshopPaintFallback : workshopSignatureFallback;
    default: return null;
  }
}
