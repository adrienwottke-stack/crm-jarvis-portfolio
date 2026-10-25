export class WorkApiError extends Error {
  constructor(message: string, public code: string, public status: number) { super(message); }
}
export async function workApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: "no-store", ...init });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new WorkApiError(typeof data.error === "string" ? data.error : "Die Arbeit konnte gerade nicht geladen oder gespeichert werden. Bitte versuche es erneut.", data.code ?? "UNKNOWN", response.status);
  return data as T;
}
export const workMutation = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json", "X-AI-CRM-Request": "same-origin" }, body: JSON.stringify(body) });
export const workDate = (value: string) => new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin" }).format(new Date(value));
