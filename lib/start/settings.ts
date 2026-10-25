import { featureStates } from "@/lib/features";
import { startFeatures } from "@/lib/start/model";

export async function startOptions() {
  return startFeatures(await featureStates());
}
