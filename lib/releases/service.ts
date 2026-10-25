import { createHash } from "node:crypto";
import type { PrismaClient, ReleaseEventType } from "@/lib/generated/prisma/client";
import { RELEASES, findRelease, validateRelease, type Release } from "@/lib/releases/catalog";

export class ReleaseError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 400) {
    super(message); this.name = "ReleaseError"; this.code = code; this.status = status;
  }
}

export function releaseContentHash(release: Release): string {
  validateRelease(release);
  return createHash("sha256").update(JSON.stringify(release)).digest("hex");
}

export function productionDeployment(deploymentId: string, env = process.env): void {
  if (env.VERCEL_ENV !== "production" || !env.VERCEL_DEPLOYMENT_ID || deploymentId !== env.VERCEL_DEPLOYMENT_ID) {
    throw new ReleaseError("PRODUCTION_REQUIRED", "Bestätige die aktuelle erfolgreiche Production-Veröffentlichung.", 403);
  }
}

export async function activeReleaseUser(db: PrismaClient, userId: string, admin = false) {
  const user = await db.user.findFirst({ where: { id: userId, deactivatedAt: null } });
  if (!user) throw new ReleaseError("UNAUTHORIZED", "Bitte melde dich erneut an.", 401);
  if (admin && user.role !== "ADMIN") throw new ReleaseError("FORBIDDEN", "Die Veröffentlichung benötigt Administratorrechte.", 403);
  return user;
}

export async function listPublishedReleases(db: PrismaClient): Promise<Release[]> {
  let publications;
  try { publications = await db.releasePublication.findMany({ orderBy: { publishedAt: "desc" } }); }
  catch (error) {
    // Opening the existing local app before its isolated migration must not
    // turn a draft announcement into an availability claim or break the shell.
    if ((error as { code?: string }).code === "P2021") return [];
    throw error;
  }
  return publications.flatMap(publication => {
    const release = findRelease(publication.id);
    return release && releaseContentHash(release) === publication.contentHash ? [release] : [];
  });
}

export async function releaseStateForUser(db: PrismaClient, userId: string) {
  const user = await activeReleaseUser(db, userId);
  const result = await Promise.all([
    db.releasePublication.findMany({ orderBy: { publishedAt: "desc" } }),
    db.releaseAcknowledgement.findMany({ where: { userId }, select: { releaseId: true } }),
  ]).catch(error => {
    if ((error as { code?: string }).code === "P2021") return null;
    throw error;
  });
  if (!result) return { releases: [], unacknowledgedReleaseIds: [] };
  const [publications, acknowledgements] = result;
  const acknowledged = new Set(acknowledgements.map(row => row.releaseId));
  const releases = publications.flatMap(publication => {
    const release = findRelease(publication.id);
    return release && releaseContentHash(release) === publication.contentHash ? [release] : [];
  });
  const eligible = new Set(publications.filter(row => row.publishedAt >= user.createdAt).map(row => row.id));
  return { releases, unacknowledgedReleaseIds: releases.filter(row => eligible.has(row.id) && !acknowledged.has(row.id)).map(row => row.id) };
}

export async function acknowledgeReleases(db: PrismaClient, userId: string, ids: string[]) {
  await activeReleaseUser(db, userId);
  const published = new Set((await listPublishedReleases(db)).map(row => row.id));
  const releaseIds = [...new Set(ids)];
  if (!releaseIds.length || releaseIds.length > RELEASES.length || releaseIds.some(id => !published.has(id))) {
    throw new ReleaseError("RELEASE_NOT_FOUND", "Dieses Update ist noch nicht veröffentlicht.", 404);
  }
  await db.releaseAcknowledgement.createMany({ data: releaseIds.map(releaseId => ({ userId, releaseId })), skipDuplicates: true });
  return { acknowledgedReleaseIds: releaseIds };
}

export async function recordReleaseEvent(db: PrismaClient, userId: string, releaseId: string, type: ReleaseEventType) {
  await activeReleaseUser(db, userId);
  if (!["IN_APP_VIEWED", "PUSH_OPENED", "ACTION_CLICKED"].includes(type)) throw new ReleaseError("INVALID_EVENT", "Unbekanntes Update-Ereignis.");
  if (!(await listPublishedReleases(db)).some(row => row.id === releaseId)) throw new ReleaseError("RELEASE_NOT_FOUND", "Dieses Update ist noch nicht veröffentlicht.", 404);
  await db.releaseEvent.createMany({ data: [{ userId, releaseId, type }], skipDuplicates: true });
  return { recorded: true };
}

/** Explicit administrative confirmation only; this function never sends a push. */
export async function confirmReleasePublication(db: PrismaClient, input: { userId: string; releaseId: string; deploymentId: string }, env = process.env) {
  productionDeployment(input.deploymentId, env);
  await activeReleaseUser(db, input.userId, true);
  const release = findRelease(input.releaseId);
  if (!release) throw new ReleaseError("RELEASE_NOT_FOUND", "Unbekanntes Update.", 404);
  const contentHash = releaseContentHash(release);
  const validateExisting = (publication: { deploymentId: string; contentHash: string }) => {
    if (publication.contentHash !== contentHash) throw new ReleaseError("CONTENT_CHANGED", "Der Inhalt dieses veröffentlichten Updates wurde verändert. Vergib eine neue Release-Kennung.", 409);
    return publication;
  };
  const existing = await db.releasePublication.findUnique({ where: { id: release.id } });
  if (existing) return validateExisting(existing);
  try {
    return await db.$transaction(async tx => {
      const actor = await tx.user.findFirst({ where: { id: input.userId, role: "ADMIN", deactivatedAt: null } });
      if (!actor) throw new ReleaseError("FORBIDDEN", "Die Administratorrechte sind nicht mehr gültig.", 403);
      const publication = await tx.releasePublication.create({ data: {
        id: release.id, contentHash, deploymentId: input.deploymentId, confirmedById: actor.id, publishedAt: new Date(),
      } });
      const users = await tx.user.findMany({ where: { deactivatedAt: null, passwordHash: { not: null, notIn: [""] } }, select: { id: true, pushAbos: { select: { id: true } } } });
      if (users.length) await tx.releaseAudience.createMany({ data: users.map(user => ({ releaseId: release.id, userId: user.id, hasSubscription: user.pushAbos.length > 0 })) });
      const deliveries = users.flatMap(user => user.pushAbos.map(subscription => ({ releaseId: release.id, userId: user.id, subscriptionId: subscription.id })));
      if (deliveries.length) await tx.releaseDelivery.createMany({ data: deliveries });
      return publication;
    });
  } catch (error) {
    if ((error as { code?: string }).code !== "P2002") throw error;
    const winner = await db.releasePublication.findUnique({ where: { id: release.id } });
    if (!winner) throw error;
    return validateExisting(winner);
  }
}

export async function releaseDeliveryReport(db: PrismaClient, releaseId: string) {
  const [audience, deliveries, events] = await Promise.all([
    db.releaseAudience.findMany({ where: { releaseId }, select: { userId: true, hasSubscription: true } }),
    db.releaseDelivery.findMany({ where: { releaseId }, select: { userId: true, status: true, attempts: true, nextAttemptAt: true } }),
    db.releaseEvent.findMany({ where: { releaseId }, select: { userId: true, type: true } }),
  ]);
  // History is available to later accounts too. Its events must not enlarge
  // the numerator of the immutable publication audience.
  const selectedUserIds = new Set(audience.map(row => row.userId));
  const audienceEvents = events.filter(row => selectedUserIds.has(row.userId));
  const counts: Record<string, number> = {};
  for (const row of deliveries) counts[row.status] = (counts[row.status] ?? 0) + 1;
  return {
    selectedUsers: audience.length,
    usersWithSubscriptionAtSelection: audience.filter(row => row.hasSubscription).length,
    providerAcceptedUsers: new Set(deliveries.filter(row => row.status === "ACCEPTED").map(row => row.userId)).size,
    deviceStatuses: counts,
    retryExhaustedDevices: deliveries.filter(row => row.status === "RETRYABLE" && row.attempts >= 3).length,
    inAppViewedUsers: audienceEvents.filter(row => row.type === "IN_APP_VIEWED").length,
    pushOpenedUsers: audienceEvents.filter(row => row.type === "PUSH_OPENED").length,
    actionClickedUsers: audienceEvents.filter(row => row.type === "ACTION_CLICKED").length,
  };
}
