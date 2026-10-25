import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { berlinToday, dayToUtcDate, shiftDay } from "@/lib/dates";
import {
  btnSecondary,
  card,
  cardInteractive,
  chip,
  cn,
  inputBlank,
  kicker,
  pageTitle,
  sectionTitle,
  td,
  th,
  type Ton,
} from "@/components/ui";
import { BellIcon, MegafonIcon } from "@/components/icons";
import { OFFENE_STAENDE } from "@/lib/rueckmeldung";
import {
  KARRIERESTUFE_MAX,
  KARRIERESTUFE_MIN,
  alleSchwellen,
  fokusProzentsatz,
  formatEinheiten,
} from "@/lib/einheiten";
import { einstellungenStehen } from "@/lib/einstellungen";
import { AMPEL_FELDER, ampelAnzeigewert, ampelKriterien } from "@/lib/ampelKriterien";
import {
  ampelKriterienSpeichern,
  fokusProzentsatzSpeichern,
  schalten,
  schwellenSpeichern,
} from "./actions";

export const dynamic = "force-dynamic";

// Der Pruefstand. Bewusst nur fuer den Admin: Produktarbeit gehoert nicht in
// den Alltag eines Partners - der soll Termine machen, nicht Software
// verwalten.
//
// Eine Frage an jeden Baustein: benutzt ihn ueberhaupt jemand? Die Abstimmung
// ("Taugt das?") stand frueher an jedem Block der Arena und ist raus
// (docs/audit-kernmodell.md, 5.14). Nutzung schlaegt Stimmen ohnehin - was
// keiner anfasst, kann noch so gut gefallen.

const standTexte: Record<string, string> = {
  TEST: "Test",
  LAEUFT: "Läuft",
  AUS: "Abgeschaltet",
  ABGERISSEN: "Abgerissen",
};

const standTon: Record<string, Ton> = {
  TEST: "info",
  LAEUFT: "erfolg",
  AUS: "neutral",
  ABGERISSEN: "neutral",
};

// Darunter fliegt ein Baustein nach drei Wochen raus.
const ABRISS_KOEPFE = 3;

export default async function WerkstattPage() {
  await requireAdmin();

  const heute = berlinToday();
  const sieben = dayToUtcDate(shiftDay(heute, -7));
  const dreissig = dayToUtcDate(shiftDay(heute, -30));

  const [
    features,
    nutzung,
    koepfe,
    offeneMeldungen,
    ohneTreffer,
    schwellen,
    einstellungenDa,
    fokusProzent,
    kriterien,
    offeneAnfragen,
  ] = await Promise.all([
    prisma.feature.findMany({ orderBy: { titel: "asc" } }),
    prisma.featureUse.findMany({
      where: { day: { gte: sieben } },
      select: { featureKey: true, personId: true },
    }),
    prisma.person.count(),
    prisma.rueckmeldung.count({ where: { stand: { in: [...OFFENE_STAENDE] } } }),
    // Wonach im Wegweiser gesucht wurde, ohne dass es etwas gab. Ueber Tage
    // hinweg zusammengezogen: interessant ist das Wort, nicht der Tag.
    //
    // Der Faenger dahinter aus demselben Grund wie in lib/features.ts: steht
    // die Tabelle noch nicht (erster Deploy, Migration unterwegs), soll die
    // Werkstatt trotzdem aufgehen. Eine Seite, die an einer Messung
    // abstuerzt, ist schlimmer als eine Messung, die fehlt.
    prisma.suchbegriff
      .groupBy({
        by: ["begriff"],
        where: { day: { gte: dreissig } },
        _sum: { count: true },
        orderBy: { _sum: { count: "desc" } },
        take: 25,
      })
      .catch(() => []),
    // Die Stufen-Schwellen (AP-07) und der Fokus-Prozentsatz der
    // Einheitenaufteilung (AP-06). Alle drei Aufrufe teilen sich EINE
    // Abfrage: lib/einstellungen.ts liest die Tabelle "Einstellung" je
    // Anfrage genau einmal. Der Faenger gegen die noch nicht deployte
    // Migration steckt schon dort - alleSchwellen()/fokusProzentsatz()
    // fallen dann auf den Platzhalter zurueck, und einstellungenDa sagt es
    // dem Admin, bevor er tippt.
    alleSchwellen(),
    einstellungenStehen(),
    fokusProzentsatz(),
    // Die Ampel-Kriterien (D4, dritter Wert) - teilt sich dieselbe eine
    // Einstellung-Abfrage wie die beiden darueber.
    ampelKriterien(),
    prisma.anfrage.count({ where: { erledigtAt: null } }),
  ]);

  const kopfZahl = new Map<string, Set<string>>();
  for (const zeile of nutzung) {
    let set = kopfZahl.get(zeile.featureKey);
    if (!set) {
      set = new Set();
      kopfZahl.set(zeile.featureKey, set);
    }
    set.add(zeile.personId);
  }

  const stufen = Array.from(
    { length: KARRIERESTUFE_MAX - KARRIERESTUFE_MIN + 1 },
    (_, i) => KARRIERESTUFE_MIN + i
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className={pageTitle}>Werkstatt</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Nur für dich. Wie viele Köpfe jeden Baustein in den letzten sieben
          Tagen überhaupt benutzt haben.
        </p>
      </div>

      <Link
        href="/werkstatt/ai"
        className={cn(cardInteractive, "flex items-center gap-3 p-4")}
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-navy-50 text-navy-600">
          <BellIcon className="h-5 w-5" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-medium text-ink">AI CRM</span>
          <span className="block text-13 text-ink-muted">
            Beta, Abos und Nutzung pro Nutzer.
          </span>
        </span>
        <span className="ml-auto text-sm font-medium text-link">Öffnen →</span>
      </Link>

      {/* Der Rueckkanal daneben. Nutzung sagt, WAS keiner anfasst - die
          Rueckmeldung sagt, WARUM. Das eine ersetzt das andere nicht. */}
      <Link
        href="/werkstatt/rueckmeldungen"
        className={cn(cardInteractive, "flex items-center gap-3 p-4")}
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-navy-50 text-navy-600">
          <MegafonIcon className="h-5 w-5" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-medium text-ink">Rückmeldungen</span>
          <span className="block text-13 text-ink-muted">
            Was die Leute von sich aus melden.
          </span>
        </span>
        <span className={cn(chip(offeneMeldungen > 0 ? "gefahr" : "neutral"), "ml-auto")}>
          {offeneMeldungen} offen
        </span>
      </Link>

      {/* Was von AUSSEN kommt: die oeffentliche Anfrage-Seite (/anfrage). Der
          Unterschied zur Rueckmeldung eine Karte hoeher: dort spricht das
          Team, hier klopft jemand an, der noch gar nicht drin ist. */}
      <Link
        href="/werkstatt/anfragen"
        className={cn(cardInteractive, "flex items-center gap-3 p-4")}
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-navy-50 text-navy-600">
          <BellIcon className="h-5 w-5" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-medium text-ink">Anfragen von außen</span>
          <span className="block text-13 text-ink-muted">
            Wer über /anfrage einen Zugang will.
          </span>
        </span>
        <span className={cn(chip(offeneAnfragen > 0 ? "info" : "neutral"), "ml-auto")}>
          {offeneAnfragen} offen
        </span>
      </Link>

      {/* min-w-180 erzwang 720 Pixel fuer 458 Pixel Inhalt - 262 Pixel
          Leerraum, in den man am Handy hineinwischen konnte. Die
          Mindestbreite soll Spalten vor dem Zusammenklappen schuetzen, nicht
          Platz erfinden. Gemessen bei 375 px, wie bei den beiden Tabellen auf
          /mannschaft. */}
      <div className={`${card} overflow-x-auto`}>
        <table className="w-full min-w-[26rem] text-left text-sm">
          <thead className="border-b border-line/80 bg-sunken/60">
            <tr>
              <th className={th}>Baustein</th>
              <th className={`${th} text-right`}>Benutzt von</th>
              <th className={th}>Stand</th>
              <th className={th}>Schalter</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {features.map((feature) => {
              const benutzt = kopfZahl.get(feature.key)?.size ?? 0;
              return (
                <tr key={feature.key} className="align-top">
                  <td className={`${td} font-medium text-ink`}>
                    {feature.titel}
                    {feature.beschreibung && (
                      <p className="mt-1 max-w-sm text-xs font-normal leading-relaxed text-ink-muted">
                        {feature.beschreibung}
                      </p>
                    )}
                    {feature.grund && (
                      <p className="mt-1 max-w-sm text-xs font-normal text-ink-muted">
                        Bleibt drin, weil: {feature.grund}
                      </p>
                    )}
                  </td>
                  <td className={`${td} text-right tabular-nums`}>
                    {/* Warnfarbe erst, wenn die Schwelle ueberhaupt reissbar ist -
                        bei zwei Koepfen waere sonst alles orange. */}
                    <span
                      className={
                        koepfe >= ABRISS_KOEPFE && benutzt < ABRISS_KOEPFE
                          ? "text-amber-600"
                          : "text-ink"
                      }
                    >
                      {benutzt}
                    </span>
                    <span className="text-ink-soft"> / {koepfe}</span>
                  </td>
                  <td className={td}>
                    <span className={chip(standTon[feature.state])}>
                      {standTexte[feature.state]}
                    </span>
                  </td>
                  <td className={td}>
                    <form action={schalten} className="space-y-2">
                      <input type="hidden" name="key" value={feature.key} />
                      <select
                        name="state"
                        defaultValue={feature.state}
                        aria-label={`Stand von ${feature.titel}`}
                        className={inputBlank}
                      >
                        {Object.entries(standTexte).map(([wert, text]) => (
                          <option key={wert} value={wert}>
                            {text}
                          </option>
                        ))}
                      </select>
                      <input
                        name="grund"
                        defaultValue={feature.grund ?? ""}
                        placeholder="Bleibt drin, weil …"
                        aria-label={`Grund für ${feature.titel}`}
                        className={inputBlank}
                      />
                      <button type="submit" className={cn(btnSecondary, "w-full")}>
                        Übernehmen
                      </button>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className={kicker}>
        Gezählt wird, von wie vielen Köpfen ein Baustein benutzt wurde — nie, von
        wem. Was von weniger als {ABRISS_KOEPFE} Personen benutzt wird, steht nach
        drei Wochen zur Abschaltung. Nutzung statt Meinung: die Abstimmung in der
        Arena ist weg, sie kostete den Partner Aufmerksamkeit und brachte ihm
        keinen Termin.
      </p>

      {/* --- Karrierestufen-Schwellen ----------------------------------------
          Emils Satz: "Stufen-Schwellen einbauen - dafuer schickt mir Emil was,
          soll dann selbst eintragbar und richtig krass promotebar sein"
          (docs/emil-feedback-plan.md, AP-07). Bis hierhin stand die eine Zahl
          im Code; jede neue haette einen Deploy gekostet.

          Der Betrieb legt fest, was eine Stufe kostet - nicht der Code (D4).
          Deshalb steht der Block hier und nicht in einer Konstante: sobald
          Emils Liste kommt, tippt der Admin sie ein und ist fertig. */}
      <div className={`${card} p-5 sm:p-6`}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className={sectionTitle}>Karrierestufen-Schwellen</h2>
          <span className="text-xs text-ink-muted">Eigeneinheiten</span>
        </div>
        <p className="mt-2 max-w-2xl text-sm text-ink-muted">
          Was jemand auf einer Stufe an Eigeneinheiten braucht, bis die nächste
          dran ist. Ein leeres Feld heißt: für diese Stufe gibt es keine
          Schwelle — dann stehen auf /heute und /einheiten die Zahlen, aber kein
          Balken. Eine erfundene Schwelle wäre schlimmer als keine, weil sie
          jemandem sagt, er sei fast da.
        </p>

        {!einstellungenDa && (
          // Ehrlich statt hilfsbereit: die Felder unten zeigen dann den
          // Platzhalter aus dem Code, und ein Speichern liefe in einen Fehler.
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-13 text-amber-800">
            Die Tabelle steht auf dieser Datenbank noch nicht — die Migration
            läuft beim nächsten Deploy mit. Bis dahin gilt der Platzhalter aus
            dem Code, und Eintragen geht hier noch nicht.
          </p>
        )}

        <form action={schwellenSpeichern} className="mt-4 space-y-3">
          {stufen.map((stufe) => (
            <div key={stufe} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <label
                htmlFor={`schwelle-${stufe}`}
                className="w-24 shrink-0 text-sm font-medium text-ink"
              >
                Stufe {stufe}
              </label>
              <input
                id={`schwelle-${stufe}`}
                name={`schwelle-${stufe}`}
                type="text"
                inputMode="decimal"
                defaultValue={
                  schwellen.has(stufe) ? formatEinheiten(schwellen.get(stufe)!) : ""
                }
                placeholder="keine Schwelle"
                aria-label={`Schwelle für Karrierestufe ${stufe}`}
                className={cn(inputBlank, "w-40 tabular-nums")}
              />
              <span className="text-xs text-ink-soft">
                {stufe < KARRIERESTUFE_MAX
                  ? `→ Karrierestufe ${stufe + 1}`
                  : "letzte Stufe — darüber gibt es keine mehr"}
              </span>
            </div>
          ))}
          <div className="flex justify-end border-t border-line pt-4">
            {/* Zu ist besser als ins Leere: ohne Tabelle wuerde das Speichern
                in einen Fehler laufen, und der Hinweis darueber sagt schon,
                warum. */}
            <button
              type="submit"
              disabled={!einstellungenDa}
              className={cn(
                btnSecondary,
                "disabled:cursor-not-allowed disabled:opacity-40"
              )}
            >
              Übernehmen
            </button>
          </div>
        </form>

        <p className="mt-4 text-xs text-ink-muted">
          Platzhalter, bis Emil liefert: Stufe 1 = 500,00, alles darüber leer
          (docs/emil-feedback-plan.md, Abschnitt 7, Punkt 1). Komma und
          Tausenderpunkt gehen wie überall sonst (&bdquo;1.250,50&ldquo;). Steht
          ein Feld nach dem Übernehmen wieder auf dem alten Wert, war die
          Eingabe keine Zahl — dann bleibt die gespeicherte Schwelle stehen,
          statt stillschweigend zu verschwinden.
        </p>
      </div>

      {/* --- Einheitenaufteilung: der Fokus-Prozentsatz ----------------------
          Emils zweiter Satz zu den Einheiten: "Einheitenaufteilung, eine
          Struktur erfuellt die 50%, damit du siehst, wo der Fokus drauf
          liegt" (docs/emil-feedback-plan.md, AP-06). Eigener Block statt
          eines weiteren Feldes oben bei den Karrierestufen-Schwellen: die
          beiden Zahlen beantworten verschiedene Fragen (Befoerderung vs.
          Struktur-Konzentration) und sollen sich in der Werkstatt nicht
          vermischen, so wenig wie ihre Codestellen es tun. */}
      <div className={`${card} p-5 sm:p-6`}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className={sectionTitle}>Einheitenaufteilung</h2>
          <span className="text-xs text-ink-muted">Fokus-Marker auf /mannschaft</span>
        </div>
        <p className="mt-2 max-w-2xl text-sm text-ink-muted">
          Ab wie viel Prozent der eigenen Struktur-Summe (laufender
          Produktionsmonat) ein direkter Ast als Fokus gilt und in der
          Einheiten-Tabelle auf /mannschaft den Marker „Fokus liegt auf
          …&ldquo; bekommt. Reine Anzeige — nichts wird gesperrt.
        </p>

        {!einstellungenDa && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-13 text-amber-800">
            Die Tabelle steht auf dieser Datenbank noch nicht — die Migration
            läuft beim nächsten Deploy mit. Bis dahin gilt der Platzhalter aus
            dem Code (50 %), und Eintragen geht hier noch nicht.
          </p>
        )}

        <form
          action={fokusProzentsatzSpeichern}
          className="mt-4 flex flex-wrap items-center gap-3"
        >
          <label htmlFor="fokus-prozentsatz" className="text-sm font-medium text-ink">
            Fokus-Prozentsatz
          </label>
          <input
            id="fokus-prozentsatz"
            name="fokus-prozentsatz"
            type="text"
            inputMode="numeric"
            defaultValue={fokusProzent}
            aria-label="Fokus-Prozentsatz der Einheitenaufteilung"
            className={cn(inputBlank, "w-24 tabular-nums")}
          />
          <span className="text-sm text-ink-soft">%</span>
          <button
            type="submit"
            disabled={!einstellungenDa}
            className={cn(
              btnSecondary,
              "disabled:cursor-not-allowed disabled:opacity-40"
            )}
          >
            Übernehmen
          </button>
        </form>

        <p className="mt-4 text-xs text-ink-muted">
          Platzhalter, bis Emil liefert: 50 % (docs/emil-feedback-plan.md,
          Abschnitt 7, Punkt 2). Leer lassen und übernehmen setzt wieder auf
          diesen Platzhalter zurück.
        </p>
      </div>

      {/* --- Ampel-Kriterien -------------------------------------------------
          Der dritte D4-Wert (docs/emil-feedback-plan.md, Abschnitt 7,
          Punkt 4): ab wann die Mannschafts-Ampel gelb oder rot zeigt. Bis
          hierhin standen die Zahlen als Konstante in lib/signale.ts; jetzt
          sind sie Platzhalter, und was hier steht, gewinnt - fuer die Matrix,
          fuer /heute und fuer den Morgen-Anstoss gleichermassen
          (lib/ampelKriterien.ts liest, beide Aufrufer rechnen damit). */}
      <div className={`${card} p-5 sm:p-6`}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className={sectionTitle}>Ampel-Kriterien</h2>
          <span className="text-xs text-ink-muted">Frühwarnung auf /mannschaft</span>
        </div>
        <p className="mt-2 max-w-2xl text-sm text-ink-muted">
          Ab welchen Zahlen ein Signal anspringt. Ein leeres Feld heißt: zurück
          auf den Platzhalter aus dem Code. Die Ampel fällt nie aus — sie
          rechnet höchstens wieder mit den alten Zahlen.
        </p>

        {!einstellungenDa && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-13 text-amber-800">
            Die Tabelle steht auf dieser Datenbank noch nicht — die Migration
            läuft beim nächsten Deploy mit. Bis dahin gelten die Platzhalter
            aus dem Code, und Eintragen geht hier noch nicht.
          </p>
        )}

        <form action={ampelKriterienSpeichern} className="mt-4 space-y-3">
          {AMPEL_FELDER.map((eintrag) => (
            <div
              key={eintrag.feld}
              className="flex flex-wrap items-center gap-x-3 gap-y-1"
            >
              <label
                htmlFor={`ampel-${eintrag.feld}`}
                className="w-56 shrink-0 text-sm font-medium text-ink"
              >
                {eintrag.label}
              </label>
              <input
                id={`ampel-${eintrag.feld}`}
                name={`ampel-${eintrag.feld}`}
                type="text"
                inputMode="numeric"
                defaultValue={ampelAnzeigewert(kriterien, eintrag)}
                aria-label={eintrag.label}
                className={cn(inputBlank, "w-24 tabular-nums")}
              />
              <span className="min-w-0 flex-1 text-xs text-ink-soft">
                {eintrag.hinweis}
              </span>
            </div>
          ))}
          <div className="flex justify-end border-t border-line pt-4">
            <button
              type="submit"
              disabled={!einstellungenDa}
              className={cn(
                btnSecondary,
                "disabled:cursor-not-allowed disabled:opacity-40"
              )}
            >
              Übernehmen
            </button>
          </div>
        </form>

        <p className="mt-4 text-xs text-ink-muted">
          Nur ganze Zahlen; die Quote in Prozent (1–100). Steht ein Feld nach
          dem Übernehmen wieder auf dem alten Wert, war die Eingabe keine
          gültige Zahl — dann bleibt der gespeicherte Wert stehen, statt still
          überschrieben zu werden.
        </p>
      </div>

      {/* --- Das Navigations-Backlog ----------------------------------------
          Ein Suchbegriff ohne Treffer ist das ehrlichste Stueck Produkt-
          forschung, das es gibt: jemand sagt in seinen eigenen Worten, was er
          erwartet hat und nicht fand (docs/findbarkeit-plan.md, Abschnitt 6).

          Jede Zeile ist entweder ein fehlendes Synonym - dann gehoert das Wort
          in lib/wegweiser.ts und die Sache ist in zwei Minuten erledigt - oder
          eine fehlende Funktion. Das zweite ist teuer, aber wenigstens belegt.

          Steht ohne Personenbezug da, und zwar nicht nur in der Anzeige:
          gespeichert wird gar keiner. Nutzung ist eine Zahl, ein Suchbegriff
          ist Freitext. */}
      <div className={`${card} p-5 sm:p-6`}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className={sectionTitle}>Gesucht, nichts gefunden</h2>
          <span className="text-xs text-ink-muted">letzte 30 Tage</span>
        </div>

        {ohneTreffer.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">
            Nichts. Entweder findet jeder alles — oder den Wegweiser benutzt
            keiner. Welches von beidem, steht oben in der Zeile
            &bdquo;Wegweiser&ldquo;.
          </p>
        ) : (
          <>
            <ul className="mt-4 flex flex-wrap gap-2">
              {ohneTreffer.map((zeile) => (
                <li
                  key={zeile.begriff}
                  className="inline-flex items-center gap-2 rounded-full border border-line-strong bg-surface px-3 py-1.5 text-13"
                >
                  <span className="text-ink">{zeile.begriff}</span>
                  <span className="tabular-nums text-ink-soft">
                    {zeile._sum.count ?? 0}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-ink-muted">
              Fehlt nur das Wort, gehört es als Synonym in{" "}
              <code className="rounded bg-sunken px-1 py-0.5">
                lib/wegweiser.ts
              </code>
              . Fehlt die Sache selbst, steht sie hier als Beleg.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
