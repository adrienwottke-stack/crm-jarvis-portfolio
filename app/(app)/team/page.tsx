import { headers } from "next/headers";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ebene, liegtImAst } from "@/lib/struktur";
import { btnPrimary, card, input, kicker, label, pageTitle, sectionTitle, columnWide, td, th } from "@/components/ui";
import KontoAktionen from "@/components/KontoAktionen";
import {
  beraterUmhaengen,
  einladungBrowserFreigabe,
  einladungErzeugen,
  einladungZuruecknehmen,
} from "./actions";

export const dynamic = "force-dynamic";

const createdFormat = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" });

const fehlertexte: Record<string, string> = {
  struktur: "Diese Änderung ist nicht möglich. Bitte prüfe die Angaben und lade die Struktur neu.",
  invalid: "Die Angabe konnte nicht gelesen werden.",
  sich_selbst_konto: "Das eigene Konto lässt sich hier nicht ändern.",
  sich_selbst: "Ein Berater kann nicht seine eigene Führungskraft sein.",
  unbekannt: "Konto nicht gefunden.",
  platzhalter:
    "Das ist ein Platzhalter ohne Zugangsdaten – da gibt es kein Passwort zurückzusetzen. Wer hier hinein soll, bekommt eine Einladung.",
  name_vergeben: "Diesen Namen trägt schon jemand anders in der Rangliste.",
};

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    moved?: string;
    invited?: string;
    revoked?: string;
    ausgetragen?: string;
    zurueck?: string;
    geloescht?: string;
    reset?: string;
    umbenannt?: string;
  }>;
}) {
  const admin = await requireAdmin();
  const [
    { error, moved, invited, revoked, ausgetragen, zurueck, geloescht, reset, umbenannt },
    kopfzeilen,
    users,
    invites,
  ] =
    await Promise.all([
      searchParams,
      headers(),
      prisma.user.findMany({
        // Nach Pfad sortiert steht der Baum von selbst richtig herum: jede
        // Führungskraft unmittelbar vor ihren Leuten.
        orderBy: { path: "asc" },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          path: true,
          leaderId: true,
          startedAt: true,
          createdAt: true,
          visibility: true,
          deactivatedAt: true,
          person: { select: { _count: { select: { dailyLogs: true } } } },
          _count: { select: { contacts: true, team: true } },
        },
      }),
      prisma.invite.findMany({
        // "Noch Platz" laesst sich nicht als Spaltenvergleich abfragen
        // (usedCount < maxUses) - deshalb grob vorfiltern und unten in
        // JavaScript nachschaerfen. Die Tabelle ist klein.
        where: { expiresAt: { gt: new Date() } },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          code: true,
          note: true,
          expiresAt: true,
          maxUses: true,
          usedCount: true,
          browserFreigabe: true,
          leader: { select: { name: true } },
        },
      }),
    ]);

  const nameById = new Map(users.map((user) => [user.id, user.name]));
  // Nachschaerfen: nur Einladungen mit Restplaetzen (maxUses NULL = unbegrenzt).
  const offeneInvites = invites.filter(
    (invite) => invite.maxUses === null || invite.usedCount < invite.maxUses
  );
  // Der Link muss vollstaendig dastehen, damit er sich weiterschicken laesst.
  const herkunft = `${kopfzeilen.get("x-forwarded-proto") ?? "http"}://${kopfzeilen.get("host") ?? ""}`;

  return (
    <div className={`${columnWide} space-y-8`}>
      <div>
        <h1 className={pageTitle}>Konten und Zugänge</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Wer Berater unter sich hat, ist Führungskraft – eine eigene Rolle dafür gibt es
          nicht. Eine Führungskraft sieht Zahlen und Pipeline, bei frisch Gestarteten
          30 Tage lang auch die Vornamen ihrer Kontakte. Notizen, Telefonnummern und
          E-Mail-Adressen sieht sie nie.
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
          {fehlertexte[error] ?? fehlertexte.invalid}
        </p>
      )}
      {moved && (
        <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Berater wurde umgehängt.
        </p>
      )}
      {invited && (
        <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Einladung erzeugt – der Link steht unten.
        </p>
      )}
      {revoked && (
        <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Einladung zurückgenommen.
        </p>
      )}
      {ausgetragen && (
        <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Konto ausgetragen. Es bleibt im Baum stehen und zählt nirgends mehr mit.
        </p>
      )}
      {zurueck && (
        <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Konto wieder aufgenommen.
        </p>
      )}
      {geloescht && (
        <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Konto gelöscht. Wer darunter hing, ist eine Ebene hochgerückt.
        </p>
      )}
      {umbenannt && (
        <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Name geändert.
        </p>
      )}

      {/* Der Reset-Link steht genau einmal da - danach ist er nur noch in der
          Nachricht, in der er verschickt wurde. */}
      {reset && (
        <section className={`${card} space-y-2 p-5`}>
          <p className="text-sm font-semibold text-ink">
            Link zum Passwort-Setzen
          </p>
          <code className="block break-all rounded-lg bg-sunken px-3 py-2 text-sm text-ink">
            {herkunft}/neues-passwort/{reset}
          </code>
          <p className={kicker}>
            Einen Tag gültig, einmal benutzbar. Schick ihn dem Betroffenen — er
            setzt sein Passwort selbst, du bekommst es nie zu sehen.
          </p>
        </section>
      )}

      <section className={`${card} space-y-5 p-6 sm:p-8`}>
        <div>
          <h2 className={sectionTitle}>Einladen</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Der Eingeladene setzt Name und Passwort selbst und hängt danach automatisch
            unter der gewählten Führungskraft. Ein Code, eine Nutzung, 14 Tage gültig.
            Der Willkommens-Ablauf führt ihn durch den ersten Tag.
          </p>
        </div>

        <form action={einladungErzeugen} className="grid gap-5 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div>
            <label htmlFor="inviteNote" className={label}>Notiz (nur für dich)</label>
            <input
              id="inviteNote"
              name="note"
              type="text"
              maxLength={80}
              placeholder="Max aus dem Infoabend"
              className={input}
            />
          </div>
          <div>
            <label htmlFor="inviteLeaderId" className={label}>Hängt unter</label>
            <select id="inviteLeaderId" name="leaderId" className={input} defaultValue="">
              <option value="">Mir selbst</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>{user.name}</option>
              ))}
            </select>
          </div>
          <button type="submit" className={btnPrimary}>Link erzeugen</button>
        </form>

        {offeneInvites.length > 0 && (
          <ul className="space-y-3 border-t border-line pt-5">
            {offeneInvites.map((invite) => (
              <li key={invite.id} className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <code className="block break-all text-sm font-medium text-ink">
                    {herkunft}/einladung/{invite.code}
                  </code>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    für {invite.leader.name}
                    {invite.note ? ` · ${invite.note}` : ""} · gültig bis{" "}
                    {createdFormat.format(invite.expiresAt)}
                    {invite.maxUses === null
                      ? ` · Mehrfach-Code, ${invite.usedCount}× eingelöst`
                      : invite.maxUses > 1
                        ? ` · ${invite.usedCount} von ${invite.maxUses} eingelöst`
                        : ""}
                    {invite.browserFreigabe ? " · ohne App-Pflicht" : ""}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  {/* Notausgang: nur anfassen, wenn ein Geraet die Installation
                      wirklich nicht schafft. Sonst bleibt die Schleuse zu. */}
                  <form action={einladungBrowserFreigabe}>
                    <input type="hidden" name="inviteId" value={invite.id} />
                    <input type="hidden" name="on" value={invite.browserFreigabe ? "0" : "1"} />
                    <button
                      type="submit"
                      className="min-h-11 rounded-lg px-3 text-xs font-medium text-ink-soft hover:bg-sunken hover:text-ink-muted"
                    >
                      {invite.browserFreigabe ? "App-Pflicht zurück" : "Ohne App erlauben"}
                    </button>
                  </form>
                  <form action={einladungZuruecknehmen}>
                    <input type="hidden" name="inviteId" value={invite.id} />
                    <button
                      type="submit"
                      className="min-h-11 rounded-lg px-3 text-sm font-medium text-ink-muted hover:bg-sunken hover:text-red-700"
                    >
                      Zurücknehmen
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={`${card} overflow-x-auto`}>
        <div className="p-6 pb-0 sm:p-8 sm:pb-0">
          <h2 className={sectionTitle}>Struktur ({users.length})</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Einrückung zeigt die Ebene. Umhängen schreibt den ganzen Ast mit.
          </p>
          {/* Der haeufigste Griff, der nicht selbsterklaerend ist: jemanden
              UEBER sich einhaengen. Die Reihenfolge macht lib/struktur.ts
              inzwischen selbst - hier steht nur noch, was dabei passiert. */}
          <p className="mt-2 rounded-lg bg-sunken px-3 py-2 text-sm text-ink-muted">
            <span className="font-medium text-ink">
              Jemanden über dir einhängen
            </span>{" "}
            (deine eigene Führungskraft): in deiner Zeile auswählen und{" "}
            <span className="font-medium">„Setzen“</span>. Hängt sie heute unter
            dir, rückt sie mitsamt ihrem Ast zuerst an deine Stelle — du und
            deine Leute hängen danach darunter.
          </p>
        </div>
        <table className="mt-4 w-full min-w-190 text-left text-sm">
          <thead className="border-y border-line/80 bg-sunken/60">
            <tr>
              <th className={th}>Name</th>
              <th className={th}>E-Mail</th>
              <th className={th}>Rolle</th>
              <th className={`${th} text-right`}>Eigene Kontakte</th>
              <th className={`${th} text-right`}>Ranglisten-Einträge</th>
              <th className={th}>Führungskraft</th>
              <th className={th}>Dabei seit</th>
              <th className={th}>Konto</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {users.map((user) => {
              // Kandidaten: alle ausser dem Berater selbst. Eigene Nachfahren
              // stehen bewusst mit drin - das ist der Fall "jemanden ueber sich
              // einhaengen", den lib/struktur.ts in zwei Zuegen aufloest. Blieben
              // sie draussen, haette die Wurzel des Baumes ueberhaupt keine
              // Auswahl: unter ihr haengen ja alle.
              const kandidaten = users.filter((kandidat) => kandidat.id !== user.id);
              return (
                <tr key={user.id} className="transition hover:bg-navy-50/40">
                  <td className={`${td} font-medium text-ink`}>
                    <span style={{ paddingLeft: `${ebene(user.path) * 16}px` }} className="inline-block">
                      {user.name}
                      {user._count.team > 0 && (
                        <span className="ml-2 rounded-full bg-navy-50 px-2 py-0.5 text-xs font-normal text-navy-700">
                          führt {user._count.team}
                        </span>
                      )}
                      {user.deactivatedAt && (
                        <span className="ml-2 text-xs font-normal text-ink-soft">ausgetreten</span>
                      )}
                    </span>
                  </td>
                  <td className={`${td} text-ink-muted`}>{user.email}</td>
                  <td className={td}>{user.role === "ADMIN" ? "Admin" : "Mitglied"}</td>
                  <td className={`${td} text-right tabular-nums text-ink-muted`}>{user._count.contacts}</td>
                  <td className={`${td} text-right tabular-nums text-ink-muted`}>{user.person?._count.dailyLogs ?? 0}</td>
                  <td className={td}>
                    <form action={beraterUmhaengen} className="flex items-center gap-2">
                      <input type="hidden" name="userId" value={user.id} />
                      <select
                        name="leaderId"
                        defaultValue={user.leaderId ?? ""}
                        aria-label={`Führungskraft von ${user.name}`}
                        className="min-h-11 rounded-xl border border-line bg-surface px-2 text-sm text-ink-muted"
                      >
                        <option value="">— keine (Wurzel)</option>
                        {kandidaten.map((kandidat) => (
                          <option key={kandidat.id} value={kandidat.id}>
                            {kandidat.name}
                            {/* Wer heute darunter haengt, rueckt beim Setzen
                                erst hoch. Das gehoert vor die Wahl, nicht
                                danach in eine Meldung. */}
                            {liegtImAst(kandidat.path, user.path) ? " (rückt dafür über ihn)" : ""}
                          </option>
                        ))}
                      </select>
                      <button
                        type="submit"
                        className="min-h-11 rounded-lg px-3 text-sm font-medium text-navy-700 hover:bg-navy-50"
                      >
                        Setzen
                      </button>
                    </form>
                    {user.leaderId && (
                      <span className="sr-only">{nameById.get(user.leaderId) ?? ""}</span>
                    )}
                  </td>
                  <td className={`${td} text-ink-muted`}>
                    {createdFormat.format(user.startedAt ?? user.createdAt)}
                  </td>
                  <td className={td}>
                    <KontoAktionen
                      userId={user.id}
                      name={user.name}
                      ausgetragen={user.deactivatedAt !== null}
                      kontakte={user._count.contacts}
                      gefuehrte={user._count.team}
                      istDu={user.id === admin.id}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
