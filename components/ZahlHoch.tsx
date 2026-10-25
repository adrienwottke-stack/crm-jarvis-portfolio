"use client";

import { useEffect, useRef, useState } from "react";

// Die eine grosse Zahl auf der Startseite zaehlt beim Oeffnen kurz hoch.
//
// Bewusst nur hier. Wenn jede Zahl der App zappelt, ist es Dekoration und
// stoert beim Arbeiten - bei der Tagesleistung ist es die Belohnung fuer
// den Blick auf die Seite.
//
// Wer reduzierte Bewegung eingestellt hat, sieht sofort den Endwert. Ohne
// JavaScript steht die Zahl ebenfalls da (Startwert = Zielwert im Server-
// Durchlauf), die Seite bleibt also vollstaendig lesbar.

export default function ZahlHoch({
  wert,
  dauer = 650,
  className,
}: {
  wert: number;
  dauer?: number;
  className?: string;
}) {
  const [zahl, setZahl] = useState(wert);
  const gelaufen = useRef(false);

  useEffect(() => {
    if (gelaufen.current) return;
    gelaufen.current = true;

    if (
      wert <= 0 ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    setZahl(0);
    const start = performance.now();
    let bild = 0;

    const schritt = (jetzt: number) => {
      const anteil = Math.min((jetzt - start) / dauer, 1);
      // Weich auslaufen: schnell los, sanft ankommen.
      const weich = 1 - Math.pow(1 - anteil, 3);
      setZahl(Math.round(weich * wert));
      if (anteil < 1) bild = requestAnimationFrame(schritt);
    };

    bild = requestAnimationFrame(schritt);
    return () => cancelAnimationFrame(bild);
  }, [wert, dauer]);

  return <span className={className}>{zahl}</span>;
}
