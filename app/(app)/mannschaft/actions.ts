"use server";

// Fuehrungsaufgaben: vornehmen, erledigen, verschieben.
//
// Die eine Regel, die hier hart durchgesetzt wird: eine Aufgabe entsteht NUR
// durch einen Tipp der Fuehrungskraft. docs/audit-kernmodell.md, Abschnitt 9,
// nennt automatisch aus Signalen erzeugte Aufgaben ausdruecklich als "bewusst
// nicht gebaut" - nach zwei Wochen haette man zweihundert davon und schaut nie
// wieder hin. Es gibt deshalb in der ganzen Anwendung keinen zweiten Weg, eine
// LeadershipTask anzulegen.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { pfadUnter, strukturKonten } from "@/lib/struktur";
import { ablaufDatum, neuerCode } from "@/lib/einladung";
import { berlinToday, dayToUtcDate } from "@/lib/dates";
import { artFuerSignal, istFrist, tageFuerFrist } from "@/lib/fuehrungsaufgaben";
import type { UserRole } from "@/lib/generated/prisma/enums";

const TAG_MS = 24 * 60 * 60 * 1000;

function feld(formData: FormData, name: string): string {
  const wert = formData.get(name);
  return typeof wert === "string" ? wert.trim() : "";
}

function neuRechnen() {
  revalidatePath("/mannschaft");
  revalidatePath("/heute");
}

/**
 * Prueft, dass der Betrachter diese Person ueberhaupt fuehrt.
 *
 * Ohne das koennte jeder eine Aufgabe an jedes Konto haengen - und weil die
 * Aufgabe den Namen auf der Heute-Liste zeigt, waere das ein Weg, Namen aus
 * fremden Strukturen abzufragen.
 */
async function inMeinerStruktur(
  leaderId: string,
  memberId: string,
  role: UserRole
): Promise<boolean> {
  if (leaderId === memberId) return false;
  // Ein Admin sieht auf /mannschaft immer die ganze Instanz, unabhaengig von
  // der eigenen Struktur (siehe lib/fuehrung.ts, gesamtstruktur) - dieselbe
  // Ausnahme muss hier gelten, sonst laufen Knoepfe ins Leere, die die Seite
  // gerade erst gezeigt hat.
  if (role === "ADMIN") return true;
  const konten = await strukturKonten(leaderId);
  return konten.includes(memberId);
}

/** „Ich kümmere mich" – der eine Tipp, der aus einem Signal eine Sache macht. */
export async function aufgabeVornehmen(formData: FormData) {
  const user = await requireUser();
  const memberId = feld(formData, "memberId");
  const fristRoh = feld(formData, "frist");
  const anlass = feld(formData, "anlass").slice(0, 200) || null;
  const notiz = feld(formData, "notiz").slice(0, 200) || null;
  if (!memberId) return;
  if (!(await inMeinerStruktur(user.id, memberId, user.role))) return;

  // Die Kette bleibt auch in der Aufgabe erhalten.
  //
  // Ohne das stuende bei Timo in drei Tagen "Anruf · Nick Ahrens" auf der
  // Heute-Liste - und er ruft Nick an, an Jonathan vorbei. Die Unterscheidung
  // zwischen einem Direkten und jemandem tiefer im Ast ist der einzige Grund,
  // warum drei Ebenen anders sind als zwei; sie darf nicht auf halbem Weg
  // verloren gehen.
  const betroffener = await prisma.user.findUnique({
    where: { id: memberId },
    select: { leaderId: true },
  });
  const dazwischen =
    betroffener?.leaderId && betroffener.leaderId !== user.id
      ? await prisma.user.findUnique({
          where: { id: betroffener.leaderId },
          select: { name: true },
        })
      : null;
  const kettenNotiz = dazwischen
    ? `Mit ${dazwischen.name.split(" ")[0]} besprechen, nicht daran vorbei.`
    : null;

  const tage = tageFuerFrist(istFrist(fristRoh) ? fristRoh : "drei");
  // Ende des Zieltages: eine Aufgabe „in 3 Tagen" ist an diesem Tag faellig,
  // nicht in dem Moment, in dem sie angelegt wurde.
  const faellig = new Date(
    dayToUtcDate(berlinToday()).getTime() + tage * TAG_MS + (TAG_MS - 1000)
  );

  // Nur eine offene Sache je Person. Ein zweiter Tipp verschiebt die Frist,
  // statt einen Stapel anzulegen.
  const vorhanden = await prisma.leadershipTask.findFirst({
    where: { leaderId: user.id, memberId, doneAt: null },
    select: { id: true },
  });
  if (vorhanden) {
    await prisma.leadershipTask.update({
      where: { id: vorhanden.id },
      data: { dueAt: faellig, ...(notiz ? { note: notiz } : {}) },
    });
  } else {
    await prisma.leadershipTask.create({
      data: {
        leaderId: user.id,
        memberId,
        // Bei jemandem tiefer im Ast ist die Aufgabe ein Gespraech mit der
        // Fuehrungskraft dazwischen, kein Anruf beim Betroffenen.
        type: dazwischen ? "EINS_ZU_EINS" : artFuerSignal(anlass),
        dueAt: faellig,
        signal: anlass,
        note: notiz ?? kettenNotiz,
      },
    });
  }
  neuRechnen();
}

/** Erledigt. Die Aufgabe verschwindet, das Signal steht wieder fuer sich. */
export async function aufgabeErledigt(formData: FormData) {
  const user = await requireUser();
  const id = feld(formData, "aufgabeId");
  if (!id) return;
  await prisma.leadershipTask.updateMany({
    where: { id, leaderId: user.id, doneAt: null },
    data: { doneAt: new Date() },
  });
  neuRechnen();
}

/** Nochmal Zeit geben, ohne die Sache aus den Augen zu verlieren. */
export async function aufgabeVerschieben(formData: FormData) {
  const user = await requireUser();
  const id = feld(formData, "aufgabeId");
  const fristRoh = feld(formData, "frist");
  if (!id) return;
  const tage = tageFuerFrist(istFrist(fristRoh) ? fristRoh : "drei");
  const faellig = new Date(
    dayToUtcDate(berlinToday()).getTime() + tage * TAG_MS + (TAG_MS - 1000)
  );
  await prisma.leadershipTask.updateMany({
    where: { id, leaderId: user.id, doneAt: null },
    data: { dueAt: faellig },
  });
  neuRechnen();
}

// --- Platzhalter: die Struktur steht vor den Konten --------------------------
//
// Beim Ausrollen auf ein Team ist die Struktur vorher da: Emil, vier Leute
// unter ihm, die Ebene darueber. Bis hierhin konnte der Baum davon nichts
// abbilden - ein Mensch tauchte erst auf, wenn er eine Einladung eingeloest
// hatte. Wer eine Struktur plant, brauchte also ein zweites Werkzeug daneben,
// und ab dem Moment stimmt eines von beiden nicht mehr.
//
// Ein Platzhalter ist ein User ohne Zugangsdaten (siehe schema.prisma). Er
// steht im Baum, laesst sich umhaengen und ansehen - und zaehlt in keiner
// Leistungszahl mit, weil er nie gearbeitet hat.

/** Kein Name, kein Knoten. Alles andere ist freiwillig. */
const NAME_MAX = 60;

export async function personAufnehmen(formData: FormData) {
  const user = await requireUser();
  const name = feld(formData, "name").slice(0, NAME_MAX);
  const unterId = feld(formData, "unterId") || user.id;
  const telefon = feld(formData, "telefon").slice(0, 30) || null;
  const mitEinladung = feld(formData, "mitEinladung") === "on";

  if (!name) return { fehler: "Ohne Namen geht es nicht." };

  // Die einzige Stelle, an der hier etwas schiefgehen kann: wer sich Leute
  // UEBER sich oder quer in einen fremden Ast haengt, zerlegt still die
  // Sichtbarkeit. Geprueft wird deshalb gegen strukturKonten - dieselbe
  // Funktion, aus der auch lib/scope.ts seine Grenze zieht -, nicht gegen
  // leaderId. Ein Admin ist davon ausgenommen: er sieht auf /mannschaft
  // ohnehin die ganze Instanz, sobald er selbst niemanden fuehrt.
  if (user.role !== "ADMIN") {
    const meine = await strukturKonten(user.id);
    if (!meine.includes(unterId)) {
      return { fehler: "Diese Führungskraft liegt nicht in deiner Struktur." };
    }
  }

  const chef = await prisma.user.findUnique({
    where: { id: unterId },
    select: { id: true, path: true },
  });
  if (!chef) return { fehler: "Führungskraft nicht gefunden." };

  const angelegt = await prisma.$transaction(async (tx) => {
    // Ohne email, ohne passwordSalt, ohne passwordHash - genau das macht ihn
    // zum Platzhalter. Kein Person-Datensatz: wer nie gearbeitet hat, gehoert
    // in keine Rangliste. Der entsteht erst beim Einloesen der Einladung.
    const neu = await tx.user.create({
      data: { name, phone: telefon, leaderId: chef.id, recruitedById: user.id },
      select: { id: true },
    });
    // Der Pfad braucht die eigene Id und kann deshalb erst jetzt stehen -
    // dieselbe zweistufige Anlage wie beim Einloesen einer Einladung.
    await tx.user.update({
      where: { id: neu.id },
      data: { path: pfadUnter(chef.path, neu.id) },
    });

    if (!mitEinladung) return { id: neu.id, code: null as string | null };

    // Die Einladung zeigt auf den Knoten: beim Einloesen entsteht KEIN
    // zweites Konto, sondern dieser hier bekommt Zugangsdaten.
    //
    // platzhalterAngelegt haelt fest, dass der Knoten mit dieser Einladung
    // entstanden ist. Nur so kann "Zurücknehmen" spaeter beides zuruecknehmen
    // statt einen Kasten "noch nicht eingeladen" stehen zu lassen.
    const code = neuerCode();
    await tx.invite.create({
      data: {
        code,
        leaderId: user.id,
        fuerId: neu.id,
        note: name,
        platzhalterAngelegt: true,
        expiresAt: ablaufDatum(),
      },
    });
    return { id: neu.id, code };
  });

  neuRechnen();
  revalidatePath("/team");
  return { id: angelegt.id, code: angelegt.code };
}

/**
 * Einladung fuer einen Platzhalter, der noch keine hat - oder dessen alte
 * abgelaufen ist.
 *
 * Getrennt vom Aufnehmen, weil beides getrennt passiert: erst traegt man
 * abends die Struktur ein, und Tage spaeter greift man zum Telefon.
 */
export async function einladungFuerPlatzhalter(formData: FormData) {
  const user = await requireUser();
  const fuerId = feld(formData, "fuerId");
  if (!fuerId) return { fehler: "Wen denn?" };
  if (!(await inMeinerStruktur(user.id, fuerId, user.role))) {
    return { fehler: "Diese Person liegt nicht in deiner Struktur." };
  }

  const ziel = await prisma.user.findUnique({
    where: { id: fuerId },
    select: { name: true, passwordHash: true, platzhalterEinladung: { select: { platzhalterAngelegt: true } } },
  });
  if (!ziel) return { fehler: "Person nicht gefunden." };
  // Wer schon ein Konto hat, braucht keine Einladung mehr - und bekommt ueber
  // diesen Weg auch keine, sonst waere es ein zweiter Zugang zu einem fremden,
  // bereits benutzten Konto.
  if (ziel.passwordHash) return { fehler: `${ziel.name} ist längst dabei.` };

  const code = neuerCode();
  // Ein neuer Link aendert nichts daran, WIE der Knoten entstanden ist: war er
  // von Anfang an nur der Traeger einer Einladung, bleibt er das auch nach dem
  // dritten Link - und faellt beim Zuruecknehmen mit.
  const angelegt = ziel.platzhalterEinladung?.platzhalterAngelegt ?? false;
  // Die alte Einladung weicht: ein Platzhalter hat hoechstens eine offene
  // (eindeutiger Index auf Invite.fuerId). Zwei Codes auf denselben Knoten
  // waeren zwei Wege in dasselbe Konto.
  await prisma.$transaction([
    prisma.invite.deleteMany({ where: { fuerId } }),
    prisma.invite.create({
      data: {
        code,
        leaderId: user.id,
        fuerId,
        note: ziel.name,
        platzhalterAngelegt: angelegt,
        expiresAt: ablaufDatum(),
      },
    }),
  ]);

  neuRechnen();
  return { code };
}
