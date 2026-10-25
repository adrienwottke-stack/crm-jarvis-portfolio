import type { VereinbarungAnzeige } from "@/lib/vereinbarungen";
import { vereinbarungStatusTexte } from "@/lib/vereinbarungen-regeln";
import VereinbarungsAktionen from "./VereinbarungsAktionen";
import VereinbarungsEditor from "./VereinbarungsEditor";

const datum = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "medium",
  timeZone: "Europe/Berlin",
});
const zeit = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Berlin",
});

export default function VereinbarungsKarte({
  stand,
  userId,
  kompakt = false,
}: {
  stand: VereinbarungAnzeige;
  userId: string;
  kompakt?: boolean;
}) {
  const offen =
    stand.status === "VORGESCHLAGEN" || stand.status === "BESTAETIGT";
  return (
    <article id={`vereinbarung-${stand.id}`} className="space-y-4 rounded-2xl border border-slate-200 bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-base font-semibold text-slate-700">
          Mit {stand.partner.name}
        </p>
        <span className="text-sm font-medium text-navy-800">
          {vereinbarungStatusTexte[stand.status]}
        </span>
      </div>
      <h3 className="whitespace-pre-wrap break-words text-xl font-semibold leading-snug text-slate-900">
        {stand.titel}
      </h3>
      <p className="text-base text-slate-700">
        {stand.art === "TERMIN"
          ? zeit.format(stand.faelligAm)
          : `Bis ${datum.format(stand.faelligAm)}`}
        {stand.endetAm ? ` bis ${zeit.format(stand.endetAm)}` : ""}
        <br />
        Verantwortlich: {stand.verantwortlichName}
      </p>
      {stand.status === "VORGESCHLAGEN" && (
        <p className="text-base text-slate-600">
          {stand.vorgeschlagenVonId === userId
            ? "Dein Gegenüber prüft diesen Vorschlag."
            : "Prüfe den Vorschlag. Eine Änderung muss dein Gegenüber erneut bestätigen."}
        </p>
      )}
      <VereinbarungsAktionen
        id={stand.id}
        version={stand.version}
        status={stand.status}
        darfBestaetigen={stand.vorgeschlagenVonId !== userId}
      />
      {!kompakt && offen && (
        <VereinbarungsEditor
          userId={userId}
          partner={stand.partner}
          stand={stand}
        />
      )}
      {!kompakt && (
        <details className="border-t border-slate-200 pt-3">
          <summary className="min-h-11 cursor-pointer py-2 text-base font-medium text-slate-700">
            Verlauf der Absprache ({stand.verlauf.length})
          </summary>
          <ol className="mt-3 space-y-4">
            {stand.verlauf.map((eintrag) => {
              const snapshot =
                eintrag.stand &&
                typeof eintrag.stand === "object" &&
                !Array.isArray(eintrag.stand)
                  ? eintrag.stand
                  : {};
              const faellig =
                typeof snapshot.faelligAm === "string"
                  ? new Date(snapshot.faelligAm)
                  : null;
              return (
                <li
                  key={eintrag.version}
                  className="border-l-2 border-slate-200 pl-4 text-base text-slate-700"
                >
                  <p className="font-medium">
                    {eintrag.aktion} · {eintrag.akteur}
                  </p>
                  <p className="text-sm">
                    {zeit.format(eintrag.createdAt)} · Version {eintrag.version}
                  </p>
                  {typeof snapshot.titel === "string" && (
                    <p className="mt-1 whitespace-pre-wrap break-words">
                      {snapshot.titel}
                    </p>
                  )}
                  {faellig && !Number.isNaN(faellig.getTime()) && (
                    <p className="text-sm">
                      {snapshot.art === "TERMIN" ? "Termin" : "Fällig"}:{" "}
                      {snapshot.art === "TERMIN"
                        ? zeit.format(faellig)
                        : datum.format(faellig)}
                    </p>
                  )}
                  {typeof snapshot.verantwortlicherId === "string" && (
                    <p className="text-sm">
                      Verantwortlich:{" "}
                      {snapshot.verantwortlicherId === userId
                        ? "Du"
                        : stand.partner.name}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        </details>
      )}
    </article>
  );
}
