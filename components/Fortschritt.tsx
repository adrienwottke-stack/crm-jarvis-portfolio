import { cn, type Ton } from "@/components/ui";

// Ein Balken fuer die ganze Anwendung.
//
// Vorher gab es sechs handgebaute Varianten in vier Hoehen (3 px, 1.5, 2, 1) -
// jede Seite hatte ihre eigene Vorstellung davon, wie Fortschritt aussieht.
// Das hier ist einer, mit denselben Toenen wie der Rest der Oberflaeche.
//
// Der Balken waechst beim Erscheinen von links heraus (animate-bar). Das ist
// kein Selbstzweck: eine Laenge, die man wachsen sieht, schaetzt man besser
// ein als eine, die einfach da ist. Bei reduzierter Bewegung steht er sofort.

const fuellung: Record<Ton, string> = {
  neutral: "bg-slate-400",
  info: "bg-akzent",
  erfolg: "bg-emerald-500",
  warnung: "bg-amber-500",
  gefahr: "bg-red-500",
};

const hoehen = {
  duenn: "h-[3px]",
  normal: "h-1",
  kraeftig: "h-2",
} as const;

export default function Fortschritt({
  anteil,
  ton = "info",
  hoehe = "normal",
  verzoegerung = 0,
  beschriftung,
  className,
}: {
  /** 0 bis 1. Wird sicherheitshalber begrenzt. */
  anteil: number;
  ton?: Ton;
  hoehe?: keyof typeof hoehen;
  /** Millisekunden - fuer gestaffelte Listen. */
  verzoegerung?: number;
  /** Fuer Screenreader, z. B. "12 von 20 Namen". Ohne Angabe rein dekorativ. */
  beschriftung?: string;
  className?: string;
}) {
  const sicher = Math.max(0, Math.min(1, Number.isFinite(anteil) ? anteil : 0));

  return (
    <div
      className={cn(
        "w-full overflow-hidden rounded-full bg-sunken",
        hoehen[hoehe],
        className
      )}
      {...(beschriftung
        ? {
            role: "progressbar",
            "aria-valuenow": Math.round(sicher * 100),
            "aria-valuemin": 0,
            "aria-valuemax": 100,
            "aria-label": beschriftung,
          }
        : { "aria-hidden": true })}
    >
      <div
        className={cn("h-full rounded-full animate-bar", fuellung[ton])}
        style={{
          width: `${sicher * 100}%`,
          ...(verzoegerung
            ? ({ "--rise-delay": `${verzoegerung}ms` } as React.CSSProperties)
            : {}),
        }}
      />
    </div>
  );
}
