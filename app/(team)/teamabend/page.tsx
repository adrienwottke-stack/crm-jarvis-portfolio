import { requireUser, requireUserPerson } from "@/lib/auth";
import { berlinToday, dayToUtcDate, startOfWeek } from "@/lib/dates";
import { ladePuls, ladeRangliste } from "@/lib/arena";
import { ladeFeed } from "@/lib/feed";
import { ladeTitelStaende } from "@/lib/titel";
import {
  aktiveKonten,
  indexkurveFuer,
  produktionsmonat,
} from "@/lib/einheiten";
import { istAn, merkeNutzung } from "@/lib/features";
import IndexKurve from "@/components/IndexKurve";
import LeerZustand from "@/components/LeerZustand";
import { MonitorIcon } from "@/components/icons";
import { card, cn, kicker } from "@/components/ui";

export const dynamic = "force-dynamic";

// Der eine Bildschirm fuer den woechentlichen Teamtermin (Beamer oder ein
// herumgereichtes Handy) - siehe docs/emil-feedback-plan.md, Multiplikations-
// Runde vom 29.08.2026.
//
// ZUM ZEIGEN, NICHT ZUM BEDIENEN: kein Postfach, kein Zweikampf, kein
// Sprint-Startknopf, kein eigener Hinweis ("du wurdest ueberholt") und keine
// lastRank-Schreiblogik - all das haengt an EINER Person vor dem Bildschirm,
// hier steht aber die ganze Runde davor. Wer etwas bedienen will, geht auf
// /arena.
//
// Grosse, aber bestehende Textklassen statt eigenem Zoom-Code: die Karten
// sind dieselben wie in der Arena, nur mit mehr Schriftgroesse - kein
// Sonderlayout, das getrennt gepflegt werden muesste.

const vollDatumFormat = new Intl.DateTimeFormat("de-DE", {
  weekday: "long",
  day: "2-digit",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const zeitFormat = new Intl.DateTimeFormat("de-DE", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Berlin",
});

function vorMinuten(at: Date): string {
  const min = Math.floor((Date.now() - at.getTime()) / 60_000);
  if (min < 1) return "gerade eben";
  if (min < 60) return `vor ${min} Min.`;
  return `${zeitFormat.format(at)} Uhr`;
}

const blockTitel = "text-xl font-semibold tracking-tight text-ink sm:text-2xl";

export default async function TeamabendPage() {
  const user = await requireUser();
  const person = await requireUserPerson(user.id);

  const an = await istAn("teamabend");
  if (!an) {
    return (
      <div className="space-y-6">
        <span className={kicker}>Netzwerkabend</span>
        <LeerZustand
          symbol={<MonitorIcon className="h-6 w-6" />}
          titel="Netzwerkabend ist gerade abgeschaltet"
          text="Dieser Bildschirm ist derzeit aus. Die Werkstatt schaltet ihn wieder an."
        />
      </div>
    );
  }

  const heute = berlinToday();
  const wochenStart = startOfWeek(heute);
  const monatStart = produktionsmonat(heute).start.toISOString().slice(0, 10);

  const [zeilen, puls, titel, feed, ids] = await Promise.all([
    ladeRangliste(wochenStart),
    ladePuls(),
    ladeTitelStaende(heute),
    ladeFeed(person.id),
    aktiveKonten(),
  ]);
  const punkte = await indexkurveFuer(ids, heute);

  await merkeNutzung("teamabend", person.id);

  const top3 = zeilen.slice(0, 3);
  const feedZeilen = feed.slice(0, 5);

  return (
    <div className="space-y-8">
      {/* --- Kopf: Kicker + Datum, gross genug fuer den Beamer -------------- */}
      <div>
        <span className={kicker}>Netzwerkabend</span>
        <h1 className="mt-1 text-5xl font-bold leading-[1.1] tracking-tight text-ink sm:text-6xl">
          {vollDatumFormat.format(dayToUtcDate(heute))}
        </h1>
      </div>

      <p className="text-base text-ink-muted">
        Gemeinsamer Wettbewerb und geteilte Erfolge im gesamten Netzwerk. Die
        Auswertung deines Teams findest du unter Team → Auswertung.
      </p>

      {/* --- Titel: mehrere Wege, vorn zu sein - hier ohne "dein Titel",
          es geht um die Woche des Teams, nicht um die Person davor. -------- */}
      <div className={`${card} p-6`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className={blockTitel}>Titel dieser Woche</h2>
          <span className={kicker}>Stand jetzt</span>
        </div>
        <p className="mt-2 text-base text-ink-muted">
          Punkte belohnen Menge. Titel belohnen Können — vorn sein geht auch
          ohne die meisten Punkte.
        </p>

        <ul className="mt-5 space-y-4">
          {titel.map((stand) => (
            <li
              key={stand.schluessel}
              className="border-t border-line pt-4 first:border-0 first:pt-0"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="text-lg font-semibold text-ink">
                  {stand.titel}
                </span>
                {stand.haelter ? (
                  <span className="text-lg text-ink-muted">
                    {stand.haelter.name}{" "}
                    <span className="tabular-nums text-ink-soft">
                      {stand.haelter.wert}
                    </span>
                  </span>
                ) : (
                  <span className="text-sm font-semibold uppercase tracking-wider text-ink-soft">
                    noch frei
                  </span>
                )}
              </div>
              <p className="mt-1 text-base text-ink-muted">
                {stand.haelter ? stand.sagt : stand.offenWeil}
              </p>
            </li>
          ))}
        </ul>
      </div>

      {/* --- Team-Indexkurve: der Proof nach aussen, ohne Absolutwerte ------ */}
      <IndexKurve
        punkte={punkte}
        heute={heute}
        monatStart={monatStart}
        ueberschrift="Team-Kurve"
        startZeitraum="gesamt"
      />

      {/* --- Puls: wer heute schon dran war ---------------------------------- */}
      <div className={`${card} p-6`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-lg font-medium text-ink">
            Heute schon dran: {puls.aktiv} von {puls.koepfe}
          </p>
          <span className={kicker}>Puls</span>
        </div>
        {puls.zuletzt.length > 0 && (
          <ul className="mt-4 space-y-2">
            {puls.zuletzt.map((eintrag) => (
              <li key={eintrag.name} className="flex justify-between text-base">
                <span className="text-ink-muted">{eintrag.name}</span>
                <span className="text-sm text-ink-soft">
                  {vorMinuten(eintrag.at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* --- Top 3 der Rangliste, kompakt - Gold nur fuer Platz 1, wie auf
          /leaderboard --------------------------------------------------- */}
      {top3.length > 0 && (
        <div className={`${card} p-6`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className={blockTitel}>Rangliste — Top 3</h2>
            <span className={kicker}>Diese Woche</span>
          </div>
          <ul className="mt-5 divide-y divide-line">
            {top3.map((zeile, index) => (
              <li
                key={zeile.personId}
                className={cn(
                  "flex items-center justify-between gap-4 rounded-xl px-3 py-3",
                  index === 0 && "bg-gold-100/30",
                )}
              >
                <span className="flex items-baseline gap-3">
                  <span
                    className={cn(
                      "w-6 text-lg font-semibold tabular-nums",
                      index === 0 ? "text-gold-600" : "text-ink-soft",
                    )}
                  >
                    {index + 1}
                  </span>
                  <span
                    className={cn(
                      "text-lg font-semibold",
                      index === 0 ? "text-gold-600" : "text-ink",
                    )}
                  >
                    {zeile.name}
                  </span>
                </span>
                <span
                  className={cn(
                    "text-lg font-semibold tabular-nums",
                    index === 0 ? "text-gold-600" : "text-ink",
                  )}
                >
                  {zeile.punkte}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* --- Die letzten Feed-Meldungen, schlicht: Text + Zeit-Tag, keine
          Reaktionsknoepfe - hier drueckt niemand live mit ------------------ */}
      {feedZeilen.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className={blockTitel}>Geschafft</h2>
            <span className={kicker}>Netzwerk</span>
          </div>
          <ul className="space-y-3">
            {feedZeilen.map((zeile) => (
              <li
                key={zeile.id}
                className={`${card} flex flex-wrap items-baseline justify-between gap-2 p-4`}
              >
                <p className="text-base text-ink">
                  <span className="font-semibold">{zeile.name}</span>{" "}
                  {zeile.text.charAt(0).toLowerCase() + zeile.text.slice(1)}
                </p>
                <span className="text-sm text-ink-soft">
                  {vorMinuten(zeile.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
