"use client";

// Der Gespraechsleitfaden am Ort des Gespraechs - aufklappbar, nicht als PDF.
//
// Bewusst ohne Editor: der Wert steckt im Standardtext, nicht in der
// Moeglichkeit, ihn zu ueberschreiben. Ein Editor waere Pflegearbeit fuer den
// Partner - und ein selbst ausgedachter Leitfaden hilft ihm weniger als ein
// guter, der einfach dasteht. Verbesserungen am Standard erreichen so jeden.

import { useState } from "react";
import GuideBody from "@/components/GuideBody";
import Einwandhilfe from "@/components/Einwandhilfe";
import { card } from "@/components/ui";
import { ChevronDownIcon, ChevronRightIcon } from "@/components/icons";
import type { ListKind } from "@/lib/generated/prisma/enums";

export default function GuidePanel({
  title,
  body,
  kind,
}: {
  title: string;
  body: string;
  kind: ListKind;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className={`${card} overflow-hidden`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-14 w-full items-center justify-between gap-3 px-4 text-left"
      >
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink">
          {open ? (
            <ChevronDownIcon className="h-4 w-4 text-ink-soft" />
          ) : (
            <ChevronRightIcon className="h-4 w-4 text-ink-soft" />
          )}
          {title}
        </span>
      </button>

      {open && (
        <div className="space-y-4 border-t border-line px-4 py-4">
          <GuideBody body={body} />
          <div className="border-t border-line pt-4">
            <Einwandhilfe kind={kind} />
          </div>
        </div>
      )}
    </div>
  );
}
