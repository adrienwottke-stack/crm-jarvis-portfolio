import Link from "next/link";
import { after } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  addMonths,
  berlinToday,
  dayToUtcDate,
  isValidDay,
  mondayOf,
  shiftDay,
  startOfMonth,
  tageImRaster,
} from "@/lib/dates";
import { eintraegeImZeitraum } from "@/lib/kalender/laden";
import { faelligeQuellenAbgleichen } from "@/lib/kalender/abgleich";
import {
  shell,
  btnPrimary,
  btnSecondary,
  flaeche,
  punkt,
} from "@/components/ui";
import { ArrowRightIcon, CalendarCheckIcon, PlusIcon } from "@/components/icons";
import { Umschalter, type Ansicht } from "@/components/kalender/Umschalter";
import { Zeitraster } from "@/components/kalender/Zeitraster";
import { Monatsraster } from "@/components/kalender/Monatsraster";
import { Agenda } from "@/components/kalender/Agenda";
import SeitenKopf from "@/components/SeitenKopf";
import VorfuehrVerdeckt from "@/components/VorfuehrVerdeckt";
import { jetztAbgleichen } from "./actions";
import { defaultCalendarView } from "@/lib/calendar-view";
import { calendarView, KALENDERAKTIONEN } from "@/lib/navigation";
import { WorkspaceActionMenu } from "@/components/WorkspaceNavigation";

export const dynamic = "force-dynamic";

// Der Kalender im Werkzeug (docs/audit-kernmodell.md 10.3, docs/struktur-plan.md 7).
//
// Vier Ansichten auf denselben Daten - Monat, Woche, Tag, Liste. Vorher war es
// nur die Liste, mit der Begruendung, ein Monatsgitter sei am Handy unlesbar.
// Das stimmt weiterhin, war aber die falsche Schlussfolgerung: die Antwort ist
// nicht, das Gitter wegzulassen, sondern es nicht zur Voreinstellung am Handy
// zu machen. Am Schreibtisch ist die Woche die Arbeitsflaeche.
//
// Date navigation remains ordinary links; the mobile view picker shares the shell dialog.

const monatFormat = new Intl.DateTimeFormat("de-DE", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const tagTitelFormat = new Intl.DateTimeFormat("de-DE", {
  weekday: "long",
  day: "2-digit",
  month: "long",
  timeZone: "UTC",
});
const kurzFormat = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "UTC",
});

// Fuer die Sync-Status-Zeile unten - dieselben Feldoptionen wie das
// "zuletzt"-Datum auf /kalender/quellen, nur in dieser Datei noch einmal
// angelegt: page.tsx-Module exportieren ihre internen Konstanten nicht.
const zuletztFormat = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Berlin",
});

type QuellenZeile = { name: string; letzterLauf: Date | null; letzterFehler: string | null };

/**
 * Der Sync-Zustand als ein Satz - fuer die Zeile oben auf der Seite.
 *
 * "Gestoert" heisst hier: der letzte Lauf dieser Quelle ist fehlgeschlagen
 * (letzterFehler gesetzt). Das trifft sowohl die Quelle, die nach drei
 * Fehllaeufen stillgelegt wurde, als auch die, die es noch einmal versucht -
 * quelleAbgleichen setzt letzterFehler und fehlerZaehler immer gemeinsam
 * (lib/kalender/abgleich.ts), nie eines ohne das andere.
 */
function kalenderSyncZustand(
  quellen: QuellenZeile[]
): { zeitText: string; gestoerte: QuellenZeile[] } | null {
  if (quellen.length === 0) return null;

  const gestoerte = quellen.filter((quelle) => quelle.letzterFehler);

  const laeufe = quellen
    .map((quelle) => quelle.letzterLauf)
    .filter((datum): datum is Date => datum !== null);
  const letzterLauf =
    laeufe.length > 0
      ? new Date(Math.max(...laeufe.map((datum) => datum.getTime())))
      : null;

  if (!letzterLauf) {
    return { zeitText: "Noch nicht abgeglichen", gestoerte };
  }

  const minuten = Math.floor((Date.now() - letzterLauf.getTime()) / 60_000);
  const zeitText =
    minuten < 1
      ? "Zuletzt abgeglichen gerade eben"
      : minuten < 60
        ? `Zuletzt abgeglichen vor ${minuten} Min.`
        : `Zuletzt abgeglichen ${zuletztFormat.format(letzterLauf)}`;

  return { zeitText, gestoerte };
}

export default async function KalenderPage({
  searchParams,
}: {
  searchParams: Promise<{ ansicht?: string; tag?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const heute = berlinToday();

  const tag = params.tag && isValidDay(params.tag) ? params.tag : heute;

  // Voreinstellung, in dieser Reihenfolge: Adresszeile, dann die zuletzt
  // gewaehlte Ansicht, dann das Geraet.
  //
  // Die Geraetefrage wird ueber Kopfzeilen entschieden und nicht ueber eine
  // Medienabfrage im Browser: die Seite wird auf dem Server gerendert, und ein
  // Umschalten nach dem ersten Bild waere ein sichtbarer Sprung. Sec-CH-UA-
  // Mobile schicken die Chromium-Browser von sich aus; wer es nicht schickt,
  // wird ueber die Kennung geprueft. Bleibt beides stumm, gewinnt die Liste -
  // sie traegt auf jedem Bildschirm, das Wochenraster nicht.
  const ansicht: Ansicht = calendarView(params.ansicht, await defaultCalendarView(), false);

  // Welcher Zeitraum geladen wird, und wohin die Pfeile springen.
  let von: Date;
  let bis: Date;
  let zurueck: string;
  let vor: string;
  let titel: string;

  if (ansicht === "monat") {
    const raster = tageImRaster(tag);
    von = dayToUtcDate(raster[0]!);
    bis = dayToUtcDate(shiftDay(raster[raster.length - 1]!, 1));
    const ersterDesMonats = startOfMonth(tag);
    zurueck = addMonths(ersterDesMonats, -1).toISOString().slice(0, 10);
    vor = addMonths(ersterDesMonats, 1).toISOString().slice(0, 10);
    titel = monatFormat.format(ersterDesMonats);
  } else if (ansicht === "woche") {
    const montag = mondayOf(tag);
    von = dayToUtcDate(montag);
    bis = dayToUtcDate(shiftDay(montag, 7));
    zurueck = shiftDay(montag, -7);
    vor = shiftDay(montag, 7);
    titel = `${kurzFormat.format(dayToUtcDate(montag))} – ${kurzFormat.format(
      dayToUtcDate(shiftDay(montag, 6))
    )}`;
  } else if (ansicht === "tag") {
    von = dayToUtcDate(tag);
    bis = dayToUtcDate(shiftDay(tag, 1));
    zurueck = shiftDay(tag, -1);
    vor = shiftDay(tag, 1);
    titel = tagTitelFormat.format(dayToUtcDate(tag));
  } else {
    // Die Liste blickt nach vorn, nimmt aber die letzte Woche mit: ein Termin
    // von gestern ist die haeufigste Frage am Morgen danach.
    von = dayToUtcDate(shiftDay(tag, -7));
    bis = dayToUtcDate(shiftDay(tag, 60));
    zurueck = shiftDay(tag, -30);
    vor = shiftDay(tag, 30);
    titel = `Ab ${tagTitelFormat.format(dayToUtcDate(tag))}`;
  }

  // Die Zeitzonen-Falle: dayToUtcDate liefert UTC-Mitternacht, der Berliner Tag
  // beginnt aber ein bis zwei Stunden frueher. Das Fenster wird deshalb an
  // beiden Enden grosszuegig aufgemacht; die Ansichten ordnen jeden Eintrag
  // danach ueber berlinDayOf dem richtigen Tag zu.
  const puffer = 12 * 60 * 60 * 1000;
  const eintraege = await eintraegeImZeitraum(
    user.id,
    new Date(von.getTime() - puffer),
    new Date(bis.getTime() + puffer)
  );

  // Fuer die Raster wieder auf das eigentliche Fenster eingrenzen, damit der
  // Puffer nicht als zusaetzlicher Tag durchschlaegt.
  const imFenster = eintraege.filter(
    (eintrag) => eintrag.von < bis && eintrag.bis > von
  );

  const wochentage = Array.from({ length: 7 }, (_, i) => shiftDay(mondayOf(tag), i));

  // Sync-Zustand der angebundenen Quellen - fuer die Status-Zeile oben.
  // Eine kleine, gezielte Abfrage extra zu den Kalendereintraegen oben: nur
  // die drei Felder, die der Satz braucht, keine Fremdtermine mitgeladen.
  const quellenZeilen = await prisma.kalenderquelle.findMany({
    where: { ownerId: user.id },
    select: { name: true, letzterLauf: true, letzterFehler: true },
  });
  const syncZustand = kalenderSyncZustand(quellenZeilen);

  // Angebundene Kalender nachfassen - NACH der Antwort, nicht davor.
  //
  // Vor dem Rendern haette der Aufruf jeden Seitenaufruf um die Anmeldung bei
  // TimeTree verlaengert, also um Sekunden, die niemand fuer fremde Termine
  // ausgeben will. So ist das Ergebnis erst beim naechsten Aufruf da - dafuer
  // ist die Seite sofort da. Wer nicht warten will, tippt oben "Jetzt
  // nachsehen" (haelt sich weiter an die 15-Minuten-Drossel) oder geht auf
  // die Quellen-Seite und drueckt dort "Jetzt holen" (bricht die Drossel
  // bewusst, siehe dort).
  //
  // Der Cron in vercel.json reicht dafuer nicht: auf dem Hobby-Tarif darf er
  // nur einmal am Tag laufen.
  after(async () => {
    try {
      await faelligeQuellenAbgleichen(user.id);
    } catch {
      // Der Abgleich schreibt seine Fehler selbst an die Quelle. Hier darf
      // nichts mehr nach oben - die Antwort ist zu diesem Zeitpunkt raus.
    }
  });

  return (
    <div className={`${shell} crm-calendar space-y-4`}>
      <SeitenKopf
        hauptbereich
        titel="Kalender"
        unterzeile={`${imFenster.length} ${imFenster.length === 1 ? "Eintrag" : "Einträge"} im Zeitraum`}
        aktion={
          <><Link href={`/kalender/neu?tag=${tag}`} className={btnPrimary}>
            <PlusIcon className="h-4 w-4" />
            Termin erstellen
          </Link>
          <WorkspaceActionMenu title="Kalendermenü" entries={KALENDERAKTIONEN} /></>
        }
      />

      <Umschalter
        ansicht={ansicht}
        tag={tag}
        heute={heute}
        zurueck={zurueck}
        vor={vor}
        titel={titel}
      />

      <div aria-labelledby="kalender-zeitraum" className="crm-calendar-content">
        {ansicht === "monat" && (
          <VorfuehrVerdeckt hinweis="Kalendereinträge sind beim Vorführen ausgeblendet.">
          <Monatsraster tag={tag} eintraege={imFenster} heute={heute} />
          </VorfuehrVerdeckt>
        )}
        {ansicht === "woche" && (
          <VorfuehrVerdeckt hinweis="Kalendereinträge sind beim Vorführen ausgeblendet.">
          <Zeitraster tage={wochentage} eintraege={imFenster} heute={heute} />
          </VorfuehrVerdeckt>
        )}
        {ansicht === "tag" && (
          <>
            {imFenster.length === 0 && (
              <div className="crm-calendar-empty-day">
                <p>Für diesen Tag ist noch nichts eingetragen.</p>
                <Link href={`/kalender/neu?tag=${tag}`} className={btnSecondary}>Eintrag anlegen</Link>
              </div>
            )}
            <VorfuehrVerdeckt hinweis="Kalendereinträge sind beim Vorführen ausgeblendet.">
              <Zeitraster tage={[tag]} eintraege={imFenster} heute={heute} />
            </VorfuehrVerdeckt>
          </>
        )}
        {ansicht === "liste" && <Agenda eintraege={imFenster} heute={heute} tag={tag} />}
      </div>

      <details className="crm-calendar-connections crm-work-section">
        <summary>
          <CalendarCheckIcon className="h-4 w-4" />
          Kalender verbinden
          {syncZustand && syncZustand.gestoerte.length > 0 && (
            <span className="text-red-700"> · {syncZustand.gestoerte.length} {syncZustand.gestoerte.length === 1 ? "Quelle gestört" : "Quellen gestört"}</span>
          )}
        </summary>
        <div className="space-y-3">
          <p className="text-sm text-ink-muted">Übernimm deine Termine in den Handy-Kalender oder zeige Termine aus verbundenen Kalendern hier an.</p>
          <div className="flex flex-wrap gap-2">
            <Link href="/kalender/abo" className={btnSecondary}>Auf dem Handy</Link>
            <Link href="/kalender/quellen" className={btnSecondary}>TimeTree und Kalenderquellen</Link>
          </div>

      {syncZustand && (
        <VorfuehrVerdeckt hinweis="Verbindungsdetails sind beim Vorführen ausgeblendet.">
        <div
          className={
            syncZustand.gestoerte.length > 0
              ? `${flaeche("gefahr")} flex flex-wrap items-center justify-between gap-3 px-4 py-3`
              : "flex flex-wrap items-center justify-between gap-3"
          }
        >
          <p
            className={`flex items-center gap-2 text-sm ${
              syncZustand.gestoerte.length > 0 ? "text-red-900" : "text-ink-muted"
            }`}
          >
            <span
              aria-hidden
              className={`h-2 w-2 shrink-0 rounded-full ${
                syncZustand.gestoerte.length > 0 ? punkt.gefahr : punkt.erfolg
              }`}
            />
            {syncZustand.zeitText}
            {syncZustand.gestoerte.length > 0 &&
              ` · ${
                syncZustand.gestoerte.length === 1
                  ? `${syncZustand.gestoerte[0]!.name} gestört`
                  : `${syncZustand.gestoerte.length} Quellen gestört`
              }`}
          </p>

          {/* Beide Knoepfe tragen ihre 44 Pixel selbst: "Jetzt nachsehen" stand
              vorher auf btnGhost, und das ist reiner Text ohne Mindesthoehe -
              rund 20 Pixel Trefferflaeche an genau der Stelle, an der am Handy
              getippt wird. */}
          {syncZustand.gestoerte.length > 0 ? (
            <Link
              href="/kalender/quellen"
              className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg bg-fest-gefahr px-4 text-sm font-semibold text-white transition hover:bg-fest-gefahr-stark"
            >
              Reparieren
              <ArrowRightIcon className="h-4 w-4" />
            </Link>
          ) : (
            <form action={jetztAbgleichen}>
              <button type="submit" className={`${btnSecondary} shrink-0`}>
                Jetzt nachsehen
              </button>
            </form>
          )}
        </div>
        </VorfuehrVerdeckt>
      )}
        </div>
      </details>
    </div>
  );
}
