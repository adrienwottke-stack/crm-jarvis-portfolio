// Der Struktur-Baum: die einzige Stelle, an der "User.path" entsteht oder sich
// aendert. Wer den Pfad woanders schreibt, zerlegt still die Sichtbarkeit.
//
// Format: fuehrender und schliessender Schraegstrich, die eigene Id am Ende.
//   Wurzel      "/clx1/"
//   darunter    "/clx1/clx7/"
//
// Der schliessende Schraegstrich ist kein Schoenheitsfehler, sondern verhindert,
// dass "/clx1/" auch auf "/clx1abc/" passt. "Ich und alles unter mir" ist damit
// ein startsWith auf dem eigenen Pfad - der eigene Pfad ist sein eigener Praefix.
//
// Siehe docs/struktur-plan.md, Abschnitt 2.

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";

/** Strukturänderungen lesen und schreiben denselben Baum unter einer Sperre. */
export async function strukturTransaktion<T>(arbeit: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`LOCK TABLE "User" IN SHARE ROW EXCLUSIVE MODE`;
    return arbeit(tx);
  }, { timeout: 15000 });
}

/** Pfad eines Kontos, das unter `leaderPath` haengt. Ohne Fuehrungskraft: Wurzel. */
export function pfadUnter(leaderPath: string | null, userId: string): string {
  const basis = leaderPath && leaderPath.startsWith("/") ? leaderPath : "/";
  return `${basis}${userId}/`;
}

/** Liegt `pfad` im Ast von `wurzelPfad` (inklusive der Wurzel selbst)? */
export function liegtImAst(pfad: string, wurzelPfad: string): boolean {
  return pfad.startsWith(wurzelPfad);
}

/**
 * Die Id der Fuehrungskraft aus dem Pfad - ohne zweite Abfrage.
 *
 * "/a/b/c/" -> "b". Der Pfad traegt die eigene Id am Ende, das vorletzte
 * Stueck ist damit die Fuehrungskraft. Bei einer Wurzel gibt es keine.
 */
export function elternIdVon(pfad: string): string | null {
  const teile = pfad.split("/").filter(Boolean);
  return teile.length >= 2 ? (teile[teile.length - 2] ?? null) : null;
}

/** Ebene im Baum: Wurzel = 0. */
export function ebene(pfad: string): number {
  return Math.max(0, pfad.split("/").filter(Boolean).length - 1);
}

/** Ich und alles unter mir, ueber alle Ebenen. Ausgetretene bleiben draussen. */
export async function strukturKonten(userId: string): Promise<string[]> {
  const ich = await prisma.user.findUnique({
    where: { id: userId },
    select: { path: true },
  });
  if (!ich || ich.path === "/") return [userId];

  const konten = await prisma.user.findMany({
    where: { path: { startsWith: ich.path }, deactivatedAt: null },
    select: { id: true },
  });
  // Der Betrachter bleibt drin, auch wenn er selbst deaktiviert ist.
  return konten.some((konto) => konto.id === userId)
    ? konten.map((konto) => konto.id)
    : [userId, ...konten.map((konto) => konto.id)];
}

/** Ich und meine direkt Unterstellten - eine Ebene, nicht der ganze Ast. */
export async function direkteKonten(userId: string): Promise<string[]> {
  const konten = await prisma.user.findMany({
    where: { leaderId: userId, deactivatedAt: null },
    select: { id: true },
  });
  return [userId, ...konten.map((konto) => konto.id)];
}

export type UmhaengenFehler = "unbekannt" | "sich_selbst" | null;

/**
 * Haengt ein Konto unter eine neue Fuehrungskraft und schreibt die Pfade des
 * gesamten Astes mit. Beides zusammen oder gar nicht.
 *
 * Der Sonderfall ist "jemanden UEBER sich einhaengen": die gewaehlte
 * Fuehrungskraft haengt heute selbst unter diesem Konto. Ein Zug reicht dafuer
 * nicht - unmittelbar umgehaengt entstuende ein Kreis, aus dem keine Abfrage
 * mehr herausfindet. Frueher wies die Funktion das ab, und die Reihenfolge war
 * Handarbeit am Bildschirm: erst den Neuen auf Wurzel setzen, dann sich selbst
 * darunter. Wer sie verwechselte, sah nur eine Fehlermeldung - und wer selbst
 * die Wurzel war, hatte ueberhaupt niemanden zur Auswahl. Jetzt legt die
 * Struktur die Reihenfolge selbst.
 */
export async function umhaengen(
  userId: string,
  neueLeaderId: string | null
): Promise<UmhaengenFehler> {
  return strukturTransaktion((tx) => umhaengenInTransaktion(tx, userId, neueLeaderId));
}

export async function umhaengenInTransaktion(
  tx: Prisma.TransactionClient,
  userId: string,
  neueLeaderId: string | null,
): Promise<UmhaengenFehler> {
  if (neueLeaderId === userId) return "sich_selbst";

  const ich = await tx.user.findUnique({
    where: { id: userId },
    select: { path: true, leaderId: true },
  });
  if (!ich) return "unbekannt";

  if (neueLeaderId) {
    const leader = await tx.user.findUnique({
      where: { id: neueLeaderId },
      select: { path: true },
    });
    if (!leader) return "unbekannt";

    // Der Neue haengt unter mir: er rueckt zuerst mitsamt seinem eigenen Ast
    // an meine Stelle - danach bin ich nicht mehr sein Vorfahr, und der
    // zweite Zug ist ein ganz gewoehnliches Umhaengen. Beide Zuege schreiben
    // jeweils ihren ganzen Ast mit.
    if (liegtImAst(leader.path, ich.path)) {
      await verschieben(tx, neueLeaderId, ich.leaderId);
      await verschieben(tx, userId, neueLeaderId);
      return null;
    }
  }

  await verschieben(tx, userId, neueLeaderId);
  return null;
}

/**
 * Der Schreibvorgang selbst, ohne Pruefung - die hat `umhaengen` schon
 * gemacht. Liest die Pfade absichtlich frisch: beim Einhaengen ueber sich
 * laeuft die Funktion zweimal, und der zweite Lauf haette sonst den Pfad von
 * vor dem ersten in der Hand.
 *
 * Der teure Teil ist das Nachziehen der Nachfahren. Prisma kann in updateMany
 * nicht auf dem alten Spaltenwert rechnen, deshalb ein einzelnes SQL: den alten
 * Praefix abschneiden, den neuen davorsetzen. Eine Anweisung fuer den ganzen Ast.
 */
async function verschieben(
  tx: Prisma.TransactionClient,
  userId: string,
  neueLeaderId: string | null
): Promise<void> {
  const ich = await tx.user.findUnique({
    where: { id: userId },
    select: { path: true },
  });
  if (!ich) return;

  let leaderPath: string | null = null;
  if (neueLeaderId) {
    const leader = await tx.user.findUnique({
      where: { id: neueLeaderId },
      select: { path: true },
    });
    if (!leader) return;
    leaderPath = leader.path;
  }

  const alt = ich.path;
  const neu = pfadUnter(leaderPath, userId);
  if (alt === neu) {
    await tx.user.update({
      where: { id: userId },
      data: { leaderId: neueLeaderId },
    });
    return;
  }

  await tx.user.update({
      where: { id: userId },
      data: { leaderId: neueLeaderId },
    });
    // Der Cast auf int ist Pflicht, nicht Kosmetik.
    //
    // Ohne ihn kommt die Startposition als text an, und Postgres waehlt dann
    // NICHT substring(text, int), sondern die POSIX-Variante
    // substring(text, pattern) - eine Regex-Suche nach "52". Die findet
    // nichts, liefert NULL, und aus `neu || NULL` wird NULL. Ergebnis war ein
    // Verstoss gegen die NOT-NULL-Regel auf "path": das Umhaengen brach mit
    // einem 500er ab, und zwar lautlos fuer den Nutzer.
    await tx.$executeRaw`
      UPDATE "User"
      SET "path" = ${neu} || substring("path", ${alt.length + 1}::int)
      WHERE "path" LIKE ${`${alt}%`}
    `;
}
