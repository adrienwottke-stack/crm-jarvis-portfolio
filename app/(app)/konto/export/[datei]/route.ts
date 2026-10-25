import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/auth";
import { avvAkzeptiert } from "@/lib/avv";
import {
  aktivitaetenCsv,
  allesJson,
  einheitenCsv,
  kontakteCsv,
} from "@/lib/export";

export const dynamic = "force-dynamic";

// Der Datenausgang unter /konto/export - der zweite nach dem Kalender-Feed.
// Ein Route-Handler und keine Server-Action, aus demselben Grund wie dort
// (app/(app)/kalender/[datei]/route.ts): der Browser soll eine echte Datei
// zum Herunterladen bekommen, kein serialisiertes Ergebnis einer
// Server-Action.
//
// Vier feste Namen statt eines Formats aus der Adresse - alles andere ist
// nicht gebaut worden und liefert bewusst 404, nicht 400: eine falsch
// getippte Adresse soll aussehen wie eine Seite, die es nicht gibt, nicht wie
// ein kaputter Aufruf.
const DATEIEN = {
  "kontakte.csv": {
    erzeugen: kontakteCsv,
    contentType: "text/csv; charset=utf-8",
  },
  "aktivitaeten.csv": {
    erzeugen: aktivitaetenCsv,
    contentType: "text/csv; charset=utf-8",
  },
  "einheiten.csv": {
    erzeugen: einheitenCsv,
    contentType: "text/csv; charset=utf-8",
  },
  "alles.json": {
    // allesJson liefert ein Objekt, keinen String - hier und nicht in
    // lib/export.ts wird daraus Text, denn nur die Route weiss, dass die
    // Antwort eine Datei werden soll.
    erzeugen: async (userId: string) =>
      JSON.stringify(await allesJson(userId), null, 2),
    contentType: "application/json; charset=utf-8",
  },
} as const satisfies Record<
  string,
  { erzeugen: (userId: string) => Promise<string>; contentType: string }
>;

type Dateiname = keyof typeof DATEIEN;

function istDateiname(wert: string): wert is Dateiname {
  return wert in DATEIEN;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ datei: string }> }
) {
  const user = await currentUser();
  if (!user) return new NextResponse("Nicht angemeldet.", { status: 401 });
  // Ohne Auftragsverarbeitungsvertrag wird hier nichts herausgegeben. Diese
  // Route umgeht requireUser (sie muss einen Status liefern, keine
  // Weiterleitung) und braucht den Riegel deshalb ausdruecklich - derselbe
  // Grund wie beim Kalender-Feed.
  if (!(await avvAkzeptiert(user.id))) {
    return new NextResponse(
      "Auftragsverarbeitungsvertrag noch nicht bestaetigt.",
      { status: 403 }
    );
  }

  const { datei } = await params;
  if (!istDateiname(datei)) {
    return new NextResponse("Nicht gefunden.", { status: 404 });
  }

  const { erzeugen, contentType } = DATEIEN[datei];
  const inhalt = await erzeugen(user.id);

  return new NextResponse(inhalt, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${datei}"`,
      // Personendaten aus einer Antwort, die im Cache eines geteilten
      // Rechners landet, waeren das Gegenteil von Datenschutz durch
      // Voreinstellung - derselbe Riegel wie beim Kalender-Feed.
      "Cache-Control": "no-store",
    },
  });
}
