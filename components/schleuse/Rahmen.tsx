// Gemeinsame Buehne aller vier Schleusen-Zweige (docs/willkommen-plan.md,
// Akt 0). Navy, Gold als einziger Akzent, ein Gedanke, ein Knopf - dieselbe
// Sprache wie der Willkommens-Ablauf danach. Die Schleuse darf sich nicht wie
// eine Fehlermeldung anfuehlen, sondern wie der erste Schritt.
export default function Rahmen({
  kicker,
  titel,
  text,
  children,
  fuss,
}: {
  kicker: string;
  titel: string;
  text: React.ReactNode;
  children?: React.ReactNode;
  fuss?: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-10">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-link">
        {kicker}
      </p>
      <h1 className="mt-3 text-[1.7rem] font-semibold leading-tight tracking-tight text-white">
        {titel}
      </h1>
      <div className="mt-3 space-y-3 text-15 leading-relaxed text-navy-200">
        {text}
      </div>
      {children && <div className="mt-8">{children}</div>}
      {fuss && <div className="mt-8 text-13 leading-relaxed text-navy-300">{fuss}</div>}
    </div>
  );
}

/** Nummerierter Schritt fuer die Anleitungen. */
export function Schritt({
  nummer,
  children,
}: {
  nummer: number;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3.5">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-akzent text-sm font-semibold text-white">
        {nummer}
      </span>
      <span className="pt-0.5 text-15 leading-relaxed text-white">{children}</span>
    </li>
  );
}
