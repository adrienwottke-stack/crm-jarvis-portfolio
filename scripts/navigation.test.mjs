import assert from "node:assert/strict";
import { test } from "node:test";
import { HAUPTNAVIGATION, BEREICHSNAVIGATION, TEAMAKTIONEN, WERKZEUGE, workspaceLocation, visibleNavigation, navigationHref, navAktiv, navigationCapabilities, calendarView } from "../lib/navigation.ts";
import { assistantIsFull } from "../lib/assistant-layout.ts";

const access = { calculatorEnabled: true, unitsEnabled: true, teamEveningEnabled: true, reportEnabled: true, canManageStructure: true, canCreateTeamGoal: true, admin: true };
const location = (url) => { const parsed = new URL(url, "https://crm.example.test"); return workspaceLocation(parsed.pathname, parsed.searchParams); };

test("assistant focus, scroll and route behavior share the 1280 panel boundary", () => {
  assert.equal(assistantIsFull("panel", 1279), true);
  assert.equal(assistantIsFull("panel", 1280), false);
  assert.equal(assistantIsFull("workspace", 1440), true);
});

test("five stable main areas; global search has its own title", () => {
  assert.deepEqual(HAUPTNAVIGATION.map(link => link.label), ["Heute", "Kontakte", "Kalender", "Fortschritt", "Team"]);
  assert.equal(location("/suche").title, "Suche");
  assert.equal(location("/suche").area, undefined);
  assert.equal(navAktiv(HAUPTNAVIGATION[1], "/suche"), false);
});

test("static pages are resolved before person IDs", () => {
  for (const [path, title] of [["/contacts/new", "Kontakt anlegen"], ["/mannschaft/ziele", "Teamziele"], ["/mannschaft/verwalten", "Struktur verwalten"], ["/team", "Konten und Zugänge"], ["/werkstatt/ki", "Werkstatt"], ["/konto/export", "Daten exportieren"], ["/assistent", "Jarvis"]]) {
    assert.equal(location(path).title, title, path);
  }
  assert.equal(location("/contacts/person/edit").title, "Kontakt bearbeiten");
  assert.equal(location("/mannschaft/person").title, "Person im Team");
});

test("team siblings remain assigned on every child route and legacy structure view", () => {
  assert.deepEqual(BEREICHSNAVIGATION.team.map(link => link.label), ["Begleiten", "Absprachen", "Teamziele", "Auswertung", "Struktur"]);
  for (const [path, section] of [["/mannschaft", "team-care"], ["/mannschaft/vereinbarungen/example", "team-agreements"], ["/mannschaft/ziele", "team-goals"], ["/mannschaft/auswertung?umfang=direkte", "team-analysis"], ["/mannschaft?bereich=ueberblick", "team-structure"], ["/mannschaft?ansicht=liste", "team-structure"], ["/mannschaft/verwalten/person", "team-structure"], ["/mannschaft/bericht", "team-structure"]]) {
    assert.equal(location(path).area, "team", path);
    assert.equal(location(path).section?.id, section, path);
  }
});

test("competition aliases and nested progress pages resolve consistently", () => {
  for (const path of ["/arena", "/leaderboard", "/log", "/spiel/round"]) {
    assert.equal(location(path).area, "fortschritt", path);
    assert.equal(location(path).section?.id, "progress-competition", path);
  }
  assert.equal(location("/fortschritt/warum").section?.id, "progress-purpose");
  assert.equal(location("/fortschritt/einheiten-offen").section?.id, "progress-units");
  assert.equal(location("/fortschritt/example-goal").title, "Ziel");
});

test("calendar shell, remembered view and mobile picker use the same view and date", () => {
  assert.equal(calendarView(null, null, true), "liste");
  assert.equal(calendarView(null, null, false), "woche");
  assert.equal(calendarView("tag", "monat", true), "tag");
  assert.equal(calendarView("invalid", "monat", true), "monat");
  assert.equal(workspaceLocation("/kalender", new URLSearchParams(), "liste").section?.id, "calendar-agenda");
  const day = new URLSearchParams({ tag: "2026-10-06", ansicht: "tag" });
  assert.equal(navigationHref(BEREICHSNAVIGATION.kalender[0], "/kalender", day, null), "/kalender?ansicht=monat&tag=2026-10-06");
});

test("navigation exposes only available actions; viewing team goals is distinct from creating them", () => {
  const member = { ...access, admin: false, canCreateTeamGoal: false, canManageStructure: false, reportEnabled: false, teamEveningEnabled: false, calculatorEnabled: false, unitsEnabled: false };
  assert.deepEqual(visibleNavigation(TEAMAKTIONEN, member).map(link => link.id), []);
  assert.ok(visibleNavigation(BEREICHSNAVIGATION.team, member).some(link => link.id === "team-goals"));
  assert.ok(!visibleNavigation(WERKZEUGE, member).some(link => link.id === "calculator"));
  assert.ok(!visibleNavigation(BEREICHSNAVIGATION.fortschritt, member).some(link => link.id === "progress-units"));
});

test("report, team goal creation and structure follow their distinct existing guards", () => {
  const flags = { zinsrechner: true, einheiten: true, teamabend: true, bericht: true };
  const user = { id: "lead", role: "MEMBER", path: "/lead/", passwordHash: "fixture", deactivatedAt: null };
  const uninitializedPartner = navigationCapabilities(user, { activeDirect: 1, initializedDirect: 0 }, flags);
  assert.equal(uninitializedPartner.reportEnabled, true);
  assert.equal(uninitializedPartner.canCreateTeamGoal, false);
  assert.equal(uninitializedPartner.canManageStructure, true);
  const invalidPath = navigationCapabilities({ ...user, path: "/" }, { activeDirect: 1, initializedDirect: 1 }, flags);
  assert.equal(invalidPath.canManageStructure, false);
  assert.equal(invalidPath.canCreateTeamGoal, false);
  const admin = navigationCapabilities({ ...user, role: "ADMIN", path: "/" }, { activeDirect: 0, initializedDirect: 0 }, flags);
  assert.equal(admin.reportEnabled, true);
  assert.equal(admin.canManageStructure, true);
  assert.equal(admin.canCreateTeamGoal, false);
  assert.equal(navigationCapabilities(user, { activeDirect: 1, initializedDirect: 1 }, { ...flags, bericht: false }).reportEnabled, false);
});

test("collection and contact actions preserve the actual list and safe return filters", () => {
  const params = new URLSearchParams({ liste: "VERKAUF", q: "Mara", status: "offen", telefon: "ohne" });
  const link = { id: "collection", label: "Namen sammeln", href: "/namen/sammeln", contactContext: true };
  const target = new URL(navigationHref(link, "/namen", params, "RECRUITING"), "https://crm.example.test");
  assert.equal(target.searchParams.get("liste"), "VERKAUF");
  assert.equal(target.searchParams.get("returnTo"), "/namen?liste=VERKAUF&q=Mara&status=offen&telefon=ohne");
  const detailParams = new URLSearchParams({ returnTo: "/namen?liste=VERKAUF&q=Mara" });
  assert.equal(new URL(navigationHref(link, "/contacts/person", detailParams, "RECRUITING"), "https://crm.example.test").searchParams.get("liste"), "VERKAUF");
  assert.equal(navigationHref(BEREICHSNAVIGATION.kontakte[0], "/contacts/person/edit", detailParams, "RECRUITING"), "/namen?liste=VERKAUF&q=Mara");
  const hostile = new URLSearchParams({ returnTo: "https://foreign.example/path?liste=VERKAUF" });
  const safe = new URL(navigationHref(link, "/contacts/person", hostile, "RECRUITING"), "https://crm.example.test");
  assert.equal(safe.searchParams.get("liste"), "RECRUITING");
  assert.equal(safe.searchParams.get("returnTo"), "/namen");
});
