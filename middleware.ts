import { NextResponse, type NextRequest } from "next/server";
import { authCookieName, sessionUserId } from "./lib/session";
import { releaseReturnTarget } from "./lib/releases/return-target";

// Die zuletzt gewaehlte Kalenderansicht. Sie wird HIER gesetzt und nicht auf
// der Seite: eine Server-Komponente darf beim Rendern kein Cookie schreiben,
// und der Umschalter soll bewusst aus reinen Links bestehen, damit er ohne
// Javascript funktioniert. Die Middleware sieht denselben Aufruf und kann die
// Antwort anfassen - das ist die einzige Stelle, an der beides zusammenkommt.
const ANSICHT_COOKIE = "kalender_ansicht";
const ANSICHTEN = new Set(["monat", "woche", "tag", "liste"]);

export async function middleware(request: NextRequest) {
  const session = await sessionUserId(
    request.cookies.get(authCookieName)?.value
  );
  if (!session) {
    const destination = new URL("/login", request.url);
    const releaseTarget = releaseReturnTarget(`${request.nextUrl.pathname}${request.nextUrl.search}`);
    if (releaseTarget) destination.searchParams.set("next", releaseTarget);
    return NextResponse.redirect(destination);
  }

  const antwort = NextResponse.next();

  if (request.nextUrl.pathname === "/kalender") {
    const gewaehlt = request.nextUrl.searchParams.get("ansicht");
    if (gewaehlt && ANSICHTEN.has(gewaehlt)) {
      antwort.cookies.set(ANSICHT_COOKIE, gewaehlt, {
        path: "/",
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 365,
      });
    }
  }

  return antwort;
}

export const config = {
  // Login, die Einladungsseite (wer eingeladen wird, hat noch kein Konto),
  // Next-Assets und statische Dateien bleiben erreichbar. Alles andere
  // verlangt ein persoenliches Konto.
  //
  // Dazu alles, was zur Installation gehoert: /start entscheidet selbst, wohin
  // es geht, /offline liefert der Service Worker aus, und Manifest, sw.js und
  // die Symbole muss der Browser abrufen koennen, BEVOR jemand ein Konto hat -
  // sonst gibt es auf der Einladungsseite gar nichts zu installieren.
  //
  // /neues-passwort ist der Weg zurueck ins eigene Konto - wer sein Passwort
  // vergessen hat, kann sich per Definition nicht anmelden. Geschuetzt ist die
  // Seite ueber den Code im Link, nicht ueber eine Sitzung.
  //
  // /api/cron laeuft ohne Sitzung: der Auftrag kommt von Vercel, nicht aus
  // einem Browser. Geschuetzt ist er ueber CRON_SECRET, nicht ueber ein Cookie.
  //
  // /kalender/feed ist der Abo-Feed. Er MUSS ohne Sitzung erreichbar sein: ein
  // abonnierter Kalender im Handy schickt kein Cookie mit, sondern holt die
  // Adresse stumpf ab. Geschuetzt ist er ueber den Schluessel im Pfad, der sich
  // jederzeit zurueckziehen laesst.
  //
  // /bericht ist der Berichts-Link (docs/adr/0002-berichts-link.md) - aus
  // demselben Grund oeffentlich: wer ihn teilt, teilt ihn an Leute ohne eigenes
  // Konto. Geschuetzt ist er ueber den Token im Pfad, nicht ueber eine Sitzung.
  // Der Verwaltungspfad /mannschaft/bericht faengt mit "mannschaft" an, nicht
  // mit "bericht", und bleibt damit hinter dem Login - dieser Eintrag hier
  // wirkt nur auf Pfade, die WOERTLICH mit "bericht" beginnen.
  //
  // /anfrage ist die oeffentliche Anfrage-Seite (Multiplikations-Plan): wer
  // dort landet, hat per Definition kein Konto. Geschuetzt ist der Schreibpfad
  // ueber Honeypot und Tageskappe in app/anfrage/actions.ts; das
  // Admin-Postfach dazu liegt unter /werkstatt/anfragen und damit hinterm
  // Login.
  matcher: [
    "/((?!login|einladung|neues-passwort|start|offline|api/cron|api/webhooks|kalender/feed|bericht|anfrage|emil/|manifest\\.webmanifest|sw\\.js|icon-|apple-touch-icon\\.png|_next/static|_next/image|favicon\\.ico|.*\\.svg$).*)",
  ],
};
