import { card, cn, type Ton } from "@/components/ui";

// Ein leerer Zustand, ueberall gleich.
//
// Vorher liefen drei Muster nebeneinander: Symbolkreis mit Knopf, nacktes
// zentriertes Kaertchen und blosser Fliesstext. Fuer den Nutzer sah dieselbe
// Aussage ("hier ist nichts") an jeder Stelle anders aus - mal wie ein Erfolg,
// mal wie ein Fehler.
//
// Die Regel jetzt: leer ist erst einmal in Ordnung. Der Ton sagt, ob es ein
// gutes Leer ist (erfolg: alles abgearbeitet) oder ein Leer, das auf etwas
// wartet (neutral). Und wenn es einen naechsten Schritt gibt, steht er dabei.

const kreise: Record<Ton, string> = {
  neutral: "bg-slate-100 text-slate-400",
  info: "bg-navy-50 text-navy-600",
  erfolg: "bg-emerald-100 text-emerald-600",
  warnung: "bg-amber-100 text-amber-700",
  gefahr: "bg-red-100 text-red-600",
};

export default function LeerZustand({
  symbol,
  titel,
  text,
  ton = "neutral",
  rahmen = true,
  children,
}: {
  /** Ein Icon aus components/icons - wird auf h-6 w-6 gesetzt. */
  symbol?: React.ReactNode;
  titel: string;
  text?: React.ReactNode;
  ton?: Ton;
  /** false, wenn der Zustand schon in einer Karte steht. */
  rahmen?: boolean;
  /** Der naechste Schritt, meist ein Link oder Knopf. */
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center px-6 py-14 text-center",
        rahmen && card
      )}
    >
      {symbol && (
        <span
          className={cn(
            "flex h-12 w-12 items-center justify-center rounded-full",
            kreise[ton]
          )}
        >
          {symbol}
        </span>
      )}
      <p
        className={cn(
          "text-sm font-medium text-ink",
          symbol ? "mt-4" : undefined
        )}
      >
        {titel}
      </p>
      {text && (
        <p className="mt-1 max-w-sm text-sm text-ink-soft">{text}</p>
      )}
      {children && <div className="mt-5">{children}</div>}
    </div>
  );
}
