import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  allQuotaTypes,
  emptyQuotaCounts,
  quotaTypeLabels,
  quotaTypePoints,
} from "@/lib/labels";
import {
  berlinDayOf,
  berlinToday,
  dayToUtcDate,
  shiftDay,
  startOfMonth,
  startOfWeek,
} from "@/lib/dates";
import { streakDays } from "@/lib/stats";
import type { QuotaType } from "@/lib/generated/prisma/enums";
import WettbewerbNav from "@/components/WettbewerbNav";
import { FlameIcon, PlusIcon, TrophyIcon } from "@/components/icons";
import {
  btnPrimary,
  card,
  filterPill,
  kicker,
  pageTitle,
  td,
  th,
} from "@/components/ui";

export const dynamic = "force-dynamic";

const ranges = {
  today: "Heute",
  week: "Diese Woche",
  month: "Dieser Monat",
} as const;

type RangeKey = keyof typeof ranges;

const podiumStyles = [
  {
    chip: "bg-gold-100 text-gold-600",
    card: "border-gold-400/40 bg-gold-100/40",
    label: "Führung",
  },
  {
    chip: "bg-slate-200 text-slate-600",
    card: "border-line/80 bg-surface",
    label: "Platz 2",
  },
  {
    chip: "bg-amber-100 text-amber-700",
    card: "border-line/80 bg-surface",
    label: "Platz 3",
  },
];

function RankChip({ rank }: { rank: number }) {
  const style = podiumStyles[rank - 1];
  if (style) {
    return (
      <span
        className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-13 font-semibold ${style.chip}`}
      >
        {rank}
      </span>
    );
  }
  return (
    <span className="inline-flex h-7 w-7 items-center justify-center text-13 font-medium tabular-nums text-ink-muted">
      {rank}
    </span>
  );
}

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range } = await searchParams;
  const rangeKey: RangeKey =
    range && range in ranges ? (range as RangeKey) : "week";

  const today = berlinToday();
  const start =
    rangeKey === "today"
      ? dayToUtcDate(today)
      : rangeKey === "week"
        ? startOfWeek(today)
        : startOfMonth(today);

  const [sums, persons, streakLogs] = await Promise.all([
    prisma.dailyLog.groupBy({
      by: ["personId", "type"],
      where: { date: { gte: start } },
      _sum: { count: true },
    }),
    prisma.person.findMany(),
    prisma.dailyLog.findMany({
      where: { date: { gte: dayToUtcDate(shiftDay(today, -60)) } },
      select: { personId: true, date: true },
    }),
  ]);

  const nameById = new Map(persons.map((p) => [p.id, p.name]));

  const daysByPerson = new Map<string, Set<string>>();
  for (const log of streakLogs) {
    let days = daysByPerson.get(log.personId);
    if (!days) {
      days = new Set();
      daysByPerson.set(log.personId, days);
    }
    days.add(berlinDayOf(log.date));
  }

  const rows = new Map<
    string,
    {
      personId: string;
      name: string;
      byType: Record<QuotaType, number>;
      total: number;
    }
  >();
  for (const entry of sums) {
    const count = entry._sum.count ?? 0;
    if (count === 0) continue;
    let row = rows.get(entry.personId);
    if (!row) {
      row = {
        personId: entry.personId,
        name: nameById.get(entry.personId) ?? "Unbekannt",
        byType: emptyQuotaCounts(),
        total: 0,
      };
      rows.set(entry.personId, row);
    }
    row.byType[entry.type] += count;
    // Ein Abschluss zaehlt fuenffach, alles andere einfach.
    row.total += count * quotaTypePoints[entry.type];
  }

  const ranking = [...rows.values()].sort((a, b) => b.total - a.total);
  const leaderTotal = ranking[0]?.total ?? 0;
  const podium = ranking.slice(0, 3);

  return (
    <div className="space-y-6">
      <WettbewerbNav />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className={pageTitle}>Rangliste</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {ranking.length === 0
              ? "Noch alles offen."
              : `${ranking[0]!.name} führt mit ${ranking[0]!.total} Punkten.`}
          </p>
        </div>
        <Link href="/log" className={btnPrimary}>
          <PlusIcon className="h-4 w-4" />
          Aktivität loggen
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        {(Object.keys(ranges) as RangeKey[]).map((key) => (
          <Link
            key={key}
            href={`/leaderboard?range=${key}`}
            className={filterPill(rangeKey === key)}
          >
            {ranges[key]}
          </Link>
        ))}
      </div>

      {ranking.length === 0 ? (
        <div
          className={`${card} flex flex-col items-center px-6 py-16 text-center`}
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gold-100 text-gold-600">
            <TrophyIcon className="h-6 w-6" />
          </span>
          <p className="mt-4 text-sm font-medium text-ink">
            Noch keine Einträge in diesem Zeitraum
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            Sei die erste Person auf dem Board!
          </p>
          <Link href="/log" className={`${btnPrimary} mt-6`}>
            <PlusIcon className="h-4 w-4" />
            Jetzt loggen
          </Link>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            {podium.map((row, index) => {
              const style = podiumStyles[index]!;
              const gap = leaderTotal - row.total;
              const streak = streakDays(
                daysByPerson.get(row.personId) ?? new Set(),
                today
              );
              return (
                <div
                  key={row.personId}
                  className={`${card} animate-rise p-5 ${style.card}`}
                  style={{ animationDelay: `${index * 90}ms` }}
                >
                  <div className="flex items-center justify-between">
                    <RankChip rank={index + 1} />
                    <span className={kicker}>{style.label}</span>
                  </div>
                  <p className="mt-4 truncate text-base font-semibold text-ink">
                    {row.name}
                  </p>
                  <div className="mt-1 flex items-baseline gap-2">
                    <p className="text-4xl font-semibold tracking-tight tabular-nums text-ink">
                      {row.total}
                    </p>
                    <span className="text-xs text-ink-muted">
                      {index === 0
                        ? "Punkte"
                        : `−${gap} auf Platz 1`}
                    </span>
                  </div>
                  {streak >= 2 && (
                    <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/80 px-2.5 py-1 text-xs font-semibold text-gold-600">
                      <FlameIcon className="h-3.5 w-3.5" />
                      {streak} Tage Serie
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          <div className={`${card} overflow-x-auto`}>
            <table className="w-full min-w-160 text-left text-sm">
              <thead className="border-b border-line/80 bg-sunken/60">
                <tr>
                  <th className={th}>Platz</th>
                  <th className={th}>Name</th>
                  {allQuotaTypes.map((type) => (
                    <th key={type} className={`${th} text-right`}>
                      {quotaTypeLabels[type]}
                    </th>
                  ))}
                  <th className={`${th} w-56 text-right`}>Gesamt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {ranking.map((row, index) => {
                  const streak = streakDays(
                    daysByPerson.get(row.personId) ?? new Set(),
                    today
                  );
                  return (
                    <tr
                      key={row.personId}
                      className={
                        index === 0
                          ? "bg-gold-100/30"
                          : "transition hover:bg-navy-50/40"
                      }
                    >
                      <td className={td}>
                        <RankChip rank={index + 1} />
                      </td>
                      <td className={`${td} font-medium text-ink`}>
                        <span className="flex items-center gap-2">
                          {row.name}
                          {streak >= 2 && (
                            <span
                              className="inline-flex items-center gap-1 text-xs font-semibold text-gold-600"
                              title={`${streak} Tage in Folge geloggt`}
                            >
                              <FlameIcon className="h-3.5 w-3.5" />
                              {streak}
                            </span>
                          )}
                        </span>
                      </td>
                      {allQuotaTypes.map((type) => (
                        <td
                          key={type}
                          className={`${td} text-right tabular-nums text-ink-muted`}
                        >
                          {row.byType[type]}
                        </td>
                      ))}
                      <td className={td}>
                        <div className="flex items-center justify-end gap-3">
                          <span className="w-8 text-right text-sm font-semibold tabular-nums text-ink">
                            {row.total}
                          </span>
                          <span
                            aria-hidden
                            className="h-1 w-24 shrink-0 overflow-hidden rounded-full bg-navy-100"
                          >
                            <span
                              className="block h-full rounded-full bg-navy-600"
                              style={{
                                width: `${leaderTotal > 0 ? Math.max((row.total / leaderTotal) * 100, 4) : 0}%`,
                              }}
                            />
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="text-xs text-ink-muted">
        Woche = ab Montag, Zeitzone Europe/Berlin. Sichtbar sind nur Namen und
        Zahlen – keine Kontaktdaten.
      </p>
    </div>
  );
}
