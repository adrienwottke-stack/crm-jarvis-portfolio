"use client";

import { useState, useTransition } from "react";
import { einladungFuerMich, type NeueEinladung } from "@/app/(app)/einladen/actions";
import { fuehrungsKarten } from "@/lib/willkommen";

// Der Fuehrungskraefte-Weg: drei Karten erklaeren Mannschaft, Ampel und das
// Einladen - danach wird nicht weitererklaert, sondern die erste Einladung
// wirklich verschickt. Ein Onboarding fuer Fuehrung endet mit einem Link im
// Team-Chat, nicht mit "viel Erfolg".

export function FuehrungsKarten({ onDone }: { onDone: () => void }) {
  const [index, setIndex] = useState(0);
  const karte = fuehrungsKarten[index]!;
  const letzte = index + 1 >= fuehrungsKarten.length;

  return (
    <div className="flex h-full flex-col justify-center gap-6">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
        {index + 1} von {fuehrungsKarten.length} · {karte.ziel}
      </p>
      <div key={index} className="animate-rise space-y-3">
        <h2 className="text-3xl font-bold leading-tight text-white">{karte.titel}</h2>
        <p className="text-base leading-relaxed text-slate-300">{karte.text}</p>
      </div>
      <button
        type="button"
        onClick={() => (letzte ? onDone() : setIndex(index + 1))}
        className="min-h-12 w-full rounded-xl bg-akzent text-15 font-bold text-white transition hover:bg-akzent-stark active:scale-[0.98]"
      >
        {letzte ? "Dann lad ich mal ein" : "Weiter"}
      </button>
    </div>
  );
}

export function EinladenAkt({ onDone }: { onDone: () => void }) {
  const [einladung, setEinladung] = useState<NeueEinladung | null>(null);
  const [greeting, setGreeting] = useState("");
  const [pending, startTransition] = useTransition();
  const [kopiert, setKopiert] = useState(false);

  const erzeugen = () => {
    const data = new FormData();
    if (greeting.trim()) data.set("greeting", greeting.trim());
    startTransition(async () => {
      setEinladung(await einladungFuerMich(data));
    });
  };

  const link =
    einladung && typeof window !== "undefined"
      ? `${window.location.origin}/einladung/${einladung.code}`
      : "";

  if (!einladung) {
    return (
      <div className="flex h-full flex-col justify-center gap-6">
        <div>
          <h2 className="text-2xl font-bold text-white">Deine erste Einladung.</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-300">
            Der Neue bekommt deine Zeile als allererste Chatnachricht — bevor
            die App irgendwas erklärt. Kein Template schlägt das.
          </p>
        </div>
        <div>
          <label htmlFor="greeting" className="block text-13 font-medium text-slate-300">
            Deine persönliche Zeile (optional, aber mach sie)
          </label>
          <textarea
            id="greeting"
            rows={3}
            maxLength={240}
            value={greeting}
            onChange={(event) => setGreeting(event.target.value)}
            placeholder="Max, du hast gesagt du willst raus aus dem Lager. Los geht's."
            className="mt-1.5 w-full rounded-xl border border-white/25 bg-white/5 px-4 py-3 text-15 text-white placeholder:text-slate-500 focus:border-akzent focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={erzeugen}
          disabled={pending}
          className="min-h-12 w-full rounded-xl bg-akzent text-15 font-bold text-white transition hover:bg-akzent-stark active:scale-[0.98] disabled:opacity-40"
        >
          {pending ? "Wird erzeugt …" : "Link erzeugen"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="block w-full text-center text-sm text-slate-400 hover:text-white"
        >
          Später
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col justify-center gap-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Fertig. Jetzt raus damit.</h2>
        <p className="mt-1.5 text-sm text-slate-300">
          14 Tage gültig, eine Nutzung. Mehr Links und QR-Codes für den
          Infoabend gibt es unter „Einladen“.
        </p>
      </div>
      <code className="glas-dunkel block break-all rounded-2xl border border-white/10 px-4 py-3 text-sm text-white">
        {link}
      </code>
      <div className="space-y-3">
        <a
          href={`https://wa.me/?text=${encodeURIComponent(
            `${greeting.trim() ? `${greeting.trim()}\n\n` : ""}Dein Zugang zu unserem Team-CRM – dauert 3 Minuten: ${link}`
          )}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-12 w-full items-center justify-center rounded-xl bg-akzent text-15 font-bold text-white transition hover:bg-akzent-stark"
        >
          Per WhatsApp verschicken
        </a>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link);
              setKopiert(true);
              setTimeout(() => setKopiert(false), 2000);
            } catch {
              // Dann eben von Hand markieren - der Link steht ja da.
            }
          }}
          className="min-h-12 w-full rounded-xl border border-white/25 bg-white/5 text-15 font-semibold text-white transition hover:bg-white/10"
        >
          {kopiert ? "Kopiert ✓" : "Link kopieren"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="block w-full text-center text-sm text-slate-400 hover:text-white"
        >
          Weiter
        </button>
      </div>
    </div>
  );
}
