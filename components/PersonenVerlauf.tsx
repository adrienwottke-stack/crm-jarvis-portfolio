"use client";

import { useState } from "react";
import VerlaufsChart from "@/components/VerlaufsChart";
import type { Personenverlauf, PersonenKurven } from "@/lib/personen-verlauf";
import { cn, kicker, segmentGruppe, segmentKnopf, sectionTitle } from "@/components/ui";

const metriken: { id: keyof PersonenKurven; name: string }[] = [
  { id: "einheiten", name: "Einheiten" }, { id: "anrufe", name: "Anrufe" }, { id: "termine", name: "Termine vereinbart" },
];

export default function PersonenVerlauf({ daten, name }: { daten: Personenverlauf; name: string }) {
  const [umfang, setUmfang] = useState<"eigen" | "team">(daten.hatEigen ? "eigen" : "team");
  const [metrik, setMetrik] = useState<keyof PersonenKurven>("einheiten");
  const kurve = daten[umfang][metrik];
  const bezeichnung = metriken.find((m) => m.id === metrik)!.name;
  return (
    <section aria-label="Leistungsverlauf" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className={kicker}>Fortschritt</p>
          <h2 className={sectionTitle}>{umfang === "eigen" ? "Persönlicher Verlauf" : "Verlauf des Teams"}</h2>
        </div>
        {daten.hatEigen && daten.teamKoepfe > 0 && (
          <div className={segmentGruppe} role="group" aria-label="Leistungsumfang">
            <button className={segmentKnopf(umfang === "eigen")} aria-pressed={umfang === "eigen"} onClick={() => setUmfang("eigen")}>Eigenleistung</button>
            <button className={segmentKnopf(umfang === "team")} aria-pressed={umfang === "team"} onClick={() => setUmfang("team")}>Team ({daten.teamKoepfe})</button>
          </div>
        )}
      </div>
      <div className={cn(segmentGruppe, "w-full")} role="group" aria-label="Kennzahl">
        {metriken.map((m) => <button key={m.id} className={cn(segmentKnopf(metrik === m.id), "flex-1")} aria-pressed={metrik === m.id} onClick={() => setMetrik(m.id)}>{m.name}</button>)}
      </div>
      <VerlaufsChart key={`${umfang}-${metrik}`} {...kurve} heute={daten.heute} monatStart={daten.monatStart}
        zahlen={metrik === "einheiten" ? "einheiten" : "anzahl"} einheit={bezeichnung}
        leerText={`Für ${umfang === "eigen" ? name : "dieses Team"} sind noch keine ${bezeichnung} eingetragen.`}
        fussnote={`${umfang === "eigen" ? `Eigene Leistung von ${name}.` : `${daten.teamKoepfe} aktive ${daten.teamKoepfe === 1 ? "Person" : "Personen"} im Team, ohne die Eigenleistung von ${name}.`} ${metrik === "einheiten" ? "Inklusive Einheiten vor der App. Stornos ziehen die Kurve nach unten." : "Kumuliert aus den eingetragenen Aktivitäten. Tage ohne Eintrag verändern den Stand nicht."}`} />
    </section>
  );
}
