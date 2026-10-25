"use client";

// „Person aufnehmen" - jemand kommt in die Struktur, bevor er die App nutzt.
//
// Der Fall, um den es geht: ein Team wird ausgerollt. Die Struktur steht schon
// - Emil, vier Leute unter ihm, die Ebene darueber -, nur die Konten gibt es
// noch nicht. Wer das nicht eintragen kann, fuehrt seine Struktur nebenher in
// einer zweiten Liste, und ab diesem Moment stimmt eine von beiden nicht mehr.
//
// Der Haken „Einladungslink gleich miterzeugen" ist absichtlich freiwillig:
// abends traegt man die Struktur ein, und Tage spaeter greift man zum Telefon.
// Beides in einem Schritt zu erzwingen hiesse, dass man das Eintragen laesst.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Modal from "@/components/Modal";
import {
  personAufnehmen,
  einladungFuerPlatzhalter,
} from "@/app/(app)/mannschaft/actions";
import { btnPrimary, btnSecondary, input, label } from "@/components/ui";

export type MoeglicheFuehrung = { id: string; name: string; istDu: boolean };

/**
 * Die Herkunft kommt vom Server, nicht aus window.location.
 *
 * Sonst rendert der Server "/einladung/ABCD" und der Browser gleich darauf
 * "https://.../einladung/ABCD" - React meldet eine Abweichung, und einen
 * Wimpernschlag lang steht ein halber Link auf dem Bildschirm, den jemand
 * kopieren koennte. Dasselbe Muster wie in app/(app)/einladen/page.tsx.
 */
function LinkZeile({ code, herkunft }: { code: string; herkunft: string }) {
  const [kopiert, setKopiert] = useState(false);
  const link = `${herkunft}/einladung/${encodeURIComponent(code)}`;

  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
      <p className="text-sm font-medium text-emerald-900">Steht in der Struktur.</p>
      <p className="mt-1 break-all font-mono text-xs text-emerald-800">{link}</p>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(link).then(
            () => setKopiert(true),
            () => setKopiert(false)
          );
        }}
        className={`${btnSecondary} mt-2.5 min-h-9 py-1 text-13`}
      >
        {kopiert ? "Kopiert" : "Link kopieren"}
      </button>
    </div>
  );
}

export default function PersonAufnehmen({
  fuehrungen,
  herkunft,
}: {
  /** Alle, unter die gehängt werden darf — der eigene Ast, inklusive einem selbst. */
  fuehrungen: MoeglicheFuehrung[];
  /** Ursprung der Anwendung, serverseitig aus den Kopfzeilen. */
  herkunft: string;
}) {
  const [offen, setOffen] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const ich = fuehrungen.find((f) => f.istDu);

  const schliessen = () => {
    setOffen(false);
    setFehler(null);
    setCode(null);
  };

  return (
    <>
      <button type="button" onClick={() => setOffen(true)} className={btnSecondary}>
        Person aufnehmen
      </button>

      <Modal
        open={offen}
        onClose={schliessen}
        title="Person aufnehmen"
        subtitle="Steht sofort in der Struktur — auch ohne Konto."
      >
        <form
          action={(daten) => {
            startTransition(async () => {
              setFehler(null);
              const ergebnis = await personAufnehmen(daten);
              if (ergebnis && "fehler" in ergebnis && ergebnis.fehler) {
                setFehler(ergebnis.fehler);
                return;
              }
              setCode(ergebnis && "code" in ergebnis ? (ergebnis.code ?? null) : null);
              router.refresh();
            });
          }}
        >
          <div>
            <label htmlFor="name" className={label}>
              Name *
            </label>
            <input
              id="name"
              name="name"
              type="text"
              required
              maxLength={60}
              autoComplete="off"
              placeholder="Marc Bauer"
              className={input}
            />
          </div>

          <div className="mt-4">
            <label htmlFor="unterId" className={label}>
              Hängt unter
            </label>
            <select
              id="unterId"
              name="unterId"
              defaultValue={ich?.id ?? fuehrungen[0]?.id}
              className={input}
            >
              {fuehrungen.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.istDu ? `${f.name} (du)` : f.name}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-4">
            <label htmlFor="telefon" className={label}>
              Handy (freiwillig)
            </label>
            <input
              id="telefon"
              name="telefon"
              type="tel"
              maxLength={30}
              autoComplete="off"
              className={input}
            />
          </div>

          <label className="mt-4 flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-ink-muted">
            <input
              type="checkbox"
              name="mitEinladung"
              defaultChecked
              className="h-4 w-4 accent-navy-800"
            />
            Einladungslink gleich miterzeugen
          </label>

          {fehler && (
            <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-800">
              {fehler}
            </p>
          )}

          {code && (
            <div className="mt-3">
              <LinkZeile code={code} herkunft={herkunft} />
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button type="submit" disabled={pending} className={btnPrimary}>
              {pending ? "Nimmt auf …" : code ? "Noch eine aufnehmen" : "Aufnehmen"}
            </button>
            <button type="button" onClick={schliessen} className={btnSecondary}>
              {code ? "Fertig" : "Abbrechen"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

/**
 * Nachtraeglich einladen - fuer jemanden, der schon im Baum steht.
 *
 * Sitzt auf der Personenseite und nicht im Organigramm: im Kasten waere es ein
 * Knopf, den man beim Schieben trifft.
 */
export function EinladungNachreichen({
  fuerId,
  name,
  vorhandenerCode,
  herkunft,
}: {
  fuerId: string;
  name: string;
  vorhandenerCode: string | null;
  herkunft: string;
}) {
  const [code, setCode] = useState<string | null>(vorhandenerCode);
  const [fehler, setFehler] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <div className="space-y-3">
      {code ? (
        <LinkZeile code={code} herkunft={herkunft} />
      ) : (
        <p className="text-sm text-ink-muted">
          {name} steht in der Struktur, hat aber noch keine offene Einladung.
        </p>
      )}

      {fehler && <p className="text-sm text-red-700">{fehler}</p>}

      <button
        type="button"
        disabled={pending}
        onClick={() => {
          startTransition(async () => {
            setFehler(null);
            const daten = new FormData();
            daten.set("fuerId", fuerId);
            const ergebnis = await einladungFuerPlatzhalter(daten);
            if (ergebnis && "fehler" in ergebnis && ergebnis.fehler) {
              setFehler(ergebnis.fehler);
              return;
            }
            setCode(ergebnis && "code" in ergebnis ? (ergebnis.code ?? null) : null);
            router.refresh();
          });
        }}
        className={btnSecondary}
      >
        {pending ? "Erzeugt …" : code ? "Neuen Link erzeugen" : "Einladungslink erzeugen"}
      </button>
    </div>
  );
}
