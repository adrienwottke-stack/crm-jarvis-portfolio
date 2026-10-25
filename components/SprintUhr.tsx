"use client";

// Die Sprint-Uhr. Laeuft im Browser, damit nicht fuer jede Sekunde die Seite
// neu geladen werden muss - der Stand daneben kommt weiterhin vom Server.

import { useEffect, useState } from "react";

function rest(endeIso: string): number {
  return Math.max(0, new Date(endeIso).getTime() - Date.now());
}

export default function SprintUhr({ ende }: { ende: string }) {
  const [ms, setMs] = useState(() => rest(ende));

  useEffect(() => {
    setMs(rest(ende));
    const id = setInterval(() => setMs(rest(ende)), 1000);
    return () => clearInterval(id);
  }, [ende]);

  const sekunden = Math.floor(ms / 1000);
  const min = Math.floor(sekunden / 60);
  const sek = sekunden % 60;

  if (ms <= 0) {
    return <span className="tabular-nums text-ink-muted">vorbei</span>;
  }

  return (
    <span className="tabular-nums text-2xl font-semibold tracking-tight text-ink">
      {min}:{String(sek).padStart(2, "0")}
    </span>
  );
}
