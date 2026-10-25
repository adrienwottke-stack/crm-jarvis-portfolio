// Real SQL/roles in disposable PostgreSQL only; never reads .env or remote URLs.
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migrationDirectory = new URL("../prisma/migrations/", import.meta.url);
const releaseMigration = "20261005120000_release_updates";
const workMigration = "20261005160000_work_memory_pilot";
const releaseSql = await readFile(new URL(`${releaseMigration}/migration.sql`, migrationDirectory), "utf8");
const workSql = await readFile(new URL(`${workMigration}/migration.sql`, migrationDirectory), "utf8");
const history = (await readdir(migrationDirectory)).filter(name => /^\d/.test(name) && name < releaseMigration).sort();
const owner = "crm_migration_owner";
const apiRoles = ["anon", "authenticated"];
const tables = ["ReleasePublication", "ReleaseAcknowledgement", "ReleaseEvent", "ReleaseAudience", "ReleaseDelivery",
  "AiMemoryEntry", "CrmWorkTask", "CrmWorkAttempt", "CrmContactCohort", "CrmContactPilot", "CrmPilotParticipant", "CrmPilotObservation"];

async function historicalDatabase(withRoles = true) {
  const db = await PGlite.create();
  try {
    for (const name of history) await db.exec(await readFile(new URL(`${name}/migration.sql`, migrationDirectory), "utf8"));
    await db.exec(`CREATE ROLE ${owner} NOLOGIN NOSUPERUSER NOBYPASSRLS;
      GRANT USAGE, CREATE ON SCHEMA public TO ${owner};
      ALTER TABLE "User" OWNER TO ${owner};
      ALTER TABLE "AiUsage" OWNER TO ${owner};
      SET ROLE ${owner};
      INSERT INTO "User" ("id", "name") VALUES ('migration-user', 'Synthetic migration owner');
      INSERT INTO "AiUsage" ("id", "userId", "requestId", "kind", "inputTokens")
        VALUES ('historical-usage', 'migration-user', 'historical-request', 'CHAT', 19);
      RESET ROLE;`);
    if (withRoles) await db.exec(`CREATE ROLE anon NOLOGIN NOSUPERUSER NOBYPASSRLS;
      CREATE ROLE authenticated NOLOGIN NOSUPERUSER NOBYPASSRLS;
      GRANT USAGE ON SCHEMA public TO anon, authenticated;
      ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;`);
    await db.exec(`SET ROLE ${owner}`);
    return db;
  } catch (error) { await db.close(); throw error; }
}

async function asRole(db, role, operation) {
  await db.exec(`RESET ROLE; SET ROLE ${role}`);
  try { return await operation(); }
  finally { await db.exec(`RESET ROLE; SET ROLE ${owner}`); }
}

// Valid owner writes exercise every new table and its actual foreign keys.
const inserts = [
  `INSERT INTO "ReleasePublication" ("id","deploymentId","contentHash","confirmedById","publishedAt") VALUES ('release','synthetic-deployment','synthetic-hash','migration-user',NOW())`,
  `INSERT INTO "ReleaseAcknowledgement" ("id","userId","releaseId") VALUES ('ack','migration-user','release')`,
  `INSERT INTO "ReleaseEvent" ("id","userId","releaseId","type") VALUES ('event','migration-user','release','IN_APP_VIEWED')`,
  `INSERT INTO "ReleaseAudience" ("id","userId","releaseId","hasSubscription") VALUES ('audience','migration-user','release',false)`,
  `INSERT INTO "ReleaseDelivery" ("id","userId","releaseId","subscriptionId","updatedAt") VALUES ('delivery','migration-user','release','device-snapshot',NOW())`,
  `INSERT INTO "AiMemoryEntry" ("id","userId","kind","content","sourceType","sourceLabel","confirmedAt","updatedAt") VALUES ('memory','migration-user','PREFERENCE','Synthetic confirmed preference','USER','Own confirmation',NOW(),NOW())`,
  `INSERT INTO "CrmWorkTask" ("id","userId","clientTaskId","kind","route","contactId","appVersion","updatedAt") VALUES ('task','migration-user','synthetic-task','PREPARE_CONTACT','MANUAL','contact-snapshot','test',NOW())`,
  `INSERT INTO "CrmWorkAttempt" ("id","taskId","requestId","kind") VALUES ('attempt','task','synthetic-attempt','MANUAL')`,
  `INSERT INTO "CrmContactCohort" ("id","userId","contactId","origin","eligible","registeredAt") VALUES ('cohort','migration-user','contact-snapshot','NEW_ACQUAINTANCE',true,NOW())`,
  `INSERT INTO "CrmContactPilot" ("id","ownerId","joinCode","weekOne","weekTwo","updatedAt") VALUES ('pilot','migration-user','synthetic-code','2026-10-12','2026-10-19',NOW())`,
  `INSERT INTO "CrmPilotParticipant" ("id","pilotId","userId","alias","consentedAt","suitableDays") VALUES ('participant','pilot','migration-user','P1',NOW(),'[]'::jsonb)`,
  `INSERT INTO "CrmPilotObservation" ("id","pilotId","participantId","taskId","contactKey","kind","occurredAt") VALUES ('observation','pilot','participant','task','pilot-local-hash','CONVERSATION',NOW())`,
];
const db = await historicalDatabase();
await db.exec(releaseSql);
await db.exec(workSql);
for (const insert of inserts) await db.exec(insert);
after(() => db.close());

test("new migrations deny every API-role table privilege despite permissive default grants", async () => {
  for (const role of apiRoles) for (const table of tables) await asRole(db, role, async () => {
    for (const query of [`SELECT * FROM "${table}"`, `INSERT INTO "${table}" DEFAULT VALUES`,
      `UPDATE "${table}" SET "id" = "id"`, `DELETE FROM "${table}"`, `TRUNCATE "${table}"`]) {
      await assert.rejects(db.exec(query), error => error.code === "42501", `${role}: ${query}`);
    }
  });
});

test("RLS independently denies API-role reads and writes even after accidental CRUD grants", async () => {
  const names = tables.map(table => `"${table}"`).join(", ");
  await db.exec(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${names} TO anon, authenticated`);
  try {
    for (const role of apiRoles) await asRole(db, role, async () => {
      for (const [index, table] of tables.entries()) {
        assert.deepEqual((await db.query(`SELECT * FROM "${table}"`)).rows, [], `${role}: ${table} must hide owner rows`);
        assert.equal((await db.query(`UPDATE "${table}" SET "id" = "id"`)).affectedRows, 0);
        assert.equal((await db.query(`DELETE FROM "${table}"`)).affectedRows, 0);
        await assert.rejects(db.exec(inserts[index]), error => error.code === "42501", `${role}: ${table} insert must be denied by RLS`);
      }
    });
  } finally { await db.exec(`REVOKE ALL ON ${names} FROM anon, authenticated`); }
});

test("non-superuser table owner retains CRUD without BYPASSRLS or FORCE RLS", async () => {
  assert.deepEqual((await db.query("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user")).rows,
    [{ rolsuper: false, rolbypassrls: false }]);
  for (const table of tables) {
    assert.equal((await db.query(`SELECT * FROM "${table}"`)).rows.length, 1, table);
    const updated = await db.query(`UPDATE "${table}" SET "id" = "id" || '-edited' RETURNING "id"`);
    assert.equal(updated.affectedRows, 1, table);
    assert.ok(updated.rows[0].id.endsWith("-edited"), table);
    assert.deepEqual((await db.query(`SELECT "id" FROM "${table}"`)).rows, updated.rows, table);
  }
  for (const table of [...tables].reverse()) assert.equal((await db.query(`DELETE FROM "${table}"`)).affectedRows, 1, table);
  for (const insert of inserts) await db.exec(insert);
});

test("old AiUsage rows and old-code inserts retain values and receive honest unknown-cost defaults", async () => {
  await db.exec(`INSERT INTO "AiUsage" ("id","userId","requestId","kind","inputTokens")
    VALUES ('legacy-code-usage','migration-user','legacy-code-request','CHAT',23)`);
  assert.deepEqual((await db.query(`SELECT "id","inputTokens","meteringComplete","providerAttempts","pricedCostMicros","pricingVersion","workTaskId"
    FROM "AiUsage" ORDER BY "id"`)).rows, [
    { id: "historical-usage", inputTokens: 19, meteringComplete: false, providerAttempts: 0, pricedCostMicros: null, pricingVersion: null, workTaskId: null },
    { id: "legacy-code-usage", inputTokens: 23, meteringComplete: false, providerAttempts: 0, pricedCostMicros: null, pricingVersion: null, workTaskId: null },
  ]);
});

test("both real migrations also apply on PostgreSQL without Supabase API roles", async () => {
  const plain = await historicalDatabase(false);
  try {
    await plain.exec(releaseSql); await plain.exec(workSql);
    for (const insert of inserts) await plain.exec(insert);
    for (const table of tables) assert.equal((await plain.query(`SELECT * FROM "${table}"`)).rows.length, 1, table);
  } finally { await plain.close(); }
});

test("failure before either migration COMMIT rolls back new tables, enums and AiUsage changes", async () => {
  const atomic = await historicalDatabase(false);
  const interrupted = async sql => {
    // Execute the actual migration through its final statement, then simulate
    // a PostgreSQL error before COMMIT in a separate protocol message.
    await atomic.exec(sql.replace(/COMMIT;\s*$/, ""));
    await assert.rejects(atomic.exec("SELECT 1 / 0"), error => error.code === "22012");
    await atomic.exec("ROLLBACK");
  };
  try {
    await interrupted(releaseSql);
    assert.deepEqual((await atomic.query(`SELECT to_regclass('"ReleasePublication"')::text AS table_name,
      to_regtype('"ReleaseEventType"')::text AS type_name`)).rows, [{ table_name: null, type_name: null }]);
    await atomic.exec(releaseSql);
    await interrupted(workSql);
    assert.deepEqual((await atomic.query(`SELECT to_regclass('"CrmWorkTask"')::text AS table_name`)).rows, [{ table_name: null }]);
    assert.equal((await atomic.query(`SELECT column_name FROM information_schema.columns WHERE table_name='AiUsage'
      AND column_name IN ('meteringComplete','providerAttempts','pricedCostMicros','pricingVersion','workTaskId')`)).rows.length, 0);
    assert.deepEqual((await atomic.query(`SELECT "id","inputTokens" FROM "AiUsage"`)).rows, [{ id: "historical-usage", inputTokens: 19 }]);
  } finally { await atomic.close(); }
});
