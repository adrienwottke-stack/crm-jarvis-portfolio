import { prisma } from "@/lib/prisma";
import { berlinToday } from "@/lib/dates";
import { parseEinheiten } from "@/lib/einheiten";
import { ladeZielZumBearbeiten, zielMitStand } from "@/lib/ziele";
import {
  darfZielBestaetigen,
  darfZielVorschlagen,
  zielZeitraum,
  zielPruefzeit,
  ZIEL_KENNZAHLEN,
  type ZielKennzahl,
} from "@/lib/ziele-modell";

export class ZielEingabeFehler extends Error {}

export type ZielEingabe = {
  id?: string;
  inhaberId?: string;
  kennzahl: string;
  zielwert: string;
  zeitraum: string;
  tag?: string;
  titel?: string;
  wunsch?: string;
  hauptziel?: boolean;
};

async function betrachter(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, path: true, deactivatedAt: true },
  });
  if (!user || user.deactivatedAt)
    throw new ZielEingabeFehler("Das Konto ist nicht aktiv.");
  return user;
}

export async function speichereZiel(userId: string, eingabe: ZielEingabe) {
  const user = await betrachter(userId);
  const inhaberId = eingabe.inhaberId || user.id;
  const inhaber = await prisma.user.findUnique({
    where: { id: inhaberId },
    select: { id: true, name: true, path: true, deactivatedAt: true },
  });
  if (!inhaber || !darfZielVorschlagen(user, inhaber))
    throw new ZielEingabeFehler(
      "Du kannst nur dir selbst oder deiner aktuellen Struktur ein Ziel vorschlagen.",
    );
  if (!Object.hasOwn(ZIEL_KENNZAHLEN, eingabe.kennzahl))
    throw new ZielEingabeFehler("Bitte eine Kennzahl wählen.");
  const kennzahl = eingabe.kennzahl as ZielKennzahl;
  const zielwert =
    kennzahl === "UNITS"
      ? parseEinheiten(eingabe.zielwert)
      : /^\d+$/.test(eingabe.zielwert)
        ? Number(eingabe.zielwert)
        : null;
  if (
    zielwert === null ||
    !Number.isSafeInteger(zielwert) ||
    zielwert <= 0 ||
    zielwert > 10_000_000
  )
    throw new ZielEingabeFehler("Bitte einen positiven Zielwert eintragen.");
  if (eingabe.zeitraum !== "WOCHE" && eingabe.zeitraum !== "MONAT")
    throw new ZielEingabeFehler("Bitte Woche oder Monat wählen.");
  let grenzen;
  try {
    grenzen = zielZeitraum(eingabe.zeitraum, eingabe.tag || berlinToday());
  } catch {
    throw new ZielEingabeFehler("Bitte einen gültigen Kalendertag wählen.");
  }
  const titel =
    eingabe.titel?.trim().slice(0, 100) || ZIEL_KENNZAHLEN[kennzahl];
  const wunsch = eingabe.wunsch?.trim().slice(0, 500) || null;
  const data = {
    titel,
    wunsch,
    kennzahl,
    zielwert,
    zeitraum: eingabe.zeitraum as "WOCHE" | "MONAT",
    ...grenzen,
  };
  if (eingabe.id) {
    const ziel = await ladeZielZumBearbeiten(eingabe.id, user);
    if (ziel.inhaberId !== user.id || ziel.inhaberId !== inhaberId)
      throw new ZielEingabeFehler("Nur der Inhaber kann ein Ziel ändern.");
    if (ziel.zeitraum === "ALT_30_TAGE")
      throw new ZielEingabeFehler(
        "Das alte Versprechen bleibt unverändert. Lege dafür ein neues Ziel an.",
      );
    if (ziel.archiviertAt)
      throw new ZielEingabeFehler(
        "Ein beendetes Ziel bleibt in deiner Historie. Lege ein neues Ziel an.",
      );
    await prisma.ziel.update({ where: { id: ziel.id }, data });
    return { id: ziel.id, eigenes: true, name: inhaber.name, geaendert: true };
  }
  const eigenes = inhaberId === user.id;
  const ziel = await prisma.ziel.create({
    data: {
      ...data,
      inhaberId,
      erstelltVonId: user.id,
      beteiligte: {
        create: [
          {
            userId: inhaberId,
            zusage: eigenes ? "BESTAETIGT" : "OFFEN",
            bestaetigtAt: eigenes ? new Date() : null,
          },
          ...(!eigenes
            ? [
                {
                  userId: user.id,
                  zusage: "BESTAETIGT" as const,
                  bestaetigtAt: new Date(),
                },
              ]
            : []),
        ],
      },
    },
  });
  if (eigenes && eingabe.hauptziel)
    await prisma.user.update({
      where: { id: user.id },
      data: { hauptzielId: ziel.id },
    });
  return { id: ziel.id, eigenes, name: inhaber.name, geaendert: false };
}

export async function bestaetigeZiel(
  userId: string,
  zielId: string,
  annehmen: boolean,
) {
  const user = await betrachter(userId);
  const ziel = await ladeZielZumBearbeiten(zielId, user);
  if (!darfZielBestaetigen(user.id, ziel.inhaberId))
    throw new ZielEingabeFehler(
      "Nur der Inhaber entscheidet über dieses Ziel.",
    );
  if (ziel.archiviertAt || ziel.ende <= zielPruefzeit(ziel.zeitraum))
    throw new ZielEingabeFehler("Dieser Vorschlag ist nicht mehr aktuell.");
  if (
    ziel.erstelltVonId !== user.id &&
    (ziel.erstelltVon.deactivatedAt ||
      !darfZielVorschlagen(ziel.erstelltVon, ziel.inhaber))
  )
    throw new ZielEingabeFehler(
      "Der Vorschlag gehört nicht mehr zu deiner aktuellen Struktur.",
    );
  if (
    ziel.beteiligte.find((eintrag) => eintrag.userId === user.id)?.zusage !==
    "OFFEN"
  )
    throw new ZielEingabeFehler(
      "Über diesen Vorschlag wurde bereits entschieden.",
    );
  await prisma.zielBeteiligung.updateMany({
    where: { zielId, userId: user.id, zusage: "OFFEN" },
    data: {
      zusage: annehmen ? "BESTAETIGT" : "ABGELEHNT",
      bestaetigtAt: annehmen ? new Date() : null,
    },
  });
}

export async function setzeHauptziel(userId: string, zielId: string) {
  const user = await betrachter(userId);
  const ziel = await zielMitStand(await ladeZielZumBearbeiten(zielId, user));
  if (ziel.inhaberId !== user.id || !ziel.aktiv)
    throw new ZielEingabeFehler(
      "Wähle ein eigenes, bestätigtes Ziel aus dem laufenden Zeitraum.",
    );
  await prisma.user.update({
    where: { id: user.id },
    data: { hauptzielId: ziel.id },
  });
}
