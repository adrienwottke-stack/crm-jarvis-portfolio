import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { ladeEinheitenErinnerungen } from "@/lib/einheiten-erinnerung";
import { berlinToday, shiftDay } from "@/lib/dates";
import EinheitenErinnerungsZeile from "@/components/ziele/EinheitenErinnerungsZeile";

export default async function EinheitenErinnerungen({
  userId,
  alle = false,
}: {
  userId: string;
  alle?: boolean;
}) {
  const user = await requireUser();
  if (user.id !== userId) return null;
  const erinnerungen = await ladeEinheitenErinnerungen(userId, alle);
  if (erinnerungen.length === 0)
    return alle ? (
      <p className="text-base text-slate-600">
        Keine offenen Einheiten-Erinnerungen.
      </p>
    ) : null;
  const zeilen = alle ? erinnerungen : erinnerungen.slice(0, 3);
  const datum = new Intl.DateTimeFormat("de-DE", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <h2 className="text-xl font-semibold">Einheiten nachtragen</h2>
      <ul className="divide-y divide-line">
        {zeilen.map((eintrag) => (
          <EinheitenErinnerungsZeile
            key={eintrag.id}
            id={eintrag.id}
            name={eintrag.contact.name}
            morgen={shiftDay(berlinToday(), 1)}
            datum={datum.format(eintrag.faelligAm!)}
          />
        ))}
      </ul>
      {!alle && erinnerungen.length > zeilen.length && (
        <Link
          className="inline-flex min-h-12 items-center text-base font-medium"
          href="/fortschritt/einheiten-offen"
        >
          Alle Erinnerungen ansehen →
        </Link>
      )}
    </section>
  );
}
