// Additional real UI/API flows on the parent harness's disposable database only.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { berlinToday, shiftDay } from "../lib/dates.ts";
import { startWorkTask, workTaskDetail, completeWorkTask } from "../lib/workflows/service.ts";

export async function remodelProductFlows({ page, db, origin, user, checks, shot, surface, providerRequests }) {
  const work = page.getByRole("region", { name: "Zusammenhängende Kontaktarbeit", exact: true });
  const dialog = name => page.getByRole("dialog", { name, exact: true });
  const proof = dialog("Ergebnis ausdrücklich bestätigen");
  const closeAssistant = async () => {
    const close = surface(page).getByRole("button", { name: "Assistent schließen", exact: true });
    if (await close.isVisible()) await close.click();
  };
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => { document.documentElement.classList.remove("dark"); document.documentElement.style.fontSize = "100%"; });
  await closeAssistant();

  const contact = await db.contact.create({ data: { ownerId: user.id, name: "Zusätzliche synthetische Vorbereitung", phone: "0300000001", note: "Aktuelle eigene Quelle für den lokalen Responses-Stub.", listKinds: [] } });
  await page.goto(`${origin}/contacts/${contact.id}`);
  await work.getByLabel("Arbeitsweise").selectOption("JARVIS");
  await work.getByRole("button", { name: "Kontaktarbeit beginnen", exact: true }).click();
  const task = await db.crmWorkTask.findFirstOrThrow({ where: { contactId: contact.id, status: "STARTED" } });
  assert.equal(task.route, "JARVIS");
  await work.getByRole("button", { name: "Ergebnis prüfen und bestätigen", exact: true }).click();
  assert.equal(await proof.getByLabel("Jarvis-Vorbereitung").locator("option").count(), 1, "Direct Jarvis work has no invented preparation proof");
  await proof.getByRole("checkbox").check();
  assert.equal(await proof.getByRole("button", { name: "Geprüftes Ergebnis bestätigen", exact: true }).isDisabled(), false);
  await proof.getByRole("button", { name: "Geprüftes Ergebnis bestätigen", exact: true }).click();
  assert.equal((await db.crmWorkTask.findUniqueOrThrow({ where: { id: task.id } })).status, "STARTED");
  await proof.getByRole("button", { name: "Abbrechen", exact: true }).click();
  await work.getByRole("button", { name: "Mit Jarvis weiterarbeiten", exact: true }).click();
  await surface(page).getByRole("textbox", { name: "Nachricht an den Assistenten", exact: true }).waitFor();
  await page.unroute("**/api/ai-crm/chat");
  const responseReady = page.waitForResponse(response => response.url().endsWith("/api/ai-crm/chat") && response.request().method() === "POST", { timeout: 120_000 });
  await surface(page).getByRole("button", { name: "Senden", exact: true }).click();
  const response = await responseReady;
  assert.equal(response.status(), 200);
  const answer = await response.json();
  assert.equal(response.request().postDataJSON().workTaskId, task.id);
  await surface(page).getByRole("list", { name: "Gesprächsverlauf", exact: true }).getByText("Isolierte Jarvis-Vorbereitung: Die aktuelle eigene Quelle wurde geprüft; offene Angaben bleiben offen.", { exact: true }).waitFor();
  assert.ok(providerRequests.length > 0, "The actual chat route reached the local, non-provider Responses stub");
  assert.match(JSON.stringify(providerRequests.at(-1).input), /Zusätzliche synthetische Vorbereitung/);
  assert.ok(await db.crmWorkAttempt.findFirst({ where: { taskId: task.id, requestId: answer.requestId, kind: "CHAT" } }));
  assert.ok(await db.aiUsage.findFirst({ where: { workTaskId: task.id, requestId: answer.requestId } }));
  await closeAssistant();
  await page.reload();
  await work.getByRole("button", { name: "Ergebnis prüfen und bestätigen", exact: true }).click();
  await proof.getByLabel("Jarvis-Vorbereitung").selectOption(answer.requestId);
  await proof.locator("blockquote").getByText(answer.answer, { exact: true }).waitFor();
  await proof.getByLabel("Nötige fachliche Korrekturen (freiwillig)", { exact: true }).fill("0");
  await proof.getByRole("checkbox").check();
  await proof.getByRole("button", { name: "Geprüftes Ergebnis bestätigen", exact: true }).click();
  await work.getByText("Vorbereitung geprüft und bestätigt. Ein geführtes Gespräch wird dadurch nicht gezählt.", { exact: true }).waitFor();
  const prepared = await db.crmWorkTask.findUniqueOrThrow({ where: { id: task.id } });
  assert.equal(prepared.status, "COMPLETED"); assert.equal(prepared.route, "JARVIS");
  assert.equal(prepared.proof.preparationRequestId, answer.requestId); assert.equal(prepared.proof.correctionCount, 0);
  assert.equal(await db.activity.count({ where: { contactId: contact.id } }), 0);
  checks.push("direct Jarvis preparation uses the actual local chat route, binds request and usage to its task, reloads its answer as evidence and completes only after explicit review; zero corrections differs from unknown");

  const manualContact = await db.contact.create({ data: { ownerId: user.id, name: "Synthetisches manuelles Gespräch", phone: "0300000002", listKinds: [] } });
  await page.goto(`${origin}/contacts/${manualContact.id}`);
  await work.getByLabel("Was möchtest du erledigen?").selectOption("RECORD_CONVERSATION");
  await work.getByRole("button", { name: "Kontaktarbeit beginnen", exact: true }).click();
  const manual = await db.crmWorkTask.findFirstOrThrow({ where: { contactId: manualContact.id, status: "STARTED" } });
  await work.getByRole("button", { name: "Gesprächsergebnis eintragen", exact: true }).click();
  await page.locator("#naechste-schritte").getByRole("button", { name: "Später", exact: true }).click();
  await dialog("Wann nochmal?").getByRole("button", { name: "In 1 Woche", exact: true }).click();
  await page.locator("#verlauf").getByText(/Später/).waitFor();
  const call = await db.activity.findFirstOrThrow({ where: { contactId: manualContact.id, type: "CALL" } });
  const followUp = await db.contactFollowUp.findFirstOrThrow({ where: { contactId: manualContact.id } });
  assert.equal(await db.activity.count({ where: { contactId: manualContact.id, type: "CALL" } }), 1);
  await work.getByRole("button", { name: "Ergebnis prüfen und bestätigen", exact: true }).click();
  await proof.getByLabel("Gespeichertes Gesprächsergebnis").selectOption(call.id);
  await proof.getByRole("checkbox", { name: "Ein nächster Schritt ist für dieses Ergebnis erforderlich.", exact: true }).check();
  await proof.getByRole("checkbox", { name: /Ich habe den gespeicherten Beleg geprüft/ }).check();
  await proof.getByRole("button", { name: "Geprüftes Ergebnis bestätigen", exact: true }).click();
  assert.equal((await db.crmWorkTask.findUniqueOrThrow({ where: { id: manual.id } })).status, "STARTED", "Required follow-up cannot be replaced with a correctness checkbox");
  await proof.getByLabel("Passende nächste Handlung").selectOption(followUp.id);
  await proof.getByRole("checkbox", { name: /Ich habe den gespeicherten Beleg geprüft/ }).check();
  await proof.getByRole("button", { name: "Geprüftes Ergebnis bestätigen", exact: true }).click();
  await work.getByText("Gespeichertes Ergebnis geprüft und bestätigt.", { exact: true }).waitFor();
  const documented = await db.crmWorkTask.findUniqueOrThrow({ where: { id: manual.id } });
  assert.equal(documented.route, "MANUAL"); assert.equal(documented.nextActionRequired, true); assert.equal(documented.nextActionCorrect, true);
  assert.equal(documented.proof.activityId, call.id); assert.equal(documented.proof.followUpId, followUp.id);
  checks.push("manual conversation uses the existing result dialog, saves exactly one CALL and real follow-up, and cannot complete a required next action without selecting its stored evidence");

  // Five synthetic consent records, not real participation; UI still performs the start.
  const pilotRow = await db.crmContactPilot.findFirstOrThrow({ where: { ownerId: user.id, status: "DRAFT" }, orderBy: { createdAt: "desc" } });
  const suitable = [[pilotRow.weekOne, shiftDay(pilotRow.weekOne, 2)], [pilotRow.weekTwo, shiftDay(pilotRow.weekTwo, 2)]];
  for (let index = 0; index < 5; index++) {
    const person = index === 0 ? user : await db.user.create({ data: { name: `Synthetische Pilotperson ${index}`, passwordHash: "synthetic-only", passwordSalt: "synthetic-only", onboardingDoneAt: new Date() } });
    await db.crmPilotParticipant.upsert({ where: { pilotId_userId: { pilotId: pilotRow.id, userId: person.id } }, create: { pilotId: pilotRow.id, userId: person.id, alias: `P${index + 1}`, consentedAt: new Date(), suitableDays: suitable }, update: { withdrawnAt: null, suitableDays: suitable } });
  }
  await page.goto(`${origin}/tools/kontaktpilot`);
  const pilot = page.getByRole("region", { name: "Freiwilliger Kontaktpilot", exact: true });
  await pilot.getByRole("button", { name: "Pilotstart bestätigen", exact: true }).click();
  const start = dialog("Freiwilligen Pilotstart bestätigen");
  assert.equal(await start.getByRole("button", { name: "Ausdrücklich bestätigen", exact: true }).isDisabled(), true);
  await start.getByRole("checkbox").check();
  await start.getByRole("button", { name: "Ausdrücklich bestätigen", exact: true }).click();
  await pilot.getByText("Start bestätigt", { exact: true }).waitFor();
  const active = await db.crmContactPilot.findUniqueOrThrow({ where: { id: pilotRow.id } });
  assert.equal(active.status, "ACTIVE"); assert.equal(active.frozenParticipantIds.length, 5);
  assert.equal(await pilot.getByRole("button", { name: "Ein tatsächlich geführtes Gespräch bestätigen", exact: true }).count(), 0, "Future weeks do not enable a conversation claim");
  checks.push("synthetic five-person pilot still requires explicit coordinator start and freezes its denominator; future weeks do not offer conversation confirmation");

  const today = berlinToday(), weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const monday = shiftDay(today, -((weekday + 6) % 7));
  const participants = await db.crmPilotParticipant.findMany({ where: { pilotId: active.id } });
  // A controlled synthetic time-window fixture, no claim that real weeks elapsed.
  await db.crmContactPilot.update({ where: { id: active.id }, data: { weekOne: monday, weekTwo: shiftDay(monday, 7), startedAt: new Date(`${shiftDay(monday, -1)}T12:00:00Z`) } });
  for (const person of participants) await db.crmPilotParticipant.update({ where: { id: person.id }, data: { suitableDays: [[today, shiftDay(monday, today === monday ? 2 : 0)], [shiftDay(monday, 7), shiftDay(monday, 9)]] } });
  const secondContact = await db.contact.create({ data: { ownerId: user.id, name: "Anderer synthetischer Pilotkontakt", phone: "0300000003" } });
  const secondTask = await startWorkTask(db, user.id, { clientTaskId: randomUUID(), contactId: secondContact.id, kind: "RECORD_CONVERSATION", route: "MANUAL" });
  const secondCall = await db.activity.create({ data: { contactId: secondContact.id, type: "CALL", text: "Synthetischer zweiter Gesprächsbeleg; kein echter Kontakt." } });
  const secondProof = await workTaskDetail(db, user.id, secondTask.id);
  await completeWorkTask(db, user.id, secondTask.id, { version: secondProof.task.version, proofRevision: secondProof.proofRevision, resultCorrect: true, nextActionRequired: false, activityId: secondCall.id });
  await page.reload();
  await pilot.getByRole("button", { name: "Ein tatsächlich geführtes Gespräch bestätigen", exact: true }).click();
  const conversation = dialog("Tatsächlich geführtes Gespräch bestätigen");
  const selection = conversation.getByLabel("Bestätigte Kontaktarbeit");
  const confirmed = conversation.getByRole("checkbox", { name: /Dieses Gespräch wurde tatsächlich geführt/ });
  await selection.selectOption(manual.id);
  await conversation.getByText(manualContact.name, { exact: true }).waitFor();
  let releaseDetail;
  const held = new Promise(resolve => { releaseDetail = resolve; });
  const secondRequest = page.waitForRequest(request => request.url().endsWith(`/api/work-tasks/${secondTask.id}`) && request.method() === "GET");
  await page.route(`**/api/work-tasks/${secondTask.id}`, async route => { await held; await route.continue(); });
  await selection.selectOption(secondTask.id);
  await secondRequest;
  try {
    assert.equal(await confirmed.isDisabled(), true, "Changing a proof must disable confirmation until its current contact is loaded");
    assert.equal(await conversation.getByText(manualContact.name, { exact: true }).count(), 0, "The previous contact must not be presented as proof for the newly selected task");
  } finally { releaseDetail(); }
  await conversation.getByText(secondContact.name, { exact: true }).waitFor();
  await page.unroute(`**/api/work-tasks/${secondTask.id}`);
  await conversation.getByLabel("Gesprächsart").selectOption("EXISTING_CONTACT");
  await confirmed.check();
  await conversation.getByRole("button", { name: "Ausdrücklich bestätigen", exact: true }).click();
  await conversation.waitFor({ state: "hidden" });
  assert.ok(await db.crmPilotObservation.findFirst({ where: { pilotId: active.id, taskId: secondTask.id, conversationConfirmed: true } }));
  await pilot.getByText("1 ausdrücklich bestätigte Gespräche.", { exact: false }).waitFor();
  await shot(page, "pilot-active-evidence");
  checks.push("pilot conversation proof switches clear the previous person and disable confirmation until the newly selected own task loads; a stored task and explicit conversation confirmation remain separate");

  // Simulated elapsed weeks exercise the report UI; no elapsed real study is claimed.
  const elapsedMonday = shiftDay(monday, -14);
  await db.crmContactPilot.update({ where: { id: active.id }, data: { weekOne: elapsedMonday, weekTwo: shiftDay(elapsedMonday, 7), startedAt: new Date(`${shiftDay(elapsedMonday, -1)}T12:00:00Z`) } });
  for (const person of participants) await db.crmPilotParticipant.update({ where: { id: person.id }, data: { suitableDays: [[elapsedMonday, shiftDay(elapsedMonday, 2)], [shiftDay(elapsedMonday, 7), shiftDay(elapsedMonday, 9)]] } });
  await page.reload();
  for (const [label, title] of [["Woche 1 prüfen", "Erste Woche prüfen"], ["Woche 2 prüfen", "Zweite Woche prüfen"]]) {
    await pilot.getByRole("button", { name: label, exact: true }).click();
    const weekReview = dialog(title);
    assert.equal(await weekReview.getByRole("button", { name: "Ausdrücklich bestätigen", exact: true }).isDisabled(), true);
    await weekReview.getByRole("checkbox").check();
    await weekReview.getByRole("button", { name: "Ausdrücklich bestätigen", exact: true }).click();
    await weekReview.waitFor({ state: "hidden" });
  }
  await pilot.getByRole("button", { name: "Zwei Wochen auswerten", exact: true }).click();
  const review = dialog("Zwei vollständige Wochen auswerten");
  await review.getByRole("checkbox").check();
  await review.getByRole("button", { name: "Ausdrücklich bestätigen", exact: true }).click();
  await pilot.getByText("Datenprüfung abgeschlossen", { exact: true }).waitFor();
  const report = page.getByRole("region", { name: "Belegstand des Kontaktpiloten", exact: true });
  await report.getByText(/0 \/ 5 Personen erfüllen/).waitFor();
  await report.getByText("Die vorgeschlagene Pilotmesslatte von 3/5 wurde nicht erreicht.", { exact: false }).waitFor();
  await report.getByText("Wochenprüfungen: 1 / 5 für Woche 1 und 1 / 5 für Woche 2.", { exact: true }).waitFor();
  assert.equal(await pilot.getByRole("button", { name: "Ein tatsächlich geführtes Gespräch bestätigen", exact: true }).count(), 0);
  const result = await page.evaluate(async id => (await fetch(`/api/contact-pilot/${id}`)).json(), active.id);
  assert.equal(result.pilot.status, "REVIEWED"); assert.equal(result.report.windowElapsed, true);
  assert.equal(result.report.denominator, 5); assert.equal(result.report.qualified, 0); assert.equal(result.report.fullyObserved, false);
  assert.equal(result.report.decision, "THRESHOLD_NOT_MET");
  await shot(page, "pilot-reviewed-missing-evidence");
  checks.push("controlled elapsed-week fixture requires explicit weekly and final review, preserves five-person denominator and reports missing evidence as 0/5, never as successful pilot participation");
}
