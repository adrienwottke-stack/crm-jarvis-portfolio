// End-to-end work paths, executed only against the disposable fixture.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { berlinDayOf, berlinLocalToUtc, shiftDay } from "../lib/dates.ts";

export async function runMasterplanFlows({ getPage, login, navigate, db, today, origin, output, providerState, checks, findings }) {
  let page = getPage();
  const screenshot = async name => page.screenshot({ path: fileURLToPath(new URL(`flow-${name}.png`, output)), animations: "disabled", caret: "initial" });
  const scenario = async (name, run) => {
    const only = process.argv.find(arg => arg.startsWith("--scenario="))?.slice(11);
    if (only && !only.split("|").some(part => name.toLowerCase().includes(part.toLowerCase()))) return;
    try { await run(); checks.push(name); console.log(`PASS: ${name}`); }
    catch (error) { findings.push({ name, error: String(error), stack: error.stack, activeElement: await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 1000)).catch(() => "unavailable") }); await screenshot(`failure-${findings.length}`).catch(() => {}); console.log(`FAIL: ${name}: ${error.stack ?? error}`); }
  };
  const fresh = async (id = "qa-ready", width = 390, height = 844) => { await login(id, width, height); page = getPage(); };
  const waitSaved = async predicate => { for (let i = 0; i < 60; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 100)); } assert.fail("Persisted result did not appear"); };
  const panel = () => page.locator("#crm-assistant-surface");
  const send = async message => { await panel().getByRole("textbox", { name: "Nachricht an den Assistenten" }).fill(message); await panel().getByRole("button", { name: "Senden", exact: true }).click(); await panel().getByText("Deine Anfrage wird bearbeitet …", { exact: true }).waitFor({ state: "hidden", timeout: 60000 }); };
  const openJarvis = async () => { await page.getByRole("button", { name: "Jarvis", exact: true }).click(); await panel().getByRole("textbox", { name: "Nachricht an den Assistenten" }).waitFor(); await panel().getByText("Unterhaltung wird geladen …", { exact: true }).waitFor({ state: "hidden", timeout: 60000 }); };

  await scenario("All five primary pages expose tools within two activations and preserve navigation/focus", async () => {
    await fresh();
    for (const route of ["/heute", "/namen", "/kalender", "/fortschritt", "/mannschaft"]) {
      await navigate(route);
      assert.deepEqual(await page.getByRole("navigation", { name: "Hauptnavigation", exact: true }).getByRole("link").allTextContents(), ["Heute", "Kontakte", "Kalender", "Fortschritt", "Team"]);
      const trigger = page.getByRole("button", { name: "Menü: Werkzeuge und Profil", exact: true });
      await trigger.click(); const tools = page.getByRole("dialog", { name: "Werkzeuge und Profil", exact: true });
      for (const href of ["/profil", "/hilfe", "/zinsrechner"]) { const link = tools.locator(`a[href="${href}"]`); assert.equal(await link.isVisible(), true); const r = await link.boundingBox(); assert.ok(r.height >= 44 && r.width >= 44); }
      await page.waitForFunction(() => document.querySelector("dialog[open]")?.contains(document.activeElement));
      for (let i = 0; i < 6; i++) { await page.keyboard.press("Tab"); assert.equal(await tools.evaluate(el => el.contains(document.activeElement)), true, `${route}: focus after Tab ${i}: ${await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 300))}`); }
      await page.keyboard.press("Escape"); assert.equal(await trigger.evaluate(el => el === document.activeElement), true);
    }
  });

  await scenario("Mobile filters: cancel discards edits; apply, edit/save and return preserve list/search/filter state", async () => {
    await fresh(); await navigate("/namen?liste=VERKAUF&q=Jonas");
    const filterButton = page.getByRole("button", { name: /^Filter/ }).first();
    await filterButton.click();
    let dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox", { name: "Status", exact: true }).selectOption("offen");
    await dialog.getByRole("combobox", { name: "Telefon", exact: true }).selectOption("mit");
    await dialog.getByRole("button", { name: "Abbrechen", exact: true }).click();
    assert.equal(new URL(page.url()).searchParams.get("status"), null);
    assert.equal(new URL(page.url()).searchParams.get("telefon"), null);
    assert.equal(await filterButton.evaluate(element => document.activeElement === element), true, "Cancel returns focus to filter button");
    await filterButton.click(); dialog = page.getByRole("dialog");
    assert.equal(await dialog.getByRole("combobox", { name: "Status", exact: true }).inputValue(), "alle");
    await dialog.getByRole("combobox", { name: "Status", exact: true }).selectOption("offen");
    await dialog.getByRole("combobox", { name: "Telefon", exact: true }).selectOption("mit");
    await dialog.getByRole("button", { name: "Anwenden", exact: true }).click();
    if (process.env.CRM_UI_NETWORK_DEBUG === "1") {
      await page.waitForTimeout(5000);
      console.log(JSON.stringify({ filterUrl: page.url(), filterState: await page.locator(".crm-contacts-resultbar").innerText() }));
    }
    await page.waitForURL(url => url.searchParams.get("status") === "offen" && url.searchParams.get("telefon") === "mit");
    await filterButton.locator(".crm-filter-count").getByText("2", { exact: true }).waitFor();
    const expected = new URL(page.url()).searchParams;
    await page.getByRole("link", { name: "Jonas Beispiel", exact: true }).click();
    await page.getByRole("link", { name: "Bearbeiten", exact: true }).first().click();
    await page.getByRole("textbox", { name: "Telefon", exact: true }).fill("+49 170 2222222");
    await page.getByRole("button", { name: "Änderungen speichern", exact: true }).click();
    await page.getByRole("heading", { name: "Jonas Beispiel", exact: true }).waitFor();
    assert.equal((await db.contact.findUnique({ where: { id: "qa-ready-contact-0" } })).phone, "+49 170 2222222");
    await page.getByRole("link", { name: "Zurück zu Kontakten", exact: true }).click();
    await page.waitForURL(url => url.pathname === "/namen");
    for (const key of ["liste", "q", "status", "telefon"]) assert.equal(new URL(page.url()).searchParams.get(key), expected.get(key));
    await screenshot("filtered-return-mobile");
  });

  await scenario("Contact states: no matches, missing phone, long name, record tabs and safe More actions", async () => {
    await fresh(); await navigate("/namen?liste=VERKAUF&q=UnbekannterPruefkontakt");
    assert.ok(/kein|keine|0 von/i.test(await page.locator("#hauptinhalt").innerText()));
    await screenshot("no-results");
    await navigate("/namen?liste=VERKAUF&q=Mara");
    assert.equal(await page.locator('#hauptinhalt a[href^="tel:"]').count(), 0, "No call action without phone");
    await navigate("/contacts/qa-ready-contact-2");
    const fullName = page.getByRole("heading", { name: "Anna-Lena Sophie Charlotte von Beispielhausen-Mustermann", exact: true });
    await fullName.waitFor();
    assert.ok(await fullName.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
    const tabs = page.getByRole("tab");
    assert.deepEqual(await tabs.allTextContents(), ["Übersicht", "Aktivitäten", "Details"]);
    await page.getByRole("tab", { name: "Aktivitäten", exact: true }).click();
    assert.equal(await page.getByRole("tab", { name: "Aktivitäten", exact: true }).getAttribute("aria-selected"), "true");
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.getByRole("tab", { name: "Details", exact: true }).evaluate(el => el === document.activeElement), true);
    assert.equal(await page.getByRole("button", { name: "Löschen", exact: true }).isVisible().catch(() => false), false);
    await screenshot("long-name-record");
  });

  await scenario("Today → existing contact result → persisted follow-up and updated Today", async () => {
    // Snapshot data stays immutable; make this dedicated mutation fixture's existing task primary.
    await db.contactFollowUp.updateMany({ where: { contactId: "qa-ready-contact-0", status: "OPEN" }, data: { isPrimary: true } });
    await fresh(); await navigate("/heute");
    await page.locator('#tagesarbeit a[href="/contacts/qa-ready-contact-0"]').click();
    await page.getByRole("heading", { name: "Jonas Beispiel", exact: true }).waitFor();
    const result = page.getByRole("button", { name: "Nicht erreicht", exact: true }).first();
    await result.waitFor();
    await result.click();
    await waitSaved(async () => (await db.activity.count({ where: { contactId: "qa-ready-contact-0", text: { contains: "Nicht erreicht" } } })) > 0);
    const contact = await db.contact.findUnique({ where: { id: "qa-ready-contact-0" } });
    assert.ok(contact.nextStepAt && berlinDayOf(contact.nextStepAt) === shiftDay(today, 2), "Existing unreachable rule moves the next call two days forward");
    await navigate("/heute");
    assert.equal(await page.locator('#tagesarbeit a[href="/contacts/qa-ready-contact-0"]').count(), 0, "The rescheduled task leaves today's due list");
    assert.ok((await page.locator("#tagesarbeit").innerText()).includes("keine Kontaktschritte offen"));
    await screenshot("today-after-result");
  });

  await scenario("Calendar: create real entry in Berlin time, find it after navigation and reach all existing views", async () => {
    await fresh(); await navigate(`/kalender?ansicht=liste&tag=${today}`);
    await page.locator('a[href^="/kalender/neu"]').first().click();
    await page.locator("label").filter({ hasText: /^Sonstiges$/ }).click();
    assert.equal(await page.getByLabel("Sonstiges", { exact: true }).isChecked(), true);
    await page.locator('input[name="von"]').fill(`${today}T18:15`);
    await page.locator('input[name="bis"]').fill(`${today}T19:00`);
    await page.locator('input[name="titel"]').fill("QA Termin am Abend");
    await page.locator('input[name="ort"]').fill("Synthetisches Testbüro");
    await page.getByRole("button", { name: "Eintragen", exact: true }).click();
    await page.waitForURL(url => url.pathname === "/kalender");
    const stored = await db.termin.findFirst({ where: { ownerId: "qa-ready", titel: "QA Termin am Abend" } });
    assert.equal(stored.von.toISOString(), berlinLocalToUtc(`${today}T18:15`).toISOString());
    await navigate("/heute"); await navigate(`/kalender?ansicht=liste&tag=${today}`);
    await page.getByText("QA Termin am Abend", { exact: true }).waitFor();
    await screenshot("calendar-created");
    for (const view of ["monat", "woche", "tag", "liste"]) { await navigate(`/kalender?ansicht=${view}&tag=${today}`); assert.ok(await page.locator("#hauptinhalt").textContent()); }
    await navigate(`/kalender?ansicht=tag&tag=${shiftDay(today, 45)}`); await screenshot("calendar-empty-day");
  });

  await scenario("Contact appointment: dialog traps and restores focus; the saved appointment keeps the contact association", async () => {
    await fresh(); await navigate("/contacts/qa-ready-contact-0");
    const opener = page.getByRole("button", { name: "Termin", exact: true });
    await opener.click(); const dialog = page.getByRole("dialog", { name: "Termin vereinbart", exact: true });
    await page.waitForFunction(() => document.querySelector('[role="dialog"]')?.contains(document.activeElement));
    assert.equal(await page.locator(".crm-shell").evaluate(el => el.inert), true);
    for (let i = 0; i < 18; i++) { await page.keyboard.press("Tab"); assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true); }
    await page.keyboard.press("Escape"); assert.equal(await opener.evaluate(el => el === document.activeElement), true);
    assert.equal(await page.locator(".crm-shell").evaluate(el => el.inert), false);
    await opener.click(); const when = `${shiftDay(today, 1)}T18:00`;
    await dialog.getByLabel("Oder genau eintragen", { exact: true }).fill(when);
    await dialog.getByRole("button", { name: "Termin speichern", exact: true }).click();
    await waitSaved(async () => (await db.contact.findUnique({ where: { id: "qa-ready-contact-0" } })).stage === "TERMIN_VEREINBART");
    const contact = await db.contact.findUnique({ where: { id: "qa-ready-contact-0" } });
    assert.equal(contact.appointmentAt.toISOString(), berlinLocalToUtc(when).toISOString());
    await navigate(`/kalender?ansicht=liste&tag=${shiftDay(today, 1)}`);
    const link = page.locator('a[href="/contacts/qa-ready-contact-0"]').first(); await link.waitFor();
    assert.ok((await link.textContent()).includes("Jonas Beispiel")); await screenshot("contact-appointment");
  });

  await scenario("Goals and partners: personal numbers are separate from team; permitted agreements/tools remain reachable", async () => {
    await fresh("qa-lead"); await navigate("/fortschritt");
    const own = page.getByRole("heading", { name: "Meine Anrufe im Monat", exact: true });
    const ownBox = await own.boundingBox();
    const nav = page.getByRole("navigation", { name: "Fortschritt entdecken", exact: true });
    assert.ok(ownBox.y < (await nav.boundingBox()).y, "Personal goals precede the tool directory");
    const body = await page.locator("#hauptinhalt").innerText();
    assert.ok(body.includes("6 von 20"));
    const person = await db.person.findUnique({ where: { userId: "qa-ready" } });
    const teamCount = await db.dailyLog.aggregate({ where: { personId: person.id, type: "CALL" }, _sum: { count: true } });
    assert.ok(body.includes(`${teamCount._sum.count} von 100`));
    for (const href of ["/einheiten", "/trichter", "/arena", "/fortschritt/warum"]) assert.ok(await page.locator(`a[href="${href}"]`).count() > 0);
    await navigate("/mannschaft");
    assert.ok((await page.locator("#hauptinhalt").innerText()).includes("Gespräch gemeinsam vorbereiten"));
    await page.getByRole("button", { name: /Team: .*, Bereich wechseln/ }).click();
    const sections = page.getByRole("dialog", { name: "Team: Ansichten", exact: true });
    for (const label of ["Begleiten", "Auswertung", "Struktur"]) assert.ok(await sections.getByRole("link", { name: label, exact: false }).isVisible());
    await sections.getByRole("link", { name: "Absprachen", exact: false }).click(); await page.getByText("Gespräch gemeinsam vorbereiten", { exact: true }).first().waitFor();
    await screenshot("agreements");
    await fresh("qa-empty"); providerState.expected404 = true; await page.goto(origin + "/contacts/qa-ready-contact-0");
    assert.equal(await page.getByRole("heading", { name: "Jonas Beispiel", exact: true }).count(), 0, "Foreign contact unavailable to unrelated account");
    providerState.expected404 = false;
  });

  await scenario("Jarvis and mixed editing: no microphone on open; manual proposal revision saves the verified value", async () => {
    await fresh("qa-ready", 1440, 900); await navigate("/contacts/qa-ready-contact-0");
    await openJarvis();
    assert.equal(await page.evaluate(() => window.__micRequests), 0);
    const geometry = await page.evaluate(() => ({ main: document.getElementById("hauptinhalt").getBoundingClientRect().right, panel: document.getElementById("crm-assistant-surface").getBoundingClientRect().left, inert: document.getElementById("hauptinhalt").inert }));
    assert.ok(geometry.main <= geometry.panel + 1); assert.equal(geometry.inert, false);
    await screenshot("wide-jarvis");
    await send("Ändere die Telefonnummer von Jonas.");
    await panel().getByRole("button", { name: "Vorschlag bearbeiten", exact: true }).click();
    await panel().getByRole("textbox", { name: "Telefonnummer", exact: true }).fill("+49 170 3333333");
    assert.equal(await panel().getByRole("button", { name: "Telefonnummer ändern", exact: true }).isEnabled(), false);
    await panel().getByRole("button", { name: "Neue Vorschau übernehmen", exact: true }).click();
    await panel().getByRole("button", { name: "Telefonnummer ändern", exact: true }).click();
    await waitSaved(async () => (await db.contact.findUnique({ where: { id: "qa-ready-contact-0" } })).phone === "+49 170 3333333");
    await page.locator("#hauptinhalt").getByRole("link", { name: "+49 170 3333333", exact: true }).first().waitFor();
    await screenshot("mixed-saved");
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("button", { name: "Jarvis", exact: true }).evaluate(el => el === document.activeElement), true);
  });

  await scenario("Provider failure leaves manual contact work usable", async () => {
    await fresh(); await navigate("/contacts/qa-ready-contact-0"); await openJarvis();
    providerState.fail = true;
    try { await send("Prüfe den Kontakt noch einmal."); await panel().getByText(/nicht erreichbar|gerade nicht|Kontingent|Verbindung|Anfrage/i).first().waitFor(); }
    finally { providerState.fail = false; }
    await screenshot("provider-error");
    await page.keyboard.press("Escape");
    await page.getByRole("link", { name: "Bearbeiten", exact: true }).first().click();
    await page.getByRole("textbox", { name: "Telefon", exact: true }).fill("+49 170 4444444");
    await page.getByRole("button", { name: "Änderungen speichern", exact: true }).click();
    await waitSaved(async () => (await db.contact.findUnique({ where: { id: "qa-ready-contact-0" } })).phone === "+49 170 4444444");
  });

  if (process.argv.includes("--production")) await scenario("Optimized build keeps the simulated live provider disabled and opening Jarvis never requests a microphone", async () => {
    await fresh(); await navigate("/heute"); await openJarvis();
    assert.equal(await page.evaluate(() => window.__micRequests), 0);
    assert.equal(await panel().getByRole("button", { name: "Sprachchat starten", exact: true }).count(), 0);
  });
  else await scenario("Voice start remains deliberate; cancelling a delayed microphone request cleans up the late stream", async () => {
    await fresh(); await navigate("/heute"); await openJarvis();
    assert.equal(await page.evaluate(() => window.__micRequests), 0);
    await page.evaluate(() => { window.__micStopped = 0; Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => { window.__micRequests++; return new Promise(resolve => { window.__resolveMic = () => { const track = { enabled: true, stop() { window.__micStopped++; } }; resolve({ getTracks: () => [track], getAudioTracks: () => [track] }); }; }); } } }); });
    await panel().getByRole("button", { name: "Sprachchat starten", exact: true }).click();
    await panel().getByRole("button", { name: "Abbrechen", exact: true }).click();
    await page.evaluate(() => window.__resolveMic());
    await page.waitForFunction(() => window.__micStopped > 0);
    assert.equal(await page.evaluate(() => window.__micRequests), 1);
    assert.equal(await db.aiLiveSession.count({ where: { userId: "qa-ready", activeKey: "qa-ready" } }), 0);
    await screenshot("voice-cancelled");
  });

  await scenario("Presentation mode masks the first rendered view, subsequent routes and partner detail", async () => {
    await fresh("qa-lead"); await navigate("/mannschaft");
    await page.getByRole("button", { name: "Teammenü", exact: false }).click();
    await page.getByRole("button", { name: /Namen verdecken fürs Vorführen/ }).click();
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(() => sessionStorage.getItem("cockpit-vorfuehren")), "1");
    const names = ["Nora Partner", "Ben Begleitung", "Mara Aufbau", "Alex Eigenarbeit", "Jonas Beispiel", "Lena Führung"];
    await page.addInitScript(({ names }) => {
      window.__presentationLeaks = [];
      const check = () => {
        if (document.body) {
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let node;
          while ((node = walker.nextNode())) {
            if (!names.some(name => node.textContent.includes(name))) continue;
            const element = node.parentElement;
            if (!element || /SCRIPT|STYLE/.test(element.tagName)) continue;
            const range = document.createRange(); range.selectNodeContents(node);
            const r = range.getBoundingClientRect(), s = getComputedStyle(element);
            if (r.width > 0 && r.height > 0 && r.top < innerHeight && r.bottom > 0 && s.visibility !== "hidden" && s.display !== "none" && element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) window.__presentationLeaks.push(node.textContent.trim());
          }
        }
        requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    }, { names });
    await page.route("**/_next/static/chunks/**", async route => { await new Promise(resolve => setTimeout(resolve, 450)); await route.continue(); });
    for (const route of ["/mannschaft", "/heute", "/mannschaft/qa-partner-0", "/namen?liste=VERKAUF", "/contacts/qa-lead-contact-0"]) {
      await navigate(route);
      const leaks = await page.evaluate(() => window.__presentationLeaks ?? []);
      assert.deepEqual(leaks, [], `No visible names during first paint/hydration on ${route}`);
      await screenshot(`presentation-${route.replaceAll(/[^a-z0-9]/gi, "-")}`);
    }
  });

  await scenario("Filter keyboard focus and short viewport: focus stays inside, Escape closes and returns focus", async () => {
    await fresh("qa-ready", 320, 380); await navigate("/namen?liste=VERKAUF");
    const opener = page.getByRole("button", { name: /^Filter/ }).first();
    await opener.click(); const dialog = page.getByRole("dialog");
    assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true);
    for (let i = 0; i < 12; i++) { await page.keyboard.press("Tab"); assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true); }
    await dialog.getByRole("button", { name: "Anwenden", exact: true }).scrollIntoViewIfNeeded();
    const box = await dialog.getByRole("button", { name: "Anwenden", exact: true }).boundingBox();
    assert.ok(box.y >= 0 && box.y + box.height <= 380);
    await screenshot("short-filter");
    await page.keyboard.press("Escape");
    assert.equal(await dialog.isVisible(), false);
    assert.equal(await opener.evaluate(el => el === document.activeElement), true);
  });

  await scenario("Simulated visual viewport keyboard hides and restores the dock and limits dialog height", async () => {
    await fresh("qa-ready", 390, 844); await navigate("/namen?liste=VERKAUF");
    await page.getByRole("searchbox", { name: "Kontakte suchen", exact: true }).focus();
    await page.evaluate(() => {
      Object.defineProperty(window.visualViewport, "height", { configurable: true, get: () => 430 });
      window.visualViewport.dispatchEvent(new Event("resize"));
    });
    await page.waitForFunction(() => document.documentElement.dataset.workspaceKeyboard === "true");
    assert.equal(await page.locator(".crm-dock").isVisible(), false);
    await screenshot("keyboard-simulation");
    await page.getByRole("button", { name: /^Filter/ }).first().click();
    const dialog = page.getByRole("dialog", { name: "Kontakte filtern", exact: true });
    assert.ok((await dialog.boundingBox()).height <= 430, "Dialog follows the available visual viewport");
    await screenshot("keyboard-dialog-simulation");
    await page.keyboard.press("Escape");
    await page.evaluate(() => { document.activeElement?.blur(); delete window.visualViewport.height; window.visualViewport.dispatchEvent(new Event("resize")); });
    await page.waitForFunction(() => document.documentElement.dataset.workspaceKeyboard === "false");
    assert.equal(await page.locator(".crm-dock").isVisible(), true);
  });

  await scenario("200 percent text scaling preserves access to primary actions and navigation", async () => {
    await fresh("qa-ready", 390, 844);
    for (const [route, selector] of [["/heute", ".crm-primary-action"], ["/namen?liste=VERKAUF", 'a[href^="/contacts/new"]'], ["/kalender", 'a[href^="/kalender/neu"]'], ["/fortschritt", 'a[href="/fortschritt/neu"]'], ["/mannschaft", '.crm-area-actions > a[href="/einladen"]'], ["/contacts/qa-ready-contact-0", '.crm-record-primary-actions > a'], ["/contacts/qa-ready-contact-0/edit", '#hauptinhalt button[type="submit"]']]) {
      await navigate(route); await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const action = page.locator(selector).first(); await action.scrollIntoViewIfNeeded();
      assert.equal(await action.isVisible(), true); const box = await action.boundingBox();
      const overflow = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, scrollX, elements: [...document.querySelectorAll("#hauptinhalt *")].map(el => ({ tag: el.tagName, class: el.className, x: el.getBoundingClientRect().x, width: el.getBoundingClientRect().width })).filter(item => item.width > innerWidth).slice(0, 8) }));
      assert.ok(box.x >= 0 && box.x + box.width <= 390, `${route}: primary action fits horizontally: ${JSON.stringify({ box, overflow })}`);
      await screenshot(`text-200-${route.split("?")[0].replaceAll("/", "-")}`);
    }
  });

  await scenario("Mixed leadership view and real collection onboarding use the same shell with the relevant next work", async () => {
    await db.user.update({ where: { id: "qa-lead" }, data: { arbeitsfokus: "AUFBAU" } });
    try { await fresh("qa-lead"); await navigate("/heute"); assert.ok((await page.locator("#hauptinhalt").innerText()).includes("Geschäft und Partneraufbau")); await screenshot("mixed-role-today"); }
    finally { await db.user.update({ where: { id: "qa-lead" }, data: { arbeitsfokus: "FUEHRUNG" } }); }
    await fresh("qa-empty"); await navigate("/heute");
    await page.getByRole("region", { name: "Namen sammeln", exact: true }).waitFor();
    await page.getByRole("button", { name: "Jetzt Namen sammeln", exact: true }).waitFor();
    assert.equal((await db.startProgress.findUnique({ where: { userId: "qa-empty" } })).phase, "COLLECTION");
    await screenshot("onboarding-collection");
    const collect = page.getByRole("region", { name: "Namen sammeln", exact: true }).getByRole("button", { name: "Jetzt Namen sammeln", exact: true }); await collect.click(); await page.waitForURL(url => url.pathname === "/namen/sammeln");
    assert.equal(await db.contact.count({ where: { ownerId: "qa-empty" } }), 0);
  });

  await scenario("Today shows at most three tasks and opens the actual full task list", async () => {
    for (let i = 1; i < 6; i++) await db.contactFollowUp.create({ data: { contactId: `qa-ready-contact-${i}`, ownerId: "qa-ready", type: "ANRUF", at: new Date(`${today}T08:00:00Z`), note: `Prüfaufgabe ${i}`, isPrimary: true } });
    await fresh(); await navigate("/heute");
    assert.equal(await page.locator("#tagesarbeit .crm-today-task").count(), 3);
    const all = page.locator('#tagesarbeit a[href="/heute?alle=1#tagesarbeit"]').first();
    const expected = Number((await all.innerText()).match(/\d+/)?.[0]); assert.ok(expected >= 5);
    await all.click(); await page.waitForURL(url => url.searchParams.get("alle") === "1");
    assert.equal(await page.locator("#tagesarbeit .crm-today-task").count(), expected);
    await screenshot("today-all-tasks");
  });

  await scenario("Contact loading and failed save retain usable context and input, then allow retry", async () => {
    await fresh(); await navigate("/namen?liste=VERKAUF");
    await page.route("**/namen?**", async route => { if (route.request().method() === "GET" && new URL(route.request().url()).searchParams.get("q") === "Ben") await new Promise(resolve => setTimeout(resolve, 1600)); await route.continue(); });
    await page.getByRole("searchbox", { name: "Kontakte suchen", exact: true }).fill("Ben");
    await page.getByRole("button", { name: "Kontakte suchen", exact: true }).click();
    await page.getByText(/Wird geladen|Kontakte werden geladen/).first().waitFor();
    await screenshot("contacts-loading");
    await page.waitForURL(url => url.searchParams.get("q") === "Ben");
    await page.getByRole("link", { name: "Ben Beispiel", exact: true }).waitFor(); await page.unroute("**/namen?**");
    await navigate("/namen?liste=VERKAUF");
    await page.getByRole("button", { name: "Listenaktionen", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Listenaktionen", exact: true });
    await dialog.getByRole("button", { name: "Einzeln eintragen", exact: true }).click();
    await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("Kontakt Fehlerprobe");
    providerState.expectedNetworkFailure = true;
    await page.route("**/namen?**", route => route.request().method() === "POST" ? route.abort("failed") : route.continue());
    await dialog.getByRole("button", { name: "Name speichern", exact: true }).click();
    await dialog.getByRole("alert").waitFor();
    assert.equal(await dialog.getByRole("textbox", { name: "Name", exact: true }).inputValue(), "Kontakt Fehlerprobe");
    assert.equal(await db.contact.count({ where: { ownerId: "qa-ready", name: "Kontakt Fehlerprobe" } }), 0);
    await screenshot("contacts-save-error");
    await page.unroute("**/namen?**");
    providerState.expectedNetworkFailure = false;
    await dialog.getByRole("button", { name: "Name speichern", exact: true }).click();
    await waitSaved(async () => (await db.contact.count({ where: { ownerId: "qa-ready", name: "Kontakt Fehlerprobe" } })) === 1);
  });

  await writeFile(new URL("flow-result.json", output), JSON.stringify({ success: findings.length === 0, checks, findings }, null, 2));
}
