import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { loadCoach } from "@/lib/coach/service";

// Shared between Today and the shell within one render/request.
export const ladeCoach = cache((userId: string) => loadCoach(prisma, userId));
