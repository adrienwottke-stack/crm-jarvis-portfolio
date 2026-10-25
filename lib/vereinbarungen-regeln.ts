export type VereinbarungStatus = "VORGESCHLAGEN" | "BESTAETIGT" | "ERLEDIGT" | "ABGELEHNT" | "ABGESAGT";
export type VereinbarungAktion = "BESTAETIGEN" | "ABLEHNEN" | "ERLEDIGEN" | "ABSAGEN";

export type VereinbarungKonto = {
  id: string;
  path: string;
  deactivatedAt: Date | null;
  passwordHash: string | null;
};

/** Gemeinsame Absprachen gehören nur ihren Beteiligten in der aktuellen Führungskette. */
export function vereinbarungMoeglich(a: VereinbarungKonto, b: VereinbarungKonto): boolean {
  if (a.id === b.id || a.deactivatedAt || b.deactivatedAt || !a.passwordHash || !b.passwordHash) return false;
  if (a.path === "/" || b.path === "/" || !a.path.endsWith(`/${a.id}/`) || !b.path.endsWith(`/${b.id}/`)) return false;
  return a.path.startsWith(b.path) || b.path.startsWith(a.path);
}

export function vereinbarungSichtbar(
  userId: string,
  initiator: VereinbarungKonto,
  empfaenger: VereinbarungKonto,
): boolean {
  return (userId === initiator.id || userId === empfaenger.id) && vereinbarungMoeglich(initiator, empfaenger);
}

export type VereinbarungZustand = {
  initiatorId: string;
  empfaengerId: string;
  vorgeschlagenVonId: string;
  status: VereinbarungStatus;
  version: number;
};

/** Versionsprüfung schützt auch gegen einen Klick aus einem veralteten Browserfenster. */
export function naechsterVereinbarungsstand(
  stand: VereinbarungZustand,
  userId: string,
  version: number,
  aktion: VereinbarungAktion,
): VereinbarungStatus | null {
  if (stand.version !== version || (userId !== stand.initiatorId && userId !== stand.empfaengerId)) return null;
  if (aktion === "BESTAETIGEN" || aktion === "ABLEHNEN") {
    if (stand.status !== "VORGESCHLAGEN" || stand.vorgeschlagenVonId === userId) return null;
    return aktion === "BESTAETIGEN" ? "BESTAETIGT" : "ABGELEHNT";
  }
  if (aktion === "ERLEDIGEN") return stand.status === "BESTAETIGT" ? "ERLEDIGT" : null;
  if (aktion === "ABSAGEN") return stand.status === "VORGESCHLAGEN" || stand.status === "BESTAETIGT" ? "ABGESAGT" : null;
  return null;
}

export function vereinbarungAenderbar(stand: VereinbarungZustand, userId: string, version: number): boolean {
  return stand.version === version && (userId === stand.initiatorId || userId === stand.empfaengerId)
    && (stand.status === "VORGESCHLAGEN" || stand.status === "BESTAETIGT");
}

export function vereinbarungFaellig(status: VereinbarungStatus, faelligAm: Date, bis: Date): boolean {
  return status === "BESTAETIGT" && faelligAm.getTime() < bis.getTime();
}

export const vereinbarungStatusTexte: Record<VereinbarungStatus, string> = {
  VORGESCHLAGEN: "Bestätigung offen",
  BESTAETIGT: "Gemeinsam bestätigt",
  ERLEDIGT: "Erledigt",
  ABGELEHNT: "Abgelehnt",
  ABGESAGT: "Abgesagt",
};
