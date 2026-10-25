// Das Zeichen: eine Namensliste, drei Zeilen, die oberste im Fokus.
// Kein Kurs-Chart, kein Verlauf, kein Gold - die Liste IST das Produkt.

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className ?? "h-8 w-8"}
      aria-hidden
      fill="none"
    >
      <rect width="32" height="32" rx="8" fill="#0b1b30" />
      <circle cx="9.6" cy="9.8" r="1.8" fill="#ffffff" />
      <rect x="13.4" y="8.6" width="10.8" height="2.4" rx="1.2" fill="#ffffff" />
      <circle cx="9.6" cy="16" r="1.8" fill="#ffffff" opacity="0.38" />
      <rect x="13.4" y="14.8" width="10.8" height="2.4" rx="1.2" fill="#ffffff" opacity="0.38" />
      <circle cx="9.6" cy="22.2" r="1.8" fill="#ffffff" opacity="0.38" />
      <rect x="13.4" y="21" width="10.8" height="2.4" rx="1.2" fill="#ffffff" opacity="0.38" />
    </svg>
  );
}

export function Wordmark({
  sub,
  onDark = false,
}: {
  sub?: string;
  onDark?: boolean;
}) {
  return (
    // min-w-0 + truncate: die Wortmarke darf schrumpfen statt die Kopfzeile
    // breiter als den Bildschirm zu machen (sonst scrollt die Seite seitlich
    // und der sticky Header endet vor dem rechten Rand).
    <span className="flex min-w-0 items-center gap-2.5">
      <LogoMark className="h-8 w-8 shrink-0" />
      <span className="min-w-0 leading-tight">
        <span
          className={`block truncate text-15 font-semibold tracking-tight ${
            onDark ? "text-white" : "text-slate-900"
          }`}
        >
          Cockpit
        </span>
        {sub && (
          <span
            className={`hidden truncate text-11 font-medium sm:block ${
              onDark ? "text-slate-400" : "text-slate-500"
            }`}
          >
            {sub}
          </span>
        )}
      </span>
    </span>
  );
}
