import { cn, type Ton } from "@/components/ui";

// Eine Zahl mit ihrer Bezeichnung.
//
// Stand vorher zweimal wortgleich in mannschaft/page.tsx und
// mannschaft/[id]/page.tsx. Jetzt an einer Stelle - und die Zahl darf
// endlich Gewicht haben: sie ist auf diesen Seiten das Ergebnis der Arbeit,
// nicht eine Fussnote.

const tonFarben: Record<Ton, string> = {
  neutral: "text-ink",
  info: "text-navy-700",
  erfolg: "text-emerald-700",
  warnung: "text-amber-700",
  gefahr: "text-red-700",
};

export default function Kennzahl({
  wert,
  bezeichnung,
  betont = false,
  ton,
  hinweis,
}: {
  wert: number | string;
  bezeichnung: string;
  /** Kurzform fuer ton="info" - erhaelt die bisherige Aufrufform. */
  betont?: boolean;
  ton?: Ton;
  /** Zusatzzeile darunter, z. B. "von 20". */
  hinweis?: string;
}) {
  const farbe = tonFarben[ton ?? (betont ? "info" : "neutral")];
  return (
    <div className="min-w-18">
      <p className={cn("text-lg font-semibold tabular-nums tracking-tight", farbe)}>
        {wert}
      </p>
      <p className="text-xs text-ink-soft">{bezeichnung}</p>
      {hinweis && <p className="text-[11px] text-ink-soft">{hinweis}</p>}
    </div>
  );
}

/**
 * Dieselbe Zahl, aber als eigene kleine Flaeche.
 *
 * Fuer Stellen, an denen mehrere Werte nebeneinander stehen und vorher nur
 * durch Mittelpunkte getrennt waren ("3 Termine · 2 weitere · 4 ueberfaellig").
 * Als Kacheln liest man sie auf einen Blick statt sie zu entziffern.
 */
export function KennzahlKachel({
  wert,
  bezeichnung,
  ton = "neutral",
}: {
  wert: number | string;
  bezeichnung: string;
  ton?: Ton;
}) {
  return (
    <div className="rounded-lg bg-sunken px-3 py-2">
      <p
        className={cn(
          "text-xl font-semibold tabular-nums tracking-tight",
          tonFarben[ton]
        )}
      >
        {wert}
      </p>
      <p className="mt-0.5 text-[11px] font-medium text-ink-soft">{bezeichnung}</p>
    </div>
  );
}
