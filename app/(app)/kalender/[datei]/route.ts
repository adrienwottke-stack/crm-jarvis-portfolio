import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/auth";
import { eigene } from "@/lib/scope";
import { berlinToday, dayToUtcDate } from "@/lib/dates";
import { icsDatei } from "@/lib/ics";
import { avvAkzeptiert } from "@/lib/avv";

export const dynamic = "force-dynamic";

// Termine als Kalenderdatei. Zwei Formen:
//   /kalender/alle.ics       – alles, was noch kommt
//   /kalender/<kontaktId>.ics – ein einzelner Termin
//
// Ein Route-Handler und keine Server-Action: der Browser soll die Datei an das
// Kalenderprogramm uebergeben, und das geht nur ueber eine echte Antwort mit
// text/calendar. Die Anmeldung prueft die Middleware; `currentUser` ist die
// zweite Schranke, damit hier niemand fremde Namen herauszieht.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ datei: string }> }
) {
  const user = await currentUser();
  if (!user) return new NextResponse("Nicht angemeldet.", { status: 401 });
  // Ohne Auftragsverarbeitungsvertrag wird hier nichts herausgegeben. Diese
  // Route umgeht requireUser (sie muss einen Status liefern, keine
  // Weiterleitung) und braucht den Riegel deshalb ausdruecklich.
  if (!(await avvAkzeptiert(user.id))) {
    return new NextResponse(
      "Auftragsverarbeitungsvertrag noch nicht bestaetigt.",
      { status: 403 }
    );
  }

  const { datei } = await params;
  if (!datei.endsWith(".ics")) {
    return new NextResponse("Nicht gefunden.", { status: 404 });
  }
  const kennung = datei.slice(0, -4);

  const kontakte = await prisma.contact.findMany({
    where: {
      ...eigene(user.id).kontakte,
      outcome: { not: "VERLOREN" },
      appointmentAt:
        kennung === "alle" ? { gte: dayToUtcDate(berlinToday()) } : { not: null },
      ...(kennung === "alle" ? {} : { id: kennung }),
    },
    orderBy: { appointmentAt: "asc" },
    select: {
      id: true,
      name: true,
      phone: true,
      note: true,
      appointmentAt: true,
    },
  });

  if (kontakte.length === 0) {
    return new NextResponse("Kein Termin gefunden.", { status: 404 });
  }

  const inhalt = icsDatei(
    kontakte.map((kontakt) => ({
      id: kontakt.id,
      name: kontakt.name,
      at: kontakt.appointmentAt!,
      telefon: kontakt.phone,
      notiz: kontakt.note,
    }))
  );

  return new NextResponse(inhalt, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${kennung === "alle" ? "termine" : "termin"}.ics"`,
      "Cache-Control": "no-store",
    },
  });
}
