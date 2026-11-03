import { useEffect, useRef, useState } from "react";
import type { DayContentProps, DayPickerSingleProps } from "react-day-picker";
import { useLang } from "@/context/LanguageContext";
import { Calendar } from "@/components/ui/calendar";
import { isExpressDate, expressSelectedCopy, expressTooltipCopy, EXPRESS_COPY, CLOSED_DAY_COPY, FULLY_BOOKED_COPY, HOLIDAY_CLOSURE_COPY, calendarDaysUntil, isClosedDay, isHolidayClosure } from "@/lib/orderDates";
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

// Line at the bottom of every order calendar: why Sundays are greyed out.
function ClosedDayFooter() {
  const { lang } = useLang();
  return (
    <p className="mt-2 max-w-[252px] text-xs leading-snug text-muted-foreground">
      {CLOSED_DAY_COPY[lang === "fr" ? "fr" : "en"]}
    </p>
  );
}

// Spread onto the shadcn <Calendar> so express-surcharge days (J+2..J+5)
// get a discreet marker + a hover tooltip, and the closed-on-Sunday line
// shows under the month. No emoji, no icons.
export const expressCalendarProps = {
  modifiers: { express: (date: Date) => isExpressDate(date) },
  modifiersClassNames: {
    express: "",
  },
  components: { DayContent: ExpressDayContent },
  footer: <ClosedDayFooter />,
};

// Order calendar (website checkout + product pages): a greyed-out date is no
// longer a dead button. Tapping it shows why it can't be picked, in a small
// bubble right above the tapped day (03.11.2026: the line under the month
// went unseen) — « Nous sommes complets à cette date » (Sunday: the
// closed-on-Sunday line; holidays: the holiday closure) — and never selects
// it. The bubble goes away after a few seconds, on the next tap or month. `disabled` keeps the same meaning as on <Calendar>: the
// dates the customer may not pick. Past days stay plain disabled, no message.
type OrderCalendarProps = Omit<DayPickerSingleProps, "mode" | "disabled"> & {
  disabled?: (date: Date) => boolean;
};

const BUBBLE_WIDTH = 200;
const BUBBLE_MS = 4000;

export function OrderCalendar({ disabled, onSelect, onMonthChange, footer, modifiers, modifiersClassNames, ...props }: OrderCalendarProps) {
  const { lang } = useLang();
  const l = lang === "fr" ? "fr" : "en";
  const wrapRef = useRef<HTMLDivElement>(null);
  // x = centre of the tapped day, y = its top, both relative to the wrapper.
  const [bubble, setBubble] = useState<{ text: string; x: number; y: number; key: number } | null>(null);
  const isPast = (date: Date) => calendarDaysUntil(date) < 0;
  const unavailable = (date: Date) => !isPast(date) && !!disabled?.(date);

  useEffect(() => {
    if (!bubble) return;
    const id = setTimeout(() => setBubble(null), BUBBLE_MS);
    return () => clearTimeout(id);
  }, [bubble]);

  const showBubble = (text: string, target: EventTarget | null) => {
    const wrap = wrapRef.current;
    const day = target instanceof Element ? target.closest("button") : null;
    if (!wrap || !day) return;
    const w = wrap.getBoundingClientRect();
    const d = day.getBoundingClientRect();
    setBubble({ text, x: d.left + d.width / 2 - w.left, y: d.top - w.top, key: Date.now() });
  };

  // Keep the bubble inside the calendar; its arrow still points at the day.
  const wrapWidth = wrapRef.current?.offsetWidth ?? BUBBLE_WIDTH;
  const bubbleX = bubble ? Math.min(Math.max(bubble.x, BUBBLE_WIDTH / 2), Math.max(wrapWidth - BUBBLE_WIDTH / 2, BUBBLE_WIDTH / 2)) : 0;

  return (
    <div ref={wrapRef} className="relative">
    <Calendar
      {...props}
      mode="single"
      disabled={isPast}
      modifiers={{ ...modifiers, express: (date: Date) => isExpressDate(date) && !unavailable(date), unavailable }}
      modifiersClassNames={{
        ...modifiersClassNames,
        unavailable: "text-muted-foreground opacity-50 cursor-not-allowed hover:bg-transparent hover:text-muted-foreground",
      }}
      components={expressCalendarProps.components}
      onSelect={(day, selectedDay, activeModifiers, e) => {
        // selectedDay = the day actually tapped (day is undefined when the
        // already-selected day is tapped again).
        if (unavailable(selectedDay)) {
          const copy = isClosedDay(selectedDay) ? CLOSED_DAY_COPY : isHolidayClosure(selectedDay) ? HOLIDAY_CLOSURE_COPY : FULLY_BOOKED_COPY;
          showBubble(copy[l], e.target);
          return;
        }
        setBubble(null);
        onSelect?.(day, selectedDay, activeModifiers, e);
      }}
      onMonthChange={(month) => { setBubble(null); onMonthChange?.(month); }}
      footer={footer ?? <ClosedDayFooter />}
    />
      {bubble && (
        <div
          key={bubble.key}
          role="alert"
          className="pointer-events-none absolute z-50 -translate-x-1/2 -translate-y-full rounded-md bg-foreground px-3 py-2 text-center text-xs font-medium leading-snug text-background shadow-lg animate-in fade-in-0 zoom-in-95"
          style={{ left: bubbleX, top: bubble.y - 6, width: BUBBLE_WIDTH }}
        >
          {bubble.text}
          <span
            aria-hidden
            className="absolute top-full h-0 w-0 -translate-x-1/2 border-x-[6px] border-t-[6px] border-x-transparent border-t-foreground"
            style={{ left: BUBBLE_WIDTH / 2 + (bubble.x - bubbleX) }}
          />
        </div>
      )}
    </div>
  );
}

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
