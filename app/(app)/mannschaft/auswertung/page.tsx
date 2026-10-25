import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { berlinToday } from "@/lib/dates";
import { ladeTeamauswertung, type Berichtsfilter } from "@/lib/team-auswertung";
import Berichtsgruppe from "@/components/auswertung/Berichtsgruppe";
import Teamziele from "@/components/ziele/Teamziele";

export const dynamic = "force-dynamic";

const eingabe =
  "mt-2 min-h-12 w-full rounded-xl border border-line-strong bg-surface px-3 py-3 text-base text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-akzent";
const datum = (tag: string) =>
  new Intl.DateTimeFormat("de-DE", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${tag}T00:00:00Z`));

export default async function AuswertungPage({
  searchParams,
}: {
  searchParams: Promise<Berichtsfilter & { ansicht?: string }>;
}) {
  const user = await requireUser();
  const parameter = await searchParams;
  // Ein einziges natives Auswahlfeld hält die Bedienung am iPhone kurz.
  const filter = parameter.umfang?.startsWith("teilteam:")
    ? {
        ...parameter,
        umfang: "teilteam",
        teilteam: parameter.umfang.slice("teilteam:".length),
      }
    : parameter;
  const bericht = await ladeTeamauswertung(user, filter);
  if (!bericht) notFound();
  const meeting = parameter.ansicht === "meeting";
  const auswahl =
    bericht.umfang === "teilteam"
      ? `teilteam:${bericht.wurzel.id}`
      : bericht.umfang;
  const query = new URLSearchParams({
    zeit: bericht.zeit.art,
    tag: bericht.tag,
    umfang: bericht.umfang,
  });
  if (bericht.umfang === "teilteam") query.set("teilteam", bericht.wurzel.id);
  if (!meeting) query.set("ansicht", "meeting");
  const umfangLabel =
    bericht.umfang === "direkte"
      ? "Direkte Partner"
      : bericht.umfang === "teilteam"
        ? `Teilteam ${bericht.wurzel.name}`
        : "Gesamtes Team";

  return (
    <div
      className={`mx-auto w-full space-y-6 pb-8 ${meeting ? "max-w-6xl" : "max-w-4xl"}`}
    >
      <header>
        <Link
          href="/mannschaft"
          className="inline-flex min-h-11 items-center text-sm font-medium text-ink-muted hover:text-ink"
        >
          ← Team
        </Link>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          {meeting ? "Unser Teamstand" : "Auswertung"}
        </h1>
        <p className="mt-2 text-base text-ink-muted">
          {bericht.zeit.label} · {umfangLabel}
        </p>
        <p className="mt-1 text-sm text-ink-muted">
          Stand {datum(bericht.stand)}
        </p>
      </header>


      {!meeting && (
        <form
          action="/mannschaft/auswertung"
          method="get"
          className="rounded-2xl border border-line bg-surface p-5"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-ink">
              Zeitraum
              <select
                name="zeit"
                defaultValue={bericht.zeit.art}
                className={eingabe}
              >
                <option value="woche">Woche</option>
                <option value="monat">Monat</option>
                <option value="quartal">Quartal</option>
                <option value="jahr">Jahr</option>
              </select>
            </label>
            <label className="text-sm font-medium text-ink">
              Datum im Zeitraum
              <input
                type="date"
                name="tag"
                defaultValue={bericht.tag}
                max={berlinToday()}
                className={`${eingabe} min-w-0`}
              />
            </label>
          </div>
          <label className="mt-4 block text-sm font-medium text-ink">
            Teamumfang
            <select name="umfang" defaultValue={auswahl} className={eingabe}>
              <option value="struktur">Gesamtes Team</option>
              <option value="direkte">Direkte Partner</option>
              {bericht.teilteams.length > 0 && (
                <optgroup label="Teilteam auswählen">
                  {bericht.teilteams.map((team) => (
                    <option key={team.id} value={`teilteam:${team.id}`}>
                      {team.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          <button
            className="mt-5 min-h-12 w-full rounded-xl bg-akzent px-5 py-3 font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-akzent sm:w-auto"
            type="submit"
          >
            Auswertung anzeigen
          </button>
        </form>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">
          Eigenleistung und Teamleistung getrennt
        </p>
        <Link
          href={`/mannschaft/auswertung?${query}`}
          className="inline-flex min-h-11 items-center rounded-xl border border-line-strong bg-surface px-4 py-2 text-sm font-medium text-ink"
        >
          {meeting ? "Filter bearbeiten" : "Teammeeting öffnen"}
        </Link>
      </div>

      {bericht.team.konten === 0 ? (
        <section className="rounded-2xl border border-line bg-surface p-6">
          <h2 className="text-lg font-semibold text-ink">
            Hier ist noch kein aktives Team.
          </h2>
          <p className="mt-2 text-sm text-ink-muted">
            Sobald ein eigener Partner seinen Zugang aktiviert hat, erscheinen
            hier seine Teamzahlen. Die Eigenleistung steht darunter.
          </p>
          {!meeting && bericht.wurzel.istDu && (
            <Link
              href="/einladen"
              className="mt-4 inline-flex min-h-11 items-center font-medium text-link"
            >
              Partner einladen →
            </Link>
          )}
        </section>
      ) : (
        <Berichtsgruppe
          id="team"
          titel={
            bericht.umfang === "direkte" ? "Direkte Partner" : "Teamleistung"
          }
          gruppe={bericht.team}
          meeting={meeting}
        />
      )}

      {bericht.umfang !== "direkte" && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">
            Teamziele am gewählten Stichtag
          </h2>
          <Teamziele
            userId={user.id}
            wurzelId={bericht.wurzel.id}
            tag={bericht.stand}
          />
        </section>
      )}

      <Berichtsgruppe
        id="eigen"
        titel={
          bericht.wurzel.istDu
            ? "Meine Eigenleistung"
            : `Eigenleistung · ${bericht.wurzel.name}`
        }
        gruppe={bericht.eigen}
        meeting={meeting}
      />

      <aside className="rounded-2xl bg-sunken p-5 text-sm leading-relaxed text-ink-muted">
        <h2 className="font-semibold text-ink">Aktuelle Teamzuordnung</h2>
        <p className="mt-2">
          Der Bericht ordnet alle Buchungen der heutigen Struktur zu. Frühere
          Teamzugehörigkeiten werden nicht rekonstruiert. Die Teamleistung
          enthält jeden aktiven Partner einmal; die Eigenleistung der
          betrachteten Person ist separat.
        </p>
        <p className="mt-2">
          Kurven enthalten datierte Buchungen und Korrekturen bis zum
          angezeigten Stand. Undatierte Startbestände gehören ausschließlich zur
          separat beschrifteten Gesamtsumme bis heute. Alle Zeiträume folgen dem
          Berliner Kalender.
        </p>
      </aside>
    </div>
  );
}
