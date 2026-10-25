"use client";

import { useEffect, useRef, type ReactNode } from "react";
import AssistantIcon from "./AssistantIcon";
import AssistantPermissions from "./AssistantPermissions";

/** Presentation only: the mounted live controller continues to own media and requests. */
export default function AssistantVoiceSurface({ active, status, starting = false, muted, canMute, onMute, onInterrupt, onEnd, composer, textContinuation, options, notices, simulation = false }: {
  active: boolean;
  status: string;
  starting?: boolean;
  startDisabled?: boolean;
  muted: boolean;
  canMute: boolean;
  onStart: () => void;
  onMute: () => void;
  onInterrupt: () => void;
  onEnd: () => void;
  composer: ReactNode;
  textContinuation?: ReactNode;
  options: ReactNode;
  notices?: ReactNode;
  simulation?: boolean;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  const surface = useRef<HTMLElement>(null);
  const previousActive = useRef(active);
  const previousStarting = useRef(starting);
  useEffect(() => {
    if (active && !starting && (!previousActive.current || previousStarting.current)) surface.current?.querySelector<HTMLButtonElement>(".assistant-voice-end")?.focus();
    else if (!active && previousActive.current) {
        if (details.current) details.current.open = false;
        surface.current?.querySelector<HTMLButtonElement>(".assistant-live-start")?.focus({ preventScroll: true });
    }
    previousActive.current = active;
    previousStarting.current = starting;
  }, [active, starting]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (details.current?.open && !details.current.contains(event.target as Node)) details.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !details.current?.open) return;
      event.preventDefault(); event.stopPropagation();
      details.current.open = false; details.current.querySelector("summary")?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape, true); };
  }, []);
  return <section ref={surface} className="assistant-voice-surface" aria-label="Chat und Sprache">
    <div hidden={active || starting}>{composer}</div>
    {starting && <div className="assistant-voice-starting" aria-label="Jarvis startet" aria-live="polite">
      <p role="status">{status}</p>
      <button type="button" className="assistant-live-cancel" onClick={onEnd}>Abbrechen</button>
    </div>}
    {active && !starting && <div className="assistant-voice-bar" aria-label="Jarvis Sprache">
      <div className="assistant-voice-status" role="status"><AssistantIcon name="voice" /><span><span>{status}</span>{simulation && <small>Lokale Simulation · kein Audiostream</small>}</span></div>
      <div className="assistant-voice-controls">
        <button type="button" className="assistant-icon-button" disabled={!canMute} onClick={onMute} aria-label={muted ? "Mikrofon einschalten" : "Stumm"} title={muted ? "Mikrofon einschalten" : "Stumm"} aria-pressed={muted}><AssistantIcon name={muted ? "muted" : "mic"} /></button>
        <button type="button" className="assistant-icon-button" disabled={!canMute} onClick={onInterrupt} aria-label="Sprachausgabe unterbrechen" title="Sprachausgabe unterbrechen"><AssistantIcon name="stop" /></button>
        <details ref={details} className="assistant-voice-options" onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); event.preventDefault(); if (details.current) { details.current.open = false; details.current.querySelector("summary")?.focus(); } } }}>
          <summary aria-label="Sprachoptionen" title="Sprachoptionen"><AssistantIcon name="more" /></summary>
          <div className="assistant-voice-popover"><h3>Sprachoptionen</h3>{options}</div>
        </details>
        <button type="button" className="assistant-icon-button assistant-voice-end" onClick={onEnd} aria-label="Sitzung beenden" title="Sitzung beenden"><AssistantIcon name="close" /></button>
      </div>
    </div>}
    {active && !starting && textContinuation && <div className="assistant-live-text-continuation" aria-label="Im Sprachgespräch schreiben">{textContinuation}</div>}
    <div className="assistant-voice-notices">{notices}</div>
    {active && <AssistantPermissions />}
  </section>;
}
