/** A contact list is the only valid return destination, including its filters. */
export function contactListReturn(value: unknown): string {
  if (typeof value !== "string" || !/^\/namen(?:\?|$)/.test(value) || value.length > 2000) return "/namen";
  const query = new URLSearchParams(value.split("?")[1] ?? "");
  const safe = new URLSearchParams();
  for (const key of ["liste", "q", "status", "telefon"]) {
    const item = query.get(key);
    if (item) safe.set(key, item.slice(0, 160));
  }
  return `/namen${safe.size ? `?${safe}` : ""}`;
}

export function contactHref(id: string, returnTo: string, edit = false): string {
  return `/contacts/${encodeURIComponent(id)}${edit ? "/edit" : ""}?returnTo=${encodeURIComponent(contactListReturn(returnTo))}`;
}
