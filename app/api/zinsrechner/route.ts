import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { istAn } from "@/lib/features";
import { RechnerFehler } from "@/lib/zinsrechner";
import {
  ladeZinsSzenarien,
  loescheZinsSzenario,
  speichereZinsSzenario,
} from "@/lib/zinsrechner-service";

export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
function fehler(error: unknown) {
  return error instanceof RechnerFehler
    ? json({ error: error.message }, error.status)
    : json(
        {
          error:
            "Speichern ist gerade nicht möglich. Deine Eingaben bleiben erhalten. Bitte erneut versuchen.",
        },
        503,
      );
}
export async function GET(request: Request) {
  const user = await requireUser();
  if (!(await istAn("zinsrechner")))
    return json({ error: "Der Zinsrechner ist derzeit abgeschaltet." }, 403);
  try {
    const params = new URL(request.url).searchParams;
    if (params.has("kontakte")) {
      const q = (params.get("kontakte") ?? "").trim().slice(0, 80);
      const contacts = q
        ? await prisma.contact.findMany({
            where: {
              ownerId: user.id,
              name: { contains: q, mode: "insensitive" },
            },
            select: { id: true, name: true },
            orderBy: { name: "asc" },
            take: 20,
          })
        : [];
      return json({ contacts });
    }
    return json({ scenarios: await ladeZinsSzenarien(prisma, user.id) });
  } catch (error) {
    return fehler(error);
  }
}
async function schreiben(request: Request, remove: boolean) {
  // Cookie-authenticated JSON writes accept only the app's own origin.
  if (
    request.headers.get("origin") !== new URL(request.url).origin ||
    !request.headers.get("content-type")?.startsWith("application/json")
  )
    return json({ error: "Bitte öffne den Rechner erneut in der App." }, 403);
  const user = await requireUser();
  if (!(await istAn("zinsrechner")))
    return json({ error: "Der Zinsrechner ist derzeit abgeschaltet." }, 403);
  try {
    const text = await request.text();
    if (text.length > 32000)
      return json({ error: "Die Berechnung ist zu groß." }, 413);
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text);
    } catch {
      throw new RechnerFehler("Die Berechnung konnte nicht gelesen werden.");
    }
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new RechnerFehler("Die Berechnung ist unvollständig.");
    if (remove) {
      await loescheZinsSzenario(prisma, user.id, body.id, body.version);
      return json({ ok: true });
    }
    return json({
      scenario: await speichereZinsSzenario(prisma, user.id, body),
    });
  } catch (error) {
    return fehler(error);
  }
}
export async function POST(request: Request) {
  return schreiben(request, false);
}
export async function DELETE(request: Request) {
  return schreiben(request, true);
}
