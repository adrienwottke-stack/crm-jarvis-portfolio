import Link from "next/link";
import SeitenKopf from "@/components/SeitenKopf";
import RueckmeldungGeben from "@/components/RueckmeldungGeben";
import { AssistantContextEntry } from "@/components/ai-crm/AssistantEntry";
import { CRM_HELP } from "@/lib/crm-help";
import { prisma } from "@/lib/prisma";
import { card, columnWide } from "@/components/ui";

export default async function HilfePage() {
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN", deactivatedAt: null }, orderBy: { createdAt: "asc" }, select: { name: true } });
  return <div className={`${columnWide} space-y-6`}>
    <SeitenKopf titel="Hilfe und Support" unterzeile="Anleitungen für deinen Arbeitsalltag und ein direkter Weg zur Rückmeldung." aktion={<AssistantContextEntry label="Jarvis um Hilfe bitten" prompt="Zeige mir die vorhandene Hilfe für das CRM." />} />
    <div className="grid gap-4 md:grid-cols-2">{CRM_HELP.filter(item => item.id !== "support").map(item => <section className={`${card} p-5`} key={item.id}><h2 className="text-base font-semibold">{item.title}</h2><p className="mt-3 text-sm leading-relaxed text-ink-muted">{item.detail}</p><Link className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-link" href={item.link}>Bereich öffnen →</Link></section>)}</div>
    <section id="rueckmeldung" className={`${card} p-5`}><h2 className="text-base font-semibold">Rückmeldung geben</h2><p className="my-3 text-sm text-ink-muted">Melde ein Problem oder einen Verbesserungsvorschlag über die vorhandene Rückmeldefunktion{admin ? ` an ${admin.name}` : " an die Administration"}.</p><RueckmeldungGeben empfaenger={admin?.name.split(" ")[0]} /></section>
  </div>;
}
