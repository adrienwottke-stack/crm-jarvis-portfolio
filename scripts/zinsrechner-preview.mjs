// Isolated local UI fixture. No real database, accounts, mail or push.
// Run: node --import ./scripts/alias-hook.mjs scripts/zinsrechner-preview.mjs
import { spawn } from "node:child_process";
import { randomBytes, pbkdf2Sync } from "node:crypto";
import { mkdir, appendFile } from "node:fs/promises";
import { testDatabase } from "./test-db.mjs";

const fixture = await testDatabase(0, 30);
const salt = "zinsrechner-fixture-only";
const password = "Rechner-Test-2026!";
const hash = pbkdf2Sync(password, salt, 310000, 32, "sha256").toString(
  "base64",
);
for (const [id, name] of [
  ["rechner-berater", "Alex Beispiel"],
  ["rechner-fremd", "Andere Person"],
]) {
  await fixture.client.user.create({
    data: {
      id,
      name,
      email: `${id}@example.test`,
      phone: "+49 123 456789",
      path: `/${id}/`,
      passwordHash: hash,
      passwordSalt: salt,
      onboardingDoneAt: new Date(),
      person: { create: { name } },
    },
  });
}
await fixture.client.contact.create({
  data: {
    id: "rechner-anna",
    name: "Anna Beispiel",
    ownerId: "rechner-berater",
    listKinds: ["VERKAUF"],
  },
});
await fixture.client.contact.create({
  data: {
    id: "rechner-fremdkontakt",
    name: "Fremder Kunde",
    ownerId: "rechner-fremd",
  },
});
await fixture.client.startProgress.create({
  data: { userId: "rechner-berater", phase: "DONE" },
});
const port = Number(process.env.ZINSRECHNER_TEST_PORT || 3123);
const production = process.env.CRM_TEST_PRODUCTION === "1";
const logDir = new URL("../test-results/zinsrechner/", import.meta.url);
await mkdir(logDir, { recursive: true });
const server = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    production ? "start" : "dev",
    "-p",
    String(port),
    "--hostname",
    "127.0.0.1",
  ],
  {
    env: {
      ...process.env,
      DATABASE_URL: fixture.url,
      DIRECT_URL: fixture.url,
      DATABASE_POOL_MAX: "1",
      SESSION_SECRET: randomBytes(32).toString("hex"),
      NEXT_TELEMETRY_DISABLED: "1",
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  },
);
for (const stream of [server.stdout, server.stderr])
  stream.on("data", (chunk) => {
    process.stdout.write(chunk);
    void appendFile(new URL("server.log", logDir), chunk);
  });
console.log(`Isolated calculator preview: http://localhost:${port}/login`);
console.log(`Fake account: rechner-berater@example.test / ${password}`);
let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  server.kill();
  await fixture.close();
  process.exit();
};
process.on("SIGINT", close);
process.on("SIGTERM", close);
server.on("exit", close);
