export type PilotConversation = {
  id: string;
  participantId: string;
  day: string;
  kind: "NEW_ACQUAINTANCE" | "FIRST_REFERRAL" | "EXISTING_CONTACT";
  conversationConfirmed: boolean;
  resultCorrect: boolean;
  nextActionRequired: boolean;
  nextActionCorrect: boolean;
};
export type ContactPilot = {
  pilotStarted: boolean;
  dataReviewComplete: boolean;
  weekStarts: [string, string];
  participants: Array<{ id: string; suitableDays: [string[], string[]] }>;
  conversations: PilotConversation[];
};

function dayDate(day: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("Datum muss YYYY-MM-DD sein.");
  const date = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) throw new Error("Ungültiges Kalenderdatum.");
  return date;
}
const offsetDay = (day: string, count: number) => new Date(dayDate(day).getTime() + count * 86400000).toISOString().slice(0, 10);
export function berlinDay(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Explicit confirmations only. Completed negative outcomes need no artificial follow-up. */
export function evaluateContactPilot(input: ContactPilot, now = new Date()) {
  if (typeof input.pilotStarted !== "boolean" || typeof input.dataReviewComplete !== "boolean") throw new Error("Pilotbeginn und Datenprüfung müssen ausdrücklich bestätigt werden.");
  if (!input.pilotStarted && (input.dataReviewComplete || input.conversations.length > 0)) throw new Error("Ein nicht gestarteter Pilot enthält keine bestätigte Datenprüfung oder Gespräche.");
  if (input.weekStarts.length !== 2 || input.participants.length !== 5) throw new Error("Der festgelegte Pilot benötigt fünf Personen und zwei Wochen.");
  const [first, second] = input.weekStarts;
  if (dayDate(first).getUTCDay() !== 1 || second !== offsetDay(first, 7)) throw new Error("Zwei aufeinanderfolgende Montag–Sonntag-Wochen sind erforderlich.");
  const ids = new Set(input.participants.map(person => person.id));
  if (ids.size !== 5 || [...ids].some(id => !id.trim())) throw new Error("Fünf eindeutige Pseudonyme sind erforderlich.");
  for (const person of input.participants) {
    if (person.suitableDays.length !== 2) throw new Error("Geeignete Tage müssen für beide Wochen festgelegt sein.");
    person.suitableDays.forEach((days, week) => {
      if (new Set(days).size !== days.length || days.length < 2) throw new Error("Mindestens zwei verschiedene geeignete Tage je Woche sind erforderlich.");
      for (const day of days) {
        dayDate(day);
        if (day < input.weekStarts[week] || day >= offsetDay(input.weekStarts[week], 7)) throw new Error("Geeigneter Tag außerhalb der Pilotwoche.");
      }
    });
  }
  const today = berlinDay(now);
  const conversationIds = new Set(input.conversations.map(row => row.id));
  if (conversationIds.size !== input.conversations.length || [...conversationIds].some(id => typeof id !== "string" || !id.trim())) throw new Error("Gesprächskennungen müssen eindeutig sein.");
  const observedDays = input.conversations.filter(row => row.day <= today);
  for (const row of input.conversations) {
    dayDate(row.day);
    if (!ids.has(row.participantId) || row.day < first || row.day >= offsetDay(second, 7)) throw new Error("Gespräch außerhalb des festen Piloten.");
    if (!["NEW_ACQUAINTANCE", "FIRST_REFERRAL", "EXISTING_CONTACT"].includes(row.kind)) throw new Error("Unbekannte Gesprächsart.");
    for (const value of [row.conversationConfirmed, row.resultCorrect, row.nextActionRequired, row.nextActionCorrect]) if (typeof value !== "boolean") throw new Error("Gesprächsbestätigungen müssen explizit true/false sein.");
  }
  const completed = observedDays.filter(row => row.conversationConfirmed && row.resultCorrect && (!row.nextActionRequired || row.nextActionCorrect));
  const people = input.participants.map(person => ({
    id: person.id,
    correctDays: person.suitableDays.map(days => new Set(completed.filter(row => row.participantId === person.id && days.includes(row.day)).map(row => row.day)).size),
  }));
  const qualified = people.filter(person => person.correctDays.every(count => count >= 2)).length;
  const windowElapsed = today >= offsetDay(second, 7);
  const fullyObserved = windowElapsed && input.pilotStarted && input.dataReviewComplete;
  return {
    denominator: 5,
    qualified,
    windowElapsed,
    fullyObserved,
    decision: !input.pilotStarted ? "NOT_STARTED" : fullyObserved ? (qualified >= 3 ? "THRESHOLD_MET" : "THRESHOLD_NOT_MET") : "PENDING",
    people,
    conversationKinds: [0, 1].map(week => {
      const rows = observedDays.filter(row => row.conversationConfirmed && row.day >= input.weekStarts[week] && row.day < offsetDay(input.weekStarts[week], 7));
      return Object.fromEntries(["NEW_ACQUAINTANCE", "FIRST_REFERRAL", "EXISTING_CONTACT"].map(kind => [kind, rows.filter(row => row.kind === kind).length]));
    }),
    unconfirmed: observedDays.filter(row => !row.conversationConfirmed).length,
    correctCompletedConversations: completed.length,
  };
}
