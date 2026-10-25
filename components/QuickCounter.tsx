"use client";

import { useOptimistic, useTransition } from "react";
import type { QuotaType } from "@/lib/generated/prisma/enums";
import {
  CalendarCheckIcon,
  HashIcon,
  MinusIcon,
  PhoneIcon,
  PlusIcon,
  SparkIcon,
} from "@/components/icons";
import { card, kicker } from "@/components/ui";

const iconStyles: Record<QuotaType, string> = {
  CALL: "bg-navy-50 text-navy-700",
  NUMBERS_PULLED: "bg-navy-50 text-navy-600",
  REFERRAL: "bg-amber-50 text-amber-700",
  APPOINTMENT_SET: "bg-emerald-50 text-emerald-600",
  APPOINTMENT_HELD: "bg-teal-50 text-teal-700",
  DEAL_WON: "bg-gold-100 text-gold-600",
};

function QuotaIcon({ type }: { type: QuotaType }) {
  const className = "h-4.5 w-4.5";
  if (type === "CALL") return <PhoneIcon className={className} />;
  if (type === "NUMBERS_PULLED") return <HashIcon className={className} />;
  if (type === "REFERRAL") return <SparkIcon className={className} />;
  return <CalendarCheckIcon className={className} />;
}

export default function QuickCounter({
  type,
  label,
  count,
  action,
  zurueck,
}: {
  type: QuotaType;
  label: string;
  count: number;
  // Die Aktionen geben den wahren Tagesstand zurueck; hier wird er nicht
  // gebraucht (die Seite rechnet sich nach revalidatePath ohnehin neu), aber
  // der Typ darf ihn nicht verbieten.
  action: (type: string, count: number) => Promise<unknown>;
  zurueck: (type: string) => Promise<unknown>;
}) {
  const [isPending, startTransition] = useTransition();
  const [optimisticCount, addOptimistic] = useOptimistic(
    count,
    (current, increment: number) => current + increment
  );

  const handleClick = () => {
    startTransition(async () => {
      addOptimistic(1);
      await action(type, 1);
    });
  };

  // Derselbe Griff wie im Schnellfenster der Kopfzeile: ein Fehltipper ist
  // einen Tipp entfernt wieder weg, nicht erst unten im Verlauf.
  const handleZurueck = () => {
    startTransition(async () => {
      addOptimistic(-1);
      await zurueck(type);
    });
  };

  return (
    <div className={`${card} p-5`}>
      <div className="flex items-center justify-between">
        <span
          className={`flex h-9 w-9 items-center justify-center rounded-full ${iconStyles[type]}`}
        >
          <QuotaIcon type={type} />
        </span>
        <span className={kicker}>Heute</span>
      </div>
      <p className="mt-4 overflow-hidden text-4xl font-semibold tracking-tight tabular-nums text-ink">
        <span key={optimisticCount} className="inline-block animate-tick">
          {optimisticCount}
        </span>
      </p>
      <p className="mt-1 text-13 font-medium text-ink-muted">{label}</p>
      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={handleZurueck}
          disabled={optimisticCount <= 0}
          aria-label={`${label} eins zurück`}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-line text-ink-muted transition hover:border-line-strong hover:text-ink active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-line disabled:hover:text-ink-muted disabled:active:scale-100"
        >
          <MinusIcon className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={handleClick}
          disabled={isPending && optimisticCount - count > 3}
          className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border border-line bg-sunken px-3 text-sm font-semibold text-ink transition hover:border-navy-300 hover:bg-navy-50 hover:text-navy-700 active:scale-[0.97]"
        >
          <PlusIcon className="h-4 w-4" />1
        </button>
      </div>
    </div>
  );
}
