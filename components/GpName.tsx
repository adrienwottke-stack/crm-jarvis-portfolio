"use client";

// Der Name eines gefuehrten Beraters im Fuehrungsbereich: zeigt `kurz`
// (Initialen, vom Server via lib/vorfuehren.ts vorgerechnet), solange der
// Vorfuehr-Schalter an ist - sonst den echten Namen (Lagebild-Plan).
//
// Die Kuerzel rechnet idealerweise die Server-Seite: initialenKuerzel()
// braucht die ganze Namensliste auf einmal, um Kollisionen zu erkennen -
// eine einzelne GpName-Instanz kennt nur sich selbst.
//
// `kurz` ist trotzdem optional: Aufrufer ohne Server-Map (z. B. die
// MannschaftsMatrix, bis die Mannschafts-Seite die Map durchreicht) bekommen
// einfache Initialen ohne Kollisionsaufloesung - zwei "M. W." nebeneinander
// sind beim Vorfuehren verschmerzbar, ein echter Name waere es nicht.


/** "Marc Weber" -> "M. W." - der Fallback ohne Kollisionsaufloesung. */
function einfacheInitialen(name: string): string {
  const teile = name.trim().split(/\s+/).filter(Boolean);
  if (teile.length === 0) return "—";
  return teile.map((teil) => `${teil[0]}.`).join(" ");
}

export default function GpName({ name, kurz }: { name: string; kurz?: string }) {
  return <><span data-private-name="">{name}</span><span data-private-mask="">{kurz ?? einfacheInitialen(name)}</span></>;
}
