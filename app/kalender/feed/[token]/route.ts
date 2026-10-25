import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { icsFeed } from "@/lib/ics";
import { feedEintraege } from "@/lib/kalender/feed";
import { avvAkzeptiert } from "@/lib/avv";

export const dynamic = "force-dynamic";

// Der abonnierbare Kalender.
//
// Bewusst AUSSERHALB der (app)-Gruppe und in middleware.ts von der
// Anmeldepflicht ausgenommen: ein Abo-Kalender im Handy schickt kein Cookie
// mit, er holt die Adresse stumpf ab. Geschuetzt ist er ueber den Schluessel
// im Pfad - der laesst sich zurueckziehen, eine Sitzung waere hier gar nicht
// erst da.
//
// Der Unterschied zu /kalender/alle.ics daneben ist deshalb kein Detail,
// sondern der ganze Zweck: kein Content-Disposition (sonst laedt der Kalender
// eine Datei herunter, statt sie zu abonnieren), kein no-store (sonst fragt
// jedes Handy im Minutentakt) und keine Sitzung.

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  // Ein zu kurzer Schluessel wird gar nicht erst gesucht - das spart die
  // Datenbankabfrage bei jedem Kratzer, der die Adresse errät.
  if (!token || token.length < 20) {
    return new NextResponse("Nicht gefunden.", { status: 404 });
  }

  const konto = await prisma.user.findUnique({
    where: { feedToken: token },
    select: { id: true, name: true, feedNamen: true, deactivatedAt: true },
  });
  if (!konto || konto.deactivatedAt) {
    return new NextResponse("Nicht gefunden.", { status: 404 });
  }

  // Derselbe Riegel wie am Download nebenan: ohne
  // Auftragsverarbeitungsvertrag verlaesst kein Kundendatum das Werkzeug.
  if (!(await avvAkzeptiert(konto.id))) {
    return new NextResponse("Nicht gefunden.", { status: 404 });
  }

  const inhalt = icsFeed(await feedEintraege(konto.id), {
    name: "Cockpit",
    namenZeigen: konto.feedNamen,
  });

  return new NextResponse(inhalt, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      // Eine Viertelstunde. Google und iOS holen ohnehin seltener nach; das
      // hier verhindert nur, dass ein hektischer Client jede Minute anklopft.
      "Cache-Control": "public, max-age=900",
    },
  });
}
