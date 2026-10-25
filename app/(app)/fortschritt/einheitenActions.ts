"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { verschiebeEinheitenErinnerung } from "@/lib/einheiten-erinnerung";

export async function einheitenSpaeter(
  erinnerungId: string,
  tag?: string,
): Promise<{ ok: boolean; fehler?: string }> {
  const user = await requireUser();
  try {
    await verschiebeEinheitenErinnerung(user.id, erinnerungId, tag);
    revalidatePath("/heute");
    revalidatePath("/fortschritt");
    revalidatePath("/fortschritt/einheiten-offen");
    return { ok: true };
  } catch {
    return {
      ok: false,
      fehler:
        "Die Erinnerung konnte nicht verschoben werden. Bitte versuche es erneut.",
    };
  }
}
