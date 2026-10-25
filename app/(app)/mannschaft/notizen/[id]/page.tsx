import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readLeadershipSource } from "@/lib/ai-crm/leadership-tools";
import { AiCrmError } from "@/lib/ai-crm/errors";
import { pageTitle } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function LeadershipNotePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const source = await readLeadershipSource(prisma, user.id, "note", (await params).id).catch(error => {
    if (error instanceof AiCrmError && error.status === 404) notFound();
    throw error;
  });
  if (!("text" in source)) notFound();
  const format = (date: Date) => new Intl.DateTimeFormat("de-DE", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Berlin" }).format(date);
  return <div className="mx-auto max-w-3xl space-y-6">
    <Link href={`/mannschaft/${source.partnerId}`} className="inline-flex min-h-11 items-center text-base font-medium text-navy-800">← Partner</Link>
    <h1 className={pageTitle}>{source.title}</h1>
    <p className="text-sm text-slate-600">Private Gesprächsnotiz · nur für dich. Gespräch am {format(source.occurredAt)} (Europe/Berlin). Gespeichert am {format(source.createdAt)}.</p>
    <article className="rounded-2xl border border-slate-200 bg-white p-6"><p className="whitespace-pre-wrap break-words">{source.text}</p></article>
    <Link href="/assistent" className="inline-flex min-h-11 items-center text-navy-800">Zu Jarvis</Link>
  </div>;
}
