import { useState } from "react";
import type { DayContentProps } from "react-day-picker";
import { useLang } from "@/context/LanguageContext";
import { isExpressDate, expressSelectedCopy, expressTooltipCopy, EXPRESS_COPY } from "@/lib/orderDates";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

// Day number with a small tooltip on an express-surcharge day, stating
// THAT day's own rate and lead-time window (never a single fixed number —
// see expressTooltipCopy). A real Tooltip (not a native `title`) so it
// also works on tap: `open` is controlled and toggled from the trigger's
// own onClick in addition to Radix's normal hover/focus handling, so a
// touch tap surfaces the same info a mouse hover would on desktop. The
// onClick never stops propagation, so the day cell's own click — which
// selects the date — still fires exactly as before; this component only
// ever adds a tooltip, never changes what a click on the day does.
function ExpressDayContent(props: DayContentProps) {
  const { lang } = useLang();
  const l = lang === "fr" ? "fr" : "en";
  const express = !!props.activeModifiers?.express;
  const [open, setOpen] = useState(false);
  const copy = express ? expressTooltipCopy(props.date, l) : null;

  if (!copy) {
    return <span>{props.date.getDate()}</span>;
  }

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>
          <span onClick={() => setOpen((o) => !o)} className="cursor-help">
            {props.date.getDate()}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="px-2.5 py-1.5 max-w-[190px]">
          <p className="text-xs font-semibold leading-tight text-foreground">{copy.title}</p>
          <p className="text-xs leading-snug text-muted-foreground mt-0.5">{copy.detail}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// Spread onto the shadcn <Calendar> so express-surcharge days (J+2..J+5)
// get a discreet marker + a hover tooltip. No emoji, no icons.
export const expressCalendarProps = {
  modifiers: { express: (date: Date) => isExpressDate(date) },
  modifiersClassNames: {
    express: "",
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

// Visible notice shown when the currently selected order date carries an
// express surcharge — the mobile-friendly equivalent of the desktop
// hover. Text states THIS date's own rate (20% or 15%) and lead-time
// window (see expressSelectedCopy).
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
