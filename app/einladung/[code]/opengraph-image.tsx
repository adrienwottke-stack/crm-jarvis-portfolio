import { ImageResponse } from "next/og";
import { prisma } from "@/lib/prisma";
import { normalisiereCode } from "@/lib/einladung";

// Das Vorschaubild, das WhatsApp unter den Einladungslink haengt. Der wahre
// erste Eindruck passiert VOR dem ersten Klick - eine nackte URL wirbt fuer
// nichts. iOS-Blau, das Zeichen der Wortmarke, der Name des Einladenden: mehr
// braucht es nicht.

export const alt = "Einladung ins Team";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OgBild({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code: codeRaw } = await params;
  const code = normalisiereCode(decodeURIComponent(codeRaw));

  const invite = await prisma.invite.findUnique({
    where: { code },
    select: { leader: { select: { name: true } } },
  });
  const name = invite?.leader.name ?? "Dein Team";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "linear-gradient(160deg, #0a1f3e 0%, #0a2e5c 60%, #0053b0 100%)",
          color: "#ffffff",
          fontFamily: "sans-serif",
        }}
      >
        {/* Signet: der Namenslisten-Glyph der Wortmarke (components/Logo.tsx,
            LogoMark) - drei Zeilen, Punkt und Balken, die oberste voll
            deckend. Kein Kurs-Chart mehr. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "20px",
            marginBottom: "48px",
          }}
        >
          <svg width="72" height="72" viewBox="0 0 32 32" fill="none">
            <rect width="32" height="32" rx="8" fill="#0a84ff" />
            <circle cx="9.6" cy="9.8" r="1.8" fill="#ffffff" />
            <rect x="13.4" y="8.6" width="10.8" height="2.4" rx="1.2" fill="#ffffff" />
            <circle cx="9.6" cy="16" r="1.8" fill="#ffffff" opacity="0.38" />
            <rect x="13.4" y="14.8" width="10.8" height="2.4" rx="1.2" fill="#ffffff" opacity="0.38" />
            <circle cx="9.6" cy="22.2" r="1.8" fill="#ffffff" opacity="0.38" />
            <rect x="13.4" y="21" width="10.8" height="2.4" rx="1.2" fill="#ffffff" opacity="0.38" />
          </svg>
          <span style={{ fontSize: "36px", fontWeight: 600, color: "#93b4d9" }}>
            Cockpit
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <span style={{ fontSize: "72px", fontWeight: 700, lineHeight: 1.1 }}>
            {name} lädt dich ins Team ein.
          </span>
          <span style={{ fontSize: "34px", color: "#bed3ea" }}>
            Dein Zugang dauert 3 Minuten — danach steht deine erste Liste.
          </span>
        </div>

        <div
          style={{
            display: "flex",
            marginTop: "56px",
            width: "220px",
            height: "10px",
            borderRadius: "5px",
            background: "#0a84ff",
          }}
        />
      </div>
    ),
    size
  );
}
