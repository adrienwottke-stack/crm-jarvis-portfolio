import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "@/components/icons";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { eigene } from "@/lib/scope";
import ContactForm from "@/components/ContactForm";
import { pageTitle, columnNarrow } from "@/components/ui";
import VorfuehrVerdeckt from "@/components/VorfuehrVerdeckt";
import GpName from "@/components/GpName";
import KontaktMehr from "@/components/contacts/KontaktMehr";
import { updateContact } from "../../actions";
import { contactHref, contactListReturn } from "@/lib/contact-navigation";

export default async function EditContactPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const { id } = await params;
  const returnTo = contactListReturn((await searchParams).returnTo);
  const user = await requireUser();
  const contact = await prisma.contact.findFirst({
    where: { id, ...eigene(user.id).kontakte },
    include: {
      _count: { select: { activities: true, referrals: true } },
    },
  });

  if (!contact) {
    notFound();
  }

  return (
    <div className={`${columnNarrow} crm-record-edit`} data-contact-id={contact.id} data-contact-name={contact.name}>
      <div>
        <Link
          href={contactHref(contact.id, returnTo)}
          className="crm-record-return"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          <span>Zurück zu <GpName name={contact.name} /></span>
        </Link>
        <h1 className={`${pageTitle} mt-2`}>Kontakt bearbeiten</h1>
      </div>
      <VorfuehrVerdeckt hinweis="Die Kontaktdaten sind im Vorführmodus ausgeblendet."><ContactForm
        action={updateContact}
        contact={contact}
        returnTo={returnTo}
        submitLabel="Änderungen speichern"
      /></VorfuehrVerdeckt>
      <div className="crm-record-primary-actions"><KontaktMehr contactId={contact.id} contactName={contact.name} activityCount={contact._count.activities} referralCount={contact._count.referrals}><Link href={contactHref(contact.id, returnTo)} className="inline-flex min-h-11 items-center text-sm text-link">Zum Kontakt</Link></KontaktMehr></div>
    </div>
  );
}
