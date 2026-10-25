import Link from "next/link";
import { ladeHeuteVereinbarungen } from "@/lib/vereinbarungen";
import VereinbarungsKarte from "./VereinbarungsKarte";

export default async function VereinbarungenHeute({
  userId,
}: {
  userId: string;
}) {
  const vereinbarungen = await ladeHeuteVereinbarungen(userId);
  if (vereinbarungen.length === 0) return null;
  return (
    <section className="space-y-4" aria-labelledby="absprachen-heute">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id="absprachen-heute"
          className="text-2xl font-semibold tracking-tight text-slate-900"
        >
          Gemeinsam dran
        </h2>
        <Link
          href="/mannschaft/vereinbarungen"
          className="min-h-11 py-2 text-base font-medium text-navy-800"
        >
          Alle Absprachen
        </Link>
      </div>
      {vereinbarungen.slice(0, 3).map((stand) => (
        <VereinbarungsKarte
          key={stand.id}
          stand={stand}
          userId={userId}
          kompakt
        />
      ))}
      {vereinbarungen.length > 3 && (
        <p className="text-base text-slate-600">
          {vereinbarungen.length - 3} weitere unter „Alle Absprachen“.
        </p>
      )}
    </section>
  );
}
