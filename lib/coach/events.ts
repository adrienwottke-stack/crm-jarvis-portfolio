/** UI refresh signals only. The server always decides what has actually happened. */
export function emilArbeitGespeichert() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("crm:work-saved"));
}

export function emilHilfe(demo?: string) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("crm:emil-help", { detail: demo }));
}
