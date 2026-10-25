"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import ArbeitsDialog from "@/components/ArbeitsDialog";
import VorfuehrSchalter from "@/components/VorfuehrSchalter";
import { useVorfuehren } from "@/components/VorfuehrProvider";
import { BEREICHSNAVIGATION, HAUPTNAVIGATION, TEAMAKTIONEN, DEFAULT_NAV_ACCESS, navigationHref, visibleNavigation, workspaceLocation, type CalendarView, type NavEntry, type NavigationAccess, type NavSymbol } from "@/lib/navigation";

const NavigationContext = createContext<{ access: NavigationAccess; defaultList: string | null; calendarView: CalendarView }>({ access: DEFAULT_NAV_ACCESS, defaultList: null, calendarView: "woche" });
export function WorkspaceNavigationProvider({ access, defaultList, calendarView, children }: { access: NavigationAccess; defaultList: string | null; calendarView: CalendarView; children: ReactNode }) {
  return <NavigationContext.Provider value={{ access, defaultList, calendarView }}>{children}</NavigationContext.Provider>;
}
export const useWorkspaceNavigation = () => useContext(NavigationContext);

/** Keep explicit document navigation on the existing person-management paths. */
export function WorkspaceLink({ entry, children, className, active, onClick }: { entry: NavEntry; children?: ReactNode; className?: string; active?: boolean; onClick?: () => void }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const { defaultList } = useWorkspaceNavigation();
  const href = navigationHref(entry, pathname, params, defaultList);
  const props = { href, className, "aria-current": active ? "page" as const : undefined, onClick, children: children ?? entry.label };
  return entry.navigation === "document" ? <a {...props} /> : <Link {...props} prefetch={entry.contactContext ? false : undefined} />;
}

export function WorkspaceAreaSelection({ area: symbol, sectionId }: { area: NavSymbol; sectionId?: string }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const { access, calendarView } = useWorkspaceNavigation();
  const current = workspaceLocation(pathname, params, calendarView);
  const area = HAUPTNAVIGATION.find(link => link.symbol === symbol)!;
  const entries = visibleNavigation(BEREICHSNAVIGATION[symbol], access);
  const selected = entries.find(entry => entry.id === (sectionId ?? current.section?.id));
  const [open, setOpen] = useState(false);
  const routeKey = `${pathname}?${params}`;
  const previousRoute = useRef(routeKey);
  useEffect(() => {
    if (previousRoute.current !== routeKey) setOpen(false);
    previousRoute.current = routeKey;
  }, [routeKey]);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1100px)");
    const close = () => setOpen(false);
    media.addEventListener("change", close);
    return () => media.removeEventListener("change", close);
  }, []);
  return <>
    <button className="crm-area-select" type="button" aria-haspopup="dialog" aria-expanded={open} aria-label={`${area.label}: ${selected?.label ?? area.label}, Bereich wechseln`} onClick={() => setOpen(true)}>
      {selected?.label ?? area.label}<span aria-hidden>⌄</span>
    </button>
    <ArbeitsDialog open={open} onClose={() => setOpen(false)} title={`${area.label}: Ansichten`}>
      <nav aria-label={`${area.label}: Unterbereiche`} className="crm-tools-menu">
        {entries.map(entry => <WorkspaceLink key={entry.id} entry={entry} active={entry.id === selected?.id} onClick={() => setOpen(false)}>{entry.label}<span aria-hidden>→</span></WorkspaceLink>)}
      </nav>
    </ArbeitsDialog>
  </>;
}

export function WorkspaceActionMenu({ title, entries, children }: { title: string; entries: NavEntry[]; children?: ReactNode }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const { access } = useWorkspaceNavigation();
  const [open, setOpen] = useState(false);
  const routeKey = `${pathname}?${params}`;
  const previousRoute = useRef(routeKey);
  useEffect(() => {
    if (previousRoute.current !== routeKey) setOpen(false);
    previousRoute.current = routeKey;
  }, [routeKey]);
  return <>
    <button type="button" className="crm-action-secondary" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>{title} <span aria-hidden>⌄</span></button>
    <ArbeitsDialog open={open} onClose={() => setOpen(false)} title={title}>
      <nav aria-label={`${title}: Aktionen`} className="crm-tools-menu">
        {visibleNavigation(entries, access).map(entry => <WorkspaceLink key={entry.id} entry={entry} onClick={() => setOpen(false)}>{entry.label}<span aria-hidden>→</span></WorkspaceLink>)}
      </nav>
      {children}
    </ArbeitsDialog>
  </>;
}

export default function WorkspaceArea() {
  const pathname = usePathname();
  const params = useSearchParams();
  const { access, calendarView } = useWorkspaceNavigation();
  const { aktiv } = useVorfuehren();
  const current = workspaceLocation(pathname, params, calendarView);
  const area = HAUPTNAVIGATION.find(link => link.symbol === current.area);
  const entries = current.area ? visibleNavigation(BEREICHSNAVIGATION[current.area], access) : [];
  if (!area || !entries.length || pathname === "/namen" || pathname === "/kalender") return null;
  return <div className={`crm-area-bar ${current.area === "team" ? "crm-area-team" : ""}`}>
    <WorkspaceAreaSelection area={current.area!} />
    {current.area === "team" && <div className="crm-area-actions">
      {aktiv && <span className="crm-presenting-badge" role="status">Namen verdeckt</span>}
      <Link href="/einladen" className="crm-action-primary">Einladen</Link>
      <WorkspaceActionMenu title="Teammenü" entries={TEAMAKTIONEN}>
        <div className="crm-menu-presentation"><VorfuehrSchalter /><p>Namen verdecken; Zahlen bleiben sichtbar.</p></div>
      </WorkspaceActionMenu>
    </div>}
  </div>;
}
