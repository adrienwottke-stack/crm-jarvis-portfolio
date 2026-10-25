import { AiCrmError } from "@/lib/ai-crm/errors";

const ALLOWED_AUDIO_TYPES = new Set([
  "audio/webm",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
]);

export function normalizedAudioType(mimeType: string) {
  return mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

export function validateAudioEnvelope(params: {
  mimeType: string;
  size: number;
  reportedDuration: number;
  actualDuration: number;
  maxAudioBytes: number;
  maxAudioSeconds: number;
}) {
  const mimeType = normalizedAudioType(params.mimeType);
  if (!ALLOWED_AUDIO_TYPES.has(mimeType)) {
    throw new AiCrmError(
      "INVALID_AUDIO",
      "Dieses Aufnahmeformat wird nicht unterstützt. Bitte nimm die Nachricht erneut auf.",
      400,
    );
  }
  if (!Number.isFinite(params.size) || params.size <= 0) {
    throw new AiCrmError(
      "INVALID_AUDIO",
      "Bitte nimm die Nachricht erneut auf.",
      400,
    );
  }
  if (params.size > params.maxAudioBytes) {
    throw new AiCrmError(
      "AUDIO_TOO_LARGE",
      "Die Aufnahme ist zu groß. Bitte teile sie in eine kürzere Nachricht.",
      413,
    );
  }
  if (
    !Number.isFinite(params.actualDuration) ||
    params.actualDuration <= 0
  ) {
    throw new AiCrmError(
      "INVALID_AUDIO_DURATION",
      "Die Aufnahmedauer konnte nicht sicher erkannt werden. Bitte nimm die Nachricht erneut auf.",
      400,
    );
  }
  if (params.actualDuration > params.maxAudioSeconds + 1.5) {
    throw new AiCrmError(
      "AUDIO_TOO_LONG",
      `Eine Aufnahme darf höchstens ${params.maxAudioSeconds} Sekunden lang sein.`,
      413,
    );
  }
  if (
    !Number.isFinite(params.reportedDuration) ||
    params.reportedDuration < 0 ||
    params.reportedDuration > params.maxAudioSeconds + 5
  ) {
    throw new AiCrmError(
      "INVALID_AUDIO_DURATION",
      "Bitte nimm die Nachricht erneut auf.",
      400,
    );
  }
  const tolerance = Math.max(3, params.actualDuration * 0.15);
  if (Math.abs(params.actualDuration - params.reportedDuration) > tolerance) {
    throw new AiCrmError(
      "INVALID_AUDIO_DURATION",
      "Die gemeldete Aufnahmedauer passt nicht zur Audiodatei. Bitte nimm die Nachricht erneut auf.",
      400,
    );
  }
  return { mimeType, durationSeconds: params.actualDuration };
}
