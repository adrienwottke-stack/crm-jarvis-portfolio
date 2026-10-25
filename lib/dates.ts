// Tagesgrenzen laufen über den Berliner Kalendertag, gespeichert als UTC-Mitternacht.
// So bleiben die Zähler unabhängig von Server-Zeitzone (Vercel = UTC) und Sommerzeit fair.

const berlinDayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Berlin",
});

export function berlinToday(): string {
  return berlinDayFormat.format(new Date());
}

// Berliner Kalendertag eines beliebigen Zeitstempels (z. B. Activity.date).
export function berlinDayOf(date: Date): string {
  return berlinDayFormat.format(date);
}

export function shiftDay(day: string, days: number): string {
  const date = dayToUtcDate(day);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Montag der Woche, in der `day` liegt – als Tag-String.
export function mondayOf(day: string): string {
  return startOfWeek(day).toISOString().slice(0, 10);
}

export function dayToUtcDate(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

export function isValidDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(dayToUtcDate(value).getTime());
}

export function startOfWeek(day: string): Date {
  const date = dayToUtcDate(day);
  const weekday = date.getUTCDay(); // 0 = Sonntag
  const daysSinceMonday = (weekday + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  return date;
}

export function startOfMonth(day: string): Date {
  const date = dayToUtcDate(day);
  date.setUTCDate(1);
  return date;
}

export const dayDisplayFormat = new Intl.DateTimeFormat("de-DE", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  timeZone: "UTC",
});

// --- Termine mit Uhrzeit ----------------------------------------------------
// Ein <input type="datetime-local"> liefert "2026-08-20T14:30" ohne Zone.
// Auf Vercel laeuft der Server in UTC, deshalb wird hier bewusst gegen
// Europe/Berlin umgerechnet statt gegen die Server-Zeitzone.

const berlinPartsFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Berlin",
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

// Verschiebung Berlins gegenueber UTC in Minuten zum gegebenen Zeitpunkt.
function berlinOffsetMinutes(instant: Date): number {
  const parts = berlinPartsFormat.formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second")
  );
  return (asUtc - instant.getTime()) / 60000;
}

export function berlinLocalToUtc(local: string): Date | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(local.trim());
  if (!match) return null;
  const naive = new Date(`${match[1]}T${match[2]}:${match[3]}:00Z`);
  if (isNaN(naive.getTime())) return null;
  // Zweistufig, damit die Umstellung Sommer-/Winterzeit korrekt greift.
  const rough = new Date(naive.getTime() - berlinOffsetMinutes(naive) * 60000);
  return new Date(naive.getTime() - berlinOffsetMinutes(rough) * 60000);
}

// Umgekehrt: UTC-Zeitpunkt als Vorbelegung fuer datetime-local.
export function utcToBerlinLocalInput(date: Date): string {
  const parts = berlinPartsFormat.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour") === "24" ? "00" : get("hour")}:${get("minute")}`;
}

// Faellig heute = alles vor morgen 00:00 Berliner Zeit.
export function endOfBerlinDay(day: string): Date {
  return berlinLocalToUtc(`${shiftDay(day, 1)}T00:00`) ?? dayToUtcDate(shiftDay(day, 1));
}

export function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const targetMonth = result.getUTCMonth() + months;
  const dayOfMonth = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(targetMonth);
  // Monatsenden sauber kappen (31.08. + 6 Monate = 28./29.02.).
  const daysInTargetMonth = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)
  ).getUTCDate();
  result.setUTCDate(Math.min(dayOfMonth, daysInTargetMonth));
  return result;
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

// Zeitpunkt hat eine echte Uhrzeit (nicht nur ein Datum ohne Uhrzeit).
export function hasTimeOfDay(date: Date): boolean {
  return date.getUTCHours() !== 0 || date.getUTCMinutes() !== 0;
}

// --- Faelligkeit ------------------------------------------------------------
// Wird auf dem Server berechnet und als Zustand an Client-Komponenten
// weitergereicht, damit Server- und Client-Render identisch bleiben.

export type DueState = "overdue" | "today" | "week" | "later";

export function dueState(at: Date | string, today = berlinToday()): DueState {
  const day = berlinDayOf(typeof at === "string" ? new Date(at) : at);
  if (day < today) return "overdue";
  if (day === today) return "today";
  if (day <= shiftDay(today, 7)) return "week";
  return "later";
}

export const dueLabels: Record<DueState, string> = {
  overdue: "Überfällig",
  today: "Heute",
  week: "Diese Woche",
  later: "Später",
};

// --- Kalenderraster ---------------------------------------------------------
// Zwei Helfer, die nur die Rasteransichten brauchen. Sie stehen hier und nicht
// in lib/kalender/, weil sie reine Datumsarithmetik sind - und weil die
// Zeitzonen-Falle oben schon geloest ist und nicht zweimal geloest werden soll.

/**
 * Minuten seit Mitternacht Berliner Zeit. Das ist die Y-Achse des Zeitrasters:
 * ein Termin um 14:30 sitzt bei 870 von 1440.
 *
 * Bewusst gegen Europe/Berlin gerechnet und nicht gegen UTC: auf Vercel laeuft
 * der Server in UTC, und ein Termin um 00:30 Berliner Zeit gehoert im Sommer
 * sonst in den Vortag.
 */
export function berlinMinutesOfDay(date: Date): number {
  const parts = berlinPartsFormat.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return (get("hour") % 24) * 60 + get("minute");
}

/**
 * Die Tage eines Monatsgitters, immer von einem Montag bis zu einem Sonntag.
 *
 * Sechs Wochen fest und nicht "so viele wie noetig": ein Gitter, das je nach
 * Monat fuenf oder sechs Zeilen hat, springt beim Blaettern in der Hoehe. Das
 * faellt staerker auf als die eine leere Zeile im Februar.
 */
export function tageImRaster(day: string): string[] {
  const ersterDesMonats = startOfMonth(day).toISOString().slice(0, 10);
  const start = mondayOf(ersterDesMonats);
  return Array.from({ length: 42 }, (_, i) => shiftDay(start, i));
}
