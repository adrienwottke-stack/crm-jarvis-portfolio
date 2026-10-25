export type LiveClientPhase =
  | "IDLE"
  | "REQUESTING_MICROPHONE"
  | "CONNECTING"
  | "LISTENING"
  | "THINKING"
  | "SPEAKING"
  | "INTERRUPTING"
  | "RECONNECTING"
  | "ERROR"
  | "ENDED";

export type LiveClientState = {
  phase: LiveClientPhase;
  partialTranscript: string;
  assistantPartialTranscript: string;
  finalTranscript: string;
  error: string | null;
  reconnectAttempts: number;
};

export type LiveClientEvent =
  | { type: "START" }
  | { type: "MICROPHONE_GRANTED" }
  | { type: "MICROPHONE_DENIED"; message: string }
  | { type: "SESSION_READY" }
  | { type: "PARTIAL_TRANSCRIPT"; value: string }
  | { type: "TURN_SENT" }
  | { type: "ASSISTANT_PARTIAL"; value: string }
  | { type: "ASSISTANT_FINAL"; value: string }
  | { type: "BARGE_IN" }
  | { type: "CONNECTION_LOST"; message: string }
  | { type: "RECONNECT" }
  | { type: "RECONNECTED" }
  | { type: "FAIL"; message: string }
  | { type: "END" }
  | { type: "RESET" };

export function initialLiveClientState(): LiveClientState {
  return {
    phase: "IDLE",
    partialTranscript: "",
    assistantPartialTranscript: "",
    finalTranscript: "",
    error: null,
    reconnectAttempts: 0,
  };
}

/**
 * The browser state machine intentionally has no provider-specific events.
 * It only controls local microphone/speech cleanup and renders server-trusted
 * final results. Partial text remains client-side until the user sends it.
 */
export function transitionLiveClientState(
  state: LiveClientState,
  event: LiveClientEvent,
): LiveClientState {
  if (event.type === "RESET") return initialLiveClientState();
  if (event.type === "END") {
    return {
      ...state,
      phase: "ENDED",
      partialTranscript: "",
      assistantPartialTranscript: "",
      error: null,
    };
  }

  switch (event.type) {
    case "START":
      return state.phase === "IDLE" || state.phase === "ENDED" || state.phase === "ERROR"
        ? { ...initialLiveClientState(), phase: "REQUESTING_MICROPHONE" }
        : state;
    case "MICROPHONE_GRANTED":
      return state.phase === "REQUESTING_MICROPHONE"
        ? { ...state, phase: "CONNECTING", error: null }
        : state;
    case "MICROPHONE_DENIED":
      return state.phase === "REQUESTING_MICROPHONE"
        ? { ...state, phase: "ERROR", error: event.message }
        : state;
    case "SESSION_READY":
      return state.phase === "CONNECTING" || state.phase === "RECONNECTING"
        ? { ...state, phase: "LISTENING", error: null }
        : state;
    case "PARTIAL_TRANSCRIPT":
      return state.phase === "LISTENING"
        ? { ...state, partialTranscript: event.value.slice(0, 4000) }
        : state;
    case "TURN_SENT":
      return state.phase === "LISTENING" && state.partialTranscript.trim()
        ? {
            ...state,
            phase: "THINKING",
            assistantPartialTranscript: "",
            finalTranscript: "",
            error: null,
          }
        : state;
    case "ASSISTANT_PARTIAL":
      return state.phase === "THINKING"
        ? {
            ...state,
            phase: "SPEAKING",
            assistantPartialTranscript: event.value.slice(0, 4000),
            finalTranscript: "",
            error: null,
          }
        : state;
    case "ASSISTANT_FINAL":
      return state.phase === "THINKING" || state.phase === "SPEAKING"
        ? {
            ...state,
            phase: "SPEAKING",
            assistantPartialTranscript: event.value.slice(0, 4000),
            finalTranscript: event.value,
            partialTranscript: "",
            error: null,
          }
        : state;
    case "BARGE_IN":
      return state.phase === "SPEAKING" || state.phase === "THINKING"
        ? { ...state, phase: "LISTENING", partialTranscript: "", error: null }
        : state;
    case "CONNECTION_LOST":
      return state.phase === "ENDED"
        ? state
        : { ...state, phase: "ERROR", error: event.message };
    case "RECONNECT":
      return state.phase === "ERROR"
        ? { ...state, phase: "RECONNECTING", reconnectAttempts: state.reconnectAttempts + 1, error: null }
        : state;
    case "RECONNECTED":
      return state.phase === "RECONNECTING"
        ? { ...state, phase: "LISTENING", error: null }
        : state;
    case "FAIL":
      return { ...state, phase: "ERROR", error: event.message };
    default:
      return state;
  }
}
