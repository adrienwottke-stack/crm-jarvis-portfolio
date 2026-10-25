export const ASSISTANT_PANEL_MIN_WIDTH = 1280;
export function assistantIsFull(mode: string, width: number): boolean {
  return mode === "workspace" || width < ASSISTANT_PANEL_MIN_WIDTH;
}
