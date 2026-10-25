"use client";

import { emilHilfe } from "@/lib/coach/events";

export default function CoachProfileEntry() {
  return <button type="button" onClick={() => emilHilfe()} className="crm-list-row w-full text-left">Emil, hilf mir<span className="ml-auto" aria-hidden>›</span></button>;
}
