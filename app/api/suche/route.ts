import { NextRequest, NextResponse } from "next/server";
import { requireOnboardedUser } from "@/lib/auth";
import { suche } from "@/lib/suche/service";
import { gueltigeLetzte, suchtyp } from "@/lib/suche/modell";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };

export async function GET(request: NextRequest) {
  const user = await requireOnboardedUser();
  if (user.deactivatedAt) return NextResponse.json({ fehler: "Dieses Konto ist nicht aktiv." }, { status: 403, headers });
  const parameter = request.nextUrl.searchParams;
  const q = parameter.get("q") ?? "";
  const seite = Number(parameter.get("seite") ?? 0);
  if (q.length > 100 || !Number.isInteger(seite) || seite < 0 || seite > 499) {
    return NextResponse.json({ fehler: "Prüfe deine Suche." }, { status: 400, headers });
  }
  let zuletzt: string[] = [];
  try { zuletzt = gueltigeLetzte(JSON.parse((parameter.get("zuletzt") ?? "[]").slice(0, 2048))); } catch { /* Ungültiger Verlauf wird verworfen. */ }
  try {
    const antwort = await suche(user, { q, typ: suchtyp(parameter.get("typ")), seite, zuletzt });
    return NextResponse.json(antwort, { headers });
  } catch {
    // Keine Suchbegriffe, Personendaten oder Datenbankfehler in öffentliche Logs schreiben.
    return NextResponse.json({ fehler: "Die Inhalte konnten nicht geladen werden. Versuche es erneut." }, { status: 503, headers });
  }
}
