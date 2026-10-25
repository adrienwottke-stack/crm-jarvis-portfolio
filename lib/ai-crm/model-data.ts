/** Presentation of server-owned CRM data only; never rewrite provider output or tool arguments. */
const timestampFields = new Set(["at", "date", "readAt", "updatedAt", "createdAt", "nextStepAt", "appointmentAt", "occurredAt", "expiresAt", "startedAt", "completedAt", "confirmedAt", "sourceUpdatedAt"]);
const instantPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;
const berlinParts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

/** Retains the exact instant, including milliseconds and the applicable Berlin UTC offset. */
export function formatBerlinInstant(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new RangeError("Invalid CRM timestamp");
  const parts = Object.fromEntries(berlinParts.formatToParts(date).map(part => [part.type, part.value]));
  const localSeconds = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  const offsetMinutes = Math.round((localSeconds - (date.getTime() - date.getUTCMilliseconds())) / 60000);
  const offset = `${offsetMinutes < 0 ? "-" : "+"}${String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, "0")}:${String(Math.abs(offsetMinutes) % 60).padStart(2, "0")}`;
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${String(date.getUTCMilliseconds()).padStart(3, "0")}${offset}`;
}

type Row = Record<string, unknown>;
const row = (value: unknown): Row | null => value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date) ? value as Row : null;

/** One copy of each source's contents; coverage and source identity remain explicit. */
export function contactTaskModelContext(snapshot: unknown): unknown {
  const value = row(snapshot);
  const contact = row(value?.contact);
  if (!value || !contact || !Array.isArray(value.activities) || !Array.isArray(value.followUps)) return snapshot;
  const sourceRows = (rows: unknown[], kind: string) => rows.map(item => {
    const source = row(item);
    if (!source) return item;
    const fields = Object.fromEntries(Object.entries(source).filter(([key]) => key !== "createdAt"));
    return { ...fields, sourceId: `${kind}:${String(source.id)}` };
  });
  return {
    readAt: value.readAt, timeZone: "Europe/Berlin",
    contact: { ...contact, sourceId: `Contact:${String(contact.id)}`, link: `/contacts/${String(contact.id)}`, timestampMeaning: "updatedAt ist der Datensatzstand; die Kontaktnotiz ist undatiert" },
    activities: sourceRows(value.activities, "Activity"),
    followUps: sourceRows(value.followUps, "ContactFollowUp"),
    coverage: value.coverage, gaps: value.gaps,
  };
}

function modelData(value: unknown, field?: string): unknown {
  if (value instanceof Date) return formatBerlinInstant(value);
  if (typeof value === "string" && field && timestampFields.has(field) && instantPattern.test(value) && Number.isFinite(new Date(value).getTime())) return formatBerlinInstant(value);
  if (Array.isArray(value)) return value.map(item => modelData(item));
  const object = row(value);
  if (!object) return value;
  const compact = contactTaskModelContext(object) as Row;
  return Object.fromEntries(Object.entries(compact).filter(([key]) => key !== "readResult").map(([key, item]) => [key, modelData(item, key)]));
}

/** JSON for the model: explicit Berlin instants, original free text, no redundant UI representation. */
export function serializeCrmModelData(value: unknown): string {
  return JSON.stringify(modelData(value));
}
