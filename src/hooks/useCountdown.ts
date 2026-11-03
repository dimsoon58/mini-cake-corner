import { useEffect, useState } from "react";

interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  passed: boolean;
}

function getTimeLeft(target: Date): TimeLeft {
  const diff = Math.max(0, target.getTime() - Date.now());
  const total = Math.floor(diff / 1000);
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
    passed: diff === 0,
  };
}

export function useCountdown(target: Date): TimeLeft {
  const [timeLeft, setTimeLeft] = useState(() => getTimeLeft(target));
  useEffect(() => {
    if (timeLeft.passed) return;
    const id = setInterval(() => setTimeLeft(getTimeLeft(target)), 1000);
    return () => clearInterval(id);
  }, [target, timeLeft.passed]);
  return timeLeft;
}
