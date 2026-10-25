"use client";

import { useEffect } from "react";
import { istHandy, laeuftAlsApp } from "@/lib/geraet";
import { installationMelden } from "@/app/(app)/actions";

// Meldet einmalig, dass dieses Konto die App vom Startbildschirm startet.
// Ob das so ist, weiss nur der Browser - deshalb diese Zeile Client-Code
// statt einer Serverpruefung (docs/willkommen-plan.md, Abschnitt 7.7).
//
// "istHandy" gehoert seit dem Rechner-Fenster dazu. "installedAt" beantwortet
// in der Mannschafts-Uebersicht genau eine Frage: liegt die App dort, wo
// telefoniert wird? Ohne diese Pruefung wuerde ein Fenster auf dem Mac als
// erledigt durchgehen - die Spalte saehe voller aus und meinte etwas anderes.
export default function InstallationMelder({ melden }: { melden: boolean }) {
  useEffect(() => {
    if (!melden || !istHandy() || !laeuftAlsApp()) return;
    void installationMelden();
  }, [melden]);

  return null;
}
