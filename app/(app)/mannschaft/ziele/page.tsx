import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { ladeNavigationZugriff } from "@/lib/navigation-access";
import { berlinToday } from "@/lib/dates";
import Teamziele from "@/components/ziele/Teamziele";
import TeamzielFormular from "@/components/ziele/TeamzielFormular";
import { column, pageTitle, card } from "@/components/ui";

export default async function TeamzielePage() {
  const user = await requireUser();
  const access = await ladeNavigationZugriff(user);
  return (
    <div className={`${column} space-y-6`}>
      <Link
        href="/mannschaft"
        className="inline-flex min-h-11 items-center text-link"
      >
        ← Team
      </Link>
      <header>
        <h1 className={pageTitle}>Gemeinsame Teamziele</h1>
        <p className="mt-2 text-ink-muted">
          Was wir zusammen schaffen – mit einem gemeinsamen Fortschritt.
        </p>
      </header>
      <Teamziele userId={user.id} verwalten />
      {access.canCreateTeamGoal && (
        <section className={`${card} space-y-4 p-5`}>
          <h2 className="text-xl font-semibold">Ein Teamziel setzen</h2>
          <TeamzielFormular heute={berlinToday()} />
        </section>
      )}
      <p className="text-sm text-ink-muted">
        Ein Teamwechsel verändert, wessen Buchungen zum Teamziel zählen.
        Einheiten werden am Buchungstag berücksichtigt; Startbestände zählen
        nicht zum Wochen- oder Monatsziel.
      </p>
    </div>
  );
}
