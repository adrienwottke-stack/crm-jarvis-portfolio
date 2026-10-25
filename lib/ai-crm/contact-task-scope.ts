import type { PrismaClient } from "@/lib/generated/prisma/client";
import { AiCrmError } from "@/lib/ai-crm/errors";

type ContactReference = { id: string; name: string };
type ScopeInput = {
  userId: string;
  message: string;
  selectedContact: ContactReference | null | undefined;
  toolName: string;
  arguments: Record<string, unknown>;
};

const words = (value: string): string[] => value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("de-DE").match(/[\p{L}\p{N}]+/gu) ?? [];
function containsReference(message: string, value: string) {
  const needle = words(value).join(" ");
  return Boolean(needle && ` ${words(message).join(" ")} `.includes(` ${needle} `));
}
function namesContact(message: string, contact: ContactReference, selected: ContactReference) {
  const name = words(contact.name);
  const selectedName = words(selected.name);
  const firstName = name[0];
  return containsReference(message, contact.id)
    || Boolean(name.length > 1 && name.join(" ") !== selectedName.join(" ") && containsReference(message, contact.name))
    || Boolean(firstName && firstName.length > 1 && firstName !== selectedName[0] && words(message).includes(firstName));
}

/** A singular reference belongs to the current selection, never to a name in old history. */
export async function assertContactTaskScope(db: Pick<PrismaClient, "contact">, input: ScopeInput) {
  const selected = input.selectedContact;
  if (!selected) return;
  // CRM-wide questions and explicit multi-contact requests retain their existing scope.
  if (/\b(?:kontakte[n]?|personen|kunden)\b/iu.test(input.message)) return;
  const singularReference = /\b(?:ihm|ihn|ihr|er|sie|seine?|ihre?)\b|\bausgewählt[a-zäöüß]*\b|\baktuell[a-zäöüß]*\s+(?:kontakt|person)|\b(?:dieser|diesen|diesem|diese)\s+(?:kontakt|person|anruf|gespräch)\b/iu.test(input.message);
  const selectedFirstName = words(selected.name)[0];
  const selectedReference = containsReference(input.message, selected.id) || containsReference(input.message, selected.name)
    || Boolean(selectedFirstName && selectedFirstName.length > 1 && words(input.message).includes(selectedFirstName));
  if (!singularReference && !selectedReference) return;
  const mismatch = () => new AiCrmError("CONTEXT_MISMATCH", `Die aktuelle Anfrage bezieht sich eindeutig auf den ausgewählten Kontakt ${selected.name} (${selected.id}). Verwende diesen Bezug für Pronomen und fahre mit diesem Kontakt fort; wegen älterer Chatnamen ist keine erneute Personenklärung nötig. Namen aus älterer Gesprächshistorie sind kein neuer Kontaktauftrag; einen anderen Kontakt muss die aktuelle Anfrage ausdrücklich benennen.`, 409);

  if (input.toolName === "search_contacts" && typeof input.arguments.query === "string") {
    const query = input.arguments.query;
    const selectedName = words(selected.name).join(" ");
    const queryName = words(query).join(" ");
    if (queryName && !selectedName.includes(queryName) && !namesContact(input.message, { id: query, name: query }, selected)) throw mismatch();
  }
  const directContactId = typeof input.arguments.contactId === "string" ? input.arguments.contactId : null;
  const fields = input.toolName === "execute_crm_operation" && Array.isArray(input.arguments.fields)
    ? input.arguments.fields as Array<{ name?: string; value?: unknown }> : [];
  const contactIds = [directContactId, ...fields.filter(field => field.name === "contactId" && typeof field.value === "string").map(field => field.value as string)];
  for (const contactId of contactIds) {
    if (!contactId || contactId === selected.id || contactId.startsWith("pending:")) continue;
    const contact = await db.contact.findFirst({ where: { id: contactId, ownerId: input.userId }, select: { id: true, name: true } });
    if (!contact) throw new AiCrmError("CONTACT_NOT_FOUND", "Diesen Kontakt kann ich in deinen eigenen CRM-Daten nicht öffnen.", 404);
    if (!namesContact(input.message, contact, selected)) throw mismatch();
  }
}
