"use client";

import { btnPrimary } from "@/components/ui";

export default function Error({ reset }: { reset: () => void }) {
  return <section className="crm-contact-empty" role="alert"><h1>Kontakte konnten nicht geladen werden</h1><p>Deine Suche und Filter bleiben in der Adresse erhalten. Lade diese Ansicht erneut.</p><button type="button" onClick={reset} className={btnPrimary}>Erneut versuchen</button></section>;
}
