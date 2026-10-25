// Diese Datei bleibt Prisma-frei, damit sie in der Edge-Middleware laeuft.

export const authCookieName = "ergo_crm_session";

// Liegt hier statt in einer "use server"-Datei, weil die nur asynchrone
// Funktionen ausfuehren darf.
export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge: 60 * 60 * 24 * 30,
  path: "/",
};

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function sessionSecret(): string {
  // APP_PASSWORD ist nur eine sichere Uebergangsloesung fuer bestehende
  // Deployments. In Produktion sollte unbedingt SESSION_SECRET gesetzt sein.
  const secret = process.env.SESSION_SECRET ?? process.env.APP_PASSWORD;
  if (!secret) throw new Error("SESSION_SECRET ist nicht gesetzt.");
  return secret;
}

async function hmac(value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(sessionSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value)
  );
  return toBase64(new Uint8Array(signature));
}

export async function createSession(userId: string): Promise<string> {
  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30;
  const payload = `${userId}.${expiresAt}`;
  return `${payload}.${await hmac(payload)}`;
}

export async function sessionUserId(token?: string): Promise<string | null> {
  if (!token) return null;
  const [userId, expiresAt, signature] = token.split(".");
  if (
    !userId ||
    !expiresAt ||
    !signature ||
    Number(expiresAt) < Date.now() / 1000
  ) {
    return null;
  }
  return signature === (await hmac(`${userId}.${expiresAt}`))
    ? userId
    : null;
}
