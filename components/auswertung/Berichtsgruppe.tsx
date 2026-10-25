import { formatEinheiten } from "@/lib/einheiten";
import type { Berichtsgruppe as Gruppe } from "@/lib/team-auswertung-modell";
import Einheitenkurve from "@/components/auswertung/Einheitenkurve";

const stufen = [
  { art: "CALL", label: "Anrufe" },
  { art: "APPOINTMENT_SET", label: "Termine vereinbart" },
  { art: "APPOINTMENT_HELD", label: "Termine gehalten" },
  { art: "DEAL_WON", label: "Abschlüsse" },
] as const;

export default function Berichtsgruppe({
  titel,
  gruppe,
  meeting = false,
  id,
}: {
  titel: string;
  gruppe: Gruppe;
  meeting?: boolean;
  id: string;
}) {
  const maximum = gruppe.aktivitaeten
    ? Math.max(1, ...Object.values(gruppe.aktivitaeten))
    : 1;
  return (
    <section
      aria-labelledby={`${id}-titel`}
      className="rounded-2xl border border-line bg-surface p-5 sm:p-8"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id={`${id}-titel`}
          className="text-lg font-semibold text-ink sm:text-xl"
        >
          {titel}
        </h2>
        <span className="text-sm text-ink-muted">
          {gruppe.konten} {gruppe.konten === 1 ? "Konto" : "Konten"}
        </span>
      </div>
      <p
        className={`mt-5 font-semibold tracking-tight text-ink tabular-nums ${meeting ? "text-5xl sm:text-7xl" : "text-4xl sm:text-5xl"}`}
      >
        {formatEinheiten(gruppe.einheitenZeitraum)}{" "}
        <span className="text-lg font-normal text-ink-muted">EH</span>
      </p>
      <p className="mt-1 text-sm text-ink-muted">Einheiten im Zeitraum</p>
      <Einheitenkurve punkte={gruppe.kurve} gross={meeting} />

      <div className="mt-7 border-t border-line pt-6">
        <h3 className="text-base font-semibold text-ink">
          Aktivitätstrichter im Zeitraum
        </h3>
        {gruppe.aktivitaetsKonten < gruppe.konten && (
          <p
            role="status"
            className="mt-2 rounded-xl border border-line-strong bg-sunken p-3 text-sm text-ink"
          >
            {gruppe.aktivitaetsKonten === 0
              ? "Die Aktivitätsdaten sind nicht verfügbar. Daraus lässt sich kein Arbeitsstand ableiten."
              : `Erfasst sind ${gruppe.aktivitaetsKonten} von ${gruppe.konten} Konten. Fehlende Aktivitätsprofile sind nicht als null Aktivität enthalten.`}
          </p>
        )}
        {gruppe.aktivitaeten && (
          <ol
            className={
              meeting ? "mt-5 grid gap-5 sm:grid-cols-2" : "mt-4 space-y-4"
            }
          >
            {stufen.map(({ art, label }) => {
              const wert = gruppe.aktivitaeten![art];
              return (
                <li key={art}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm text-ink">{label}</span>
                    <span
                      className={`font-semibold text-ink tabular-nums ${meeting ? "text-4xl" : "text-2xl"}`}
                    >
                      {wert}
                    </span>
                  </div>
                  <div
                    aria-hidden="true"
                    className="mt-2 h-1.5 rounded-full bg-sunken"
                  >
                    <div
                      className="h-full rounded-full bg-akzent"
                      style={{
                        width: `${(Math.max(0, wert) / maximum) * 100}%`,
                      }}
                    />
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        <p className="mt-4 text-xs leading-relaxed text-ink-muted">
          Absolute Buchungen, keine Abschlusswahrscheinlichkeiten. Ein Termin
          kann in einem anderen Zeitraum vereinbart oder gehalten worden sein.
        </p>
      </div>

      <dl className="mt-6 space-y-2 border-t border-line pt-5 text-sm">
        <div className="flex flex-wrap justify-between gap-2">
          <dt className="text-ink-muted">
            Gesamtsumme bis heute inkl. Startbestand
          </dt>
          <dd className="font-medium text-ink tabular-nums">
            {formatEinheiten(gruppe.einheitenGesamt)} EH
          </dd>
        </div>
        <div className="flex flex-wrap justify-between gap-2">
          <dt className="text-ink-muted">Davon undatierter Startbestand</dt>
          <dd className="text-ink tabular-nums">
            {formatEinheiten(gruppe.startbestand)} EH
          </dd>
        </div>
      </dl>
    </section>
  );
}
