import { ActivityType, QuotaType } from "@/lib/generated/prisma/enums";

export const activityTypeLabels: Record<ActivityType, string> = {
  CALL: "Anruf",
  MEETING: "Termin",
  EMAIL: "E-Mail",
};

export const allActivityTypes = Object.values(ActivityType) as ActivityType[];

export function isActivityType(value: string): value is ActivityType {
  return (allActivityTypes as string[]).includes(value);
}

export const quotaTypeLabels: Record<QuotaType, string> = {
  CALL: "Anrufe",
  NUMBERS_PULLED: "Nummern gezogen",
  REFERRAL: "Empfehlungen",
  APPOINTMENT_SET: "Termine vereinbart",
  APPOINTMENT_HELD: "Termine gehalten",
  DEAL_WON: "Abschlüsse",
};

// Gewichtung im Wettbewerb (docs/wettbewerb-plan.md, Abschnitt 5).
//
// Umgestellt am 20.08.2026, einmalig und bewusst VOR dem Start der Arena:
// Punkte werden nirgends gespeichert, sondern bei jeder Anzeige hier
// nachgeschlagen. Jede Aenderung schreibt also alle vergangenen Ranglisten
// rueckwirkend um - danach wird daran nicht mehr gedreht.
//
// Vorher stand hier 1/1/1/1/5. Damit waren fuenf Anrufe so viel wert wie ein
// Abschluss und ein gehaltener Termin so viel wie eine gezogene Nummer: die
// Rangliste belohnte den Anfang des Trichters, waehrend die Arbeit hinten
// passiert.
// REFERRAL kam am 25.08.2026 dazu und ist die einzige nachtraegliche
// Ergaenzung. Sie schreibt nichts um: bis dahin buchte eine Empfehlung
// NUMBERS_PULLED, und diese Zeilen bleiben stehen, wo sie stehen. Ab jetzt ist
// eine Empfehlung dreimal so viel wert wie eine Nummer aus dem eigenen Handy -
// das ist der Unterschied zwischen einem Namen, den man sich selbst
// zusammensucht, und einem, den jemand anders nennt.
export const quotaTypePoints: Record<QuotaType, number> = {
  CALL: 1,
  NUMBERS_PULLED: 1,
  REFERRAL: 3,
  APPOINTMENT_SET: 3,
  APPOINTMENT_HELD: 5,
  DEAL_WON: 10,
};

// Tageskappen (docs/wettbewerb-plan.md, Abschnitt 4). Alles darueber ist kein
// Fleiss, sondern ein Tippfehler oder ein Spiel. Die Kappe greift auf die
// Tagessumme je Art, nicht auf den einzelnen Eintrag.
export const quotaTagesKappe: Record<QuotaType, number> = {
  CALL: 120,
  NUMBERS_PULLED: 200,
  // Deutlich unter den gezogenen Nummern: dreissig Empfehlungen an einem Tag
  // hat niemand bekommen, der sie einzeln erfragt hat.
  REFERRAL: 30,
  APPOINTMENT_SET: 15,
  APPOINTMENT_HELD: 15,
  DEAL_WON: 15,
};

// Wie weit zurueck von Hand nachgetragen werden darf. Ohne dieses Fenster
// laesst sich am Freitagabend eine ganze Woche erfinden.
export const NACHTRAG_TAGE = 2;

export const allQuotaTypes = Object.values(QuotaType) as QuotaType[];

// Gehaltene Termine, Abschluesse und Empfehlungen entstehen ausschliesslich
// aus der Pipeline – sonst waeren sie doppelt zaehlbar. Bei der Empfehlung
// haengt daran mehr als der Punkt: nur ueber den Dialog entsteht auch der
// Kontakt mit Frist, Herkunft und Aufhaenger. Von Hand nachgetragen waere sie
// eine Zahl ohne Namen dahinter.
export const manualQuotaTypes: QuotaType[] = [
  "CALL",
  "NUMBERS_PULLED",
  "APPOINTMENT_SET",
];

export function isQuotaType(value: string): value is QuotaType {
  return (allQuotaTypes as string[]).includes(value);
}

export const emptyQuotaCounts = (): Record<QuotaType, number> => ({
  CALL: 0,
  NUMBERS_PULLED: 0,
  REFERRAL: 0,
  APPOINTMENT_SET: 0,
  APPOINTMENT_HELD: 0,
  DEAL_WON: 0,
});
