"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useAssistant } from "./AssistantProvider";
import type { AssistantContext } from "@/lib/ai-crm/contracts";

export function currentContactContext(): AssistantContext | undefined {
  const contact = document.querySelector<HTMLElement>("#hauptinhalt [data-contact-id]");
  return contact?.dataset.contactId ? { contactId: contact.dataset.contactId, label: contact.dataset.contactName ?? "Aktueller Kontakt" } : undefined;
}

export default function AssistantPageReference({ disabled }: { disabled: boolean }) {
  const assistant = useAssistant();
  const pathname = usePathname();
  const [context, setContext] = useState<AssistantContext>();
  useEffect(() => {
    const sync = () => setContext(currentContactContext());
    sync();
    const main = document.getElementById("hauptinhalt");
    const observer = new MutationObserver(sync);
    if (main) observer.observe(main, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-contact-id", "data-contact-name"] });
    return () => observer.disconnect();
  }, [pathname]);
  const { attachment, setAttachment } = assistant;
  useEffect(() => {
    if (context && attachment && attachment.contactId === context.contactId && attachment.label !== context.label) {
      setAttachment({ ...attachment, label: context.label });
    }
  }, [context, attachment, setAttachment]);
  if (!context || assistant.attachment?.contactId === context.contactId) return null;
  return <div className="crm-assistant-context-page"><p>Geöffnet: <strong>{context.label}</strong></p><button disabled={disabled} onClick={() => assistant.setAttachment(context)}>Diesen Kontakt verwenden</button></div>;
}
