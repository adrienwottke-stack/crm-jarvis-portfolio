"use server";

// Der Schreibpfad der Rueckmeldung (docs/rueckmeldung-plan.md).
//
// Eigene Datei auf oberster Ebene, weil die Kopfzeile in JEDEM angemeldeten
// Bereich steht - Beraterbereich und Wettbewerb gleichermassen. Dasselbe
// Muster wie feedAction.ts und nachrichtAction.ts, nur eine Ebene hoeher.
//
// ACHTUNG: hier darf KEINE Konstante stehen. Eine "use server"-Datei darf
// ausschliesslich async Funktionen exportieren; eine Zeile daneben bricht den
// Produktionsbau - und nur den, tsc und eslint sehen die Regel nicht. Alles
// Feste liegt in lib/rueckmeldung.ts.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { merkeNutzung } from "@/lib/features";
import { meldeNebenbei } from "@/lib/push";
import {
  AUDIO_MAX_BYTES,
  AUDIO_MAX_SEKUNDEN,
  MELDUNGEN_JE_TAG,
  RUECKMELDUNG_MAX_ZEICHEN,
  audioTypNormalisieren,
  istAnliegen,
  istStimmung,
  seiteSaeubern,
  stimmungText,
} from "@/lib/rueckmeldung";

export async function rueckmeldungSenden(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; fehler: string }> {
  const user = await requireUser();

  // Dem Formular wird nichts geglaubt. Alles hier kommt aus dem Browser.
  const stimmung = formData.get("stimmung");
  if (!istStimmung(stimmung)) {
    return { ok: false, fehler: "Da fehlt noch, wie es dir gerade geht." };
  }

  const anliegenRoh = formData.get("anliegen");
  const anliegen = istAnliegen(anliegenRoh) ? anliegenRoh : null;

  const textRoh = (formData.get("text") as string | null)?.trim() ?? "";
  const text = textRoh ? textRoh.slice(0, RUECKMELDUNG_MAX_ZEICHEN) : null;

  const seite = seiteSaeubern(formData.get("seite") as string | null);

  // Spam-Bremse. Ein versehentlicher Doppeltipp ist kein Problem, zweihundert
  // Meldungen aus Langeweile schon - und die Aufnahmen liegen in der
  // Datenbank.
  const seitGestern = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const bisher = await prisma.rueckmeldung.count({
    where: { userId: user.id, createdAt: { gte: seitGestern } },
  });
  if (bisher >= MELDUNGEN_JE_TAG) {
    return {
      ok: false,
      fehler: "Für heute reicht es. Melde dich morgen wieder — oder schreib direkt.",
    };
  }

  // --- Die Aufnahme ---------------------------------------------------------
  // Ist sie kaputt, zu gross oder vom falschen Typ, wird SIE verworfen und der
  // Rest trotzdem gespeichert. Eine misslungene Aufnahme darf die Meldung
  // nicht mitreissen - der Mensch hat schon gesprochen, das zaehlt.
  // Uint8Array und nicht Buffer: Prisma bildet Bytes auf Uint8Array ab - und
  // zwar auf das mit dem ArrayBuffer im Typ. Ein blosses "Uint8Array" waere
  // Uint8Array<ArrayBufferLike> und passt nicht.
  let audio: {
    daten: Uint8Array<ArrayBuffer>;
    typ: string;
    ms: number;
    bytes: number;
  } | null = null;
  const datei = formData.get("audio");
  if (datei instanceof File && datei.size > 0 && datei.size <= AUDIO_MAX_BYTES) {
    const typ = audioTypNormalisieren(datei.type);
    if (typ) {
      const ms = Number(formData.get("audioMs"));
      const gueltig = Number.isFinite(ms) && ms > 0 && ms <= (AUDIO_MAX_SEKUNDEN + 5) * 1000;
      if (gueltig) {
        // Der Puffer wird ausdruecklich als ArrayBuffer benannt: sonst leitet
        // TypeScript ArrayBufferLike ab, und Prisma will Uint8Array<ArrayBuffer>.
        const puffer: ArrayBuffer = await datei.arrayBuffer();
        const daten = new Uint8Array(puffer);
        // Nach dem Lesen noch einmal messen: size ist eine Angabe des
        // Browsers, daten.length ist das, was wirklich ankam.
        if (daten.length > 0 && daten.length <= AUDIO_MAX_BYTES) {
          audio = { daten, typ, ms: Math.round(ms), bytes: daten.length };
        }
      }
    }
  }

  await prisma.rueckmeldung.create({
    data: {
      userId: user.id,
      stimmung,
      anliegen,
      text,
      seite,
      ...(audio
        ? {
            audio: {
              create: {
                daten: audio.daten,
                typ: audio.typ,
                ms: audio.ms,
                bytes: audio.bytes,
              },
            },
          }
        : {}),
    },
  });

  // --- Ankommen -------------------------------------------------------------
  // Ein Postfach, in das keiner schaut, ist schlimmer als kein Postfach: es
  // sieht nach einem Versprechen aus. Regel 1 aus lib/push.ts ist erfuellt -
  // die Meldung nennt einen naechsten Schritt und fuehrt auf die Seite, auf
  // der er getan wird.
  const admins = await prisma.user.findMany({
    where: { role: "ADMIN", deactivatedAt: null, passwordHash: { not: null } },
    select: { id: true },
  });

  meldeNebenbei(
    admins.map((konto) => konto.id),
    {
      titel: `${user.name}: ${stimmungText(stimmung)}`,
      text: audio ? "Sprachnachricht. Hör sie dir an." : "Rückmeldung. Lies sie dir durch.",
      url: "/werkstatt/rueckmeldungen",
      // Feste Kennung: der Browser ersetzt eine noch offene Meldung, statt zu
      // stapeln. Bei mehreren Meldungen am Abend ist das der Unterschied
      // zwischen einem Hinweis und einem Meldungsfriedhof.
      kennung: "rueckmeldung",
    },
  );

  // Kein Baustein ohne Zaehlstelle (lib/features.ts, Regel 1). Gezaehlt wird
  // je Kopf, angezeigt ausschliesslich die Summe - die Messung zeigt nie auf
  // eine Person, auch hier nicht.
  const person = await prisma.person.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });
  await merkeNutzung("rueckmeldung", person?.id ?? null);

  revalidatePath("/werkstatt/rueckmeldungen");
  revalidatePath("/werkstatt");

  return { ok: true };
}
