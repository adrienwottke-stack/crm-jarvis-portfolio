import { requireOnboardedUser } from "@/lib/auth";
import AppShell from "@/components/AppShell";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Wer den Start noch nie gesehen hat, wird von hier einmalig nach
  // /willkommen geschickt - die Route liegt in ihrer eigenen Gruppe und
  // laeuft deshalb nicht durch dieses Layout.
  const user = await requireOnboardedUser();
  return <AppShell user={user}>{children}</AppShell>;
}
