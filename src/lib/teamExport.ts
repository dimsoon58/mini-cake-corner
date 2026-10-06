import { DOW_FR, KIND_SHORT, PORTION_LABELS, eachDay, hhmm, isoDow, netMinutes, type TeamData } from "@/lib/team";

// Lot E — planning téléchargeable à partager avec Nahya (exceljs chargé au
// clic). Une feuille « Planning » : un jour par ligne, horaires prévus de
// Nahya (avec pause et durée nette) et absences de l'équipe. Aucun compteur,
// aucun réalisé : c'est le planning prévu.

type ExcelJSModule = typeof import("exceljs");

export function buildPlanningWorkbook(ExcelJS: ExcelJSModule, data: TeamData, from: string, to: string) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Bento Cake Studio";
  const ws = wb.addWorksheet("Planning", { pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const nahya = data.members.find((m) => m.tracksHours);
  const holidays = new Map(data.holidays.map((h) => [h.holiday_date, h.label]));

  ws.addRow([`Planning — du ${from.split("-").reverse().join(".")} au ${to.split("-").reverse().join(".")}`]).font = { bold: true, size: 14 };
  ws.addRow([]);
  const head = ws.addRow(["Date", "Jour", `Horaires prévus${nahya ? ` (${nahya.name})` : ""}`, "Pause", "Durée nette", "Absences / jours fériés"]);
  head.font = { bold: true };
  head.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3E7EA" } }; });

  let totalWeek = 0;
  for (const d of eachDay(from, to)) {
    const slots = (nahya?.slots ?? []).filter((s) => s.work_date === d).sort((a, b) => a.start_time.localeCompare(b.start_time));
    const net = slots.reduce((a, s) => a + netMinutes(s), 0);
    totalWeek += net;
    const notes: string[] = [];
    if (holidays.has(d)) notes.push(`Férié : ${holidays.get(d)}`);
    for (const m of data.members) {
      for (const a of m.absences) {
        if (d < a.start_date || d > a.end_date) continue;
        notes.push(`${m.name} : ${KIND_SHORT[a.kind]}${a.portion !== "full" ? ` (${PORTION_LABELS[a.portion].toLowerCase()})` : ""}`);
      }
    }
    const row = ws.addRow([
      new Date(`${d}T00:00:00Z`),
      DOW_FR[isoDow(d)],
      slots.map((s) => `${hhmm(s.start_time)}–${hhmm(s.end_time)}`).join(" / "),
      slots.length ? slots.reduce((a, s) => a + s.break_min, 0) / 1440 : null,
      slots.length ? net / 1440 : null,
      notes.join(" · "),
    ]);
    row.getCell(1).numFmt = "dd.mm.yyyy";
    row.getCell(4).numFmt = "[h]:mm";
    row.getCell(5).numFmt = "[h]:mm";
    if (isoDow(d) === 7) {
      const t = ws.addRow(["", "Total semaine", "", "", totalWeek / 1440, ""]);
      t.font = { bold: true };
      t.getCell(5).numFmt = "[h]:mm";
      totalWeek = 0;
    }
  }
  ws.columns = [{ width: 12 }, { width: 14 }, { width: 28 }, { width: 8 }, { width: 12 }, { width: 60 }];
  ws.addRow([]);
  ws.addRow(["Durées en heures:minutes. Pause non payée déduite de la durée nette."]).font = { italic: true, color: { argb: "FF666666" } };
  return wb;
}

export const planningFileName = (from: string, to: string) => `planning-${from}_${to}.xlsx`;
