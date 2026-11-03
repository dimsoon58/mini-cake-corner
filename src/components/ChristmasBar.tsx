import { Link } from "react-router-dom";
import { useLang } from "@/context/LanguageContext";
import { useCountdown } from "@/hooks/useCountdown";
import { CHRISTMAS_LAUNCH } from "@/hooks/useChristmasVisible";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function ChristmasBar() {
  const { t } = useLang();
  const { days, hours, minutes, seconds, passed } = useCountdown(CHRISTMAS_LAUNCH);

  const countdownStr = passed
    ? null
    : `${days}${t("d", "j")} ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;

  const text = countdownStr
    ? t(
        `CHRISTMAS IS COMING ✦ DISCOVER OUR CHRISTMAS COLLECTION IN ${countdownStr} ✦ `,
        `NOËL ARRIVE ✦ DÉCOUVREZ NOTRE COLLECTION DE NOËL DANS ${countdownStr} ✦ `
      )
    : t(
        "THE CHRISTMAS COLLECTION IS HERE ✦ DISCOVER OUR FESTIVE CREATIONS ✦ SHOP THE COLLECTION ✦ ",
        "LA COLLECTION DE NOËL EST LÀ ✦ DÉCOUVREZ NOS CRÉATIONS FESTIVES ✦ COMMANDEZ MAINTENANT ✦ "
      );

  return (
    <Link
      to="/noel"
      aria-label={t("Christmas collection", "Collection de Noël")}
      className="block overflow-hidden bg-primary text-primary-foreground hover:bg-primary/90 transition-colors py-2.5"
    >
      {/* 4 copies → seamless loop: animation translateX(-50%) = 2 copies, perfect wrap */}
      <div className="flex animate-marquee whitespace-nowrap will-change-transform">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className="inline-block text-[11px] md:text-sm uppercase tracking-[0.18em] font-semibold px-0"
          >
            {text}
          </span>
        ))}
      </div>
    </Link>
  );
}
