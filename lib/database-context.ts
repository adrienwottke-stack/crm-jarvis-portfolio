import { AsyncLocalStorage } from "node:async_hooks";
import type { Prisma, PrismaClient } from "@/lib/generated/prisma/client";

type DatabaseScope = { db: PrismaClient | Prisma.TransactionClient; transaction: boolean; afterCommit: Array<() => Promise<unknown>> };
const databaseScope = new AsyncLocalStorage<DatabaseScope>();
const underlyingClients = new WeakMap<object, PrismaClient>();

/** A unit of work for existing domain services. Never changes the authenticated actor. */
export function withDatabase<T>(db: DatabaseScope["db"], transaction: boolean, afterCommit: DatabaseScope["afterCommit"], work: () => Promise<T>): Promise<T> {
  return databaseScope.run({ db: underlyingClients.get(db) ?? db, transaction, afterCommit }, work);
}
export function deferUntilCommit(work: () => Promise<unknown>): boolean {
  const scope = databaseScope.getStore();
  if (!scope?.transaction) return false;
  scope.afterCommit.push(work);
  return true;
}
export function scopedDatabase(base: PrismaClient): PrismaClient {
  const proxy = new Proxy(base, { get(target, key) {
    const scope = databaseScope.getStore();
    if (scope?.transaction && key === "$transaction") return async (work: ((db: Prisma.TransactionClient) => Promise<unknown>) | Promise<unknown>[]) =>
      typeof work === "function" ? work(scope.db as Prisma.TransactionClient) : Promise.all(work);
    const db = scope?.db ?? target;
    const value = Reflect.get(db, key);
    return typeof value === "function" ? value.bind(db) : value;
  } });
  underlyingClients.set(proxy, base);
  return proxy;
}
