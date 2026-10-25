"use client";

// Der Takt: laedt die Arena in Abstaenden nach, solange der Tab sichtbar ist
// (docs/wettbewerb-plan.md, Abschnitt 2.2).
//
// Bewusst Nachladen statt Supabase Realtime: ein Anon-Key im Browser plus RLS
// waere eine neue Angriffsflaeche fuer ein Gefuehl, dem 30 Sekunden nichts
// ausmachen. Im Sprint wird der Takt kuerzer - da zaehlt jede Minute.

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ArenaTakt({ sekunden = 30 }: { sekunden?: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => {
      // Im Hintergrund nichts tun: sonst laeuft die Datenbank fuer einen Tab,
      // den niemand ansieht.
      if (document.visibilityState === "visible") router.refresh();
    }, sekunden * 1000);
    return () => clearInterval(id);
  }, [router, sekunden]);

  return null;
}
