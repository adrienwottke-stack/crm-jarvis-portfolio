"use client";

import { useEffect, type RefObject } from "react";

/** Keep both text paths readable when the viewport or text size changes. */
export default function useAutosizeTextArea(textarea: RefObject<HTMLTextAreaElement | null>, value: string, enabled = true) {
  useEffect(() => {
    const input = textarea.current;
    if (!input || !enabled) return;
    const measure = () => {
      input.style.height = "auto"; input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
      input.style.overflowY = input.scrollHeight > 160 ? "auto" : "hidden";
    };
    let width = input.clientWidth, font = getComputedStyle(input).fontSize;
    const resize = () => { const nextWidth = input.clientWidth, nextFont = getComputedStyle(input).fontSize; if (width !== nextWidth || font !== nextFont) { width = nextWidth; font = nextFont; measure(); } };
    measure();
    const observer = new ResizeObserver(resize); observer.observe(input);
    window.addEventListener("resize", resize);
    return () => { observer.disconnect(); window.removeEventListener("resize", resize); };
  }, [textarea, value, enabled]);
}
