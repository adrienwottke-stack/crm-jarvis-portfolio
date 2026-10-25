import { cache } from "react";
import { prisma } from "@/lib/prisma";

// --- Die Fassung --------------------------------------------------------------
// DIE Stellschraube. Genau eine Konstante entscheidet, ob das Gate steht und
// gegen welche Fassung es prueft.
//
// LEER = GATE AUS. Das ist der Zustand zum Ausrollen: Tabelle, Trigger und
// Riegel sind live, aber niemand wird ausgesperrt. Solange hier nichts steht,
// gibt es auch nichts zu unterschreiben - und ein Gate mit Platzhaltertext
// waere schlimmer als keines.
//
// EINSCHALTEN heisst: hier "1.0" eintragen. Ab dem naechsten Aufruf hat kein
// Konto einen Eintrag fuer diese Fassung, und das Gate greift fuer alle.
// Genauso spaeter das Erhoehen auf "2.0" - es braucht keinen zweiten
// Handgriff, keine Migration, keinen Reset-Lauf ueber die Tabelle.
//
// VORHER muss dreierlei zusammenpassen und wandert kuenftig gemeinsam:
//   1. AVV_VERSION hier,
//   2. der Volltext in lib/avv/text.ts,
//   3. die PDF-Fassung unter public/avv/avv-<fassung>.pdf.
// Text und PDF muessen Wort fuer Wort uebereinstimmen: gelesen wird das eine,
// zugeschickt das andere.
//
// Die Typangabe ": string" steht da mit Absicht. Ohne sie waere der Typ das
// Literal "" - und jeder Vergleich mit einer echten Fassung ein Typfehler.
export const AVV_VERSION: string = "";

// Stand der Fassung, nur zur Anzeige auf der Seite und in der Mail.
export const AVV_STAND = "";

// Die PDF-Fassung, die nach der Zustimmung per Mail rausgeht. Der Pfad traegt
// die Fassung im Namen: eine alte Fassung wird nie ueberschrieben, sondern
// bekommt eine neue Datei daneben.
export const avvPdfPfad = (version = AVV_VERSION) =>
  `public/avv/avv-${version}.pdf`;

// --- Die Abfrage ---------------------------------------------------------------
// Genau EIN Indextreffer je Aufruf, und dank cache() genau ein Aufruf je
// Anfrage - auch wenn requireUser waehrend eines Renderings mehrfach laeuft.
export const avvAkzeptiert = cache(async (userId: string): Promise<boolean> => {
  // Gate aus: niemand wird aufgehalten, und es wird keine Abfrage gestellt.
  if (!AVV_VERSION) return true;

  const eintrag = await prisma.avvAcceptance.findUnique({
    // Immer auf das eigene Konto gefiltert. Dass ein Nutzer nur seinen eigenen
    // Eintrag sieht, entscheidet sich hier - die RLS-Policy in der Migration
    // ist die zweite Reihe, nicht die erste (dort steht warum).
    where: { userId_avvVersion: { userId, avvVersion: AVV_VERSION } },
    select: { id: true },
  });
  return eintrag !== null;
});
