import { NextResponse } from "next/server";
import basisManifest from "@/app/manifest";
import { normalisiereCode } from "@/lib/einladung";

export const dynamic = "force-dynamic";

// Ein eigenes Manifest je Einladung (docs/willkommen-plan.md, Abschnitt 7.3).
//
// Installiert wird auf /einladung/ABCD-1234, gestartet wird danach auf der
// start_url aus dem Manifest. Steht dort das normale /start, ist der
// Einladungscode weg - und der Eingeladene steht ohne Konto vor dem
// Anmeldefenster. Deshalb traegt dieses Manifest den Code mit.
//
// Alles andere kommt unveraendert aus app/manifest.ts, vor allem die id: sonst
// haelt Chrome die Einladungs-Variante fuer eine zweite App.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code: codeRaw } = await params;
  const code = normalisiereCode(decodeURIComponent(codeRaw));

  const manifest = {
    ...basisManifest(),
    start_url: `/start?e=${encodeURIComponent(code)}`,
  };

  return NextResponse.json(manifest, {
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
