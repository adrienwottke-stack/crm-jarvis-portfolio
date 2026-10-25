import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { ladeVereinbarungen, vereinbarungspartner } from "@/lib/vereinbarungen";
import PartnerVereinbarungen from "@/components/vereinbarungen/PartnerVereinbarungen";
import VereinbarungsKarte from "@/components/vereinbarungen/VereinbarungsKarte";
import { pageTitle } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function VereinbarungenPage({
  searchParams,
}: {
  searchParams: Promise<{ partner?: string }>;
}) {
  const user = await requireUser();
  const { partner } = await searchParams;
  const gegenueber = partner
    ? await vereinbarungspartner(user.id, partner)
    : null;
  const staende = partner ? [] : await ladeVereinbarungen(user.id);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href="/mannschaft"
        className="inline-flex min-h-11 items-center text-base font-medium text-navy-800"
      >
        ← Team
      </Link>
      <h1 className={pageTitle}>Absprachen</h1>
      {partner ? (
        gegenueber ? (
          <PartnerVereinbarungen userId={user.id} partnerId={partner} />
        ) : (
          <p className="text-base text-slate-600">
            Diese Absprache ist in deiner aktuellen Teamzuordnung nicht
            verfügbar.
          </p>
        )
      ) : (
        <>
          {staende.length === 0 && (
            <p className="text-base text-slate-600">
              Noch keine gemeinsamen Absprachen. Öffne eine Person in deinem
              Team oder deinen Führungskontakt.
            </p>
          )}
          {staende.map((stand) => (
            <VereinbarungsKarte key={stand.id} stand={stand} userId={user.id} />
          ))}
        </>
      )}
    </div>
  );
}
