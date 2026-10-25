import { requireOnboardedUser } from "@/lib/auth";
import { suchfunktionen } from "@/lib/suche/service";
import Suche from "@/components/suche/Suche";

export const dynamic = "force-dynamic";

export default async function SuchePage() {
  const user = await requireOnboardedUser();
  return <Suche userId={user.id} funktionen={await suchfunktionen(user)} />;
}
