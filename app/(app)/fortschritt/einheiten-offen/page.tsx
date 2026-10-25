import Link from "next/link";
import { requireUser } from "@/lib/auth";
import EinheitenErinnerungen from "@/components/ziele/EinheitenErinnerungen";
import { columnNarrow, pageTitle } from "@/components/ui";

export default async function OffeneEinheitenPage() {
  const user = await requireUser();
  return (
    <div className={`${columnNarrow} space-y-7`}>
      <Link href="/fortschritt" className="inline-flex min-h-12 items-center">
        ← Fortschritt
      </Link>
      <h1 className={pageTitle}>Offene Einheiten</h1>
      <EinheitenErinnerungen userId={user.id} alle />
    </div>
  );
}
