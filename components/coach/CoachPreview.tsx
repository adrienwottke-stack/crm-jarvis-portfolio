"use client";

import { useEffect, useState } from "react";
import { COACH_DEMOS } from "@/lib/coach/demos";
import type { DemoId } from "@/lib/coach/model";

/** Read-only illustration. No form elements, links or application actions. */
export default function CoachPreview({ demo, suspended }: { demo: DemoId; suspended: boolean }) {
  const content = COACH_DEMOS[demo];
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => { setReduced(media.matches); };
    sync(); media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    if (!playing || suspended || reduced) return;
    const timer = setTimeout(() => {
      if (frame < content.frames.length - 1) setFrame(frame + 1);
      else setPlaying(false);
    }, 2500);
    return () => clearTimeout(timer);
  }, [content.frames.length, frame, playing, reduced, suspended]);
  const current = content.frames[frame];
  return <div className="emil-preview" aria-label="Animiertes Beispiel mit Beispieldaten">
    <div className="emil-preview-bar"><span>{content.screen}</span><span className="emil-example-label">BEISPIEL</span></div>
    <div className="emil-preview-stage" key={frame}>
      {current.field && <div className="emil-example-field"><span>{current.field}</span><div>{current.value || <span className="emil-placeholder">Hier eintragen …</span>}</div></div>}
      {current.choices && <div className="emil-example-choices">{current.choices.map(choice => <div key={choice} className={current.selected === choice ? "emil-example-selected" : ""}>{choice}</div>)}</div>}
      <div className={`emil-example-button ${current.selected === current.button ? "emil-example-selected" : ""}`}>{current.button}{current.selected === current.button && <span className="emil-example-tap" aria-hidden>↖</span>}</div>
    </div>
    <p className="emil-preview-caption">{current.caption}</p>
    <div className="emil-preview-controls">
      <span aria-label={`Beispielschritt ${frame + 1} von ${content.frames.length}`}>{content.frames.map((_, index) => <span key={index} className={index === frame ? "emil-frame-current" : ""} />)}</span>
      {reduced ? <button type="button" onClick={() => setFrame((frame + 1) % content.frames.length)}>Nächstes Bild</button> : <button type="button" onClick={() => { if (!playing && frame === content.frames.length - 1) setFrame(0); setPlaying(!playing); }}>{playing ? "Pause" : frame === content.frames.length - 1 ? "Nochmal zeigen" : "Abspielen"}</button>}
    </div>
  </div>;
}
