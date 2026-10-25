import { isAbsolute, extname } from "node:path";
import { open } from "node:fs/promises";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { aiCrmConfig } from "@/lib/ai-crm/config";
import { requireAiEntitlement } from "@/lib/ai-crm/entitlement";
import { requireLiveSession } from "@/lib/ai-crm/live-sessions";
import { AiCrmError } from "@/lib/ai-crm/errors";
import { aiErrorResponse } from "@/lib/ai-crm/http";
import { privateMusicResponse } from "@/lib/ai-crm/private-music";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin" };
const mime: Record<string, string> = { ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".ogg": "audio/ogg", ".wav": "audio/wav", ".webm": "audio/webm" };

/** The browser can select its own session, never a filesystem path or remote URL. */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    await requireAiEntitlement(prisma, user.id, new Date(), aiCrmConfig());
    const url = new URL(request.url);
    const sessionId = url.searchParams.get("sessionId");
    if (!sessionId || sessionId.length > 120) throw new AiCrmError("LIVE_SESSION_REQUIRED", "Starte zuerst Jarvis.", 400);
    await requireLiveSession(prisma, { userId: user.id, sessionId });
    const file = process.env.AI_LIVE_MUSIC_FILE?.trim();
    const blobPath = process.env.AI_LIVE_MUSIC_BLOB_PATH?.trim();
    if (!file && blobPath) return await privateMusicResponse(request, blobPath);
    if (!file || !isAbsolute(file) || !mime[extname(file).toLowerCase()]) {
      if (url.searchParams.get("status") === "1") return Response.json({ available: false, message: "Keine freigegebene Audiodatei eingerichtet. AI_LIVE_MUSIC_FILE muss auf eine vorhandene MP3-, M4A-, OGG-, WAV- oder WebM-Datei auf dem App-Rechner zeigen." }, { headers });
      throw new AiCrmError("LIVE_MUSIC_NOT_CONFIGURED", "Die freigegebene Musikdatei fehlt (AI_LIVE_MUSIC_FILE).", 404);
    }
    // Open once: metadata and bytes refer to the same handle, even during a file replacement.
    const handle = await open(file, "r").catch(() => null);
    if (!handle) throw new AiCrmError("LIVE_MUSIC_FILE_MISSING", "Die konfigurierte freigegebene Musikdatei ist auf dem App-Rechner nicht lesbar.", 404);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size === 0 || stat.size > 80 * 1024 * 1024) throw new AiCrmError("LIVE_MUSIC_INVALID", "Die Musikquelle muss eine lesbare Audiodatei zwischen 1 Byte und 80 MiB sein.", 422);
      if (url.searchParams.get("status") === "1") return Response.json({ available: true, title: process.env.AI_LIVE_MUSIC_TITLE?.trim().slice(0, 120) || "Freigegebene Musik" }, { headers });
      const range = request.headers.get("range");
      let start = 0;
      let end = stat.size - 1;
      if (range) {
        const match = /^bytes=(\d+)-(\d*)$/.exec(range);
        if (!match) return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${stat.size}` } });
        start = Number(match[1]); end = match[2] ? Number(match[2]) : end;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= stat.size) return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${stat.size}` } });
        end = Math.min(end, stat.size - 1);
      }
      const bytes = Buffer.alloc(end - start + 1);
      let offset = 0;
      while (offset < bytes.length) {
        const result = await handle.read(bytes, offset, bytes.length - offset, start + offset);
        if (!result.bytesRead) break;
        offset += result.bytesRead;
      }
      if (offset !== bytes.length) throw new AiCrmError("LIVE_MUSIC_CHANGED", "Die Musikquelle wurde beim Laden verändert. Bitte erneut starten.", 409);
      return new Response(new Uint8Array(bytes), { status: range ? 206 : 200, headers: { ...headers, "Content-Type": mime[extname(file).toLowerCase()], "Content-Length": String(bytes.length), "Accept-Ranges": "bytes", ...(range ? { "Content-Range": `bytes ${start}-${end}/${stat.size}` } : {}) } });
    } finally { await handle.close(); }
  } catch (error) { return aiErrorResponse(error); }
}
