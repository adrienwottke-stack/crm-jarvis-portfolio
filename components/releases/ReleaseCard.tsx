import type { Release } from "@/lib/releases/catalog";
import ReleaseAction from "./ReleaseAction";

export default function ReleaseCard({ release, latest = false, selected = false }: { release: Release; latest?: boolean; selected?: boolean }) {
  return <article className="crm-release-card" id={release.id} data-selected={selected || undefined} aria-labelledby={`${release.id}-title`}>
    <p className="crm-release-date"><time dateTime={release.date}>{new Intl.DateTimeFormat("de-DE", { dateStyle: "long", timeZone: "Europe/Berlin" }).format(new Date(`${release.date}T12:00:00Z`))}</time>{latest && <span>Aktuell</span>}</p>
    <h2 id={`${release.id}-title`} data-release-id={release.id}>{release.title}</h2>
    <p className="crm-release-benefit">{release.benefit}</p>
    <ul>{release.changes.slice(0, 3).map(change => <li key={change}>{change}</li>)}</ul>
    <ReleaseAction release={release} />
  </article>;
}
