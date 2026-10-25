"use server";

// Der Schreibpfad der Anfrage von aussen. Kein requireUser - die Seite ist
// oeffentlich, der Absender hat kein Konto. Genau deshalb wird dem Formular
// hier noch weniger geglaubt als sonst: Honeypot, Laengenkappen und eine
// Tageskappe ueber ALLE Absender (Muster: app/rueckmeldungAction.ts, nur
// global statt je Kopf - eine je-Kopf-Kappe braucht einen Kopf).

import { prisma } from "@/lib/prisma";
import { istAn } from "@/lib/features";
import { meldeNebenbei } from "@/lib/push";
import {
  ANFRAGE_JE_TAG,
  ANFRAGE_KONTAKT_MAX,
  ANFRAGE_NACHRICHT_MAX,
  ANFRAGE_NAME_MAX,
} from "@/lib/anfrage";

export async function anfrageSenden(
  formData: FormData
): Promise<{ ok: true } | { ok: false; fehler: string }> {
  if (!(await istAn("anfrage"))) {
    return {
      ok: false,
      fehler: "Anfragen sind gerade geschlossen. Melde dich direkt bei dem, der dir das Cockpit gezeigt hat.",
    };
  }

  // Der Honigtopf: ein Feld, das kein Mensch sieht und jeder Bot ausfuellt.
  // Gefuellt heisst still verwerfen - ein "ok" zurueck, damit der Bot nichts
  // lernt, aber nichts in der Datenbank.
  const falle = (formData.get("website") as string | null)?.trim();
  if (falle) return { ok: true };

  const name = (formData.get("name") as string | null)?.trim().slice(0, ANFRAGE_NAME_MAX);
  const kontakt = (formData.get("kontakt") as string | null)
    ?.trim()
    .slice(0, ANFRAGE_KONTAKT_MAX);
  const nachrichtRoh = (formData.get("nachricht") as string | null)?.trim() ?? "";
  const nachricht = nachrichtRoh ? nachrichtRoh.slice(0, ANFRAGE_NACHRICHT_MAX) : null;

  if (!name || !kontakt) {
    return { ok: false, fehler: "Name und Erreichbarkeit brauchen wir — sonst können wir uns nicht melden." };
  }

  // Die Tageskappe ueber alle: eine oeffentliche Seite ohne Kappe ist eine
  // Einladung, die Datenbank vollzuschreiben. 20 echte Anfragen an einem Tag
  // waeren ein schoenes Problem - und der 21. Interessent meldet sich morgen.
  const seitGestern = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const bisher = await prisma.anfrage.count({
    where: { createdAt: { gte: seitGestern } },
  });
  if (bisher >= ANFRAGE_JE_TAG) {
    return {
      ok: false,
      fehler: "Gerade kommen viele Anfragen an. Versuch es morgen noch einmal.",
    };
  }

  await prisma.anfrage.create({ data: { name, kontakt, nachricht } });

  // Ankommen wie bei der Rueckmeldung: ein Postfach, in das keiner schaut,
  // ist schlimmer als kein Postfach. Ohne VAPID-Schluessel tut meldeNebenbei
  // schlicht nichts - die Anfrage liegt trotzdem in der Werkstatt.
  const admins = await prisma.user.findMany({
    where: { role: "ADMIN", deactivatedAt: null, passwordHash: { not: null } },
    select: { id: true },
  });
  meldeNebenbei(
    admins.map((konto) => konto.id),
    {
      titel: `Anfrage von ${name}`,
      text: "Jemand von außen will das Cockpit. Sieh dir die Anfrage an.",
      url: "/werkstatt/anfragen",
      kennung: "anfrage",
    }
  );

  // Keine merkeNutzung-Zaehlstelle: der Absender hat keine Person, und die
  // Tabelle Anfrage IST hier die Messung - jede Zeile ist ein Ereignis.
  return { ok: true };
}
