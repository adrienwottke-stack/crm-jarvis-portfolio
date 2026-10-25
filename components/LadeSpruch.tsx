"use client";

import { useEffect, useState } from "react";

// Die Spruchzeile unterm Ladeplatzhalter - geklaut ist die Idee vom
// GTA-Ladebildschirm: Wer warten muss, kriegt wenigstens was zu schmunzeln.
//
// Der erste Spruch wird erst nach dem Mount gewuerfelt. Zwei Gruende:
// Math.random() beim Server-Rendern wuerde nicht zum Client passen
// (Hydration-Fehler), und bei Ladezeiten unter einer halben Sekunde blitzt
// so gar kein Text auf - die leere Zeile haelt nur den Platz.
//
// Wer reduzierte Bewegung eingestellt hat, bekommt genau einen Spruch,
// der stehen bleibt. Rotieren ist Zugabe, kein Inhalt.

const SPRUECHE = [
  "Poliere die Kacheln …",
  "Sortiere den Stapel … der Stapel wehrt sich.",
  "Fütter den Trichter …",
  "Wecke die Mannschaft …",
  "Zähle schon mal Striche vor …",
  "Bügle die Visitenkarten …",
  "Spanne das Zeitraster …",
  "Verlege die Telefonleitung …",
  "Kehre die Bühne …",
  "Lade Nervenstärke nach …",
  "Tipp: Der Hörer wird nicht leichter, wenn man ihn nur anschaut.",
  "Tipp: Kaffee zählt nicht als Aktivität. Wir haben nachgemessen.",
  "Tipp: Wer morgens wählt, hat abends Termine.",
  "Tipp: Empfehlungen sind wie Kekse – niemand nimmt nur eine.",
  "Tipp: Niemand hat je einen Namen zu viel aufgeschrieben.",
  "Tipp: Die beste Zeit zum Telefonieren war vor einer Stunde. Die zweitbeste: jetzt.",
  "Tipp: Drei Namen am Tag sind tausend im Jahr. Mathe spielt für dich.",
  "Tipp: Der Kalender lügt nie. Er ist nur manchmal schonungslos ehrlich.",
  "Tipp: Ein Nein am Telefon ist schneller vorbei als ein schlechtes Gewissen.",
  "Tipp: Storno ist kein Schicksal. Storno ist ein Gegner.",
  "Tipp: Du musst nicht jeden Termin gewinnen. Nur genug.",
  "Tipp: Das CRM vergisst nichts. Das ist sein einziger Job.",
  "Tipp: Ein Rückruf um 18:03 schlägt einen Vorsatz um 9:00.",
  "Tipp: Wähl die Nummer, nicht die Ausrede.",
];

const TAKT_MS = 3500;

export default function LadeSpruch() {
  const [index, setIndex] = useState<number | null>(null);

  useEffect(() => {
    setIndex(Math.floor(Math.random() * SPRUECHE.length));

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const takt = setInterval(() => {
      setIndex((i) => (i === null ? 0 : (i + 1) % SPRUECHE.length));
    }, TAKT_MS);
    return () => clearInterval(takt);
  }, []);

  return (
    // min-h reserviert zwei Zeilen, damit beim Wechsel zwischen kurzen und
    // langen Spruechen nichts unter der Zeile springt.
    <p className="min-h-10 px-4 text-center text-sm text-ink-soft">
      {index !== null && (
        // key laesst den Fade bei jedem Wechsel neu anlaufen.
        <span key={index} className="animate-spruch inline-block">
          {SPRUECHE[index]}
        </span>
      )}
    </p>
  );
}
