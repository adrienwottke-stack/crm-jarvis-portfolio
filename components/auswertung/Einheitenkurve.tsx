import { formatEinheiten } from "@/lib/einheiten";
import type { Kurvenpunkt } from "@/lib/team-auswertung-modell";

const kurz = (tag: string) =>
  new Intl.DateTimeFormat("de-DE", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${tag}T00:00:00Z`));

export default function Einheitenkurve({
  punkte,
  gross = false,
}: {
  punkte: Kurvenpunkt[];
  gross?: boolean;
}) {
  if (punkte.length === 0)
    return (
      <p className="text-ink-muted">
        In diesem Zeitraum liegen noch keine Tage.
      </p>
    );
  const breite = 720;
  const hoehe = gross ? 260 : 200;
  const links = 12;
  const oben = 16;
  const min = Math.min(0, ...punkte.map((punkt) => punkt.kumuliert));
  const max = Math.max(0, ...punkte.map((punkt) => punkt.kumuliert));
  const span = max - min || 100;
  // Ein Anfangspunkt bei null zeigt auch die erste Buchung als Anstieg/Abstieg.
  const werte = [0, ...punkte.map((punkt) => punkt.kumuliert)];
  const x = (index: number) =>
    links + (index / (werte.length - 1)) * (breite - 2 * links);
  const y = (wert: number) =>
    max === min ? hoehe / 2 : oben + ((max - wert) / span) * (hoehe - 2 * oben);
  const linie = werte
    .map((wert, index) => `${x(index).toFixed(2)},${y(wert).toFixed(2)}`)
    .join(" ");
  const ende = punkte.at(-1)!;
  return (
    <figure className="mt-6">
      <div
        className="mb-1 flex justify-between text-xs tabular-nums text-ink-muted"
        aria-hidden="true"
      >
        <span>{formatEinheiten(max)} EH</span>
        <span>
          {min < 0 ? `${formatEinheiten(min)} EH Tiefstand` : "Kumuliert"}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${breite} ${hoehe}`}
        className="w-full overflow-visible"
        role="img"
        aria-label={`Kumulierte Einheiten vom ${kurz(punkte[0].tag)} bis ${kurz(ende.tag)}: ${formatEinheiten(ende.kumuliert)}. Startbestände sind nicht enthalten.`}
      >
        <line
          x1={links}
          x2={breite - links}
          y1={y(0)}
          y2={y(0)}
          stroke="currentColor"
          className="text-line-strong"
          strokeDasharray="4 5"
        />
        <polyline
          points={linie}
          fill="none"
          stroke="currentColor"
          className="text-link"
          strokeWidth="3"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        <circle
          cx={x(werte.length - 1)}
          cy={y(ende.kumuliert)}
          r="5"
          fill="currentColor"
          className="text-link"
        />
      </svg>
      <figcaption className="mt-2 flex justify-between text-xs text-ink-muted">
        <span>{kurz(punkte[0].tag)}</span>
        <span>{kurz(ende.tag)}</span>
      </figcaption>
      <details className="mt-4 text-sm">
        <summary className="min-h-11 cursor-pointer py-3 font-medium text-ink">
          Tageswerte ansehen
        </summary>
        <div className="max-h-64 overflow-y-auto rounded-xl border border-line">
          <table className="w-full text-left text-sm tabular-nums">
            <caption className="sr-only">
              Datierte Einheiten im ausgewählten Zeitraum
            </caption>
            <thead className="sticky top-0 bg-surface text-ink-muted">
              <tr>
                <th className="px-3 py-2">Tag</th>
                <th className="px-3 py-2 text-right">Gebucht</th>
                <th className="px-3 py-2 text-right">Kumuliert</th>
              </tr>
            </thead>
            <tbody>
              {punkte.map((punkt) => (
                <tr key={punkt.tag} className="border-t border-line">
                  <td className="px-3 py-2">{kurz(punkt.tag)}</td>
                  <td className="px-3 py-2 text-right">
                    {formatEinheiten(punkt.tageswert)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {formatEinheiten(punkt.kumuliert)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
