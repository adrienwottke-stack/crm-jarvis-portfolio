import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { aiCrmConfig, formatAiPrice } from "@/lib/ai-crm/config";
import { aiUsageMonthWindow } from "@/lib/ai-crm/entitlement";
import { aiBetaSchalten } from "./actions";
import { btnSecondary, card, chip, pageTitle, td, th } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AiWerkstattPage() {
  await requireAdmin();
  const config = aiCrmConfig();
  const costConfigured =
    config.inputMicrosPerMillionTokens > 0 ||
    config.outputMicrosPerMillionTokens > 0 ||
    config.audioMicrosPerMinute > 0;
  const { from, to } = aiUsageMonthWindow(new Date());
  const [users, usage] = await Promise.all([
    prisma.user.findMany({
      where: { deactivatedAt: null, passwordHash: { not: null } },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        email: true,
        aiBetaEnabled: true,
        aiSubscription: {
          select: {
            status: true,
            currentPeriodEnd: true,
            cancelAtPeriodEnd: true,
          },
        },
      },
    }),
    prisma.aiUsage.groupBy({
      by: ["userId"],
      where: { createdAt: { gte: from, lt: to } },
      _count: { _all: true },
      _sum: { audioSeconds: true, toolCalls: true, estimatedCostMicros: true },
      _max: { createdAt: true },
    }),
  ]);
  const byUser = new Map(usage.map((row) => [row.userId, row]));

  return (
    <div className="space-y-6">
      <header>
        <Link href="/werkstatt" className="text-sm font-medium text-link">← Werkstatt</Link>
        <h1 className={`${pageTitle} mt-3`}>AI CRM</h1>
        <p className="mt-2 max-w-3xl text-sm text-ink-muted">
          Beta-Freischaltung, Abo-Stand und Rohverbrauch im laufenden Monat. Produktpreis: {formatAiPrice(config)} pro Nutzer und Monat.
        </p>
      </header>

      {!config.globallyEnabled && (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          AI CRM ist global aus. Setze <code>AI_CRM_ENABLED=true</code>, bevor Beta- oder Abo-Konten den Assistenten nutzen können.
        </p>
      )}

      <div className={`${card} overflow-x-auto`}>
        <table className="w-full min-w-[52rem] text-left text-sm">
          <thead className="border-b border-line bg-sunken/60">
            <tr>
              <th className={th}>Nutzer</th>
              <th className={th}>Zugang</th>
              <th className={`${th} text-right`}>Anfragen</th>
              <th className={`${th} text-right`}>Sprache</th>
              <th className={`${th} text-right`}>Tools</th>
              <th className={`${th} text-right`}>geschätzt</th>
              <th className={th}>Letzte Nutzung</th>
              <th className={th}>Beta</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {users.map((user) => {
              const row = byUser.get(user.id);
              const subscription = user.aiSubscription;
              const active = subscription && ["ACTIVE", "TRIALING"].includes(subscription.status);
              return (
                <tr key={user.id} className="align-top">
                  <td className={td}>
                    <span className="font-medium text-ink">{user.name}</span>
                    {user.email && <span className="mt-0.5 block text-xs text-ink-soft">{user.email}</span>}
                  </td>
                  <td className={td}>
                    <span className={chip(active ? "erfolg" : user.aiBetaEnabled ? "info" : "neutral")}>
                      {active ? "Abo aktiv" : user.aiBetaEnabled ? "Beta" : subscription?.status ?? "Aus"}
                    </span>
                    {subscription?.cancelAtPeriodEnd && subscription.currentPeriodEnd && (
                      <span className="mt-1 block text-xs text-ink-soft">
                        bis {subscription.currentPeriodEnd.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })}
                      </span>
                    )}
                  </td>
                  <td className={`${td} text-right tabular-nums`}>{row?._count._all ?? 0}</td>
                  <td className={`${td} text-right tabular-nums`}>{Math.ceil((row?._sum.audioSeconds ?? 0) / 60)} min</td>
                  <td className={`${td} text-right tabular-nums`}>{row?._sum.toolCalls ?? 0}</td>
                  <td className={`${td} text-right tabular-nums`}>
                    {costConfigured
                      ? new Intl.NumberFormat("de-DE", {
                          style: "currency",
                          currency: config.costCurrency,
                          minimumFractionDigits: 3,
                        }).format((row?._sum.estimatedCostMicros ?? 0) / 1_000_000)
                      : "—"}
                  </td>
                  <td className={td}>
                    {row?._max.createdAt
                      ? row._max.createdAt.toLocaleString("de-DE", { timeZone: "Europe/Berlin" })
                      : "—"}
                  </td>
                  <td className={td}>
                    <form action={aiBetaSchalten}>
                      <input type="hidden" name="userId" value={user.id} />
                      <input type="hidden" name="enabled" value={user.aiBetaEnabled ? "0" : "1"} />
                      <button type="submit" className={btnSecondary}>
                        {user.aiBetaEnabled ? "Beta aus" : "Beta an"}
                      </button>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
