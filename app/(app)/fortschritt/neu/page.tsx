import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { strukturKonten } from "@/lib/struktur";
import { berlinToday } from "@/lib/dates";
import ZielFormular from "@/components/ziele/ZielFormular";
import { columnNarrow, pageTitle } from "@/components/ui";

export default async function NeuesZielPage({
  searchParams,
}: {
  searchParams: Promise<{ partner?: string }>;
}) {
  const user = await requireUser();
  const ids = await strukturKonten(user.id);
  const personen = await prisma.user.findMany({
    where: {
      id: { in: ids },
      deactivatedAt: null,
      passwordHash: { not: null },
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const { partner } = await searchParams;
  if (partner && !personen.some((person) => person.id === partner)) notFound();
  return (
    <div className={`${columnNarrow} space-y-7`}>
      <Link href="/fortschritt" className="inline-flex min-h-12 items-center">
        ← Fortschritt
      </Link>
      <h1 className={pageTitle}>Ein Ziel setzen</h1>
      <ZielFormular
        tag={berlinToday()}
        ich={user.id}
        personen={personen}
        vorauswahl={partner}
      />
    </div>
  );
}
