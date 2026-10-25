import { z } from "zod";
import type { Prisma, PrismaClient } from "@/lib/generated/prisma/client";
import type { ActionReceipt } from "@/lib/ai-crm/contracts";
import type { CrmToolResult } from "@/lib/ai-crm/tools";
import { AiCrmError } from "@/lib/ai-crm/errors";
import { berlinDayOf, berlinLocalToUtc, endOfBerlinDay, mondayOf, shiftDay } from "@/lib/dates";
import {
  ladeVereinbarungen, vereinbarungAendernInTransaktion,
  vereinbarungReagierenInTransaktion, vereinbarungVorschlagenInTransaktion,
  type VereinbarungAnzeige, type VereinbarungInhalt,
} from "@/lib/vereinbarungen";
import { naechsterVereinbarungsstand, vereinbarungAenderbar, vereinbarungSichtbar } from "@/lib/vereinbarungen-regeln";

export type LeadershipDb = PrismaClient | Prisma.TransactionClient;
const id = z.string().trim().min(1).max(160);
const stamp = z.string().datetime({ offset: true });
const nullableId = id.nullable().optional();
const taskTypes = ["EINS_ZU_EINS", "BEGLEITUNG", "ANRUF", "SCHULUNG", "VEREINBARUNG_NACHFASSEN", "ONBOARDING_CHECK", "SONSTIGES"] as const;
const appointmentTypes = ["BEGLEITUNG", "SCHULUNG", "TEAM", "BLOCKER", "SONSTIGES"] as const;
const period = z.enum(["today", "week", "all"]).nullable().optional();
const agreementContent = {
  title: z.string().trim().min(1).max(500), responsibleId: id,
  kind: z.enum(["AUFGABE", "TERMIN"]), dueAt: stamp,
  endAt: stamp.nullable().optional(),
};
const appointmentContent = {
  title: z.string().trim().min(1).max(200), kind: z.enum(appointmentTypes),
  startAt: stamp, endAt: stamp,
  location: z.string().trim().max(300).nullable().optional(),
  note: z.string().trim().max(3000).nullable().optional(),
};
export const LEADERSHIP_SCHEMAS = {
  search_partners: z.object({ query: z.string().trim().max(160) }).strict(),
  get_leadership_overview: z.object({ period, partnerId: nullableId, ownOnly: z.boolean().nullable().optional() }).strict(),
  prepare_partner_meeting: z.object({ partnerId: id, since: stamp.nullable().optional() }).strict(),
  get_leadership_round: z.object({ period }).strict(),
  list_calendar: z.object({ from: stamp, to: stamp }).strict(),
  save_leadership_note: z.object({ partnerId: id, text: z.string().trim().min(1).max(6000), occurredAt: stamp, appointmentId: nullableId }).strict(),
  create_leadership_task: z.object({ partnerId: id, type: z.enum(taskTypes), dueAt: stamp, note: z.string().trim().min(1).max(200), sourceNoteId: nullableId }).strict(),
  update_leadership_task: z.object({ taskId: id, version: z.number().int().positive(), dueAt: stamp, note: z.string().trim().min(1).max(200) }).strict(),
  complete_leadership_task: z.object({ taskId: id, version: z.number().int().positive() }).strict(),
  create_appointment: z.object(appointmentContent).strict(),
  update_appointment: z.object({ appointmentId: id, ...appointmentContent }).strict(),
  propose_agreement: z.object({ partnerId: id, ...agreementContent, sourceNoteId: nullableId, appointmentId: nullableId }).strict(),
  update_agreement: z.object({ agreementId: id, version: z.number().int().positive(), ...agreementContent }).strict(),
  respond_agreement: z.object({ agreementId: id, version: z.number().int().positive(), action: z.enum(["BESTAETIGEN", "ABLEHNEN", "ERLEDIGEN", "ABSAGEN"]) }).strict(),
  link_agreement_appointment: z.object({ agreementId: id, version: z.number().int().positive(), appointmentId: id }).strict(),
};
export type LeadershipToolName = keyof typeof LEADERSHIP_SCHEMAS;
export const LEADERSHIP_WRITE_TOOLS = new Set<LeadershipToolName>([
  "save_leadership_note", "create_leadership_task", "update_leadership_task", "complete_leadership_task",
  "create_appointment", "update_appointment", "propose_agreement", "update_agreement", "respond_agreement", "link_agreement_appointment",
]);
const descriptions: Record<LeadershipToolName, string> = {
  search_partners: "Findet aktive direkte Partner und den eigenen direkten Führungskontakt. Bei mehreren Namen muss der Nutzer auswählen. Keine automatische Zuordnung anhand eines Vornamens.",
  get_leadership_overview: "Liest eigene Führungsschritte, eigene berechtigte Absprachen und Kalender. Überfälliges wird einbezogen; ownOnly begrenzt Verantwortlichkeit auf den Nutzer. Keine Leistungsbewertung.",
  prepare_partner_meeting: "Bereitet 1:1 mit eindeutig ausgewähltem direktem Partner aus eigenen privaten Gesprächsnotizen und eigenen gemeinsamen Absprachen vor. Liefert Quellen, Lücken, Verlauf und Abdeckungsgrenzen.",
  get_leadership_round: "Tier-3-Leseübersicht nur eigener Absprachen mit direkt geführten Führungskräften. Niemals deren private 1:1-Notizen oder untergeordnete Aufgaben. Liefert belegte Themen und Agenda-Vorschläge.",
  list_calendar: "Liest den eigenen Kalender in einem Zeitraum bis 93 Tage: eigene Termine, eigene Kundentermine, aktive importierte Belegung und selbst beteiligte bestätigte gemeinsame Termine. Belegt keine Verfügbarkeit anderer Personen.",
  save_leadership_note: "Bereitet eigene private 1:1-Gesprächsnotiz vor. Keine Aufgaben werden dadurch angelegt. Nur ausdrücklich gewünschte CRM-Notiz, niemals automatisch das Transkript. Sichtbare Bestätigung erforderlich.",
  create_leadership_task: "Bereitet eigenen konkreten Führungsschritt zu einem direkt geführten Partner vor. Verantwortlich ist der Nutzer. Für eine Aufgabe des Partners propose_agreement verwenden. Sichtbare Bestätigung erforderlich.",
  update_leadership_task: "Bereitet Änderung eines eindeutig gewählten eigenen offenen Führungsschritts mit bekannter Version vor. Sichtbare Bestätigung erforderlich.",
  complete_leadership_task: "Bereitet Erledigen eines eindeutig gewählten eigenen Führungsschritts mit bekannter Version vor. Sichtbare Bestätigung erforderlich.",
  create_appointment: "Bereitet eigenen internen Kalendereintrag vor. Versendet keine Einladungen. Beginn und Ende samt Zeitzone müssen bekannt sein; keine freie Zeit anderer behaupten. Sichtbare Bestätigung erforderlich.",
  update_appointment: "Bereitet Verschieben oder Bearbeiten eines eindeutig gewählten eigenen internen Termins vor. Keine Einladung; Ausführung gemäß Chatmodus.",
  propose_agreement: "Bereitet geteilten Absprachevorschlag mit einem direkt geführten Partner oder dem eigenen Führungskontakt vor. Verantwortlicher muss einer der beiden Beteiligten sein. Speicherung nach Nutzerklick als VORGESCHLAGEN; gemeinsam bestätigt erst nach Gegenbestätigung. Empfehlungen niemals als berichtete Vereinbarung darstellen.",
  update_agreement: "Bereitet Inhaltsänderung einer eigenen berechtigten Absprache mit bekannter Version vor. Ändern setzt sie zur erneuten Gegenbestätigung auf VORGESCHLAGEN. Sichtbare Bestätigung erforderlich.",
  respond_agreement: "Bereitet Bestätigen, Ablehnen, Erledigen oder Absagen einer eigenen Absprache vor. Die vorschlagende Person darf nicht selbst die gemeinsame Zustimmung bestätigen. Sichtbare Bestätigung erforderlich.",
  link_agreement_appointment: "Verbindet gemäß Chatmodus eine eigene berechtigte Absprache mit einem eigenen bestehenden internen Termin. Private Termindetails und private Quellnotizen werden nicht geteilt.",
};

const providerKeys = new Set(["type", "properties", "required", "additionalProperties", "enum", "anyOf", "items"]);
function providerSchema(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => providerKeys.has(key)).map(([key, item]) => {
    if (key === "properties") return [key, Object.fromEntries(Object.entries(item as Record<string, Record<string, unknown>>).map(([propertyName, property]) => [propertyName, providerSchema(property)]))];
    if (key === "anyOf") return [key, (item as Record<string, unknown>[]).map(providerSchema)];
    if (key === "items" && item && typeof item === "object") return [key, providerSchema(item as Record<string, unknown>)];
    return [key, item];
  }));
}
/** Provider receives its existing small schema subset; Zod enforces constraints server-side. */
export const LEADERSHIP_TOOL_DEFINITIONS = Object.entries(LEADERSHIP_SCHEMAS).map(([name, schema]) => {
  const raw = providerSchema(z.toJSONSchema(schema, { target: "draft-7", io: "input" }) as Record<string, unknown>);
  const properties = raw.properties as Record<string, Record<string, unknown>>;
  const required = raw.required as string[] | undefined;
  for (const [key, property] of Object.entries(properties)) {
    delete property.default;
    if (!required?.includes(key) && !JSON.stringify(property).includes('"null"')) properties[key] = { anyOf: [property, { type: "null" }] };
  }
  return { type: "function" as const, name, description: descriptions[name as LeadershipToolName], strict: true, parameters: { type: "object", properties, required: Object.keys(properties), additionalProperties: false } };
});

function argsFor(name: string, args: Record<string, unknown>): Record<string, unknown> {
  if (!Object.hasOwn(LEADERSHIP_SCHEMAS, name)) throw new AiCrmError("UNKNOWN_TOOL", "Diese Führungsfunktion ist nicht verfügbar.");
  const parsed = LEADERSHIP_SCHEMAS[name as LeadershipToolName].safeParse(args);
  if (!parsed.success) throw new AiCrmError("INVALID_TOOL_INPUT", "Bitte ergänze gültige Personen, Datumsangaben und den konkreten Inhalt.");
  const result = parsed.data as Record<string, unknown>;
  if (name === "get_leadership_overview" || name === "get_leadership_round") result.period ??= "today";
  if (name === "get_leadership_overview") result.ownOnly ??= false;
  return result;
}
const accountSelect = { id: true, name: true, path: true, leaderId: true, deactivatedAt: true, passwordHash: true } as const;
type Account = Prisma.UserGetPayload<{ select: typeof accountSelect }>;
function active(account: Account | null): account is Account {
  return !!account && !account.deactivatedAt && !!account.passwordHash && account.path !== "/" && account.path.endsWith(`/${account.id}/`);
}
async function self(db: LeadershipDb, userId: string) {
  const account = await db.user.findUnique({ where: { id: userId }, select: accountSelect });
  if (!account || account.deactivatedAt) throw new AiCrmError("PARTNER_NOT_FOUND", "Dein aktives Konto ist nicht verfügbar.", 404);
  return account;
}
function direct(a: Account, b: Account) {
  return active(a) && active(b) && a.id !== b.id && (
    b.leaderId === a.id && b.path === `${a.path}${b.id}/`
    || a.leaderId === b.id && a.path === `${b.path}${a.id}/`
  );
}
async function partner(db: LeadershipDb, userId: string, partnerId: string, downwardOnly = false) {
  const [me, other] = await Promise.all([self(db, userId), db.user.findUnique({ where: { id: partnerId }, select: accountSelect })]);
  if (!other || !direct(me, other) || downwardOnly && other.leaderId !== userId) throw new AiCrmError("PARTNER_NOT_FOUND", "Diese Person ist in deiner aktuellen direkten Teamzuordnung nicht verfügbar.", 404);
  return { me, other };
}
export async function resolveLeadershipPartner(db: LeadershipDb, userId: string, partnerId: string) {
  const { other } = await partner(db, userId, partnerId);
  return { id: other.id, name: other.name };
}
async function directPeople(db: LeadershipDb, userId: string, onlyLeaders = false) {
  const me = await self(db, userId);
  if (!active(me)) return [];
  const people = await db.user.findMany({ where: { OR: [{ leaderId: userId }, ...(!onlyLeaders && me.leaderId ? [{ id: me.leaderId }] : [])], deactivatedAt: null, passwordHash: { not: null } }, select: { ...accountSelect, _count: { select: { team: { where: { deactivatedAt: null, passwordHash: { not: null } } } } } }, orderBy: [{ name: "asc" }, { id: "asc" }] });
  return people.filter(p => direct(me, p) && (!onlyLeaders || p.leaderId === userId && p._count.team > 0));
}
function scope(a: Account, b?: Account) { return { userId: a.id, path: a.path, leaderId: a.leaderId, ...(b ? { partnerId: b.id, partnerPath: b.path, partnerLeaderId: b.leaderId } : {}) }; }
const iso = (value: Date | null | undefined) => value?.toISOString() ?? null;
const time = (value: unknown) => new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin" }).format(new Date(String(value)));
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const agreementLink = (partnerId: string, agreementId?: string) => `/mannschaft/vereinbarungen?partner=${encodeURIComponent(partnerId)}${agreementId ? `#vereinbarung-${encodeURIComponent(agreementId)}` : ""}`;
const noteLink = (noteId: string) => `/mannschaft/notizen/${encodeURIComponent(noteId)}`;
const appointmentLink = (at: Date, appointmentId: string) => `/kalender?tag=${berlinDayOf(at)}&termin=${encodeURIComponent(appointmentId)}`;

export type LeadershipSource = { id: string; title: string; detail: string; link: string; entityType: string; at: string; partnerId?: string; version?: number; excerptTruncated?: boolean; origin?: { id: string; link: string; at: string } };
function agreementItem(value: VereinbarungAnzeige): LeadershipSource {
  return { id: value.id, title: value.titel, detail: `${value.partner.name} · ${value.verantwortlichName} · ${value.status} · ${time(value.faelligAm)}`, link: agreementLink(value.partner.id, value.id), partnerId: value.partner.id, entityType: "PartnerVereinbarung", at: (value.verlauf[0]?.createdAt ?? value.faelligAm).toISOString(), version: value.version };
}
async function privateNote(db: LeadershipDb, userId: string, noteId: string, partnerId?: string) {
  const note = await db.leadershipNote.findFirst({ where: { id: noteId, ownerId: userId, ...(partnerId ? { partnerId } : {}) } });
  if (!note) throw new AiCrmError("NOTE_NOT_FOUND", "Diese private Gesprächsnotiz ist nicht verfügbar.", 404);
  await partner(db, userId, note.partnerId);
  return note;
}
async function ownTask(db: LeadershipDb, userId: string, taskId: string) {
  const task = await db.leadershipTask.findFirst({ where: { id: taskId, leaderId: userId } });
  if (!task) throw new AiCrmError("TASK_NOT_FOUND", "Diese Führungsaufgabe ist nicht verfügbar.", 404);
  await partner(db, userId, task.memberId, true);
  return task;
}
async function ownAppointment(db: LeadershipDb, userId: string, appointmentId: string) {
  const appointment = await db.termin.findFirst({ where: { id: appointmentId, ownerId: userId } });
  if (!appointment) throw new AiCrmError("APPOINTMENT_NOT_FOUND", "Dieser eigene interne Termin ist nicht verfügbar.", 404);
  return appointment;
}
async function ownAgreement(db: LeadershipDb, userId: string, agreementId: string) {
  const agreement = await db.partnerVereinbarung.findFirst({ where: { id: agreementId, OR: [{ initiatorId: userId }, { empfaengerId: userId }] }, include: { initiator: { select: accountSelect }, empfaenger: { select: accountSelect } } });
  if (!agreement || !vereinbarungSichtbar(userId, agreement.initiator, agreement.empfaenger)) throw new AiCrmError("AGREEMENT_NOT_FOUND", "Diese Absprache ist in deiner aktuellen Teamzuordnung nicht verfügbar.", 404);
  return agreement;
}

/** Used by authenticated source views; no trusted title/excerpt comes from the URL. */
export async function readLeadershipSource(db: LeadershipDb, userId: string, kind: string, sourceId: string) {
  await self(db, userId);
  if (kind === "note") {
    const note = await privateNote(db, userId, sourceId);
    const { other } = await partner(db, userId, note.partnerId);
    return { id: note.id, title: `Gespräch mit ${other.name}`, text: note.text, occurredAt: note.occurredAt, createdAt: note.createdAt, version: note.version, partnerId: other.id, partnerName: other.name, private: true, appointmentId: note.appointmentId };
  }
  if (kind === "task") return ownTask(db, userId, sourceId);
  if (kind === "appointment") return ownAppointment(db, userId, sourceId);
  if (kind === "agreement") {
    await ownAgreement(db, userId, sourceId);
    const agreement = (await ladeVereinbarungen(userId, undefined, db)).find(v => v.id === sourceId);
    if (!agreement) throw new AiCrmError("AGREEMENT_NOT_FOUND", "Diese Absprache ist nicht mehr verfügbar.", 404);
    return agreement;
  }
  throw new AiCrmError("SOURCE_NOT_FOUND", "Diese Quelle ist nicht verfügbar.", 404);
}

function bounds(periodName: unknown, now: Date) {
  const today = berlinDayOf(now);
  const from = berlinLocalToUtc(`${today}T00:00`)!;
  const to = periodName === "all" ? berlinLocalToUtc(`${shiftDay(today, 93)}T00:00`)!
    : periodName === "week" ? endOfBerlinDay(shiftDay(mondayOf(today), 6)) : endOfBerlinDay(today);
  return { from, to, period: String(periodName), timezone: "Europe/Berlin" };
}
async function calendar(db: LeadershipDb, userId: string, from: Date, to: Date): Promise<LeadershipSource[]> {
  if (!(to > from) || to.getTime() - from.getTime() > 94 * 86400000) throw new AiCrmError("INVALID_TOOL_INPUT", "Bitte einen Kalenderzeitraum bis 93 Tage wählen.");
  const [appointments, contacts, imported, agreements] = await Promise.all([
    db.termin.findMany({ where: { ownerId: userId, von: { lt: to }, bis: { gt: from } }, orderBy: { von: "asc" } }),
    db.contact.findMany({ where: { ownerId: userId, outcome: { not: "VERLOREN" }, appointmentAt: { gte: new Date(from.getTime() - 3600000), lt: to } }, select: { id: true, name: true, appointmentAt: true } }),
    db.fremdtermin.findMany({ where: { quelle: { ownerId: userId, aktiv: true }, von: { lt: to }, bis: { gt: from } }, select: { id: true, titel: true, von: true, bis: true } }),
    ladeVereinbarungen(userId, undefined, db),
  ]);
  return [
    ...appointments.map(p => ({ id: p.id, title: p.titel, detail: `Eigener interner Termin · ${time(p.von)}–${time(p.bis)}`, link: appointmentLink(p.von, p.id), entityType: "Termin", at: p.von.toISOString() })),
    ...contacts.filter(c => c.appointmentAt!.getTime() + 3600000 > from.getTime()).map(c => ({ id: c.id, title: c.name, detail: `Geplanter Kundentermin · ${time(c.appointmentAt)} · Dauer nicht dokumentiert, Kalenderannahme 60 Minuten`, link: `/contacts/${encodeURIComponent(c.id)}`, entityType: "ContactAppointment", at: c.appointmentAt!.toISOString() })),
    ...imported.map(p => ({ id: p.id, title: p.titel, detail: `Importierte Belegung · ${time(p.von)}–${time(p.bis)}`, link: `/kalender?tag=${berlinDayOf(p.von)}`, entityType: "Fremdtermin", at: p.von.toISOString() })),
    ...agreements.filter(p => p.status === "BESTAETIGT" && p.art === "TERMIN" && p.endetAm && p.faelligAm < to && p.endetAm > from).map(agreementItem),
  ].sort((a, b) => a.at.localeCompare(b.at));
}
const DISPLAY_LIMIT = 200;
function bounded(items: LeadershipSource[]) { return { items: items.slice(0, DISPLAY_LIMIT), coverage: { total: items.length, shown: Math.min(items.length, DISPLAY_LIMIT), complete: items.length <= DISPLAY_LIMIT } }; }

export async function runLeadershipRead(db: LeadershipDb, userId: string, name: string, raw: Record<string, unknown>, now = new Date()): Promise<CrmToolResult> {
  const args = argsFor(name, raw);
  await self(db, userId);
  if (name === "search_partners") {
    const query = String(args.query).toLocaleLowerCase("de-DE");
    const people = (await directPeople(db, userId)).filter(p => p.name.toLocaleLowerCase("de-DE").includes(query));
    const items: LeadershipSource[] = people.map(p => ({ id: p.id, title: p.name, detail: p.leaderId === userId ? "Direkt geführter Partner" : "Dein direkter Führungskontakt", link: agreementLink(p.id), entityType: "User", partnerId: p.id, at: now.toISOString() }));
    return { ok: true, summary: `${people.length} passende direkte Kontakte.`, data: { ...bounded(items), ambiguous: people.length > 1, partners: items.slice(0, DISPLAY_LIMIT).map(p => ({ id: p.id, name: p.title })) } };
  }
  if (name === "list_calendar") {
    const items = await calendar(db, userId, new Date(String(args.from)), new Date(String(args.to)));
    return { ok: true, summary: `${items.length} eigene Kalendereinträge im Zeitraum.`, data: { ...bounded(items), period: { from: args.from, to: args.to, timezone: "Europe/Berlin" }, gaps: ["Die Verfügbarkeit anderer Personen ist unbekannt. Geplant bedeutet nicht stattgefunden."] } };
  }
  if (name === "prepare_partner_meeting") {
    const { other } = await partner(db, userId, String(args.partnerId));
    const where = { ownerId: userId, partnerId: other.id, ...(args.since ? { occurredAt: { gte: new Date(String(args.since)) } } : {}) };
    const [notes, noteCount, agreements, tasks, origins] = await Promise.all([
      db.leadershipNote.findMany({ where, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 30 }),
      db.leadershipNote.count({ where }),
      ladeVereinbarungen(userId, other.id, db),
      db.leadershipTask.findMany({ where: { leaderId: userId, memberId: other.id, doneAt: null }, orderBy: [{ dueAt: "asc" }, { id: "asc" }] }),
      db.partnerVereinbarung.findMany({ where: { OR: [{ initiatorId: userId, empfaengerId: other.id }, { initiatorId: other.id, empfaengerId: userId }], sourceNote: { ownerId: userId, partnerId: other.id } }, select: { id: true, sourceNote: { select: { id: true, occurredAt: true } } } }),
    ]);
    const open = agreements.filter(a => a.status === "BESTAETIGT");
    const proposed = agreements.filter(a => a.status === "VORGESCHLAGEN");
    const withOrigin = (a: VereinbarungAnzeige): LeadershipSource => {
      const origin = origins.find(o => o.id === a.id)?.sourceNote;
      return { ...agreementItem(a), ...(origin ? { origin: { id: origin.id, link: noteLink(origin.id), at: origin.occurredAt.toISOString() } } : {}) };
    };
    const noteItems: LeadershipSource[] = notes.map(n => ({ id: n.id, title: `Gespräch mit ${other.name}`, detail: n.text.slice(0, 2000), excerptTruncated: n.text.length > 2000, link: noteLink(n.id), entityType: "LeadershipNote", at: n.occurredAt.toISOString(), partnerId: other.id, version: n.version }));
    const taskItems: LeadershipSource[] = tasks.map(t => ({ id: t.id, title: t.note || t.type, detail: `Eigene Zusage · ${time(t.dueAt)}`, link: `/mannschaft/${other.id}`, entityType: "LeadershipTask", at: t.createdAt.toISOString(), partnerId: other.id, version: t.version }));
    const changes = notes[0] ? agreements.flatMap(a => a.verlauf.filter(v => v.createdAt > notes[0].occurredAt).map(v => ({ agreementId: a.id, version: v.version, action: v.aktion, at: v.createdAt.toISOString(), source: agreementLink(other.id, a.id) }))) : [];
    const items = [...noteItems, ...open.map(withOrigin), ...taskItems, ...proposed.map(withOrigin), ...agreements.filter(a => a.status !== "BESTAETIGT" && a.status !== "VORGESCHLAGEN").map(withOrigin)];
    const gaps = ["Kundennotizen des Partners und fremde private 1:1-Notizen sind nicht Teil dieser Vorbereitung.", "Eine Planung oder ein Absprachevorschlag belegt kein stattgefundenes Gespräch und keine gemeinsame Zustimmung."];
    if (!notes.length) gaps.push("Kein dokumentiertes eigenes 1:1-Gespräch im berücksichtigten Zeitraum. Keine Aussage über Motivation oder tatsächliche Arbeit möglich.");
    if (noteCount > notes.length) gaps.push(`Nur die letzten ${notes.length} von ${noteCount} eigenen Gesprächsnotizen sind enthalten.`);
    if (noteItems.some(n => n.excerptTruncated)) gaps.push("Lange Notizen sind als Auszüge bis 2.000 Zeichen enthalten. Die verlinkte eigene Quelle enthält den vollständigen Text.");
    if (open.length > DISPLAY_LIMIT) gaps.push(`Die ersten ${DISPLAY_LIMIT} von ${open.length} bestätigten offenen Absprachen sind im KI-Kontext enthalten; es besteht weitere offene Arbeit.`);
    return { ok: true, summary: `Vorbereitung mit ${other.name}: ${notes.length} Gesprächsquellen, ${open.length} bestätigte offene Absprachen.`, data: {
      partner: { id: other.id, name: other.name }, ...bounded(items),
      notes: noteItems, confirmedOpenAgreements: open.slice(0, DISPLAY_LIMIT).map(withOrigin), ownPromises: [...open.filter(a => a.verantwortlicherId === userId).map(withOrigin), ...taskItems].slice(0, DISPLAY_LIMIT),
      partnerAgreements: open.filter(a => a.verantwortlicherId === other.id).slice(0, DISPLAY_LIMIT).map(withOrigin), unconfirmedProposals: proposed.slice(0, DISPLAY_LIMIT).map(withOrigin), changesSinceLastNote: changes.slice(0, DISPLAY_LIMIT),
      period: { from: args.since ?? notes.at(-1)?.occurredAt.toISOString() ?? null, to: now.toISOString(), timezone: "Europe/Berlin" },
      coverage: { notesTotal: noteCount, notesShown: notes.length, notesComplete: noteCount <= notes.length && !noteItems.some(n => n.excerptTruncated), openAgreementsTotal: open.length, openAgreementsShown: Math.min(open.length, DISPLAY_LIMIT), openAgreementsComplete: open.length <= DISPLAY_LIMIT, changesTotal: changes.length, changesComplete: changes.length <= DISPLAY_LIMIT, complete: items.length <= DISPLAY_LIMIT && noteCount <= notes.length && !noteItems.some(n => n.excerptTruncated), total: items.length, shown: Math.min(items.length, DISPLAY_LIMIT) }, gaps,
      suggestions: ["Welche berichtete Vereinbarung gilt weiterhin?", "Welche Unterstützung soll ich selbst übernehmen?", "Was ist der nächste konkrete Schritt und wann prüfen wir ihn gemeinsam?"],
      suggestionLabel: "KI-Gesprächsvorschläge, keine zusätzlichen vereinbarten Verpflichtungen",
    } };
  }
  if (name === "get_leadership_overview" || name === "get_leadership_round") {
    const tier3 = name === "get_leadership_round";
    const people = await directPeople(db, userId, tier3);
    if (args.partnerId) await partner(db, userId, String(args.partnerId));
    const peopleIds = people.filter(p => !args.partnerId || p.id === args.partnerId).map(p => p.id);
    const window = bounds(args.period, now);
    const allAgreements = await ladeVereinbarungen(userId, typeof args.partnerId === "string" ? args.partnerId : undefined, db);
    const agreements = allAgreements.filter(a => (!tier3 || peopleIds.includes(a.partner.id)) && (a.status === "BESTAETIGT" || a.status === "VORGESCHLAGEN") && (args.period === "all" || a.faelligAm < window.to) && (!args.ownOnly || a.verantwortlicherId === userId));
    const tasks = await db.leadershipTask.findMany({ where: { leaderId: userId, memberId: { in: peopleIds }, doneAt: null, ...(args.period !== "all" ? { dueAt: { lt: window.to } } : {}) }, orderBy: [{ dueAt: "asc" }, { id: "asc" }] });
    const calendarItems = tier3 || args.partnerId ? [] : await calendar(db, userId, window.from, window.to);
    const items: LeadershipSource[] = [...agreements.map(agreementItem), ...tasks.map(t => ({ id: t.id, title: t.note || t.type, detail: `${people.find(p => p.id === t.memberId)?.name ?? "Partner"} · eigene Aufgabe · ${time(t.dueAt)}`, link: `/mannschaft/${t.memberId}`, entityType: "LeadershipTask", at: t.dueAt.toISOString(), partnerId: t.memberId, version: t.version })), ...calendarItems];
    items.sort((a, b) => {
      const due = (item: LeadershipSource) => agreements.find(v => v.id === item.id)?.faelligAm.toISOString() ?? item.at;
      return due(a).localeCompare(due(b)) || a.id.localeCompare(b.id);
    });
    const topics = new Map<string, VereinbarungAnzeige[]>();
    if (tier3) for (const a of agreements) { const key = a.titel.trim().toLocaleLowerCase("de-DE"); topics.set(key, [...(topics.get(key) ?? []), a]); }
    return { ok: true, summary: `${tier3 ? "Führungsrunde" : "Tagesüberblick"}: ${agreements.filter(a => a.status === "BESTAETIGT").length} bestätigte offene Absprachen, ${tasks.length} eigene Führungsschritte${tier3 ? "." : `, ${calendarItems.length} Kalendereinträge.`}`, data: {
      ...bounded(items), period: { ...window, overdueIncluded: true },
      counts: { confirmedOpen: agreements.filter(a => a.status === "BESTAETIGT").length, unconfirmedProposals: agreements.filter(a => a.status === "VORGESCHLAGEN").length, ownTasks: tasks.length, calendar: calendarItems.length },
      confirmedOpen: agreements.filter(a => a.status === "BESTAETIGT").slice(0, DISPLAY_LIMIT).map(agreementItem), unconfirmedProposals: agreements.filter(a => a.status === "VORGESCHLAGEN").slice(0, DISPLAY_LIMIT).map(agreementItem),
      ownPromises: agreements.filter(a => a.status === "BESTAETIGT" && a.verantwortlicherId === userId).slice(0, DISPLAY_LIMIT).map(agreementItem),
      sharedTopics: [...topics.values()].filter(group => new Set(group.map(a => a.partner.id)).size > 1).slice(0, DISPLAY_LIMIT).map(group => ({ topic: group[0].titel, basis: "Gleicher ausdrücklich geteilter Absprachetitel bei mehreren direkten Führungskontakten", sourceCount: group.length, sourcesComplete: group.length <= DISPLAY_LIMIT, sources: group.slice(0, DISPLAY_LIMIT).map(agreementItem) })),
      gaps: ["Keine Einträge bedeutet nicht keine Arbeit. Nicht dokumentierte Hilfe und unbekannte Zuständigkeiten sind nicht ableitbar.", ...(items.length > DISPLAY_LIMIT ? [`${DISPLAY_LIMIT} von ${items.length} Quellen angezeigt. Die Zählung berücksichtigt alle berechtigten Einträge, die Einzelauflistung ist gekürzt.`] : []), ...(tier3 ? ["Nur eigene Absprachen und eigene Zusagen mit direkt geführten Führungskräften; keine privaten 1:1-Notizen ihrer Teams."] : []), ...(args.period === "all" && !tier3 ? ["Alle offenen Absprachen wurden gezählt; Kalendereinträge sind auf die nächsten 93 Tage begrenzt."] : [])],
      priorityBasis: "Termin und dokumentierte Fälligkeit, keine Bewertung von Motivation oder Führungsleistung.",
      ...(tier3 ? { suggestions: ["Eigene Unterstützungszusagen prüfen", "Offene bestätigte Absprachen und konkrete Unterstützungsfragen klären", "Unbestätigte Vorschläge getrennt besprechen"], suggestionLabel: "Agenda-Vorschlag" } : {}),
    } };
  }
  throw new AiCrmError("INVALID_TOOL", "Diese Funktion ist kein Leseauftrag.");
}

function content(args: Record<string, unknown>): VereinbarungInhalt {
  const result = { titel: String(args.title), verantwortlicherId: String(args.responsibleId), art: args.kind as "AUFGABE" | "TERMIN", faelligAm: new Date(String(args.dueAt)), endetAm: args.endAt ? new Date(String(args.endAt)) : null };
  if (result.art === "AUFGABE" && result.endetAm || result.art === "TERMIN" && (!result.endetAm || result.endetAm <= result.faelligAm || result.endetAm.getTime() - result.faelligAm.getTime() > 86400000)) throw new AiCrmError("INVALID_TOOL_INPUT", "Bitte den konkreten Zeitraum der Absprache klären.");
  return result;
}
function appointmentData(args: Record<string, unknown>) {
  const von = new Date(String(args.startAt)), bis = new Date(String(args.endAt));
  if (bis <= von || bis.getTime() - von.getTime() > 31 * 86400000) throw new AiCrmError("INVALID_TOOL_INPUT", "Bitte Beginn und Ende des internen Termins prüfen.");
  return { titel: String(args.title), art: args.kind as typeof appointmentTypes[number], von, bis, ganztags: false, ort: args.location == null ? null : String(args.location), notiz: args.note == null ? null : String(args.note) };
}

export async function describeLeadershipPlan(db: LeadershipDb, userId: string, name: string, raw: Record<string, unknown>): Promise<{ expected: Record<string, unknown>; receipt: ActionReceipt }> {
  const args = argsFor(name, raw);
  if (!LEADERSHIP_WRITE_TOOLS.has(name as LeadershipToolName)) throw new AiCrmError("INVALID_TOOL", "Diese Funktion bereitet keine Änderung vor.");
  const me = await self(db, userId);
  const expected: Record<string, unknown> = { scope: scope(me) };
  const receipt: ActionReceipt = { summary: "Änderung prüfen", status: "PENDING", undoable: false, details: [] };
  if (args.partnerId) {
    const relation = await partner(db, userId, String(args.partnerId), name === "create_leadership_task");
    expected.scope = scope(relation.me, relation.other); receipt.contactName = relation.other.name;
  }
  if (args.appointmentId) {
    const appointment = await ownAppointment(db, userId, String(args.appointmentId));
    expected.appointment = { id: appointment.id, ownerId: appointment.ownerId, updatedAt: iso(appointment.updatedAt), title: appointment.titel, startAt: iso(appointment.von), endAt: iso(appointment.bis), note: appointment.notiz, location: appointment.ort };
  }
  if (args.sourceNoteId) {
    const note = await privateNote(db, userId, String(args.sourceNoteId), typeof args.partnerId === "string" ? args.partnerId : undefined);
    expected.sourceNote = { id: note.id, version: note.version, partnerId: note.partnerId, updatedAt: iso(note.updatedAt) };
  }
  if (name === "save_leadership_note") {
    receipt.summary = "Private Gesprächsnotiz speichern"; receipt.confirmLabel = "Nur Notiz speichern"; receipt.details = [String(args.text), time(args.occurredAt), "Nur für dich. Aufgaben und geteilte Absprachen werden separat bestätigt."];
  } else if (name === "create_leadership_task") {
    receipt.summary = "Eigene Führungsaufgabe anlegen"; receipt.confirmLabel = "Eigene Aufgabe speichern"; receipt.details = [String(args.note), `Verantwortlich: ${me.name}`, time(args.dueAt)];
  } else if (name === "update_leadership_task" || name === "complete_leadership_task") {
    const task = await ownTask(db, userId, String(args.taskId));
    if (task.doneAt || task.version !== args.version) throw new AiCrmError("PLAN_STALE", "Diese Aufgabe wurde inzwischen verändert.", 409);
    const relation = await partner(db, userId, task.memberId, true); expected.scope = scope(relation.me, relation.other);
    expected.task = { id: task.id, memberId: task.memberId, dueAt: iso(task.dueAt), note: task.note, type: task.type, doneAt: iso(task.doneAt), version: task.version };
    receipt.summary = name === "complete_leadership_task" ? "Eigene Führungsaufgabe erledigen" : "Eigene Führungsaufgabe ändern";
    receipt.confirmLabel = name === "complete_leadership_task" ? "Als erledigt bestätigen" : "Änderung speichern";
    receipt.contactName = relation.other.name; receipt.link = `/mannschaft/${task.memberId}`;
    receipt.details = [task.note || task.type, ...(name === "update_leadership_task" ? [String(args.note), time(args.dueAt)] : ["Der tatsächliche Aufgabenstatus wird gespeichert."])];
  } else if (name === "create_appointment" || name === "update_appointment") {
    const value = appointmentData(args);
    receipt.summary = name === "create_appointment" ? "Internen Termin anlegen" : "Internen Termin ändern";
    receipt.confirmLabel = "Termin speichern"; receipt.details = [value.titel, `${time(value.von)} – ${time(value.bis)}`, "Nur dein interner Kalender. Keine Einladung wird versendet.", ...(value.ort ? [value.ort] : [])];
    if (args.appointmentId) receipt.link = appointmentLink(value.von, String(args.appointmentId));
  } else {
    const existing = args.agreementId ? await ownAgreement(db, userId, String(args.agreementId)) : null;
    if (existing) {
      if (existing.version !== args.version) throw new AiCrmError("PLAN_STALE", "Diese Absprache wurde inzwischen verändert.", 409);
      expected.agreement = { id: existing.id, version: existing.version, status: existing.status, updatedAt: iso(existing.updatedAt), sourceNoteId: existing.sourceNoteId, appointmentId: existing.appointmentId };
      expected.scope = { initiator: scope(existing.initiator), receiver: scope(existing.empfaenger) };
      receipt.contactName = existing.initiatorId === userId ? existing.empfaenger.name : existing.initiator.name;
      receipt.link = agreementLink(existing.initiatorId === userId ? existing.empfaengerId : existing.initiatorId, existing.id);
    }
    if (name === "propose_agreement" || name === "update_agreement") {
      const value = content(args);
      const partnerId = existing ? (existing.initiatorId === userId ? existing.empfaengerId : existing.initiatorId) : String(args.partnerId);
      if (value.verantwortlicherId !== userId && value.verantwortlicherId !== partnerId) throw new AiCrmError("INVALID_TOOL_INPUT", "Die Verantwortung muss bei einer der beiden beteiligten Personen liegen.");
      if (existing && !vereinbarungAenderbar(existing, userId, Number(args.version))) throw new AiCrmError("PLAN_STALE", "Diese Absprache kann nicht mehr geändert werden.", 409);
      receipt.summary = name === "propose_agreement" ? "Geteilte Absprache vorschlagen" : "Abspracheänderung vorschlagen"; receipt.confirmLabel = "Vorschlag speichern";
      receipt.details = [value.titel, `Verantwortlich: ${value.verantwortlicherId === userId ? me.name : receipt.contactName}`, time(value.faelligAm), "Die Gegenseite muss anschließend bestätigen. Noch keine gemeinsam bestätigte Verpflichtung."];
    } else if (name === "respond_agreement") {
      const next = existing && naechsterVereinbarungsstand(existing, userId, Number(args.version), args.action as "BESTAETIGEN" | "ABLEHNEN" | "ERLEDIGEN" | "ABSAGEN");
      if (!next) throw new AiCrmError("PLAN_STALE", "Diese Reaktion ist für dich oder diesen Vorschlagsstand nicht möglich.", 409);
      receipt.summary = "Absprache aktualisieren"; receipt.confirmLabel = args.action === "ERLEDIGEN" ? "Als erledigt bestätigen" : "Reaktion bestätigen"; receipt.details = [existing!.titel, `${existing!.status} → ${next}`];
    } else if (name === "link_agreement_appointment") {
      if (!existing || !vereinbarungAenderbar(existing, userId, Number(args.version))) throw new AiCrmError("PLAN_STALE", "Diese Absprache kann nicht mehr verknüpft werden.", 409);
      receipt.summary = "Absprache mit Termin verbinden"; receipt.confirmLabel = "Terminbezug speichern"; receipt.details = [existing.titel, "Der eigene Terminbezug teilt keine privaten Termininhalte mit anderen Personen."];
    }
  }
  return { expected, receipt };
}

/** Same lock as structure moves; no hierarchy change can slip between check and write. */
export async function lockLeadershipPlan(tx: Prisma.TransactionClient, userId: string, name: string, args: Record<string, unknown>) {
  await tx.$executeRaw`LOCK TABLE "User" IN SHARE ROW EXCLUSIVE MODE`;
  if (args.taskId) await tx.$queryRaw`SELECT "id" FROM "LeadershipTask" WHERE "id" = ${String(args.taskId)} AND "leaderId" = ${userId} FOR UPDATE`;
  if (args.appointmentId) await tx.$queryRaw`SELECT "id" FROM "Termin" WHERE "id" = ${String(args.appointmentId)} AND "ownerId" = ${userId} FOR UPDATE`;
  if (args.agreementId) await tx.$queryRaw`SELECT "id" FROM "PartnerVereinbarung" WHERE "id" = ${String(args.agreementId)} FOR UPDATE`;
  if (args.sourceNoteId) await tx.$queryRaw`SELECT "id" FROM "LeadershipNote" WHERE "id" = ${String(args.sourceNoteId)} AND "ownerId" = ${userId} FOR UPDATE`;
  void name;
}

/** Called only inside the persisted confirmation transaction. Does not send messages. */
export async function executeLeadershipWrite(tx: Prisma.TransactionClient, userId: string, name: string, raw: Record<string, unknown>, meta: { requestId?: string } = {}): Promise<CrmToolResult> {
  const args = argsFor(name, raw);
  await describeLeadershipPlan(tx, userId, name, args);
  // A separately confirmed note may now exist for this request. Link only an
  // unambiguous existing own note; selection of a task never creates a note.
  let sourceNoteId = args.sourceNoteId ? String(args.sourceNoteId) : null;
  if (!sourceNoteId && meta.requestId && args.partnerId && (name === "create_leadership_task" || name === "propose_agreement")) {
    const candidates = await tx.leadershipNote.findMany({ where: { ownerId: userId, partnerId: String(args.partnerId), sourceRequestId: meta.requestId }, select: { id: true }, take: 2 });
    if (candidates.length === 1) sourceNoteId = candidates[0].id;
  }
  let entityType: string, entityId: string, link: string, summary: string;
  if (name === "save_leadership_note") {
    const note = await tx.leadershipNote.create({ data: { ownerId: userId, partnerId: String(args.partnerId), text: String(args.text), occurredAt: new Date(String(args.occurredAt)), appointmentId: args.appointmentId ? String(args.appointmentId) : null, sourceRequestId: meta.requestId ?? null } });
    entityType = "LeadershipNote"; entityId = note.id; link = noteLink(note.id); summary = "Private Gesprächsnotiz gespeichert. Keine Aufgabe wurde dadurch angelegt.";
  } else if (name === "create_leadership_task") {
    const task = await tx.leadershipTask.create({ data: { leaderId: userId, memberId: String(args.partnerId), type: args.type as typeof taskTypes[number], dueAt: new Date(String(args.dueAt)), note: String(args.note), sourceNoteId } });
    entityType = "LeadershipTask"; entityId = task.id; link = `/mannschaft/${task.memberId}`; summary = "Eigene Führungsaufgabe gespeichert.";
  } else if (name === "update_leadership_task" || name === "complete_leadership_task") {
    const task = await ownTask(tx, userId, String(args.taskId));
    const changed = await tx.leadershipTask.updateMany({ where: { id: task.id, leaderId: userId, version: Number(args.version), doneAt: null }, data: { ...(name === "complete_leadership_task" ? { doneAt: new Date() } : { dueAt: new Date(String(args.dueAt)), note: String(args.note) }), version: { increment: 1 } } });
    if (changed.count !== 1) throw new AiCrmError("PLAN_STALE", "Diese Aufgabe wurde inzwischen verändert.", 409);
    entityType = "LeadershipTask"; entityId = task.id; link = `/mannschaft/${task.memberId}`; summary = name === "complete_leadership_task" ? "Eigene Führungsaufgabe als erledigt gespeichert." : "Eigene Führungsaufgabe geändert.";
  } else if (name === "create_appointment" || name === "update_appointment") {
    const data = appointmentData(args);
    const appointment = name === "create_appointment" ? await tx.termin.create({ data: { ownerId: userId, ...data } }) : await tx.termin.update({ where: { id: String(args.appointmentId), ownerId: userId }, data });
    entityType = "Termin"; entityId = appointment.id; link = appointmentLink(appointment.von, appointment.id); summary = "Interner Termin gespeichert. Keine Einladung versendet.";
  } else {
    const result = name === "propose_agreement" ? await vereinbarungVorschlagenInTransaktion(tx, userId, String(args.partnerId), content(args))
      : name === "update_agreement" ? await vereinbarungAendernInTransaktion(tx, userId, String(args.agreementId), Number(args.version), content(args))
      : name === "respond_agreement" ? await vereinbarungReagierenInTransaktion(tx, userId, String(args.agreementId), Number(args.version), args.action as "BESTAETIGEN" | "ABLEHNEN" | "ERLEDIGEN" | "ABSAGEN")
      : { ok: true as const, id: String(args.agreementId) };
    if (!result.ok || !result.id) throw new AiCrmError("PLAN_STALE", "Die Absprache konnte in diesem Stand nicht gespeichert werden.", 409);
    if (name === "propose_agreement") await tx.partnerVereinbarung.update({ where: { id: result.id }, data: { sourceNoteId, appointmentId: args.appointmentId ? String(args.appointmentId) : null } });
    if (name === "link_agreement_appointment") {
      const current = await ownAgreement(tx, userId, result.id);
      const changed = await tx.partnerVereinbarung.updateMany({ where: { id: current.id, version: Number(args.version) }, data: { appointmentId: String(args.appointmentId), version: { increment: 1 } } });
      if (changed.count !== 1) throw new AiCrmError("PLAN_STALE", "Die Absprache wurde inzwischen verändert.", 409);
      await tx.vereinbarungVersion.create({ data: { vereinbarungId: current.id, version: current.version + 1, akteurId: userId, aktion: "Eigener Terminbezug ergänzt", stand: json({ titel: current.titel, verantwortlicherId: current.verantwortlicherId, art: current.art, faelligAm: iso(current.faelligAm), endetAm: iso(current.endetAm), status: current.status, vorgeschlagenVonId: current.vorgeschlagenVonId, bestaetigtVonId: current.bestaetigtVonId, bestaetigtAm: iso(current.bestaetigtAm) }) } });
    }
    const agreement = await ownAgreement(tx, userId, result.id);
    entityType = "PartnerVereinbarung"; entityId = agreement.id; link = agreementLink(agreement.initiatorId === userId ? agreement.empfaengerId : agreement.initiatorId, agreement.id);
    summary = agreement.status === "VORGESCHLAGEN" ? "Absprachevorschlag gespeichert. Die Gegenbestätigung ist noch offen." : `Absprache gespeichert: ${agreement.status}.`;
  }
  return { ok: true, summary, entityType, entityId, link, undoable: false, data: { id: entityId, stored: true, ...((name === "create_leadership_task" || name === "propose_agreement") ? { sourceNoteId, origin: sourceNoteId ? "Gespeicherte eigene Gesprächsnotiz" : "Bestätigter Auftrag; keine separate Gesprächsnotiz verknüpft" } : {}) } };
}
