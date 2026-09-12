import type { DayContentProps } from "react-day-picker";
import { useLang } from "@/context/LanguageContext";
import { isExpressDate, expressHoverCopy, expressSelectedCopy, EXPRESS_COPY } from "@/lib/orderDates";

// Day number with a discreet native hover tooltip on a near-date-surcharge
// day (desktop) — the tooltip text is computed from THAT day's own rate
// (20% or 15%), never a single fixed percentage.
function ExpressDayContent(props: DayContentProps) {
  const { lang } = useLang();
  const l = lang === "fr" ? "fr" : "en";
  const express = !!props.activeModifiers?.express;
  return (
    <span title={express ? expressHoverCopy(props.date, l) : undefined}>
      {props.date.getDate()}
    </span>
  );
}

// Spread onto the shadcn <Calendar> so near-date-surcharge days (J+2..J+5)
// get a discreet marker + a hover tooltip. No emoji, no icons.
export const expressCalendarProps = {
  modifiers: { express: (date: Date) => isExpressDate(date) },
  modifiersClassNames: {
    express:
      "relative after:absolute after:bottom-1 after:left-1/2 after:-translate-x-1/2 " +
      "after:h-1 after:w-1 after:rounded-full after:bg-primary/70 after:content-['']",
  },
  components: { DayContent: ExpressDayContent },
};

// Legend shown under any order calendar.
export function ExpressLegend() {
  const { lang } = useLang();
  const l = lang === "fr" ? "fr" : "en";
  return (
    <p className="mt-2 text-xs text-muted-foreground">
      {EXPRESS_COPY.legend[l]}
    </p>
  );
}

// Visible notice shown when the currently selected order date carries a
// near-date surcharge — the mobile-friendly equivalent of the desktop
// hover. Text states THIS date's own rate (20% or 15%).
export function ExpressDateNotice({ date }: { date: Date | null | undefined }) {
  const { lang } = useLang();
  if (!isExpressDate(date)) return null;
  const l = lang === "fr" ? "fr" : "en";
  return (
    <div className="mt-3 border-l-2 border-primary bg-muted/40 px-3 py-2 text-xs leading-relaxed text-foreground/80">
      {expressSelectedCopy(date, l)}
    </div>
  );
}
