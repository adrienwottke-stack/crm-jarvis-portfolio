"use client";
import { useAssistant } from "@/components/ai-crm/AssistantProvider";
import type { AssistantContext } from "@/lib/ai-crm/contracts";
import { currentContactContext } from "./AssistantPageReference";
export function AssistantSymbol() { return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-5 w-5"><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l-3 3V11.5A7.5 7.5 0 0 1 9.5 4h3a7.5 7.5 0 0 1 7.5 7.5Z"/><path d="M7 10h8M7 14h5"/></svg>; }
export default function AssistantEntry() {
  const assistant = useAssistant();
  return <button type="button" className="assistant-global-entry" aria-expanded={assistant.visible} aria-controls="crm-assistant-surface" disabled={assistant.presenting} onClick={() => assistant.visible ? assistant.close() : assistant.open({ context: assistant.attachment ?? currentContactContext() })}><AssistantSymbol /><span>Jarvis</span></button>;
}
export function AssistantTodayEntry() {
  const assistant = useAssistant();
  if (assistant.presenting) return null;
  return <button type="button" className="assistant-today-entry crm-assistant-compact" onClick={() => assistant.open()}><AssistantSymbol /><span><strong>Mit Jarvis sprechen</strong></span><span aria-hidden>↗</span></button>;
}
export function AssistantContextEntry({ context, prompt, appendPrompt = false, label = "Mit Assistent besprechen" }: { context?: AssistantContext; prompt?: string; appendPrompt?: boolean; label?: string }) {
  const assistant = useAssistant();
  if (assistant.presenting) return null;
  return <button type="button" className="assistant-context-entry" disabled={assistant.locked} onClick={() => { assistant.open({ context, prompt: appendPrompt ? undefined : prompt }); if (appendPrompt && prompt) assistant.setDraft(current => current ? `${current}\n\n${prompt}` : prompt); }}><AssistantSymbol />{label}</button>;
}
