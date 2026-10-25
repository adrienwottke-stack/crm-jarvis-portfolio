import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

export async function cleanUiFlows({ getPage, login, navigate, db, output, checks, findings }) {
  let page = getPage();
  const shot = name => page.screenshot({ path: fileURLToPath(new URL(`clean-${name}.png`, output)), animations: "disabled", caret: "initial" });
  const fresh = async (id, width = 390, height = 844) => { await login(id, width, height); page = getPage(); };
  const check = async (name, run) => {
    const only = process.argv.find(arg => arg.startsWith("--scenario="))?.slice(11);
    if (only && !only.split("|").some(part => name.toLowerCase().includes(part.toLowerCase()))) return;
    try { await run(); checks.push(name); console.log(`PASS: ${name}`); }
    catch (error) { findings.push({ name, error: String(error), stack: error.stack }); await shot(`failure-${findings.length}`).catch(() => {}); console.log(`FAIL: ${name}: ${error.message}`); }
  };
  const layout = async (label, selectors) => {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    for (const selector of selectors) {
      for (const control of await page.locator(selector).all()) {
        if (!await control.isVisible()) continue;
        await control.scrollIntoViewIfNeeded();
        const geometry = await control.evaluate(element => {
          const rect = element.getBoundingClientRect();
          const text = element.querySelector("span:last-child") ?? element;
          const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, viewport: innerWidth, viewportHeight: Math.min(innerHeight, (visualViewport?.height ?? innerHeight) + (visualViewport?.offsetTop ?? 0)), clipped: text.scrollWidth > text.clientWidth + 1, uncovered: !!hit && (hit === element || element.contains(hit)) };
        });
        assert.ok(geometry.width >= 43 && geometry.height >= 43 && geometry.x >= -1 && geometry.x + geometry.width <= geometry.viewport + 1 && geometry.y >= -1 && geometry.y + geometry.height <= geometry.viewportHeight + 1 && !geometry.clipped && geometry.uncovered, `${label}: ${selector}: ${JSON.stringify(geometry)}`);
      }
    }
  };
  const teamSection = async (name, width) => {
    if (width < 1100) {
      await page.getByRole("button", { name: /Team: .*, Bereich wechseln/ }).click();
      await page.getByRole("dialog", { name: "Team: Ansichten" }).getByRole("link", { name, exact: false }).click();
    } else await page.getByRole("navigation", { name: "Team: Unterbereiche", exact: true }).getByRole("link", { name, exact: true }).click();
  };
  await db.user.create({ data: { id: "qa-admin", name: "Sam Verwaltung", role: "ADMIN", path: "/qa-admin/", passwordHash: "synthetic", aiBetaEnabled: true, onboardingDoneAt: new Date(), installedAt: new Date(), createdAt: new Date("2026-01-01"), person: { create: { name: "Sam Verwaltung" } }, startProgress: { create: { phase: "DONE" } } } });

  await check("Team siblings reachable in at most two activations on phone and desktop for member, leader and admin", async () => {
    for (const id of ["qa-ready", "qa-lead", "qa-admin"]) for (const width of [390, 1440]) {
      await fresh(id, width); await navigate("/mannschaft");
      for (const [name, path] of [["Absprachen", "/mannschaft/vereinbarungen"], ["Teamziele", "/mannschaft/ziele"], ["Auswertung", "/mannschaft/auswertung"], ["Struktur", "/mannschaft"], ["Begleiten", "/mannschaft"]]) {
        await teamSection(name, width);
        await page.waitForURL(url => url.pathname === path && (name !== "Struktur" || url.searchParams.get("bereich") === "ueberblick"));
        await page.locator("h1").first().waitFor();
      }
      await page.getByRole("button", { name: "Teammenü", exact: false }).click();
      const menu = page.getByRole("dialog", { name: "Teammenü", exact: true });
      assert.equal(await menu.getByRole("link", { name: "Berichts-Link erstellen", exact: false }).count(), id === "qa-ready" ? 0 : 1);
      await page.keyboard.press("Escape");
      assert.equal(await page.getByRole("button", { name: "Teammenü", exact: false }).evaluate(element => element === document.activeElement), true);
    }
  });

  await check("Five main areas retain tools, focus and compact collection access", async () => {
    await fresh("qa-ready", 390);
    for (const route of ["/heute", "/namen", "/kalender", "/fortschritt", "/mannschaft"]) {
      await navigate(route);
      assert.equal(await page.getByRole("navigation", { name: "Hauptnavigation", exact: true }).getByRole("link").count(), 5);
      assert.equal(await page.locator(".crm-collection-mobile").count(), 0);
      const trigger = page.getByRole("button", { name: "Menü: Werkzeuge und Profil", exact: true });
      await trigger.click(); const menu = page.getByRole("dialog", { name: "Werkzeuge und Profil", exact: true });
      await menu.waitFor({ state: "visible" });
      for (const name of ["Namen sammeln", "Neuigkeiten", "Jarvis-Erinnerung", "Kontaktpilot", "Zinsrechner", "Hilfe und Support", "Profil und Einstellungen"]) assert.equal(await menu.getByRole("link", { name, exact: false }).isVisible(), true, name);
      for (let index = 0; index < 14; index++) { await page.keyboard.press("Tab"); assert.equal(await menu.evaluate(element => element.contains(document.activeElement)), true); }
      await page.keyboard.press("Escape"); assert.equal(await trigger.evaluate(element => element === document.activeElement), true);
    }
  });

  await check("Member, leader and admin can invite, open native person management and enter units through the visible navigation", async () => {
    for (const id of ["qa-ready", "qa-lead", "qa-admin"]) for (const width of [390, 1440]) {
      await fresh(id, width); await navigate("/mannschaft");
      await page.locator(".crm-area-actions").getByRole("link", { name: "Einladen", exact: true }).click();
      await page.waitForURL(url => url.pathname === "/einladen"); await page.locator("h1").first().waitFor();
      await navigate("/mannschaft"); await page.getByRole("button", { name: "Teammenü", exact: false }).click();
      const manage = page.getByRole("dialog", { name: "Teammenü" }).getByRole("link", { name: "Struktur verwalten", exact: false });
      assert.equal(await manage.evaluate(element => element.tagName), "A");
      await manage.click(); await page.waitForURL(url => url.pathname === "/mannschaft/verwalten"); await page.getByRole("heading", { name: "Struktur verwalten", exact: true }).waitFor();
      const people = page.locator('#hauptinhalt section ul a[href^="/mannschaft/"]');
      if (await people.count()) { const path = await people.first().getAttribute("href"); await people.first().click(); await page.waitForURL(url => url.pathname === path); await page.locator("#hauptinhalt h1").first().waitFor(); }
      await navigate("/fortschritt");
      if (width < 1100) { await page.getByRole("button", { name: /Fortschritt: .*, Bereich wechseln/ }).click(); await page.getByRole("dialog", { name: "Fortschritt: Ansichten" }).getByRole("link", { name: "Einheiten", exact: false }).click(); }
      else await page.getByRole("navigation", { name: "Fortschritt: Unterbereiche", exact: true }).getByRole("link", { name: "Einheiten", exact: true }).click();
      await page.waitForURL(url => url.pathname === "/einheiten");
      const amount = page.locator('input[name="menge"]'); await amount.fill("1,00");
      const form = page.locator("form").filter({ has: amount });
      const note = `UI-Abnahme ${id} ${width}`; await form.locator('input[name="notiz"]').fill(note);
      await form.getByRole("button", { name: "Speichern", exact: true }).click();
      await page.waitForFunction(() => document.querySelector('input[name="menge"]')?.value === "");
      assert.equal(await db.einheitenbuchung.count({ where: { userId: id, notiz: note, hundertstel: 100 } }), 1);
    }
  });

  await check("Collection round and cancellation preserve list/search/filter context", async () => {
    await fresh("qa-ready"); await navigate("/namen?liste=VERKAUF&q=Mara&status=offen&telefon=ohne");
    await page.locator("#hauptinhalt").getByRole("link", { name: "Namen sammeln", exact: true }).first().click();
    await page.waitForURL(url => url.pathname === "/namen/sammeln" && !!url.searchParams.get("runde"));
    assert.equal(new URL(page.url()).searchParams.get("liste"), "VERKAUF");
    await page.getByRole("button", { name: "Später fortsetzen", exact: true }).click();
    await page.waitForURL(url => url.pathname === "/namen");
    const query = new URL(page.url()).searchParams;
    for (const [key, value] of [["liste", "VERKAUF"], ["q", "Mara"], ["status", "offen"], ["telefon", "ohne"]]) assert.equal(query.get(key), value);
    await shot("collection-return-390");
  });

  await check("Calendar picker exposes every view, preserves its day and gives direct source/subscription access", async () => {
    for (const width of [320, 390, 1024, 1100, 1440]) {
      await fresh("qa-ready", width); await navigate("/kalender?ansicht=liste&tag=2026-10-06");
      for (const [name, view] of [["Monat", "monat"], ["Woche", "woche"], ["Tag", "tag"], ["Agenda", "liste"]]) {
        if (width < 1100) {
          await page.getByRole("button", { name: /Kalender: .*, Bereich wechseln/ }).click();
          await page.getByRole("dialog", { name: "Kalender: Ansichten" }).getByRole("link", { name, exact: false }).click();
        } else await page.getByRole("navigation", { name: "Kalenderansichten", exact: true }).getByRole("link", { name, exact: true }).click();
        await page.waitForURL(url => url.searchParams.get("ansicht") === view && url.searchParams.get("tag") === "2026-10-06");
      }
      await page.getByRole("button", { name: "Kalendermenü", exact: false }).click();
      const menu = page.getByRole("dialog", { name: "Kalendermenü", exact: true });
      for (const name of ["Kalenderquellen", "Kalender-Abo"]) assert.equal(await menu.getByRole("link", { name, exact: false }).isVisible(), true);
      await page.keyboard.press("Escape"); await shot(`calendar-${width}`);
    }
  });

  await check("Team, navigation and controls remain visible at all boundary widths and 200 percent text", async () => {
    await fresh("qa-lead");
    for (const width of [320, 390, 768, 1024, 1099, 1100, 1279, 1280, 1440]) {
      await page.setViewportSize({ width, height: width === 320 ? 568 : 900 });
      await navigate("/mannschaft");
      for (const theme of ["light", "dark"]) for (const scale of [100, 200]) {
        await page.evaluate(({ theme, scale }) => { document.documentElement.classList.toggle("dark", theme === "dark"); document.documentElement.style.fontSize = `${scale}%`; }, { theme, scale });
        await layout(`team-${width}-${theme}-${scale}`, [".crm-nav-link", ".crm-area-select", ".crm-area-actions a", ".crm-area-actions button"]);
        if (scale === 100 && [320, 1099, 1100, 1279, 1280].includes(width)) await shot(`team-${width}-${theme}`);
      }
      await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
    }
    await page.setViewportSize({ width: 1100, height: 500 });
    await layout("short-sidebar", [".crm-subnavigation a", ".crm-nav-services a"]);
  });

  await check("Jarvis crosses 1280 without remounting, keeps its draft and returns focus/scroll", async () => {
    await fresh("qa-ready", 1440); await navigate("/heute");
    await page.getByRole("button", { name: "Jarvis", exact: true }).click();
    const surface = page.locator("#crm-assistant-surface");
    const draft = surface.getByRole("textbox", { name: "Nachricht an den Assistenten", exact: true });
    await draft.waitFor();
    await surface.getByText("Unterhaltung wird geladen …", { exact: true }).waitFor({ state: "hidden" });
    await draft.fill("Mein Entwurf bleibt beim Größenwechsel erhalten.");
    await draft.evaluate(element => { element.dataset.resizeProof = "same-element"; });
    for (const width of [1279, 1280, 1100, 1099, 768, 390, 320, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await layout(`jarvis-${width}`, [".assistant-header button", ".assistant-composer-submit button"]);
      assert.equal(await draft.inputValue(), "Mein Entwurf bleibt beim Größenwechsel erhalten.");
      assert.equal(await draft.getAttribute("data-resize-proof"), "same-element");
      assert.equal(await page.locator("#hauptinhalt").evaluate(element => element.inert), width < 1280);
      const box = await surface.boundingBox();
      assert.ok(width < 1280 ? box.width >= width - 16 : Math.abs(box.width - 400) <= 1, JSON.stringify(box));
      await shot(`jarvis-${width}`);
    }
    assert.equal(await page.evaluate(() => window.__micRequests), 0);
    await page.setViewportSize({ width: 390, height: 900 }); await draft.focus();
    await page.evaluate(() => { Object.defineProperty(window.visualViewport, "height", { configurable: true, get: () => 430 }); window.visualViewport.dispatchEvent(new Event("resize")); });
    await page.waitForFunction(() => document.documentElement.dataset.workspaceKeyboard === "true");
    assert.equal(await page.locator(".crm-dock").isVisible(), false);
    await layout("jarvis-simulated-keyboard", [".assistant-header button", ".assistant-composer-submit button"]);
    assert.ok((await surface.boundingBox()).height <= 430);
    await shot("jarvis-keyboard-simulation");
    await page.evaluate(() => { document.activeElement?.blur(); delete window.visualViewport.height; window.visualViewport.dispatchEvent(new Event("resize")); });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.keyboard.press("Escape");
    await surface.waitFor({ state: "hidden" });
    assert.equal(await page.locator("#hauptinhalt").evaluate(element => element.inert), false);
    assert.equal(await page.getByRole("button", { name: "Jarvis", exact: true }).evaluate(element => element === document.activeElement), true);
    await page.setViewportSize({ width: 390, height: 900 }); await page.getByRole("button", { name: "Jarvis", exact: true }).click();
    await page.getByRole("navigation", { name: "Hauptnavigation", exact: true }).getByRole("link", { name: "Team", exact: true }).click();
    await page.waitForURL(url => url.pathname === "/mannschaft"); await surface.waitFor({ state: "hidden" });
    assert.equal(await page.locator("#hauptinhalt").evaluate(element => element.inert), false);
  });

  await check("Feature-off navigation and initialized-partner guards match the actual routes", async () => {
    for (const key of ["bericht", "teamabend", "einheiten", "zinsrechner"]) await db.feature.upsert({ where: { key }, create: { key, titel: key, state: "AUS" }, update: { state: "AUS" } });
    await fresh("qa-lead", 390); await navigate("/mannschaft");
    await page.getByRole("button", { name: "Teammenü", exact: false }).click();
    const menu = page.getByRole("dialog", { name: "Teammenü", exact: true });
    assert.equal(await menu.getByRole("link", { name: "Berichts-Link erstellen", exact: false }).count(), 0);
    assert.equal(await menu.getByRole("link", { name: "Netzwerkabend", exact: false }).count(), 0);
    await page.keyboard.press("Escape");
    await navigate("/fortschritt"); await page.getByRole("button", { name: /Fortschritt: .*, Bereich wechseln/ }).click();
    assert.equal(await page.getByRole("dialog", { name: "Fortschritt: Ansichten" }).getByRole("link", { name: "Einheiten", exact: false }).count(), 0);
    await page.keyboard.press("Escape"); await page.getByRole("button", { name: "Menü: Werkzeuge und Profil", exact: true }).click();
    assert.equal(await page.getByRole("dialog", { name: "Werkzeuge und Profil", exact: true }).getByRole("link", { name: "Zinsrechner", exact: false }).count(), 0);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator('#hauptinhalt a[href="/einheiten"]').count(), 0);
    await navigate("/mannschaft/ziele"); assert.equal(await page.getByRole("heading", { name: "Ein Teamziel setzen", exact: true }).count(), 1);
    await fresh("qa-admin", 1440); await navigate("/mannschaft/ziele"); assert.equal(await page.getByRole("heading", { name: "Ein Teamziel setzen", exact: true }).count(), 0);
    await navigate("/team"); await page.getByRole("heading", { name: "Konten und Zugänge", exact: true }).waitFor();
    await shot("admin-1440");
    for (const key of ["bericht", "teamabend", "einheiten", "zinsrechner"]) await db.feature.update({ where: { key }, data: { state: "TEST" } });
  });

  if (!process.argv.includes("--production")) await check("A deliberately started simulated live session, microphone state and conversation survive both layout transitions", async () => {
    await fresh("qa-ready", 1440); await navigate("/heute");
    await page.evaluate(() => {
      window.__micStopped = 0;
      Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => { window.__micRequests++; const track = { enabled: true, stop() { window.__micStopped++; } }; return { getTracks: () => [track], getAudioTracks: () => [track] }; } } });
      Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { cancel() {}, speak(utterance) { setTimeout(() => utterance.onend?.(), 10); } } });
    });
    await page.getByRole("button", { name: "Jarvis", exact: true }).click();
    const surface = page.locator("#crm-assistant-surface");
    await surface.getByRole("button", { name: "Sprachchat starten", exact: true }).click();
    await surface.getByRole("button", { name: "Stumm", exact: true }).waitFor();
    await surface.getByRole("button", { name: "Stumm", exact: true }).click();
    const original = await db.aiLiveSession.findFirst({ where: { userId: "qa-ready", activeKey: "qa-ready" } });
    assert.ok(original);
    for (const width of [1279, 1280, 1099, 1100, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await surface.getByRole("button", { name: "Mikrofon einschalten", exact: true }).isVisible(), true);
      const current = await db.aiLiveSession.findFirst({ where: { userId: "qa-ready", activeKey: "qa-ready" } });
      assert.equal(current?.id, original.id); assert.equal(current?.conversationId, original.conversationId);
      assert.equal(await page.evaluate(() => window.__micRequests), 1);
      assert.equal(await page.evaluate(() => window.__micStopped), 0);
      await shot(`live-simulation-${width}`);
    }
    await surface.getByRole("button", { name: "Sitzung beenden", exact: true }).click();
    await surface.getByRole("button", { name: "Sprachchat starten", exact: true }).waitFor();
    assert.equal(await db.aiLiveSession.count({ where: { userId: "qa-ready", activeKey: "qa-ready" } }), 0);
    assert.ok(await page.evaluate(() => window.__micStopped > 0));
  });
}
