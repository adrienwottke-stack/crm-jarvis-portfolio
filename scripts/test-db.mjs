import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { readdir, readFile } from "node:fs/promises";
import { PrismaClient } from "../lib/generated/prisma/client.ts";
import { PrismaPg } from "@prisma/adapter-pg";

// Always a new in-memory database. Never reads DATABASE_URL or a user's .env.
export async function testDatabase(port = 0, maxConnections = 1) {
  const memory = await PGlite.create();
  const directory = new URL("../prisma/migrations/", import.meta.url);
  for (const name of (await readdir(directory))
    .filter((n) => /^\d/.test(n))
    .sort()) {
    await memory.exec(
      await readFile(new URL(`${name}/migration.sql`, directory), "utf8"),
    );
  }
  const socket = new PGLiteSocketServer({
    db: memory,
    port,
    host: "127.0.0.1",
    maxConnections,
    debug: process.env.CRM_TEST_DB_DEBUG === "1",
  });
  await socket.start();
  const address = socket.getServerConn();
  const url = `postgresql://postgres:postgres@${address}/postgres`;
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url, max: 1 }),
  });
  return {
    client,
    url,
    stats: () => ({
      ...socket.getStats(),
      inTransaction: memory.isInTransaction(),
    }),
    async close() {
      await client.$disconnect();
      await socket.stop();
      await memory.close();
    },
  };
}
