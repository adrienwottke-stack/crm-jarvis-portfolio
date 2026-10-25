import { registerHooks } from "node:module";

/** Test-only adapters: the actor is synthetic; domain reads share its transaction. */
export async function installEvaluationAdapter(db, actorId) {
  if (!db || typeof actorId !== "function") throw new Error("EVALUATION_ADAPTER_INVALID");
  // lib/prisma captures this fixture as its base. Its exported proxy follows
  // withDatabase(tx), including authentication inside canonical CRM actions.
  globalThis.prisma = db;
  globalThis.jarvisEvaluationAdapter = { db: null, actorId };
  const mocks = {
    "@/lib/auth": `export async function requireUser(){const state=globalThis.jarvisEvaluationAdapter;const user=await state.db.user.findUniqueOrThrow({where:{id:state.actorId()}});if(user.deactivatedAt)throw new Error('unauthorized');return user;} export async function requireAdmin(){const user=await requireUser();if(user.role!=='ADMIN')throw new Error('forbidden');return user;} export async function requireUserPerson(id){return globalThis.jarvisEvaluationAdapter.db.person.findUniqueOrThrow({where:{userId:id}});}`,
    "next/cache": "export function revalidatePath(){}",
    "next/navigation": "export function redirect(path){const error=new Error('redirect');error.digest='NEXT_REDIRECT;replace;'+path+';303;';throw error;}",
  };
  registerHooks({ resolve(specifier, context, next) {
    return mocks[specifier] ? { url: `data:text/javascript,${encodeURIComponent(mocks[specifier])}`, shortCircuit: true } : next(specifier, context);
  } });
  const { prisma } = await import("../lib/prisma.ts");
  globalThis.jarvisEvaluationAdapter.db = prisma;
  return prisma;
}
