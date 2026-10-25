import Link from "next/link";
import { ArrowLeftIcon } from "@/components/icons";
import ContactForm from "@/components/ContactForm";
import { pageTitle, columnNarrow } from "@/components/ui";
import { createContact } from "../actions";
import { contactListReturn } from "@/lib/contact-navigation";

export default async function NewContactPage({ searchParams }: { searchParams: Promise<{ liste?: string; returnTo?: string }> }) {
  const { liste, returnTo } = await searchParams;
  const listKind = liste === "RECRUITING" ? "RECRUITING" : "VERKAUF";
  const backHref = contactListReturn(returnTo ?? `/namen?liste=${listKind}`);
  return (
    <div className={`${columnNarrow} space-y-6`}>
      <div>
        <Link
          href={backHref}
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-ink-muted transition hover:text-ink"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Zur Namensliste
        </Link>
        <h1 className={`${pageTitle} mt-2`}>Neuer Kontakt</h1>
      </div>
      <ContactForm action={createContact} listKind={listKind} returnTo={backHref} submitLabel="Kontakt anlegen" />
    </div>
  );
}
