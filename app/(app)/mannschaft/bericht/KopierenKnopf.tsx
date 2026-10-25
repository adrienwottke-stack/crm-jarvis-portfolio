"use client";

// Der Kopieren-Knopf fuer den Berichts-Link.
//
// Eine eigene kleine Client-Komponente statt einer geteilten aus components/:
// dasselbe Muster steht schon lokal in components/PersonAufnehmen.tsx
// (LinkZeile) und in app/(app)/einladen/page.tsx - Hausstil ist hier, den
// Fuenfzeiler je Stelle zu wiederholen statt ihn zu zentralisieren.

import { useState } from "react";
import { btnSecondary } from "@/components/ui";

export default function KopierenKnopf({ text }: { text: string }) {
  const [kopiert, setKopiert] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(
          () => setKopiert(true),
          () => setKopiert(false)
        );
      }}
      className={btnSecondary}
    >
      {kopiert ? "Kopiert" : "Link kopieren"}
    </button>
  );
}
