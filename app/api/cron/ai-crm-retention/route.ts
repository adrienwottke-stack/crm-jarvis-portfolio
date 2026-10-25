import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cleanupExpiredAiContent } from "@/lib/ai-crm/conversations";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const supplied =
    request.headers.get("authorization") ??
    `Bearer ${request.nextUrl.searchParams.get("token") ?? ""}`;
  if (!secret || supplied !== `Bearer ${secret}`) {
    return new NextResponse("Nicht erlaubt.", { status: 401 });
  }
  const result = await cleanupExpiredAiContent(prisma);
  return NextResponse.json(result, {
    headers: { "Cache-Control": "no-store" },
  });
}
