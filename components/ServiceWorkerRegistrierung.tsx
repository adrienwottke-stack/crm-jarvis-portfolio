"use client";

import { useEffect } from "react";

// Ohne registrierten Service Worker bietet Chrome das Installieren gar nicht
// erst an - der Knopf in der Schleuse haette dann nichts, was er ausloesen
// koennte (docs/willkommen-plan.md, Abschnitt 7.4).
export default function ServiceWorkerRegistrierung() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // Im Entwicklungsbetrieb traegt die Adresse ein "?dev=1". Der Service
    // Worker legt dann nichts in den Cache, sonst bekaeme man nach jeder
    // Aenderung die alten Next-Bundles ausgeliefert.
    const datei =
      process.env.NODE_ENV === "production" ? "/sw.js" : "/sw.js?dev=1";

    const registrieren = () => {
      navigator.serviceWorker.register(datei).catch(() => undefined);
    };

    // Erst nach dem Laden: der erste Seitenaufbau soll nicht mit dem Download
    // der Datei konkurrieren.
    if (document.readyState === "complete") {
      registrieren();
      return;
    }
    window.addEventListener("load", registrieren);
    return () => window.removeEventListener("load", registrieren);
  }, []);

  return null;
}
