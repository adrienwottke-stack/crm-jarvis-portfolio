"use client";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Model text is untrusted. No raw HTML, embedded media or active content. */
export default function AssistantMessage({ text }: { text: string }) {
  return <div className="assistant-message-text assistant-markdown"><Markdown
    remarkPlugins={[remarkGfm]} skipHtml
    allowedElements={["p", "strong", "em", "del", "ul", "ol", "li", "blockquote", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6", "code", "pre", "a", "table", "thead", "tbody", "tr", "th", "td"]}
    components={{
      a: ({ href, children }) => href ? <a href={href} target={href.startsWith("/") && !href.startsWith("//") ? undefined : "_blank"} rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
      table: ({ children }) => <div className="assistant-table-scroll" tabIndex={0} role="region" aria-label="Tabelle"><table>{children}</table></div>,
    }}
  >{text}</Markdown></div>;
}
