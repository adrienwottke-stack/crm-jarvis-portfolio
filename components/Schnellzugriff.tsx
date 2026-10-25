"use client";

// Das Schnellfenster: der kurze Weg zur eigenen Zahl - und zu allem anderen.
//
// Angefangen hat es als Zaehler. Bisher lag das Zaehlen drei Tipps und einen
// Seitenwechsel tief: Wettbewerb -> Meine Aktivitaeten -> warten -> +1. Fuer
// die haeufigste Handlung des Tages ist das der falsche Preis.
//
// Bewusst KEIN neunter Navigationspunkt: die Kopfzeile traegt schon acht, und
// ein Tab wechselt die Seite - man verliert, wo man war, und muss zurueck.
// Dasselbe Muster wie beim Megafon (components/RueckmeldungGeben.tsx,
// docs/audit-kernmodell.md 5.14): ein Symbol kostet nur den Aufmerksamkeit,
// der es benutzt, und ist von ueberall aus einen Daumen entfernt.
//
// Dazugekommen sind zwei Dinge (docs/findbarkeit-plan.md):
//
//   EINHEITEN. Die Zahl, in der der Betrieb rechnet, lag hinter "Wettbewerb"
//   und wurde deshalb nicht gefunden - genau der Fehler, den der Zaehler oben
//   schon einmal hatte. Kein vierter Zaehler mit +1: eine Einheit ist keine
//   Strichliste, sondern eine Zahl mit Komma und gelegentlich mit Minus.
//
//   DER WEGWEISER. Das Filterfeld oben. Ist es leer, steht hier alles wie
//   vorher - der haeufige Fall bleibt schnell. Tippt jemand ein Wort, weichen
//   die Zaehler einer Trefferliste. Grund: die Navigation ist nach ORTEN
//   sortiert, gesucht wird nach VERBEN. Eine Leiste kann nicht beides sein,
//   ein Index schon.
//
// Warum das Plus traegt, was nach Suche aussieht: jeder Eintrag im Wegweiser
// ist ein Verb. "Ich will was machen" ist genau die Absicht, mit der man auf
// das Plus tippt. Am Rechner oeffnet Strg+K dasselbe Fenster mit dem Feld im
// Fokus.
//
// Drei Zaehler, mehr nicht. Gehaltene Termine, Abschluesse und Empfehlungen
// entstehen am Kontakt (lib/labels.ts, manualQuotaTypes) - hier waeren sie
// doppelt.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  quickLog,
  quickLogZurueck,
  standHeute,
} from "@/app/(team)/log/quickLogAction";
import { einheitSchnellBuchen } from "@/app/(team)/einheiten/actions";
import EinheitenErfolg from "@/components/EinheitenErfolg";
import type { EinheitenBestaetigung } from "@/lib/einheiten-erfolg";
import { suchlauf } from "@/app/wegweiserAction";
import type { SchnellStand } from "@/lib/stats";
import { sucheImWegweiser, type WegweiserEintrag } from "@/lib/wegweiser";
import Modal from "@/components/Modal";
import EinheitenHilfe from "@/components/EinheitenHilfe";
import {
  ArrowRightIcon,
  CalendarCheckIcon,
  FlameIcon,
  HashIcon,
  MinusIcon,
  PhoneIcon,
  PlusIcon,
} from "@/components/icons";
import {
  manualQuotaTypes,
  quotaTypeLabels,
  quotaTypePoints,
} from "@/lib/labels";
import type { QuotaType } from "@/lib/generated/prisma/enums";
import { cn, flaeche, inputBlank } from "@/components/ui";

const symbolFarbe: Partial<Record<QuotaType, string>> = {
  CALL: "bg-navy-50 text-navy-700",
  NUMBERS_PULLED: "bg-navy-50 text-navy-600",
  APPOINTMENT_SET: "bg-emerald-50 text-emerald-600",
};

function ArtSymbol({
  type,
  className,
}: {
  type: QuotaType;
  className?: string;
}) {
  if (type === "CALL") return <PhoneIcon className={className} />;
  if (type === "NUMBERS_PULLED") return <HashIcon className={className} />;
  return <CalendarCheckIcon className={className} />;
}

export default function Schnellzugriff({
  istAdmin,
  wegweiserAn,
}: {
  /** Entscheidet, ob Team und Werkstatt im Wegweiser auftauchen. */
  istAdmin: boolean;
  /** Schalter aus lib/features.ts. Aus heisst: kein Filterfeld, drei Zaehler. */
  wegweiserAn: boolean;
}) {
  const router = useRouter();

  const [offen, setOffen] = useState(false);
  const [stand, setStand] = useState<SchnellStand | null>(null);
  // Derselbe Wert noch einmal als Referenz: eine Zustandsfunktion laeuft erst
  // beim naechsten Rendern, die Antwort des Servers braucht die Auskunft
  // "steht der Stand schon?" aber sofort.
  const standRef = useRef<SchnellStand | null>(null);
  // Was der Daumen schon getippt hat, bevor der Server geantwortet hat. Die
  // Zahl darf nicht auf die Leitung warten - sonst tippt man zweimal.
  const [delta, setDelta] = useState<Partial<Record<QuotaType, number>>>({});
  const [gezaehlt, setGezaehlt] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  // --- Einheiten ------------------------------------------------------------
  const [menge, setMenge] = useState("");
  const [einheitenLaeuft, setEinheitenLaeuft] = useState(false);
  const [einheitenFehler, setEinheitenFehler] = useState<string | null>(null);
  const [gebucht, setGebucht] = useState(false);
  const [einheitenErfolg, setEinheitenErfolg] =
    useState<EinheitenBestaetigung | null>(null);

  // --- Wegweiser ------------------------------------------------------------
  const [suche, setSuche] = useState("");
  const [markiert, setMarkiert] = useState(0);
  const feldRef = useRef<HTMLInputElement>(null);
  // Was zuletzt gesucht wurde und ob etwas kam. Gemeldet wird das EINMAL beim
  // Schliessen (app/wegweiserAction.ts) - sonst stuende jeder Praefix ("e",
  // "ei", "ein") als eigene Zeile im Treffer-los-Log.
  const letzteSuche = useRef<{ begriff: string; treffer: boolean } | null>(
    null,
  );

  const treffer = useMemo(
    () => (suche.trim() ? sucheImWegweiser(suche, istAdmin) : []),
    [suche, istAdmin],
  );
  const imWegweiser = wegweiserAn && suche.trim().length > 0;

  useEffect(() => {
    if (!suche.trim()) return;
    letzteSuche.current = { begriff: suche, treffer: treffer.length > 0 };
    setMarkiert(0);
  }, [suche, treffer.length]);

  const oeffnen = useCallback((mitFokus: boolean) => {
    setOffen(true);
    setFehler(null);
    // Am Handy NICHT von selbst ins Feld springen: die Bildschirmtastatur
    // schoebe sich ueber die Zaehler, und die will der Daumen zuerst. Wer
    // Strg+K drueckt, will dagegen genau das Feld.
    if (mitFokus) window.setTimeout(() => feldRef.current?.focus(), 60);
    // Erst beim Oeffnen laden: die Kopfzeile steht auf jeder Seite und soll
    // niemanden etwas kosten, der nie zaehlt.
    void standHeute()
      .then((geladen) => {
        standRef.current = geladen;
        setStand(geladen);
      })
      .catch(() =>
        setFehler("Der Stand kam nicht durch. Zählen geht trotzdem."),
      );
  }, []);

  const schliessen = useCallback(() => {
    setOffen(false);
    // Die Seite im Hintergrund traegt die neue Zahl sofort mit - sonst steht
    // auf /heute oder in der Arena noch der Stand von vorhin.
    if (gezaehlt) router.refresh();
    // Was gesucht wurde, wird jetzt gemeldet - und der Begriff selbst nur
    // dann, wenn nichts kam. Fehlschlag ist egal: eine Messung darf nie die
    // gemessene Sache kaputtmachen.
    const zuletzt = letzteSuche.current;
    if (zuletzt) {
      void suchlauf(zuletzt.begriff, zuletzt.treffer).catch(() => {});
      letzteSuche.current = null;
    }
    setTimeout(() => {
      standRef.current = null;
      setStand(null);
      setDelta({});
      setGezaehlt(false);
      setFehler(null);
      setSuche("");
      setMarkiert(0);
      setMenge("");
      setEinheitenFehler(null);
      setGebucht(false);
    }, 200);
  }, [gezaehlt, router]);

  // Strg+K / Cmd+K von ueberall. Nur am Rechner ein Thema, aber die Abfrage
  // kostet nichts: ein Handy loest sie nie aus.
  useEffect(() => {
    if (!wegweiserAn) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "k" || !(event.ctrlKey || event.metaKey)) return;
      // Auch aus einem Eingabefeld heraus: in dieser Anwendung gibt es kein
      // Cmd+K mit anderer Bedeutung, und wer gerade in einem Formular steht,
      // ist genau der, der von dort wegwill.
      event.preventDefault();
      if (offen) feldRef.current?.focus();
      else oeffnen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [offen, oeffnen, wegweiserAn]);

  const hingehen = useCallback(
    (eintrag: WegweiserEintrag) => {
      router.push(eintrag.href);
      schliessen();
    },
    [router, schliessen],
  );

  const zaehlen = useCallback(async (type: QuotaType, richtung: 1 | -1) => {
    setFehler(null);
    setDelta((alt) => ({ ...alt, [type]: (alt[type] ?? 0) + richtung }));
    setGezaehlt(true);

    try {
      const neu =
        richtung === 1 ? await quickLog(type, 1) : await quickLogZurueck(type);
      if (neu === null) return;
      // Der Server hat das letzte Wort: greift die Tageskappe, steht danach
      // wieder die wahre Zahl da statt der erhofften - und die Punktzeile
      // waechst um genau das, was wirklich gebucht wurde.
      //
      // Laedt der Stand noch, bleibt der Tipp im Zwischenspeicher liegen und
      // wird spaeter auf den geladenen Stand draufgezaehlt: sonst verschwaende
      // er optisch, bis das Fenster das naechste Mal aufgeht.
      const alt = standRef.current;
      if (!alt) return;
      const vorher = alt.stand[type] ?? 0;
      const neuerStand: SchnellStand = {
        ...alt,
        stand: { ...alt.stand, [type]: neu },
        punkte: alt.punkte + (neu - vorher) * quotaTypePoints[type],
      };
      standRef.current = neuerStand;
      setStand(neuerStand);
      // Nur diesen einen Tipp aus dem Zwischenspeicher nehmen, nicht alles auf
      // null setzen: wer dreimal schnell hintereinander tippt, hat noch zwei
      // Antworten unterwegs - die Zahl darf zwischendurch nicht zurueckfallen.
      setDelta((vorherige) => ({
        ...vorherige,
        [type]: (vorherige[type] ?? 0) - richtung,
      }));
    } catch {
      // Funkloch im Treppenhaus. Die Zahl geht zurueck, damit niemand mit
      // einem Punkt rechnet, der nie ankam.
      setDelta((alt) => ({ ...alt, [type]: (alt[type] ?? 0) - richtung }));
      setFehler("Kam nicht durch. Tipp es nochmal.");
    }
  }, []);

  const einheitenBuchen = useCallback(async () => {
    if (!menge.trim() || einheitenLaeuft) return;
    setEinheitenLaeuft(true);
    setEinheitenFehler(null);
    setGebucht(false);
    try {
      const antwort = await einheitSchnellBuchen(menge);
      if (!antwort.ok) {
        setEinheitenFehler(antwort.fehler);
        return;
      }
      // Der Server hat auch hier das letzte Wort: angezeigt wird der Stand,
      // der wirklich in der Tabelle steht.
      const alt = standRef.current;
      if (alt) {
        const neuerStand: SchnellStand = {
          ...alt,
          einheitenMonat: antwort.monat,
        };
        standRef.current = neuerStand;
        setStand(neuerStand);
      }
      setMenge("");
      setGebucht(true);
      setEinheitenErfolg(antwort);
      router.refresh();
      // Die Seite im Hintergrund muss mitkommen, wenn sie Einheiten zeigt.
      setGezaehlt(true);
    } catch {
      setEinheitenFehler(
        "Die Bestätigung kam nicht durch. Prüfe deine Einträge, bevor du erneut buchst.",
      );
    } finally {
      setEinheitenLaeuft(false);
    }
  }, [menge, einheitenLaeuft, router]);

  const zahlVon = (type: QuotaType): number | null =>
    stand === null ? null : (stand.stand[type] ?? 0) + (delta[type] ?? 0);

  // Die Punktzeile zaehlt die noch nicht bestaetigten Tipps mit - sonst tippt
  // man dreimal und unten bewegt sich nichts.
  const punkte =
    stand === null
      ? null
      : stand.punkte +
        manualQuotaTypes.reduce(
          (summe, art) => summe + (delta[art] ?? 0) * quotaTypePoints[art],
          0,
        );

  return (
    <>
      <button
        type="button"
        onClick={() => oeffnen(false)}
        aria-label={wegweiserAn ? "Eintragen oder suchen" : "Aktivität zählen"}
        title={
          wegweiserAn ? "Eintragen oder suchen (Strg+K)" : "Aktivität zählen"
        }
        // Leichte Flaeche statt nur Umriss: daneben stehen Einstellungen
        // (Thema, Abmelden), das hier ist die eine Handlung in der Leiste.
        className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg bg-akzent text-white transition hover:bg-akzent-stark"
      >
        <PlusIcon className="h-5 w-5" />
      </button>

      <Modal
        open={offen}
        onClose={schliessen}
        title={imWegweiser ? "Wegweiser" : "Was hast du gemacht?"}
        subtitle={
          imWegweiser ? "Tipp an, wo du hinwillst." : "Zählt für heute."
        }
      >
        {wegweiserAn && (
          <input
            ref={feldRef}
            type="text"
            value={suche}
            onChange={(event) => setSuche(event.target.value)}
            onKeyDown={(event) => {
              if (treffer.length === 0) return;
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setMarkiert((alt) => (alt + 1) % treffer.length);
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setMarkiert(
                  (alt) => (alt - 1 + treffer.length) % treffer.length,
                );
              } else if (event.key === "Enter") {
                event.preventDefault();
                const ziel = treffer[markiert];
                if (ziel) hingehen(ziel);
              }
            }}
            // Keine Autokorrektur: "Trichter" wird sonst zu "Trichters", und
            // am Handy fangen Grossbuchstaben jede Suche mit einem falschen
            // Zeichen an.
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-label="Suchen"
            placeholder="Einheiten, Namen, Termin …"
            className={cn(inputBlank, "mb-4")}
          />
        )}

        {imWegweiser ? (
          treffer.length > 0 ? (
            <div className="space-y-1.5">
              {treffer.map((eintrag, i) => (
                <button
                  key={eintrag.id}
                  type="button"
                  onClick={() => hingehen(eintrag)}
                  onMouseEnter={() => setMarkiert(i)}
                  className={cn(
                    "flex min-h-14 w-full items-center gap-3 rounded-xl border px-4 text-left transition",
                    i === markiert
                      ? "border-line bg-sunken"
                      : "border-line bg-surface hover:bg-sunken",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">
                      {eintrag.titel}
                    </span>
                    {/* Der Bereich beantwortet nebenbei die Frage, die nach dem
                        Finden kommt: wo haette ich suchen sollen? */}
                    <span className="block truncate text-13 text-ink-muted">
                      {eintrag.bereich}
                    </span>
                  </span>
                  <ArrowRightIcon className="h-4 w-4 shrink-0 text-ink-soft" />
                </button>
              ))}
            </div>
          ) : (
            // Keine Sackgasse: was hier fehlt, landet als Zeile in der
            // Werkstatt und ist damit die naechste Aufgabe, kein Achselzucken.
            <p className="rounded-xl border border-line bg-sunken px-4 py-6 text-center text-13 text-ink-muted">
              Dazu finde ich nichts. Das ist notiert — schreib es zur Sicherheit
              übers Megafon dazu.
            </p>
          )
        ) : (
          <>
            <div className="space-y-2.5">
              {manualQuotaTypes.map((type) => {
                const zahl = zahlVon(type);
                return (
                  <div
                    key={type}
                    className="flex items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5"
                  >
                    <span
                      className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                        symbolFarbe[type] ?? "bg-navy-50 text-navy-700",
                      )}
                    >
                      <ArtSymbol type={type} className="h-4.5 w-4.5" />
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-13 font-medium text-ink-muted">
                        {quotaTypeLabels[type]}
                      </span>
                      <span className="block text-2xl font-semibold tabular-nums leading-tight text-ink">
                        {zahl === null ? (
                          <span className="text-ink-soft">—</span>
                        ) : (
                          <span
                            key={zahl}
                            className="inline-block animate-tick"
                          >
                            {zahl}
                          </span>
                        )}
                      </span>
                    </span>

                    <span className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void zaehlen(type, -1)}
                        disabled={zahl === null || zahl <= 0}
                        aria-label={`${quotaTypeLabels[type]} eins zurück`}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-sunken text-ink transition hover:bg-line active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-sunken disabled:active:scale-100"
                      >
                        <MinusIcon className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void zaehlen(type, 1)}
                        aria-label={`${quotaTypeLabels[type]} plus eins`}
                        className="inline-flex h-11 w-16 items-center justify-center gap-1 rounded-full bg-akzent text-sm font-semibold text-white transition hover:bg-akzent-stark active:scale-[0.97]"
                      >
                        <PlusIcon className="h-4 w-4" />1
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>

            {fehler && (
              <p
                className={cn(
                  flaeche("gefahr"),
                  "mt-3 px-3 py-2 text-13 text-red-800",
                )}
              >
                {fehler}
              </p>
            )}

            {/* --- Die Zahl, in der der Betrieb rechnet ---------------------
                Unter der Trennlinie und mit eigenem Feld statt +1: eine
                Einheit ist keine Strichliste. Rueckwirkend buchen geht auf
                /einheiten - hier zaehlt der heutige Tag. */}
            <div className="mt-4 border-t border-line pt-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="flex items-center gap-1.5 text-13 font-medium text-ink-muted">
                  Einheiten eintragen
                  <EinheitenHilfe />
                </span>
                <span className="text-13 text-ink-muted">
                  {stand === null ? (
                    <span className="text-ink-soft">—</span>
                  ) : (
                    <>
                      <span className="font-semibold tabular-nums text-ink">
                        {stand.einheitenMonat}
                      </span>{" "}
                      diesen Monat
                    </>
                  )}
                </span>
              </div>

              <div className="mt-2 flex items-center gap-2">
                <input
                  type="text"
                  inputMode="decimal"
                  value={menge}
                  onChange={(event) => {
                    setMenge(event.target.value);
                    setEinheitenFehler(null);
                    setGebucht(false);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void einheitenBuchen();
                    }
                  }}
                  aria-label="Einheiten"
                  placeholder="12,50"
                  className={cn(inputBlank, "flex-1 tabular-nums")}
                />
                <button
                  type="button"
                  onClick={() => void einheitenBuchen()}
                  disabled={!menge.trim() || einheitenLaeuft}
                  className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-akzent px-4 text-sm font-semibold text-white transition hover:bg-akzent-stark active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-35 disabled:active:scale-100"
                >
                  {einheitenLaeuft ? "…" : "Eintragen"}
                </button>
              </div>

              {einheitenFehler ? (
                <p className="mt-2 text-13 text-red-700">{einheitenFehler}</p>
              ) : gebucht && einheitenErfolg ? (
                <EinheitenErfolg
                  key={`${einheitenErfolg.monat}:${einheitenErfolg.gesamt}`}
                  stand={einheitenErfolg}
                />
              ) : null}
            </div>

            {/* Der Grund zum Tippen, in einer Zeile. Kein zweiter Bildschirm. */}
            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-3 text-13 text-ink-muted">
              <span>
                <span className="font-semibold tabular-nums text-ink">
                  {punkte === null ? "—" : punkte}
                </span>{" "}
                Punkte heute
              </span>
              {stand !== null && stand.serie >= 2 && (
                <span className="inline-flex items-center gap-1 font-medium text-gold-600">
                  <FlameIcon className="h-3.5 w-3.5" />
                  {stand.serie} Tage Serie
                </span>
              )}
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
