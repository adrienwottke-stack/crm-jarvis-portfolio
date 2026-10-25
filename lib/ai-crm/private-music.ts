import { get, head, BlobNotFoundError } from "@vercel/blob";
import { AiCrmError } from "@/lib/ai-crm/errors";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin" };

/** Call only after checking the user, entitlement and ownership of the active session. */
export async function privateMusicResponse(request: Request, pathname: string): Promise<Response> {
  // Only an operator-selected object in the music folder; never a browser URL or path.
  if (!/^jarvis\/[a-zA-Z0-9_-]+\.(mp3|m4a|ogg|wav|webm)$/.test(pathname)) {
    throw new AiCrmError("LIVE_MUSIC_NOT_CONFIGURED", "Die private Musikquelle ist nicht korrekt eingerichtet.", 404);
  }
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]);
  const metadata = await head(pathname, { abortSignal: signal }).catch(error => {
    if (error instanceof BlobNotFoundError) throw new AiCrmError("LIVE_MUSIC_FILE_MISSING", "Die konfigurierte Musikdatei ist nicht verfügbar.", 404);
    throw new AiCrmError("LIVE_MUSIC_UNAVAILABLE", "Die Musikquelle ist gerade nicht erreichbar. Bitte erneut versuchen.", 502);
  });
  if (!new URL(metadata.url).hostname.endsWith(".private.blob.vercel-storage.com")) {
    throw new AiCrmError("LIVE_MUSIC_NOT_PRIVATE", "Die Musikquelle muss in einem privaten Speicher liegen.", 503);
  }
  if (!Number.isSafeInteger(metadata.size) || metadata.size <= 0 || metadata.size > 80 * 1024 * 1024 || !metadata.contentType.startsWith("audio/")) {
    throw new AiCrmError("LIVE_MUSIC_INVALID", "Die konfigurierte Musikquelle ist keine unterstützte Audiodatei.", 422);
  }
  if (new URL(request.url).searchParams.get("status") === "1") {
    return Response.json({ available: true, title: process.env.AI_LIVE_MUSIC_TITLE?.trim().slice(0, 120) || "Freigegebene Musik" }, { headers });
  }
  const range = request.headers.get("range");
  let start = 0, end = metadata.size - 1;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    const invalid = () => new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${metadata.size}` } });
    if (!match || (!match[1] && !match[2])) return invalid();
    if (!match[1]) {
      const suffix = Number(match[2]);
      if (!Number.isSafeInteger(suffix) || suffix <= 0) return invalid();
      start = Math.max(0, metadata.size - suffix);
    } else {
      start = Number(match[1]);
      end = match[2] ? Number(match[2]) : end;
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= metadata.size) return invalid();
    end = Math.min(end, metadata.size - 1);
  }
  const expectedRange = `bytes ${start}-${end}/${metadata.size}`;
  const result = await get(pathname, {
    access: "private", abortSignal: signal,
    headers: { "If-Match": metadata.etag, ...(range ? { Range: `bytes=${start}-${end}` } : {}) },
  }).catch(() => { throw new AiCrmError("LIVE_MUSIC_UNAVAILABLE", "Die Musikdatei konnte nicht geladen werden. Bitte erneut versuchen.", 502); });
  if (!result || result.statusCode !== 200) throw new AiCrmError("LIVE_MUSIC_FILE_MISSING", "Die konfigurierte Musikdatei ist nicht verfügbar.", 404);
  // The SDK labels successful partial responses as 200; validate the real range header.
  if (result.blob.size !== end - start + 1 || (range && result.headers.get("content-range") !== expectedRange)) {
    await result.stream.cancel();
    throw new AiCrmError("LIVE_MUSIC_CHANGED", "Die Musikdatei wurde beim Laden verändert. Bitte erneut versuchen.", 409);
  }
  return new Response(result.stream, { status: range ? 206 : 200, headers: {
    ...headers, "Content-Type": metadata.contentType, "Content-Length": String(end - start + 1),
    "Accept-Ranges": "bytes", ...(range ? { "Content-Range": expectedRange } : {}),
  } });
}
