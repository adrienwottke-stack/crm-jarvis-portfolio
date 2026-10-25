import { prisma } from "@/lib/prisma";

export type Begleitungswerte = {
  namen: number;
  nummern: number;
  anrufe: number;
  vereinbart: number;
  gehalten: number;
  abschluesse: number;
  einheiten: number;
  empfehlungGefragt: boolean;
};
export function begleitungsSchritte(w: Begleitungswerte) {
  const schritte = [
    {
      titel: "Ersten Namen aufnehmen",
      fertig: w.namen > 0,
      href: "/namen/sammeln",
    },
    {
      titel: "Eine Telefonnummer ergänzen",
      fertig: w.nummern > 0,
      href: "/namen/nummern",
    },
    {
      titel: "Ersten Anruf machen",
      fertig: w.anrufe > 0,
      href: "/namen/anrufen",
    },
    {
      titel: "Ersten Termin vereinbaren",
      fertig: w.vereinbart > 0,
      href: "/namen/anrufen",
    },
    {
      titel: "Ersten Termin halten und Ergebnis eintragen",
      fertig: w.gehalten > 0,
      href: "/kalender",
    },
    {
      titel: "Nach Empfehlungen fragen",
      fertig: w.empfehlungGefragt,
      href: "/heute?alle=1",
    },
  ];
  if (w.abschluesse > 0)
    schritte.push({
      titel: "Erste Einheiten eintragen",
      fertig: w.einheiten > 0,
      href: "/fortschritt/einheiten-offen",
    });
  return schritte;
}

export async function ladeBegleitung(userId: string) {
  const [namen, nummern, logs, gefragt, einheiten] = await Promise.all([
    prisma.contact.count({ where: { ownerId: userId } }),
    prisma.contact.count({ where: { ownerId: userId, phone: { not: null } } }),
    prisma.dailyLog.groupBy({
      by: ["type"],
      where: { person: { userId } },
      _sum: { count: true },
    }),
    prisma.contact.count({
      where: { ownerId: userId, referralsAskedAt: { not: null } },
    }),
    prisma.einheitenbuchung.aggregate({
      where: { userId },
      _sum: { hundertstel: true },
    }),
  ]);
  const summe = (type: string) =>
    logs.find((log) => log.type === type)?._sum.count ?? 0;
  return begleitungsSchritte({
    namen,
    nummern,
    anrufe: summe("CALL"),
    vereinbart: summe("APPOINTMENT_SET"),
    gehalten: summe("APPOINTMENT_HELD"),
    abschluesse: summe("DEAL_WON"),
    einheiten: einheiten._sum.hundertstel ?? 0,
    empfehlungGefragt: gefragt > 0,
  });
}
