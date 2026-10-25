// Passwort-Regeln und Reset-Codes.
//
// Der Reset-Code ist bewusst kein Einladungscode: ein Einladungscode ist kurz
// und vorlesbar, weil er am Telefon durchgegeben wird. Ein Reset-Code wird nur
// weitergeschickt - und wer ihn hat, kommt in ein fremdes Konto. Also lang und
// zufaellig, ohne Ruecksicht auf Lesbarkeit.

export const PASSWORT_MIN_ZEICHEN = 8;

// Ein Tag. Kuerzer waere sicherer, aber der Link geht per Nachricht raus und
// niemand liest die sofort. Ein abgelaufener Link heisst: nochmal beim Admin
// melden - und dann wird der Reset zur Zumutung statt zur Hilfe.
export const RESET_GUELTIG_STUNDEN = 24;

export function neuerResetCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function resetAblauf(ab: Date = new Date()): Date {
  return new Date(ab.getTime() + RESET_GUELTIG_STUNDEN * 60 * 60 * 1000);
}
