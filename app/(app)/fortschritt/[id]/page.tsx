import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { ladeZielZumBearbeiten } from "@/lib/ziele";
import ZielFormular from "@/components/ziele/ZielFormular";
import { columnNarrow, pageTitle } from "@/components/ui";

export default async function ZielBearbeitenPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const ziel = await ladeZielZumBearbeiten(id, user).catch(() => null);
  if (!ziel || ziel.inhaberId !== user.id || ziel.zeitraum === "ALT_30_TAGE")
    notFound();
  return (
    <div className={`${columnNarrow} space-y-7`}>
      <Link href="/fortschritt" className="inline-flex min-h-12 items-center">
        ← Fortschritt
      </Link>
      <h1 className={pageTitle}>Ziel bearbeiten</h1>
      <ZielFormular
        ich={user.id}
        personen={[user]}
        tag={ziel.start.toISOString().slice(0, 10)}
        ziel={{ ...ziel, tag: ziel.start.toISOString().slice(0, 10) }}
      />
    </div>
  );
}
