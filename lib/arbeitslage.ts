export type ArbeitsfokusWert = "AUTO" | "EIGEN" | "AUFBAU" | "FUEHRUNG";
export type Arbeitslage = "START" | "AUFBAU" | "FUEHRUNG";

export function istArbeitsfokus(wert: unknown): wert is ArbeitsfokusWert {
  return (
    typeof wert === "string" &&
    ["AUTO", "EIGEN", "AUFBAU", "FUEHRUNG"].includes(wert)
  );
}

/** Die Arbeitsansicht ändert die Reihenfolge, niemals die Zugriffsrechte. */
export function arbeitslageFuer(
  fokus: ArbeitsfokusWert,
  aktiveDirekte: number,
): Arbeitslage {
  if (fokus === "FUEHRUNG" || fokus === "AUFBAU") return fokus;
  if (fokus === "EIGEN") return "START";
  return aktiveDirekte > 0 ? "AUFBAU" : "START";
}

export const arbeitslageTitel: Record<Arbeitslage, string> = {
  START: "Eigenes Geschäft",
  AUFBAU: "Geschäft und Partneraufbau",
  FUEHRUNG: "Team führen",
};
