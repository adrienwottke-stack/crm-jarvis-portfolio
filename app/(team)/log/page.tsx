import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser, requireUserPerson } from "@/lib/auth";
import type { QuotaType } from "@/lib/generated/prisma/enums";
import { manualQuotaTypes, quotaTypeLabels } from "@/lib/labels";
import { berlinDayOf, berlinToday, dayDisplayFormat, dayToUtcDate } from "@/lib/dates";
import { streakDays } from "@/lib/stats";
import { offeneMeilensteine } from "@/lib/meilensteine";
import QuickCounter from "@/components/QuickCounter";
import WettbewerbNav from "@/components/WettbewerbNav";
import MeilensteinMelden from "@/components/MeilensteinMelden";
import { CalendarCheckIcon, ChevronRightIcon, FlameIcon, HashIcon, PhoneIcon, SparkIcon } from "@/components/icons";
import { btnPrimary, card, input, label, pageTitle, sectionTitle, columnNarrow } from "@/components/ui";
import { deleteLog, logDaily } from "./actions";
import { quickLog, quickLogZurueck } from "./quickLogAction";

export const dynamic = "force-dynamic";

function QuotaIcon({ type, className }: { type: QuotaType; className?: string }) {
  if (type === "CALL") return <PhoneIcon className={className} />;
  if (type === "NUMBERS_PULLED") return <HashIcon className={className} />;
  if (type === "REFERRAL") return <SparkIcon className={className} />;
  return <CalendarCheckIcon className={className} />;
}

const quotaIconStyles: Record<QuotaType, string> = {
  CALL: "bg-navy-50 text-navy-700",
  NUMBERS_PULLED: "bg-navy-50 text-navy-600",
  REFERRAL: "bg-amber-50 text-amber-700",
  APPOINTMENT_SET: "bg-emerald-50 text-emerald-600",
  APPOINTMENT_HELD: "bg-teal-50 text-teal-700",
  DEAL_WON: "bg-gold-100 text-gold-600",
};

export default async function LogPage() {
  const user = await requireUser();
  const person = await requireUserPerson(user.id);
  const today = berlinToday();
  const todayDate = dayToUtcDate(today);

  const [todaySums, recentLogs, loggedDates, gemeldet] = await Promise.all([
    prisma.dailyLog.groupBy({
      by: ["type"],
      where: { personId: person.id, date: todayDate },
      _sum: { count: true },
    }),
    prisma.dailyLog.findMany({
      where: { personId: person.id },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    prisma.dailyLog.findMany({
      where: { personId: person.id },
      select: { date: true },
      distinct: ["date"],
    }),
    // Was heute schon gemeldet ist. Eine Abfrage im selben Promise.all -
    // damit steht der Knopf ohne zweiten Gang zum Server da.
    prisma.feedEintrag.findMany({
      where: { personId: person.id, tag: todayDate },
      select: { schluessel: true },
    }),
  ]);

  const todayByType = new Map(
    todaySums.map((entry) => [entry.type, entry._sum.count ?? 0])
  );
  const offen = offeneMeilensteine(
    todayByType,
    new Set(gemeldet.map((eintrag) => eintrag.schluessel))
  );
  const streak = streakDays(
    new Set(loggedDates.map((entry) => berlinDayOf(entry.date))),
    today
  );

  return (
    <div className={`${columnNarrow} space-y-8`}>
      <WettbewerbNav />

      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className={pageTitle}>Meine Aktivitäten</h1>
          {streak >= 2 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-gold-100 px-2.5 py-1 text-xs font-semibold text-gold-600">
              <FlameIcon className="h-3.5 w-3.5" />
              {streak} Tage Serie
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-ink-muted">
          Du loggst als <span className="font-medium text-ink">{person.name}</span>.
          Anrufe und Termine aus deinem CRM werden automatisch gezählt.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {manualQuotaTypes.map((type) => (
          <QuickCounter
            key={type}
            type={type}
            label={quotaTypeLabels[type]}
            count={todayByType.get(type) ?? 0}
            action={quickLog}
            zurueck={quickLogZurueck}
          />
        ))}
      </div>

      {/* Steht nur da, wenn wirklich etwas erreicht ist - nie als leerer
          Platzhalter. Die Arbeitsflaeche bleibt, was sie ist: drei Zaehler
          und Ruhe. */}
      {offen.map((meilenstein) => (
        <MeilensteinMelden
          key={meilenstein.schluessel}
          schluessel={meilenstein.schluessel}
          text={meilenstein.text}
        />
      ))}

      <form action={logDaily} className={`${card} space-y-5 p-6 sm:p-8`}>
        <h2 className={sectionTitle}>Zusätzlich manuell loggen</h2>
        <p className="text-sm text-ink-muted">
          Nur für Aktivitäten, die nicht über einen CRM-Kontakt erfasst wurden.
        </p>
        <div className="grid gap-5 sm:grid-cols-3">
          {manualQuotaTypes.map((type) => (
            <div key={type}>
              <label htmlFor={type} className={label}>{quotaTypeLabels[type]}</label>
              <input id={type} name={type} type="number" min={0} max={999} placeholder="0" className={input} />
            </div>
          ))}
        </div>
        <div>
          <label htmlFor="day" className={label}>Tag</label>
          <input id="day" name="day" type="date" defaultValue={today} max={today} className={input} />
        </div>
        <div className="flex justify-end border-t border-line pt-5">
          <button type="submit" className={btnPrimary}>Speichern</button>
        </div>
      </form>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className={sectionTitle}>Deine letzten Einträge</h2>
          <Link href="/leaderboard" className="inline-flex items-center gap-1 text-sm font-medium text-navy-600 transition hover:gap-1.5 hover:underline">
            Zur Rangliste <ChevronRightIcon className="h-4 w-4" />
          </Link>
        </div>
        {recentLogs.length === 0 ? (
          <div className={`${card} px-6 py-12 text-center`}>
            <p className="text-sm font-medium text-ink">Noch nichts geloggt</p>
            <p className="mt-1 text-sm text-ink-muted">Deine CRM-Aktivitäten erscheinen hier automatisch.</p>
          </div>
        ) : (
          <ul className={`${card} divide-y divide-line`}>
            {recentLogs.map((log) => {
              const isToday = log.date.getTime() === todayDate.getTime();
              return (
                <li key={log.id} className="flex items-center justify-between gap-4 px-5 py-3.5 text-sm">
                  <span className="flex items-center gap-3">
                    <span className={`flex h-8 w-8 items-center justify-center rounded-full ${quotaIconStyles[log.type]}`}>
                      <QuotaIcon type={log.type} className="h-4 w-4" />
                    </span>
                    <span>
                      <span className="font-semibold text-ink">+{log.count}</span>{" "}
                      <span className="text-ink-muted">{quotaTypeLabels[log.type]}</span>
                    </span>
                  </span>
                  <span className="flex items-center gap-4">
                    <span className="text-xs tabular-nums text-ink-muted">{dayDisplayFormat.format(log.date)}</span>
                    {isToday && !log.activityId && (
                      <form action={deleteLog}>
                        <input type="hidden" name="logId" value={log.id} />
                        <button
                          type="submit"
                          className="inline-flex min-h-11 items-center text-xs font-medium text-ink-muted transition hover:text-ink"
                        >
                          Löschen
                        </button>
                      </form>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
