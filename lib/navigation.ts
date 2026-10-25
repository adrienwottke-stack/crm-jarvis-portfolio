import { contactListReturn } from "@/lib/contact-navigation";

export type NavSymbol =
  | "heute"
  | "kontakte"
  | "kalender"
  | "fortschritt"
  | "team";
export type CalendarView = "monat" | "woche" | "tag" | "liste";
export function calendarView(query: string | null | undefined, saved: string | null | undefined, mobile: boolean): CalendarView {
  const valid = (value: string | null | undefined): value is CalendarView => ["monat", "woche", "tag", "liste"].includes(value ?? "");
  return valid(query) ? query : valid(saved) ? saved : mobile ? "liste" : "woche";
}
export interface NavLink {
  href: string;
  label: string;
  symbol?: NavSymbol;
  exact?: boolean;
  match?: string[];
}

export type NavigationAccess = {
  calculatorEnabled: boolean; unitsEnabled: boolean; teamEveningEnabled: boolean;
  reportEnabled: boolean; canManageStructure: boolean; canCreateTeamGoal: boolean; admin: boolean;
};
export interface NavEntry extends NavLink {
  id: string;
  enabled?: keyof NavigationAccess;
  navigation?: "document";
  contactContext?: boolean;
}
export const DEFAULT_NAV_ACCESS: NavigationAccess = { calculatorEnabled: false, unitsEnabled: false, teamEveningEnabled: false, reportEnabled: false, canManageStructure: false, canCreateTeamGoal: false, admin: false };

export const HAUPTNAVIGATION: NavLink[] = [
  { href: "/heute", label: "Heute", symbol: "heute" },
  {
    href: "/namen",
    label: "Kontakte",
    symbol: "kontakte",
    match: ["/contacts"],
  },
  { href: "/kalender", label: "Kalender", symbol: "kalender" },
  {
    href: "/fortschritt",
    label: "Fortschritt",
    symbol: "fortschritt",
    match: [
      "/arena",
      "/leaderboard",
      "/log",
      "/einheiten",
      "/spiel",
      "/trichter",
    ],
  },
  { href: "/mannschaft", label: "Team", symbol: "team", match: ["/einladen", "/teamabend"] },
];

export function navAktiv(link: NavLink, pathname: string): boolean {
  const href = link.href.split("?")[0];
  return link.exact
    ? pathname === href
    : [href, ...(link.match ?? [])].some(
        (path) => pathname === path || pathname.startsWith(`${path}/`),
      );
}

export const BEREICHSNAVIGATION: Record<NavSymbol, NavEntry[]> = {
  heute: [],
  kontakte: [
    { id: "contacts-list", href: "/namen", label: "Kontaktliste", contactContext: true },
    { id: "contacts-call", href: "/namen/anrufen", label: "Anrufen", contactContext: true },
    { id: "contacts-phone", href: "/namen/nummern", label: "Nummern ergänzen", contactContext: true },
  ],
  kalender: [
    { id: "calendar-month", href: "/kalender?ansicht=monat", label: "Monat" },
    { id: "calendar-week", href: "/kalender?ansicht=woche", label: "Woche" },
    { id: "calendar-day", href: "/kalender?ansicht=tag", label: "Tag" },
    { id: "calendar-agenda", href: "/kalender?ansicht=liste", label: "Agenda" },
  ],
  fortschritt: [
    { id: "progress-goals", href: "/fortschritt", label: "Ziele" },
    { id: "progress-units", href: "/einheiten", label: "Einheiten", enabled: "unitsEnabled", match: ["/fortschritt/einheiten-offen"] },
    { id: "progress-funnel", href: "/trichter", label: "Trichter" },
    { id: "progress-competition", href: "/arena", label: "Wettbewerb", match: ["/leaderboard", "/log", "/spiel"] },
    { id: "progress-purpose", href: "/fortschritt/warum", label: "Mein Warum" },
  ],
  team: [
    { id: "team-care", href: "/mannschaft", label: "Begleiten", exact: true },
    { id: "team-agreements", href: "/mannschaft/vereinbarungen", label: "Absprachen" },
    { id: "team-goals", href: "/mannschaft/ziele", label: "Teamziele" },
    { id: "team-analysis", href: "/mannschaft/auswertung", label: "Auswertung" },
    { id: "team-structure", href: "/mannschaft?bereich=ueberblick", label: "Struktur", match: ["/mannschaft/verwalten", "/mannschaft/bericht"] },
  ],
};
export const NAMEN_SAMMELN: NavEntry = { id: "collection", href: "/namen/sammeln", label: "Namen sammeln", contactContext: true };
export const WERKZEUGE: NavEntry[] = [
  { id: "news", href: "/neuigkeiten", label: "Neuigkeiten" },
  { id: "memory", href: "/tools/jarvis-erinnerungen", label: "Jarvis-Erinnerung" },
  { id: "pilot", href: "/tools/kontaktpilot", label: "Kontaktpilot" },
  { id: "calculator", href: "/zinsrechner", label: "Zinsrechner", enabled: "calculatorEnabled" },
];
export const SERVICE_NAVIGATION: NavEntry[] = [
  { id: "help", href: "/hilfe", label: "Hilfe und Support" },
  { id: "profile", href: "/profil", label: "Profil und Einstellungen" },
  { id: "accounts", href: "/team", label: "Konten und Zugänge", enabled: "admin", navigation: "document" },
  { id: "workshop", href: "/werkstatt", label: "Werkstatt", enabled: "admin" },
];
export const TEAMAKTIONEN: NavEntry[] = [
  { id: "team-manage", href: "/mannschaft/verwalten", label: "Struktur verwalten", enabled: "canManageStructure", navigation: "document" },
  { id: "team-report", href: "/mannschaft/bericht", label: "Berichts-Link erstellen", enabled: "reportEnabled" },
  { id: "team-evening", href: "/teamabend", label: "Netzwerkabend", enabled: "teamEveningEnabled" },
];
export const KALENDERAKTIONEN: NavEntry[] = [
  { id: "calendar-sources", href: "/kalender/quellen", label: "Kalenderquellen" },
  { id: "calendar-subscription", href: "/kalender/abo", label: "Kalender-Abo" },
];
type Query = Pick<URLSearchParams, "get">;
const under = (path: string, root: string) => path === root || path.startsWith(`${root}/`);
export function visibleNavigation(entries: NavEntry[], access: NavigationAccess): NavEntry[] {
  return entries.filter(entry => !entry.enabled || access[entry.enabled]);
}
export function navigationCapabilities(user: { id: string; role: string; path: string; passwordHash: string | null; deactivatedAt: Date | null }, counts: { activeDirect: number; initializedDirect: number }, features: { zinsrechner: boolean; einheiten: boolean; teamabend: boolean; bericht: boolean }): NavigationAccess {
  const active = !user.deactivatedAt;
  const admin = active && user.role === "ADMIN";
  return {
    admin, calculatorEnabled: features.zinsrechner, unitsEnabled: features.einheiten, teamEveningEnabled: features.teamabend,
    reportEnabled: active && features.bericht && (counts.activeDirect > 0 || admin),
    canManageStructure: active && (admin || (user.path !== "/" && user.path.endsWith(`/${user.id}/`))),
    canCreateTeamGoal: active && !!user.passwordHash && user.path !== "/" && counts.initializedDirect > 0,
  };
}

/** Only the current contact list's safe filters can travel between work actions. */
export function navigationHref(entry: NavEntry, pathname: string, params: Query, defaultList: string | null): string {
  if (!entry.contactContext) {
    if (entry.href.startsWith("/kalender?")) {
      const [path, query] = entry.href.split("?");
      const target = new URLSearchParams(query);
      const date = params.get("tag");
      if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) target.set("tag", date);
      return `${path}?${target}`;
    }
    return entry.href;
  }
  let back = contactListReturn(params.get("returnTo"));
  if (pathname === "/namen") {
    const query = new URLSearchParams();
    for (const key of ["liste", "q", "status", "telefon"]) { const value = params.get(key); if (value) query.set(key, value); }
    back = contactListReturn(`/namen?${query}`);
  }
  const list = params.get("liste") ?? new URLSearchParams(back.split("?")[1]).get("liste") ?? defaultList;
  const query = new URLSearchParams();
  if (list === "VERKAUF" || list === "RECRUITING") query.set("liste", list);
  if (entry.href === "/namen") return back !== "/namen" ? back : `/namen${query.size ? `?${query}` : ""}`;
  if (pathname.startsWith("/namen") || pathname.startsWith("/contacts")) query.set("returnTo", back);
  return `${entry.href}${query.size ? `?${query}` : ""}`;
}

export function workspaceLocation(pathname: string, params: Query = new URLSearchParams(), defaultCalendarView: CalendarView = "woche"): { title: string; area?: NavSymbol; section?: NavEntry; backHref?: string } {
  const area = HAUPTNAVIGATION.find(link => navAktiv(link, pathname))?.symbol;
  let section: NavEntry | undefined;
  if (area === "team") {
    const entries = BEREICHSNAVIGATION.team;
    section = entries.slice(1, 4).find(link => navAktiv(link, pathname));
    if (!section) section = pathname.startsWith("/mannschaft/verwalten") || pathname === "/mannschaft/bericht" || (pathname === "/mannschaft" && (params.get("bereich") === "ueberblick" || params.get("ansicht") === "liste")) ? entries[4] : entries[0];
  } else if (area === "fortschritt") {
    section = BEREICHSNAVIGATION.fortschritt.slice(1).find(link => navAktiv(link, pathname)) ?? BEREICHSNAVIGATION.fortschritt[0];
  } else if (area === "kontakte") {
    section = BEREICHSNAVIGATION.kontakte.slice(1).find(link => navAktiv(link, pathname)) ?? BEREICHSNAVIGATION.kontakte[0];
  } else if (area === "kalender") {
    section = BEREICHSNAVIGATION.kalender.find(link => new URLSearchParams(link.href.split("?")[1]).get("ansicht") === calendarView(params.get("ansicht"), defaultCalendarView, false));
  }
  // Static names precede dynamic contact/person routes.
  const names: Record<string, string> = { "/heute": "Heute", "/namen": "Kontakte", "/namen/sammeln": "Namen sammeln", "/namen/anrufen": "Anrufen", "/namen/nummern": "Nummern ergänzen", "/namen/startklar": "Anrufe vorbereiten", "/contacts/new": "Kontakt anlegen", "/kalender": "Kalender", "/kalender/neu": "Termin erstellen", "/kalender/quellen": "Kalender verbinden", "/kalender/abo": "Kalender-Abo", "/fortschritt": "Fortschritt", "/fortschritt/neu": "Ziel erstellen", "/fortschritt/warum": "Mein Warum", "/fortschritt/einheiten-offen": "Offene Einheitenmeldungen", "/mannschaft": "Team", "/mannschaft/ziele": "Teamziele", "/mannschaft/vereinbarungen": "Absprachen", "/mannschaft/auswertung": "Auswertung", "/mannschaft/verwalten": "Struktur verwalten", "/mannschaft/bericht": "Struktur-Bericht", "/einladen": "Partner einladen", "/teamabend": "Netzwerkabend", "/team": "Konten und Zugänge", "/konto/export": "Daten exportieren", "/assistent": "Jarvis" };
  let title = names[pathname] ?? [...WERKZEUGE, ...SERVICE_NAVIGATION, ...BEREICHSNAVIGATION.fortschritt.slice(1)].find(link => navAktiv(link, pathname))?.label;
  if (!title) {
    if (under(pathname, "/contacts")) title = pathname.endsWith("/edit") ? "Kontakt bearbeiten" : "Kontakt";
    else if (under(pathname, "/mannschaft/vereinbarungen")) title = "Absprache";
    else if (under(pathname, "/mannschaft/verwalten")) title = "Person verwalten";
    else if (under(pathname, "/mannschaft/notizen")) title = "Teamnotiz";
    else if (under(pathname, "/mannschaft")) title = "Person im Team";
    else if (under(pathname, "/fortschritt")) title = "Ziel";
    else title = pathname === "/suche" ? "Suche" : "Cockpit";
  }
  const main = HAUPTNAVIGATION.find(link => link.symbol === area);
  const backHref = pathname.startsWith("/contacts/") || pathname.startsWith("/namen/") ? contactListReturn(params.get("returnTo")) : main && pathname !== main.href ? section?.href ?? main.href : undefined;
  return { title, area, section, backHref: backHref?.split("?")[0] === pathname ? main?.href : backHref };
}
