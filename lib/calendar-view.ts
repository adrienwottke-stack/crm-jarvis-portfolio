import { cache } from "react";
import { cookies, headers } from "next/headers";
import { calendarView } from "@/lib/navigation";

/** Shell and calendar resolve the same remembered/default view on the server. */
export const defaultCalendarView = cache(async () => {
  const [saved, request] = await Promise.all([cookies(), headers()]);
  const mobile = request.get("sec-ch-ua-mobile") === "?1" || /Android|iPhone|iPod|Mobile/i.test(request.get("user-agent") ?? "");
  return calendarView(null, saved.get("kalender_ansicht")?.value, mobile);
});
