import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Die Sprachnachricht ausliefern. Nur fuer den Admin.
//
// Ein Route-Handler und keine Server-Action: der Abspieler im Browser braucht
// eine echte Antwort mit audio/webm oder audio/mp4.
//
// requireAdmin() wird hier bewusst NICHT benutzt - es leitet weiter, und eine
// Weiterleitung im <audio>-Tag ergibt eine kaputte Anmeldeseite als Tondatei.
// Dieselbe Ausnahme wie in app/(app)/kalender/[datei]/route.ts: hier gibt es
// einen Status.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUser();
  if (!user) return new NextResponse("Nicht angemeldet.", { status: 401 });
  // Kein AVV-Riegel wie beim Kalender: hier liegen keine Kundendaten, und der
  // Admin ist die Stelle, die den Vertrag anbietet. Die Rolle reicht.
  if (user.role !== "ADMIN") {
    return new NextResponse("Nicht erlaubt.", { status: 403 });
  }

  const { id } = await params;
  const audio = await prisma.rueckmeldungAudio.findUnique({
    where: { rueckmeldungId: id },
    select: { daten: true, typ: true, bytes: true },
  });
  if (!audio) return new NextResponse("Nicht gefunden.", { status: 404 });

  return new NextResponse(new Uint8Array(audio.daten), {
    headers: {
      "Content-Type": audio.typ,
      "Content-Length": String(audio.bytes),
      // Eine Sprachnachricht eines Kollegen gehoert in keinen Zwischenspeicher
      // und schon gar nicht in den eines Proxys.
      "Cache-Control": "private, no-store",
    },
  });
}
