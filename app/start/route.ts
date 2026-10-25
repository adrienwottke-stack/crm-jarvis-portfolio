import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { authCookieName, sessionCookieOptions } from "@/lib/session";
import { normalisiereCode, statusVon } from "@/lib/einladung";
import { entryRoute } from "@/lib/start/entry";

export const dynamic = "force-dynamic";

// Die Weiche nach dem App-Start (docs/willkommen-plan.md, Abschnitt 7.3).
//
// Die installierte App startet nicht auf einer Seite, sondern hier. Der Grund:
// Installiert wird auf der Einladungsseite, gestartet wird spaeter mit einer
// Anmeldung - und auf dem iPhone hat die App einen eigenen Speicher, in dem
// die Sitzung aus Safari nicht gilt. Ohne diese Weiche landet ein frisch
// Eingeladener nach der Installation vor dem Anmeldefenster, ohne je ein Konto
// angelegt zu haben.
//
// "e" traegt den Einladungscode durch die Installation. Er steht in der
// start_url des Manifests, das die Einladungsseite ausliefert.
export async function GET(request: NextRequest) {
  const ziel = (pfad: string) => NextResponse.redirect(new URL(pfad, request.url));

  const user = await currentUser();

  const code = normalisiereCode(request.nextUrl.searchParams.get("e") ?? "");
  const invite = code
    ? await prisma.invite.findUnique({
        where: { code },
        select: { id: true, usedCount: true, maxUses: true, expiresAt: true },
      })
    : null;

  // Eine OFFENE Einladung schlaegt eine fremde Sitzung.
  //
  // Der Fall aus der Praxis: auf dem Handy war schon einmal jemand anders
  // angemeldet - die Fuehrungskraft, die kurz etwas gezeigt hat. Stand die
  // Sitzung hier vorn, kam der Eingeladene mit seinem frischen Code nie bei
  // sich an, sondern jedes Mal in fremden Daten. Deshalb faellt hier die
  // Sitzung, nicht die Einladung: wer einen gueltigen Code mitbringt, will ein
  // eigenes Konto, nicht das des Vorbesitzers.
  //
  // Die eigene Einladung ist ausgenommen (herkunftId): sonst wuerfe ein
  // Mehrfach-Code - der bleibt offen - seinen eigenen Angekommenen bei jedem
  // App-Start wieder hinaus.
  if (invite && statusVon(invite) === "offen" && user?.herkunftId !== invite.id) {
    const antwort = ziel(`/einladung/${encodeURIComponent(code)}`);
    // Nicht delete(): das Cookie traegt Pfad und secure-Flag aus
    // sessionCookieOptions, und nur mit denselben Angaben raeumt der Browser
    // es zuverlaessig weg.
    antwort.cookies.set(authCookieName, "", { ...sessionCookieOptions, maxAge: 0 });
    return antwort;
  }

  // Wer angemeldet ist, landet auf der Arbeitsliste: dort steht, was heute
  // dran ist.
  if (user) return ziel(await entryRoute(user.id));

  // Auch eine verbrauchte oder abgelaufene Einladung geht zurueck auf die
  // Einladungsseite: die erklaert in einem Satz, was los ist, und verlinkt
  // die Anmeldung. Besser als ein Anmeldefenster ohne Zusammenhang.
  if (invite) return ziel(`/einladung/${encodeURIComponent(code)}`);

  return ziel("/login");
}
