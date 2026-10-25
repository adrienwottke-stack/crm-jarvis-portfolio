"use client";

// Die Struktur als Bild - schiebbar und zoombar wie eine Leinwand.
//
// Vorher stand die Struktur als eingerueckte Kartenliste da. Bei drei Leuten
// geht das. Bei dreissig ueber vier Ebenen liest niemand mehr heraus, wer unter
// wem haengt - und genau das ist im Strukturvertrieb die Information, an der
// Fuehrung haengt: eine Fuehrungskraft greift nicht an der Ebene dazwischen
// vorbei, also muss sie die Ebene dazwischen sehen.
//
// Bewusst ohne Diagramm-Bibliothek. Das Projekt hat ausser Next, React und
// Prisma nichts, und hier geht es um ein Baumlayout und zwei Gesten - das ist
// weniger Code als die Einbindung waere.
//
// Die Kaesten sind echte <PersonLink>-Elemente im DOM, nicht auf ein Canvas gemalt.
// Damit funktionieren Tab-Reihenfolge und Screenreader ohne Zusatzarbeit, und
// die Seite traegt auch dann Inhalt, wenn die Gesten auf einem Geraet klemmen.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PersonLink from "@/components/PersonLink";
import { ampelFarben, ampelTexte, type Ampel } from "@/lib/signale";

export type OrgaKnoten = {
  id: string;
  name: string;
  elternId: string | null;
  ampel: Ampel;
  istDu: boolean;
  platzhalter: boolean;
  eingeladen: boolean;
  ausgetreten: boolean;
  fuehrt: number;
  /** Eine Zeile Leistung - oder beim Platzhalter sein Zustand. */
  kopf: string;
  /** Nur bei Fuehrungskraeften: was der Ast unter ihm leistet. */
  ast: string | null;
  /**
   * Fuehrungskette UEBER dem Betrachter - zur Einordnung, nicht zur Fuehrung.
   *
   * Diese Kaesten gehoeren zu keinem Ast, den der Betrachter sehen darf: kein
   * Punkt, keine Zahlen, kein Klick. Ihr Platz im Bild beantwortet nur eine
   * Frage - unter wem haenge ich -, keine zweite.
   */
  istUeber: boolean;
};

// Feste Kastenmasse. Das Layout muss vor dem Zeichnen feststehen - gemessene
// Hoehen wuerden einen zweiten Durchlauf und ein Flackern bedeuten.
//
// Deshalb rechnet die Leinwand als einzige Stelle der App in Pixeln statt in
// rem: die Kastenmasse hier und die Schrift in den Kaesten muessen dasselbe
// Mass haben. Waechst die Schrift mit der Wurzel, der Kasten aber nicht, faellt
// der Name auf einem grossen Schirm aus seinem Rahmen. Groesser wird die
// Zeichnung trotzdem - aber als Ganzes, ueber die Anfangs-Vergroesserung in
// `einpassen`.
const KASTEN_B = 196;
const KASTEN_H = 88;
const LUECKE_X = 26;
const LUECKE_Y = 54;
const RAND = 24;

const SKALA_MIN = 0.3;
const SKALA_MAX = 2.5;
/** Ab so vielen Pixeln war es ein Ziehen und kein Tippen. */
const ZIEH_SCHWELLE = 5;

type Punkt = { x: number; y: number };
type Sicht = { x: number; y: number; s: number };

/**
 * Baumlayout in einem Durchlauf.
 *
 * Blaetter bekommen von links nach rechts fortlaufende Positionen, Eltern
 * setzen sich mittig ueber ihr erstes und letztes Kind. Weil die Blaetter in
 * Tiefensuche-Reihenfolge vergeben werden, liegt jeder Teilbaum in einem
 * geschlossenen Streifen - Ueberschneidungen zwischen Geschwistern koennen
 * damit gar nicht erst entstehen.
 */
function baulayout(knoten: OrgaKnoten[]) {
  const kinderVon = new Map<string, OrgaKnoten[]>();
  const bekannt = new Set(knoten.map((k) => k.id));
  const wurzeln: OrgaKnoten[] = [];

  for (const k of knoten) {
    // Ein Elternteil ausserhalb der Sicht macht den Knoten zur Wurzel - sonst
    // fiele er lautlos aus dem Bild.
    if (k.elternId && bekannt.has(k.elternId)) {
      const liste = kinderVon.get(k.elternId) ?? [];
      liste.push(k);
      kinderVon.set(k.elternId, liste);
    } else {
      wurzeln.push(k);
    }
  }

  const pos = new Map<string, Punkt>();
  let naechstesX = 0;

  // Iterativ statt rekursiv: eine tiefe Struktur soll den Aufrufstapel nicht
  // sprengen, und ein Kreis in den Daten das Bild nicht einfrieren.
  const gesehen = new Set<string>();
  const stapel: { knoten: OrgaKnoten; tiefe: number; phase: 0 | 1 }[] = [];
  for (let i = wurzeln.length - 1; i >= 0; i--) {
    stapel.push({ knoten: wurzeln[i]!, tiefe: 0, phase: 0 });
  }

  while (stapel.length > 0) {
    const eintrag = stapel.pop()!;
    const { knoten: k, tiefe, phase } = eintrag;
    const kinder = kinderVon.get(k.id) ?? [];

    if (phase === 0) {
      if (gesehen.has(k.id)) continue;
      gesehen.add(k.id);
      if (kinder.length === 0) {
        pos.set(k.id, { x: naechstesX, y: tiefe * (KASTEN_H + LUECKE_Y) });
        naechstesX += KASTEN_B + LUECKE_X;
        continue;
      }
      // Erst die Kinder setzen, danach sich selbst darueber zentrieren.
      stapel.push({ knoten: k, tiefe, phase: 1 });
      for (let i = kinder.length - 1; i >= 0; i--) {
        stapel.push({ knoten: kinder[i]!, tiefe: tiefe + 1, phase: 0 });
      }
      continue;
    }

    const gesetzt = kinder.map((kind) => pos.get(kind.id)).filter(Boolean) as Punkt[];
    const x =
      gesetzt.length > 0
        ? (gesetzt[0]!.x + gesetzt[gesetzt.length - 1]!.x) / 2
        : naechstesX;
    pos.set(k.id, { x, y: tiefe * (KASTEN_H + LUECKE_Y) });
  }

  let breite = 0;
  let hoehe = 0;
  for (const p of pos.values()) {
    breite = Math.max(breite, p.x + KASTEN_B);
    hoehe = Math.max(hoehe, p.y + KASTEN_H);
  }

  // Winkel-Pfade Eltern -> Kind. Die Form, die man als Organigramm erkennt.
  const linien: string[] = [];
  for (const k of knoten) {
    const kind = pos.get(k.id);
    const eltern = k.elternId ? pos.get(k.elternId) : null;
    if (!kind || !eltern) continue;
    const vonX = eltern.x + KASTEN_B / 2;
    const vonY = eltern.y + KASTEN_H;
    const bisX = kind.x + KASTEN_B / 2;
    const bisY = kind.y;
    const mitteY = vonY + LUECKE_Y / 2;
    linien.push(`M ${vonX} ${vonY} V ${mitteY} H ${bisX} V ${bisY}`);
  }

  return { pos, linien, breite, hoehe };
}

function abstand(a: Punkt, b: Punkt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export default function Organigramm({ knoten }: { knoten: OrgaKnoten[] }) {
  const { pos, linien, breite, hoehe } = useMemo(() => baulayout(knoten), [knoten]);
  const rahmen = useRef<HTMLDivElement>(null);
  const [sicht, setSicht] = useState<Sicht>({ x: RAND, y: RAND, s: 1 });

  // Zeiger, die gerade auf der Flaeche liegen. Zwei davon heisst kneifen.
  const zeiger = useRef(new Map<number, Punkt>());
  const zug = useRef<{ start: Punkt; sicht: Sicht } | null>(null);
  const kniff = useRef<{ abstand: number; mitte: Punkt; sicht: Sicht } | null>(null);
  // Wird beim Ziehen gesetzt und verhindert, dass das Loslassen als Klick auf
  // einen Kasten durchgeht. Ohne das navigiert jedes Schieben.
  //
  // Zurueckgesetzt wird erst beim naechsten pointerdown - und genau deshalb
  // darf die Sperre NICHT fuer Klicks gelten, die ohne Zeiger entstehen. Wer
  // einmal geschoben hat und danach mit der Tastatur auf einen Kasten geht,
  // haette sonst eine tote Eingabetaste, ohne je zu erfahren warum. Siehe die
  // Abfrage auf `detail` unten.
  const gezogen = useRef(false);

  // Hat sich jemand seinen eigenen Ausschnitt gesucht? Dann darf ihn eine
  // Groessenaenderung des Rahmens nicht wieder wegnehmen.
  const selbstEingestellt = useRef(false);

  const einpassen = useCallback(() => {
    const el = rahmen.current;
    if (!el || breite === 0) return;
    selbstEingestellt.current = false;
    // Die Zeichnung rechnet in festen Pixeln, die Oberflaeche drumherum waechst
    // mit der Wurzel-Schriftgroesse. Genau dieser Faktor ist deshalb die
    // Anfangs-Vergroesserung: sonst stuende der Baum auf einem grossen Schirm
    // als Briefmarke neben Text, der laengst mitgewachsen ist. Passt er nicht
    // hinein, gewinnt weiterhin das Einpassen.
    const wurzel =
      parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const s = Math.min(
      wurzel / 16,
      (el.clientWidth - RAND * 2) / breite,
      (el.clientHeight - RAND * 2) / hoehe
    );
    setSicht({
      x: (el.clientWidth - breite * s) / 2,
      y: RAND,
      s: Math.max(SKALA_MIN, s),
    });
  }, [breite, hoehe]);

  // Beim Oeffnen ist der ganze Baum zu sehen, egal wie breit er ist.
  useEffect(() => {
    einpassen();
  }, [einpassen]);

  // Der Rahmen hat keine feste Groesse mehr, er haengt an Fensterbreite und
  // -hoehe. Wer das Fenster zieht oder das Handy dreht, haette sonst einen
  // Baum, der halb aus dem Bild ragt: einmal messen reicht nicht.
  useEffect(() => {
    const el = rahmen.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const beobachter = new ResizeObserver(() => {
      if (!selbstEingestellt.current) einpassen();
    });
    beobachter.observe(el);
    return () => beobachter.disconnect();
  }, [einpassen]);

  const zuMir = useCallback(() => {
    const el = rahmen.current;
    const ich = knoten.find((k) => k.istDu);
    const p = ich ? pos.get(ich.id) : null;
    if (!el || !p) return;
    selbstEingestellt.current = true;
    setSicht((alt) => ({
      ...alt,
      x: el.clientWidth / 2 - (p.x + KASTEN_B / 2) * alt.s,
      y: el.clientHeight / 3 - (p.y + KASTEN_H / 2) * alt.s,
    }));
  }, [knoten, pos]);

  /** Zoomt um einen Bildschirmpunkt herum, damit er unter dem Finger bleibt. */
  const zoomeUm = useCallback((punkt: Punkt, faktor: number) => {
    selbstEingestellt.current = true;
    setSicht((alt) => {
      const s = Math.min(SKALA_MAX, Math.max(SKALA_MIN, alt.s * faktor));
      const echt = s / alt.s;
      return {
        s,
        x: punkt.x - (punkt.x - alt.x) * echt,
        y: punkt.y - (punkt.y - alt.y) * echt,
      };
    });
  }, []);

  // Das Rad haengt am Element statt an React: onWheel ist passiv, und ein
  // passiver Zuhoerer darf das Scrollen der Seite nicht unterdruecken. Ohne
  // preventDefault zoomt die Leinwand UND die Seite springt.
  useEffect(() => {
    const el = rahmen.current;
    if (!el) return;
    const amRad = (e: WheelEvent) => {
      e.preventDefault();
      const kasten = el.getBoundingClientRect();
      const punkt = { x: e.clientX - kasten.left, y: e.clientY - kasten.top };
      // Trackpad-Kneifen kommt als Rad mit ctrlKey an und braucht einen
      // feineren Schritt als ein Mausrad-Rasten.
      const faktor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002));
      zoomeUm(punkt, faktor);
    };
    el.addEventListener("wheel", amRad, { passive: false });
    return () => el.removeEventListener("wheel", amRad);
  }, [zoomeUm]);

  const relativ = (e: React.PointerEvent): Punkt => {
    const kasten = rahmen.current!.getBoundingClientRect();
    return { x: e.clientX - kasten.left, y: e.clientY - kasten.top };
  };

  const amZeigerRunter = (e: React.PointerEvent) => {
    const p = relativ(e);
    zeiger.current.set(e.pointerId, p);
    // Erst beim echten Ziehen einfangen. Sofortiges Einfangen auf dem Rahmen
    // lenkt auch einen einfachen Link-Klick auf den Rahmen um.

    if (zeiger.current.size === 1) {
      gezogen.current = false;
      zug.current = { start: p, sicht };
      kniff.current = null;
    } else if (zeiger.current.size === 2) {
      const [a, b] = [...zeiger.current.values()];
      zug.current = null;
      kniff.current = {
        abstand: abstand(a!, b!),
        mitte: { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 },
        sicht,
      };
      // Zwei Finger heissen immer Geste, nie Klick.
      gezogen.current = true;
      for (const pointerId of zeiger.current.keys()) {
        try { e.currentTarget.setPointerCapture(pointerId); } catch { /* Geste bleibt auch ohne Einfangen bedienbar. */ }
      }
    }
  };

  const amZeigerBewegt = (e: React.PointerEvent) => {
    if (!zeiger.current.has(e.pointerId)) return;
    const p = relativ(e);
    zeiger.current.set(e.pointerId, p);

    if (zeiger.current.size >= 2 && kniff.current) {
      const [a, b] = [...zeiger.current.values()];
      const neuerAbstand = abstand(a!, b!);
      if (kniff.current.abstand === 0) return;
      const basis = kniff.current;
      const roh = basis.sicht.s * (neuerAbstand / basis.abstand);
      const s = Math.min(SKALA_MAX, Math.max(SKALA_MIN, roh));
      const echt = s / basis.sicht.s;
      setSicht({
        s,
        x: basis.mitte.x - (basis.mitte.x - basis.sicht.x) * echt,
        y: basis.mitte.y - (basis.mitte.y - basis.sicht.y) * echt,
      });
      return;
    }

    if (!zug.current) return;
    const dx = p.x - zug.current.start.x;
    const dy = p.y - zug.current.start.y;
    if (Math.hypot(dx, dy) > ZIEH_SCHWELLE) {
      if (!gezogen.current) {
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* Weiter ohne Einfangen. */ }
      }
      gezogen.current = true;
      selbstEingestellt.current = true;
    }
    if (!gezogen.current) return;
    setSicht({ s: zug.current.sicht.s, x: zug.current.sicht.x + dx, y: zug.current.sicht.y + dy });
  };

  const amZeigerHoch = (e: React.PointerEvent) => {
    zeiger.current.delete(e.pointerId);
    if (zeiger.current.size < 2) kniff.current = null;
    if (zeiger.current.size === 0) zug.current = null;
  };

  const knopf =
    "inline-flex h-11 min-w-11 items-center justify-center rounded-lg border border-line-strong bg-surface px-2.5 text-sm font-medium text-ink-muted schatten-karte transition hover:border-line-strong hover:text-ink";

  return (
    <div
      ref={rahmen}
      onPointerDown={amZeigerRunter}
      onPointerMove={amZeigerBewegt}
      onPointerUp={amZeigerHoch}
      onPointerCancel={amZeigerHoch}
      onPointerLeave={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) amZeigerHoch(event);
      }}
      // Ohne touch-action scrollt das Handy die Seite, statt die Leinwand zu
      // schieben - und Kneifen zoomt den Browser statt des Baums.
      style={{ touchAction: "none" }}
      // Statt zweier fester Hoehen: so viel vom Fenster, wie uebrig ist -
      // mit Grenzen, damit die Leinwand am Handy nicht zum Streifen wird und
      // am grossen Schirm nicht die ganze Seite verschluckt.
      className="relative h-[clamp(20rem,62svh,44rem)] w-full cursor-grab overflow-hidden rounded-xl border border-line bg-sunken/60 active:cursor-grabbing"
    >
      <div
        style={{
          transform: `translate(${sicht.x}px, ${sicht.y}px) scale(${sicht.s})`,
          transformOrigin: "0 0",
          width: breite,
          height: hoehe,
        }}
        className="relative"
      >
        <svg
          width={breite}
          height={hoehe}
          className="pointer-events-none absolute inset-0 overflow-visible"
          aria-hidden
        >
          {linien.map((d, i) => (
            <path
              key={i}
              d={d}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              className="text-line-strong"
            />
          ))}
        </svg>

        {knoten.map((k) => {
          const p = pos.get(k.id);
          if (!p) return null;

          // Wer ueber dem Betrachter haengt, ist kein Kasten aus seinem Ast:
          // kein Klick (dessen Seite darf er nicht oeffnen), keine Ampel
          // (deren Stand kennt er nicht), nur der Name als Einordnung.
          if (k.istUeber) {
            return (
              <div
                key={k.id}
                style={{ left: p.x, top: p.y, width: KASTEN_B, height: KASTEN_H }}
                className="absolute flex flex-col items-center justify-center rounded-[12px] border border-dashed border-line bg-sunken/70 px-[12px] py-[8px]"
              >
                <span className="truncate text-[14px] font-medium text-ink-muted">
                  {k.name}
                </span>
              </div>
            );
          }

          return (
            <PersonLink
              key={k.id}
              href={`/mannschaft/${k.id}`}
              onClick={(e) => {
                // Das Loslassen nach einem Zug ist kein Klick.
                //
                // `detail` zaehlt die Klicks des Zeigers und steht bei einem
                // Klick, den die Tastatur ausgeloest hat, auf 0. Nur echte
                // Zeiger-Klicks koennen ueberhaupt aus einem Zug stammen -
                // alles andere waere eine Sperre gegen jemanden, der gar nicht
                // geschoben hat.
                if (e.detail !== 0 && gezogen.current) e.preventDefault();
              }}
              draggable={false}
              style={{ left: p.x, top: p.y, width: KASTEN_B, height: KASTEN_H }}
              className={`absolute flex flex-col justify-center gap-[2px] rounded-[12px] border bg-surface px-[12px] py-[8px] schatten-karte transition duration-200 hover:border-navy-400 hover:schatten-hoch ${
                k.istDu
                  ? // Eigene Position im Baum - keine Badge-Kontur, sondern die
                    // Hervorhebung des einen Kastens, an dem man selbst steht.
                    "border-akzent ring-1 ring-akzent/25"
                  : k.platzhalter
                    ? "border-dashed border-line-strong"
                    : "border-line"
              } ${k.ausgetreten ? "opacity-50" : ""}`}
            >
              <span className="flex items-center gap-[6px]">
                <span
                  aria-hidden
                  className={`h-[10px] w-[10px] shrink-0 rounded-full ${
                    k.platzhalter
                      ? "border-2 border-line-strong bg-surface"
                      : `${ampelFarben[k.ampel]} ${k.ampel === "rot" ? "animate-halo" : ""}`
                  }`}
                />
                <span className="truncate text-[14px] font-semibold text-ink">
                  {k.name}
                </span>
                <span className="sr-only">{ampelTexte[k.ampel]}</span>
              </span>

              <span className="truncate text-[11px] text-ink-muted">{k.kopf}</span>

              {k.ast && (
                <span className="truncate text-[11px] font-medium text-navy-700">
                  {k.ast}
                </span>
              )}
            </PersonLink>
          );
        })}
      </div>

      <div className="absolute bottom-3 right-3 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => zoomeUm({ x: (rahmen.current?.clientWidth ?? 0) / 2, y: (rahmen.current?.clientHeight ?? 0) / 2 }, 1 / 1.25)}
          className={knopf}
          aria-label="Herauszoomen"
        >
          −
        </button>
        <button
          type="button"
          onClick={() => zoomeUm({ x: (rahmen.current?.clientWidth ?? 0) / 2, y: (rahmen.current?.clientHeight ?? 0) / 2 }, 1.25)}
          className={knopf}
          aria-label="Hineinzoomen"
        >
          +
        </button>
        <button type="button" onClick={einpassen} className={knopf}>
          Einpassen
        </button>
        <button type="button" onClick={zuMir} className={knopf}>
          Ich
        </button>
      </div>
    </div>
  );
}
