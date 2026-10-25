import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { ladeVereinbarungen } from "@/lib/vereinbarungen";
import VereinbarungsKarte from "@/components/vereinbarungen/VereinbarungsKarte";
import { columnNarrow, pageTitle } from "@/components/ui";

export default async function AbsprachePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const stand = (await ladeVereinbarungen(user.id)).find(v => v.id === id);
  if (!stand) notFound();
  return <div className={`${columnNarrow} space-y-6`}>
    <h1 className={pageTitle}>Eure Absprache</h1>
    <VereinbarungsKarte stand={stand} userId={user.id} />
    <Link href={`/mannschaft/vereinbarungen?partner=${stand.partner.id}`} className="inline-flex min-h-11 items-center text-link">Alle Absprachen mit {stand.partner.name} →</Link>
  </div>;
}
