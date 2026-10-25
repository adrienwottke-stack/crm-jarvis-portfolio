import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isListKind } from "@/lib/namelist";
import { redirect } from "next/navigation";
import { prepareCalls } from "@/lib/start/service";
import { startOptions } from "@/lib/start/settings";
import StartAnrufe from "@/components/StartAnrufe";
import { columnNarrow } from "@/components/ui";

export const dynamic="force-dynamic";
export default async function StartklarPage({searchParams}:{searchParams:Promise<{liste?:string}>}) {
  const user=await requireUser(); const {liste}=await searchParams;
  const kind=liste && isListKind(liste) ? liste : user.startTrack;
  if(!kind) redirect("/namen/sammeln");
  const [initial,state,options]=await Promise.all([prepareCalls(prisma,user.id,kind),prisma.startProgress.findUnique({where:{userId:user.id}}),startOptions()]);
  return <div className={columnNarrow}><StartAnrufe kind={kind} initial={initial} guided={options.guidance && !!state && state.phase !== "DONE" && state.kind === kind} /></div>;
}
