import { PrismaClient } from "@/lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { scopedDatabase } from "@/lib/database-context";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient() {
  const max = process.env.DATABASE_POOL_MAX ? Number(process.env.DATABASE_POOL_MAX) : 10;
  if (!Number.isInteger(max) || max < 1) throw new Error("DATABASE_POOL_MAX muss eine positive ganze Zahl sein.");
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    max,
  });
  return new PrismaClient({ adapter });
}

const basePrisma = globalForPrisma.prisma ?? createPrismaClient();
export const prisma = scopedDatabase(basePrisma);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = basePrisma;
}
