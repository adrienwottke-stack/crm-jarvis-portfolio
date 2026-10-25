import type { ContactStage, Outcome } from "@/lib/generated/prisma/enums";
import { contactStageLabels, contactStagePalette } from "@/lib/pipeline";

const lostPalette = "bg-slate-100 text-slate-600";
const lostDot = "bg-slate-400";

// Phase und Ausgang in einem Chip: bei Absagen bleibt die Phase sichtbar,
// in der der Kontakt gescheitert ist.
export default function StageBadge({
  stage,
  outcome = "OFFEN",
}: {
  stage: ContactStage;
  outcome?: Outcome;
}) {
  const lost = outcome === "VERLOREN";
  const palette = contactStagePalette[stage];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
        lost ? lostPalette : palette.pill
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${lost ? lostDot : palette.dot}`} />
      {lost ? `Verloren · ${contactStageLabels[stage]}` : contactStageLabels[stage]}
    </span>
  );
}
