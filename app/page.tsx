import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { entryRoute } from "@/lib/start/entry";

export default async function Home() {
  // Startseite ist die Arbeitsliste, nicht die Auswertung.
  const user = await currentUser();
  redirect(user ? await entryRoute(user.id) : "/login");
}
