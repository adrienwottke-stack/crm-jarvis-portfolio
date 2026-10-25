import Link from "next/link";
import { Suspense } from "react";
import MiniEmil from "@/components/coach/MiniEmil";
import { ladeCoach } from "@/lib/coach/server";
import { Wordmark } from "@/components/Logo";
import NavLinks from "@/components/NavLinks";
import NamenSammelnLink from "@/components/NamenSammelnLink";
import UndoBar from "@/components/UndoBar";
import EinheitenNachAbschluss from "@/components/EinheitenNachAbschluss";
import InstallationMelder from "@/components/InstallationMelder";
import SuchTastatur from "@/components/suche/SuchTastatur";
import { HAUPTNAVIGATION } from "@/lib/navigation";
import { shell, gutter } from "@/components/ui";
import type { User } from "@/lib/generated/prisma/client";
import AssistantEntry from "@/components/ai-crm/AssistantEntry";
import AssistantSurface from "@/components/ai-crm/AssistantSurface";
import { ladeNavigationZugriff } from "@/lib/navigation-access";
import WorkspaceArea, { WorkspaceNavigationProvider } from "@/components/WorkspaceNavigation";
import { WorkspaceTitle, WorkspaceTools } from "@/components/WorkspaceHeader";
import ReleaseAnnouncement from "@/components/releases/ReleaseAnnouncement";
import Meldungen from "@/components/Meldungen";
import { defaultCalendarView } from "@/lib/calendar-view";

export function navigationFuer() {
  return HAUPTNAVIGATION;
}

export default async function AppShell({
  user,
  children,
}: {
  user: User;
  children: React.ReactNode;
}) {
  const [coach, access, calendarView] = await Promise.all([
    ladeCoach(user.id).catch(() => null),
    ladeNavigationZugriff(user),
    defaultCalendarView(),
  ]);
  return (
    <WorkspaceNavigationProvider access={access} defaultList={user.startTrack} calendarView={calendarView}>
    <div className="crm-shell flex min-h-dvh flex-col">
      <a
        href="#hauptinhalt"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-surface focus:p-4"
      >
        Zum Inhalt
      </a>
      <header className="crm-header sticky top-0 z-20 border-b border-line bg-canvas pt-[env(safe-area-inset-top)]">
        <div
          className={`${shell} ${gutter} crm-topbar flex h-16 items-center justify-between gap-3`}
        >
          <Link href="/heute" aria-label="Cockpit · Heute" className="crm-brand">
            <Wordmark />
          </Link>
          <Suspense fallback={<span className="crm-mobile-title">Cockpit</span>}><WorkspaceTitle /></Suspense>
          <div className="crm-global-actions flex items-center gap-2">
            <Suspense fallback={null}><NamenSammelnLink className="crm-collection-header" /></Suspense>
            <AssistantEntry />
            <Link
              href="/suche"
              aria-label="Suchen"
              className="crm-global-search inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-medium text-ink-muted hover:bg-surface hover:text-ink"
            >
              <svg
                aria-hidden
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                className="h-5 w-5"
              >
                <circle cx="10.5" cy="10.5" r="6.5" />
                <path d="m16 16 5 5" />
              </svg>
              <span className="assistant-search-label">CRM durchsuchen</span>
            </Link>
            <Suspense fallback={null}><WorkspaceTools /></Suspense>
          </div>
        </div>
        <div className="crm-navigation-container">
          <Suspense fallback={null}><NavLinks links={navigationFuer()} /></Suspense>
        </div>
      </header>
      <main
        id="hauptinhalt"
        className={`${shell} ${gutter} crm-main flex-1 pt-6 md:py-10`}
      >
        <Suspense fallback={null}><WorkspaceArea /></Suspense>
        {children}
      </main>
      <UndoBar />
      <AssistantSurface userId={user.id} />
      <SuchTastatur />
      <EinheitenNachAbschluss />
      <InstallationMelder melden={user.installedAt === null} />
      <Suspense fallback={null}><MiniEmil initial={coach} /></Suspense>
      <Meldungen vapidKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""} userId={user.id} syncOnly />
      <Suspense fallback={null}><ReleaseAnnouncement key={user.id} userId={user.id} /></Suspense>
    </div>
    </WorkspaceNavigationProvider>
  );
}
