import Link from "next/link";
import PersonLink from "@/components/PersonLink";
import { letzteSchritte, naechsteSchritte } from "@/lib/einblick";
import { ladeVereinbarungen } from "@/lib/vereinbarungen";
import { ladeZiele } from "@/lib/ziele";
import type { Mannschaftsperson } from "@/lib/fuehrung";
import Fortschritt from "@/components/Fortschritt";
import GpName from "@/components/GpName";
import VorfuehrVerdeckt from "@/components/VorfuehrVerdeckt";
import NachrichtSenden from "@/components/NachrichtSenden";
import { ladeBegleitung } from "@/lib/begleitung";

const datum = new Intl.DateTimeFormat("de-DE", {
  day: "numeric",
  month: "short",
  timeZone: "Europe/Berlin",
});
export default async function PartnerBegleitung({
  userId,
  personen,
  struktur = personen,
  limit,
  kompakt = false,
  alleHref = "/mannschaft",
}: {
  userId: string;
  personen: Mannschaftsperson[];
  struktur?: Mannschaftsperson[];
  limit?: number;
  kompakt?: boolean;
  alleHref?: string;
}) {
  const aktive = personen.filter((p) => !p.platzhalter && !p.ausgetreten);
  const auswahl = limit ? aktive.slice(0, limit) : aktive;
  const offeneIds = auswahl.filter((p) => p.einblick.offen).map((p) => p.id);
  const [zuletzt, naechstes, absprachen, ziele] = await Promise.all([
    letzteSchritte(offeneIds),
    naechsteSchritte(offeneIds),
    ladeVereinbarungen(userId),
    ladeZiele(userId),
  ]);
  const ersteRunden = new Map(
    await Promise.all(
      auswahl
        .filter((p) => p.einblick.grund === "startfenster")
        .map(async (p) => [p.id, await ladeBegleitung(p.id)] as const),
    ),
  );
  return (
    <div className={kompakt ? "space-y-2" : "space-y-3"}>
      <div className={kompakt ? "crm-team-partner-list" : "space-y-3"}>
      {auswahl.map((person) => {
        const letzter = zuletzt.get(person.id);
        const naechster = naechstes.get(person.id);
        const absprache = absprachen.find(
          (a) =>
            a.partner.id === person.id &&
            ["VORGESCHLAGEN", "BESTAETIGT"].includes(a.status),
        );
        const ziel = ziele.find((z) => z.inhaberId === person.id && z.aktiv);
        const team =
          person.path === "/"
            ? []
            : struktur.filter(
                (p) =>
                  p.id !== person.id &&
                  p.path.startsWith(person.path) &&
                  !p.platzhalter &&
                  !p.ausgetreten,
              );
        const teamAnrufe = team.reduce(
          (summe, p) => summe + p.werte.anrufeWoche,
          0,
        );
        const teamTermine = team.reduce(
          (summe, p) => summe + p.werte.vereinbartWoche,
          0,
        );
        const runde = ersteRunden.get(person.id);
        const einstieg = runde?.find((s) => !s.fertig);
        return (
          <article
            key={person.id}
            className={kompakt ? "crm-team-partner-row" : "rounded-[10px] border border-line bg-surface p-5"}
          >
            <div className="crm-team-partner-heading">
            <PersonLink
              href={`/mannschaft/${person.id}`}
              className={kompakt ? "crm-team-partner-name" : "inline-flex min-h-11 items-center text-xl font-semibold"}
            >
              <GpName name={person.name} />{" "}
              <span className="ml-3 text-link">→</span>
            </PersonLink>
            {kompakt && person.fuehrt > 0 && <span className="crm-team-partner-status">Führt {person.fuehrt}</span>}
            </div>
            {kompakt && (
              <VorfuehrVerdeckt hinweis="Persönliche Begleitung wird beim Vorführen ausgeblendet.">
                <p className="crm-team-partner-next">
                  {absprache ? (
                    <Link href={`/mannschaft/vereinbarungen?partner=${person.id}`}>
                      {absprache.titel} · {datum.format(absprache.faelligAm)}{absprache.status === "VORGESCHLAGEN" ? " · Bestätigung offen" : ""}
                    </Link>
                  ) : person.betreuung ? (
                    <>Nachfassen am {datum.format(person.betreuung.faelligAm)} · {person.signale[0]?.titel ?? "Gemeinsamer Schritt"}</>
                  ) : !person.angekommen ? (
                    "Einstieg gemeinsam fortsetzen"
                  ) : naechster ? (
                    `${naechster.istTermin ? "Termin" : naechster.art === "ANRUF" ? "Anruf" : "Kontaktschritt"} · ${datum.format(naechster.wann)}`
                  ) : (
                    person.signale[0]?.titel ?? "Nächsten gemeinsamen Schritt besprechen"
                  )}
                </p>
              </VorfuehrVerdeckt>
            )}
            <details className={kompakt ? "crm-team-partner-details" : "crm-team-partner-details-full"} open={kompakt ? undefined : true}>
              <summary hidden={!kompakt} aria-label="Begleitung und Aktionen anzeigen">Details</summary>
            <VorfuehrVerdeckt hinweis="Persönliche Begleitung wird beim Vorführen ausgeblendet.">
              <div className={kompakt ? "crm-team-partner-detail-body" : undefined}>
              <dl className="mt-2 space-y-2 text-sm">
                <div>
                  <dt className="text-ink-muted">Zuletzt passiert</dt>
                  <dd>
                    {letzter
                      ? `${letzter.was} · ${datum.format(letzter.wann)}`
                      : person.werte.letzteAktivitaet
                        ? `Aktivität eingetragen · ${datum.format(person.werte.letzteAktivitaet)}`
                        : "Noch kein Eintrag"}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-muted">Gemeinsam vereinbart</dt>
                  <dd>
                    {absprache ? (
                      <Link
                        href={`/mannschaft/vereinbarungen?partner=${person.id}`}
                        className="text-link"
                      >
                        {absprache.titel} · {datum.format(absprache.faelligAm)}
                        {absprache.status === "VORGESCHLAGEN"
                          ? " · Bestätigung offen"
                          : ""}
                      </Link>
                    ) : (
                      "Noch keine offene gemeinsame Absprache"
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-muted">Als Nächstes dran</dt>
                  <dd>
                    {!person.angekommen
                      ? "Einstieg gemeinsam fortsetzen"
                      : naechster
                        ? `${naechster.istTermin ? "Termin" : naechster.art === "ANRUF" ? "Anruf" : "Kontaktschritt"} · ${datum.format(naechster.wann)}`
                        : person.werte.naechsterSchritt &&
                            person.pipelineSichtbar
                          ? `Nächster Kontaktschritt · ${datum.format(person.werte.naechsterSchritt)}`
                          : "Nächsten gemeinsamen Schritt besprechen"}
                  </dd>
                </div>
              </dl>
              {ziel && (
                <div className="mt-3 space-y-2">
                  <p className="text-sm">
                    {ziel.titel}: {ziel.standText} {ziel.kennzahlText}
                  </p>
                  <Fortschritt
                    anteil={ziel.anteil}
                    beschriftung={ziel.standText}
                  />
                </div>
              )}
              {runde && einstieg && (
                <p className="mt-3 text-sm text-ink-muted">
                  Erste Runde: {runde.filter((s) => s.fertig).length} von{" "}
                  {runde.length} Schritten geschafft
                </p>
              )}
              {einstieg && (
                <p className="mt-1 text-sm">
                  Nächster Einstiegsschritt: {einstieg.titel}
                </p>
              )}
              {team.length > 0 && (
                <div className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
                  <p className="text-ink-muted">Diese Woche · aktive Partner</p>
                  <p>
                    Eigenleistung: {person.werte.anrufeWoche} Anrufversuche ·{" "}
                    {person.werte.vereinbartWoche} vereinbarte Termine
                  </p>
                  <p>
                    Teamleistung ({team.length}): {teamAnrufe} Anrufversuche ·{" "}
                    {teamTermine} vereinbarte Termine
                  </p>
                  <Link
                    href={`/mannschaft/auswertung?teilteam=${person.id}&umfang=teilteam&zeit=woche`}
                    className="inline-flex min-h-11 items-center text-link"
                  >
                    Teilteam auswerten →
                  </Link>
                </div>
              )}
              {person.signale[0] && (
                <p className="mt-3 text-sm font-medium">
                  {person.signale[0].titel}
                </p>
              )}
              <p className="mt-1 text-sm text-ink-muted">
                {person.signale[0]?.schritt ??
                  "Nachfragen, was als Nächstes hilft, und Erfolge gemeinsam würdigen."}
              </p>
              <div className="mt-2 flex flex-wrap gap-x-5">
                <Link
                  href={`/mannschaft/vereinbarungen?partner=${person.id}`}
                  className="inline-flex min-h-11 items-center text-sm font-medium text-link"
                >
                  Absprache ansehen
                </Link>
                {!ziel && (
                  <Link
                    href={`/fortschritt/neu?partner=${person.id}`}
                    className="inline-flex min-h-11 items-center text-sm font-medium text-link"
                  >
                    Ziel vorschlagen
                  </Link>
                )}
                <NachrichtSenden
                  anId={person.id}
                  name={person.name}
                  variante="knopf"
                />
              </div>
              </div>
            </VorfuehrVerdeckt>
            </details>
          </article>
        );
      })}
      </div>
      {limit && aktive.length > limit && (
        <Link
          href={alleHref}
          className="inline-flex min-h-11 items-center font-medium text-link"
        >
          Alle {aktive.length} Partner ansehen →
        </Link>
      )}
    </div>
  );
}
