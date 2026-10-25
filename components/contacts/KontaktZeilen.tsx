"use client";

import Link from "next/link";
import type { NameEntry } from "@/components/NameList";
import StageBadge from "@/components/StageBadge";
import GpName from "@/components/GpName";
import { PhoneIcon } from "@/components/icons";
import { contactHref } from "@/lib/contact-navigation";
import { liegtLabel } from "@/lib/liegenbleiber";

export function telefonZiel(phone: string | null): string | null {
  if (!phone || phone.replace(/\D/g, "").length < 3) return null;
  return `tel:${phone.replace(/[^\d+*#;,]/g, "")}`;
}

function naechsteInfo(entry: NameEntry) {
  return entry.nextStepLabel ?? entry.appointmentLabel ?? entry.lostLabel
    ?? (entry.liegtTage !== null ? `${liegtLabel(entry.liegtTage)} · Nächsten Schritt festlegen` : null)
    ?? (entry.phone ? "Noch kein nächster Schritt" : "Telefonnummer fehlt");
}

export default function KontaktZeilen({ entries, returnTo, selected, onToggle, onMore }: {
  entries: NameEntry[];
  returnTo: string;
  selected: Set<string> | null;
  onToggle: (id: string) => void;
  onMore: (id: string) => void;
}) {
  const real = (entry: NameEntry) => !entry.id.startsWith("neu-");
  const name = (entry: NameEntry) => <GpName name={entry.name} />;
  const actions = (entry: NameEntry) => <div className="crm-person-actions" data-private-content>
    {telefonZiel(entry.phone) && <a href={telefonZiel(entry.phone)!} className="crm-person-call" aria-label={`${entry.name} anrufen`}><PhoneIcon className="h-4 w-4" /></a>}
    <button type="button" onClick={() => onMore(entry.id)} disabled={!real(entry)} aria-label={`Mehr zu ${entry.name}`} className="crm-person-more">Mehr</button>
  </div>;

  return <div className="crm-contact-rows">
    <ul className="crm-person-list" aria-label="Personen">
      {entries.map(entry => <li key={entry.id} className="crm-person-row" data-contact-row={entry.id}>
        {selected ? <button type="button" onClick={() => onToggle(entry.id)} disabled={!real(entry)} aria-pressed={selected.has(entry.id)} className="crm-person-select">
          <span aria-hidden="true" className="crm-person-check">{selected.has(entry.id) ? "✓" : "○"}</span>
          <span className="crm-person-content"><span className="crm-person-name">{name(entry)}</span><StageBadge stage={entry.stage} outcome={entry.outcome} /><span className="crm-person-next">{naechsteInfo(entry)}</span></span>
        </button> : <>
          {real(entry) ? <Link href={contactHref(entry.id, returnTo)} aria-labelledby={`contact-name-mobile-${entry.id}`} className="crm-person-main">
            <span id={`contact-name-mobile-${entry.id}`} className="crm-person-name">{name(entry)}</span>
            <span className="crm-person-state"><StageBadge stage={entry.stage} outcome={entry.outcome} />{!telefonZiel(entry.phone) && <small>Telefon fehlt</small>}</span>
            <span className="crm-person-next">{naechsteInfo(entry)}</span>
          </Link> : <div className="crm-person-main" aria-busy="true"><span className="crm-person-name">{name(entry)}</span><span className="crm-person-next">Wird gespeichert …</span></div>}
          {actions(entry)}
        </>}
      </li>)}
    </ul>

    <table className="crm-person-table">
      <caption className="sr-only">Kontakte mit Status, Telefonnummer und nächstem Schritt</caption>
      <thead><tr><th scope="col">Name</th><th scope="col">Status</th><th scope="col">Telefon</th><th scope="col">Nächster Schritt / Fälligkeit</th><th scope="col">Aktionen</th></tr></thead>
      <tbody>{entries.map(entry => <tr key={entry.id} data-contact-row={entry.id}>
        <th scope="row">{selected ? <button type="button" className="crm-table-name" aria-pressed={selected.has(entry.id)} disabled={!real(entry)} onClick={() => onToggle(entry.id)}><span aria-hidden="true">{selected.has(entry.id) ? "✓" : "○"}</span>{name(entry)}</button> : real(entry) ? <Link href={contactHref(entry.id, returnTo)} className="crm-table-name">{name(entry)}</Link> : <span className="crm-table-name" aria-busy="true">{name(entry)}</span>}</th>
        <td><StageBadge stage={entry.stage} outcome={entry.outcome} /></td>
        <td>{entry.phone ? <span data-sensitive>{entry.phone}</span> : <span className="text-ink-muted">Fehlt</span>}</td>
        <td className="crm-table-next">{naechsteInfo(entry)}</td>
        <td>{!selected && actions(entry)}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}
