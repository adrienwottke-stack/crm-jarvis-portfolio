// Der Willkommens-Ablauf hat bewusst KEINE App-Navigation: die zehn
// Eintraege der Kopfzeile sind genau das, was im ersten Moment nicht zu sehen
// sein soll. Ganzflaechig Navy, Gold als einziger Akzent - dieselbe Sprache
// wie Kopfzeile und Wortmarke, nur einmal als ganze Buehne.
export default function WillkommenLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="buehne buehne-flecken min-h-dvh text-white">
      {children}
    </div>
  );
}
