// Die Wand: was heute im Netzwerk geschafft wurde.
//
// Server-Komponente; nur die Reaktionsknoepfe darunter sind Client. Der Text
// steht so da, wie er beim Melden eingefroren wurde (siehe FeedEintrag.text) -
// die Zahl dahinter bewegt sich weiter, die Meldung soll stehenbleiben.

import type { FeedZeile } from "@/lib/feed";
import FeedReaktion from "@/components/FeedReaktion";
import { card, kicker, sectionTitle } from "@/components/ui";

const zeitFormat = new Intl.DateTimeFormat("de-DE", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Berlin",
});

function wann(at: Date): string {
  const min = Math.floor((Date.now() - at.getTime()) / 60_000);
  if (min < 1) return "gerade eben";
  if (min < 60) return `vor ${min} Min.`;
  return `${zeitFormat.format(at)} Uhr`;
}

export default function Feed({
  zeilen,
  meinePersonId,
}: {
  zeilen: FeedZeile[];
  meinePersonId: string;
}) {
  if (zeilen.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className={sectionTitle}>Geschafft</h2>
        <span className={kicker}>Netzwerk</span>
      </div>

      <ul className="space-y-3">
        {zeilen.map((zeile) => (
          <li key={zeile.id} className={`${card} p-4`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm text-ink">
                <span className="font-semibold">{zeile.name}</span>{" "}
                {zeile.text.charAt(0).toLowerCase() + zeile.text.slice(1)}
              </p>
              <span className="text-xs text-ink-soft">{wann(zeile.createdAt)}</span>
            </div>

            {/* Auf die eigene Meldung reagiert man nicht selbst. */}
            {zeile.personId !== meinePersonId && (
              <FeedReaktion eintragId={zeile.id} reaktionen={zeile.reaktionen} />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
