import Link from "next/link";
import { istAn } from "@/lib/features";
import { prisma } from "@/lib/prisma";
import { eigeneSzenarien } from "@/lib/zinsrechner-service";

export default async function ZinsrechnerEinstieg({
  contactId,
  userId,
}: {
  contactId?: string;
  userId?: string;
}) {
  if (!(await istAn("zinsrechner"))) return null;
  const scenarios =
    contactId && userId
      ? await prisma.zinsSzenario
          .findMany({
            where: { ...eigeneSzenarien(userId), contactId },
            select: { id: true, title: true },
            orderBy: { updatedAt: "desc" },
            take: 3,
          })
          .catch(() => [])
      : [];
  return (
    <section
      aria-label="Für dein Kundengespräch"
      className="rounded-2xl border border-line bg-surface px-5 py-3"
    >
      <Link
        prefetch={false}
        href={
          contactId
            ? `/zinsrechner?kontakt=${encodeURIComponent(contactId)}`
            : "/zinsrechner"
        }
        className="flex min-h-14 items-center justify-between gap-4"
      >
        <span>
          <span className="block text-xs text-ink-muted">
            Für dein Kundengespräch
          </span>
          <span className="mt-1 block font-semibold">
            {contactId ? "Vermögensaufbau berechnen" : "Zinsrechner öffnen"}
          </span>
        </span>
        <span aria-hidden="true" className="text-xl text-link">
          ↗
        </span>
      </Link>
      {scenarios.length > 0 && (
        <ul className="border-t border-line py-2">
          {scenarios.map((s) => (
            <li key={s.id}>
              <Link
                prefetch={false}
                className="flex min-h-11 items-center justify-between gap-3 text-sm text-link"
                href={`/zinsrechner?kontakt=${encodeURIComponent(contactId!)}&szenario=${encodeURIComponent(s.id)}`}
              >
                <span>{s.title}</span>
                <span aria-hidden="true">→</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
