"use client";
import { useAssistant } from "./AssistantProvider";
import { EXECUTION_MODES, type AiExecutionMode } from "@/lib/ai-crm/contracts";

export default function AssistantPermissions() {
  const assistant = useAssistant();
  if (!assistant.access?.executionModesEnabled) return null;
  const mode = assistant.active?.executionMode ?? "CONFIRM";
  return <label className="assistant-permissions">
    <span>Zugriffe</span>
    <select aria-label="Jarvis Zugriffe" value={mode} disabled={assistant.policyBusy || assistant.loading || assistant.working && !assistant.active} onChange={event => void assistant.changeExecutionMode(event.target.value as AiExecutionMode)} title={EXECUTION_MODES[mode].description}>
      {Object.entries(EXECUTION_MODES).map(([value, option]) => <option key={value} value={value}>{option.label}</option>)}
    </select>
    <span className="sr-only">{EXECUTION_MODES[mode].description}</span>
  </label>;
}
