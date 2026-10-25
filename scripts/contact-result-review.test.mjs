// Real database action regression. Only request identity, cache invalidation
// and outbound push are replaced; no production URL or session is used.
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { testDatabase } from "./test-db.mjs";

const modules = {
  "@/lib/auth": `export async function requireUser(){return globalThis.contactReviewUser} export async function requireUserPerson(id){return globalThis.prisma.person.findUniqueOrThrow({where:{userId:id}})}`,
  "next/cache": "export function revalidatePath(){}",
  "next/navigation":
    "export function redirect(url){throw new Error('Redirect '+url)}",
  "@/lib/push": "export function meldeNebenbei(){}",
};
registerHooks({
  resolve(specifier, context, next) {
    return modules[specifier]
      ? {
          url: `data:text/javascript,${encodeURIComponent(modules[specifier])}`,
          shortCircuit: true,
        }
      : next(specifier, context);
  },
});

const fixture = await testDatabase();
globalThis.prisma = fixture.client;
const { recordAppointmentResult, recordCallResult } = await import(
  "../app/(app)/contacts/results.ts"
);
const { setContactStage } = await import("../app/(app)/pipeline/actions.ts");
const { undoAusfuehren, offenerUndoEintrag } = await import("../lib/undo.ts");
const { bucheZugeordneteEinheiten } = await import(
  "../lib/einheiten-erinnerung.ts"
);
const { einheitenBuchen, einheitSchnellBuchen } = await import(
  "../app/(team)/einheiten/actions.ts"
);
const { speichereZiel } = await import("../lib/ziele-service.ts");
const { berlinToday } = await import("../lib/dates.ts");

test("a repeated appointment result records one meeting, held point, win and reminder", async () => {
  const user = await fixture.client.user.create({
    data: {
      name: "Retry Review",
      person: { create: { name: "Retry Review" } },
    },
  });
  globalThis.contactReviewUser = user;
  const contact = await fixture.client.contact.create({
    data: {
      name: "Retry Contact",
      ownerId: user.id,
      stage: "TERMIN_VEREINBART",
      appointmentAt: new Date(),
      appointmentLoggedAt: new Date(),
    },
  });
  const form = new FormData();
  form.set("contactId", contact.id);
  form.set("result", "abschluss");
  const first = await recordAppointmentResult(form);
  const second = await recordAppointmentResult(form);
  assert.equal(first.einheiten.anzeigen, true);
  assert.equal(second.einheiten?.anzeigen ?? false, false);
  assert.equal(
    await fixture.client.dailyLog.count({
      where: { person: { userId: user.id }, type: "APPOINTMENT_HELD" },
    }),
    1,
  );
  assert.equal(
    await fixture.client.dailyLog.count({
      where: { person: { userId: user.id }, type: "DEAL_WON" },
    }),
    1,
  );
  assert.equal(
    await fixture.client.einheitenErinnerung.count({
      where: { contactId: contact.id },
    }),
    1,
  );
  assert.equal(
    await fixture.client.activity.count({
      where: { contactId: contact.id, type: "MEETING" },
    }),
    1,
    "Retry must not append a second meeting",
  );
  const legacyUser = await fixture.client.user.create({
    data: { name: "Legacy Win", person: { create: { name: "Legacy Win" } } },
  });
  globalThis.contactReviewUser = legacyUser;
  const legacy = await fixture.client.contact.create({
    data: {
      name: "Old win",
      ownerId: legacyUser.id,
      stage: "ABSCHLUSS",
      outcome: "GEWONNEN",
      wonLoggedAt: new Date("2025-01-01"),
      appointmentHeldLoggedAt: null,
    },
  });
  const stage = new FormData();
  stage.set("contactId", legacy.id);
  stage.set("stage", "ABSCHLUSS");
  await setContactStage(stage);
  assert.equal(
    await fixture.client.dailyLog.count({
      where: { person: { userId: legacyUser.id }, type: "APPOINTMENT_HELD" },
    }),
    0,
    "Unchanged historical win must not become a new held appointment today",
  );
});

test("undoing a just-entered win also restores units linked through its completion prompt", async () => {
  const user = await fixture.client.user.create({
    data: { name: "Undo Review", person: { create: { name: "Undo Review" } } },
  });
  globalThis.contactReviewUser = user;
  const contact = await fixture.client.contact.create({
    data: {
      name: "Undo Contact",
      ownerId: user.id,
      stage: "TERMIN_VEREINBART",
      appointmentAt: new Date(),
      appointmentLoggedAt: new Date(),
    },
  });
  const vorher = await fixture.client.einheitenbuchung.create({
    data: {
      userId: user.id,
      hundertstel: 1100,
      tag: new Date(),
      notiz: "Freier Eintrag vorher",
    },
  });
  const form = new FormData();
  form.set("contactId", contact.id);
  form.set("result", "abschluss");
  const result = await recordAppointmentResult(form);
  await fixture.client.$transaction((tx) =>
    bucheZugeordneteEinheiten(tx, {
      userId: user.id,
      erinnerungId: result.einheiten.id,
      hundertstel: 2500,
      tag: new Date(),
      notiz: "Completion prompt",
    }),
  );
  const nachher = await fixture.client.einheitenbuchung.create({
    data: {
      userId: user.id,
      hundertstel: 1300,
      tag: new Date(),
      notiz: "Freier Eintrag danach",
    },
  });
  const undo = await offenerUndoEintrag(user.id);
  await undoAusfuehren(user.id, undo.id);
  assert.equal(
    (
      await fixture.client.contact.findUniqueOrThrow({
        where: { id: contact.id },
      })
    ).stage,
    "TERMIN_VEREINBART",
  );
  assert.equal(
    await fixture.client.einheitenErinnerung.count({
      where: { contactId: contact.id },
    }),
    0,
  );
  assert.equal(
    await fixture.client.dailyLog.count({
      where: { person: { userId: user.id } },
    }),
    0,
  );
  const uebrig = await fixture.client.einheitenbuchung.findMany({
    where: { userId: user.id },
    select: { id: true },
  });
  assert.deepEqual(
    uebrig.map((buchung) => buchung.id).sort(),
    [vorher.id, nachher.id].sort(),
    "Nur die explizit zugeordneten Einheiten gehen zurück; freie Einträge bleiben",
  );
});

test("open and declined results keep referrals idempotent, while a later appointment can be recorded", async () => {
  for (const result of ["offen", "kein_abschluss"]) {
    const user = await fixture.client.user.create({
      data: { name: result, person: { create: { name: result } } },
    });
    globalThis.contactReviewUser = user;
    const contact = await fixture.client.contact.create({
      data: {
        name: "Beratung",
        ownerId: user.id,
        stage: "TERMIN_VEREINBART",
        appointmentAt: new Date(),
        appointmentLoggedAt: new Date(),
      },
    });
    const form = new FormData();
    form.set("contactId", contact.id);
    form.set("result", result);
    form.append("referralName", "Empfohlener Kontakt");
    await recordAppointmentResult(form);
    await recordAppointmentResult(form);
    assert.equal(
      await fixture.client.activity.count({
        where: { contactId: contact.id, type: "MEETING" },
      }),
      1,
    );
    assert.equal(
      await fixture.client.contact.count({
        where: { referredById: contact.id },
      }),
      1,
    );
    assert.equal(
      await fixture.client.dailyLog.count({
        where: { person: { userId: user.id }, type: "REFERRAL" },
      }),
      1,
    );
    const stage = new FormData();
    stage.set("contactId", contact.id);
    stage.set("stage", "TERMIN_VEREINBART");
    stage.set("appointmentAt", "2026-10-12T10:00");
    await setContactStage(stage);
    await recordAppointmentResult(form);
    assert.equal(
      await fixture.client.activity.count({
        where: { contactId: contact.id, type: "MEETING" },
      }),
      2,
      "A newly arranged appointment is a new meeting",
    );
    assert.equal(
      await fixture.client.contact.count({
        where: { referredById: contact.id },
      }),
      2,
    );
    assert.equal(
      await fixture.client.dailyLog.count({
        where: { person: { userId: user.id }, type: "APPOINTMENT_HELD" },
      }),
      1,
      "Existing once-per-contact competition counting is preserved",
    );
  }
});

test("a failing referral rolls back the entire result and foreign contacts cannot be changed", async () => {
  const user = await fixture.client.user.create({
    data: {
      name: "Atomic Result",
      person: { create: { name: "Atomic Result" } },
    },
  });
  globalThis.contactReviewUser = user;
  const contact = await fixture.client.contact.create({
    data: {
      name: "Atomic Contact",
      ownerId: user.id,
      stage: "TERMIN_VEREINBART",
      appointmentAt: new Date(),
      appointmentLoggedAt: new Date(),
    },
  });
  const form = new FormData();
  form.set("contactId", contact.id);
  form.set("result", "abschluss");
  form.append("referralName", "Fixture rejected referral");
  // A real database constraint fails only the final referral write. Earlier
  // meeting, stage, source counts and reminder must all roll back with it.
  await fixture.client.$executeRawUnsafe(
    `ALTER TABLE "Contact" ADD CONSTRAINT "fixture_rejected_referral" CHECK (name <> 'Fixture rejected referral')`,
  );
  try {
    await assert.rejects(recordAppointmentResult(form));
  } finally {
    await fixture.client.$executeRawUnsafe(
      'ALTER TABLE "Contact" DROP CONSTRAINT "fixture_rejected_referral"',
    );
  }
  assert.equal(
    (
      await fixture.client.contact.findUniqueOrThrow({
        where: { id: contact.id },
      })
    ).stage,
    "TERMIN_VEREINBART",
  );
  assert.equal(
    await fixture.client.activity.count({ where: { contactId: contact.id } }),
    0,
  );
  assert.equal(
    await fixture.client.stageEvent.count({ where: { contactId: contact.id } }),
    0,
  );
  assert.equal(
    await fixture.client.dailyLog.count({
      where: { person: { userId: user.id } },
    }),
    0,
  );
  assert.equal(
    await fixture.client.einheitenErinnerung.count({
      where: { contactId: contact.id },
    }),
    0,
  );
  assert.equal(
    await fixture.client.undoEntry.count({ where: { contactId: contact.id } }),
    0,
  );
  const stranger = await fixture.client.user.create({
    data: { name: "Other", person: { create: { name: "Other" } } },
  });
  globalThis.contactReviewUser = stranger;
  await assert.rejects(recordAppointmentResult(form), /Kontakt nicht gefunden/);
  assert.equal(
    await fixture.client.activity.count({ where: { contactId: contact.id } }),
    0,
  );
});

test("direct stage changes and call appointments each create one complete undo operation", async () => {
  const user = await fixture.client.user.create({
    data: { name: "Stage Undo", person: { create: { name: "Stage Undo" } } },
  });
  globalThis.contactReviewUser = user;
  const contact = await fixture.client.contact.create({
    data: { name: "Stage Contact", ownerId: user.id, stage: "KONTAKTIERT" },
  });
  const stage = new FormData();
  stage.set("contactId", contact.id);
  stage.set("stage", "TERMIN_VEREINBART");
  stage.set("appointmentAt", "2026-10-12T10:00");
  await setContactStage(stage);
  const firstUndo = await offenerUndoEintrag(user.id);
  assert.ok(firstUndo);
  assert.equal(
    await fixture.client.undoEntry.count({
      where: { userId: user.id, undoneAt: null },
    }),
    1,
  );
  await undoAusfuehren(user.id, firstUndo.id);
  assert.equal(
    (
      await fixture.client.contact.findUniqueOrThrow({
        where: { id: contact.id },
      })
    ).stage,
    "KONTAKTIERT",
  );
  const call = new FormData();
  call.set("contactId", contact.id);
  call.set("result", "appointment");
  call.set("appointmentAt", "2026-10-12T10:00");
  await recordCallResult(call);
  assert.equal(
    await fixture.client.undoEntry.count({
      where: { userId: user.id, undoneAt: null },
    }),
    1,
    "The stage helper must not nest an extra undo operation",
  );
  assert.equal(
    await fixture.client.activity.count({
      where: { contactId: contact.id, type: "CALL" },
    }),
    1,
  );
  assert.equal(
    await fixture.client.dailyLog.count({
      where: { person: { userId: user.id } },
    }),
    2,
  );
  const callUndo = await offenerUndoEintrag(user.id);
  await undoAusfuehren(user.id, callUndo.id);
  assert.equal(
    (
      await fixture.client.contact.findUniqueOrThrow({
        where: { id: contact.id },
      })
    ).stage,
    "KONTAKTIERT",
  );
  assert.equal(
    await fixture.client.activity.count({ where: { contactId: contact.id } }),
    0,
  );
  assert.equal(
    await fixture.client.dailyLog.count({
      where: { person: { userId: user.id } },
    }),
    0,
  );
});

test("merged units actions reject imprecise amounts and keep corrections on the requested day", async () => {
  const user = await fixture.client.user.create({
    data: {
      name: "Einheitenprüfung",
      person: { create: { name: "Einheitenprüfung" } },
    },
  });
  globalThis.contactReviewUser = user;
  for (const eingabe of ["12,5", "300", "12,501", "32 67", "abc", "0,00"]) {
    const schnell = await einheitSchnellBuchen(eingabe);
    const formular = await einheitenBuchen(
      eingabe,
      berlinToday(),
      "Fehleingabe",
    );
    assert.equal(schnell.ok, false, eingabe);
    assert.equal(formular.ok, false, eingabe);
    assert.ok(schnell.fehler, "A rejected value gives a visible error");
  }
  assert.equal(
    await fixture.client.einheitenbuchung.count({ where: { userId: user.id } }),
    0,
  );
  const korrektur = await einheitenBuchen("-12,50", berlinToday(), "Korrektur");
  assert.equal(korrektur.ok, true);
  assert.equal(korrektur.betrag, "-12,50");
  assert.equal(korrektur.ersteEinheiten, false);
  const buchung = await fixture.client.einheitenbuchung.findFirstOrThrow({
    where: { userId: user.id },
  });
  assert.equal(buchung.hundertstel, -1250);
  assert.equal(buchung.tag.toISOString().slice(0, 10), berlinToday());
});

test("merged completion booking returns current month, total and goal without duplicating retries", async () => {
  const user = await fixture.client.user.create({
    data: {
      name: "Einheitenabschluss",
      einheitenStart: 10000,
      person: { create: { name: "Einheitenabschluss" } },
    },
  });
  globalThis.contactReviewUser = user;
  await speichereZiel(user.id, {
    kennzahl: "UNITS",
    zielwert: "25",
    zeitraum: "MONAT",
    tag: berlinToday(),
    hauptziel: true,
  });
  const contact = await fixture.client.contact.create({
    data: {
      name: "Zugeordneter Abschluss",
      ownerId: user.id,
      stage: "TERMIN_VEREINBART",
      appointmentAt: new Date(),
      appointmentLoggedAt: new Date(),
    },
  });
  const form = new FormData();
  form.set("contactId", contact.id);
  form.set("result", "abschluss");
  const result = await recordAppointmentResult(form);
  const zuerst = await einheitSchnellBuchen(
    "25,00",
    "Abschluss",
    result.einheiten.id,
  );
  assert.equal(zuerst.ok, true);
  assert.equal(zuerst.monat, "25,00");
  assert.equal(zuerst.gesamt, "125,00");
  assert.match(zuerst.zielstand, /Ziel erreicht/);
  assert.deepEqual(
    await einheitSchnellBuchen("25,00", "Abschluss", result.einheiten.id),
    zuerst,
  );
  assert.deepEqual(
    await einheitSchnellBuchen(
      "99,00",
      "Veralteter erneuter Versuch",
      result.einheiten.id,
    ),
    zuerst,
    "Retry confirms the stored amount, not the new input",
  );
  assert.equal(zuerst.zielanteil, 1);
  assert.equal(
    await fixture.client.einheitenbuchung.count({ where: { userId: user.id } }),
    1,
  );
  const foreign = await fixture.client.user.create({
    data: { name: "Fremde Buchung" },
  });
  globalThis.contactReviewUser = foreign;
  assert.equal(
    (
      await einheitSchnellBuchen(
        "25,00",
        "Fremde Erinnerung",
        result.einheiten.id,
      )
    ).ok,
    false,
  );
  assert.equal(
    await fixture.client.einheitenbuchung.count({
      where: { userId: foreign.id },
    }),
    0,
  );
});

test("no interest records one call, removes follow-up and supports retry, undo and ownership boundaries", async () => {
  const user = await fixture.client.user.create({
    data: {
      name: "Kein Interesse Test",
      person: { create: { name: "Kein Interesse Test" } },
    },
  });
  globalThis.contactReviewUser = user;
  const contact = await fixture.client.contact.create({
    data: {
      name: "Absage",
      ownerId: user.id,
      nextStepType: "ANRUF",
      nextStepAt: new Date(),
    },
  });
  const form = new FormData();
  form.set("contactId", contact.id);
  form.set("result", "no_interest");
  await recordCallResult(form);
  await recordCallResult(form);
  const abgesagt = await fixture.client.contact.findUniqueOrThrow({
    where: { id: contact.id },
  });
  assert.equal(abgesagt.outcome, "VERLOREN");
  assert.equal(abgesagt.nextStepType, null);
  assert.equal(
    await fixture.client.dailyLog.count({
      where: { person: { userId: user.id }, type: "CALL" },
    }),
    1,
  );
  const undo = await offenerUndoEintrag(user.id);
  await undoAusfuehren(user.id, undo.id);
  const offen = await fixture.client.contact.findUniqueOrThrow({
    where: { id: contact.id },
  });
  assert.equal(offen.outcome, "OFFEN");
  assert.equal(offen.nextStepType, "ANRUF");
  assert.equal(
    await fixture.client.dailyLog.count({
      where: { person: { userId: user.id } },
    }),
    0,
  );
  const fremd = await fixture.client.user.create({
    data: { name: "Fremder", person: { create: { name: "Fremder" } } },
  });
  globalThis.contactReviewUser = fremd;
  await assert.rejects(recordCallResult(form), /Kontakt nicht gefunden/);
});

test.after(async () => {
  delete globalThis.prisma;
  delete globalThis.contactReviewUser;
  await fixture.close();
});
