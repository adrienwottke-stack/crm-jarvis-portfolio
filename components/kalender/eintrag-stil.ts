// Wie ein Eintrag aussieht - an einer Stelle, fuer alle vier Ansichten.
//
// Ohne das haette jede Ansicht ihre eigene Farbwahl, und "fremd" saehe im
// Monat anders aus als in der Woche. Die Herkunft muss aber auf den ersten
// Blick dieselbe Bedeutung haben, egal wo man hinschaut:
//
//   KONTAKT - ein Mensch wartet auf dich. Kraeftigster Ton, anklickbar.
//   EIGEN   - selbst eingetragen. Ruhiger, nach Art getoent.
//   FREMD   - Belegung von aussen. Gedaempft, nur Rand farbig, nicht anklickbar.

import type { KalenderEintrag } from "@/lib/kalender/laden";
import type { TerminArt } from "@/lib/generated/prisma/enums";

export type EintragStil = {
  /** Flaeche im Zeitraster (Woche, Tag). */
  block: string;
  /** Schmaler Streifen im Monatsgitter. */
  streifen: string;
  /** Punkt vor dem Text in der Liste. */
  punkt: string;
};

const artTon: Record<TerminArt, EintragStil> = {
  BEGLEITUNG: {
    block: "border-l-2 border-l-navy-600 bg-navy-50 text-navy-900",
    streifen: "bg-navy-100 text-navy-900",
    punkt: "bg-navy-600",
  },
  SCHULUNG: {
    block: "border-l-2 border-l-sky-500 bg-sky-50 text-sky-900",
    streifen: "bg-sky-100 text-sky-900",
    punkt: "bg-sky-500",
  },
  TEAM: {
    block: "border-l-2 border-l-amber-500 bg-amber-50 text-amber-900",
    streifen: "bg-amber-100 text-amber-900",
    punkt: "bg-amber-500",
  },
  // Der Blocker ist absichtlich der unauffaelligste Ton: er sagt nur "hier
  // nicht", er will keine Aufmerksamkeit.
  BLOCKER: {
    block: "border-l-2 border-l-slate-400 bg-slate-100 text-slate-600",
    streifen: "bg-slate-200 text-slate-600",
    punkt: "bg-slate-400",
  },
  SONSTIGES: {
    block: "border-l-2 border-l-slate-500 bg-slate-50 text-slate-800",
    streifen: "bg-slate-100 text-slate-700",
    punkt: "bg-slate-500",
  },
};

const kontaktStil: EintragStil = {
  block: "border-l-2 border-l-navy-600 bg-navy-50 text-navy-900",
  streifen: "bg-navy-100 text-navy-900",
  punkt: "bg-navy-600",
};

const fremdStil: EintragStil = {
  block:
    "border-l-2 border-l-emerald-400 border-dashed bg-emerald-50/50 text-emerald-900",
  streifen: "bg-emerald-50 text-emerald-800",
  punkt: "bg-emerald-400",
};

export function stilFuer(eintrag: KalenderEintrag): EintragStil {
  if (eintrag.herkunft === "KONTAKT") return kontaktStil;
  if (eintrag.herkunft === "FREMD") return fremdStil;
  return artTon[eintrag.art ?? "SONSTIGES"];
}

/**
 * Der Text, der im Raster steht. Ein Blocker verraet nichts - auch nicht dem
 * Eigentuemer, denn der Kalender wird am Schreibtisch neben anderen
 * aufgeklappt.
 */
export function beschriftung(eintrag: KalenderEintrag): string {
  if (eintrag.herkunft === "EIGEN" && eintrag.art === "BLOCKER") return "Belegt";
  return eintrag.titel;
}
