"use client";

// Der Vorfuehr-Schalter: Namen werden verdeckt, Zahlen bleiben echt
// (Lagebild-Plan). Auf /heute in der Lagebild-Abschnittszeile, auf
// /mannschaft im beschrifteten Teammenü - derselbe Knopf, derselbe Kontext
// (VorfuehrProvider), zwei Einbauorte.
//
// Kein Icon: components/icons.tsx hat kein Augen-/Sicht-Symbol, und ein neues
// Icon-Set fuer einen einzelnen Knopf anzulegen waere die falsche Reihenfolge
// (Hausregel: kein neues Icon-Set). Der Text traegt die Bedeutung allein.

import { filterPill } from "@/components/ui";
import { useVorfuehren } from "@/components/VorfuehrProvider";

export default function VorfuehrSchalter() {
  const { aktiv, umschalten } = useVorfuehren();

  return (
    <button
      type="button"
      onClick={umschalten}
      aria-pressed={aktiv}
      aria-label="Namen verdecken fürs Vorführen — Zahlen bleiben echt"
      className={filterPill(aktiv)}
    >
      {aktiv ? "Namen verdeckt" : "Vorführen"}
    </button>
  );
}
