import { prisma } from "@/lib/prisma";
import { login } from "./actions";
import { LogoMark } from "@/components/Logo";
import { LockIcon } from "@/components/icons";
import { btnPrimary, card, input, label } from "@/components/ui";
import { releaseReturnTarget } from "@/lib/releases/return-target";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const [{ error, next }, userCount] = await Promise.all([
    searchParams,
    prisma.user.count(),
  ]);
  const isFirstSetup = userCount === 0;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas p-4">
      <div className="w-full max-w-sm">
        <div className={`${card} p-8`}>
          <div className="flex flex-col items-center text-center">
            <LogoMark className="h-12 w-12" />
            <h1 className="mt-4 text-xl font-semibold tracking-[-0.02em] text-ink">
              {isFirstSetup ? "Admin-Konto einrichten" : "Cockpit"}
            </h1>
            <p className="mt-1 text-sm text-ink-soft">
              {isFirstSetup
                ? "Nutze das bisherige APP_PASSWORD, um die vorhandenen Daten zu übernehmen."
                : "Melde dich mit deinem persönlichen Teamkonto an."}
            </p>
          </div>

          <form action={login} className="mt-8 space-y-4">
            {releaseReturnTarget(next) && <input type="hidden" name="next" value={releaseReturnTarget(next)!} />}
            {isFirstSetup && (
              <div>
                <label htmlFor="name" className={label}>
                  Dein Name
                </label>
                <input id="name" name="name" type="text" required maxLength={60} autoFocus className={input} />
              </div>
            )}
            <div>
              <label htmlFor="email" className={label}>
                E-Mail-Adresse
              </label>
              <input id="email" name="email" type="email" autoFocus={!isFirstSetup} autoComplete="email" className={input} />
            </div>
            <div>
              <label htmlFor="password" className={label}>
                Passwort
              </label>
              <input id="password" name="password" type="password" required autoComplete={isFirstSetup ? "new-password" : "current-password"} className={input} />
            </div>

            {error && (
              <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
                Anmeldedaten sind nicht korrekt. Bitte erneut versuchen.
              </p>
            )}

            <button type="submit" className={`${btnPrimary} w-full`}>
              <LockIcon className="h-4 w-4" />
              {isFirstSetup ? "Admin-Konto erstellen" : "Anmelden"}
            </button>
          </form>
          {!isFirstSetup && (
            <p className="mt-5 border-t border-line pt-4 text-center text-xs text-ink-soft">
              Passwort vergessen? Melde dich bei deiner Führungskraft — sie
              schickt dir einen Link, mit dem du ein neues setzt.
            </p>
          )}
        </div>

        {/* Konten entstehen ueber Einladungslinks (/einladung/[code]), nicht
            ueber einen Admin. Hier stand vorher das Gegenteil - ausgerechnet
            auf der Seite, auf der ein Eingeladener landet, wenn er den Link
            verlegt hat. */}
        <p className="mt-4 text-center text-xs text-ink-soft">
          Noch kein Konto? Du brauchst den Einladungslink deiner Führungskraft.
        </p>
      </div>
    </main>
  );
}
