import { prisma } from "@/lib/prisma";
import { berlinToday, dayToUtcDate, shiftDay } from "@/lib/dates";
import { parseEinheiten } from "@/lib/einheiten";
import {
  formatZielwert,
  zielFortschritt,
  zielZeitraum,
  ZIEL_KENNZAHLEN,
  type ZielKennzahl,
} from "@/lib/ziele-modell";
import type { Teamziel } from "@/lib/generated/prisma/client";

export class TeamzielFehler extends Error {}

export type TeamzielStand = {
  id: string;
  titel: string;
  wunsch: string | null;
  teamName: string;
  wurzelId: string;
  eigenes: boolean;
  kennzahl: ZielKennzahl;
  start: Date;
  ende: Date;
  standText: string;
  erreicht: number;
  zielwert: number;
  anteil: number;
  geschafft: boolean;
  mitglieder: number;
  datenluecken: number;
};

async function aktivesKonto(userId: string) {
  const user = await prisma.user.findFirst({
    where: { id: userId, deactivatedAt: null, passwordHash: { not: null } },
    select: { id: true, name: true, path: true },
  });
  if (!user) throw new TeamzielFehler("Das Konto ist nicht aktiv.");
  return user;
}

function imAst(path: string, wurzel: string) {
  return wurzel !== "/" && path.startsWith(wurzel);
}

export async function teamzielSpeichern(
  userId: string,
  eingabe: {
    titel?: string;
    wunsch?: string;
    kennzahl: string;
    zielwert: string;
    zeitraum: string;
    tag?: string;
  },
) {
  const user = await aktivesKonto(userId);
  const direkte = await prisma.user.count({
    where: {
      leaderId: user.id,
      deactivatedAt: null,
      passwordHash: { not: null },
    },
  });
  if (!direkte || user.path === "/")
    throw new TeamzielFehler(
      "Für ein Teamziel brauchst du einen aktiven eigenen Partner.",
    );
  if (!Object.hasOwn(ZIEL_KENNZAHLEN, eingabe.kennzahl))
    throw new TeamzielFehler("Bitte eine Kennzahl wählen.");
  const kennzahl = eingabe.kennzahl as ZielKennzahl;
  const roh = eingabe.zielwert.trim();
  const zielwert =
    kennzahl === "UNITS"
      ? parseEinheiten(roh)
      : /^\d+$/.test(roh)
        ? Number(roh)
        : null;
  if (
    zielwert === null ||
    !Number.isSafeInteger(zielwert) ||
    zielwert <= 0 ||
    zielwert > 10_000_000
  )
    throw new TeamzielFehler("Bitte einen positiven Zielwert eintragen.");
  if (eingabe.zeitraum !== "WOCHE" && eingabe.zeitraum !== "MONAT")
    throw new TeamzielFehler("Bitte Woche oder Monat wählen.");
  let grenzen;
  try {
    grenzen = zielZeitraum(eingabe.zeitraum, eingabe.tag || berlinToday());
  } catch {
    throw new TeamzielFehler("Bitte einen gültigen Kalendertag wählen.");
  }
  return prisma.teamziel.create({
    data: {
      wurzelId: user.id,
      verantwortlichId: user.id,
      titel:
        eingabe.titel?.trim().slice(0, 100) ||
        `Unser Ziel · ${ZIEL_KENNZAHLEN[kennzahl]}`,
      wunsch: eingabe.wunsch?.trim().slice(0, 500) || null,
      kennzahl,
      zielwert,
      zeitraum: eingabe.zeitraum,
      ...grenzen,
    },
    select: { id: true },
  });
}

export async function teamzielArchivieren(userId: string, id: string) {
  await aktivesKonto(userId);
  const result = await prisma.teamziel.updateMany({
    where: {
      id,
      wurzelId: userId,
      verantwortlichId: userId,
      archiviertAt: null,
    },
    data: { archiviertAt: new Date() },
  });
  if (!result.count)
    throw new TeamzielFehler("Dieses Teamziel kannst du nicht beenden.");
}

async function standFuer(
  ziel: Teamziel & { wurzel: { name: string; path: string } },
  userId: string,
  tag: string,
): Promise<TeamzielStand> {
  const mitglieder =
    ziel.wurzel.path === "/"
      ? []
      : await prisma.user.findMany({
          where: {
            id: { not: ziel.wurzelId },
            path: { startsWith: ziel.wurzel.path },
            deactivatedAt: null,
            passwordHash: { not: null },
          },
          select: { id: true, person: { select: { id: true } } },
        });
  const ids = mitglieder.map((person) => person.id);
  const bis = dayToUtcDate(shiftDay(tag, 1));
  const zeit = { gte: ziel.start, lt: ziel.ende < bis ? ziel.ende : bis };
  const wert =
    ziel.kennzahl === "UNITS"
      ? ((
          await prisma.einheitenbuchung.aggregate({
            where: { userId: { in: ids }, tag: zeit },
            _sum: { hundertstel: true },
          })
        )._sum.hundertstel ?? 0)
      : ((
          await prisma.dailyLog.aggregate({
            where: {
              person: { userId: { in: ids } },
              type: ziel.kennzahl,
              date: zeit,
            },
            _sum: { count: true },
          })
        )._sum.count ?? 0);
  const stand = zielFortschritt(
    ziel.zielwert,
    [{ tag: ziel.start, wert }],
    ziel,
  );
  // Ein freigegebenes Teamziel liefert nur einen Gesamtstand, keine Personenliste.
  return {
    id: ziel.id,
    titel: ziel.titel,
    wunsch: ziel.wunsch,
    teamName: ziel.wurzel.name,
    wurzelId: ziel.wurzelId,
    eigenes: ziel.wurzelId === userId,
    kennzahl: ziel.kennzahl,
    start: ziel.start,
    ende: ziel.ende,
    zielwert: ziel.zielwert,
    standText: `${formatZielwert(wert, ziel.kennzahl)} von ${formatZielwert(ziel.zielwert, ziel.kennzahl)} ${ZIEL_KENNZAHLEN[ziel.kennzahl]}`,
    erreicht: stand.erreicht,
    anteil: stand.anteil,
    geschafft: stand.geschafft,
    mitglieder: ids.length,
    datenluecken:
      ziel.kennzahl === "UNITS"
        ? 0
        : mitglieder.filter((p) => !p.person).length,
  };
}

/** Members may read their shared aggregate; leadership may inspect its own subteams. */
export async function ladeTeamziele(
  userId: string,
  auswahl: { wurzelId?: string; tag?: string; alleZeitraeume?: boolean } = {},
): Promise<TeamzielStand[]> {
  const user = await aktivesKonto(userId);
  const tag = auswahl.tag || berlinToday();
  try {
    zielZeitraum("MONAT", tag);
  } catch {
    throw new TeamzielFehler("Ungültiger Zeitraum.");
  }
  const wurzelIds = auswahl.wurzelId
    ? [auswahl.wurzelId]
    : [...new Set([...user.path.split("/").filter(Boolean), user.id])];
  const wurzeln = await prisma.user.findMany({
    where: {
      id: { in: wurzelIds },
      deactivatedAt: null,
      passwordHash: { not: null },
    },
    select: { id: true, path: true },
  });
  const erlaubt = wurzeln.filter(
    (wurzel) =>
      wurzel.id === user.id ||
      imAst(user.path, wurzel.path) ||
      imAst(wurzel.path, user.path),
  );
  const ziele = await prisma.teamziel.findMany({
    where: {
      wurzelId: { in: erlaubt.map((w) => w.id) },
      ...(!auswahl.alleZeitraeume
        ? { start: { lte: dayToUtcDate(tag) }, ende: { gt: dayToUtcDate(tag) } }
        : {}),
      archiviertAt: null,
    },
    include: { wurzel: { select: { name: true, path: true } } },
    orderBy: { createdAt: "desc" },
  });
  const staende = await Promise.all(
    ziele.map((ziel) => standFuer(ziel, userId, tag)),
  );
  return staende.sort((a, b) => Number(b.eigenes) - Number(a.eigenes));
}
