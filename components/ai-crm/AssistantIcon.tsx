import type { SVGProps } from "react";

const paths = {
  sidebar: <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16" /></>,
  compose: <><path d="M12 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6M14 5l5 5M10 14l-1 4 4-1 8-8a2.1 2.1 0 0 0-5-5z" /></>,
  expand: <path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7" />,
  collapse: <path d="M20 4l-7 7m0-6v6h6M4 20l7-7m-6 0h6v6" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  back: <path d="m12 5-7 7 7 7M5 12h15" />,
  more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  mic: <><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3" /></>,
  muted: <><path d="m3 3 18 18M9 9v3a3 3 0 0 0 5 2M9 5a3 3 0 0 1 6 1v3M5 10v2a7 7 0 0 0 12 5M19 10v2M12 19v3" /></>,
  voice: <path d="M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4" />,
  send: <path d="M12 20V4m-7 7 7-7 7 7" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></>,
  trash: <><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5" /></>,
} as const;

export default function AssistantIcon({ name, ...props }: SVGProps<SVGSVGElement> & { name: keyof typeof paths }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>;
}
