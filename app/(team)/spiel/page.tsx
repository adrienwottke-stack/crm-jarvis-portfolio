import { requireUser, requireUserPerson } from "@/lib/auth";
import { ladeGesamtpunkte } from "@/lib/arena";
import { stufeVon, STUFEN } from "@/lib/stufen";
import { FREISCHALTBAR, istFrei } from "@/lib/freischaltung";
import { merkeNutzung, schalter } from "@/lib/features";
import WettbewerbNav from "@/components/WettbewerbNav";
import { LockIcon, TrophyIcon } from "@/components/icons";
import { btnGhost, card, kicker, pageTitle, sectionTitle } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function SpielPage() {
  const user = await requireUser();
  const person = await requireUserPerson(user.id);

  const an = await schalter("stufen", "spiel");
  const stand = stufeVon(await ladeGesamtpunkte(person.id));
  await merkeNutzung("spiel", person.id);

  return (
    <div className="space-y-8">
      <WettbewerbNav />

      <div>
        <h1 className={pageTitle}>Spiel</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Was du dir aufmachst, bleibt offen. Stufen fallen nie zurück — anders
          als die Wochentabelle.
        </p>
      </div>

      {/* --- Die eigene Stufe ------------------------------------------------ */}
      {an.stufen && (
        <div className={`${card} p-5`}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <span className={kicker}>Stufe {stand.stufe.nummer}</span>
              <p className="mt-1 text-2xl font-semibold tracking-[-0.02em] text-ink">
                {stand.stufe.name}
              </p>
            </div>
            <span className="text-sm tabular-nums text-ink-muted">
              {stand.gesamt} Punkte gesamt
            </span>
          </div>

          {/* Kein Fortschrittsbalken. "XP-Balken, Level" stehen in
              docs/wettbewerb-plan.md, Abschnitt 10, ausdruecklich auf der Liste
              dessen, was bewusst nicht gebaut wird - der Ton macht den Spass.
              Ein Satz mit einer konkreten Zahl sagt dasselbe und passt zum Rest
              des Werkzeugs. */}
          <p className="mt-3 text-sm text-ink-muted">
            {stand.naechste ? (
              <>
                Noch{" "}
                <span className="font-semibold tabular-nums">
                  {stand.bisNaechste}
                </span>{" "}
                {stand.bisNaechste === 1 ? "Punkt" : "Punkte"} bis{" "}
                <span className="font-semibold">{stand.naechste.name}</span>.
              </>
            ) : (
              "Höchste Stufe erreicht."
            )}
          </p>

          <ol className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3">
            {STUFEN.map((stufe) => (
              <li
                key={stufe.nummer}
                className={`text-xs tabular-nums ${
                  stufe.nummer <= stand.stufe.nummer
                    ? "font-semibold text-navy-800"
                    : "text-ink-soft"
                }`}
              >
                {stufe.name}
                <span className="ml-1 font-normal text-ink-soft">{stufe.ab}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* --- Die Kacheln ----------------------------------------------------- */}
      {an.spiel && (
        <section className="space-y-3">
          <h2 className={sectionTitle}>Freigeschaltet</h2>

          <ul className="grid gap-3 sm:grid-cols-2">
            {FREISCHALTBAR.map((eintrag) => {
              const offen = istFrei(eintrag, stand.stufe.nummer);
              const noetig = STUFEN.find((s) => s.nummer === eintrag.abStufe);
              const fehlt = noetig ? Math.max(0, noetig.ab - stand.gesamt) : 0;

              return (
                <li
                  key={eintrag.schluessel}
                  className={
                    offen
                      ? `${card} flex flex-col p-5`
                      : "flex flex-col rounded-2xl border border-dashed border-line-strong bg-sunken p-5"
                  }
                >
                  <span
                    className={`flex h-9 w-9 items-center justify-center rounded-full ${
                      offen
                        ? "bg-gold-100 text-gold-600"
                        : "border border-line-strong text-ink-soft"
                    }`}
                  >
                    {offen ? (
                      <TrophyIcon className="h-4.5 w-4.5" />
                    ) : (
                      <LockIcon className="h-4.5 w-4.5" />
                    )}
                  </span>

                  <p
                    className={`mt-3 text-base font-semibold ${
                      offen ? "text-ink" : "text-ink-soft"
                    }`}
                  >
                    {eintrag.name}
                  </p>
                  <p className="mt-1 flex-1 text-sm text-ink-muted">
                    {eintrag.beschreibung}
                  </p>

                  {offen ? (
                    <a
                      href={eintrag.url}
                      target={eintrag.extern ? "_blank" : undefined}
                      rel={eintrag.extern ? "noopener noreferrer" : undefined}
                      className={`${btnGhost} mt-4`}
                    >
                      Spielen
                    </a>
                  ) : (
                    <p className="mt-4 text-sm font-medium text-ink-soft">
                      Ab Stufe {eintrag.abStufe}
                      {noetig ? ` (${noetig.name})` : ""} — noch{" "}
                      <span className="tabular-nums">{fehlt}</span>{" "}
                      {fehlt === 1 ? "Punkt" : "Punkte"}.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>

          <p className="text-xs text-ink-muted">
            Storno ist eine eigene Liga: Punkte gehen von der Arbeit ins Spiel,
            nie zurück.
          </p>
        </section>
      )}
    </div>
  );
}
