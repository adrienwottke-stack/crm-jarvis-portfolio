import { findRelease } from "@/lib/releases/catalog";

/** Allowlisted notification return path; never accept arbitrary login redirects. */
export function releaseReturnTarget(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/neuigkeiten?") || value.length > 300) return null;
  try {
    const url = new URL(value, "https://crm.invalid");
    if (url.origin !== "https://crm.invalid" || url.pathname !== "/neuigkeiten") return null;
    const releaseId = url.searchParams.get("release");
    if (!releaseId || !findRelease(releaseId)) return null;
    const query = new URLSearchParams({ release: releaseId });
    if (url.searchParams.get("opened") === "1") query.set("opened", "1");
    return `/neuigkeiten?${query}`;
  } catch { return null; }
}
