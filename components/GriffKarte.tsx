"use client";

// Die roten Faelle des Lagebilds (Lagebild-Plan, /heute im FK-Zweig): der
// Griff, nicht die Auswertung. Nur Karte #1 pulst - der Puls des alten
// "braucht dich"-Banners zieht hierher um, siehe die Ein-Puls-Regel in
// components/Ampel.tsx.
//
// "use client": die Beschriftung von Anruf-Knopf und aria-Text muss beim
// Vorfuehren auf die Kurzform wechseln (useVorfuehren) - dafuer reicht kein
// server-gerechneter Text, das ist Client-Zustand. fuehrungsSchritt() selbst
// bleibt server-seitig: lib/fuehrung.ts importiert Prisma und darf deshalb
// nicht in dieses Bundle - der fertige Satz kommt als String-Prop herein.

import Link from "next/link";
import PersonLink from "@/components/PersonLink";
import GpName from "@/components/GpName";
import KuemmereMich from "@/components/KuemmereMich";
import { useVorfuehren } from "@/components/VorfuehrProvider";
import Ampel from "@/components/Ampel";
import { chip, flaeche } from "@/components/ui";
import { PhoneIcon } from "@/components/icons";

/**
 * Die Hinweiszeile unter dem Vorfuehr-Schalter ("Namen sind verdeckt, Zahlen
 * sind echt."). Lebt hier und nicht in einer eigenen Datei: GriffKarte ist
 * ohnehin schon "use client" und kennt useVorfuehren, und der Umfang dieses
 * Bauschritts erlaubt keine vierte neue Datei (nur LageKopf/GriffKarte/
 * DirektenListe) - VorfuehrSchalter.tsx selbst ist Bestand aus b60f15a und
 * bleibt unangetastet.
 */
export function VorfuehrHinweis() {
  const { aktiv } = useVorfuehren();
  if (!aktiv) return null;
  return <p className="text-xs text-ink-soft">Namen sind verdeckt, Zahlen sind echt.</p>;
}

export type GriffPerson = {
  id: string;
  name: string;
  kurz: string;
  vorname: string;
  ueber: string | null;
  ueberKurz: string | null;
  fuehrt: number;
  telefon: string | null;
  /** signale[0]?.titel - die Grundzeile. */
  titel: string;
  /** fuehrungsSchritt(person), server-seitig gerechnet. */
  schritt: string;
  /** signale[0]?.schluessel - Anlass fuer KuemmereMich. */
  anlass: string | undefined;
};

function GriffKartenZeile({ person, pulst }: { person: GriffPerson; pulst: boolean }) {
  const { aktiv } = useVorfuehren();
  const anrufBeschriftung = aktiv ? person.kurz : person.vorname;

  return (
    <li
      className={`${flaeche("gefahr")} relative animate-rise border-l-4 border-l-red-500 p-4 transition duration-200 hover:schatten-hoch sm:p-5`}
    >
      {/* Gestreckter Link (Bootstrap-Muster "stretched-link"): absolut
          positioniert malt er per CSS-Stapelreihenfolge automatisch UEBER dem
          statischen Text darunter - Klicks auf die Karte treffen ihn, ohne
          dass der Text selbst ein <a> waere. Die Knoepfe weiter unten
          bekommen eigens `relative z-10`, um darueber zu liegen und trotzdem
          eigenstaendig klickbar zu bleiben - kein verschachteltes <a> in
          <a>/<button>, alles Geschwister im DOM. */}
      <PersonLink
        href={`/mannschaft/${person.id}`}
        className="absolute inset-0 rounded-2xl"
        aria-label={`${aktiv ? person.kurz : person.name} — zur Mannschaft`}
      />
      <div className="flex items-start gap-3">
        <Ampel ampel="rot" variante="punkt" ruhig={!pulst} className="mt-1.5" />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5 text-sm">
            <span className="font-semibold text-ink">
              <GpName name={person.name} kurz={person.kurz} />
            </span>
            <span className="text-ink-muted">braucht dich</span>
          </p>
          {(person.ueber || person.fuehrt > 0) && (
            <p className="mt-1 flex flex-wrap gap-1.5">
              {person.ueber && (
                <span className={chip("neutral")}>
                  über <GpName name={person.ueber} kurz={person.ueberKurz ?? person.ueber} />
                </span>
              )}
              {person.fuehrt > 0 && <span className={chip("neutral")}>führt {person.fuehrt}</span>}
            </p>
          )}
          <p className="mt-2 text-sm text-ink">{person.titel}</p>
          <p className="mt-0.5 text-sm text-ink-muted">{person.schritt}</p>

          <div className="relative z-10 mt-3 flex flex-wrap gap-2">
            {person.telefon && (
              <a
                href={`tel:${person.telefon}`}
                aria-label={`${anrufBeschriftung} anrufen`}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-fest-gefahr px-3.5 text-sm font-semibold text-white transition hover:bg-fest-gefahr-stark"
              >
                <PhoneIcon className="h-4 w-4" />
                {anrufBeschriftung} anrufen
              </a>
            )}
            <KuemmereMich memberId={person.id} name={person.name} anlass={person.anlass} />
          </div>
        </div>
      </div>
    </li>
  );
}

export default function GriffKarte({
  personen,
  gesamt,
}: {
  /** Bis zu drei - der Rest steht in der "+N weitere"-Zeile. */
  personen: GriffPerson[];
  /** Alle roten dringenden zusammen, auch die nicht gezeigten. */
  gesamt: number;
}) {
  if (personen.length === 0) return null;
  const weitere = gesamt - personen.length;

  return (
    <div className="space-y-3">
      <ul className="space-y-3">
        {personen.map((person, index) => (
          <GriffKartenZeile
            key={person.id}
            person={person}
            // Nur die erste Karte pulst - die Ein-Puls-Regel der Seite.
            pulst={index === 0}
          />
        ))}
      </ul>
      {weitere > 0 && (
        <Link
          href="/mannschaft"
          className="flex min-h-11 items-center text-sm font-medium text-navy-600 transition hover:text-navy-800 hover:underline"
        >
          +{weitere} weitere {weitere === 1 ? "braucht" : "brauchen"} dich — zur Mannschaft
        </Link>
      )}
    </div>
  );
}
