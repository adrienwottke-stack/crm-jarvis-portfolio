import test, { after } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Isolated file fixture only; it is neither AC/DC nor included in the repository.
const directory = await mkdtemp(join(tmpdir(), "jarvis-music-test-"));
const file = join(directory, "explicit-test-fixture.mp3");
await writeFile(file, Buffer.from("audio-route-test-fixture"));
let currentUser = "owner";
globalThis.jarvisMusicOwner = () => currentUser;
const privateBytes = Buffer.from("private-audio-fixture");
const privateUrl = "https://fixture.private.blob.vercel-storage.com/jarvis/test.mp3";
let blobReads = 0, blobUrl = privateUrl, missingBlob = false, wrongRange = false;
globalThis.jarvisBlobHead = () => {
  blobReads++;
  return { url: blobUrl, size: privateBytes.length, contentType: "audio/mpeg", etag: "fixture-etag" };
};
globalThis.jarvisBlobGet = (pathname, options) => {
  blobReads++;
  assert.equal(pathname, "jarvis/test.mp3"); assert.equal(options.access, "private");
  assert.equal(options.headers["If-Match"], "fixture-etag");
  if (missingBlob) return null;
  const range = options.headers.Range?.match(/^bytes=(\d+)-(\d+)$/);
  const start = range ? Number(range[1]) : 0, end = range ? Number(range[2]) : privateBytes.length - 1;
  const bytes = privateBytes.subarray(start, end + 1);
  return { statusCode: 200, stream: new Response(bytes).body, blob: { size: bytes.length }, headers: new Headers(range && !wrongRange ? { "content-range": `bytes ${start}-${end}/${privateBytes.length}` } : {}) };
};
const mocks = {
  "@vercel/blob": "export class BlobNotFoundError extends Error{}; export async function head(){return globalThis.jarvisBlobHead()}; export async function get(...args){return globalThis.jarvisBlobGet(...args)}",
  "@/lib/auth": "export async function requireUser(){return {id:globalThis.jarvisMusicOwner()}}",
  "@/lib/prisma": "export const prisma={}",
  "@/lib/ai-crm/entitlement": "export async function requireAiEntitlement(db,id){if(id==='denied')throw new Error('blocked')}",
  "@/lib/ai-crm/live-sessions": "import {AiCrmError} from '@/lib/ai-crm/errors'; export async function requireLiveSession(db,p){if(p.userId!=='owner'||p.sessionId!=='own-session')throw new AiCrmError('LIVE_SESSION_NOT_FOUND','Nicht gefunden.',404);return {id:p.sessionId}}",
};
registerHooks({ resolve(specifier, context, next) { return mocks[specifier] ? { url: `data:text/javascript,${encodeURIComponent(mocks[specifier])}`, shortCircuit: true } : next(specifier, context); } });
const { GET } = await import("../app/api/ai-crm/live/music/route.ts");
const request = (query = "", headers = {}) => new Request(`https://crm.example.test/api/ai-crm/live/music?sessionId=own-session${query}`, { headers });
after(async () => { delete process.env.AI_LIVE_MUSIC_FILE; delete process.env.AI_LIVE_MUSIC_BLOB_PATH; delete process.env.AI_LIVE_MUSIC_TITLE; delete globalThis.jarvisMusicOwner; delete globalThis.jarvisBlobHead; delete globalThis.jarvisBlobGet; await unlink(file); await rmdir(directory); });

test("missing music is explicit and does not expose server paths", async () => {
  delete process.env.AI_LIVE_MUSIC_FILE;
  delete process.env.AI_LIVE_MUSIC_BLOB_PATH;
  const response = await GET(request("&status=1")); const body = await response.json();
  assert.equal(body.available, false); assert.match(body.message, /AI_LIVE_MUSIC_FILE/);
});
test("only an own active session can load configured audio, including status", async () => {
  process.env.AI_LIVE_MUSIC_FILE = file; currentUser = "foreign";
  assert.equal((await GET(request())).status, 404); assert.equal((await GET(request("&status=1"))).status, 404);
  currentUser = "owner";
});
test("configured audio supports byte ranges with no-store and no client filename", async () => {
  process.env.AI_LIVE_MUSIC_FILE = file;
  const response = await GET(request("&file=secret.env", { range: "bytes=0-4" }));
  assert.equal(response.status, 206); assert.equal(await response.text(), "audio"); assert.equal(response.headers.get("content-type"), "audio/mpeg");
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal((await GET(request("", { range: "bytes=500-600" }))).status, 416);
  const status = await GET(request("&status=1")); assert.equal((await status.json()).available, true);
});
test("remote and relative music paths are not accepted", async () => {
  for (const path of ["https://example.test/music.mp3", "./file.mp3", "file.env"]) {
    process.env.AI_LIVE_MUSIC_FILE = path;
    assert.equal((await GET(request())).status, 404);
  }
});

test("private music verifies own active session and entitlement before touching storage", async () => {
  delete process.env.AI_LIVE_MUSIC_FILE; process.env.AI_LIVE_MUSIC_BLOB_PATH = "jarvis/test.mp3";
  for (const user of ["foreign", "denied"]) {
    currentUser = user; const before = blobReads;
    assert.notEqual((await GET(request())).status, 200);
    assert.notEqual((await GET(request("&status=1"))).status, 200);
    assert.equal(blobReads, before);
  }
  currentUser = "owner";
  const before = blobReads;
  assert.equal((await GET(new Request("https://crm.example.test/api/ai-crm/live/music?sessionId=ended"))).status, 404);
  assert.equal(blobReads, before);
});

test("private music returns only safe status and the exact bytes through authenticated route", async () => {
  process.env.AI_LIVE_MUSIC_TITLE = "AC/DC – Highway to Hell";
  const status = await GET(request("&status=1"));
  assert.deepEqual(await status.json(), { available: true, title: "AC/DC – Highway to Hell" });
  const response = await GET(request("&pathname=other/private.mp3"));
  assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), privateBytes);
  assert.equal(response.headers.get("content-type"), "audio/mpeg"); assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(response.headers.get("location"), null);
});

test("private music supports browser byte ranges and rejects malformed or mismatched ranges", async () => {
  for (const [range, expected] of [["bytes=0-6", "private"], ["bytes=-7", "fixture"], ["bytes=14-999", "fixture"]]) {
    const response = await GET(request("", { range }));
    assert.equal(response.status, 206); assert.equal(await response.text(), expected);
  }
  for (const range of ["bytes=500-", "bytes=4-1", "bytes=-0", "bytes=-", "bytes=0-1,3-4", "bytes=9007199254740992-"]) {
    assert.equal((await GET(request("", { range }))).status, 416);
  }
  wrongRange = true;
  assert.equal((await GET(request("", { range: "bytes=0-6" }))).status, 409);
  wrongRange = false;
});

test("private music refuses public stores, remote paths and a disappeared object", async () => {
  blobUrl = "https://fixture.public.blob.vercel-storage.com/jarvis/test.mp3";
  assert.equal((await GET(request("&status=1"))).status, 503);
  blobUrl = privateUrl;
  for (const path of ["https://example.test/a.mp3", "jarvis/../secret.mp3", "other/test.mp3"]) {
    process.env.AI_LIVE_MUSIC_BLOB_PATH = path; const before = blobReads;
    assert.equal((await GET(request())).status, 404); assert.equal(blobReads, before);
  }
  process.env.AI_LIVE_MUSIC_BLOB_PATH = "jarvis/test.mp3"; missingBlob = true;
  assert.equal((await GET(request())).status, 404);
  missingBlob = false;
});
