import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { quelleAbgleichen } from "@/lib/kalender/abgleich";

export const dynamic = "force-dynamic";

// Der taegliche Abgleich der angebundenen Kalender.
//
// Vollstaendig und nicht inkrementell: ein Serientermin wird beim Einlesen in
// ein Fenster von einem Jahr entfaltet, und dieses Fenster wandert weiter.
// Ohne einen Lauf, der alles neu holt, endet ein woechentliches Teammeeting
// still nach einem Jahr. Siehe lib/kalender/abgleich.ts.
//
// Das hier ist NICHT der einzige Ausloeser, und das ist Absicht: auf dem
// Hobby-Tarif von Vercel darf ein Cron nur einmal am Tag laufen. Ein Kalender,
// der einmal taeglich nachschaut, ist keiner. Deshalb frischt die
// Kalenderseite zusaetzlich selbst nach, wenn der letzte Lauf aelter als eine
// Viertelstunde ist.

export async function GET(request: NextRequest) {
  // Derselbe Riegel wie beim Morgen-Cron nebenan: Vercel schickt den Auftrag
  // mit diesem Kopf, von aussen ist er damit nicht ausloesbar. Ohne gesetztes
  // Geheimnis laeuft er gar nicht.
  const geheim = process.env.CRON_SECRET;
  const mitgebracht =
    request.headers.get("authorization") ??
    `Bearer ${request.nextUrl.searchParams.get("token") ?? ""}`;
  if (!geheim || mitgebracht !== `Bearer ${geheim}`) {
    return new NextResponse("Nicht erlaubt.", { status: 401 });
  }

  const quellen = await prisma.kalenderquelle.findMany({
    where: { aktiv: true },
    select: { id: true },
  });

  let gelungen = 0;
  let gescheitert = 0;

  // Nacheinander und nicht parallel: mehrere gleichzeitige Anmeldungen bei
  // TimeTree sind genau das Muster, das dort eine Sperre ausloest.
  for (const quelle of quellen) {
    const ergebnis = await quelleAbgleichen(quelle.id, { vollstaendig: true });
    if (ergebnis.ok) gelungen += 1;
    else gescheitert += 1;
  }

  return NextResponse.json({ quellen: quellen.length, gelungen, gescheitert });
}
