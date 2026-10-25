"use client";

import Link from "next/link";
import { FormEvent, useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import JarvisLive, {
  type JarvisLiveActionReceipt,
  type JarvisLiveConversation,
} from "@/components/ai-crm/JarvisLive";
import Sprachaufnahme from "@/components/Sprachaufnahme";
import {
  ArrowRightIcon,
  CheckIcon,
  LockIcon,
  MikrofonIcon,
  SparkIcon,
  UndoIcon,
} from "@/components/icons";
import { btnPrimary, btnSecondary, card, cn, inputBlank } from "@/components/ui";

export type ActionReceipt = {
  summary: string;
  entityType?: string;
  entityId?: string;
  link?: string;
  undoable: boolean;
  undoEntryId?: string;
};

export type Entry = {
  id: string;
  role: "user" | "assistant";
  content: string;
  source?: "voice" | "text" | "live";
  actions?: ActionReceipt[];
};

type ConversationSummary = {
  id: string;
  title: string;
  expiresAt: string;
  messageCount: number;
};

type Props = {
  enabled: boolean;
  priceLabel: string;
  billingConfigured: boolean;
  hasBillingAccount: boolean;
  monthlyRequests: number;
  monthlyRequestLimit: number;
  monthlyAudioSeconds: number;
  monthlyAudioSecondsLimit: number;
  initialConversations: ConversationSummary[];
  initialConversationId: string | null;
  initialEntries: Entry[];
};

const examples = [
  "Was steht heute an?",
  "Wie sieht meine Pipeline aus?",
  "Fass mir meine letzten Gespräche zusammen.",
];

function newId() {
  return crypto.randomUUID();
}

function expiryLabel(value: string) {
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

async function responseJson(response: Response) {
  return response.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

// A dropped HTTP response is the one retry case the browser can recognize
// safely. The prepared body (and therefore the clientRequestId) is reused so
// the server can replay the original result instead of executing CRM writes a
// second time. HTTP error responses are deliberately not retried here.
async function fetchWithNetworkRetry(input: string, init: RequestInit) {
  try {
    return await fetch(input, init);
  } catch {
    return fetch(input, init);
  }
}

export default function AiCrmAssistant(props: Props) {
  const router = useRouter();
  const [conversations, setConversations] = useState(props.initialConversations);
  const [conversationId, setConversationId] = useState(props.initialConversationId);
  const [entries, setEntries] = useState<Entry[]>(props.initialEntries);
  const [text, setText] = useState("");
  const [working, setWorking] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [billing, setBilling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [undone, setUndone] = useState<Set<string>>(() => new Set());

  const activeConversation =
    conversations.find((conversation) => conversation.id === conversationId) ?? null;

  const openBilling = useCallback(async (kind: "checkout" | "portal") => {
    setBilling(true);
    setError(null);
    try {
      const response = await fetch(`/api/ai-crm/billing/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          kind === "checkout" ? { clientRequestId: newId() } : {},
        ),
      });
      const data = await responseJson(response);
      if (!response.ok || typeof data.url !== "string") {
        throw new Error(typeof data.error === "string" ? data.error : "Das Abo konnte gerade nicht geöffnet werden.");
      }
      window.location.assign(data.url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Das Abo konnte gerade nicht geöffnet werden.");
      setBilling(false);
    }
  }, []);

  const selectConversation = useCallback(async (id: string) => {
    setError(null);
    setNotice(null);
    const response = await fetch(`/api/ai-crm/conversations/${id}`, {
      cache: "no-store",
    });
    const data = await responseJson(response);
    if (!response.ok || !Array.isArray(data.messages)) {
      setError(
        typeof data.error === "string"
          ? data.error
          : "Die Unterhaltung konnte nicht geladen werden.",
      );
      return;
    }
    const messages = data.messages as Array<{
      id: string;
      role: string;
      content: string;
      source?: string | null;
      actions?: ActionReceipt[] | null;
    }>;
    setConversationId(id);
    setEntries(
      messages.map((message) => ({
        id: message.id,
        role: message.role === "user" ? "user" : "assistant",
        content: message.content,
        source:
          message.source === "VOICE"
            ? "voice"
            : message.source === "TEXT"
              ? "text"
              : message.source === "LIVE"
                ? "live"
              : undefined,
        actions: Array.isArray(message.actions)
          ? message.actions.map((action) => ({ ...action, undoable: false }))
          : undefined,
      })),
    );
  }, []);

  const startNewConversation = useCallback(() => {
    setConversationId(null);
    setEntries([]);
    setError(null);
    setNotice("Die neue Unterhaltung entsteht mit deiner ersten Nachricht.");
  }, []);

  const deleteActiveConversation = useCallback(async () => {
    if (!conversationId || !window.confirm("Diese Unterhaltung und ihre Nachrichten jetzt löschen?")) {
      return;
    }
    const response = await fetch(`/api/ai-crm/conversations/${conversationId}`, {
      method: "DELETE",
      headers: { "X-AI-CRM-Request": "same-origin" },
    });
    if (!response.ok) {
      const data = await responseJson(response);
      setError(
        typeof data.error === "string"
          ? data.error
          : "Die Unterhaltung konnte nicht gelöscht werden.",
      );
      return;
    }
    const remaining = conversations.filter((conversation) => conversation.id !== conversationId);
    setConversations(remaining);
    setConversationId(null);
    setEntries([]);
    setNotice("Unterhaltung gelöscht.");
    if (remaining[0]) void selectConversation(remaining[0].id);
  }, [conversationId, conversations, selectConversation]);

  const sendMessage = useCallback(
    async (message: string, source: "voice" | "text") => {
      const clean = message.trim();
      if (!clean || working) return;
      setWorking(true);
      setError(null);
      setNotice(null);
      const clientRequestId = newId();
      setEntries((current) => [
        ...current,
        { id: newId(), role: "user", content: clean, source },
      ]);
      setText("");
      try {
        const response = await fetchWithNetworkRetry("/api/ai-crm/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: clean,
            source,
            conversationId: conversationId ?? undefined,
            clientRequestId,
          }),
        });
        const data = await responseJson(response);
        if (!response.ok) {
          throw new Error(
            typeof data.error === "string"
              ? data.error
              : "Die Anfrage konnte gerade nicht verarbeitet werden.",
          );
        }
        const actions = Array.isArray(data.actions)
          ? (data.actions as ActionReceipt[])
          : [];
        setEntries((current) => [
          ...current,
          {
            id: newId(),
            role: "assistant",
            content:
              typeof data.answer === "string"
                ? data.answer
                : "Erledigt.",
            actions,
          },
        ]);
        const conversation = data.conversation as
          | { id?: string; title?: string; expiresAt?: string; restarted?: boolean }
          | undefined;
        if (
          conversation &&
          typeof conversation.id === "string" &&
          typeof conversation.title === "string" &&
          typeof conversation.expiresAt === "string"
        ) {
          setConversationId(conversation.id);
          setConversations((current) => [
            {
              id: conversation.id!,
              title: conversation.title!,
              expiresAt: conversation.expiresAt!,
              messageCount:
                (current.find((item) => item.id === conversation.id)?.messageCount ?? 0) + 2,
            },
            ...current.filter((item) => item.id !== conversation.id),
          ]);
          if (conversation.restarted) {
            setNotice(
              "Wegen der Sieben-Tage-Frist oder des Nachrichtenlimits wurde eine neue Unterhaltung begonnen.",
            );
          }
        }
        if (actions.length > 0) router.refresh();
      } catch (reason) {
        const message =
          reason instanceof Error
            ? reason.message
            : "Die Anfrage konnte gerade nicht verarbeitet werden.";
        setError(message);
        setEntries((current) => [
          ...current,
          { id: newId(), role: "assistant", content: message },
        ]);
      } finally {
        setWorking(false);
      }
    },
    [conversationId, router, working],
  );

  const transcribe = useCallback(
    async (blob: Blob | null, ms: number) => {
      if (!blob || working) return;
      setTranscribing(true);
      setError(null);
      try {
        const extension = blob.type.includes("mp4") ? "m4a" : "webm";
        const form = new FormData();
        form.set("audio", new File([blob], `crm-aufnahme.${extension}`, { type: blob.type }));
        form.set("durationSeconds", String(ms / 1000));
        form.set("clientRequestId", newId());
        const response = await fetchWithNetworkRetry("/api/ai-crm/transcribe", {
          method: "POST",
          body: form,
        });
        const data = await responseJson(response);
        if (!response.ok || typeof data.transcript !== "string") {
          throw new Error(
            typeof data.error === "string"
              ? data.error
              : "Die Aufnahme konnte gerade nicht erkannt werden.",
          );
        }
        setText(data.transcript);
        await sendMessage(data.transcript, "voice");
      } catch (reason) {
        setError(
          reason instanceof Error
            ? reason.message
            : "Die Aufnahme konnte gerade nicht erkannt werden.",
        );
      } finally {
        setTranscribing(false);
      }
    },
    [sendMessage, working],
  );

  const undo = useCallback(
    async (entryId: string) => {
      setError(null);
      const response = await fetch("/api/ai-crm/undo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId }),
      });
      const data = await responseJson(response);
      if (!response.ok) {
        setError(
          typeof data.error === "string"
            ? data.error
            : "Rückgängig ist gerade nicht möglich.",
        );
        return;
      }
      setUndone((current) => new Set(current).add(entryId));
      router.refresh();
    },
    [router],
  );

  const acceptLiveConversation = useCallback(
    (conversation: JarvisLiveConversation) => {
      setConversationId(conversation.id);
      setConversations((current) => [
        {
          id: conversation.id,
          title: conversation.title,
          expiresAt: conversation.expiresAt,
          messageCount: current.find((item) => item.id === conversation.id)?.messageCount ?? 0,
        },
        ...current.filter((item) => item.id !== conversation.id),
      ]);
      if (conversation.id !== conversationId) {
        setEntries([]);
      }
      if (conversation.restarted) {
        setNotice("Für Live mit Jarvis wurde wegen der Sieben-Tage-Frist oder des Nachrichtenlimits eine neue Unterhaltung begonnen.");
      }
    },
    [conversationId],
  );

  const acceptLiveTurn = useCallback(
    (turn: {
      transcript: string;
      answer: string;
      actions: JarvisLiveActionReceipt[];
      conversation: JarvisLiveConversation;
    }) => {
      setEntries((current) => [
        ...current,
        { id: newId(), role: "user", content: turn.transcript, source: "live" },
        {
          id: newId(),
          role: "assistant",
          content: turn.answer,
          actions: turn.actions,
        },
      ]);
      setConversationId(turn.conversation.id);
      setConversations((current) => [
        {
          id: turn.conversation.id,
          title: turn.conversation.title,
          expiresAt: turn.conversation.expiresAt,
          messageCount:
            (current.find((item) => item.id === turn.conversation.id)?.messageCount ?? 0) + 2,
        },
        ...current.filter((item) => item.id !== turn.conversation.id),
      ]);
      if (turn.actions.length > 0) router.refresh();
    },
    [router],
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    void sendMessage(text, "text");
  }

  if (!props.enabled) {
    return (
      <section className={`${card} overflow-hidden`} aria-labelledby="ai-crm-title">
        <div className="buehne bg-navy-950 px-5 py-5 text-white sm:px-6">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10">
              <MikrofonIcon className="h-5 w-5" />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/60">
                AI CRM Add-on
              </p>
              <h2 id="ai-crm-title" className="mt-1 text-xl font-semibold">
                Mit deinem CRM sprechen
              </h2>
            </div>
          </div>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-white/75">
            Gespräche dokumentieren, Follow-ups setzen und den Tag abfragen — per Stimme oder Text.
          </p>
        </div>
        <div className="space-y-4 p-5 sm:p-6">
          <ul className="space-y-2 text-sm text-ink-muted">
            <li className="flex gap-2"><CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> Kontakte und Gesprächsnotizen automatisch pflegen</li>
            <li className="flex gap-2"><CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> Follow-ups direkt in deiner Heute-Liste anlegen</li>
            <li className="flex gap-2"><LockIcon className="mt-0.5 h-4 w-4 shrink-0 text-navy-600" /> Nur deine eigenen CRM-Daten, mit sichtbarem Aktionsprotokoll</li>
          </ul>
          <button
            type="button"
            disabled={!props.billingConfigured || billing}
            onClick={() => void openBilling("checkout")}
            className={cn(btnPrimary, "w-full sm:w-auto")}
          >
            {billing
              ? "Abo wird geöffnet …"
              : props.billingConfigured
                ? `AI CRM für ${props.priceLabel}/Monat aktivieren`
                : "AI CRM wird gerade eingerichtet"}
            {!billing && <ArrowRightIcon className="h-5 w-5" />}
          </button>
          <p className="text-xs text-ink-soft">
            Monatlich kündbar. Steuer- und Rechnungsangaben zeigt der konfigurierte Checkout.
          </p>
          {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
        </div>
      </section>
    );
  }

  return (
    <section className={`${card} overflow-hidden`} aria-labelledby="ai-crm-title">
      <div className="buehne bg-navy-950 px-5 py-5 text-white sm:px-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10">
              <MikrofonIcon className="h-5 w-5" />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/60">
                AI CRM
              </p>
              <h2 id="ai-crm-title" className="mt-1 text-xl font-semibold">
                Mit deinem CRM sprechen
              </h2>
            </div>
          </div>
          <span className="rounded-full bg-emerald-400/15 px-2.5 py-1 text-xs font-medium text-emerald-200">
            Aktiv
          </span>
        </div>
        <p className="mt-4 text-sm text-white/70">
          Sag, was passiert ist — ich dokumentiere es und zeige dir jeden ausgeführten Schritt.
        </p>
      </div>

      <div className="space-y-5 p-5 sm:p-6">
        <div className="rounded-2xl border border-line bg-navy-50/60 p-3">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
            <label className="min-w-0">
              <span className="sr-only">Unterhaltung wechseln</span>
              <select
                value={conversationId ?? ""}
                onChange={(event) => {
                  if (event.target.value) void selectConversation(event.target.value);
                  else startNewConversation();
                }}
                className="min-h-11 w-full min-w-0 rounded-xl border border-line-strong bg-surface px-3 text-sm text-ink"
              >
                <option value="">Neue Unterhaltung</option>
                {conversations.map((conversation) => (
                  <option key={conversation.id} value={conversation.id}>
                    {conversation.title} · bis {expiryLabel(conversation.expiresAt)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={startNewConversation}
              className="min-h-11 rounded-xl border border-line-strong bg-surface px-3 text-sm font-medium text-link"
            >
              Neue Unterhaltung
            </button>
            <button
              type="button"
              disabled={!conversationId}
              onClick={() => void deleteActiveConversation()}
              className="min-h-11 rounded-xl px-3 text-sm font-medium text-red-700 disabled:opacity-40"
            >
              Löschen
            </button>
          </div>
          <p className="mt-2 text-xs text-ink-muted">
            {activeConversation
              ? `Wird am ${expiryLabel(activeConversation.expiresAt)} gelöscht · ${activeConversation.messageCount}/20 Nachrichten`
              : "Noch nicht gespeichert · entsteht mit der ersten Nachricht"}
          </p>
          <p className="mt-1 text-xs text-ink-soft">
            Jede Unterhaltung wird genau sieben Tage nach ihrem Beginn gelöscht.
          </p>
        </div>

        {notice && (
          <p className="rounded-xl bg-blue-50 px-3 py-2 text-sm text-navy-700" role="status">
            {notice}
          </p>
        )}

        <JarvisLive
          conversationId={conversationId}
          onConversationStarted={acceptLiveConversation}
          onTurn={acceptLiveTurn}
        />

        {entries.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {examples.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setText(example)}
                className="min-h-10 rounded-full border border-line-strong px-3 text-left text-13 text-ink-muted transition hover:bg-sunken hover:text-ink"
              >
                {example}
              </button>
            ))}
          </div>
        )}

        {entries.length > 0 && (
          <ol className="max-h-96 space-y-3 overflow-y-auto pr-1" aria-live="polite">
            {entries.slice(-20).map((entry) => (
              <li
                key={entry.id}
                className={cn(
                  "rounded-2xl px-4 py-3 text-sm leading-relaxed",
                  entry.role === "user"
                    ? "ml-6 bg-navy-50 text-ink"
                    : "mr-3 border border-line bg-surface text-ink",
                )}
              >
                {entry.source === "voice" && (
                  <span className="mb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-ink-soft">
                    <MikrofonIcon className="h-3.5 w-3.5" /> Erkanntes Transkript
                  </span>
                )}
                {entry.source === "live" && (
                  <span className="mb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-blue-700">
                    <SparkIcon className="h-3.5 w-3.5" /> Live-Transkript
                  </span>
                )}
                <p className="whitespace-pre-wrap">{entry.content}</p>
                {entry.actions && entry.actions.length > 0 && (
                  <ul className="mt-3 space-y-2 border-t border-line pt-3">
                    {entry.actions.map((action, index) => {
                      const isUndone = Boolean(action.undoEntryId && undone.has(action.undoEntryId));
                      return (
                        <li key={`${action.entityId ?? "action"}-${index}`} className="flex flex-wrap items-center gap-2">
                          <CheckIcon className="h-4 w-4 shrink-0 text-emerald-600" />
                          <span className={cn("flex-1", isUndone && "line-through text-ink-soft")}>
                            {action.summary}
                          </span>
                          {action.link && !isUndone && (
                            <Link href={action.link} className="font-medium text-link">
                              Öffnen
                            </Link>
                          )}
                          {action.undoable && action.undoEntryId && !isUndone && (
                            <button
                              type="button"
                              onClick={() => void undo(action.undoEntryId!)}
                              className="inline-flex min-h-9 items-center gap-1 rounded-full px-2 text-13 font-medium text-ink-muted hover:bg-sunken"
                            >
                              <UndoIcon className="h-4 w-4" /> Rückgängig
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        )}

        <div className="rounded-2xl bg-sunken p-3 sm:p-4">
          <Sprachaufnahme onAufnahme={(blob, ms) => void transcribe(blob, ms)} />
          {transcribing && (
            <p className="mt-2 flex items-center justify-center gap-2 text-sm text-ink-muted" aria-live="polite">
              <SparkIcon className="h-4 w-4 animate-pulse text-navy-600" /> Sprache wird erkannt …
            </p>
          )}
          <div className="my-3 flex items-center gap-3 text-[11px] uppercase tracking-wider text-ink-soft">
            <span className="h-px flex-1 bg-line" /> oder schreiben <span className="h-px flex-1 bg-line" />
          </div>
          <form onSubmit={submit} className="space-y-3">
            <label htmlFor="ai-crm-message" className="sr-only">Nachricht an dein CRM</label>
            <textarea
              id="ai-crm-message"
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={4000}
              rows={3}
              disabled={working || transcribing}
              placeholder="Zum Beispiel: Hatte gerade ein Gespräch mit Max …"
              className={cn(inputBlank, "min-h-24 resize-y")}
            />
            <button
              type="submit"
              disabled={!text.trim() || working || transcribing}
              className={cn(btnPrimary, "w-full")}
            >
              {working ? "CRM arbeitet …" : "An CRM senden"}
              {!working && <ArrowRightIcon className="h-5 w-5" />}
            </button>
          </form>
        </div>

        {error && <p className="text-sm text-red-700" role="alert">{error}</p>}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 text-xs text-ink-soft">
          <span>
            Diesen Monat: {props.monthlyRequests}/{props.monthlyRequestLimit} Anfragen · {Math.ceil(props.monthlyAudioSeconds / 60)}/{Math.ceil(props.monthlyAudioSecondsLimit / 60)} Sprachminuten
          </span>
          {props.hasBillingAccount && (
            <button
              type="button"
              onClick={() => void openBilling("portal")}
              disabled={billing}
              className={btnSecondary}
            >
              Abo verwalten
            </button>
          )}
        </div>
        <p className="text-xs leading-relaxed text-ink-soft">
          Audio wird nicht gespeichert. Gespeichert werden nur sichtbare Nachrichten und minimierte Aktionsbelege.
        </p>
      </div>
    </section>
  );
}
