import { ContactStage, KandidaturPhase, ZielKennzahl, LostReason, Arbeitsfokus } from "@/lib/generated/prisma/enums";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@/lib/generated/prisma/client";
import { withDatabase } from "@/lib/database-context";
import { AiCrmError } from "./errors";
import type { ActionReceipt } from "./contracts";
import type { CrmToolResult } from "./tools";
import { berlinToday, dayToUtcDate } from "@/lib/dates";
import { randomUUID } from "node:crypto";
import { AMPEL_FELDER } from "@/lib/ampelKriterien";
import { SCHNELLTEXTE } from "@/lib/nachrichten";
import { parseEinheiten } from "@/lib/einheiten";

type Db = PrismaClient | Prisma.TransactionClient;
type Actor = { id: string; role: "MEMBER" | "ADMIN"; path: string; name: string };
type Fields = Record<string, string>;
type Context = { db: Db; actor: Actor; fields: Fields };
type Operation = {
  area: string; title: string; schema: z.ZodType<Fields>; link: string; admin?: boolean;
  subject?: (context: Context) => Promise<unknown>;
  run: (context: Context) => Promise<unknown>;
};
const text = z.string().trim().min(1).max(6000);
const optional = z.string().trim().max(6000).optional();
const id = z.string().trim().min(1).max(160);
const integer = z.string().regex(/^\d{1,8}$/);
const referrals = z.string().max(12000).refine(value => { try { return referralRows.safeParse(JSON.parse(value)).success; } catch { return false; } }, "Empfehlungen müssen eine gültige JSON-Liste sein.");
const referralRows = z.array(z.object({ name: z.string().trim().min(1).max(120), phone: z.string().max(60), kontext: z.string().max(1000), kind: z.enum(["VERKAUF", "RECRUITING"]), angekuendigt: z.boolean() }).strict()).max(30);
const schema = (fields: Record<string, z.ZodType>) => z.object(fields).strict() as z.ZodType<Fields>;
const form = (fields: Fields) => { const data = new FormData(); for (const [key, value] of Object.entries(fields)) data.set(key, value); return data; };
function referralForm(fields: Fields) {
  const data = form(fields);
  for (const row of referralRows.parse(JSON.parse(fields.referrals ?? "[]"))) {
    for (const [key, value] of Object.entries({ referralName: row.name, referralPhone: row.phone, referralKontext: row.kontext, referralKind: row.kind, referralAngekuendigt: row.angekuendigt ? "1" : "0" })) data.append(key, value);
  }
  return data;
}
const scopedPrisma = async () => (await import("@/lib/prisma")).prisma;
const calculatorAccess = async (c: Context) => {
  if (!await (await import("@/lib/features")).istAn("zinsrechner")) throw new AiCrmError("FEATURE_DISABLED", "Der Zinsrechner ist abgeschaltet.", 403);
  if (c.fields.id) return requireRow(await c.db.zinsSzenario.findFirst({ where: { id: c.fields.id, ownerId: c.actor.id, OR: [{ contactId: null }, { contact: { ownerId: c.actor.id } }] } }));
  return null;
};
const requireRow = <T>(row: T | null): T => { if (!row) throw new AiCrmError("NOT_FOUND", "Dieser Eintrag ist in deinem Zugriffsbereich nicht verfügbar.", 404); return row; };
const ownContact = async ({ db, actor, fields }: Context) => requireRow(await db.contact.findFirst({ where: { id: fields.contactId, ownerId: actor.id } }));
const ownGoal = async ({ db, actor, fields }: Context) => requireRow(await db.ziel.findFirst({ where: { id: fields.zielId, inhaberId: actor.id } }));
const ownCandidate = async ({ db, actor, fields }: Context) => requireRow(await db.kandidatur.findFirst({ where: { id: fields.kandidaturId, ownerId: actor.id } }));
const ownSource = async ({ db, actor, fields }: Context) => requireRow(await db.kalenderquelle.findFirst({ where: { id: fields.id, ownerId: actor.id }, select: { id: true, name: true, aktiv: true } }));
const ownInvite = async ({ db, actor, fields }: Context) => requireRow(await db.invite.findFirst({ where: { id: fields.inviteId, ...(actor.role === "ADMIN" ? {} : { leaderId: actor.id }) }, select: { id: true, note: true, usedAt: true, expiresAt: true } }));
const managedPerson = async ({ actor, fields }: Context) => requireRow(await (await import("@/lib/struktur-verwaltung")).ladeStrukturperson(actor.id, fields.userId));
const goalFields = { zielId: id.optional(), inhaberId: id.optional(), kennzahl: z.enum(ZielKennzahl), zielwert: text, zeitraum: z.enum(["WOCHE", "MONAT"]), tag: text, titel: optional, wunsch: optional, hauptziel: z.enum(["ja", "nein"]).optional() };
const fieldLabels: Record<string, string> = { name: "Name", phone: "Telefon", telefon: "Telefon", text: "Inhalt", note: "Notiz", notiz: "Notiz", title: "Titel", titel: "Titel", rating: "Bewertung", listKind: "Liste", von: "Bisherige Liste", nach: "Neue Liste", stage: "Phase", phase: "Phase", result: "Ergebnis", appointmentAt: "Termin", nextStepDate: "Datum", nextStepTime: "Uhrzeit", nextStepNote: "Nächster Schritt", at: "Zeitpunkt", day: "Tag", tag: "Tag", menge: "Einheiten", zielwert: "Zielwert", kennzahl: "Kennzahl", zeitraum: "Zeitraum", wunsch: "Wunsch", antwort: "Antwort", grund: "Grund", state: "Zustand", key: "Funktion", enabled: "Freigabe", warum: "Mein Warum", wert: "Arbeitsfokus", greeting: "Begrüßung", stake: "Einsatz", days: "Tage", CALL: "Anrufe", APPOINTMENT_SET: "Vereinbarte Termine", NUMBERS_PULLED: "Gezogene Nummern" };

/** Explicit, reviewed business operations. No arbitrary route, model, SQL, or form dispatch. */
export const CRM_OPERATIONS: Record<string, Operation> = {
  add_referrals: { area: "pipeline", title: "Empfehlungen erfassen", link: "/namen", schema: schema({ contactId: id, referrals }), subject: ownContact, run: async c => (await import("@/app/(app)/pipeline/actions")).addReferrals(referralForm(c.fields)) },
  snooze_contact_step: { area: "pipeline", title: "Kontaktschritt verschieben", link: "/heute", schema: schema({ contactId: id, days: integer }), subject: ownContact, run: async c => (await import("@/app/(app)/pipeline/actions")).snoozeContactStep(form(c.fields)) },
  save_profile_phone: { area: "profile", title: "Eigene Telefonnummer speichern", link: "/profil", schema: schema({ phone: z.string().max(30) }), run: async c => (await import("@/app/(app)/kontoActions")).nummerSpeichern(form(c.fields)) },
  create_team_person: { area: "team", title: "Strukturperson aufnehmen", link: "/mannschaft/verwalten", schema: schema({ name: z.string().trim().min(1).max(60), unterId: id.optional(), telefon: z.string().max(30).optional(), mitEinladung: z.enum(["on", ""]) }), run: async c => (await import("@/app/(app)/mannschaft/actions")).personAufnehmen(form(c.fields)) },
  invite_placeholder: { area: "team", title: "Strukturperson einladen", link: "/mannschaft/verwalten", schema: schema({ fuerId: id }), subject: async c => managedPerson({ ...c, fields: { userId: c.fields.fuerId } }), run: async c => (await import("@/app/(app)/mannschaft/actions")).einladungFuerPlatzhalter(form(c.fields)) },
  react_to_feed: { area: "feed", title: "Auf Feedbeitrag reagieren", link: "/arena", schema: schema({ eintragId: id, text: z.enum(SCHNELLTEXTE as [string, ...string[]]) }), subject: async c => requireRow(await c.db.feedEintrag.findFirst({ where: { id: c.fields.eintragId, person: { userId: { not: c.actor.id } } }, select: { id: true, text: true } })), run: async c => (await import("@/app/(team)/feedAction")).feedReagieren(form(c.fields)) },
  begin_sprint: { area: "onboarding", title: "Eigenen Sprint starten", link: "/arena", schema: schema({}), run: async () => (await import("@/app/(team)/arena/actions")).sprintStarten() },
  resume_onboarding: { area: "onboarding", title: "Eigenen Einstieg fortsetzen", link: "/heute", schema: schema({}), run: async c => (await import("@/lib/start/service")).resumeStart(await scopedPrisma(), c.actor.id) },
  pause_onboarding: { area: "onboarding", title: "Eigenen Einstieg pausieren", link: "/heute", schema: schema({ revision: integer }), run: async c => (await import("@/lib/start/service")).pauseStart(await scopedPrisma(), c.actor.id, Number(c.fields.revision)) },
  save_calculator_scenario: { area: "calculator", title: "Zinsrechner-Szenario speichern", link: "/zinsrechner", schema: schema({ id: id.optional(), version: integer, title: z.string().min(1).max(80), contactId: id.optional(), values: z.string().max(12000).describe("JSON: schemaVersion=1, start, monthly, years, scenario (msci/sp500/fest/tages/custom), customRate, waitYears, goals [{id,name,amount}], customerName; ausschließlich vom Nutzer genannte Annahmen.") }), subject: calculatorAccess, run: async c => (await import("@/lib/zinsrechner-service")).speichereZinsSzenario(await scopedPrisma(), c.actor.id, { ...c.fields, id: c.fields.id ?? randomUUID(), version: Number(c.fields.version), contactId: c.fields.contactId ?? null, values: JSON.parse(c.fields.values) }) },
  delete_calculator_scenario: { area: "calculator", title: "Zinsrechner-Szenario löschen", link: "/zinsrechner", schema: schema({ id, version: integer }), subject: calculatorAccess, run: async c => (await import("@/lib/zinsrechner-service")).loescheZinsSzenario(await scopedPrisma(), c.actor.id, c.fields.id, Number(c.fields.version)) },
  admin_create_invitation: { area: "admin", title: "Einladung unter einer Führungskraft erstellen", link: "/team", admin: true, schema: schema({ leaderId: id, note: z.string().max(80) }), subject: async c => requireRow(await c.db.user.findUnique({ where: { id: c.fields.leaderId }, select: { id: true, name: true } })), run: async c => (await import("@/app/(app)/team/actions")).einladungErzeugen(form(c.fields)) },
  admin_revoke_invitation: { area: "admin", title: "Einladung zurücknehmen", link: "/team", admin: true, schema: schema({ inviteId: id }), subject: ownInvite, run: async c => (await import("@/app/(app)/team/actions")).einladungZuruecknehmen(form(c.fields)) },
  admin_invitation_browser: { area: "admin", title: "Browserfreigabe einer Einladung ändern", link: "/team", admin: true, schema: schema({ inviteId: id, on: z.enum(["0", "1"]) }), subject: ownInvite, run: async c => (await import("@/app/(app)/team/actions")).einladungBrowserFreigabe(form(c.fields)) },
  save_career_thresholds: { area: "admin", title: "Karriereschwellen speichern", link: "/werkstatt", admin: true, schema: schema(Object.fromEntries([1, 2, 3, 4, 5, 6].map(n => [`schwelle-${n}`, z.string().refine(v => !v.trim() || (parseEinheiten(v) ?? 0) > 0).optional()]))), run: async c => (await import("@/app/(team)/werkstatt/actions")).schwellenSpeichern(form(c.fields)) },
  save_signal_thresholds: { area: "admin", title: "Ampelkriterien speichern", link: "/werkstatt", admin: true, schema: schema(Object.fromEntries(AMPEL_FELDER.map(f => [`ampel-${f.feld}`, z.string().refine(v => !v.trim() || /^\d+$/.test(v) && Number(v) >= (f.nullErlaubt ? 0 : 1) && (!f.prozent || Number(v) <= 100)).optional()]))), run: async c => (await import("@/app/(team)/werkstatt/actions")).ampelKriterienSpeichern(form(c.fields)) },
  save_focus_percentage: { area: "admin", title: "Fokusprozentsatz speichern", link: "/werkstatt", admin: true, schema: schema({ "fokus-prozentsatz": z.string().refine(v => !v.trim() || /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 100) }), run: async c => (await import("@/app/(team)/werkstatt/actions")).fokusProzentsatzSpeichern(form(c.fields)) },
  collect_name: { area: "contacts", title: "Name sammeln", link: "/namen", schema: schema({ name: text, listKind: z.enum(["VERKAUF", "RECRUITING"]), phone: optional, rating: z.enum(["A", "B", "C"]).optional() }), run: async c => (await import("@/app/(app)/namen/actions")).addName(form(c.fields)) },
  rate_contact: { area: "contacts", title: "Kontakt bewerten", link: "/namen", schema: schema({ contactId: id, rating: z.enum(["A", "B", "C", ""]) }), subject: ownContact, run: async c => (await import("@/app/(app)/namen/actions")).setRating(form(c.fields)) },
  move_names: { area: "contacts", title: "Namen in Listen verschieben", link: "/namen", schema: schema({ ids: text, von: z.enum(["VERKAUF", "RECRUITING", ""]), nach: z.enum(["VERKAUF", "RECRUITING", ""]) }), subject: async c => {
    const ids = [...new Set(c.fields.ids.split(",").map(x => x.trim()).filter(Boolean))];
    if (!ids.length || ids.length > 500) throw new AiCrmError("INVALID_INPUT", "Wähle zwischen 1 und 500 konkrete Namen.");
    const rows = await c.db.contact.findMany({ where: { id: { in: ids }, ownerId: c.actor.id }, select: { id: true, name: true, listKinds: true }, orderBy: { id: "asc" } });
    if (rows.length !== ids.length) throw new AiCrmError("NOT_FOUND", "Nicht alle ausgewählten Namen sind verfügbar.", 404);
    return rows;
  }, run: async c => (await import("@/app/(app)/namen/actions")).moveNames(form(c.fields)) },
  delete_contact: { area: "contacts", title: "Kontakt löschen", link: "/namen", schema: schema({ contactId: id }), subject: ownContact, run: async c => {
    await (await import("@/app/(app)/contacts/actions")).deleteContact(form(c.fields));
  } },
  set_contact_stage: { area: "pipeline", title: "Pipeline-Phase ändern", link: "/trichter", schema: schema({ contactId: id, stage: z.enum(ContactStage), appointmentAt: optional, nextStepType: optional, nextStepDate: optional, nextStepTime: optional, nextStepNote: optional }), subject: ownContact, run: async c => (await import("@/app/(app)/pipeline/actions")).setContactStage(form(c.fields)) },
  mark_contact_lost: { area: "pipeline", title: "Absage dokumentieren", link: "/trichter", schema: schema({ contactId: id, lostReason: z.enum(LostReason), askReferral: z.enum(["on", ""]).optional() }), subject: ownContact, run: async c => (await import("@/app/(app)/pipeline/actions")).markContactLost(form(c.fields)) },
  reopen_contact: { area: "pipeline", title: "Kontakt wieder aufnehmen", link: "/trichter", schema: schema({ contactId: id }), subject: ownContact, run: async c => (await import("@/app/(app)/pipeline/actions")).reopenContact(form(c.fields)) },
  record_call_result: { area: "pipeline", title: "Anrufergebnis dokumentieren", link: "/heute", schema: schema({ contactId: id, result: z.enum(["appointment", "unreachable", "later", "no_interest"]), appointmentAt: optional, note: optional, days: optional }), subject: ownContact, run: async c => (await import("@/app/(app)/contacts/results")).recordCallResult(form(c.fields)) },
  record_appointment_result: { area: "pipeline", title: "Terminergebnis dokumentieren", link: "/heute", schema: schema({ contactId: id, result: z.enum(["abschluss", "offen", "kein_abschluss"]), referrals: referrals.optional() }), subject: ownContact, run: async c => (await import("@/app/(app)/contacts/results")).recordAppointmentResult(referralForm(c.fields)) },
  record_appointment_missed: { area: "pipeline", title: "Ausgefallenen Termin dokumentieren", link: "/heute", schema: schema({ contactId: id }), subject: ownContact, run: async c => (await import("@/app/(app)/contacts/results")).recordAppointmentMissed(form(c.fields)) },
  complete_contact_step: { area: "pipeline", title: "Nächsten Kontaktschritt erledigen", link: "/heute", schema: schema({ contactId: id, text: text, nextStepType: optional, nextStepDate: optional, nextStepTime: optional, nextStepNote: optional }), subject: ownContact, run: async c => (await import("@/app/(app)/pipeline/actions")).completeContactStep(form(c.fields)) },
  move_follow_up: { area: "pipeline", title: "Wiedervorlage verschieben", link: "/heute", schema: schema({ followUpId: id, at: z.string().datetime({ offset: true }) }), subject: async c => requireRow(await c.db.contactFollowUp.findFirst({ where: { id: c.fields.followUpId, ownerId: c.actor.id, contact: { ownerId: c.actor.id }, status: "OPEN" } })), run: async c => (await import("@/lib/followups")).wiedervorlageVerschieben((await import("@/lib/prisma")).prisma, { userId: c.actor.id, followUpId: c.fields.followUpId, at: new Date(c.fields.at) }) },
  create_candidate: { area: "contacts", title: "Kandidatur anlegen", link: "/namen", schema: schema({ contactId: id }), subject: ownContact, run: async c => (await import("@/app/(app)/namen/kandidaturActions")).kandidaturAnlegen(c.fields.contactId) },
  set_candidate_phase: { area: "contacts", title: "Kandidaturphase ändern", link: "/namen", schema: schema({ kandidaturId: id, phase: z.enum(KandidaturPhase) }), subject: ownCandidate, run: async c => (await import("@/app/(app)/namen/kandidaturActions")).kandidaturPhaseSetzen(c.fields.kandidaturId, c.fields.phase as import("@/lib/generated/prisma/enums").KandidaturPhase) },
  candidate_commitment: { area: "contacts", title: "Kandidatur-Zusage und Einladung", link: "/einladen", schema: schema({ kandidaturId: id }), subject: ownCandidate, run: async c => { await (await import("@/app/(app)/namen/kandidaturActions")).zusageErteilen(c.fields.kandidaturId); return { invitationAvailable: true }; } },
  delete_appointment: { area: "calendar", title: "Eigenen Termin löschen", link: "/kalender", schema: schema({ id }), subject: async c => requireRow(await c.db.termin.findFirst({ where: { id: c.fields.id, ownerId: c.actor.id } })), run: async c => (await import("@/app/(app)/kalender/actions")).terminLoeschen(form(c.fields)) },
  delete_calendar_source: { area: "calendar", title: "Kalenderquelle entfernen", link: "/kalender/quellen", schema: schema({ id }), subject: ownSource, run: async c => (await import("@/app/(app)/kalender/quellen/actions")).quelleLoeschen(form(c.fields)) },
  save_goal: { area: "goals", title: "Ziel speichern oder vorschlagen", link: "/fortschritt", schema: schema(goalFields), run: async c => (await import("@/app/(app)/fortschritt/actions")).zielSpeichern({}, form(c.fields)) },
  respond_goal: { area: "goals", title: "Auf Zielvorschlag antworten", link: "/fortschritt", schema: schema({ zielId: id, antwort: z.enum(["ja", "nein"]) }), subject: ownGoal, run: async c => (await import("@/app/(app)/fortschritt/actions")).zielAntworten(form(c.fields)) },
  select_main_goal: { area: "goals", title: "Hauptziel wählen", link: "/fortschritt", schema: schema({ zielId: id }), subject: ownGoal, run: async c => (await import("@/app/(app)/fortschritt/actions")).hauptzielWaehlen(form(c.fields)) },
  archive_goal: { area: "goals", title: "Eigenes Ziel beenden", link: "/fortschritt", schema: schema({ zielId: id }), subject: ownGoal, run: async c => (await import("@/app/(app)/fortschritt/actions")).zielArchivieren(form(c.fields)) },
  share_goal_success: { area: "goals", title: "Zielerfolg im Feed teilen", link: "/arena", schema: schema({ zielId: id }), subject: ownGoal, run: async c => (await import("@/app/(app)/fortschritt/actions")).zielErfolgTeilen(form(c.fields)) },
  save_team_goal: { area: "goals", title: "Teamziel anlegen", link: "/mannschaft/ziele", schema: schema({ kennzahl: text, zielwert: text, zeitraum: z.enum(["WOCHE", "MONAT"]), tag: text, titel: optional, wunsch: optional }), run: async c => (await import("@/app/(app)/mannschaft/ziele/actions")).teamzielAnlegen({}, form(c.fields)) },
  archive_team_goal: { area: "goals", title: "Teamziel beenden", link: "/mannschaft/ziele", schema: schema({ zielId: id }), subject: async c => requireRow(await c.db.teamziel.findFirst({ where: { id: c.fields.zielId, verantwortlichId: c.actor.id } })), run: async c => (await import("@/app/(app)/mannschaft/ziele/actions")).teamzielBeenden(form(c.fields)) },
  book_units: { area: "performance", title: "Einheiten buchen", link: "/einheiten", schema: schema({ menge: text, tag: text, notiz: optional, erinnerungId: id.optional() }), run: async c => (await import("@/app/(team)/einheiten/actions")).einheitenBuchen(c.fields.menge, c.fields.tag, c.fields.notiz ?? "", c.fields.erinnerungId) },
  delete_unit_booking: { area: "performance", title: "Eigene Einheitenbuchung löschen", link: "/einheiten", schema: schema({ buchungId: id }), subject: async c => requireRow(await c.db.einheitenbuchung.findFirst({ where: { id: c.fields.buchungId, userId: c.actor.id } })), run: async c => (await import("@/app/(team)/einheiten/actions")).buchungLoeschen(form(c.fields)) },
  save_units_start: { area: "performance", title: "Karrierestufe und Startbestand speichern", link: "/einheiten", schema: schema({ karrierestufe: z.enum(["", "1", "2", "3", "4", "5", "6"]), einheitenStart: text }), run: async c => (await import("@/app/(team)/einheiten/actions")).standSpeichern(form(c.fields)) },
  log_activity_counts: { area: "performance", title: "Manuelle Tagesaktivität erfassen", link: "/log", schema: schema({ day: text, CALL: optional, APPOINTMENT_SET: optional, NUMBERS_PULLED: optional }), run: async c => (await import("@/app/(team)/log/actions")).logDaily(form(c.fields)) },
  delete_activity_count: { area: "performance", title: "Heutige manuelle Aktivität löschen", link: "/log", schema: schema({ logId: id }), subject: async c => requireRow(await c.db.dailyLog.findFirst({ where: { id: c.fields.logId, person: { userId: c.actor.id }, activityId: null, date: dayToUtcDate(berlinToday()) } })), run: async c => (await import("@/app/(team)/log/actions")).deleteLog(form(c.fields)) },
  send_message: { area: "communication", title: "Interne Nachricht senden", link: "/arena", schema: schema({ anId: id, text: z.string().trim().min(1).max(200) }), subject: async c => { if (c.fields.anId === c.actor.id) throw new AiCrmError("INVALID_INPUT", "Wähle eine andere Person als Empfänger."); return requireRow(await c.db.user.findFirst({ where: { id: c.fields.anId, deactivatedAt: null }, select: { id: true, name: true } })); }, run: async c => (await import("@/app/(team)/nachrichtAction")).nachrichtSenden(form(c.fields)) },
  mark_messages_read: { area: "communication", title: "Eigene Nachrichten als gelesen markieren", link: "/arena", schema: schema({}), run: async () => (await import("@/app/(team)/nachrichtAction")).nachrichtenGelesen() },
  create_invitation: { area: "communication", title: "Eigene Einladung erstellen", link: "/einladen", schema: schema({ note: optional, greeting: optional, stake: optional, mehrfach: z.enum(["0", "1"]).optional() }), run: async c => { await (await import("@/app/(app)/einladen/actions")).einladungFuerMich(form(c.fields)); return { invitationAvailable: true }; } },
  revoke_invitation: { area: "communication", title: "Eigene Einladung zurücknehmen", link: "/einladen", schema: schema({ inviteId: id }), subject: ownInvite, run: async c => (await import("@/app/(app)/einladen/actions")).eigeneEinladungZuruecknehmen(form(c.fields)) },
  save_profile_focus: { area: "profile", title: "Arbeitsfokus ändern", link: "/profil", schema: schema({ wert: z.enum(Arbeitsfokus) }), run: async c => (await import("@/app/(app)/profil/actions")).arbeitsfokusSpeichern(c.fields.wert) },
  save_why: { area: "profile", title: "Persönliches Warum speichern", link: "/fortschritt/warum", schema: schema({ warum: z.string().max(4000) }), run: async c => (await import("@/app/(app)/fortschritt/actions")).warumSpeichern(form(c.fields)) },
  edit_team_person: { area: "team", title: "Strukturperson bearbeiten", link: "/mannschaft/verwalten", schema: schema({ userId: id, name: optional, phone: optional, karrierestufe: optional, startedAt: optional, leaderId: optional }), subject: managedPerson, run: async c => { const { userId, ...fields } = c.fields; return (await import("@/lib/struktur-verwaltung")).speichereStrukturperson(c.actor.id, userId, fields); } },
  deactivate_team_person: { area: "team", title: "Person austragen", link: "/mannschaft/verwalten", schema: schema({ userId: id }), subject: managedPerson, run: async c => (await import("@/lib/struktur-verwaltung")).strukturpersonAustragen(c.actor.id, c.fields.userId, false) },
  reactivate_team_person: { area: "team", title: "Person wieder aufnehmen", link: "/mannschaft/verwalten", schema: schema({ userId: id }), subject: managedPerson, run: async c => (await import("@/lib/struktur-verwaltung")).strukturpersonAustragen(c.actor.id, c.fields.userId, true) },
  delete_team_person: { area: "team", title: "Strukturperson endgültig löschen", link: "/mannschaft/verwalten", schema: schema({ userId: id, name: text }), subject: managedPerson, run: async c => (await import("@/lib/struktur-verwaltung")).loescheStrukturperson(c.actor.id, c.fields.userId, c.fields.name) },
  create_report_link: { area: "team", title: "Berichtslink erstellen", link: "/mannschaft/bericht", schema: schema({}), run: async () => (await import("@/app/(app)/mannschaft/bericht/actions")).berichtLinkErzeugen() },
  rotate_report_link: { area: "team", title: "Berichtslink erneuern", link: "/mannschaft/bericht", schema: schema({}), run: async () => (await import("@/app/(app)/mannschaft/bericht/actions")).berichtLinkErneuern() },
  set_ai_access: { area: "admin", title: "KI-Zugang eines Kontos ändern", link: "/werkstatt/ai", admin: true, schema: schema({ userId: id, enabled: z.enum(["0", "1"]) }), subject: managedPerson, run: async c => (await import("@/app/(team)/werkstatt/ai/actions")).aiBetaSchalten(form(c.fields)) },
  set_feature: { area: "admin", title: "CRM-Funktion umschalten", link: "/werkstatt", admin: true, schema: schema({ key: id, state: z.enum(["TEST", "LAEUFT", "AUS", "ABGERISSEN"]), grund: optional }), subject: async c => requireRow(await c.db.feature.findUnique({ where: { key: c.fields.key } })), run: async c => (await import("@/app/(team)/werkstatt/actions")).schalten(form(c.fields)) },
  create_password_reset: { area: "admin", title: "Passwortreset bereitstellen", link: "/team", admin: true, schema: schema({ userId: id }), subject: managedPerson, run: async c => (await import("@/app/(app)/team/actions")).passwortResetErzeugen(form(c.fields)) },
};

export async function workActor(db: Db, userId: string): Promise<Actor> {
  return requireRow(await db.user.findFirst({ where: { id: userId, deactivatedAt: null }, select: { id: true, name: true, role: true, path: true } }));
}
export function parseOperation(raw: Record<string, unknown>) {
  const operation = String(raw.operation);
  const definition = CRM_OPERATIONS[operation];
  if (!Object.hasOwn(CRM_OPERATIONS, operation) || !definition) throw new AiCrmError("UNKNOWN_TOOL", "Diese CRM-Funktion ist nicht vorhanden.");
  const entries = raw.fields as Array<{ name: string; value: string }>;
  if (!Array.isArray(entries) || new Set(entries.map(x => x.name)).size !== entries.length) throw new AiCrmError("INVALID_INPUT", "Die Angaben sind nicht eindeutig.");
  const parsed = definition.schema.safeParse(Object.fromEntries(entries.map(x => [x.name, x.value])));
  if (!parsed.success) throw new AiCrmError("INVALID_TOOL_INPUT", `Bitte ergänze gültige Angaben für „${definition.title}“: ${parsed.error.issues.map(issue => issue.path.join(".")).join(", ")}.`);
  return { definition, fields: parsed.data, operation };
}
export async function describeWorkOperation(db: Db, userId: string, raw: Record<string, unknown>) {
  const { definition, fields } = parseOperation(raw);
  const actor = await workActor(db, userId);
  if (definition.admin && actor.role !== "ADMIN") throw new AiCrmError("FORBIDDEN", "Diese Funktion benötigt Verwaltungsrechte.", 403);
  const subject = await withDatabase(db, false, [], async () => definition.subject ? definition.subject({ db, actor, fields }) : null);
  const expected = JSON.parse(JSON.stringify({ actor: { id: actor.id, role: actor.role, path: actor.path }, subject }));
  const subjectRows = (Array.isArray(subject) ? subject : subject ? [subject] : []) as Array<{ name?: string; title?: string; titel?: string }>;
  const details = [...subjectRows.map(row => row.name ?? row.title ?? row.titel).filter((name): name is string => Boolean(name)), ...Object.entries(fields).filter(([key]) => !/Id$|^ids$|^id$|^version$/.test(key)).map(([key, value]) => `${fieldLabels[key] ?? key}: ${value}`)];
  const receipt: ActionReceipt = { summary: definition.title, status: "PENDING", undoable: false, link: definition.link, details, confirmLabel: definition.title };
  return { expected, receipt };
}

export async function executeWorkOperation(db: Prisma.TransactionClient, userId: string, raw: Record<string, unknown>, afterCommit: Array<() => Promise<unknown>>): Promise<CrmToolResult> {
  const { definition, fields } = parseOperation(raw);
  const actor = await workActor(db, userId);
  if (definition.admin && actor.role !== "ADMIN") throw new AiCrmError("FORBIDDEN", "Diese Funktion benötigt Verwaltungsrechte.", 403);
  // Existing actions authenticate normally within the shared transaction.
  let result: unknown;
  await withDatabase(db, true, afterCommit, async () => {
    const authenticated = await (await import("@/lib/auth")).requireUser();
    if (authenticated.id !== userId) throw new AiCrmError("FORBIDDEN", "Der Nutzerbezug hat sich geändert.", 403);
    try { result = await definition.run({ db, actor, fields }); }
    catch (error) {
      const digest = error && typeof error === "object" && "digest" in error ? String(error.digest) : "";
      if (digest.startsWith("NEXT_REDIRECT;")) {
        const location = digest.split(";").slice(2, -2).join(";");
        if (/error=|fehler=|\/login|\/avv/.test(location)) throw new AiCrmError("DOMAIN_REJECTED", "Die CRM-Funktion konnte diesen Auftrag nicht ausführen. Bitte prüfe die Angaben.");
      } else throw error;
    }
    if (result && typeof result === "object" && ("fehler" in result && result.fehler || "ok" in result && result.ok === false)) throw new AiCrmError("DOMAIN_REJECTED", "fehler" in result ? String(result.fehler) : "Der Auftrag konnte nicht ausgeführt werden.");
  });
  // Auth links, credentials and arbitrary action internals never enter model context.
  const data: Record<string, unknown> = {};
  if (result && typeof result === "object" && "count" in result && typeof result.count === "number") data.count = result.count;
  if (result && typeof result === "object" && "id" in result && typeof result.id === "string") data.id = result.id;
  const entityType = raw.operation === "collect_name" ? "Contact" : raw.operation === "create_candidate" ? "Kandidatur" : raw.operation === "create_team_person" ? "User" : raw.operation === "save_calculator_scenario" ? "ZinsSzenario" : undefined;
  const reset = raw.operation === "create_password_reset" ? await db.passwortReset.findFirstOrThrow({ where: { userId: fields.userId, usedAt: null }, orderBy: { createdAt: "desc" }, select: { id: true } }) : null;
  return { ok: true, summary: `${definition.title}${data.count !== undefined ? `: ${data.count} Einträge` : ""}`, data, entityType, entityId: typeof data.id === "string" ? data.id : undefined, link: definition.link, undoable: false, ...(reset ? { privateResult: { resetId: reset.id } } : {}) };
}
