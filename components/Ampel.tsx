import { cn } from "@/components/ui";
import { ampelFarben, ampelTexte, type Ampel as AmpelWert } from "@/lib/signale";

// Der Zustand einer Person: noch nicht dabei / laeuft / hakt / braucht dich.
//
// Das ist die wichtigste Aussage der Fuehrungsansicht - und sie stand bisher
// als 2-px-Punkt da, dessen Bedeutung nur im sr-only-Text stand. Wer nicht
// zufaellig die Farbcodierung im Kopf hatte, sah eine graue Liste mit bunten
// Fusseln.
//
// Jetzt: groesserer Punkt mit Ring, daneben das Wort. Rot pulst leise - der
// einzige Ort in der Anwendung, an dem etwas um Aufmerksamkeit bittet. Das
// darf es, denn genau das bedeutet "braucht dich".

const groessen = {
  klein: "h-2 w-2",
  normal: "h-2.5 w-2.5",
  gross: "h-3 w-3",
} as const;

const textFarben: Record<AmpelWert, string> = {
  grau: "text-ink-soft",
  gruen: "text-emerald-700",
  gelb: "text-amber-700",
  rot: "text-red-700",
};

export default function Ampel({
  ampel,
  variante = "beides",
  groesse = "normal",
  ruhig = false,
  className,
}: {
  ampel: AmpelWert;
  /**
   * "beides"  Punkt und Wort (Regelfall)
   * "punkt"   nur der Punkt - wenn das Wort schon danebensteht
   * "text"    nur das Wort - wenn der Punkt schon davorsteht
   * Der Text bleibt in jedem Fall fuer Screenreader vorhanden.
   */
  variante?: "beides" | "punkt" | "text";
  groesse?: keyof typeof groessen;
  /**
   * true: der rote Punkt pulst nicht. Fuer Listen mit mehreren roten
   * Ampeln (z. B. die Direkten-Liste im Lagebild) - die Ein-Puls-Regel
   * erlaubt pro Bildschirm nur EINEN pulsenden Punkt, alle anderen bleiben
   * ruhig.
   */
  ruhig?: boolean;
  className?: string;
}) {
  const punkt = variante !== "text" && (
    <span
      aria-hidden
      className={cn(
        "shrink-0 rounded-full ring-2 ring-surface",
        groessen[groesse],
        ampelFarben[ampel],
        // Nur der rote Zustand bewegt sich, und auch der nur, wenn er nicht
        // ausdruecklich ruhig gestellt ist. Alles andere waere Unruhe.
        ampel === "rot" && !ruhig && "animate-halo"
      )}
    />
  );

  const wort =
    variante === "punkt" ? (
      <span className="sr-only">{ampelTexte[ampel]}</span>
    ) : (
      <span className={cn("text-[11px] font-medium", textFarben[ampel])}>
        {ampelTexte[ampel]}
      </span>
    );

  return (
    <span
      className={cn(
        "inline-flex items-center",
        variante === "beides" && "gap-1.5",
        className
      )}
    >
      {punkt}
      {wort}
    </span>
  );
}
