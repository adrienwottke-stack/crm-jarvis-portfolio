import Link from "next/link";
import { ladeVereinbarungen, vereinbarungspartner } from "@/lib/vereinbarungen";
import VereinbarungsEditor from "./VereinbarungsEditor";
import VereinbarungsKarte from "./VereinbarungsKarte";

export default async function PartnerVereinbarungen({
  userId,
  partnerId,
}: {
  userId: string;
  partnerId: string;
}) {
  const partner = await vereinbarungspartner(userId, partnerId);
  if (!partner) return null;
  const vereinbarungen = await ladeVereinbarungen(userId, partnerId);
  const offen = vereinbarungen.filter(
    (stand) =>
      stand.status === "VORGESCHLAGEN" || stand.status === "BESTAETIGT",
  );
  const abgeschlossen = vereinbarungen.filter(
    (stand) =>
      stand.status !== "VORGESCHLAGEN" && stand.status !== "BESTAETIGT",
  );
  return (
    <section className="space-y-4" aria-labelledby="gemeinsame-absprachen">
      <div>
        <h2
          id="gemeinsame-absprachen"
          className="text-2xl font-semibold tracking-tight text-slate-900"
        >
          Unsere Absprachen
        </h2>
        <p className="mt-1 text-base text-slate-600">
          Was wir gemeinsam vorhaben und wer sich darum kümmert.
        </p>
      </div>
      {offen.length === 0 && (
        <p className="text-base text-slate-600">
          Noch keine offene Absprache. Schlage einen gemeinsamen nächsten
          Schritt vor.
        </p>
      )}
      {offen.map((stand) => (
        <VereinbarungsKarte key={stand.id} stand={stand} userId={userId} />
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <VereinbarungsEditor userId={userId} partner={partner} />
        <Link
          href={`/fortschritt/neu?partner=${partnerId}`}
          className="min-h-12 rounded-xl px-4 py-3 text-base font-semibold text-navy-800"
        >
          Gemeinsames Ziel vorschlagen
        </Link>
      </div>
      {abgeschlossen.length > 0 && (
        <details>
          <summary className="min-h-12 cursor-pointer py-3 text-base font-semibold text-slate-700">
            Abgeschlossene Absprachen ({abgeschlossen.length})
          </summary>
          <div className="mt-3 space-y-4">
            {abgeschlossen.map((stand) => (
              <VereinbarungsKarte
                key={stand.id}
                stand={stand}
                userId={userId}
              />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
