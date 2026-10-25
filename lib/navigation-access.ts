import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { schalter } from "@/lib/features";
import type { User } from "@/lib/generated/prisma/client";
import { navigationCapabilities } from "@/lib/navigation";

/** Presentation capabilities mirror each existing route; they do not grant access. */
export const ladeNavigationZugriff = cache(async (user: User) => {
  const [features, activeDirect, initializedDirect] = await Promise.all([
    schalter("zinsrechner", "einheiten", "teamabend", "bericht"),
    prisma.user.count({ where: { leaderId: user.id, deactivatedAt: null } }),
    prisma.user.count({ where: { leaderId: user.id, deactivatedAt: null, passwordHash: { not: null } } }),
  ]);
  return navigationCapabilities(user, { activeDirect, initializedDirect }, features);
});
