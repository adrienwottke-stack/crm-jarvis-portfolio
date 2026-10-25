import Link from "next/link";
import { ladeHauptziel, ladeZiele } from "@/lib/ziele";
import { zielPruefzeit } from "@/lib/ziele-modell";
import Fortschritt from "@/components/Fortschritt";

export default async function ZielHeute({ userId }: { userId: string }) {
  const [ziel, ziele] = await Promise.all([
    ladeHauptziel(userId),
    ladeZiele(userId),
  ]);
  const vorschlaege = ziele.filter(
    (eintrag) =>
      eintrag.inhaberId === userId &&
      eintrag.zusage === "OFFEN" &&
      !eintrag.archiviertAt &&
      eintrag.ende > zielPruefzeit(eintrag.zeitraum),
  );
  return (
    <div className="space-y-3">
      {vorschlaege.length > 0 && (
        <Link
          href="/fortschritt#ziele"
          className="flex min-h-14 items-center justify-between gap-3 rounded-xl border border-line bg-surface p-4 text-base font-medium"
        >
          <span>
            {vorschlaege.length === 1
              ? "Ein Zielvorschlag wartet auf deine Antwort"
              : `${vorschlaege.length} Zielvorschläge warten auf deine Antwort`}
          </span>
          <span aria-hidden>→</span>
        </Link>
      )}
      {ziel ? (
        <Link
          href="/fortschritt#ziele"
          className="block space-y-3 rounded-xl border border-line bg-surface p-5"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-base font-medium">{ziel.titel}</p>
            <span aria-hidden>→</span>
          </div>
          <p className="text-2xl font-semibold tabular-nums">
            {ziel.standText}{" "}
            <span className="text-base font-normal">{ziel.kennzahlText}</span>
          </p>
          <Fortschritt
            anteil={ziel.anteil}
            hoehe="kraeftig"
            ton={ziel.geschafft ? "erfolg" : "info"}
            beschriftung={`${ziel.standText} ${ziel.kennzahlText}`}
          />
          {ziel.geschafft && (
            <p className="text-sm font-medium">Ziel erreicht. Stark gemacht.</p>
          )}
          {ziel.wunsch && (
            <p className="text-sm text-slate-600">{ziel.wunsch}</p>
          )}
        </Link>
      ) : (
        <Link
          href="/fortschritt/neu"
          className="block min-h-14 rounded-xl border border-line p-4 text-base font-medium"
        >
          Ein eigenes Ziel setzen →
        </Link>
      )}
    </div>
  );
}
