import Link from "next/link";
import CoachProfileEntry from "@/components/coach/CoachProfileEntry";
import { ladeCoach } from "@/lib/coach/server";
import PersonLink from "@/components/PersonLink";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logout } from "@/app/login/actions";
import ArbeitsfokusWahl from "@/components/ArbeitsfokusWahl";
import ThemaSchalter from "@/components/ThemaSchalter";
import AppInstallieren from "@/components/AppInstallieren";
import RueckmeldungGeben from "@/components/RueckmeldungGeben";
import NummerHinterlegen from "@/components/NummerHinterlegen";
import Meldungen from "@/components/Meldungen";
import { card, pageTitle, btnSecondary, columnNarrow } from "@/components/ui";

export default async function ProfilPage() {
  const user = await requireUser();
  const coach = await ladeCoach(user.id);
  const [aktiveDirekte, leader, admin] = await Promise.all([
    prisma.user.count({
      where: {
        leaderId: user.id,
        deactivatedAt: null,
        passwordHash: { not: null },
      },
    }),
    user.leaderId
      ? prisma.user.findUnique({
          where: { id: user.leaderId },
          select: { name: true },
        })
      : null,
    prisma.user.findFirst({
      where: { role: "ADMIN", deactivatedAt: null },
      orderBy: { createdAt: "asc" },
      select: { name: true },
    }),
  ]);
  return (
    <div className={`${columnNarrow} space-y-7`}>
      <div>
        <h1 className={pageTitle}>Dein Profil</h1>
        <p className="mt-2 text-ink-muted">{user.name}</p>
      </div>
      <section className={`${card} space-y-4 p-5`}>
        <h2 className="text-lg font-semibold">Deine Startseite</h2>
        <p className="text-sm text-ink-muted">
          Wähle, worauf du dich konzentrierst. Deine Kontakte und dein Team
          bleiben immer erreichbar.
        </p>
        <ArbeitsfokusWahl
          wert={user.arbeitsfokus}
          aktiveDirekte={aktiveDirekte}
        />
      </section>
      <div className="crm-list">
        {coach && <CoachProfileEntry />}
        <Link href="/willkommen" className="crm-list-row">
          Einstieg ansehen <span className="ml-auto">›</span>
        </Link>
        <Link href="/kalender/quellen" className="crm-list-row">
          Kalender verbinden <span className="ml-auto">›</span>
        </Link>
        <Link href="/kalender/abo" className="crm-list-row">
          Termine auf dem iPhone <span className="ml-auto">›</span>
        </Link>
        <Link href="/mannschaft" className="crm-list-row">
          Team und Einblick <span className="ml-auto">›</span>
        </Link>
        <PersonLink href="/mannschaft/verwalten" className="crm-list-row">
          Struktur verwalten <span className="ml-auto">›</span>
        </PersonLink>
        <Link href="/konto/export" className="crm-list-row">
          Eigene Daten exportieren <span className="ml-auto">›</span>
        </Link>
        {user.role === "ADMIN" && (
          <>
            <Link href="/team" className="crm-list-row">
              Verwaltung <span className="ml-auto">›</span>
            </Link>
            <Link href="/werkstatt" className="crm-list-row">
              Werkstatt <span className="ml-auto">›</span>
            </Link>
          </>
        )}
      </div>
      {leader && !user.phone && (
        <NummerHinterlegen fuehrungskraft={leader.name} />
      )}
      <Meldungen vapidKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""} />
      <section className={`${card} p-5`}>
        <h2 className="text-lg font-semibold">App-Einstellungen</h2>
        <div className="buehne mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-navy-950 p-3 text-white">
          <span className="flex-1 text-sm">Darstellung</span>
          <ThemaSchalter />
          <AppInstallieren />
          <RueckmeldungGeben empfaenger={admin?.name.split(" ")[0]} />
        </div>
      </section>
      <form action={logout}>
        <button type="submit" className={`${btnSecondary} w-full`}>
          Abmelden
        </button>
      </form>
    </div>
  );
}
