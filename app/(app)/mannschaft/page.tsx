import Link from "next/link";
import PersonLink from "@/components/PersonLink";
import { headers } from "next/headers";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import SeitenKopf from "@/components/SeitenKopf";
import Teamziele from "@/components/ziele/Teamziele";
import PartnerBegleitung from "@/components/PartnerBegleitung";
import ErfolgeHeute from "@/components/ErfolgeHeute";
import VereinbarungenHeute from "@/components/vereinbarungen/VereinbarungenHeute";
import {
  RUECKBLICK_TAGE,
  astSummen,
  astVergleich,
  fuehrungsSchritt,
  mannschaftsLage,
  type Mannschaftsperson,
} from "@/lib/fuehrung";
import { berlinToday, dayToUtcDate } from "@/lib/dates";
import { type Signal } from "@/lib/signale";
import Ampel from "@/components/Ampel";
import MannschaftsMatrix from "@/components/MannschaftsMatrix";
import DirektenListe, {
  type DirektenStufe,
  type DirektenZeile,
} from "@/components/DirektenListe";
import Kennzahl from "@/components/Kennzahl";
import Fortschritt from "@/components/Fortschritt";
import { NAMENSFENSTER_TAGE } from "@/lib/einblick";
import { SCHNELLTEXTE_FUEHRUNG } from "@/lib/nachrichten";
import NachrichtSenden from "@/components/NachrichtSenden";
import KuemmereMich from "@/components/KuemmereMich";
import { PhoneIcon } from "@/components/icons";
import Organigramm, { type OrgaKnoten } from "@/components/Organigramm";
import PersonAufnehmen from "@/components/PersonAufnehmen";
import { elternIdVon } from "@/lib/struktur";
import { schalter } from "@/lib/features";
import {
  einheitenFuerStruktur,
  fokusProzentsatz,
  formatEinheiten,
  monatsDeltaJe,
  monatsVergleich,
  produktionsmonat,
  stufenStandJe,
  strukturVerlauf,
  traegtZahlen,
  type StufenStand,
} from "@/lib/einheiten";
import VerlaufsChart from "@/components/VerlaufsChart";
import { initialenKuerzel } from "@/lib/vorfuehren";
import VorfuehrProvider from "@/components/VorfuehrProvider";
import VorfuehrVerdeckt from "@/components/VorfuehrVerdeckt";
import { VorfuehrHinweis } from "@/components/GriffKarte";
import GpName from "@/components/GpName";
import {
  card,
  chip,
  filterPill,
  flaeche,
  kicker,
  sectionTitle,
  td,
  th,
} from "@/components/ui";

export const dynamic = "force-dynamic";

const datumKurz = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "Europe/Berlin",
});

function SignalZeile({ signal }: { signal: Signal }) {
  return (
    <li className="flex gap-2.5">
      <span
        aria-hidden
        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
          signal.schwere === "rot" ? "bg-red-500" : "bg-amber-400"
        }`}
      />
      <span className="text-sm">
        <span className="font-medium text-ink">{signal.titel}</span>
        <span className="text-ink-muted"> — {signal.schritt}</span>
      </span>
    </li>
  );
}

/**
 * Der Name fuehrt eine Ebene tiefer.
 *
 * Die Uebersicht beantwortet "wo fange ich an" - die Antwort ist ein Name, und
 * ab da will man wissen, was dort los ist. Ohne diesen Griff endet die Fuehrung
 * bei der Ampel: man sieht, DASS es hakt, aber nie, WORAN.
 *
 * `kurz` optional: der Link bleibt auf /mannschaft/[id] bestehen (die
 * Detailseite selbst kennt den Vorfuehr-Schalter nicht - v1-Grenze), nur der
 * sichtbare/aria-Name wechselt ueber GpName.
 */
function NameLink({
  person,
  klasse,
  kurz,
}: {
  person: Mannschaftsperson;
  klasse: string;
  kurz?: string;
}) {
  return (
    <PersonLink
      href={`/mannschaft/${person.id}`}
      className={`${klasse} rounded transition hover:text-navy-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-600`}
    >
      <GpName name={person.name} kurz={kurz} />
    </PersonLink>
  );
}

/** „über Jonathan" – ohne das sieht eine Ebene-3-Zeile aus wie eine eigene. */
function UeberChip({
  person,
  kurz,
}: {
  person: Mannschaftsperson;
  kurz?: string;
}) {
  if (!person.ueber) return null;
  return (
    <span className="rounded-full bg-sunken px-2 py-0.5 text-11 font-medium text-ink-muted">
      über <GpName name={person.ueber} kurz={kurz} />
    </span>
  );
}

/**
 * „gelesen" / „noch nicht gelesen" nach einer Nachricht.
 *
 * Bis hierhin schrieb die Fuehrungskraft ins Leere: die Nachricht ging raus
 * und sie erfuhr nie, ob sie ankam. Ein Wort, kein Verlauf.
 */
function Gelesen({
  person,
  klasse = "",
  kurz,
}: {
  person: Mannschaftsperson;
  klasse?: string;
  kurz?: string;
}) {
  if (person.gelesen === null) return null;
  return (
    <span className={`text-xs text-ink-soft ${klasse}`}>
      {person.gelesen ? (
        <>
          <GpName name={person.vorname} kurz={kurz} /> hat deine Nachricht
          gelesen.
        </>
      ) : (
        "Deine Nachricht ist noch ungelesen."
      )}
    </span>
  );
}

function Merkmale({ person }: { person: Mannschaftsperson }) {
  // Ein Platzhalter traegt genau ein Merkmal, und keines der anderen.
  // "Start nicht beendet" waere ein Vorwurf an jemanden, der nie eingeladen
  // wurde - und "noch im Browser" eine Auskunft ueber ein Geraet, das es nicht
  // gibt.
  if (person.platzhalter) {
    return (
      <>
        <span className="rounded-full border border-dashed border-line-strong px-2 py-0.5 text-11 font-medium text-ink-muted">
          {person.eingeladen ? "eingeladen, wartet" : "noch nicht eingeladen"}
        </span>
        {person.fuehrt > 0 && (
          <span className="rounded-full bg-navy-50 px-2 py-0.5 text-xs text-navy-700">
            führt {person.fuehrt}
          </span>
        )}
      </>
    );
  }
  return (
    <>
      {person.frischGestartet && (
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-11 font-medium text-emerald-800">
          {person.werte.letzteAktivitaet
            ? "frisch gestartet"
            : "heute gestartet"}
        </span>
      )}
      {!person.angekommen && (
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-11 font-medium text-amber-800">
          Start nicht beendet
        </span>
      )}
      {person.angekommen && !person.installiert && (
        <span className="text-11 text-ink-soft">noch im Browser</span>
      )}
      {person.fuehrt > 0 && (
        <span className="rounded-full bg-navy-50 px-2 py-0.5 text-xs text-navy-700">
          führt {person.fuehrt}
        </span>
      )}
      {person.ausgetreten && (
        <span className="text-xs text-ink-soft">ausgetreten</span>
      )}
    </>
  );
}

/**
 * Der Text der Stufen-Spalte in der Einheiten-Tabelle.
 *
 * `stand` fehlt fuer Platzhalter und Ausgetretene - stufenStandJe() filtert
 * beide schon am Konto heraus (siehe lib/einheiten.ts), hier bleibt dafuer
 * nur der Gedankenstrich. Bewusst kompakt ("2 · 92 %" ohne Zusatztext): die
 * Spalte steht in einer Tabelle, die gerade erst gegen erzwungene Breite am
 * Handy repariert wurde.
 */
function stufenZelle(stand: StufenStand | undefined) {
  if (!stand) return "—";
  if (stand.stufe === null) return <span className="text-ink-soft">fehlt</span>;
  if (stand.schwelle === null) return `${stand.stufe} — ohne Schwelle`;
  // "erreicht" faellt mit derselben Grenze wie stufenGriffe() (>=), sonst
  // widerspraeche sich die Tabelle der Schwellen-Zeile andernorts im
  // Lagebild.
  if (stand.eigenGesamt >= stand.schwelle) return `${stand.stufe} geschafft`;
  const prozent = Math.floor((stand.eigenGesamt / stand.schwelle) * 100);
  return `${stand.stufe} · ${prozent} %`;
}

/** Was in einem Kasten steht - eine Zeile, mehr passt nicht hinein. */
function kopfzeile(person: Mannschaftsperson): string {
  if (person.platzhalter) {
    return person.eingeladen ? "eingeladen, wartet" : "noch nicht eingeladen";
  }
  if (person.ausgetreten) return "ausgetreten";
  if (!person.angekommen) return "Start nicht beendet";
  const w = person.werte;
  return `${w.anrufeWoche} Anrufe · ${w.gehaltenWoche} gehalten`;
}

export default async function MannschaftPage({
  searchParams,
}: {
  searchParams: Promise<{ ansicht?: string; bereich?: string; partner?: string }>;
}) {
  const { ansicht, bereich, partner } = await searchParams;
  const allePartner = partner === "alle";
  const begleiten = bereich !== "ueberblick" && ansicht !== "liste";
  // Das Bild ist die Vorgabe. Die Liste bleibt einen Tipp entfernt - sie
  // traegt die Signale und die Knoepfe, fuer die im Kasten kein Platz ist.
  const alsListe = ansicht === "liste";
  const user = await requireUser();
  const kopfzeilen = await headers();
  // Wie in app/(app)/einladen/page.tsx: der Ursprung kommt aus der Anfrage,
  // damit der Link auf jedem Geraet stimmt - und nicht erst nach der
  // Hydrierung im Browser entsteht.
  const herkunft = `${kopfzeilen.get("x-forwarded-proto") ?? "http"}://${kopfzeilen.get("host") ?? ""}`;
  // Die Lage zuerst: sie bringt die Struktur mit, und die Einheiten-Aufstellung
  // braucht genau diese Koepfe. Danach laufen die beiden uebrigen Abfragen
  // nebeneinander statt hintereinander.
  const lage = await mannschaftsLage(user);
  const eigenePartner = lage.leute.filter(
    (person) => person.istDirekt && !person.platzhalter && !person.ausgetreten,
  );
  const eigeneFuehrung =
    eigenePartner.length === 0 && user.leaderId
      ? await prisma.user.findFirst({
          where: {
            id: user.leaderId,
            deactivatedAt: null,
            passwordHash: { not: null },
          },
          select: { id: true, name: true, phone: true },
        })
      : null;
  const alle = [lage.ich, ...lage.baum];
  const [aeste, einheitenAn, einheiten, fokusProzent] = await Promise.all([
    astVergleich(user.id),
    schalter("einheiten"),
    einheitenFuerStruktur(
      alle.map((person) => ({ id: person.id, path: person.path })),
      produktionsmonat(berlinToday()),
    ),
    // Der Fokus-Prozentsatz der Einheitenaufteilung (AP-06, D4): admin-
    // pflegbar in der Werkstatt, Platzhalter 50 %, solange nichts eingetragen
    // ist. Reine Konfig-Lesung, keine zweite Berechnung der Anteile selbst.
    fokusProzentsatz(),
  ]);
  const heuteStart = dayToUtcDate(berlinToday()).getTime();
  // Derselbe Schalter wie auf /einheiten: sonst laesst sich die Sichtbarkeit an
  // einer Stelle abschalten und an der anderen nicht.
  const zeigeEinheiten = einheitenAn.einheiten && traegtZahlen(einheiten);

  // Verlauf-Kurve und Stufen-Spalte (Bauschritt 3 des Lagebild-Plans): beide
  // Abfragen laufen nur, wenn der Einheiten-Schalter ueberhaupt an ist -
  // sonst zahlt eine Struktur ohne das Feature fuer zwei Abfragen, die nie
  // gerendert werden. Der volle Sicht-Guard (zeigeEinheiten, inklusive
  // traegtZahlen) bleibt dem bestehenden Tabellen-Abschnitt vorbehalten und
  // steht erst nach diesem Await fest.
  const [strukturverlauf, stufenstand, monatsdeltas] = einheitenAn.einheiten
    ? await Promise.all([
        strukturVerlauf(user.id),
        stufenStandJe(alle.map((person) => person.id)),
        monatsDeltaJe(
          alle
            .filter((person) => !person.platzhalter && !person.ausgetreten)
            .map((person) => ({ id: person.id, path: person.path })),
          berlinToday(),
        ),
      ])
    : [null, null, null];

  // Woher die Einheiten kommen (AP-06): der Anteil jedes DIREKTEN Astes an
  // der eigenen Struktur-Summe. "Struktur-Summe" ist bewusst der Eintrag des
  // Betrachters selbst (astMonat von "ich") - astMonat traegt durch die
  // Faltung in einheitenFuerStruktur() schon alles unter "ich" zusammen mit
  // der eigenen Zahl. Basis ist der MONAT, nicht Gesamt (Plan, Abschnitt 7,
  // Punkt 3): Gesamt ist Biografie und wuerde denselben Ast jeden Monat
  // gleich dominant zeigen. Keine neue Abfrage - reine Arithmetik auf der
  // bereits geladenen `einheiten`-Map.
  const strukturMonat = einheiten.get(lage.ich.id)?.astMonat ?? 0;
  function astAnteil(person: Mannschaftsperson): number | null {
    // Nur direkte Aeste bekommen einen Anteil - Emils Frage zielt auf die
    // Struktur unter der eigenen Fuehrungskraft, nicht auf Koepfe tiefer im
    // Baum. Ohne Umsatz diesen Monat gibt es zudem nichts zu verteilen: eine
    // 0/0-Rechnung waere keine Auskunft, sondern ein Darstellungsfehler.
    if (!person.istDirekt || strukturMonat <= 0) return null;
    const astMonat = einheiten.get(person.id)?.astMonat ?? 0;
    // Gekappt auf 0-1: ein Storno kann einen Ast rechnerisch negativ oder
    // (durch Gegenbuchungen anderswo) ueber 100 % der Struktur-Summe treiben
    // - beides waere kein Anteil mehr, den ein Balken sinnvoll zeigen kann.
    return Math.max(0, Math.min(1, astMonat / strukturMonat));
  }
  // Der dominante Ast, wenn einer den Fokus-Prozentsatz reisst. "liegt UEBER"
  // (Plan-Wortlaut) ist strikt groesser als, nicht ab-gleich. Bei mehreren
  // Aesten ueber der Schwelle gewinnt der groesste: "Fokus liegt auf X" nennt
  // eine Person, keine Liste.
  const fokusAst = alle
    .filter((person) => person.istDirekt)
    .map((person) => ({ person, anteil: astAnteil(person) ?? 0 }))
    .filter((eintrag) => eintrag.anteil * 100 > fokusProzent)
    .sort((a, b) => b.anteil - a.anteil)[0];

  // Direkte stehen einmal in der Partnerliste. Zusätzliche Hinweise betreffen
  // ausschließlich weitere Ebenen, damit dieselbe Person nicht doppelt erscheint.
  const rot = lage.dringend.filter(
    (person) => person.ampel === "rot" && !person.istDirekt,
  );
  const gelb = lage.dringend.filter(
    (person) => person.ampel === "gelb" && !person.istDirekt,
  );
  const ruhendTiefer = lage.ruhend.filter((person) => !person.istDirekt);

  const summen = astSummen(alle);
  const knoten: OrgaKnoten[] = alle.map((person) => {
    const ast = summen.get(person.id);
    // Die Ast-Zeile steht nur bei Fuehrungskraeften: wer fuehrt, wird an
    // seinem Ast gemessen und nicht an seiner eigenen Anrufzahl. Genau die
    // Verwechslung, die die Rangliste macht.
    const astZeile =
      person.fuehrt > 0 && ast
        ? ast.koepfe === 0
          ? // Ein Ast, in dem noch niemand ein Konto hat: "0 Köpfe · 0 Pkt"
            // wäre die Zahl einer Niederlage, dabei ist es der Normalzustand
            // zwei Tage nach dem Eintragen.
            `Ast: ${ast.wartende} ${ast.wartende === 1 ? "Person" : "Personen"}, noch keiner dabei`
          : `Ast: ${ast.koepfe} ${ast.koepfe === 1 ? "Kopf" : "Köpfe"}` +
            (ast.wartende > 0 ? ` (+${ast.wartende} wartend)` : "") +
            ` · ${ast.werte.punkteWoche} Pkt`
        : null;
    return {
      id: person.id,
      name: person.name,
      // Kein Sonderfall fuer den Betrachter selbst: haengt seine echte
      // Fuehrungskraft nicht mit im Bild (der Normalfall - nur der eigene
      // Ast ist sichtbar), macht `baulayout` ihn ohnehin zur Wurzel. Steht sie
      // aber mit im Bild (Admin-Ansicht "gesamte Struktur"), muss der
      // Betrachter dort auch wirklich unter ihr haengen - sonst zeigt das Bild
      // eine andere Hierarchie als der Rest der Seite.
      elternId: elternIdVon(person.path),
      ampel: person.ampel,
      istDu: person.istDu,
      platzhalter: person.platzhalter,
      eingeladen: person.eingeladen,
      ausgetreten: person.ausgetreten,
      fuehrt: person.fuehrt,
      kopf: kopfzeile(person),
      ast: astZeile,
      istUeber: false,
    };
  });

  // Die Kette ueber dem Betrachter obendrauf - Wurzel zuerst, direkter Chef
  // direkt ueber "Du". In der Admin-Ansicht "gesamte Struktur" steht sie
  // unter Umstaenden schon in `knoten` (dort ist jeder mit im Bild, echt
  // verknuepft ueber den Pfad) - dann bleibt sie aussen vor, sonst haengt
  // derselbe Mensch zweimal im Bild.
  const bekannteIds = new Set(knoten.map((k) => k.id));
  const ueberDir: OrgaKnoten[] = lage.oben.some((person) =>
    bekannteIds.has(person.id),
  )
    ? []
    : lage.oben.map((person, i, liste) => ({
        id: person.id,
        name: person.name,
        elternId: i === 0 ? null : liste[i - 1]!.id,
        ampel: "gruen",
        istDu: false,
        platzhalter: false,
        eingeladen: false,
        ausgetreten: false,
        fuehrt: 0,
        kopf: "",
        ast: null,
        istUeber: true,
      }));
  knoten.unshift(...ueberDir);

  // Unter wen darf gehaengt werden: der eigene Ast, man selbst zuerst.
  // Platzhalter sind erlaubt - eine geplante Ebene bekommt ihre Leute, bevor
  // sie selbst ein Konto hat.
  const fuehrungen = [
    { id: lage.ich.id, name: lage.ich.name || "Du", istDu: true },
    ...lage.baum
      .filter((person) => !person.ausgetreten)
      .map((person) => ({ id: person.id, name: person.name, istDu: false })),
  ];

  // Vorfuehr-Kuerzel (Lagebild-Plan, Bauschritt 3b): EINE kollisionssaubere
  // Map fuer die GANZE Seite, nicht je Abschnitt - initialenKuerzel() braucht
  // dafuer die Vereinigungsmenge aller GP-Namen auf einmal, sonst koennte
  // z. B. "M. W." in der Einheiten-Tabelle etwas anderes bedeuten als in
  // "Heute dran". `alle` (= Betrachter + eigener Baum) deckt Einheiten-
  // Tabelle, Heute dran, Du kuemmerst dich, Hakt-brennt-aber-nicht und den
  // Fokus-Chip ab. `aeste.aeste` sind dagegen die GESCHWISTER unter derselben
  // Fuehrung (astVergleich() fragt Geschwister ab, nicht den eigenen Ast) -
  // die koennen ausserhalb von `alle` liegen und kommen fuer den Ast-Vergleich
  // eigens dazu. Kunden-/Kontaktnamen tauchen in keiner der beiden Listen auf.
  const kurzMap = initialenKuerzel([
    ...alle.map((person) => person.name),
    ...(eigeneFuehrung ? [eigeneFuehrung.name] : []),
    ...(aeste?.aeste.map((ast) => ast.name) ?? []),
  ]);

  const monatsvergleich = monatsVergleich(
    strukturverlauf?.tage ?? [],
    berlinToday(),
  );
  const direktenZeilen: DirektenZeile[] = eigenePartner.map((person) => {
    const delta = monatsdeltas?.get(person.id);
    const stand = stufenstand?.get(person.id);
    let stufe: DirektenStufe | null = null;
    if (einheitenAn.einheiten) {
      if (!stand || stand.stufe === null) stufe = { art: "fehlt" };
      else if (stand.schwelle === null)
        stufe = { art: "ohneSchwelle", stufe: stand.stufe };
      else if (stand.eigenGesamt >= stand.schwelle)
        stufe = { art: "erreicht", stufe: stand.stufe };
      else
        stufe = {
          art: "fortschritt",
          stufe: stand.stufe,
          prozent: Math.round((stand.eigenGesamt / stand.schwelle) * 100),
        };
    }
    const differenz = (delta?.astMonat ?? 0) - (delta?.astVormonat ?? 0);
    return {
      id: person.id,
      name: person.name,
      kurz: kurzMap.get(person.name) ?? person.vorname,
      ampel: person.ampel,
      fuehrt: person.fuehrt,
      platzhalter: false,
      eingeladen: person.eingeladen,
      signalTitel:
        person.ampel !== "gruen" ? (person.signale[0]?.titel ?? null) : null,
      ehText: delta
        ? (person.fuehrt > 0 ? "Ast " : "") + formatEinheiten(delta.astMonat)
        : null,
      deltaText: delta
        ? (differenz >= 0 ? "+" : "") +
          formatEinheiten(differenz) +
          " vs. " +
          monatsvergleich.vormonatLabel
        : null,
      stufe,
    };
  });

  return (
    <VorfuehrProvider>
      <div className="crm-team space-y-5">
        <div>
          <SeitenKopf
            hauptbereich
            titel="Team"
            unterzeile={begleiten
              ? eigenePartner.length > 0 ? `${eigenePartner.length} direkte Partner · eure nächsten Schritte` : "Dein Führungskontakt und gemeinsame Schritte"
              : "Direkte Partner und weitere Ebenen"}
          />
          <VorfuehrHinweis />
        </div>


        {!begleiten && (
          <MannschaftsMatrix
            personen={lage.leute}
            einheiten={einheiten}
            zeigeEinheiten={zeigeEinheiten}
            kurz={kurzMap}
          />
        )}
        {!begleiten && einheitenAn.einheiten && direktenZeilen.length > 0 && (
          <details className={card + " p-5"}>
            <summary className="min-h-11 cursor-pointer py-2 font-semibold">
              Direkte Partner im Monatsvergleich
            </summary>
            <div className="mt-3">
              <DirektenListe
                personen={direktenZeilen}
                einheitenAn={einheitenAn.einheiten}
                monatLabel={produktionsmonat(berlinToday()).label}
                vormonatLabel={monatsvergleich.vormonatLabel}
              />
            </div>
          </details>
        )}
        {eigenePartner.length === 0 && (
          <section className="crm-work-section crm-team-empty space-y-3">
            <h2 className="text-ink">
              {eigeneFuehrung ? "Dein Führungskontakt" : "Gemeinsam starten"}
            </h2>
            {eigeneFuehrung ? (
              <>
                <p className="text-xl font-medium text-ink">
                  <GpName
                    name={eigeneFuehrung.name}
                    kurz={kurzMap.get(eigeneFuehrung.name)}
                  />
                </p>
                <p className="text-base text-ink-muted">
                  Besprecht deinen nächsten Schritt oder vereinbart eine
                  gemeinsame Vorbereitung.
                </p>
                <VorfuehrVerdeckt hinweis="Persönliche Kontaktaktionen sind beim Vorführen ausgeblendet.">
                <div className="flex flex-wrap gap-3">
                  <Link
                    href={`/mannschaft/vereinbarungen?partner=${eigeneFuehrung.id}`}
                    className="min-h-11 rounded-lg bg-akzent px-4 py-3 text-sm font-semibold text-white"
                  >
                    Unsere Absprachen
                  </Link>
                  {eigeneFuehrung.phone && (
                    <a
                      href={`tel:${eigeneFuehrung.phone.replace(/[^+\d]/g, "")}`}
                      className="min-h-11 rounded-lg border border-line-strong px-4 py-3 text-sm font-semibold text-ink-muted"
                    >
                      Anrufen
                    </a>
                  )}
                  <NachrichtSenden
                    anId={eigeneFuehrung.id}
                    name={eigeneFuehrung.name}
                    variante="knopf"
                  />
                </div>
                </VorfuehrVerdeckt>
              </>
            ) : (
              <p className="text-base text-ink-muted">
                Sobald dein Führungskontakt hinterlegt ist, könnt ihr hier
                gemeinsame Schritte vereinbaren.
              </p>
            )}
            <Link
              href="/einladen"
              className="inline-flex min-h-12 items-center text-base font-semibold text-navy-800"
            >
              Geschäftspartner einladen →
            </Link>
          </section>
        )}

        {begleiten && eigenePartner.length > 0 && (
          <section id="partner" className="scroll-mt-24 space-y-3">
            <div className="crm-section-heading">
              <h2>Deine direkten Partner</h2>
            </div>
            <PartnerBegleitung
              userId={user.id}
              personen={eigenePartner}
              struktur={lage.leute}
              kompakt
              limit={allePartner ? undefined : 3}
              alleHref="/mannschaft?partner=alle#partner"
            />
            {allePartner && eigenePartner.length > 3 && <Link className="crm-planning-inline-link" href="/mannschaft#partner">Weniger anzeigen →</Link>}
            <VorfuehrVerdeckt hinweis="Persönliche Erfolge werden beim Vorführen ausgeblendet.">
              <ErfolgeHeute userId={user.id} team />
            </VorfuehrVerdeckt>
          </section>
        )}

        {begleiten && (
          <VorfuehrVerdeckt hinweis="Gemeinsame Absprachen werden beim Vorführen ausgeblendet.">
            <VereinbarungenHeute userId={user.id} />
          </VorfuehrVerdeckt>
        )}

        {begleiten && (
          <Teamziele userId={user.id} kompakt alsAbschnitt />
        )}

        {lage.fuehrtNiemanden && lage.gesamtstruktur && (
          <p className="rounded-lg bg-sunken px-3 py-2 text-sm text-ink-muted">
            Du führst selbst niemanden – als Admin siehst du hier trotzdem die
            gesamte Struktur.
          </p>
        )}

        {!begleiten && lage.baum.length === 0 && (
          <div className={`${card} p-6`}>
            <p className="text-sm font-medium text-ink">
              Noch niemand in deiner Struktur
            </p>
            <p className="mt-1 text-sm text-ink-muted">
              Unter{" "}
              <Link
                href="/einladen"
                className="font-medium text-navy-700 hover:underline"
              >
                Einladen
              </Link>{" "}
              erzeugst du einen Link oder QR-Code — wer ihn einlöst, hängt
              automatisch unter dir.
            </p>
            <p className="mt-3 text-sm text-ink-muted">
              Oder du trägst die Struktur ein, bevor jemand die App nutzt — beim
              Ausrollen eines Teams steht sie ohnehin schon.
            </p>
            <div className="mt-3">
              <PersonAufnehmen fuehrungen={fuehrungen} herkunft={herkunft} />
            </div>
          </div>
        )}

        {/* --- Was Emil nirgends sonst bekommt ---------------------------------
          Die Rangliste zaehlt Koepfe gegen Koepfe. Wer aufbaut, sieht dort
          schlechter aus als ein fleissiger Einzelkaempfer. Hier steht, was die
          Mannschaft zusammen geschafft hat - und wie sie gegen die Aeste
          daneben steht. */}
        {!begleiten && !lage.fuehrtNiemanden && aeste?.meiner && (
          <section className={`${card} p-5 sm:p-6`}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 className={kicker}>Deine Struktur diese Woche</h2>
              <span className="text-xs text-ink-muted">
                {aeste.platz === 1
                  ? `vorn — ${aeste.aeste[1] ? `${aeste.meiner.punkte - aeste.aeste[1].punkte} Punkte Vorsprung` : "allein an der Spitze"}`
                  : `Platz ${aeste.platz} von ${aeste.aeste.length} · ${aeste.abstand} Punkte zurück`}
              </span>
            </div>
            <p className="mt-1 text-2xl font-bold tabular-nums tracking-[-0.02em] text-navy-900">
              {aeste.meiner.punkte}
              <span className="ml-1.5 text-sm font-medium text-ink-muted">
                Punkte aus {aeste.meiner.koepfe}{" "}
                {aeste.meiner.koepfe === 1 ? "Kopf" : "Köpfen"}
              </span>
            </p>
            <ul className="mt-3 space-y-1.5">
              {aeste.aeste.map((ast, i) => {
                const spitze = aeste.aeste[0]?.punkte ?? 0;
                const breite =
                  spitze > 0 ? Math.max(2, (ast.punkte / spitze) * 100) : 2;
                return (
                  <li key={ast.id} className="flex items-center gap-2.5">
                    <span
                      className={`w-24 shrink-0 truncate text-xs ${
                        ast.istMeiner
                          ? "font-semibold text-ink"
                          : "text-ink-muted"
                      }`}
                    >
                      {ast.istMeiner ? (
                        "Deine Leute"
                      ) : (
                        <GpName name={ast.name} kurz={kurzMap.get(ast.name)} />
                      )}
                    </span>
                    {/* Die Balken wachsen nacheinander ein - der Vergleich
                      liest sich dadurch als Rangfolge, nicht als Tabelle. */}
                    <Fortschritt
                      anteil={breite / 100}
                      ton={ast.istMeiner ? "info" : "neutral"}
                      hoehe="kraeftig"
                      verzoegerung={i * 60}
                      className="flex-1"
                    />
                    <span
                      className={`w-10 shrink-0 text-right text-xs tabular-nums ${
                        ast.istMeiner
                          ? "font-semibold text-ink"
                          : "text-ink-muted"
                      }`}
                    >
                      {ast.punkte}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* --- Die zehn Sekunden ----------------------------------------------
          Ganz oben steht nicht die Struktur, sondern die Antwort: wen rufe ich
          heute an, und was sage ich ihm. Die Liste bleibt kurz, weil nur rot
          und gelb hier landen. */}
        {begleiten && rot.length > 0 && (
          <VorfuehrVerdeckt hinweis="Persönliche Unterstützung in weiteren Ebenen ist beim Vorführen ausgeblendet.">
          <section className="space-y-3">
            <h2 className={kicker}>Unterstützung in weiteren Ebenen</h2>
            <ul className="space-y-3">
              {rot.map((person) => {
                const oben = person.signale[0]!;
                return (
                  <li
                    key={person.id}
                    // Diese Karten sind der Grund, warum die Seite existiert:
                    // getoente Flaeche statt weiss, damit der Blick zuerst hier
                    // haengenbleibt und nicht in der Struktur darunter.
                    className={`${flaeche(person.ampel === "rot" ? "gefahr" : "warnung")} border-l-4 p-4 transition duration-200 hover:schatten-hoch sm:p-5 ${
                      person.ampel === "rot"
                        ? "border-l-red-500"
                        : "border-l-amber-400"
                    }`}
                  >
                    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                      <NameLink
                        person={person}
                        klasse="text-base font-semibold text-ink"
                        kurz={kurzMap.get(person.name)}
                      />
                      <Ampel ampel={person.ampel} variante="text" />
                      <UeberChip
                        person={person}
                        kurz={
                          person.ueber ? kurzMap.get(person.ueber) : undefined
                        }
                      />
                      <Merkmale person={person} />
                    </div>
                    <p className="mt-1.5 text-sm font-medium text-ink">
                      {oben.titel}
                    </p>
                    <p className="text-sm text-ink-muted">
                      {fuehrungsSchritt(person)}
                    </p>
                    {person.signale.length > 1 && (
                      <p className="mt-1 text-xs text-ink-soft">
                        {person.signale.length === 2
                          ? "Ein weiterer Punkt steht unten."
                          : `${person.signale.length - 1} weitere Punkte stehen unten.`}
                      </p>
                    )}
                    {/* Steht hier nur, wenn eine Frist schon verstrichen ist:
                      dann hat sich die Fuehrungskraft etwas vorgenommen und es
                      nicht getan. Das gehoert gesagt, nicht verschwiegen. */}
                    {person.betreuung && (
                      <p className="mt-1 text-xs font-medium text-amber-700">
                        Du wolltest am{" "}
                        {datumKurz.format(person.betreuung.faelligAm)}{" "}
                        nachfassen.
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {person.ueberId && person.ueber && (
                        <NachrichtSenden
                          anId={person.ueberId}
                          name={person.ueber}
                          schnelltexte={SCHNELLTEXTE_FUEHRUNG}
                          variante="knopf"
                        />
                      )}
                      <NachrichtSenden
                        anId={person.id}
                        name={person.name}
                        schnelltexte={SCHNELLTEXTE_FUEHRUNG}
                        variante="knopf"
                      />
                      {person.telefon && (
                        <a
                          href={`tel:${person.telefon.replace(/[^+\d]/g, "")}`}
                          className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line-strong bg-surface px-3.5 text-13 font-medium text-ink-muted transition hover:bg-sunken hover:text-ink"
                        >
                          <PhoneIcon className="h-4 w-4" />
                          <GpName
                            name={person.vorname}
                            kurz={kurzMap.get(person.name)}
                          />{" "}
                          anrufen
                        </a>
                      )}
                      {/* Der eine Tipp, nach dem dieser Fall morgen nicht wieder
                        dasteht. Ohne ihn wiederholt sich die Liste, bis sie
                        niemand mehr liest. */}
                      <KuemmereMich
                        memberId={person.id}
                        name={person.name}
                        anlass={oben.schluessel}
                      />
                    </div>
                    <Gelesen
                      person={person}
                      klasse="mt-2 block"
                      kurz={kurzMap.get(person.name)}
                    />
                    {/* Die Karte muss allein tragen. Wer erst weiterblaettern
                      muss, um zu wissen ob "still" auch "leer" heisst, ruft
                      unvorbereitet an. */}
                    <p className="mt-2.5 text-xs text-ink-muted">
                      {[
                        `${person.werte.anrufeWoche} Anrufe diese Woche`,
                        person.pipelineSichtbar &&
                          `${person.werte.inAkquise} offene Namen`,
                        person.pipelineSichtbar &&
                          person.werte.ueberfaellig > 0 &&
                          `${person.werte.ueberfaellig} überfällig`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </li>
                );
              })}
            </ul>
          </section>
          </VorfuehrVerdeckt>
        )}

        {/* --- Wo du schon dran bist -------------------------------------------
          Nicht weg, nur leise. Wer sich gekuemmert hat, will sehen, dass es
          steht - aber nicht jeden Morgen daran erinnert werden, als haette er
          nichts getan. */}
        {begleiten && ruhendTiefer.length > 0 && (
          <section className={`${card} p-4 sm:p-5`}>
            <h2 className={kicker}>Du kümmerst dich</h2>
            <ul className="mt-2.5 divide-y divide-line">
              {ruhendTiefer.map((person) => (
                <li
                  key={person.id}
                  className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-2"
                >
                  <Ampel
                    ampel={person.ampel}
                    variante="punkt"
                    groesse="klein"
                  />
                  <NameLink
                    person={person}
                    klasse="text-sm font-medium text-ink"
                    kurz={kurzMap.get(person.name)}
                  />
                  <UeberChip
                    person={person}
                    kurz={person.ueber ? kurzMap.get(person.ueber) : undefined}
                  />
                  <span className="text-sm text-ink-muted">
                    {person.signale[0]?.titel ?? "läuft"}
                  </span>
                  <span className="ml-auto text-xs text-ink-soft">
                    nachfassen{" "}
                    {person.betreuung &&
                    person.betreuung.faelligAm.getTime() <
                      heuteStart + 86_400_000
                      ? "heute"
                      : person.betreuung
                        ? datumKurz.format(person.betreuung.faelligAm)
                        : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Gelb ist kein Notfall, sondern ein Gespraechsthema. Stuende es oben
          zwischen den roten Karten, waere die Liste nach zwei Wochen wieder
          so lang, dass niemand mehr hinsieht - eine Zeile je Person reicht. */}
        {begleiten && gelb.length > 0 && (
          <section className={`${card} p-4 sm:p-5`}>
            <h2 className={kicker}>Beim nächsten Gespräch</h2>
            <ul className="mt-2.5 divide-y divide-line">
              {gelb.map((person) => (
                <li
                  key={person.id}
                  className="flex flex-wrap items-baseline gap-x-2 py-2 text-sm"
                >
                  <span
                    aria-hidden
                    className="h-2 w-2 shrink-0 self-center rounded-full bg-amber-400"
                  />
                  <NameLink
                    person={person}
                    klasse="font-medium text-ink"
                    kurz={kurzMap.get(person.name)}
                  />
                  {person.ueber && (
                    <span className="text-xs text-ink-soft">
                      über{" "}
                      <GpName
                        name={person.ueber}
                        kurz={kurzMap.get(person.ueber)}
                      />
                    </span>
                  )}
                  <span className="text-ink-muted">
                    {person.signale[0]!.titel}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* --- Die ganze Struktur ---------------------------------------------
          Baumreihenfolge, Direkte prominent, Tiefe eingerueckt und mit dem
          Namen der Fuehrungskraft davor. Wer hier steht, ist bereits oben
          abgehandelt - das hier ist zum Nachsehen, nicht zum Entscheiden. */}
        {!begleiten && lage.baum.length > 0 && (
          <VorfuehrVerdeckt hinweis="Beim Vorführen ausgeblendet — der Strukturbaum zeigt Klarnamen.">
            <section className="space-y-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <h2 className={kicker}>
                  {lage.gesamtstruktur ? "Gesamte Struktur" : "Deine Struktur"}{" "}
                  ({lage.baum.length})
                </h2>
                <div className="ml-auto flex flex-wrap items-center gap-1.5">
                  {/* Zwei Sichten auf dieselbe Struktur. Das Bild beantwortet
                  "wer haengt unter wem", die Liste "was ist mit wem los" -
                  und traegt die Knoepfe, fuer die im Kasten kein Platz ist. */}
                  <Link
                    href="/mannschaft?bereich=ueberblick"
                    scroll={false}
                    className={filterPill(!alsListe)}
                  >
                    Organigramm
                  </Link>
                  <Link
                    href="/mannschaft?bereich=ueberblick&ansicht=liste"
                    scroll={false}
                    className={filterPill(alsListe)}
                  >
                    Liste
                  </Link>
                  <PersonAufnehmen
                    fuehrungen={fuehrungen}
                    herkunft={herkunft}
                  />
                </div>
              </div>

              {!alsListe && <Organigramm knoten={knoten} />}

              {alsListe && (
                <ul className="mt-3 space-y-3">
                  {lage.baum.map((person) => {
                    const w = person.werte;
                    const schrittUeberfaellig =
                      w.naechsterSchritt !== null &&
                      w.naechsterSchritt.getTime() < heuteStart;
                    return (
                      <li
                        key={person.id}
                        id={`p-${person.id}`}
                        className={`${card} p-4 scroll-mt-24 sm:p-5 ${
                          person.tiefe > 1 ? "border-l-2 border-l-line" : ""
                        }`}
                        style={{
                          marginLeft: `${Math.min(person.tiefe - 1, 3) * 12}px`,
                        }}
                      >
                        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                          <span className="flex items-center gap-2">
                            <Ampel ampel={person.ampel} variante="punkt" />
                            <NameLink
                              person={person}
                              klasse="text-sm font-semibold text-ink"
                            />
                            {/* Der Zustand steht jetzt als Wort daneben, nicht mehr
                          nur im sr-only-Text: "braucht dich" muss man sehen. */}
                            <Ampel ampel={person.ampel} variante="text" />
                          </span>
                          <UeberChip person={person} />
                          <Merkmale person={person} />
                          <span className="ml-auto text-xs text-ink-muted">
                            {/* "seit über 60 Tagen nichts" bei jemandem, der gestern
                          dazugekommen ist, ist schlicht falsch - und es ist
                          das Erste, was eine frische Fuehrungskraft liest. */}
                            {person.platzhalter
                              ? "nutzt die App noch nicht"
                              : w.letzteAktivitaet
                                ? `zuletzt ${datumKurz.format(w.letzteAktivitaet)}`
                                : !person.angekommen
                                  ? "noch nicht gestartet"
                                  : person.tageDabei !== null &&
                                      person.tageDabei <= RUECKBLICK_TAGE
                                    ? "noch keine Aktivität eingetragen"
                                    : `seit über ${RUECKBLICK_TAGE} Tagen keine Aktivität eingetragen`}
                            {!person.platzhalter &&
                              (person.pipelineSichtbar ||
                                person.einblick.offen) && (
                                <>
                                  {" · "}
                                  {w.naechsterSchritt
                                    ? `${schrittUeberfaellig ? "offen seit" : "nächster"} ${datumKurz.format(w.naechsterSchritt)}`
                                    : "nichts geplant"}
                                </>
                              )}
                          </span>
                        </div>

                        {/* Nullen sind bei einem Platzhalter keine Auskunft, sondern
                      eine Behauptung: "0 Anrufe" liest sich wie Faulheit und
                      heisst in Wahrheit "noch nie gefragt worden". */}
                        {!person.platzhalter && (
                          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-3">
                            <Kennzahl
                              wert={w.anrufeWoche}
                              bezeichnung="Anrufe (Woche)"
                            />
                            <Kennzahl
                              wert={w.vereinbartWoche}
                              bezeichnung="Termine vereinbart"
                            />
                            <Kennzahl
                              wert={w.gehaltenWoche}
                              bezeichnung="Termine gehalten"
                            />
                            <Kennzahl
                              wert={w.abschluesseMonat}
                              bezeichnung="Abschlüsse (Monat)"
                              betont
                            />
                            {person.pipelineSichtbar && (
                              <>
                                <Kennzahl
                                  wert={w.inAkquise}
                                  bezeichnung="in Akquise"
                                />
                                <Kennzahl
                                  wert={w.ueberfaellig}
                                  bezeichnung="überfällig"
                                />
                              </>
                            )}
                          </div>
                        )}

                        {/* Der Sponsor sieht denselben Stand wie der Neue selbst auf
                      /heute - sonst redet er über Zahlen, die der andere nicht
                      kennt. */}
                        {person.pass && (
                          <div className="mt-3 flex items-center gap-3 border-t border-line pt-3">
                            <span className="text-xs font-medium text-ink-muted">
                              Starterpass
                            </span>
                            <Fortschritt
                              anteil={
                                person.pass.geschafft / person.pass.gesamt
                              }
                              ton="info"
                              className="flex-1"
                              beschriftung={`Starterpass: ${person.pass.geschafft} von ${person.pass.gesamt}`}
                            />
                            <span className="text-xs font-semibold tabular-nums text-ink-muted">
                              {person.pass.geschafft} von {person.pass.gesamt}
                            </span>
                          </div>
                        )}

                        {person.signale.length > 0 && (
                          <ul className="mt-4 space-y-2 border-t border-line pt-3">
                            {person.signale.map((signal) => (
                              <SignalZeile
                                key={signal.schluessel}
                                signal={signal}
                              />
                            ))}
                          </ul>
                        )}

                        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                          {/* Eine Nachricht an einen Platzhalter kaeme nie an: er hat
                        kein Konto, das ein Postfach oeffnen koennte. */}
                          {!person.platzhalter && (
                            <NachrichtSenden
                              anId={person.id}
                              name={person.name}
                              schnelltexte={SCHNELLTEXTE_FUEHRUNG}
                              variante="knopf"
                            />
                          )}
                          {/* Wo geschrieben werden kann, muss auch angerufen werden
                        koennen - der Anruf ist der staerkere Griff, nicht der
                        seltenere. */}
                          {person.telefon && (
                            <a
                              href={`tel:${person.telefon.replace(/[^+\d]/g, "")}`}
                              className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line-strong bg-surface px-3.5 text-13 font-medium text-ink-muted transition hover:bg-sunken hover:text-ink"
                            >
                              <PhoneIcon className="h-4 w-4" />
                              {person.vorname} anrufen
                            </a>
                          )}
                          <Gelesen person={person} />
                          {person.platzhalter ? (
                            <p className="ml-auto text-xs text-ink-soft">
                              {person.eingeladen
                                ? "Einladung ist raus."
                                : "Antippen, um einen Einladungslink zu erzeugen."}
                            </p>
                          ) : (
                            !person.pipelineSichtbar && (
                              <p className="ml-auto text-xs text-ink-soft">
                                {person.vorname} zeigt nur Zahlen, keinen
                                Trichter.
                              </p>
                            )
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </VorfuehrVerdeckt>
        )}

        {/* --- Verlauf deiner Struktur ------------------------------------------
          Direkt ueber der Einheiten-Tabelle, mit demselben Guard. Der Endwert
          der Kurve ist dieselbe Zahl wie die Zelle "Zusammen" der eigenen
          Zeile in der Tabelle darunter - beide kommen aus derselben
          Rechnungsbasis (strukturVerlauf() bzw. einheitenFuerStruktur(),
          Invariante siehe Kommentar an strukturVerlauf in lib/einheiten.ts). */}
        {!begleiten && zeigeEinheiten && strukturverlauf && (
          <section id="verlauf" className="scroll-mt-24 space-y-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className={sectionTitle}>Verlauf deiner Struktur</h2>
              <span className="text-xs text-ink-muted">
                tippen und halten zum Ablesen
              </span>
            </div>
            <VerlaufsChart
              sockel={strukturverlauf.sockel}
              tage={strukturverlauf.tage}
              heute={berlinToday()}
              monatStart={produktionsmonat(berlinToday())
                .start.toISOString()
                .slice(0, 10)}
              fussnote="Kumuliert über deine ganze Struktur, inklusive der Einheiten von vor der App — die stehen als eine Zahl ohne Datum, davor läuft die Kurve flach. Ein Storno zieht die Kurve nach unten."
            />
          </section>
        )}

        {/* --- Einheiten in der Struktur ---------------------------------------
          Die Zahl, in der der Betrieb rechnet - hier je Kopf aufgeschluesselt.
          "Eigen" ist, was jemand selbst gemeldet hat, "Team" alles unter ihm.
          Bewusst getrennt von den Taetigkeits-Kennzahlen oben: das sind zwei
          Waehrungen, und Einheiten zaehlen in keiner Rangliste mit. */}
        {!begleiten && zeigeEinheiten && (
          <section className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 className={kicker}>Einheiten in deiner Struktur</h2>
              <span className="text-xs text-ink-muted">
                {produktionsmonat(berlinToday()).label} · selbst gemeldet
              </span>
            </div>
            {/* Emils zweiter Satz zu den Einheiten: "Einheitenaufteilung, eine
              Struktur erfuellt die 50%, damit du siehst, wo der Fokus drauf
              liegt" (AP-06). Reine Anzeige, keine Sperre - siehe Plan,
              Abschnitt 6. */}
            {fokusAst && (
              <p className={chip("warnung")}>
                Fokus liegt auf{" "}
                <GpName
                  name={fokusAst.person.name}
                  kurz={kurzMap.get(fokusAst.person.name)}
                />{" "}
                ({Math.round(fokusAst.anteil * 100)} %)
              </p>
            )}
            {/* min-w-160 erzwang 640 Pixel, der Inhalt braucht aber nur 474 -
              die restlichen 166 waren Leerraum, in den man am Handy
              hineinwischen konnte, als wuerde die Seite auseinanderfallen.
              Eine Mindestbreite soll verhindern, dass Spalten zusammenklappen,
              nicht Platz erfinden, den niemand fuellt. 26rem liegt unter der
              gemessenen Inhaltsbreite: die Tabelle ist so breit, wie sie sein
              muss, und rechts endet sie mit ihrer letzten Spalte. */}
            <div className={`${card} overflow-x-auto`}>
              <table className="w-full min-w-[26rem] text-left text-sm">
                <thead className="border-b border-line/80 bg-sunken/60">
                  <tr>
                    <th className={th}>Name</th>
                    <th className={`${th} text-right`}>Eigene</th>
                    <th className={`${th} text-right`}>Team</th>
                    <th className={`${th} text-right`}>Zusammen</th>
                    <th className={`${th} text-right`}>Stufe</th>
                    <th className={`${th} text-right`}>Anteil (Monat)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {alle.map((person) => {
                    const zahlen = einheiten.get(person.id);
                    if (!zahlen) return null;
                    const anteil = astAnteil(person);
                    return (
                      <tr
                        key={person.id}
                        className={person.istDu ? "bg-navy-50/40" : undefined}
                      >
                        <td className={`${td} font-medium text-ink`}>
                          <span
                            style={{
                              paddingLeft: `${Math.min(person.tiefe, 3) * 12}px`,
                            }}
                          >
                            {person.istDu ? (
                              "Du"
                            ) : (
                              <GpName
                                name={person.name}
                                kurz={kurzMap.get(person.name)}
                              />
                            )}
                          </span>
                        </td>
                        {/* Bei einem Platzhalter ist "0,00" keine Auskunft,
                          sondern eine Behauptung: er hat nie eingetragen, weil
                          er die App nicht hat. Sein Ast kann trotzdem zaehlen. */}
                        <td
                          className={`${td} text-right tabular-nums text-ink`}
                        >
                          {person.platzhalter
                            ? "—"
                            : formatEinheiten(zahlen.eigenGesamt)}
                        </td>
                        {/* Ein Blatt hat kein Team - dort steht nichts statt einer
                          Null ueber jemanden, der noch niemanden hat. */}
                        <td
                          className={`${td} text-right tabular-nums text-ink-muted`}
                        >
                          {person.fuehrt > 0
                            ? formatEinheiten(zahlen.teamGesamt)
                            : "—"}
                        </td>
                        <td
                          className={`${td} text-right font-semibold tabular-nums text-ink`}
                        >
                          {person.platzhalter && zahlen.astGesamt === 0
                            ? "—"
                            : formatEinheiten(zahlen.astGesamt)}
                        </td>
                        {/* Platzhalter und Ausgetretene stehen nicht in der
                          Map (stufenStandJe() filtert sie am Konto heraus) -
                          stufenZelle() zeigt fuer sie den Gedankenstrich. */}
                        <td
                          className={`${td} text-right tabular-nums text-ink-muted`}
                        >
                          {stufenZelle(stufenstand?.get(person.id))}
                        </td>
                        {/* Nur direkte Aeste bekommen einen Anteil - siehe
                          astAnteil() weiter oben. */}
                        <td className={`${td} text-right`}>
                          {anteil === null ? (
                            <span className="text-ink-soft">—</span>
                          ) : (
                            <div className="flex items-center justify-end gap-2">
                              <Fortschritt
                                anteil={anteil}
                                ton={
                                  anteil * 100 > fokusProzent
                                    ? "warnung"
                                    : "info"
                                }
                                hoehe="normal"
                                className="w-16"
                                beschriftung={`${Math.round(anteil * 100)} Prozent der Struktur-Summe`}
                              />
                              <span className="w-10 shrink-0 tabular-nums text-ink-muted">
                                {Math.round(anteil * 100)} %
                              </span>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className={kicker}>
              Einheiten trägt jeder selbst ein. „Team&ldquo; ist alles unter der
              Person, über alle Ebenen — sie zählen in keiner Rangliste mit, und
              auf die Karrierestufe zählen nur die eigenen. Der Anteil zeigt
              direkte Äste im Verhältnis zur eigenen Struktur-Summe im laufenden
              Monat — reine Anzeige, keine Sperre. Die Karrierestufe trägt jeder
              selbst ein; ohne Eintrag steht hier &bdquo;fehlt&ldquo; — kein
              Vorwurf, ein Anlass.
            </p>
          </section>
        )}

        {/* --- Das eigene Geschaeft --------------------------------------------
          Stand vorher als erste Karte zwischen den Leuten. Eine Fuehrungskraft
          fuehrt sich nicht selbst: die eigene Zeile gehoert getrennt, sonst
          vermischen sich zwei Arten von Arbeit auf einem Bildschirm. */}
        {!begleiten && (
          <section className={`${card} p-4 sm:p-5`}>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className={kicker}>Dein eigenes Geschäft</h2>
              <Link
                href="/heute"
                className="ml-auto text-13 font-medium text-navy-700 hover:underline"
              >
                Zu deiner Liste
              </Link>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-3">
              <Kennzahl
                wert={lage.ich.werte.anrufeWoche}
                bezeichnung="Anrufe (Woche)"
              />
              <Kennzahl
                wert={lage.ich.werte.vereinbartWoche}
                bezeichnung="Termine vereinbart"
              />
              <Kennzahl
                wert={lage.ich.werte.gehaltenWoche}
                bezeichnung="Termine gehalten"
              />
              <Kennzahl
                wert={lage.ich.werte.abschluesseMonat}
                bezeichnung="Abschlüsse (Monat)"
                betont
              />
              <Kennzahl
                wert={lage.ich.werte.inAkquise}
                bezeichnung="in Akquise"
              />
              <Kennzahl
                wert={lage.ich.werte.ueberfaellig}
                bezeichnung="überfällig"
              />
            </div>
            {lage.ich.signale.length > 0 && (
              <ul className="mt-4 space-y-2 border-t border-line pt-3">
                {lage.ich.signale.map((signal) => (
                  <SignalZeile key={signal.schluessel} signal={signal} />
                ))}
              </ul>
            )}
          </section>
        )}

        <p className="crm-team-footnote">
          Woche ab Montag, Monat ab dem Ersten, beides nach Berliner Kalender.
          Signale werden bei jedem Aufruf neu berechnet und nirgends
          gespeichert. Von den Kontakten siehst du die ersten{" "}
          {NAMENSFENSTER_TAGE} Tage nach dem Start den Vornamen — danach nur
          noch, wenn jemand seinen Verlauf offen lässt. Nachnamen, Notizen,
          Nummern, E-Mail-Adressen und Berufe nie.
        </p>
      </div>
    </VorfuehrProvider>
  );
}
