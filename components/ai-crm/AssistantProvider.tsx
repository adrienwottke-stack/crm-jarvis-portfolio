"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useVorfuehren } from "@/components/VorfuehrProvider";
import type { AiExecutionMode, ActionReceipt, AssistantAccess, AssistantContext, ConversationSummary, Entry, ReadResult } from "@/lib/ai-crm/contracts";
import { assistantRecoveryFailureMessage } from "@/lib/ai-crm/errors";
import type { LiveCaption } from "@/lib/ai-crm/live-captions";
import { mergeLiveSpeech } from "@/lib/ai-crm/live-timeline";
import { assistantIsFull } from "@/lib/assistant-layout";

type SendBody = { message: string; source: "text" | "voice"; conversationId?: string; clientRequestId: string; workTaskId?: string; context?: Omit<AssistantContext, "label"> };
export type AssistantWorkTask = { id: string; title: string };
type Reply = { answer: string; requestId: string; actions: ActionReceipt[]; results?: ReadResult[]; conversation: ConversationSummary & { restartReason?: string | null } };
type Recovery = { body: SendBody; status: string; error?: string };
type LiveConversation = ConversationSummary & { restarted?: boolean; restartReason?: "expired" | "limit" | null };
type LiveTurn = { requestId: string; transcript: string; answer: string; actions: ActionReceipt[]; results?: ReadResult[]; conversation: LiveConversation; nativeSpeech?: boolean; inputInTranscript?: boolean };
export class AssistantHttpError extends Error { constructor(message: string, public code: string, public status: number, public requestId?: string) { super(message); } }
export async function assistantFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new AssistantHttpError(data.error ?? "Das hat gerade nicht geklappt. Bitte versuche es erneut.", data.code ?? "UNKNOWN", response.status, data.requestId);
  return data as T;
}
const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

function useController() {
  const router = useRouter();
  const pathname = usePathname();
  const currentPath = useRef(pathname);
  currentPath.current = pathname;
  const returnTo = useRef("/heute");
  const { aktiv: presenting } = useVorfuehren();
  const [mode, setMode] = useState<"closed" | "panel" | "workspace">("closed");
  const [section, setSection] = useState<"chat" | "conversations" | "details">("chat");
  const [access, setAccess] = useState<AssistantAccess | null>(null);
  const [policyBusy, setPolicyBusy] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState("");
  const [source, setSource] = useState<"text" | "voice">("text");
  const [attachment, setAttachment] = useState<AssistantContext | null>(null);
  const [workTask, setWorkTask] = useState<AssistantWorkTask | null>(null);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [liveActive, setLiveActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<ConversationSummary | null>(null);
  const [billing, setBilling] = useState(false);
  const [captureEpoch, setCaptureEpoch] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const drafts = useRef(new Map<string, { text: string; source: "text" | "voice"; attachment: AssistantContext | null; workTask: AssistantWorkTask | null }>());
  const activeRequest = useRef<SendBody | null>(null);
  const initialized = useRef(false);
  const initialization = useRef<Promise<void> | null>(null);
  const initializationVersion = useRef(0);
  const openVersion = useRef(0);
  const owner = useRef<string | null>(null);
  const previousPath = useRef(pathname);
  const viewNavigation = useRef<string | null>(null);
  const loadVersion = useRef(0);
  const opener = useRef<HTMLElement | null>(null);
  const active = conversations.find(item => item.id === conversationId) ?? null;
  const locked = working || policyBusy || Boolean(recovery) || Boolean(actionBusy);
  const visible = mode !== "closed" && !presenting;

  const close = useCallback(() => {
    openVersion.current++; setMemoryOpen(false);
    setMode("closed"); setCaptureEpoch(value => value + 1);
    if (currentPath.current === "/assistent") router.replace(returnTo.current, { scroll: false });
    requestAnimationFrame(() => opener.current?.isConnected && opener.current.focus({ preventScroll: true }));
  }, [router]);
  useEffect(() => { if (presenting) close(); }, [presenting, close]);
  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    const viewOnly = viewNavigation.current === pathname;
    viewNavigation.current = null;
    if (viewOnly) return;
    setCaptureEpoch(value => value + 1);
    if (pathname !== "/assistent" && assistantIsFull(mode, window.innerWidth)) setMode("closed");
  }, [pathname, mode]);

  const register = useCallback((userId: string) => {
    if (owner.current === userId) return;
    // The first registration can follow an already hydrated entry click.
    // Only an actual account change resets an open, initializing assistant.
    if (owner.current === null) { owner.current = userId; return; }
    owner.current = userId; initialized.current = false; initialization.current = null; initializationVersion.current++; loadVersion.current++; openVersion.current++;
    setActionBusy(null); setActionErrors({}); setNotice(null); setCaptureEpoch(value => value + 1);
    setAccess(null); setConversations([]); setEntries([]); setConversationId(null); setDraft(""); setAttachment(null); setWorkTask(null); setMemoryOpen(false); setLiveActive(false); setError(null); setRecovery(null); setWorking(false); setMode("closed"); drafts.current.clear(); activeRequest.current = null;
  }, []);

  const loadList = useCallback(async (cursor?: string) => {
    const requestedOwner = owner.current;
    const data = await assistantFetch<{ conversations: ConversationSummary[]; nextCursor: string | null }>(`/api/ai-crm/conversations${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
    if (requestedOwner !== owner.current) return [];
    setConversations(current => cursor ? [...current, ...data.conversations.filter(item => !current.some(old => old.id === item.id))] : data.conversations);
    setNextCursor(data.nextCursor);
    return data.conversations;
  }, []);

  const loadConversation = useCallback(async (id: string) => {
    const version = ++loadVersion.current;
    setLoading(true); setError(null);
    try {
      const data = await assistantFetch<ConversationSummary & { messages: Entry[]; context?: AssistantContext }>(`/api/ai-crm/conversations/${encodeURIComponent(id)}`);
      if (version !== loadVersion.current) return;
      setConversationId(id); setEntries(data.messages); setScrollTop(-1); setNotice("Frühere Antworten beziehen sich auf den Zeitpunkt des Gesprächs.");
      if (data.context) setAttachment(data.context);
      setConversations(current => [{ id: data.id, executionMode: data.executionMode, executionVersion: data.executionVersion, title: data.title, expiresAt: data.expiresAt, updatedAt: data.updatedAt, messageCount: data.messageCount }, ...current.filter(item => item.id !== id)]);
    } catch (reason) { if (version === loadVersion.current) setError(reason instanceof Error ? reason.message : "Die Unterhaltung konnte nicht geladen werden."); }
    finally { if (version === loadVersion.current) setLoading(false); }
  }, []);

  const changeExecutionMode = useCallback(async (executionMode: AiExecutionMode) => {
    if (policyBusy || working && !active || !access?.executionModesEnabled) return;
    const requestedOwner = owner.current;
    const navigation = loadVersion.current;
    setPolicyBusy(true); setError(null);
    try {
      let target = active;
      if (!target) {
        target = await assistantFetch<ConversationSummary>("/api/ai-crm/conversations", post({}));
        if (requestedOwner !== owner.current || navigation !== loadVersion.current) return;
        setConversationId(target.id);
        const created = target;
        setConversations(current => [created, ...current.filter(item => item.id !== created.id)]);
      }
      const updated = await assistantFetch<ConversationSummary>(`/api/ai-crm/conversations/${encodeURIComponent(target.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ executionMode, executionVersion: target.executionVersion ?? 0 }) });
      if (requestedOwner !== owner.current || navigation !== loadVersion.current) return;
      setConversations(current => [updated, ...current.filter(item => item.id !== updated.id)]);
      setNotice("Zugriffe für diesen Chat aktualisiert. Offene Vorschläge werden nicht automatisch ausgeführt.");
    } catch (reason) { if (requestedOwner === owner.current && navigation === loadVersion.current) { setError(reason instanceof Error ? reason.message : "Zugriffe konnten nicht geändert werden."); await loadList(); } }
    finally { setPolicyBusy(false); }
  }, [policyBusy, working, access, active, loadList]);

  const initialize = useCallback(async () => {
    if (initialization.current) return initialization.current;
    if (initialized.current) return;
    initialized.current = true; setLoading(true); setError(null);
    const version = ++initializationVersion.current;
    const request = (async () => {
    try {
      const access = await assistantFetch<AssistantAccess>("/api/ai-crm/access");
      // The entry button can be clicked as soon as React has hydrated it,
      // while AssistantSurface's passive register effect is still queued. The
      // access endpoint is authenticated, so it is safe to bind that first
      // response to an as-yet-unset owner. We still discard a response after
      // an actual account switch, which is the cross-account guard this check
      // was introduced for.
      if (owner.current && access.userId !== owner.current) return;
      if (!owner.current) owner.current = access.userId;
      setAccess(access);
      if (access.enabled || access.reason?.startsWith("MONTHLY")) {
        const list = await loadList();
        if (list[0]) await loadConversation(list[0].id);
      }
    } catch (reason) { if (initializationVersion.current === version) { initialized.current = false; setError(reason instanceof Error ? reason.message : "Der Assistent ist gerade nicht erreichbar."); } }
    finally { if (initializationVersion.current === version) { initialization.current = null; setLoading(false); } }
    })();
    initialization.current = request;
    return request;
  }, [loadList, loadConversation]);

  const open = useCallback((options?: { context?: AssistantContext; prompt?: string; workTask?: AssistantWorkTask; fresh?: boolean }) => {
    if (presenting || options?.fresh && (locked || liveActive)) return;
    const version = ++openVersion.current;
    const requestedOwner = owner.current;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setMode(current => current === "workspace" ? current : "panel"); setSection("chat");
    if (options?.context) setAttachment(options.context);
    if (options?.prompt) setDraft(current => current || options.prompt!);
    if (options?.workTask) setWorkTask(options.workTask);
    else if (options?.context && options.context.contactId !== attachment?.contactId) setWorkTask(null);
    if (options?.fresh) drafts.current.set(conversationId ?? "new", { text: draft, source, attachment, workTask });
    void initialize().then(() => {
      if (version !== openVersion.current || requestedOwner && owner.current !== requestedOwner) return;
      if (options?.fresh) { loadVersion.current++; setConversationId(null); setEntries([]); setDraft(options.prompt ?? ""); setSource("text"); setWorkTask(options.workTask ?? null); setScrollTop(0); setCaptureEpoch(value => value + 1); setNotice("Die Kontaktarbeit ist verknüpft. Prüfe Vorschläge und bestätige das Ergebnis am Kontakt."); }
      if (options?.context) setAttachment(options.context);
    });
  }, [initialize, presenting, locked, liveActive, attachment, conversationId, draft, source, workTask]);

  const expand = useCallback(() => {
    if (currentPath.current !== "/assistent") returnTo.current = currentPath.current;
    viewNavigation.current = "/assistent";
    setMode("workspace"); router.push("/assistent", { scroll: false });
  }, [router]);
  const asPanel = useCallback(() => { setMode("panel"); if (currentPath.current === "/assistent") { viewNavigation.current = returnTo.current; router.replace(returnTo.current, { scroll: false }); } }, [router]);
  const showWorkspace = useCallback(() => { if (!presenting) { setMode("workspace"); void initialize(); } }, [presenting, initialize]);

  const selectConversation = useCallback(async (id: string) => {
    if (locked) return;
    openVersion.current++; drafts.current.set(conversationId ?? "new", { text: draft, source, attachment, workTask });
    const saved = drafts.current.get(id);
    setDraft(saved?.text ?? ""); setSource(saved?.source ?? "text"); setAttachment(saved?.attachment ?? null); setWorkTask(saved?.workTask ?? null);
    setSection("chat"); setCaptureEpoch(value => value + 1);
    await loadConversation(id);
  }, [locked, conversationId, draft, source, attachment, workTask, loadConversation]);

  const startNew = useCallback(() => {
    if (locked) return;
    openVersion.current++; drafts.current.set(conversationId ?? "new", { text: draft, source, attachment, workTask });
    loadVersion.current++; setConversationId(null); setEntries([]); setDraft(""); setSource("text"); setAttachment(null); setWorkTask(null); setNotice("Die neue Unterhaltung entsteht mit deiner ersten Nachricht."); setError(null); setSection("chat"); setScrollTop(0); setCaptureEpoch(value => value + 1);
  }, [locked, conversationId, draft, source, attachment, workTask]);

  useEffect(() => {
    if (!active) return;
    const expire = () => {
      if (Date.parse(active.expiresAt) > Date.now()) return;
      setConversations(current => current.filter(item => item.id !== active.id));
      setConversationId(null); setEntries([]); setNotice("Das vorherige Gespräch ist abgelaufen. Hier beginnt ein neues. Deine CRM-Einträge bleiben erhalten."); setCaptureEpoch(value => value + 1);
    };
    const timer = setTimeout(expire, Math.max(0, Date.parse(active.expiresAt) - Date.now()));
    document.addEventListener("visibilitychange", expire);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", expire); };
  }, [active]);

  const mergeActions = useCallback((requestId: string, actions: ActionReceipt[]) => {
    setEntries(current => current.map(entry => entry.requestId === requestId || entry.actions?.some(action => action.requestId === requestId) ? { ...entry, actions } : entry));
  }, []);

  const acceptReply = useCallback((data: Reply, body: SendBody) => {
    if (activeRequest.current !== body) return;
    if (Date.parse(data.conversation.expiresAt) <= Date.now()) {
      setEntries([]); setConversationId(null); setRecovery(null); activeRequest.current = null;
      setNotice("Das vorherige Gespräch ist abgelaufen. Hier beginnt ein neues. Deine CRM-Einträge bleiben erhalten.");
      return;
    }
    const responseEntry: Entry = { id: `response-${body.clientRequestId}`, role: "assistant", content: data.answer, actions: data.actions, results: data.results, requestId: data.requestId, createdAt: new Date().toISOString() };
    setEntries(current => {
      const base = data.conversation.restartReason ? [{ id: body.clientRequestId, role: "user" as const, content: body.message, source: body.source, delivery: "sent" as const }] : current.map(entry => entry.id === body.clientRequestId ? { ...entry, delivery: "sent" as const } : entry);
      return [...base.filter(entry => entry.id !== responseEntry.id), responseEntry];
    });
    setConversationId(data.conversation.id);
    setConversations(current => {
      const previous = current.find(item => item.id === data.conversation.id);
      const policy = previous && (previous.executionVersion ?? 0) > (data.conversation.executionVersion ?? 0) ? previous : data.conversation;
      return [{ ...data.conversation, executionMode: policy.executionMode, executionVersion: policy.executionVersion }, ...current.filter(item => item.id !== data.conversation.id)];
    });
    if (data.conversation.restartReason) setNotice(data.conversation.restartReason === "expired" ? "Das vorherige Gespräch ist abgelaufen. Hier beginnt ein neues." : "Hier beginnt eine neue Unterhaltung. Das vorherige Gespräch hat 20 Nachrichten erreicht.");
    setRecovery(null); setError(null); activeRequest.current = null;
    if (data.actions.some(item => item.status === "COMPLETED")) { router.refresh(); window.dispatchEvent(new Event("crm:work-saved")); }
  }, [router]);

  // A Live round shares the ordinary seven-day CRM conversation. The transport
  // is intentionally separate, but no second browser-only history is created.
  const acceptLiveConversation = useCallback((conversation: LiveConversation) => {
    setConversationId(conversation.id);
    setConversations(current => {
      const previous = current.find(item => item.id === conversation.id);
      const summary: ConversationSummary = {
        id: conversation.id,
        executionMode: previous && (previous.executionVersion ?? 0) > (conversation.executionVersion ?? 0) ? previous.executionMode : conversation.executionMode ?? previous?.executionMode ?? "CONFIRM",
        executionVersion: Math.max(conversation.executionVersion ?? 0, previous?.executionVersion ?? 0),
        title: conversation.title,
        expiresAt: conversation.expiresAt,
        updatedAt: conversation.updatedAt ?? previous?.updatedAt ?? new Date().toISOString(),
        messageCount: conversation.messageCount ?? previous?.messageCount ?? 0,
      };
      return [summary, ...current.filter(item => item.id !== summary.id)];
    });
    if (conversation.id !== conversationId || conversation.restarted) {
      setEntries([]); setScrollTop(0);
    }
    if (conversation.restarted) {
      setNotice(conversation.restartReason === "expired" ? "Das vorherige Gespräch ist abgelaufen. Hier beginnt eine neue Live-Unterhaltung." : "Hier beginnt eine neue Live-Unterhaltung. Das vorherige Gespräch hat 20 Nachrichten erreicht.");
    }
  }, [conversationId]);

  const acceptLiveTranscript = useCallback((lines: LiveCaption[]) => {
    setEntries(current => mergeLiveSpeech(current, lines));
  }, []);

  const acceptLiveTurn = useCallback((turn: LiveTurn) => {
    const userEntry: Entry = {
      id: `live-${turn.requestId}`,
      role: "user",
      content: turn.transcript,
      source: "live",
      delivery: "sent",
      createdAt: new Date().toISOString(),
      requestId: turn.requestId,
    };
    const responseEntry: Entry = {
      id: `live-response-${turn.requestId}`,
      role: "assistant",
      content: turn.answer,
      kind: turn.nativeSpeech ? "live-result" : undefined,
      actions: turn.actions,
      results: turn.results,
      requestId: turn.requestId,
      createdAt: new Date().toISOString(),
    };
    setEntries(current => [
      ...(turn.conversation.restarted
        ? current.filter(entry => entry.kind === "speech")
        : current.filter(entry => entry.id !== userEntry.id && entry.id !== responseEntry.id)),
      ...(!turn.inputInTranscript ? [userEntry] : []),
      responseEntry,
    ]);
    setConversationId(turn.conversation.id);
    setConversations(current => {
      const previous = current.find(item => item.id === turn.conversation.id);
      const summary: ConversationSummary = {
        id: turn.conversation.id,
        executionMode: previous && (previous.executionVersion ?? 0) > (turn.conversation.executionVersion ?? 0) ? previous.executionMode : turn.conversation.executionMode ?? previous?.executionMode ?? "CONFIRM",
        executionVersion: Math.max(turn.conversation.executionVersion ?? 0, previous?.executionVersion ?? 0),
        title: turn.conversation.title,
        expiresAt: turn.conversation.expiresAt,
        updatedAt: turn.conversation.updatedAt ?? new Date().toISOString(),
        messageCount: turn.conversation.messageCount ?? (previous?.messageCount ?? 0) + 2,
      };
      return [summary, ...current.filter(item => item.id !== summary.id)];
    });
    if (turn.conversation.restarted) {
      setScrollTop(0);
      setNotice(
        turn.conversation.restartReason === "expired"
          ? "Das vorherige Gespräch ist abgelaufen. Die Live-Runde läuft in einer neuen Unterhaltung weiter."
          : "Die vorherige Unterhaltung hat 20 Nachrichten erreicht. Die Live-Runde läuft in einer neuen Unterhaltung weiter.",
      );
    }
    if (turn.actions.some(action => action.status === "COMPLETED")) {
      router.refresh(); window.dispatchEvent(new Event("crm:work-saved"));
    }
  }, [router]);

  const send = useCallback(async () => {
    if (!draft.trim() || locked || loading || activeRequest.current || !access?.enabled) return;
    if (!navigator.onLine) { setError("Du bist gerade offline. Deine Nachricht wurde noch nicht gesendet."); return; }
    const full = active && active.messageCount >= 20;
    const body: SendBody = { message: draft.trim(), source, clientRequestId: crypto.randomUUID(), conversationId: conversationId ?? undefined, workTaskId: workTask?.id, ...(attachment ? { context: { contactId: attachment.contactId, partnerId: attachment.partnerId, followUpId: attachment.followUpId, entityId: attachment.entityId, entityType: attachment.entityType } } : {}) };
    activeRequest.current = body; setWorking(true); setError(null); setNotice(full ? "Diese Nachricht beginnt eine neue Unterhaltung." : null);
    setEntries(current => [...(full ? [] : current), { id: body.clientRequestId, role: "user", content: body.message, source, delivery: "sending" }]); setDraft(""); setSource("text");
    try { const reply = await assistantFetch<Reply>("/api/ai-crm/chat", post(body)); if (activeRequest.current === body) acceptReply(reply, body); }
    catch (reason) {
      if (activeRequest.current === body) {
        if (reason instanceof AssistantHttpError && !reason.requestId && ["INVALID_REQUEST", "ORIGIN_DENIED", "AI_NOT_ENTITLED", "CONTACT_NOT_FOUND", "FOLLOW_UP_NOT_FOUND"].includes(reason.code)) {
          activeRequest.current = null; setDraft(body.message); setSource(body.source); setEntries(current => current.filter(entry => entry.id !== body.clientRequestId)); setError(reason.message); return;
        }
        setRecovery({ body, status: "UNKNOWN", error: reason instanceof Error ? reason.message : undefined });
        setEntries(current => current.map(entry => entry.id === body.clientRequestId ? { ...entry, delivery: "unknown" } : entry));
      }
    } finally { setWorking(false); }
  }, [draft, locked, loading, access, active, source, conversationId, attachment, workTask, acceptReply]);

  const recover = useCallback(async () => {
    const body = recovery?.body ?? activeRequest.current;
    if (!body) return;
    const requestedOwner = owner.current;
    const current = () => owner.current === requestedOwner && activeRequest.current === body;
    setActionBusy("recovery");
    try {
      const data = await assistantFetch<{ id: string; status: string; errorCode: string | null; actions: ActionReceipt[]; response: Reply | null }>(`/api/ai-crm/requests/${body.clientRequestId}`);
      if (!current()) return;
      if (data.response) acceptReply(data.response, body);
      else if (["FAILED", "ABORTED"].includes(data.status)) {
        setEntries(current => [...current.filter(entry => entry.id !== `response-${body.clientRequestId}`), { id: `response-${body.clientRequestId}`, role: "assistant", content: assistantRecoveryFailureMessage(data.status, data.errorCode), actions: data.actions, requestId: data.id }]);
        setRecovery(null); activeRequest.current = null; setWorking(false);
      } else setRecovery({ body, status: data.status, error: "Die Anfrage läuft noch. Bereits ausgeführte Schritte werden beim Abschluss angezeigt." });
    } catch (reason) { if (current()) setRecovery({ body, status: reason instanceof AssistantHttpError && reason.status === 404 ? "NOT_FOUND" : "UNKNOWN", error: reason instanceof Error ? reason.message : "Der Status ist gerade nicht erreichbar." }); }
    finally { if (owner.current === requestedOwner) setActionBusy(null); }
  }, [recovery, acceptReply]);

  const retryOriginal = useCallback(async () => {
    if (recovery?.status !== "NOT_FOUND") return;
    const body = recovery.body; setWorking(true);
    const requestedOwner = owner.current;
    try { const reply = await assistantFetch<Reply>("/api/ai-crm/chat", post(body)); acceptReply(reply, body); }
    catch (reason) { if (activeRequest.current === body && owner.current === requestedOwner) setRecovery({ body, status: "UNKNOWN", error: reason instanceof Error ? reason.message : "Die Anfrage ist noch nicht erreichbar." }); }
    finally { if (owner.current === requestedOwner) setWorking(false); }
  }, [recovery, acceptReply]);

  const stop = useCallback(async () => {
    const body = activeRequest.current;
    if (!body) return;
    setActionBusy("stop");
    try {
      const cancelRequest = async (): Promise<{ id: string; actions: ActionReceipt[] }> => {
        // Stop can arrive while the initial HTTP handler is still registering
        // its durable request. Retry only cancellation of that exact ID.
        for (let attempt = 0; ; attempt++) {
          try { return await assistantFetch<{ id: string; actions: ActionReceipt[] }>(`/api/ai-crm/requests/${body.clientRequestId}`, post({ action: "cancel" })); }
          catch (reason) {
            if (!(reason instanceof AssistantHttpError) || reason.status !== 404 || attempt >= 4) throw reason;
            await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
          }
        }
      };
      const data = await cancelRequest();
      setEntries(current => [...current.filter(entry => entry.id !== `response-${body.clientRequestId}`), { id: `response-${body.clientRequestId}`, role: "assistant", content: "Die Verarbeitung wurde beendet. Bereits gespeicherte Änderungen bleiben erhalten.", actions: data.actions, requestId: data.id }]);
      activeRequest.current = null; setRecovery(null); setWorking(false);
    } catch (reason) { setRecovery({ body, status: "UNKNOWN", error: reason instanceof Error ? reason.message : "Der Abbruch konnte nicht bestätigt werden." }); }
    finally { setActionBusy(null); }
  }, []);

  const changePlan = useCallback(async (requestId: string, action: "confirm" | "cancel", actionIds?: string[]) => {
    if (actionBusy || working) return;
    setActionBusy(requestId); setActionErrors(current => ({ ...current, [requestId]: "" }));
    try {
      const receipts = entries.flatMap(entry => entry.actions ?? []);
      const revisions = Object.fromEntries((actionIds ?? []).map(id => [id, receipts.find(item => item.id === id)?.revision ?? ""]));
      const result = await assistantFetch<{ actions: ActionReceipt[] }>(`/api/ai-crm/requests/${requestId}`, post({ action, ...(actionIds ? { actionIds, ...(action === "confirm" ? { revisions } : {}) } : {}) }));
      mergeActions(requestId, result.actions); router.refresh(); window.dispatchEvent(new Event("crm:work-saved"));
    } catch (reason) { setActionErrors(current => ({ ...current, [requestId]: reason instanceof Error ? reason.message : "Der Abschluss ist unklar. Bitte prüfe das Ergebnis." })); }
    finally { setActionBusy(null); }
  }, [actionBusy, working, entries, mergeActions, router]);

  const revisePlan = useCallback(async (action: ActionReceipt, values: Record<string, string>) => {
    if (!action.id || !action.requestId || !action.revision || actionBusy || working) return false;
    setActionBusy(action.requestId); setActionErrors(current => ({ ...current, [action.requestId!]: "" }));
    try {
      const result = await assistantFetch<{ actions: ActionReceipt[] }>(`/api/ai-crm/requests/${action.requestId}`, post({ action: "revise", actionId: action.id, revision: action.revision, values }));
      mergeActions(action.requestId, result.actions);
      return true;
    } catch (reason) { setActionErrors(current => ({ ...current, [action.requestId!]: reason instanceof Error ? reason.message : "Die Vorschau konnte nicht bearbeitet werden." })); return false; }
    finally { setActionBusy(null); }
  }, [actionBusy, working, mergeActions]);

  const refreshActions = useCallback(async (requestId: string) => {
    try { const result = await assistantFetch<{ actions: ActionReceipt[] }>(`/api/ai-crm/requests/${requestId}`); mergeActions(requestId, result.actions); setActionErrors(current => ({ ...current, [requestId]: "" })); }
    catch { setActionErrors(current => ({ ...current, [requestId]: "Der aktuelle Status konnte nicht geladen werden." })); }
  }, [mergeActions]);
  useEffect(() => {
    if (!visible || working) return;
    const ids = [...new Set(entries.filter(entry => entry.actions?.some(action => action.status === "PENDING" || action.undoable)).flatMap(entry => entry.requestId ? [entry.requestId] : []))];
    if (!ids.length) return;
    const refresh = () => { if (document.visibilityState === "visible") ids.forEach(id => void refreshActions(id)); };
    const timer = setInterval(refresh, 15000); window.addEventListener("focus", refresh);
    return () => { clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [visible, working, entries, refreshActions]);

  const undo = useCallback(async (receipt: ActionReceipt) => {
    if (!receipt.undoEntryId || actionBusy) return;
    setActionBusy(receipt.undoEntryId);
    try {
      await assistantFetch("/api/ai-crm/undo", post({ entryId: receipt.undoEntryId }));
      setEntries(current => current.map(entry => ({ ...entry, actions: entry.actions?.map(action => action.undoEntryId === receipt.undoEntryId ? { ...action, undoable: false, undoStatus: "UNDONE" } : action) })));
      router.refresh(); window.dispatchEvent(new Event("crm:undo"));
    } catch (reason) { setActionErrors(current => ({ ...current, [receipt.id ?? receipt.undoEntryId!]: reason instanceof Error ? reason.message : "Die Änderung konnte nicht zurückgenommen werden." })); if (receipt.requestId) void refreshActions(receipt.requestId); }
    finally { setActionBusy(null); }
  }, [actionBusy, refreshActions, router]);

  const removeConversation = useCallback(async () => {
    if (!deleteTarget || locked) return;
    setActionBusy("delete"); setError(null);
    try {
      const response = await fetch(`/api/ai-crm/conversations/${deleteTarget.id}`, { method: "DELETE", headers: { "X-AI-CRM-Request": "same-origin" } });
      if (!response.ok) { const data = await response.json(); throw new Error(data.error); }
      setConversations(current => current.filter(item => item.id !== deleteTarget.id));
      if (conversationId === deleteTarget.id) { setConversationId(null); setEntries([]); setDraft(""); setAttachment(null); }
      drafts.current.delete(deleteTarget.id); setDeleteTarget(null); setNotice("Unterhaltung gelöscht. Deine CRM-Einträge bleiben erhalten.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Die Unterhaltung konnte nicht gelöscht werden."); }
    finally { setActionBusy(null); }
  }, [deleteTarget, locked, conversationId]);

  const openBilling = useCallback(async (kind: "checkout" | "portal") => {
    setBilling(true); setError(null);
    try { const result = await assistantFetch<{ url: string }>(`/api/ai-crm/billing/${kind}`, post(kind === "checkout" ? { clientRequestId: crypto.randomUUID() } : {})); window.location.assign(result.url); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Der Zugang konnte nicht geöffnet werden."); setBilling(false); }
  }, []);

  return { workTask, setWorkTask, memoryOpen, setMemoryOpen, liveActive, setLiveActive, policyBusy, changeExecutionMode, mode, setMode, expand, asPanel, showWorkspace, visible, presenting, section, setSection, access, conversations, nextCursor, conversationId, active, entries, draft, setDraft, source, setSource, attachment, setAttachment, loading, working, locked, recovery, error, setError, notice, actionBusy, actionErrors, deleteTarget, setDeleteTarget, billing, captureEpoch, scrollTop, setScrollTop, register, open, close, initialize, loadList, selectConversation, startNew, send, recover, retryOriginal, stop, changePlan, revisePlan, refreshActions, undo, removeConversation, openBilling, acceptLiveConversation, acceptLiveTranscript, acceptLiveTurn };
}

type Controller = ReturnType<typeof useController>;
const Context = createContext<Controller | null>(null);
export function useAssistant() { const value = useContext(Context); if (!value) throw new Error("AssistantProvider fehlt"); return value; }
export default function AssistantProvider({ children }: { children: ReactNode }) { const controller = useController(); return <Context.Provider value={controller}>{children}</Context.Provider>; }
