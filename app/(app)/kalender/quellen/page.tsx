import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { verschluesselungBereit } from "@/lib/crypto";
import {
  btnPrimary,
  btnSecondary,
  btnGhost,
  card,
  columnNarrow,
  chip,
  flaeche,
  input,
  kicker,
  label,
  pageTitle,
  sectionTitle,
} from "@/components/ui";
import {
  auswahlLesen,
  kalenderSuchen,
  quelleAnlegen,
  quelleAktualisieren,
  quelleLoeschen,
} from "./actions";

export const dynamic = "force-dynamic";

// TimeTree hereinholen.
//
// Diese Seite muss vor allem eines leisten: ehrlich sein. Der Weg ist
// inoffiziell, das Passwort liegt umkehrbar verschluesselt in der Datenbank,
// und beides gehoert dorthin, wo es jemand liest - nicht in einen Kommentar
// im Quelltext. Deshalb steht der Kasten oben und nicht unten.

const zeitFormat = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Berlin",
});

export default async function QuellenPage({
  searchParams,
}: {
  searchParams: Promise<{ schritt?: string; fehler?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const quellen = await prisma.kalenderquelle.findMany({
    where: { ownerId: user.id },
    orderBy: { name: "asc" },
    include: { _count: { select: { termine: true } } },
  });

  const bereit = verschluesselungBereit();
  // Die Auswahl kommt aus dem kurzlebigen Cookie, nicht aus der Adresszeile -
  // dort haette die E-Mail-Adresse nichts verloren.
  const auswahl = params.schritt === "auswahl" ? await auswahlLesen() : null;

  return (
    <div className={`${columnNarrow} space-y-6`}>
      <div>
        <h1 className={pageTitle}>TimeTree hereinholen</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Damit stehen deine TimeTree-Termine im{" "}
          <Link href="/kalender" className="font-medium text-navy-600 hover:underline">
            Kalender
          </Link>{" "}
          — als Belegung, damit niemand in deine Zeit plant.
        </p>
      </div>

      {params.fehler && (
        <div className={`${flaeche("gefahr")} p-4 text-sm text-red-800`}>
          {params.fehler}
        </div>
      )}

      <section className={`${flaeche("warnung")} space-y-3 p-5`}>
        <h2 className="text-sm font-semibold text-amber-900">
          Was du dabei in Kauf nimmst
        </h2>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-amber-900/85">
          <li>
            <strong>Es gibt keine offizielle Schnittstelle mehr.</strong> TimeTree
            hat sie am 22.12.2023 abgeschaltet. Wir benutzen den Weg, den die
            TimeTree-Webseite selbst geht. Das kann jederzeit aufhören zu
            funktionieren — der Kalender läuft dann ohne, aber TimeTree fehlt.
          </li>
          <li>
            <strong>Dein TimeTree-Passwort liegt umkehrbar verschlüsselt bei uns.</strong>{" "}
            Nicht gehasht wie dein Zugang hier, denn wir müssen uns damit anmelden
            können. Wer Datenbank und Schlüssel hat, hat das Passwort. Nimm für
            TimeTree deshalb ein eigenes, das du nirgendwo sonst benutzt.
          </li>
          <li>
            <strong>Es geht nur mit E-Mail und Passwort.</strong> Wer sich bei
            TimeTree über Apple oder Google anmeldet, hat keins — für den
            funktioniert dieser Weg nicht.
          </li>
        </ul>
      </section>

      {!bereit && (
        <div className={`${flaeche("gefahr")} p-4 text-sm text-red-800`}>
          <strong className="font-semibold">KALENDER_SECRET fehlt.</strong> Ohne
          diese Einstellung lässt sich kein Zugang sicher ablegen. Erzeugen mit{" "}
          <code className="rounded bg-red-100 px-1 py-0.5 font-mono text-xs">
            node -e &quot;console.log(require(&apos;crypto&apos;).randomBytes(32).toString(&apos;base64&apos;))&quot;
          </code>{" "}
          und in der Umgebung setzen.
        </div>
      )}

      {quellen.length > 0 && (
        <section className="space-y-2">
          <h2 className={sectionTitle}>Angebunden</h2>
          {quellen.map((quelle) => (
            <div key={quelle.id} className={`${card} space-y-3 p-4`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">
                    {quelle.name}
                  </p>
                  <p className="truncate text-xs text-ink-muted">
                    {quelle.zugangUid} · {quelle._count.termine}{" "}
                    {quelle._count.termine === 1 ? "Termin" : "Termine"}
                    {quelle.letzterLauf
                      ? ` · zuletzt ${zeitFormat.format(quelle.letzterLauf)}`
                      : " · noch nicht geholt"}
                  </p>
                </div>
                <span className={chip(quelle.aktiv ? "erfolg" : "gefahr")}>
                  {quelle.aktiv ? "aktiv" : "stillgelegt"}
                </span>
              </div>

              {quelle.letzterFehler && (
                <div className="space-y-1.5 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">
                  <p>{quelle.letzterFehler}</p>
                  <p className="text-red-800/80">
                    {quelle.aktiv
                      ? `Fehllauf ${quelle.fehlerZaehler} von 3 in Folge — beim dritten wird die Quelle automatisch stillgelegt, damit TimeTree das Konto nicht sperrt.`
                      : "Nach drei Fehlläufen in Folge wurde die Quelle automatisch stillgelegt, damit TimeTree das Konto nicht sperrt. „Jetzt holen“ startet sie wieder."}
                  </p>
                  <p className="text-red-800/80">
                    Meldest du dich bei TimeTree über Apple oder Google an statt mit E-Mail
                    und Passwort, funktioniert diese Anbindung grundsätzlich nicht.
                  </p>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <form action={quelleAktualisieren}>
                  <input type="hidden" name="id" value={quelle.id} />
                  <button type="submit" className={btnSecondary}>
                    Jetzt holen
                  </button>
                </form>
                <form action={quelleLoeschen}>
                  <input type="hidden" name="id" value={quelle.id} />
                  <button type="submit" className={btnGhost}>
                    Entfernen
                  </button>
                </form>
              </div>
            </div>
          ))}
        </section>
      )}

      {auswahl ? (
        <section className={`${card} space-y-4 p-5`}>
          <h2 className={sectionTitle}>Welchen Kalender?</h2>
          <p className="text-sm text-ink-muted">
            Angemeldet als {auswahl.email}. Bitte das Passwort noch einmal
            eingeben — zwischen den beiden Schritten wird es nicht gespeichert.
          </p>
          <form action={quelleAnlegen} className="space-y-4">
            <input type="hidden" name="email" value={auswahl.email} />

            <fieldset>
              <legend className={label}>Kalender</legend>
              <div className="mt-2 space-y-2">
                {auswahl.kalender.map((kalender, i) => (
                  <label
                    key={kalender.id}
                    className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-line-strong bg-surface px-3.5 text-sm text-ink-muted transition has-[:checked]:border-navy-600 has-[:checked]:bg-navy-50"
                  >
                    <input
                      type="radio"
                      name="fremdId"
                      value={kalender.id}
                      defaultChecked={i === 0}
                      className="h-4 w-4"
                    />
                    {kalender.name}
                  </label>
                ))}
              </div>
            </fieldset>

            <div>
              <label className={label} htmlFor="name">
                Name im Kalender
              </label>
              <input
                id="name"
                name="name"
                type="text"
                defaultValue="TimeTree"
                className={input}
              />
            </div>

            <div>
              <label className={label} htmlFor="passwort2">
                TimeTree-Passwort
              </label>
              <input
                id="passwort2"
                name="passwort"
                type="password"
                autoComplete="off"
                required
                className={input}
              />
            </div>

            <div className="flex items-center gap-4">
              <button type="submit" className={btnPrimary} disabled={!bereit}>
                Anbinden
              </button>
              <Link href="/kalender/quellen" className={btnGhost}>
                Abbrechen
              </Link>
            </div>
          </form>
        </section>
      ) : (
        <section className={`${card} space-y-4 p-5`}>
          <h2 className={sectionTitle}>TimeTree anbinden</h2>
          <form action={kalenderSuchen} className="space-y-4">
            <div>
              <label className={label} htmlFor="email">
                TimeTree-E-Mail
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="off"
                required
                className={input}
              />
            </div>
            <div>
              <label className={label} htmlFor="passwort">
                TimeTree-Passwort
              </label>
              <input
                id="passwort"
                name="passwort"
                type="password"
                autoComplete="off"
                required
                className={input}
              />
            </div>
            <button type="submit" className={btnPrimary} disabled={!bereit}>
              Kalender suchen
            </button>
          </form>
        </section>
      )}

      <p className={kicker}>
        Der Weg zurück — deine CRM-Termine in TimeTree — läuft nicht hierüber,
        sondern über{" "}
        <Link href="/kalender/abo" className="font-medium text-navy-600 hover:underline">
          Kalender auf dem Handy
        </Link>
        . Der ist offiziell und bricht nicht.
      </p>
    </div>
  );
}
