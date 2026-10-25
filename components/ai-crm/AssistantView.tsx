"use client";
import { useEffect, useRef, useState } from "react";
import { useAssistant } from "@/components/ai-crm/AssistantProvider";
import AssistantComposer from "@/components/ai-crm/AssistantComposer";
import AssistantTimeline from "@/components/ai-crm/AssistantTimeline";
import JarvisLive from "@/components/ai-crm/JarvisLive";
import AssistantIcon from "./AssistantIcon";
import Link from "next/link";
import ArbeitsDialog from "@/components/ArbeitsDialog";
import MemoryManager from "@/components/memory/MemoryManager";
import { ASSISTANT_PANEL_MIN_WIDTH } from "@/lib/assistant-layout";

function conversationLabel(item: { title: string; updatedAt: string }): string {
  if (!/^(Live mit Jarvis|Sprachgespräch mit Jarvis|Neues Gespräch)$/i.test(item.title.trim())) return item.title;
  return `${item.title} · ${new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(item.updatedAt))}`;
}

export function AssistantConversationList({ disabled = false, onSelect }: { disabled?: boolean; onSelect?: () => void }) {
  const assistant = useAssistant();
  const [loading, setLoading] = useState(false);
  const day = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  const today = day(new Date());
  const yesterday = day(new Date(Date.now() - 86400000));
  const groups = Map.groupBy([...assistant.conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), item => {
    const value = day(new Date(item.updatedAt));
    return value === today ? "Heute" : value === yesterday ? "Gestern" : "Letzte 7 Tage";
  });
  const locked = disabled || assistant.locked || assistant.loading;
  return <div className="assistant-conversation-list">
    <button className="assistant-new-conversation" disabled={locked} onClick={() => { assistant.startNew(); onSelect?.(); }}><AssistantIcon name="compose" />Neuer Chat</button>
    <h2 className="sr-only">Unterhaltungen</h2>
    {[...groups].map(([label, items]) => <section key={label}><h3>{label}</h3>{items.map(item => <div className="assistant-conversation-row" key={item.id}>
      <button disabled={locked} aria-current={assistant.conversationId === item.id ? "true" : undefined} title={conversationLabel(item)} onClick={() => { void assistant.selectConversation(item.id); onSelect?.(); }}><strong>{conversationLabel(item)}</strong></button>
      <details className="assistant-conversation-menu" onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}>
        <summary aria-label={"Optionen für " + item.title}><AssistantIcon name="more" /></summary>
        <div className="assistant-conversation-popover"><p>Verfügbar bis {new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(item.expiresAt))}</p><button disabled={locked} onClick={event => { event.currentTarget.closest("details")!.open = false; assistant.setDeleteTarget(item); }} aria-label={"Unterhaltung löschen: " + item.title}><AssistantIcon name="trash" />Unterhaltung löschen</button></div>
      </details>
    </div>)}</section>)}
    {assistant.nextCursor && <button disabled={loading} onClick={async () => { setLoading(true); try { await assistant.loadList(assistant.nextCursor!); } catch { assistant.setError("Weitere Unterhaltungen konnten nicht geladen werden."); } finally { setLoading(false); } }}>{loading ? "Wird geladen …" : "Weitere laden"}</button>}
    {!assistant.conversations.length && <p className="assistant-caption assistant-list-empty">Hier findest du deine Gespräche.</p>}
  </div>;
}

function Details() {
  const assistant = useAssistant();
  const access = assistant.access;
  return <div className="assistant-details"><h2>Speicherung und Zugang</h2><h3>Deine Unterhaltungen</h3><p>Gespräche bleiben sieben Tage ab Beginn verfügbar. Weitere Nachrichten verlängern diese Zeit nicht.</p>{assistant.active && <p>Verfügbar bis {new Intl.DateTimeFormat("de-DE", { dateStyle: "long", timeStyle: "short" }).format(new Date(assistant.active.expiresAt))}.</p>}<p>Nach dem Ablauf wird das Gespräch nicht mehr verwendet und automatisch bereinigt. Gespeicherte Kontakte, Notizen und Wiedervorlagen bleiben im CRM.</p><p>Eine Unterhaltung enthält höchstens 20 Nachrichten, also normalerweise zehn Fragen und Antworten. Danach beginnt ein neues Gespräch ohne den alten Kontext.</p><h3>Diktieren</h3><p>Audio wird in der Anwendung nicht dauerhaft gespeichert. Das Transkript wird kurzzeitig für eine sichere Wiederholung vorgehalten. Erst mit „Senden“ wird es an den Chat übergeben.</p><h3>Nutzung und Zugang</h3>{access && <><p>{access.monthlyRequests} von {access.monthlyRequestLimit} Anfragen in diesem Monat · {Math.ceil(access.monthlyAudioSeconds / 60)} von {Math.ceil(access.monthlyAudioSecondsLimit / 60)} Sprachminuten.</p>{access.hasBillingAccount && <button disabled={assistant.billing} onClick={() => void assistant.openBilling("portal")}>Abo verwalten</button>}{!access.enabled && access.reason === "NO_ENTITLEMENT" && access.billingConfigured && <button className="assistant-primary" disabled={assistant.billing} onClick={() => void assistant.openBilling("checkout")}>Zugang für {access.priceLabel}/Monat ansehen</button>}</>}{assistant.active && <button className="assistant-delete-link" disabled={assistant.locked} onClick={() => assistant.setDeleteTarget(assistant.active)}>Diese Unterhaltung löschen</button>}</div>;
}

function DeleteDialog() {
  const assistant = useAssistant();
  const { deleteTarget, setError } = assistant;
  const dialog = useRef<HTMLDialogElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!deleteTarget) return;
    setError(null);
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal(); keep.current?.focus();
    return () => { element?.close(); if (previous?.isConnected) previous.focus(); };
  }, [deleteTarget, setError]);
  if (!deleteTarget) return null;
  return <dialog className="assistant-delete-dialog" ref={dialog} aria-labelledby="assistant-delete-title" onCancel={() => assistant.setDeleteTarget(null)}><h2 id="assistant-delete-title">Unterhaltung löschen?</h2><p>„{assistant.deleteTarget?.title}“</p><p>Das Gespräch wird gelöscht. Bereits gespeicherte CRM-Änderungen bleiben erhalten.</p>{assistant.error && <p className="assistant-error" role="alert">{assistant.error}</p>}<div className="assistant-button-row"><button ref={keep} disabled={assistant.actionBusy === "delete"} onClick={() => assistant.setDeleteTarget(null)}>Behalten</button><button className="assistant-danger" disabled={assistant.actionBusy === "delete"} onClick={() => void assistant.removeConversation()}>{assistant.actionBusy === "delete" ? "Wird gelöscht …" : "Unterhaltung löschen"}</button></div></dialog>;
}

export default function AssistantView() {
  const assistant = useAssistant();
  const header = useRef<HTMLHeadingElement>(null);
  const navigation = useRef<HTMLElement>(null);
  const navToggle = useRef<HTMLButtonElement>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [wideDesktop, setWideDesktop] = useState(false);
  const [liveOpen, setLiveOpen] = useState(false);
  const { setLiveActive } = assistant;
  useEffect(() => { setLiveActive(liveOpen); }, [liveOpen, setLiveActive]);
  useEffect(() => () => setLiveActive(false), [setLiveActive]);
  const empty = !assistant.entries.length && !assistant.loading;
  useEffect(() => { header.current?.focus({ preventScroll: true }); try { setSidebarOpen(localStorage.getItem("crm-jarvis-sidebar") !== "closed"); } catch {} }, []);
  useEffect(() => {
    const media = window.matchMedia(`(min-width: ${ASSISTANT_PANEL_MIN_WIDTH}px)`);
    const sync = () => {
      setWideDesktop(media.matches);
      setDrawerOpen(false);
      if (navigation.current?.contains(document.activeElement)) navToggle.current?.focus();
    };
    sync(); media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  useEffect(() => { if (drawerOpen) navigation.current?.querySelector<HTMLButtonElement>("button")?.focus(); }, [drawerOpen]);
  const closeDrawer = () => { setDrawerOpen(false); navToggle.current?.focus(); };
  const toggleNavigation = () => {
    if (assistant.mode === "workspace" && window.innerWidth >= ASSISTANT_PANEL_MIN_WIDTH) setSidebarOpen(value => { const next = !value; try { localStorage.setItem("crm-jarvis-sidebar", next ? "open" : "closed"); } catch {} return next; });
    else setDrawerOpen(value => !value);
  };
  return <div className="assistant-layout" data-sidebar-open={sidebarOpen} data-drawer-open={drawerOpen}>
    {drawerOpen && <button className="assistant-nav-scrim" onClick={closeDrawer} aria-label="Unterhaltungen schließen" tabIndex={-1} />}
    <nav ref={navigation} className="assistant-workspace-list" aria-label="Unterhaltungen" onKeyDown={event => {
      if (!drawerOpen) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeDrawer(); }
      if (event.key === "Tab") {
        const items = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), summary')].filter(item => item.getClientRects().length);
        const first = items[0], last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <div className="assistant-sidebar-top"><span>Chats</span><button className="assistant-icon-button" aria-label="Unterhaltungen schließen" title="Unterhaltungen schließen" onClick={() => { if (drawerOpen) closeDrawer(); else { setSidebarOpen(false); try { localStorage.setItem("crm-jarvis-sidebar", "closed"); } catch {} navToggle.current?.focus(); } }}><AssistantIcon name="sidebar" /></button></div>
      <AssistantConversationList disabled={liveOpen} onSelect={() => { assistant.setSection("chat"); if (drawerOpen) closeDrawer(); }} />
      <button className="assistant-workspace-details" disabled={liveOpen} onClick={() => { assistant.setSection("details"); if (drawerOpen) closeDrawer(); }}><AssistantIcon name="info" />Speicherung und Zugang</button>
    </nav>
    <section className="assistant-view" aria-label="CRM-Assistent" inert={drawerOpen}>
      <header className="assistant-header">
        <button className="assistant-mobile-back assistant-icon-button" onClick={assistant.close} aria-label="Zurück zum CRM" title="Zurück zum CRM"><AssistantIcon name="back" /></button>
        <button ref={navToggle} className="assistant-icon-button assistant-nav-toggle" onClick={toggleNavigation} aria-label="Unterhaltungen öffnen" title="Unterhaltungen" aria-expanded={drawerOpen || (wideDesktop && assistant.mode === "workspace" && sidebarOpen)}><AssistantIcon name="sidebar" /></button>
        <h2 ref={header} tabIndex={-1} title={assistant.active ? conversationLabel(assistant.active) : "Jarvis"}>{assistant.active ? conversationLabel(assistant.active) : "Jarvis"}</h2>
        <div className="assistant-header-actions">
          {!(drawerOpen || (wideDesktop && assistant.mode === "workspace" && sidebarOpen)) && <button className="assistant-icon-button" disabled={liveOpen || assistant.locked || assistant.loading} onClick={assistant.startNew} aria-label="Neue Unterhaltung" title="Neuer Chat"><AssistantIcon name="compose" /></button>}
          <button className="assistant-expand assistant-icon-button" onClick={() => assistant.mode === "workspace" ? assistant.asPanel() : assistant.expand()} aria-label={assistant.mode === "workspace" ? "Als Panel öffnen" : "Groß öffnen"} title={assistant.mode === "workspace" ? "Als Panel öffnen" : "Groß öffnen"}><AssistantIcon name={assistant.mode === "workspace" ? "collapse" : "expand"} /></button>
          <button className="assistant-icon-button" disabled={liveOpen} onClick={() => assistant.setSection(assistant.section === "details" ? "chat" : "details")} aria-label="Speicherung und Zugang" title="Speicherung und Zugang"><AssistantIcon name="more" /></button>
          <button className="assistant-desktop-close assistant-icon-button" onClick={assistant.close} aria-label="Assistent schließen" title="Assistent schließen"><AssistantIcon name="close" /></button>
        </div>
      </header>
      {assistant.section !== "chat" && <button className="assistant-back-to-chat" onClick={() => assistant.setSection("chat")}><AssistantIcon name="back" />Zurück zum Gespräch</button>}
      {assistant.error && !assistant.deleteTarget && <div className="assistant-error-banner" role="alert"><p>{assistant.error}</p>{!assistant.access && <button onClick={() => void assistant.initialize()}>Erneut versuchen</button>}</div>}
      {assistant.section === "details" && <Details />}
      {assistant.section === "details" && <button className="assistant-back-to-chat" disabled={liveOpen} onClick={() => assistant.setMemoryOpen(true)}>Bestätigte Erinnerung verwalten</button>}
      <div className="assistant-chat" hidden={assistant.section !== "chat"} data-empty={empty && !liveOpen}>
        {!assistant.access ? <p className="assistant-loading" role="status">Assistent wird geöffnet …</p> : !assistant.access.enabled ? <div className="assistant-access"><h3>{assistant.access.reason === "NO_ENTITLEMENT" ? "Der Assistent ist für dein Konto noch nicht freigeschaltet." : assistant.access.reason?.startsWith("MONTHLY") ? "Dein Nutzungslimit ist erreicht." : "Der Assistent ist vorübergehend nicht verfügbar."}</h3><p>Du kannst im CRM normal weiterarbeiten.</p><div className="assistant-button-row"><button className="assistant-primary" onClick={assistant.close}>Zurück zum CRM</button><button onClick={() => assistant.setSection("details")}>Zugang ansehen</button></div></div> : <>
          {assistant.attachment && <div className="assistant-context"><span>Bezug: <strong>{assistant.attachment.label}</strong>{assistant.attachment.followUpId && " · Wiedervorlage"}</span><button disabled={assistant.working || liveOpen} onClick={() => { assistant.setAttachment(null); assistant.setWorkTask(null); }} aria-label="Bezug entfernen"><AssistantIcon name="close" /></button></div>}
          {assistant.workTask && <div className="assistant-context"><span>Kontaktarbeit: <strong>{assistant.workTask.title}</strong>{assistant.attachment?.contactId && <Link href={`/contacts/${encodeURIComponent(assistant.attachment.contactId)}#kontaktarbeit`} onClick={assistant.close}>Ergebnis am Kontakt prüfen</Link>}</span><button disabled={assistant.working || liveOpen} onClick={() => assistant.setWorkTask(null)} aria-label="Arbeitsbezug lösen"><AssistantIcon name="close" /></button></div>}
          <div className="assistant-empty" hidden={!empty || liveOpen}><h2>Womit legen wir los?</h2></div>
        <AssistantTimeline liveActive={liveOpen} />
          <div className="assistant-composer-dock">
            {assistant.access.liveAvailable ? <JarvisLive conversationId={assistant.conversationId} context={assistant.attachment} workTaskId={assistant.workTask?.id} disabled={assistant.locked || assistant.loading} onActiveChange={setLiveOpen} onTranscript={assistant.acceptLiveTranscript} onConversationStarted={assistant.acceptLiveConversation} onTurn={assistant.acceptLiveTurn}>
              {controls => <AssistantComposer suspended={controls.active} onStartLive={controls.start} liveDisabled={controls.disabled} toolsDisabled={controls.initializing} />}
            </JarvisLive> : <AssistantComposer />}
          </div>
        </>}
      </div>
    </section>
    <DeleteDialog />
    <ArbeitsDialog open={assistant.memoryOpen} onClose={() => assistant.setMemoryOpen(false)} title="Bestätigte Jarvis-Erinnerung">
      {assistant.memoryOpen && <MemoryManager key={assistant.access?.userId ?? "current"} compact sources={{ contact: assistant.attachment?.contactId ? { id: assistant.attachment.contactId, label: assistant.attachment.label } : undefined, conversation: assistant.active ? { id: assistant.active.id, label: conversationLabel(assistant.active) } : undefined }} />}
    </ArbeitsDialog>
  </div>;
}
