"use client";

// Die Kandidatur-Karte auf der Kontaktseite (docs/recruiting-plan.md, §2.1,
// Bauabschnitt 1): ohne Kandidatur ein ruhiger Anlege-Knopf, mit Kandidatur
// der Sieben-Phasen-Stepper plus der Zusage-Knopf, der die Einladung erzeugt.
//
// Der QR-Code kommt als bereits gerenderter Server-Baustein von aussen
// (components/schleuse/QrCode.tsx ist eine async Server-Komponente und laesst
// sich aus einer Client-Komponente nicht direkt aufrufen). Die Kontaktseite
// reicht ihn deshalb als fertiges Element durch - dasselbe Prinzip wie bei
// `herkunft`: die volle URL kommt vom Server, nicht aus window.location, sonst
// zeigt der erste Frame einen halben Link (siehe components/PersonAufnehmen.tsx).

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  kandidaturAnlegen,
  kandidaturPhaseSetzen,
  zusageErteilen,
} from "@/app/(app)/namen/kandidaturActions";
import {
  KANDIDATUR_PHASEN,
  kandidaturPhaseLabels,
  kandidaturPlaybook,
  zeigtZusageKnopf,
  type KandidaturKarteDaten,
} from "@/lib/kandidatur";
import { nextStepLabels } from "@/lib/pipeline";
import type { KandidaturPhase } from "@/lib/generated/prisma/enums";
import {
  btnPrimary,
  btnSecondary,
  card,
  cn,
  kicker,
  sectionTitle,
  segmentGruppe,
  segmentKnopf,
} from "@/components/ui";

const dateFormat = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" });

type Einladung = { code: string; expiresAt: Date };

export default function KandidaturKarte({
  contactId,
  contactName,
  kandidatur: anfangsKandidatur,
  herkunft,
  qrCode,
}: {
  contactId: string;
  contactName: string;
  /** Die offene Kandidatur zu diesem Kontakt, oder null - dann noch keine. */
  kandidatur: KandidaturKarteDaten | null;
  /** Ursprung fuer den vollen Einladungslink, von der Kontaktseite via headers(). */
  herkunft: string;
  /** Fertig gerenderter QR-Code, falls schon eine Einladung existiert. */
  qrCode: ReactNode;
}) {
  const router = useRouter();
  const [kandidatur, setKandidatur] = useState(anfangsKandidatur);
  const [einladung, setEinladung] = useState<Einladung | null>(
    anfangsKandidatur?.invite ?? null
  );
  const [pending, startTransition] = useTransition();
  const [fehler, setFehler] = useState<string | null>(null);

  // Nach zusageErteilen() setzt der Server auch den naechsten Schritt
  // (nachfassen, ob installiert) - Felder, die die optimistische Aktualisierung
  // unten bewusst nicht nachbaut. router.refresh() holt sie ueber ein frisches
  // Prop nach; dieser Effekt gleicht den lokalen Stand dann nachtraeglich an,
  // sonst wuerde useState(anfangsKandidatur) das neue Prop stillschweigend
  // ignorieren - es liest den Anfangswert nur beim allerersten Rendern.
  useEffect(() => {
    setKandidatur(anfangsKandidatur);
    setEinladung(anfangsKandidatur?.invite ?? null);
  }, [anfangsKandidatur]);

  const anlegen = () => {
    setFehler(null);
    startTransition(async () => {
      try {
        const neu = await kandidaturAnlegen(contactId);
        setKandidatur(neu);
        setEinladung(neu.invite);
        router.refresh();
      } catch (err) {
        setFehler(err instanceof Error ? err.message : "Das hat nicht geklappt.");
      }
    });
  };

  const phaseSetzen = (phase: KandidaturPhase) => {
    if (!kandidatur || phase === kandidatur.phase) return;
    setFehler(null);
    startTransition(async () => {
      try {
        const aktualisiert = await kandidaturPhaseSetzen(kandidatur.id, phase);
        setKandidatur(aktualisiert);
        setEinladung(aktualisiert.invite);
        router.refresh();
      } catch (err) {
        setFehler(err instanceof Error ? err.message : "Das hat nicht geklappt.");
      }
    });
  };

  const zusage = () => {
    if (!kandidatur) return;
    setFehler(null);
    startTransition(async () => {
      try {
        const neueEinladung = await zusageErteilen(kandidatur.id);
        setEinladung(neueEinladung);
        setKandidatur({ ...kandidatur, phase: "ZUSAGE", invite: neueEinladung });
        // Holt den echten QR-Code nach (Server-Komponente, siehe oben) - der
        // Link und der Kopieren-Knopf stehen davor schon aus der Rueckgabe.
        router.refresh();
      } catch (err) {
        setFehler(err instanceof Error ? err.message : "Das hat nicht geklappt.");
      }
    });
  };

  if (!kandidatur) {
    return (
      <section className={`${card} p-5 sm:p-6`}>
        <p className={kicker}>Aufbau</p>
        <h2 className={`${sectionTitle} mt-1`}>Als Kandidat führen</h2>
        <p className="mt-1.5 text-sm text-ink-muted">
          {contactName} steht auf der Recruiting-Liste. Eine Kandidatur führt
          ihn durch die sieben Phasen bis zur Zusage.
        </p>
        <button
          type="button"
          onClick={anlegen}
          disabled={pending}
          className={`${btnPrimary} mt-4`}
        >
          {pending ? "Wird angelegt …" : "Als Kandidat führen"}
        </button>
        {fehler && <p className="mt-2.5 text-sm text-red-700">{fehler}</p>}
      </section>
    );
  }

  const knopfSichtbar = !einladung && zeigtZusageKnopf(kandidatur.phase);

  return (
    <section className={`${card} p-5 sm:p-6`}>
      <p className={kicker}>Aufbau</p>
      <h2 className={`${sectionTitle} mt-1`}>Kandidatur</h2>

      <div
        className={cn(segmentGruppe, "no-scrollbar mt-3 w-full overflow-x-auto")}
        role="group"
        aria-label="Phase der Kandidatur"
      >
        {KANDIDATUR_PHASEN.map((phase) => (
          <button
            key={phase}
            type="button"
            disabled={pending}
            aria-current={phase === kandidatur.phase ? "step" : undefined}
            onClick={() => phaseSetzen(phase)}
            className={cn(
              segmentKnopf(phase === kandidatur.phase),
              "flex-1 shrink-0 whitespace-nowrap disabled:opacity-60"
            )}
          >
            {kandidaturPhaseLabels[phase]}
          </button>
        ))}
      </div>

      <p className="mt-3 text-sm text-ink-muted">{kandidaturPlaybook[kandidatur.phase]}</p>

      {kandidatur.nextStepType && kandidatur.nextStepAt && (
        <p className="mt-2 text-xs text-ink-soft">
          Nächster Schritt: {nextStepLabels[kandidatur.nextStepType]} ·{" "}
          {dateFormat.format(kandidatur.nextStepAt)}
          {kandidatur.nextStepNote ? ` · ${kandidatur.nextStepNote}` : ""}
        </p>
      )}

      {(kandidatur.motiv || kandidatur.situation) && (
        <div className="mt-3 space-y-1 rounded-lg bg-sunken px-3 py-2">
          {kandidatur.motiv && (
            <p className="text-xs italic text-ink-muted">„{kandidatur.motiv}“</p>
          )}
          {kandidatur.situation && (
            <p className="text-xs text-ink-soft">{kandidatur.situation}</p>
          )}
        </div>
      )}

      {fehler && <p className="mt-3 text-sm text-red-700">{fehler}</p>}

      {knopfSichtbar && (
        <button
          type="button"
          onClick={zusage}
          disabled={pending}
          className={`${btnPrimary} mt-4`}
        >
          {pending ? "Wird erzeugt …" : "Zusage – Einladung verschicken"}
        </button>
      )}

      {einladung && (
        <EinladungAnzeige
          code={einladung.code}
          expiresAt={einladung.expiresAt}
          herkunft={herkunft}
          qrCode={qrCode}
        />
      )}
    </section>
  );
}

// Wiederverwendet das Muster aus app/(app)/einladen/page.tsx: voller Link,
// Kopieren-Knopf, QR-Code darunter.
function EinladungAnzeige({
  code,
  expiresAt,
  herkunft,
  qrCode,
}: {
  code: string;
  expiresAt: Date;
  herkunft: string;
  qrCode: ReactNode;
}) {
  const [kopiert, setKopiert] = useState(false);
  const link = `${herkunft}/einladung/${encodeURIComponent(code)}`;

  return (
    <div className="mt-4 space-y-3 border-t border-line pt-4">
      <p className="text-sm font-medium text-ink">Einladung erzeugt</p>
      <code className="block break-all text-sm text-ink">{link}</code>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(link).then(
              () => setKopiert(true),
              () => setKopiert(false)
            );
          }}
          className={`${btnSecondary} min-h-9 py-1 text-13`}
        >
          {kopiert ? "Kopiert" : "Link kopieren"}
        </button>
        <span className="text-xs text-ink-muted">
          gültig bis {dateFormat.format(expiresAt)}
        </span>
      </div>
      {qrCode && <div className="pt-1">{qrCode}</div>}
    </div>
  );
}
