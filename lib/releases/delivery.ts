import type { PrismaClient, PushAbo } from "@/lib/generated/prisma/client";
import { findRelease } from "@/lib/releases/catalog";
import { activeReleaseUser, productionDeployment, releaseContentHash, ReleaseError, releaseDeliveryReport } from "@/lib/releases/service";
import { pushEingerichtet, sendPushDevice, type Meldung } from "@/lib/push";

type Transport = (subscription: PushAbo, message: Meldung) => Promise<unknown>;
const RESERVATION_MS = 5 * 60_000;
const MAX_ATTEMPTS = 3;

/** No timer, cron, rendering or import calls this. The route is an explicit admin POST. */
export async function dispatchRelease(db: PrismaClient, input: { userId: string; releaseId: string; deploymentId: string }, options: { env?: NodeJS.ProcessEnv; now?: Date; transport?: Transport } = {}) {
  const env = options.env ?? process.env;
  productionDeployment(input.deploymentId, env);
  await activeReleaseUser(db, input.userId, true);
  const release = findRelease(input.releaseId);
  const publication = await db.releasePublication.findUnique({ where: { id: input.releaseId } });
  if (!release || !publication) throw new ReleaseError("RELEASE_NOT_PUBLISHED", "Bestätige zuerst die erfolgreiche Veröffentlichung.", 409);
  if (publication.contentHash !== releaseContentHash(release)) throw new ReleaseError("CONTENT_CHANGED", "Die veröffentlichte Ankündigung stimmt nicht mit dieser Version überein.", 409);
  if (!options.transport && !pushEingerichtet()) throw new ReleaseError("PUSH_NOT_CONFIGURED", "Der Push-Versand ist noch nicht eingerichtet.", 409);
  const now = options.now ?? new Date();
  const transport = options.transport ?? sendPushDevice;
  // Provider acceptance followed by a crash is uncertain. Never auto-resend it.
  await db.releaseDelivery.updateMany({ where: { releaseId: release.id, status: "RESERVED", reservedAt: { lt: new Date(now.getTime() - RESERVATION_MS) } }, data: { status: "UNKNOWN", lastError: "RESERVATION_EXPIRED_OUTCOME_UNKNOWN", nextAttemptAt: null } });
  const candidates = await db.releaseDelivery.findMany({
    where: { releaseId: release.id, attempts: { lt: MAX_ATTEMPTS }, OR: [{ status: "PENDING" }, { status: "RETRYABLE", nextAttemptAt: { lte: now } }] },
    orderBy: { createdAt: "asc" }, take: 20,
  });
  const message: Meldung = { titel: release.title, text: release.benefit, url: `/neuigkeiten?release=${encodeURIComponent(release.id)}&opened=1`, kennung: `release:${release.id}` };
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, candidates.length) }, async () => {
    for (;;) {
      const delivery = candidates[cursor++];
      if (!delivery) return;
      await activeReleaseUser(db, input.userId, true);
      const claimed = await db.releaseDelivery.updateMany({ where: { id: delivery.id, status: delivery.status, attempts: delivery.attempts }, data: { status: "RESERVED", reservedAt: now, attempts: { increment: 1 }, nextAttemptAt: null, lastError: null } });
      if (!claimed.count) continue;
      const snapshot = await db.pushAbo.findFirst({ where: { id: delivery.subscriptionId, userId: delivery.userId, user: { deactivatedAt: null, passwordHash: { not: null, notIn: [""] } } } });
      if (!snapshot) {
        await db.releaseDelivery.update({ where: { id: delivery.id }, data: { status: "EXPIRED", lastError: "SUBSCRIPTION_REMOVED_OR_ACCOUNT_CHANGED" } });
        continue;
      }
      try {
        // Recheck ownership/keys immediately before the external call, also on every retry.
        const current = await db.pushAbo.findFirst({ where: { id: snapshot.id, userId: snapshot.userId, endpoint: snapshot.endpoint, p256dh: snapshot.p256dh, auth: snapshot.auth, user: { deactivatedAt: null, passwordHash: { not: null, notIn: [""] } } } });
        if (!current) {
          await db.releaseDelivery.update({ where: { id: delivery.id }, data: { status: "EXPIRED", lastError: "SUBSCRIPTION_CHANGED_BEFORE_SEND" } });
          continue;
        }
        await transport(current, message);
        // Persist acceptance first. A failure here leaves RESERVED, later UNKNOWN.
        await db.releaseDelivery.update({ where: { id: delivery.id }, data: { status: "ACCEPTED", acceptedAt: now } });
        await db.pushAbo.updateMany({ where: { id: current.id, userId: current.userId, endpoint: current.endpoint, p256dh: current.p256dh, auth: current.auth }, data: { letzteZustellung: now } });
      } catch (error) {
        const code = (error as { statusCode?: number }).statusCode;
        const terminal = code === 404 || code === 410;
        const retryable = code === 429 || (typeof code === "number" && code >= 500 && code <= 599);
        // No HTTP response means acceptance is unknown, including network timeouts.
        await db.releaseDelivery.updateMany({ where: { id: delivery.id, status: "RESERVED" }, data: {
          status: terminal ? "EXPIRED" : retryable ? "RETRYABLE" : "UNKNOWN",
          nextAttemptAt: retryable && delivery.attempts + 1 < MAX_ATTEMPTS ? new Date(now.getTime() + 60_000 * 2 ** delivery.attempts) : null,
          lastError: typeof code === "number" ? `PROVIDER_HTTP_${code}` : "PROVIDER_OUTCOME_UNKNOWN",
        } });
        if (terminal) await db.pushAbo.deleteMany({ where: { id: snapshot.id, userId: snapshot.userId, endpoint: snapshot.endpoint, p256dh: snapshot.p256dh, auth: snapshot.auth } });
      }
    }
  }));
  return releaseDeliveryReport(db, release.id);
}
