// Einladungscodes. Bewusst kurz und vorlesbar: der Code wird am Telefon
// durchgegeben oder per Nachricht geschickt, nicht abgetippt aus einer E-Mail.

// Ohne I, O, 0 und 1 - die vier Zeichen, die beim Vorlesen verwechselt werden.
// 32 Zeichen teilen 256 Bytewerte glatt, deshalb verzerrt das Modulo nichts.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const EINLADUNG_GUELTIG_TAGE = 14;

export function neuerCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const zeichen = Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join("");
  return `${zeichen.slice(0, 4)}-${zeichen.slice(4)}`;
}

/** Gross-/Kleinschreibung, Leerzeichen und fehlender Bindestrich sind egal. */
export function normalisiereCode(eingabe: string): string {
  const roh = eingabe.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return roh.length === 8 ? `${roh.slice(0, 4)}-${roh.slice(4)}` : roh;
}

export function ablaufDatum(ab: Date = new Date()): Date {
  return new Date(ab.getTime() + EINLADUNG_GUELTIG_TAGE * 24 * 60 * 60 * 1000);
}

export type EinladungStatus = "offen" | "eingeloest" | "abgelaufen";

// Ein Code kann seit den Mehrfach-Einladungen (QR am Infoabend) mehr als
// einmal einloesbar sein: maxUses NULL heisst unbegrenzt. "eingeloest" heisst
// deshalb "aufgebraucht", nicht "schon einmal benutzt".
export function statusVon(invite: {
  usedCount: number;
  maxUses: number | null;
  expiresAt: Date;
}): EinladungStatus {
  if (invite.maxUses !== null && invite.usedCount >= invite.maxUses) {
    return "eingeloest";
  }
  return invite.expiresAt.getTime() < Date.now() ? "abgelaufen" : "offen";
}
