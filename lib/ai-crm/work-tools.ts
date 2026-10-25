import { z } from "zod";
import { providerSchema } from "./provider-schema";
import type { PrismaClient } from "@/lib/generated/prisma/client";
import { withDatabase } from "@/lib/database-context";
import { CRM_OPERATIONS, workActor } from "./work-registry";
import { AiCrmError } from "./errors";
import type { CrmToolResult } from "./tools";
import { berlinToday } from "@/lib/dates";

const areas = ["contacts", "pipeline", "calendar", "team", "goals", "performance", "communication", "profile", "admin", "calculator", "feed", "onboarding", "exports"] as const;
export const WORK_SCHEMAS = {
  discover_crm_functions: z.object({ area: z.enum(["all", ...areas]) }).strict(),
  read_crm_data: z.object({ area: z.enum(areas), query: z.string().max(160).nullable(), offset: z.number().int().min(0).max(100000), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), scope: z.enum(["eigene", "direkte", "struktur"]).nullable() }).strict(),
  execute_crm_operation: z.object({ operation: z.string().min(1).max(100), fields: z.array(z.object({ name: z.string().min(1).max(100), value: z.string().max(12000) }).strict()).max(30) }).strict(),
};
const descriptions: Record<keyof typeof WORK_SCHEMAS, string> = {
  discover_crm_functions: "Zeigt alle verfügbaren CRM-Arbeitsfunktionen eines Bereichs samt genauen Eingabefeldern und Werten. Vor einer execute_crm_operation aufrufen. Bereiche: Kontakte/Namen, Pipeline, Kalender, Mannschaft/Verwaltung, Ziele, Leistung/Einheiten, Nachrichten/Einladungen, Profil und Werkstatt. all zeigt den gesamten Katalog. Keine Berechtigungen erfinden.",
  read_crm_data: "Liest echte berechtigte CRM-Daten. contacts/pipeline: eigene Kontakte mit Listen, Bewertung und Kandidaturen; team: verwaltbare Struktur; goals: eigene und berechtigt vorgeschlagene Ziele; performance: Einheiten und Teambericht; communication: eigene Nachrichten und öffentliches Empfängerverzeichnis (query); calendar: eigene Kalenderquellen; profile: eigenes Profil; admin: Werkstatt nur als Admin; calculator: eigene Szenarien; feed: bestehender Feed; onboarding: eigener Startstand; exports: eigene Downloadlinks. 50 Datensätze je Seite, offset für Folgeseiten. Für Termine weiterhin list_calendar und für private Führungsnotizen die Führungswerkzeuge verwenden.",
  execute_crm_operation: "Bereitet eine zuvor entdeckte CRM-Funktion mit exakt den dort gelisteten Feldern vor oder führt sie gemäß Chatmodus direkt aus. Nur ausdrücklich beauftragte Aktionen; IDs aus gelesenen Ergebnissen. fields enthält Name/Wert-Paare, keine neuen Felder. Datum/Uhrzeit in Formularfeldern mit At-Suffix: Berliner Ortszeit YYYY-MM-DDTHH:mm, sofern das Schema keinen ISO-Zeitpunkt mit Offset verlangt. Der Server prüft Rechte und Ausführungsmodus erneut.",
};
export const WORK_TOOL_DEFINITIONS = Object.entries(WORK_SCHEMAS).map(([name, schema]) => ({ type: "function" as const, name, description: descriptions[name as keyof typeof WORK_SCHEMAS], strict: true, parameters: providerSchema(z.toJSONSchema(schema, { target: "draft-7", io: "input" })) }));

export async function runWorkRead(db: PrismaClient, userId: string, name: string, args: Record<string, unknown>): Promise<CrmToolResult> {
  const actor = await workActor(db, userId);
  if (name === "discover_crm_functions") {
    const functions = Object.entries(CRM_OPERATIONS).filter(([, op]) => (!op.admin || actor.role === "ADMIN") && (args.area === "all" || args.area === op.area)).map(([operation, op]) => ({ operation, title: op.title, area: op.area, fields: z.toJSONSchema(op.schema, { target: "draft-7", io: "input" }), link: op.link }));
    return { ok: true, summary: `${functions.length} verfügbare CRM-Funktionen.`, data: { functions, rule: "Berechtigung und Chatmodus werden bei jeder Ausführung geprüft. Zugangsdaten werden in den vorgesehenen Oberflächen eingegeben." } };
  }
  const area = String(args.area); const offset = Number(args.offset); const query = String(args.query ?? "");
  const size = 50; let total = 0; let records: unknown[] = []; let link = "/heute"; let extra: unknown;
  await withDatabase(db, false, [], async () => {
    if (area === "contacts" || area === "pipeline") {
      link = "/namen";
      const where = { ownerId: userId, ...(query ? { name: { contains: query, mode: "insensitive" as const } } : {}) };
      total = await db.contact.count({ where });
      records = await db.contact.findMany({ where, skip: offset, take: size, orderBy: { id: "asc" }, select: { id: true, name: true, phone: true, email: true, job: true, note: true, stage: true, outcome: true, rating: true, listKinds: true, appointmentAt: true, updatedAt: true, kandidaturen: { where: { ownerId: userId }, select: { id: true, phase: true, outcome: true, motiv: true } } } });
    } else if (area === "team") {
      link = "/mannschaft/verwalten";
      const all = (await (await import("@/lib/struktur-verwaltung")).ladeStrukturverwaltung(userId)).filter(row => !query || row.name.toLocaleLowerCase("de").includes(query.toLocaleLowerCase("de")));
      total = all.length; records = all.slice(offset, offset + size);
    } else if (area === "goals") {
      link = "/fortschritt";
      const { strukturKonten } = await import("@/lib/struktur");
      const ids = await strukturKonten(userId);
      const where = { OR: [{ inhaberId: userId }, { erstelltVonId: userId, inhaberId: { in: ids }, beteiligte: { some: { userId } } }] };
      const { zielInclude, zielMitStand } = await import("@/lib/ziele");
      total = await db.ziel.count({ where });
      records = await Promise.all((await db.ziel.findMany({ where, include: zielInclude, orderBy: { id: "asc" }, skip: offset, take: size })).map(zielMitStand));
      extra = { teamGoals: await (await import("@/lib/teamziele")).ladeTeamziele(userId, { tag: String(args.day ?? berlinToday()) }) };
    } else if (area === "performance") {
      link = "/einheiten";
      total = await db.einheitenbuchung.count({ where: { userId } });
      records = await db.einheitenbuchung.findMany({ where: { userId }, orderBy: [{ tag: "desc" }, { id: "asc" }], skip: offset, take: size });
      const units = await import("@/lib/einheiten");
      extra = { ownMonth: await units.eigenerMonatsstand(userId), ownTotal: await units.eigenerGesamtstand(userId, (await db.user.findUniqueOrThrow({ where: { id: userId }, select: { einheitenStart: true } })).einheitenStart), report: await (await import("@/lib/team-auswertung")).ladeTeamauswertung(actor, { tag: String(args.day ?? berlinToday()), umfang: String(args.scope ?? "struktur") }) };
    } else if (area === "communication") {
      link = "/arena";
      if (query) {
        const where = { deactivatedAt: null, name: { contains: query, mode: "insensitive" as const } };
        total = await db.user.count({ where });
        records = await db.user.findMany({ where, select: { id: true, name: true }, orderBy: { id: "asc" }, skip: offset, take: size });
      } else {
        const where = { OR: [{ vonId: userId }, { anId: userId }] };
        total = await db.nachricht.count({ where });
        records = await db.nachricht.findMany({ where, select: { id: true, text: true, vonId: true, anId: true, gelesenAt: true, createdAt: true }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: offset, take: size });
        extra = { invitations: await db.invite.findMany({ where: { leaderId: userId }, select: { id: true, note: true, expiresAt: true, usedAt: true }, skip: offset, take: size, orderBy: { id: "asc" } }), invitationTotal: await db.invite.count({ where: { leaderId: userId } }), invitationOffset: offset, invitationPage: "/einladen" };
      }
    } else if (area === "calendar") {
      link = "/kalender/quellen";
      total = await db.kalenderquelle.count({ where: { ownerId: userId } });
      records = await db.kalenderquelle.findMany({ where: { ownerId: userId }, select: { id: true, name: true, art: true, aktiv: true, letzterLauf: true, fehlerZaehler: true }, orderBy: { id: "asc" }, skip: offset, take: size });
      extra = { connectionPage: link, note: "Neue Verbindungen und Zugangsdaten werden auf der Quellenseite eingerichtet." };
    } else if (area === "profile") {
      link = "/profil"; records = [await db.user.findUnique({ where: { id: userId }, select: { id: true, name: true, phone: true, arbeitsfokus: true, karrierestufe: true, whyLetter: true, einheitenStart: true } })]; total = 1;
    } else if (area === "admin") {
      if (actor.role !== "ADMIN") throw new AiCrmError("FORBIDDEN", "Die Werkstatt benötigt Verwaltungsrechte.", 403);
      link = "/werkstatt"; records = await db.feature.findMany({ orderBy: { key: "asc" }, skip: offset, take: size }); total = await db.feature.count();
      extra = { settings: await db.einstellung.findMany(), invitations: await db.invite.findMany({ select: { id: true, note: true, leaderId: true, usedAt: true, expiresAt: true }, skip: offset, take: size, orderBy: { id: "asc" } }), invitationTotal: await db.invite.count() };
    } else if (area === "calculator") {
      link = "/zinsrechner";
      if (!await (await import("@/lib/features")).istAn("zinsrechner")) throw new AiCrmError("FEATURE_DISABLED", "Der Zinsrechner ist derzeit abgeschaltet.", 403);
      const all = await (await import("@/lib/zinsrechner-service")).ladeZinsSzenarien(db, userId); total = all.length; records = all.slice(offset, offset + size);
    } else if (area === "feed") {
      link = "/arena"; total = await db.feedEintrag.count(); records = await db.feedEintrag.findMany({ orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: offset, take: size, select: { id: true, text: true, tag: true, person: { select: { name: true } } } });
    } else if (area === "onboarding") {
      link = "/heute"; const progress = await db.startProgress.findUnique({ where: { userId } }); records = progress ? [progress] : []; total = records.length;
    } else if (area === "exports") {
      link = "/konto/export"; records = ["kontakte.csv", "aktivitaeten.csv", "einheiten.csv", "alles.json"].map(file => ({ id: file, title: file, link: `/konto/export/${file}` })); total = records.length;
    }
  });
  const items = records.filter(Boolean).map((record, i) => {
    const row = record as Record<string, unknown>;
    return { id: String(row.id ?? row.key ?? `${area}:${offset + i}`), title: String(row.name ?? row.titel ?? row.title ?? row.text ?? area), detail: JSON.stringify(row), link: String(row.link ?? link), ...(area === "contacts" || area === "pipeline" ? { context: { contactId: String(row.id), label: String(row.name) } } : {}) };
  });
  const sourceIds = new Set<string>();
  function collect(value: unknown) {
    if (Array.isArray(value)) { value.forEach(collect); return; }
    if (!value || typeof value !== "object") return;
    for (const [key, nested] of Object.entries(value)) { if ((key === "id" || key.endsWith("Id")) && typeof nested === "string") sourceIds.add(nested); else if (typeof nested === "object") collect(nested); }
  }
  collect(records); collect(extra);
  return { ok: true, summary: `${items.length} von ${total} Einträgen aus ${area}.`, data: { items, extra, ambiguous: Boolean(query && total > 1 && ["contacts", "pipeline", "team"].includes(area)), sourceIds: [...sourceIds], coverage: { total, shown: items.length, offset, complete: offset === 0 && items.length >= total, nextOffset: offset + items.length < total ? offset + items.length : null } }, link };
}
