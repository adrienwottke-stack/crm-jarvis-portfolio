"use server";

// Eigene Datei, weil eine Client-Komponente sie importiert - "use server"-
// Module ueber der Client-Grenze bleiben in diesem Projekt strikt getrennt
// (siehe quickLogAction.ts).

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { z } from "zod";

export type AboDaten = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

/**
 * Traegt das Geraet ein oder schreibt es fort.
 *
 * Der Endpunkt ist der Schluessel: derselbe Browser erneuert seinen Eintrag,
 * statt einen zweiten anzulegen. Wechselt das Konto am selben Geraet, wandert
 * das Abo mit - sonst bekaeme der Vorgaenger die Meldungen des Nachfolgers.
 */
export async function aboSpeichern(daten: AboDaten) {
  const user = await requireUser();
  const valid = z.object({
    endpoint: z.url().max(2048).refine(value => new URL(value).protocol === "https:"),
    p256dh: z.string().min(1).max(512).regex(/^[a-zA-Z0-9_-]+={0,2}$/),
    auth: z.string().min(1).max(256).regex(/^[a-zA-Z0-9_-]+={0,2}$/),
  }).strict().parse(daten);

  await prisma.pushAbo.upsert({
    where: { endpoint: valid.endpoint },
    create: {
      userId: user.id,
      ...valid,
    },
    // Dispatch always rechecks this owner against its frozen release recipient.
    update: { userId: user.id, p256dh: valid.p256dh, auth: valid.auth },
  });
}

export async function aboLoeschen(endpoint: string) {
  const user = await requireUser();
  if (!endpoint) return;
  await prisma.pushAbo.deleteMany({ where: { endpoint, userId: user.id } });
}
