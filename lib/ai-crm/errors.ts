export class AiCrmError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(
    code: string,
    message: string,
    status = 400,
  ) {
    super(message);
    this.name = "AiCrmError";
    this.code = code;
    this.status = status;
  }
}

const providerFailureMessages: Record<string, string> = {
  AI_PROVIDER_AUTH_FAILED:
    "Die Verbindung zu OpenAI ist für dieses Projekt nicht berechtigt. Prüfe den API-Zugang.",
  AI_CREDIT_BALANCE_EXHAUSTED:
    "Das API-Guthaben der OpenAI-Organisation ist aufgebraucht. Prüfe das OpenAI-Billing.",
  AI_ORGANIZATION_SPEND_LIMIT_REACHED:
    "Das Ausgabenlimit der OpenAI-Organisation ist erreicht. Prüfe die Organisationslimits.",
  AI_PROJECT_SPEND_LIMIT_REACHED:
    "Das Ausgabenlimit des OpenAI-Projekts ist erreicht. Prüfe die Projektlimits.",
  AI_ORGANIZATION_USAGE_LIMIT_REACHED:
    "Das von OpenAI zugewiesene Nutzungslimit der Organisation ist erreicht.",
  AI_PROVIDER_SLOW_DOWN:
    "OpenAI bremst den Anstieg der Anfragen gerade. Warte kurz und versuche es erneut.",
  AI_PROVIDER_QUOTA_EXHAUSTED:
    "OpenAI meldet eine ausgeschöpfte API-Quote. Prüfe Projektzuordnung, Billing und Limits.",
  AI_PROVIDER_RATE_LIMITED:
    "OpenAI ist für dieses Projekt gerade ausgelastet oder das Nutzungslimit ist erreicht. Bitte versuche es später erneut.",
  AI_MODEL_UNAVAILABLE:
    "Das konfigurierte KI-Modell ist für dieses OpenAI-Projekt nicht verfügbar.",
  AI_PROVIDER_TIMEOUT:
    "Die KI-Antwort hat zu lange gedauert. Bitte versuche es erneut.",
  AI_PROVIDER_UNAVAILABLE:
    "OpenAI ist gerade nicht erreichbar. Bitte versuche es erneut.",
  AI_PROVIDER_REQUEST_FAILED:
    "Die KI-Anfrage konnte gerade nicht abgeschlossen werden. Bitte versuche es erneut.",
};

export function safeAiProviderFailureMessage(
  code: string | null | undefined,
): string | null {
  return code ? (providerFailureMessages[code] ?? null) : null;
}

export function assistantRecoveryFailureMessage(
  status: string,
  code: string | null | undefined,
): string {
  if (status === "ABORTED") {
    return "Die Verarbeitung wurde beendet. Bereits gespeicherte Änderungen bleiben erhalten.";
  }
  return (
    safeAiProviderFailureMessage(code) ??
    "Die Anfrage konnte nicht vollständig abgeschlossen werden. Prüfe die einzelnen Ergebnisse."
  );
}

export function safeAiMessage(error: unknown): string {
  if (error instanceof AiCrmError) return error.message;
  return "Das konnte gerade nicht gespeichert werden. Bitte versuche es erneut.";
}
