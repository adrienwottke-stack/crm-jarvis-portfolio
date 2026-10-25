// Zeigt einen Gespraechsleitfaden an: Abschnitte, woertliche Rede, Hinweise,
// Checkliste. Wird vom Durchlauf und vom Leitfaden-Panel gemeinsam benutzt.

import { parseGuide } from "@/lib/guides";

export default function GuideBody({ body }: { body: string }) {
  const blocks = parseGuide(body);

  return (
    <div className="space-y-2">
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "heading":
            return (
              <h4
                key={index}
                className="border-b border-line pb-1 pt-4 text-11 font-bold uppercase tracking-wider text-navy-700 first:pt-0"
              >
                {block.text}
              </h4>
            );

          case "subheading":
            return (
              <h5
                key={index}
                className="pt-2 text-13 font-semibold text-ink"
              >
                {block.text}
              </h5>
            );

          case "quote":
            // Das, was tatsaechlich gesagt wird, muss beim Ueberfliegen
            // sofort ins Auge springen – im Gespraech bleibt keine Zeit zum
            // Suchen.
            return (
              <p
                key={index}
                className="rounded-lg border-l-[3px] border-navy-400 bg-navy-50/60 px-3 py-2 text-15 font-medium leading-snug text-navy-900"
              >
                {block.text}
              </p>
            );

          case "bullet":
            return (
              <p
                key={index}
                className="flex gap-2 text-sm leading-relaxed text-ink-muted"
              >
                <span aria-hidden className="text-ink-soft">
                  •
                </span>
                <span>{block.text}</span>
              </p>
            );

          default:
            return (
              <p key={index} className="text-sm leading-relaxed text-ink-muted">
                {block.text}
              </p>
            );
        }
      })}
    </div>
  );
}
