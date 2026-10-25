import SeitenKopf from "@/components/SeitenKopf";
import ReleaseCard from "@/components/releases/ReleaseCard";
import { listPublishedReleases } from "@/lib/releases/service";
import { prisma } from "@/lib/prisma";
import ReleaseHistoryReader from "@/components/releases/ReleaseHistoryReader";

export default async function NeuigkeitenPage({ searchParams }: { searchParams: Promise<{ release?: string }> }) {
  const [releases, params] = await Promise.all([listPublishedReleases(prisma), searchParams]);
  return <div className="crm-release-history">
    <SeitenKopf titel="Neuigkeiten" unterzeile="Was sich im Cockpit verbessert hat und wie du es ausprobieren kannst." />
    {releases.length ? releases.map((release, index) => <ReleaseCard release={release} latest={index === 0} selected={release.id === params.release} key={release.id} />) : <section className="crm-release-empty"><h2>Du bist auf dem aktuellen Stand.</h2><p>Neue Änderungen findest du nach ihrer Veröffentlichung hier.</p></section>}
    <ReleaseHistoryReader releaseIds={releases.map(release => release.id)} selectedId={params.release} />
  </div>;
}
