import { prisma } from "@/lib/prisma";
import { ladeZiele } from "@/lib/ziele";
import GpName from "@/components/GpName";
import NachrichtSenden from "@/components/NachrichtSenden";
import Link from "next/link";

export default async function ErfolgeHeute({
  userId,
  team = false,
}: {
  userId: string;
  team?: boolean;
}) {
  const seit = new Date(Date.now() - 7 * 86400000);
  if (!team) {
    const reaktionen = await prisma.feedReaktion.findMany({
      where: { eintrag: { person: { userId } }, createdAt: { gte: seit } },
      select: { id: true, text: true, person: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 3,
    });
    if (!reaktionen.length) return null;
    return (
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Zuspruch für dich</h2>
        {reaktionen.map((r) => (
          <p key={r.id} className="rounded-xl bg-sunken p-4">
            <span className="font-medium">{r.person.name}:</span> {r.text}
          </p>
        ))}
      </section>
    );
  }
  const [partner, ziele] = await Promise.all([
    prisma.user.findMany({
      where: {
        leaderId: userId,
        deactivatedAt: null,
        passwordHash: { not: null },
      },
      select: { id: true, name: true },
    }),
    ladeZiele(userId),
  ]);
  const ids = partner.map((p) => p.id);
  const feed = await prisma.feedEintrag.findMany({
    where: { person: { userId: { in: ids } }, createdAt: { gte: seit } },
    select: { id: true, text: true, person: { select: { userId: true } } },
    orderBy: { createdAt: "desc" },
    take: 6,
  });
  const erfolge = partner
    .flatMap((p) => {
      const geteilt = feed.find((e) => e.person.userId === p.id);
      const ziel = ziele.find(
        (z) => z.inhaberId === p.id && z.aktiv && z.geschafft,
      );
      return geteilt || ziel
        ? [
            {
              ...p,
              text:
                geteilt?.text ??
                `Gemeinsames Ziel erreicht: ${ziel!.standText} ${ziel!.kennzahlText}`,
            },
          ]
        : [];
    })
    .slice(0, 3);
  if (!erfolge.length) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">Anlass zum Gratulieren</h2>
      {erfolge.map((p) => (
        <article key={p.id} className="rounded-xl border border-line p-4">
          <p className="font-semibold">
            <GpName name={p.name} />
          </p>
          <p className="mt-1 text-sm text-ink-muted">{p.text}</p>
          <div className="mt-2">
            <NachrichtSenden anId={p.id} name={p.name} variante="knopf" />
          </div>
        </article>
      ))}
      <Link
        href="/arena"
        className="inline-flex min-h-11 items-center text-sm text-link"
      >
        Weitere geteilte Erfolge →
      </Link>
    </section>
  );
}
