import { z } from "zod";
import { providerSchema } from "./provider-schema";
import type { PrismaClient } from "@/lib/generated/prisma/client";
import { withDatabase } from "@/lib/database-context";
import { istAn } from "@/lib/features";
import { CRM_HELP } from "@/lib/crm-help";
import { berechne, euro, MODELL_HINWEIS, pruefeRechnerWerte, standardWerte } from "@/lib/zinsrechner";
import { AiCrmError } from "./errors";
import type { CrmToolResult } from "./tools";

export const WORKSPACE_SCHEMAS = {
  get_crm_help: z.object({}).strict(),
  calculate_interest: z.object({ start: z.number().min(0).max(100000), monthly: z.number().min(0).max(2000), years: z.number().int().min(1).max(50), rate: z.number().min(-20).max(20) }).strict(),
};
const descriptions = {
  get_crm_help: "Liest die hinterlegten CRM-Anleitungen und tatsächlichen Hilfewege. Keine Kontaktadressen erfinden.",
  calculate_interest: "Berechnet eine Modellrechnung mit der bestehenden CRM-Rechenlogik und erstellt einen Link zum manuell bearbeitbaren Zinsrechner mit genau diesen Eingaben. Rendite ist eine Annahme, keine Prognose. Speichert kein Szenario. Startkapital 0–100000 Euro, monatlich 0–2000 Euro, 1–50 Jahre, effektive jährliche Rendite -20 bis 20 Prozent. Fehlende Annahmen beim Nutzer erfragen.",
};
export const WORKSPACE_TOOL_DEFINITIONS = Object.entries(WORKSPACE_SCHEMAS).map(([name, schema]) => ({ type: "function" as const, name, description: descriptions[name as keyof typeof descriptions], strict: true, parameters: providerSchema(z.toJSONSchema(schema, { target: "draft-7", io: "input" })) }));

export async function runWorkspaceRead(db: PrismaClient, userId: string, name: string, args: Record<string, unknown>): Promise<CrmToolResult> {
  if (name === "get_crm_help") return { ok: true, summary: "Hilfe aus der Anwendung", data: { items: [...CRM_HELP] }, link: "/hilfe" };
  const enabled = await withDatabase(db, false, [], () => istAn("zinsrechner"));
  if (!enabled) throw new AiCrmError("FEATURE_DISABLED", "Der Zinsrechner ist derzeit abgeschaltet.", 403);
  const values = pruefeRechnerWerte({ ...standardWerte(), start: args.start, monthly: args.monthly, years: args.years, scenario: "custom", customRate: args.rate });
  const result = berechne(values).main;
  const query = new URLSearchParams({ start: String(values.start), monatlich: String(values.monthly), jahre: String(values.years), rendite: String(values.customRate) });
  const link = `/zinsrechner?${query}`;
  return { ok: true, summary: `Modellrechnung: ${euro(result.end)} nach ${values.years} Jahren.`, data: { values, result: { end: result.end, paid: result.paid, gain: result.gain }, disclaimer: MODELL_HINWEIS, items: [{ id: "calculation", title: "Im Zinsrechner prüfen und bearbeiten", detail: `${euro(values.start)} Startkapital · ${euro(values.monthly)} monatlich · ${values.years} Jahre · ${values.customRate} % angenommene Rendite. ${MODELL_HINWEIS}`, link }] }, link };
}
