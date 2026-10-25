import Link from "next/link";
import { ladeZiele } from "@/lib/ziele";
import Fortschritt from "@/components/Fortschritt";

export default async function PartnerZielstand({
  userId,
  partnerId,
}: {
  userId: string;
  partnerId: string;
}) {
  const ziele = (await ladeZiele(userId)).filter(
    (z) => z.inhaberId === partnerId && z.aktiv,
  );
  if (!ziele.length) return null;
  return (
    <section className="space-y-3 rounded-2xl border border-line bg-surface p-5">
      <h2 className="text-lg font-semibold">Eure vereinbarten Ziele</h2>
      {ziele.map((z) => (
        <div key={z.id} className="space-y-2">
          <p className="font-medium">{z.titel}</p>
          <p className="text-sm">
            {z.standText} {z.kennzahlText}
            {z.geschafft ? " · Geschafft!" : ""}
          </p>
          <Fortschritt
            anteil={z.anteil}
            ton={z.geschafft ? "erfolg" : "info"}
            beschriftung={`${z.standText} ${z.kennzahlText}`}
          />
        </div>
      ))}
      <Link
        href={`/fortschritt/neu?partner=${partnerId}`}
        className="inline-flex min-h-11 items-center text-sm text-link"
      >
        Weiteres Ziel vorschlagen →
      </Link>
    </section>
  );
}
