"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

/** Ein Integrationspunkt in AppShell; sichtbarer Einstieg bleibt der vorhandene Suchen-Link. */
export default function SuchTastatur() {
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    const oeffnen = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || !(event.ctrlKey || event.metaKey) || event.altKey || event.isComposing) return;
      event.preventDefault();
      if (pathname === "/suche") document.getElementById("crm-suche")?.focus();
      else router.push("/suche");
    };
    window.addEventListener("keydown", oeffnen);
    return () => window.removeEventListener("keydown", oeffnen);
  }, [pathname, router]);
  return null;
}
