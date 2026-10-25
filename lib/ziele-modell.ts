// Kalendergrenzen sind Tagesmarker wie DailyLog.date und Einheitenbuchung.tag.
// Die Eingabe ist bereits ein Berliner Kalendertag, keine Server-Lokalzeit.
export type ZielKennzahl =
  | "CALL"
  | "APPOINTMENT_SET"
  | "APPOINTMENT_HELD"
  | "UNITS";
export type ZielZeitraum = "WOCHE" | "MONAT" | "ALT_30_TAGE";

export const ZIEL_KENNZAHLEN: Record<ZielKennzahl, string> = {
  CALL: "Anrufe",
  APPOINTMENT_SET: "Termine vereinbart",
  APPOINTMENT_HELD: "Termine gehalten",
  UNITS: "Einheiten",
};

export function zielPruefzeit(
  zeitraum: ZielZeitraum,
  jetzt = new Date(),
): Date {
  if (zeitraum === "ALT_30_TAGE") return jetzt;
  const tag = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
  }).format(jetzt);
  return new Date(`${tag}T00:00:00Z`);
}

export function zielZeitraum(zeitraum: "WOCHE" | "MONAT", tag: string) {
  const datum = new Date(`${tag}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(tag) ||
    !Number.isFinite(datum.getTime()) ||
    datum.toISOString().slice(0, 10) !== tag
  ) {
    throw new Error("Bitte einen gültigen Kalendertag wählen.");
  }
  const start = new Date(datum);
  if (zeitraum === "WOCHE")
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  else start.setUTCDate(1);
  const ende = new Date(start);
  if (zeitraum === "WOCHE") ende.setUTCDate(ende.getUTCDate() + 7);
  else ende.setUTCMonth(ende.getUTCMonth() + 1);
  return { start, ende };
}

export function zielFortschritt(
  zielwert: number,
  buchungen: readonly { tag: Date; wert: number }[],
  zeitraum: { start: Date; ende: Date },
) {
  const erreicht = buchungen.reduce(
    (summe, buchung) =>
      buchung.tag >= zeitraum.start && buchung.tag < zeitraum.ende
        ? summe + buchung.wert
        : summe,
    0,
  );
  return {
    erreicht,
    anteil: zielwert > 0 ? Math.max(0, Math.min(1, erreicht / zielwert)) : 0,
    fehlend: Math.max(0, zielwert - erreicht),
    geschafft: zielwert > 0 && erreicht >= zielwert,
  };
}

export function darfZielVorschlagen(
  betrachter: { id: string; path: string },
  inhaber: { id: string; path: string; deactivatedAt: Date | null },
) {
  if (inhaber.deactivatedAt) return false;
  return (
    betrachter.id === inhaber.id ||
    (betrachter.path !== "/" &&
      betrachter.path.startsWith("/") &&
      betrachter.path.endsWith("/") &&
      inhaber.path.startsWith(betrachter.path))
  );
}

export function darfZielBestaetigen(betrachterId: string, inhaberId: string) {
  return betrachterId === inhaberId;
}

export function zielIstAktiv(
  ziel: { start: Date; ende: Date; archiviertAt: Date | null; zusage: string },
  jetzt: Date,
) {
  return (
    ziel.zusage === "BESTAETIGT" &&
    ziel.archiviertAt === null &&
    ziel.start <= jetzt &&
    jetzt < ziel.ende
  );
}

export function formatZielwert(wert: number, kennzahl: ZielKennzahl): string {
  return new Intl.NumberFormat("de-DE", {
    maximumFractionDigits: kennzahl === "UNITS" ? 2 : 0,
  }).format(kennzahl === "UNITS" ? wert / 100 : wert);
}
