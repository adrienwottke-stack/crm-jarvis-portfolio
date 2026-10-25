import { requireOnboardedUser } from "@/lib/auth";
import AppShell from "@/components/AppShell";

export default async function TeamLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Auch hier die Willkommens-Weiche - sonst umgeht /leaderboard den Start.
  //
  // Dieselbe Schale wie der Beraterbereich: der Wettbewerb ist kein zweites
  // Programm, sondern ein Punkt in derselben Navigation.
  const user = await requireOnboardedUser();
  return <AppShell user={user}>{children}</AppShell>;
}
