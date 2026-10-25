import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { LogoMark } from "@/components/Logo";
import { LockIcon } from "@/components/icons";
import { btnPrimary, card, input, label } from "@/components/ui";
import { PASSWORT_MIN_ZEICHEN } from "@/lib/passwort";
import { passwortSetzen } from "./actions";

export const dynamic = "force-dynamic";

const fehlertexte: Record<string, string> = {
  kurz: `Das Passwort braucht mindestens ${PASSWORT_MIN_ZEICHEN} Zeichen.`,
  ungleich: "Die beiden Eingaben sind nicht gleich.",
  verbraucht: "Dieser Link wurde schon benutzt oder ist abgelaufen.",
  unbekannt: "Diesen Link kennen wir nicht.",
};

export default async function NeuesPasswortPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ code }, { error }] = await Promise.all([params, searchParams]);

  const reset = await prisma.passwortReset.findUnique({
    where: { code },
    select: {
      expiresAt: true,
      usedAt: true,
      user: { select: { name: true, email: true } },
    },
  });

  const gueltig =
    reset !== null && reset.usedAt === null && reset.expiresAt.getTime() > Date.now();

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas p-4">
      <div className="w-full max-w-sm">
        <div className={`${card} p-8`}>
          <div className="flex flex-col items-center text-center">
            <LogoMark className="h-12 w-12" />
            <h1 className="mt-4 text-xl font-semibold tracking-[-0.02em] text-ink">
              Neues Passwort
            </h1>
            {gueltig ? (
              <p className="mt-1 text-sm text-ink-soft">
                Für {reset!.user.name} · {reset!.user.email}
              </p>
            ) : (
              <p className="mt-1 text-sm text-ink-soft">
                Dieser Link gilt nicht mehr.
              </p>
            )}
          </div>

          {gueltig ? (
            <form action={passwortSetzen} className="mt-8 space-y-4">
              <input type="hidden" name="code" value={code} />
              <div>
                <label htmlFor="passwort" className={label}>
                  Neues Passwort
                </label>
                <input
                  id="passwort"
                  name="passwort"
                  type="password"
                  required
                  autoFocus
                  minLength={PASSWORT_MIN_ZEICHEN}
                  autoComplete="new-password"
                  className={input}
                />
              </div>
              <div>
                <label htmlFor="wiederholung" className={label}>
                  Nochmal
                </label>
                <input
                  id="wiederholung"
                  name="wiederholung"
                  type="password"
                  required
                  minLength={PASSWORT_MIN_ZEICHEN}
                  autoComplete="new-password"
                  className={input}
                />
              </div>

              {error && (
                <p
                  role="alert"
                  className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700"
                >
                  {fehlertexte[error] ?? fehlertexte.unbekannt}
                </p>
              )}

              <button type="submit" className={`${btnPrimary} w-full`}>
                <LockIcon className="h-4 w-4" />
                Passwort setzen und anmelden
              </button>
            </form>
          ) : (
            <p className="mt-6 rounded-lg bg-sunken px-3 py-2.5 text-sm text-ink-muted">
              Links gelten einen Tag und lassen sich nur einmal benutzen. Frag
              nach einem neuen — dann kommt sofort einer.
            </p>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-ink-soft">
          <Link href="/login" className="hover:text-ink-muted hover:underline">
            Zur Anmeldung
          </Link>
        </p>
      </div>
    </main>
  );
}
