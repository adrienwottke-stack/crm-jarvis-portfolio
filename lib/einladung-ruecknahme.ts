// Eine Einladung zuruecknehmen - und den Platz in der Struktur mit ihr.
//
// Der Fall, um den es geht: jemand nimmt ueber "Person aufnehmen" einen Namen
// auf und laesst den Einladungslink gleich miterzeugen. Der Knoten steht ab
// diesem Moment im Organigramm. Nimmt er die Einladung danach zurueck, war das
// bis hierhin nur die halbe Ruecknahme: der Code war weg, der Kasten blieb -
// "noch nicht eingeladen", dauerhaft, und ohne Admin-Rechte nicht mehr
// wegzubekommen.
//
// Zurueckgenommen wird deshalb beides, aber nur unter drei Bedingungen:
//
//   1. Der Platzhalter ist MIT dieser Einladung entstanden
//      (Invite.platzhalterAngelegt). Wer die Struktur abends eintraegt und
//      Tage spaeter einlaedt, hat den Knoten unabhaengig von der Einladung
//      gewollt - der bleibt stehen.
//   2. Es haengt niemand darunter. User.leaderId loest beim Loeschen auf NULL
//      auf; ein Ast unter einem geloeschten Knoten wuerde zu lauter Wurzeln
//      zerfallen und aus jeder Sichtbarkeitsabfrage fallen.
//   3. Das Konto ist noch keins. passwordHash NULL ist die Definition des
//      Platzhalters - derselbe Riegel wie beim Einloesen.
//
// Trifft eine davon nicht zu, faellt nur die Einladung. Der Knoten bleibt, und
// der Aufrufer erfaehrt es am Rueckgabewert.

import { prisma } from "@/lib/prisma";

export type Ruecknahme = {
  /** Gab es die Einladung ueberhaupt (offen und in der eigenen Zustaendigkeit)? */
  zurueckgenommen: boolean;
  /** Ist der Platzhalter dabei aus der Struktur verschwunden? */
  knotenEntfernt: boolean;
};

/**
 * @param inviteId Die Einladung.
 * @param leaderId Gesetzt: nur die eigene Einladung. Weggelassen: Admin-Weg.
 */
export async function einladungZurueck(
  inviteId: string,
  leaderId?: string
): Promise<Ruecknahme> {
  // Eingeloeste Einladungen bleiben unangetastet - eine davon zu loeschen
  // wuerde die Herkunft eines echten Kontos verwischen.
  const invite = await prisma.invite.findFirst({
    where: { id: inviteId, usedCount: 0, ...(leaderId ? { leaderId } : {}) },
    select: { id: true, fuerId: true, platzhalterAngelegt: true },
  });
  if (!invite) return { zurueckgenommen: false, knotenEntfernt: false };

  const knoten =
    invite.fuerId && invite.platzhalterAngelegt
      ? await prisma.user.findFirst({
          where: {
            id: invite.fuerId,
            passwordHash: null,
            team: { none: {} },
          },
          select: { id: true },
        })
      : null;

  if (knoten) {
    // Die Einladung faellt per Fremdschluessel mit (Invite.fuerId steht auf
    // ON DELETE CASCADE), Aufgaben und Nachrichten ebenso. Ein Person-Profil
    // oder Kontakte kann ein Platzhalter nicht haben: beides entsteht erst
    // beim Einloesen.
    //
    // Auch keine AVV-Zustimmung, deshalb braucht dieser Weg - anders als
    // benutzerLoeschen in app/(app)/team/actions.ts - keine Freigabe gegen den
    // Unveraenderlichkeits-Trigger: zustimmen kann nur, wer angemeldet ist,
    // und ohne passwordHash kommt niemand hinein.
    await prisma.user.delete({ where: { id: knoten.id } });
    return { zurueckgenommen: true, knotenEntfernt: true };
  }

  await prisma.invite.deleteMany({ where: { id: invite.id, usedCount: 0 } });
  return { zurueckgenommen: true, knotenEntfernt: false };
}
