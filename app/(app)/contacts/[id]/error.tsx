"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { contactListReturn } from "@/lib/contact-navigation";
import { btnPrimary, btnSecondary } from "@/components/ui";

export default function Error({ reset }: { reset: () => void }) {
  const params = useSearchParams();
  return <section className="crm-contact-empty" role="alert"><h1>Kontakt konnte nicht geladen werden</h1><p>Lade den Kontakt erneut oder kehre zu deiner Liste zurück.</p><button type="button" onClick={reset} className={btnPrimary}>Erneut versuchen</button><Link href={contactListReturn(params.get("returnTo"))} className={btnSecondary}>Kontaktliste öffnen</Link></section>;
}
