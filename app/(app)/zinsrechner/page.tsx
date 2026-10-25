import { after } from "next/server";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { istAn, merkeNutzung } from "@/lib/features";
import { ladeZinsSzenarien } from "@/lib/zinsrechner-service";
import type { GespeichertesSzenario } from "@/lib/zinsrechner";
import Rechner from "@/components/zinsrechner/Rechner";
import { pruefeRechnerWerte, standardWerte, type RechnerWerte } from "@/lib/zinsrechner";

export const metadata = { title: "Zinsrechner · Cockpit" };
export const dynamic = "force-dynamic";
export default async function ZinsrechnerPage({
  searchParams,
}: {
  searchParams: Promise<{ kontakt?: string; szenario?: string; start?: string; monatlich?: string; jahre?: string; rendite?: string }>;
}) {
  const user = await requireUser();
  if (!(await istAn("zinsrechner"))) notFound();
  const params = await searchParams;
  let draftValues: RechnerWerte | undefined;
  let draftError = false;
  if ([params.start, params.monatlich, params.jahre, params.rendite].some(value => value !== undefined)) {
    try {
      if ([params.start, params.monatlich, params.jahre, params.rendite].some(value => typeof value !== "string" || value.trim() === "")) throw new Error("Incomplete inputs");
      draftValues = pruefeRechnerWerte({ ...standardWerte(), start: Number(params.start), monthly: Number(params.monatlich), years: Number(params.jahre), scenario: "custom", customRate: Number(params.rendite) });
    } catch { draftError = true; }
  }
  const contactId =
    typeof params.kontakt === "string" ? params.kontakt : undefined;
  const scenarioId =
    typeof params.szenario === "string" ? params.szenario : undefined;
  const contact = contactId
    ? await prisma.contact.findFirst({
        where: { id: contactId, ownerId: user.id },
        select: { id: true, name: true },
      })
    : null;
  if (contactId && !contact) notFound();
  let saved: GespeichertesSzenario[] = [],
    storageError = false;
  try {
    saved = await ladeZinsSzenarien(prisma, user.id);
  } catch {
    storageError = true;
  }
  const initial = scenarioId
    ? (saved.find((s) => s.id === scenarioId) ?? null)
    : null;
  if (scenarioId && !initial && !storageError) notFound();
  if (initial && contactId && initial.contactId !== contactId) notFound();
  after(async () => {
    const person = await prisma.person.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    await merkeNutzung("zinsrechner", person?.id ?? null);
  });
  return (
    <div className="space-y-4">
    {draftError && <p role="alert" className="rounded-lg border border-line p-4 text-sm">Die übergebenen Werte sind unvollständig oder ungültig. Bitte trage deine Annahmen im Rechner ein.</p>}
    {draftValues && !initial && <p role="status" className="rounded-lg border border-line p-4 text-sm">Übernommene Annahmen · noch nicht gespeichert. Du kannst alle Werte im Rechner ändern.</p>}
    <Rechner
      key={`${contactId ?? "frei"}:${scenarioId ?? "neu"}:${JSON.stringify(draftValues)}`}
      berater={{ name: user.name, phone: user.phone, email: user.email }}
      contact={contact}
      initial={initial}
      saved={saved}
      storageError={storageError}
      draftValues={draftValues}
    />
    </div>
  );
}
