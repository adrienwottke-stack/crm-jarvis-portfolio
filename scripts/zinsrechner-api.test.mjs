import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { randomUUID } from "node:crypto";
import { testDatabase } from "./test-db.mjs";
import { standardWerte } from "../lib/zinsrechner.ts";

const fixture = await testDatabase();
globalThis.prisma = fixture.client;
globalThis.rechnerTestAn = true;
const owner = await fixture.client.user.create({ data: { name: "API Test" } });
globalThis.rechnerTestUser = owner;
const modules = {
  "@/lib/auth":
    "export async function requireUser(){return globalThis.rechnerTestUser}",
  "@/lib/features":
    "export async function istAn(){return globalThis.rechnerTestAn}",
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
const { GET, POST, DELETE } = await import("../app/api/zinsrechner/route.ts");
test.after(() => fixture.close());
const origin = "https://crm.example.test";
const payload = () => ({
  id: randomUUID(),
  version: 0,
  title: "API Sparplan",
  contactId: null,
  values: standardWerte(),
});
const req = (body, headers = {}, method = "POST") =>
  new Request(`${origin}/api/zinsrechner`, {
    method,
    headers: { origin, "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

test("cross-origin and non-JSON writes cannot mutate data", async () => {
  assert.equal(
    (await POST(req(payload(), { origin: "https://other.example.test" })))
      .status,
    403,
  );
  assert.equal(
    (await POST(req(payload(), { "content-type": "text/plain" }))).status,
    403,
  );
  assert.equal(await fixture.client.zinsSzenario.count(), 0);
});
test("JSON save/list/delete and response privacy headers work", async () => {
  const sent = payload();
  const response = await POST(req(sent));
  assert.equal(response.status, 200);
  const { scenario } = await response.json();
  const list = await GET(new Request(`${origin}/api/zinsrechner`));
  assert.equal(list.headers.get("cache-control"), "private, no-store");
  assert.equal((await list.json()).scenarios[0].id, scenario.id);
  assert.equal(
    (
      await DELETE(
        req({ id: scenario.id, version: scenario.version }, {}, "DELETE"),
      )
    ).status,
    200,
  );
});
test("contact search only returns the current user's contacts", async () => {
  const other = await fixture.client.user.create({
    data: { name: "Foreign API" },
  });
  await fixture.client.contact.create({
    data: { name: "Anna Fremd", ownerId: other.id },
  });
  await fixture.client.contact.create({
    data: { name: "Anna Eigene", ownerId: owner.id },
  });
  const response = await GET(
    new Request(`${origin}/api/zinsrechner?kontakte=Anna`),
  );
  assert.deepEqual(
    (await response.json()).contacts.map((c) => c.name),
    ["Anna Eigene"],
  );
});
test("malformed and oversized payloads fail without writes", async () => {
  assert.equal((await POST(req(null))).status, 400);
  assert.equal((await POST(req({ text: "x".repeat(32001) }))).status, 413);
  assert.equal(
    (
      await POST(
        req({ ...payload(), values: { ...standardWerte(), monthly: 999999 } }),
      )
    ).status,
    400,
  );
});
test("feature switch covers reads, contact search and writes", async () => {
  globalThis.rechnerTestAn = false;
  try {
    assert.equal(
      (await GET(new Request(`${origin}/api/zinsrechner`))).status,
      403,
    );
    assert.equal(
      (await GET(new Request(`${origin}/api/zinsrechner?kontakte=Anna`)))
        .status,
      403,
    );
    assert.equal((await POST(req(payload()))).status, 403);
  } finally {
    globalThis.rechnerTestAn = true;
  }
});
